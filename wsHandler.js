import WebSocket, {WebSocketServer} from 'ws';
import {v4 as uuidv4} from 'uuid';

import {players, rooms} from './rooms.js'
import * as gameManager from './gameManager.js'

let wss = null;
let heartbeatInterval = null;

function startHeartbeat() {
    const INTERVAL_MS = 30000;

    if (heartbeatInterval) clearInterval(heartbeatInterval);

    heartbeatInterval = setInterval(() => {
        if (!wss) return;

        wss.clients.forEach(ws => {
            if (ws.isAlive === false) {
                console.log('💀 Terminating dead socket');
                try {ws.terminate();} catch (e) {}
                return;
            }

            ws.isAlive = false;
            try {
                ws.ping();
            } catch (e) {
                console.error('Erreur ping : ', e.message);
            }
        });
    }, INTERVAL_MS);
}

export function initWebsocket(server) {
    wss = new WebSocketServer({server});

    wss.on('connection', (ws) => {
        console.log('✅ Nouvelle connexion WebSocket');
        ws.isAlive = true;

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (msg) => {
            const raw = msg.toString();

            let payload;
            try {
                payload = JSON.parse(raw);
            } catch (err) {
                console.log('Message non-JSON reçu:', raw);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Payload JSON invalide.'
                }));
                return;
            }

            console.log('Nouveau message reçu : ', payload);

            const effectiveType = payload.type;
            if (!effectiveType || typeof effectiveType !== 'string') {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Payload JSON invalide (il manque le type).'
                }));
                return;
            }

            switch (effectiveType) {
                case 'connection': {
                    const token = payload.token;

                    // VALIDATION
                    if (!token || typeof token !== 'string') {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Token invalide'
                        }));
                        return;
                    }

                    // Stocker le token sur la websocket pour le heartbeat
                    ws.playerToken = token;

                    // Verify token with Central Auth Service
                    let verifiedUser = null;
                    try {
                        const authUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4000';
                        const res = await fetch(`${authUrl}/api/verify-token`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token })
                        });
                        if (res.ok) {
                            verifiedUser = await res.json();
                        }
                    } catch (e) {
                        console.error("⚠️ Central Auth verification failed:", e.message);
                    }

                    if (!verifiedUser) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Échec de l\'authentification centrale.'
                        }));
                        ws.close(4003, "Non authentifié");
                        return;
                    }

                    const pseudo = verifiedUser.pseudo;

                    // Gérer la reconnexion sous période de grâce (15 secondes)
                    if (players[token]) {
                        console.log(`🔄 Reconnexion du joueur ${pseudo} avec le token:`, token);
                        
                        if (players[token].disconnectTimeout) {
                            clearTimeout(players[token].disconnectTimeout);
                            players[token].disconnectTimeout = null;
                        }
                        
                        players[token].ws = ws;
                        players[token].isOffline = false;

                        // Envoyer la confirmation au client
                        ws.send(JSON.stringify({
                            type: 'connectionConfirmed',
                            token: token,
                            message: 'Connexion rétablie'
                        }));

                        const roomCode = players[token].currentRoom;
                        if (roomCode && rooms[roomCode]) {
                            const room = rooms[roomCode];
                            
                            // Envoyer l'état actuel de la partie au joueur qui se reconnecte
                            if (room.gameState.isStarted) {
                                const allTimers = Object.entries(room.gameState.playerTimers).map(([t, timerData]) => ({
                                    token: t,
                                    pseudo: players[t]?.pseudo,
                                    totalTimeLeft: timerData.totalTimeLeft,
                                    isPaused: timerData.isPaused,
                                    isEliminated: timerData.isEliminated,
                                    malus: room.gameState.malus[t]?.totalMalus || 0,
                                    score: room.gameState.scores[t] || 0,
                                }));

                                const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
                                const isCurrentPlayer = token === currentPlayerToken;

                                ws.send(JSON.stringify({
                                    type: 'gameStarted',
                                    roomCode: roomCode,
                                    letter: room.gameState.currentLetter,
                                    round: room.gameState.currentRound,
                                    isCurrentPlayer: isCurrentPlayer,
                                    currentPlayerPseudo: players[currentPlayerToken]?.pseudo,
                                    playerOrder: room.gameState.playerOrder.map(t => ({
                                        token: t,
                                        pseudo: players[t]?.pseudo
                                    })),
                                    maxRounds: room.gameState.maxRounds,
                                    timeLeft: room.gameState.playerTimers[token].totalTimeLeft,
                                    isTimerPaused: room.gameState.playerTimers[token].isPaused,
                                    timerStartTimestamp: room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp,
                                    allTimers: allTimers,
                                    message: 'Reconnexion à la partie en cours',
                                }));
                            } else {
                                ws.send(JSON.stringify({
                                    type: 'redirection',
                                    roomCode: roomCode,
                                    isMaster: players[token].isMaster,
                                }));
                            }
                            gameManager.updateRoomPlayers(roomCode);
                        }
                        return;
                    }

                    players[token] = {
                        ws,
                        pseudo: pseudo,
                        currentRoom: null,
                        connectedAt: Date.now(),
                        isOffline: false,
                        disconnectTimeout: null,
                        userId: verifiedUser.id,
                        isPremium: verifiedUser.isPremium
                    };

                    console.log('✅ Nouveau joueur avec le token:', token);

                    ws.send(JSON.stringify({
                        type: 'connectionConfirmed',
                        token: token,
                        message: 'Connexion établie avec succès',
                        pseudo: pseudo,
                        isPremium: verifiedUser.isPremium
                    }));

                    return;
                }

                case 'update': {
                    const token = payload.token;
                    const pseudo = payload.pseudo;
                    const roomCode = payload.roomCode;

                    if (players[token]) {
                        players[token].pseudo = pseudo;
                        gameManager.updateRoomPlayers(roomCode);
                    }
                    return;
                }

                case 'createRoom': {
                    const { token, pseudo, maxRounds, maxTime, canEliminatedPlayersVote, randomizeOrder } = payload;

                    if (!token || !pseudo) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Token et pseudo requis'
                        }));
                        return;
                    }

                    if (!players[token]) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Joueur non trouvé'
                        }));
                        return;
                    }

                    console.log('Création de room demandée par le joueur avec le token:', token);

                    players[token].pseudo = pseudo;
                    const roomCode = gameManager.createGame(token);
                    
                    const room = rooms[roomCode];
                    if (room) {
                        if (maxRounds !== undefined) room.gameState.maxRounds = maxRounds;
                        if (maxTime !== undefined) room.gameState.timerConfig.duration = maxTime;
                        if (canEliminatedPlayersVote !== undefined) room.gameState.canEliminatedPlayersVote = canEliminatedPlayersVote;
                        if (randomizeOrder !== undefined) room.gameState.randomizeOrder = randomizeOrder;
                        
                        gameManager.updateRoomPlayers(roomCode);
                    }
                    return;
                }

                case 'updateRoomConfig': {
                    const { roomCode, maxRounds, maxTime, canEliminatedPlayersVote, randomizeOrder } = payload;
                    const room = rooms[roomCode];
                    if (room) {
                        if (maxRounds !== undefined) room.gameState.maxRounds = maxRounds;
                        if (maxTime !== undefined) room.gameState.timerConfig.duration = maxTime;
                        if (canEliminatedPlayersVote !== undefined) room.gameState.canEliminatedPlayersVote = canEliminatedPlayersVote;
                        if (randomizeOrder !== undefined) room.gameState.randomizeOrder = randomizeOrder;
                        
                        gameManager.updateRoomPlayers(roomCode);
                    }
                    return;
                }

                case 'joinRoom': {
                    const token = payload.token;
                    const pseudo = payload.pseudo;
                    const roomCode = payload.roomCode;
                    if (players[token]) {
                        players[token].pseudo = pseudo;
                        console.log(players[token]);
                    }
                    try {
                        players[token].ws.send(JSON.stringify({
                            type: 'roomJoined',
                            roomCode: roomCode,
                            message: 'Bienvenue ' + pseudo
                        }));
                    } catch (e) {}
                    gameManager.addPlayerToRoom(roomCode, token, false);
                    return;
                }

                case 'leaveRoom': {
                    const token = payload.token;
                    const roomCode = payload.roomCode;

                    if (!players[token]) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Joueur non trouvé',
                        }));
                        return;
                    }

                    gameManager.removePlayerFromRoom(token);

                    ws.send(JSON.stringify({
                        type: 'leftRoom',
                        roomCode: roomCode,
                        message: 'Vous avez bien quitté la room',
                    }));

                    return;
                }

                case 'startGame': {
                    const roomCode = payload.roomCode;
                    const maxRounds = payload.maxRounds || 99;
                    const timerDuration = payload.maxTime || 60000;
                    const canEliminatedPlayersVote = payload.canEliminatedPlayersVote || false;
                    const randomizeOrder = payload.randomizeOrder || false;
                    if (roomCode && roomCode != null) {
                        console.log('La partie :', roomCode, 'vient de commencer');
                        gameManager.startGame(roomCode, maxRounds, timerDuration, canEliminatedPlayersVote, randomizeOrder);
                    }
                    return;
                }

                case 'replayGame': {
                    const token = payload.token;
                    const roomCode = payload.roomCode;
                    if (rooms[roomCode] && players[token] && players[token].isMaster) {
                        console.log(`🔄 Recommencer la partie demandé pour la room : ${roomCode}`);
                        gameManager.resetGame(roomCode);
                    }
                    return;
                }

                case 'nextPlayer': {
                    const roomCode = payload.roomCode;
                    if (roomCode && roomCode != null) {
                        console.log('Passage au joueur suivant dans la partie :', roomCode);
                        gameManager.nextTurn(roomCode);
                    }
                    return;
                }

                case 'sendAnswer': {
                    console.log('Validation de la réponse reçue :', payload);
                    const roomCode = payload.roomCode;
                    const timeRemaining = payload.timeRemaining;
                    const token = payload.token;
                    if (roomCode && roomCode != null) {
                        console.log('Validation de la réponse dans la partie :', roomCode);
                        gameManager.validateAnswer(roomCode, token, timeRemaining);
                    }
                    return;
                }

                case 'validateOrNot': {
                    console.log('Réponse reçue :', payload);
                    const roomCode = payload.roomCode;
                    const token = payload.token;
                    const answer = payload.isAnswerOK;

                    if (roomCode && roomCode != null) {
                        console.log('Réponse reçue pour la partie :', roomCode, 'avec la réponse :', answer);
                        gameManager.validateOrNot(roomCode, token, answer);
                    }
                    return;
                }

                case 'timeout': {
                    const roomCode = payload.roomCode;
                    const token = payload.token;

                    gameManager.eliminatePlayer(roomCode, token, 'timeout');
                    return;
                }

                case 'getSuggestedConfig': {
                    const playerCount = payload.playerCount || 4;
                    const config = gameManager.getSuggestedConfig(playerCount);
                    ws.send(JSON.stringify({
                        type: 'suggestedConfig',
                        maxRounds: config.maxRounds,
                        maxTime: config.maxTime,
                        canEliminatedPlayersVote: config.canEliminatedPlayersVote,
                        randomizeOrder: config.randomizeOrder,
                    }));
                    return;
                }

                case 'submitFeedback': {
                    const roomCode = payload.roomCode;
                    const rating = payload.rating;
                    const top = payload.top;
                    const flop = payload.flop;

                    gameManager.recordFeedback(roomCode, rating, top, flop);
                    return;
                }
            }
        });

        // Gestion de la perte de connexion (Période de grâce de 15 secondes)
        const handleCloseOrError = () => {
            if (ws.playerToken && players[ws.playerToken]) {
                const token = ws.playerToken;
                const player = players[token];
                
                console.log(`🔌 Connexion perdue pour ${player.pseudo || token}. Période de grâce de 15s.`);
                
                player.isOffline = true;
                player.ws = null;

                if (player.currentRoom) {
                    gameManager.updateRoomPlayers(player.currentRoom);
                }

                if (player.disconnectTimeout) clearTimeout(player.disconnectTimeout);
                player.disconnectTimeout = setTimeout(() => {
                    if (players[token] && players[token].isOffline) {
                        console.log(`💀 Période de grâce expirée pour ${player.pseudo || token}. Suppression définitive.`);
                        gameManager.removePlayerFromRoom(token);
                        delete players[token];
                    }
                }, 15000);
            }
        };

        // Gestionnaire d'erreur
        ws.on('error', (error) => {
            console.error('❌ Erreur WebSocket:', error.message);
            handleCloseOrError();
        });

        // Gestionnaire de fermeture
        ws.on('close', () => {
            console.log('🔌 Connexion fermée');
            handleCloseOrError();
        });

    });

    startHeartbeat();
}
