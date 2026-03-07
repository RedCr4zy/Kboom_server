// rooms.js
// Structure des données pour rooms et joueurs

export const players = {}; // { token: { ws, pseudo, currentRoom, connectedAt, isMaster } }
export const rooms = {};   // { roomCode: { players: [], createdAt } }
