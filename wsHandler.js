import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { players, rooms } from './rooms.js';
import * as gameManager from './gameManager.js';

let wss = null;
let heartbeatInterval = null;

function startHeartbeat() {
    const INTERVAL_MS = 30000;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (!wss) return;
        wss.clients.forEach(ws => {
            if (ws.isAlive === false) {
                console.log('💀 Terminaison socket mort');

                // Nettoyer le joueur
                if (ws.playerToken && players[ws.playerToken]) {
                    const roomCode = players[ws.playerToken].currentRoom;
                    delete players[ws.playerToken];

                    if (roomCode && rooms[roomCode]) {
                        gameManager.updateRoomPlayers(roomCode);
                    }
                }

                try { ws.terminate(); } catch (e) { }
                return;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch (e) { }
        });
    }, INTERVAL_MS);
}

export function initWebsocket(server) {
    wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        console.log('✅ Nouvelle connexion WebSocket');
        ws.isAlive = true;

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', (msg) => {
            const raw = msg.toString();

            let data;
            try {
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

            console.log('📨 Nouveau message reçu:', payload);

            const effectiveType = payload.type || data.type;
            if (!effectiveType || typeof effectiveType !== 'string') {
                ws.send(JSON.stringify({
                    type: 'erreur',
                    message: 'Payload JSON invalide (il manque le type).'
                }));
                return;
            }

            switch (effectiveType) {
                case 'connection': {
                    const token = payload.token;

                    if (!token || typeof token !== 'string') {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Token invalide'
                        }));
                        return;
                    }

                    ws.playerToken = token;
                    players[token] = {
                        ws,
                        pseudo: null,
                        currentRoom: null,
                        isMaster: false,
                    };

                    console.log('✅ Nouveau joueur avec le token:', token);

                    // Confirmation de connexion
                    ws.send(JSON.stringify({
                        type: 'connectionConfirmed',
                        message: 'Connexion établie'
                    }));

                    return;
                }

                case 'create_room': {
                    const token = payload.token;
                    const pseudo = payload.pseudo;

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

                    players[token].pseudo = pseudo;
                    gameManager.createGame(token);
                    console.log(`🎮 Room créée par ${pseudo}`);

                    return;
                }

                case 'join_room': {
                    const token = payload.token;
                    const pseudo = payload.pseudo;
                    const roomCode = payload.roomCode;

                    if (!token || !pseudo || !roomCode) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Token, pseudo et roomCode requis'
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

                    if (!rooms[roomCode]) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: `La room ${roomCode} n'existe pas`
                        }));
                        return;
                    }

                    players[token].pseudo = pseudo;
                    const success = gameManager.addPlayerToRoom(roomCode, token, false);

                    if (success) {
                        ws.send(JSON.stringify({
                            type: 'roomJoined',
                            roomCode: roomCode,
                            message: `Vous avez rejoint la room ${roomCode}`
                        }));
                        console.log(`✅ ${pseudo} a rejoint la room ${roomCode}`);
                    }

                    return;
                }

                case 'start_game': {
                    const roomCode = payload.roomCode;

                    if (!roomCode || !rooms[roomCode]) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Room introuvable'
                        }));
                        return;
                    }

                    // Vérifier que c'est bien le master qui démarre
                    const token = ws.playerToken;
                    if (!players[token] || !players[token].isMaster) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Seul le maître peut démarrer la partie'
                        }));
                        return;
                    }

                    gameManager.startGame(roomCode);
                    console.log(`🎮 Partie démarrée dans ${roomCode}`);

                    return;
                }

                case 'submit_words': {
                    const { roomCode, token, words, round } = payload;

                    if (!roomCode || !token || !words || !round) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Données incomplètes'
                        }));
                        return;
                    }

                    gameManager.submitWords(roomCode, token, words, round);
                    console.log(`📝 ${players[token]?.pseudo} a soumis ses mots`);

                    return;
                }

                case 'restart_game': {
                    const roomCode = payload.roomCode;

                    if (!roomCode || !rooms[roomCode]) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Room introuvable'
                        }));
                        return;
                    }

                    // Vérifier que c'est bien le master
                    const token = ws.playerToken;
                    if (!players[token] || !players[token].isMaster) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Seul le maître peut relancer la partie'
                        }));
                        return;
                    }

                    gameManager.restartGame(roomCode);
                    console.log(`🔄 Partie relancée dans ${roomCode}`);

                    return;
                }

                case 'leave_room': {
                    const { token, roomCode } = payload;

                    if (!players[token]) {
                        ws.send(JSON.stringify({
                            type: 'erreur',
                            message: 'Joueur non trouvé'
                        }));
                        return;
                    }

                    gameManager.leaveRoom(roomCode, token);

                    ws.send(JSON.stringify({
                        type: 'left_room',
                        roomCode: roomCode,
                        message: 'Vous avez quitté la salle'
                    }));

                    return;
                }

                default:
                    console.log('⚠️ Type de message non géré:', effectiveType);
                    ws.send(JSON.stringify({
                        type: 'erreur',
                        message: `Type de message non reconnu: ${effectiveType}`
                    }));
            }
        });

        // Gestionnaire d'erreur
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

        // Gestionnaire de fermeture
        ws.on('close', () => {
            console.log('🔌 Connexion fermée');
            if (ws.playerToken && players[ws.playerToken]) {
                const roomCode = players[ws.playerToken].currentRoom;
                const pseudo = players[ws.playerToken].pseudo;

                if (roomCode && rooms[roomCode]) {
                    gameManager.leaveRoom(roomCode, ws.playerToken);
                }

                delete players[ws.playerToken];
                console.log(`👋 ${pseudo} déconnecté`);
            }
        });

    });

    startHeartbeat();
    console.log('✅ WebSocket handler initialisé');
}
