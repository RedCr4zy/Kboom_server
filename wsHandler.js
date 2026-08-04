import WebSocket, { WebSocketServer } from 'ws';

import { players, rooms } from './rooms.js';
import * as gameManager from './gameManager.js';
import { verifyToken } from './authService.js';

let wss = null;
let heartbeatInterval = null;
const MAX_MESSAGE_SIZE = 16 * 1024;
const GUEST_TOKEN = /^guest_[a-f0-9]{32,128}$/i;

function send(ws, type, message, extra = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, message, ...extra }));
}

function isMaster(token, roomCode) {
  return players[token]?.currentRoom === roomCode && players[token]?.isMaster === true;
}

function isRoomMember(token, roomCode) {
  return Boolean(roomCode && players[token]?.currentRoom === roomCode && rooms[roomCode]);
}

function safePseudo(value) {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 24
    ? value.trim()
    : null;
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    wss?.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
}

async function authenticate(ws, token) {
  if (typeof token !== 'string' || token.length > 4096) return null;

  if (token.includes('.')) {
    const user = await verifyToken(token);
    if (!user?.id || !safePseudo(user.pseudo)) return null;
    return { token, pseudo: user.pseudo, userId: user.id, isPremium: user.isPremium === true };
  }

  if (!GUEST_TOKEN.test(token)) return null;
  return { token, pseudo: null, userId: null, isPremium: false };
}

export function initWebsocket(server) {
  wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_SIZE });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (message) => {
      if (message.length > MAX_MESSAGE_SIZE) return ws.close(1009, 'Message trop volumineux');

      let payload;
      try { payload = JSON.parse(message.toString()); } catch { return send(ws, 'error', 'Payload JSON invalide.'); }
      if (!payload || typeof payload.type !== 'string') return send(ws, 'error', 'Type de message invalide.');

      if (payload.type === 'connection') {
        if (ws.playerToken) return send(ws, 'error', 'Socket déjà authentifiée.');
        const identity = await authenticate(ws, payload.token);
        if (!identity) return send(ws, 'error', 'Jeton invalide ou expiré.');

        const previous = players[identity.token];
        if (previous && !previous.isOffline) return send(ws, 'error', 'Cette session est déjà active.');

        ws.playerToken = identity.token;
        if (previous) {
          clearTimeout(previous.disconnectTimeout);
          previous.ws = ws;
          previous.isOffline = false;
          previous.disconnectTimeout = null;
          send(ws, 'connectionConfirmed', 'Connexion rétablie', { pseudo: previous.pseudo, isPremium: previous.isPremium });
          if (previous.currentRoom) gameManager.updateRoomPlayers(previous.currentRoom);
          return;
        }

        players[identity.token] = {
          ws, pseudo: identity.pseudo, currentRoom: null, connectedAt: Date.now(), isOffline: false,
          disconnectTimeout: null, userId: identity.userId, isPremium: identity.isPremium, isMaster: false,
          avatarData: payload.avatarData || { colorHex: '#FF5733', hatId: '', eyesId: '', mouthId: '' },
        };
        return send(ws, 'connectionConfirmed', 'Connexion établie', { pseudo: identity.pseudo, isPremium: identity.isPremium });
      }

      const token = ws.playerToken;
      if (!token || !players[token]) return send(ws, 'error', 'Authentification requise.');
      const player = players[token];

      switch (payload.type) {
        case 'update': {
          const pseudo = player.userId ? player.pseudo : safePseudo(payload.pseudo);
          if (!pseudo) return send(ws, 'error', 'Pseudo invalide.');
          player.pseudo = pseudo;
          if (payload.avatarData) {
            player.avatarData = payload.avatarData;
          }
          if (player.currentRoom) gameManager.updateRoomPlayers(player.currentRoom);
          return;
        }
        case 'createRoom': {
          const pseudo = player.userId ? player.pseudo : safePseudo(payload.pseudo);
          if (!pseudo) return send(ws, 'error', 'Pseudo requis (2 à 24 caractères).');
          if (player.currentRoom) return send(ws, 'error', 'Quittez votre salle actuelle avant d’en créer une autre.');
          player.pseudo = pseudo;
          if (payload.avatarData) {
            player.avatarData = payload.avatarData;
          }
          const roomCode = gameManager.createGame(token);
          const room = rooms[roomCode];
          if (room) {
            if (Number.isInteger(payload.maxTime) && payload.maxTime >= 15000 && payload.maxTime <= 300000) room.gameState.timerConfig.duration = payload.maxTime;
            if (typeof payload.canEliminatedPlayersVote === 'boolean') room.gameState.canEliminatedPlayersVote = payload.canEliminatedPlayersVote;
            if (typeof payload.randomizeOrder === 'boolean') room.gameState.randomizeOrder = payload.randomizeOrder;
            if (typeof payload.useAiConfig === 'boolean') room.gameState.useAiConfig = payload.useAiConfig;
            gameManager.updateRoomPlayers(roomCode);
          }
          return;
        }
        case 'joinRoom': {
          const roomCode = String(payload.roomCode || '');
          const pseudo = player.userId ? player.pseudo : safePseudo(payload.pseudo);
          if (!pseudo || !rooms[roomCode] || rooms[roomCode].gameState.isStarted || player.currentRoom) return send(ws, 'error', 'Impossible de rejoindre cette salle.');
          player.pseudo = pseudo;
          if (payload.avatarData) {
            player.avatarData = payload.avatarData;
          }
          if (!gameManager.addPlayerToRoom(roomCode, token, false)) return send(ws, 'error', 'Impossible de rejoindre cette salle.');
          return send(ws, 'roomJoined', `Bienvenue ${pseudo}`, { roomCode });
        }
        case 'leaveRoom': {
          if (!player.currentRoom) return send(ws, 'error', 'Vous n’êtes dans aucune salle.');
          const roomCode = player.currentRoom;
          gameManager.removePlayerFromRoom(token);
          return send(ws, 'leftRoom', 'Vous avez quitté la salle.', { roomCode });
        }
        case 'updateRoomConfig': {
          const roomCode = String(payload.roomCode || '');
          if (!isMaster(token, roomCode) || rooms[roomCode].gameState.isStarted) return send(ws, 'error', 'Action réservée au maître de salle.');
          const room = rooms[roomCode];
          if (Number.isInteger(payload.maxTime) && payload.maxTime >= 15000 && payload.maxTime <= 300000) room.gameState.timerConfig.duration = payload.maxTime;
          if (typeof payload.canEliminatedPlayersVote === 'boolean') room.gameState.canEliminatedPlayersVote = payload.canEliminatedPlayersVote;
          if (typeof payload.randomizeOrder === 'boolean') room.gameState.randomizeOrder = payload.randomizeOrder;
          if (typeof payload.useAiConfig === 'boolean') room.gameState.useAiConfig = payload.useAiConfig;
          return gameManager.updateRoomPlayers(roomCode);
        }
        case 'setReady': {
          const roomCode = String(payload.roomCode || '');
          if (!isRoomMember(token, roomCode) || !gameManager.setPlayerReady(roomCode, token, payload.isReady)) return send(ws, 'error', 'Impossible de modifier l’état prêt.');
          return;
        }
        case 'startGame': {
          const roomCode = String(payload.roomCode || '');
          if (!isMaster(token, roomCode)) return send(ws, 'error', 'Action réservée au maître de salle.');
          const duration = Number.isInteger(payload.maxTime) && payload.maxTime >= 15000 && payload.maxTime <= 300000 ? payload.maxTime : rooms[roomCode].gameState.timerConfig.duration;
          const room = rooms[roomCode];
          return gameManager.startGame(roomCode, duration, room.gameState.canEliminatedPlayersVote, room.gameState.randomizeOrder, room.gameState.useAiConfig);
        }
        case 'replayGame': {
          const roomCode = String(payload.roomCode || '');
          if (!isMaster(token, roomCode)) return send(ws, 'error', 'Action réservée au maître de salle.');
          return gameManager.resetGame(roomCode);
        }
        case 'sendAnswer': {
          const roomCode = String(payload.roomCode || '');
          const room = rooms[roomCode];
          if (!isRoomMember(token, roomCode) || room.gameState.playerOrder[room.gameState.currentPlayerIndex] !== token) return send(ws, 'error', 'Ce n’est pas votre tour.');
          return gameManager.validateAnswer(roomCode, token, payload.timeRemaining);
        }
        case 'validateOrNot': {
          const roomCode = String(payload.roomCode || '');
          if (!isRoomMember(token, roomCode) || typeof payload.isAnswerOK !== 'boolean') return send(ws, 'error', 'Vote invalide.');
          return gameManager.validateOrNot(roomCode, token, payload.isAnswerOK);
        }
        case 'timeout': {
          const roomCode = String(payload.roomCode || '');
          const room = rooms[roomCode];
          if (!isRoomMember(token, roomCode) || room.gameState.playerOrder[room.gameState.currentPlayerIndex] !== token) return send(ws, 'error', 'Expiration invalide.');
          return gameManager.eliminatePlayer(roomCode, token, 'timeout');
        }
        case 'getSuggestedConfig': {
          const config = gameManager.getSuggestedConfig(Number.isInteger(payload.playerCount) ? payload.playerCount : 4);
          return send(ws, 'suggestedConfig', undefined, config);
        }
        case 'submitFeedback': {
          const roomCode = String(payload.roomCode || '');
          if (!isRoomMember(token, roomCode)) return send(ws, 'error', 'Salle invalide.');
          return gameManager.recordFeedback(roomCode, payload.rating, payload.top, payload.flop);
        }
        default:
          return send(ws, 'error', 'Type de message inconnu.');
      }
    });

    const disconnect = () => {
      const token = ws.playerToken;
      const player = token && players[token];
      if (!player || player.ws !== ws) return;
      player.isOffline = true;
      player.ws = null;
      if (player.currentRoom) gameManager.updateRoomPlayers(player.currentRoom);
      clearTimeout(player.disconnectTimeout);
      player.disconnectTimeout = setTimeout(() => {
        if (players[token]?.isOffline) {
          gameManager.removePlayerFromRoom(token);
          delete players[token];
        }
      }, 15000);
    };
    ws.on('error', disconnect);
    ws.on('close', disconnect);
  });
  startHeartbeat();
}
