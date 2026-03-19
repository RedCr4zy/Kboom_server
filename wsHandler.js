import WebSocket, {WebSocketServer} from 'ws';
import {v4 as uuidv4} from 'uuid';

import {players, rooms} from './rooms.js'
import * as gameManager from './gameManager.js'

let wss = null;
let heartbeatInterval = null;

function startHeartbeat() {
    const INTERVAL_MS = 30000;
    const TIMEOUT_MS = 5000;

    if (heartbeatInterval) clearInterval(heartbeatInterval);

    heartbeatInterval = setInterval(() => {
        if (!wss) return;

        wss.clients.forEach(ws => { // ✅ CORRECTION : client → clients
            if (ws.isAlive === false) {
                console.log('💀 Terminating dead socket');

                //Clear le joueur
                if(ws.playerToken && players[playerToken]) {
                    const roomCode = players[ws.playerToken].currentRoom;
                    delete players[ws.playerToken];

                    if (roomCode && rooms[roomCode]) {
                        updateRoomPlayers(roomCode);
                    }
                }

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

        ws.on('message', (msg) => {
            const raw = msg.toString();

            let data;
            try{
                data = JSON.parse(raw);
            } catch (err) {
                console.log('Message non-JSON reçu (texte brut):', raw);
                if (ws.roomCode && rooms[ws.roomCode]) {
                    broadcast(ws.roomCode, { type: 'message', text: raw });
                } else {
                    ws.send(JSON.stringify({
                        type: 'erreur',
                        message: 'Pas de room associé pour message texte.'
                    }));
                }
                return;
            }

            let payload = data;
            if (data.text && typeof data.text === 'string' && data.text.trim().startsWith('{')) {
                try {
                    payload = JSON.parse(data.text);
                } catch (e) {
                    // ne fait rien
                }
            }

            console.log('Nouveau message reçu : ', payload);

            const effectiveType = payload.type || data.type;
            if (!effectiveType || typeof effectiveType !== 'string') {
                ws.send(JSON.stringify({
                    type: 'erreur',
                    message:'Payload JSON invalide (il manque le type).'
                }));
                return;
            }

            switch (effectiveType) {
                case 'connection': {
                    const token = payload.token;

                    // ✅ VALIDATION
                    if (!token || typeof token !== 'string') {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Token invalide'
                        }));
                        return;
                    }

                    // ✅ AJOUT : Stocker le token sur la websocket pour le heartbeat
                    ws.playerToken = token;

                    players[token] = {
                        ws,
                        pseudo: null,
                        currentRoom: null,
                        connectedAt: Date.now()
                    };

                    console.log('✅ Nouveau joueur avec le token:', token);

                    // ✅ AJOUT : Envoyer une confirmation de connexion au client
                    // Sans ça, le client attend 5 secondes et timeout !
                    ws.send(JSON.stringify({
                        type: 'connectionConfirmed',
                        token: token,
                        message: 'Connexion établie avec succès'
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

                        return;
                    }
                }

                case 'create_room': {
                    const { token, pseudo } = payload;

                    // ✅ VALIDATION
                    if (!token || !pseudo) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Token et pseudo requis'
                        }));
                        return;
                    }

                    if (!players[token]) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Joueur non trouvé'
                        }));
                        return;
                    }

                    console.log('Création de room demandée par le joueur avec le token:', token);

                    players[token].pseudo = pseudo;
                    gameManager.createGame(token);
                    return;
                }


                case 'join_room': {
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
                    gameManager.addPlayerToRoom(roomCode, token, false); // ✅ AJOUT : false pour isMaster
                    return;
                }


                case 'leave_room': {
                    const token = payload.token
                    const roomCode = payload.roomCode

                    if(!players[token]) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Joueur non trouvé',
                        }));
                        return;
                    }

                    if (rooms[roomCode]) {
                        //Retirer le joueur de la room
                        rooms[roomCode].players = rooms[roomCode].players.filter(
                            p => p !== players[token]
                        );

                        players[token].currentRoom = null;

                        //Notifier les autres
                        gameManager.updateRoomPlayers(roomCode);

                        //Si la room est vide, la supprimer
                        if (rooms[roomCode].players.length === 0) {
                            delete rooms[roomCode];
                            console.log(`Room ${roomCode} supprimée (vide)`)
                        }
                    }

                    players[token].ws.send(JSON.stringify({
                        type: 'left_room',
                        roomCode: roomCode,
                        message: 'Vous avez bien quitté la room',
                    }));

                    return;
                }

                case 'start_game': {
                    const roomCode = payload.roomCode;
                    const maxRounds = payload.maxRounds || 2;
                    if (roomCode && roomCode != null) {
                        console.log('La partie :', roomCode, 'vient de commencer');
                        gameManager.startGame(roomCode, maxRounds);
                    }
                }

                case 'next_player': {
                    const roomCode = payload.roomCode;
                    if (roomCode && roomCode != null) {
                        console.log('Passage au joueur suivant dans la partie :', roomCode);
                        gameManager.nextTurn(roomCode);
                    }
                    return;
                }

                case 'send_answer': {
                    console.log('Validation de la réponse reçue :', payload);
                    const roomCode = payload.roomCode;
                    if (roomCode && roomCode != null) {
                        console.log('Validation de la réponse dans la partie :', roomCode);
                        gameManager.validateAnswer(roomCode);
                    }
                    return;
                }

                case 'validate_or_not': {
                    console.log('Réponse reçue :', payload);
                    const roomCode = payload.roomCode;
                    const token = payload.token;
                    const answer = payload.isAnswerOK;

                    if (roomCode && roomCode != null) {
                        console.log('Réponse reçue pour la partie :', roomCode, 'avec la réponse :', answer);
                        gameManager.validateOrNot(roomCode, token, answer);
                    }
                }
            }
        });

        // ✅ AJOUT : Gestionnaire d'erreur
        ws.on('error', (error) => {
            console.error('❌ Erreur WebSocket:', error.message);
            if (ws.playerToken && players[ws.playerToken]) {
                const roomCode = players[ws.playerToken].currentRoom;
                delete players[ws.playerToken];

                if (roomCode && rooms[roomCode]) {
                    gameManager.updateRoomPlayers(roomCode);
                }
            }
        });

        // ✅ AJOUT : Gestionnaire de fermeture
        ws.on('close', () => {
            console.log('🔌 Connexion fermée');
            if (ws.playerToken && players[ws.playerToken]) {
                const roomCode = players[ws.playerToken].currentRoom;
                delete players[ws.playerToken];

                if (roomCode && rooms[roomCode]) {
                    gameManager.updateRoomPlayers(roomCode);
                }
            }
        });

    });

    startHeartbeat();
}
