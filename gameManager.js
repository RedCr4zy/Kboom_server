// gameManager.js
import { players, rooms } from './rooms.js';

const possibleLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function arrayRandom(a) {
  return a[Math.floor(Math.random() * a.length)];
}

/**
 * Génère un code de room unique à 4 chiffres
 */
function generateRoom() {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomCode] = { players: [], createdAt: Date.now() };
    console.log(`🔹 Room créée : ${roomCode}`);
    return roomCode;
}

/**
 * Ajoute un joueur à une room
 */
export function addPlayerToRoom(roomCode, playerToken, isMaster = false) {
    if (!rooms[roomCode] || !players[playerToken]) return false;

    const player = players[playerToken];
    player.isMaster = isMaster;
    player.currentRoom = roomCode;

    if (isMaster) {
        try { player.ws.send(JSON.stringify({ type: 'master', master: true })); } catch(e) {}
        console.log(`🔑 ${player.pseudo} devient master de la room ${roomCode}`);
    }

    rooms[roomCode].players.push(player);
    console.log(`✅ Joueur ${player.pseudo} ajouté à la room ${roomCode}`);

    updateRoomPlayers(roomCode);
    return true;
}

/**
 * Crée une partie et désigne le créateur comme master
 */
export function createGame(playerToken) {
    const roomCode = generateRoom();
    addPlayerToRoom(roomCode, playerToken, true);
    return roomCode;
}

/**
 * Met à jour la liste des joueurs côté clients
 */
export function updateRoomPlayers(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // Filtrer les joueurs déconnectés
    room.players = room.players.filter(p => p.ws.readyState === p.ws.OPEN);

    const playerList = room.players.map(p => ({
        pseudo: p.pseudo,
        isReady: p.isReady || false,
        isMaster: p.isMaster || false
    }));

    // Envoyer à tous les joueurs
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'updatePlayers',
                players: playerList,
                roomCode: roomCode
            }));
        } catch(e) {
            console.error('Erreur updateRoomPlayers pour', player.pseudo, e.message);
        }
    });

    console.log(`🔄 Room ${roomCode} mise à jour :`, playerList);
}

/**
 * Démarre la partie et notifie tous les joueurs
 */
export function startGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const letter = chooseRandomLetter();

    room.players = room.players.filter(p => p.ws.readyState === p.ws.OPEN);

    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'gameStarted',
                roomCode: roomCode,
                letter: letter,
                message: 'La partie a commencé'
            }));
        } catch(e) {
            console.error('Erreur startGame pour', player.pseudo, e.message);
        }
    });

    console.log(`🎮 Partie démarrée dans la room ${roomCode}`);
    console.log(`🎲 Lettre choisie : ${letter}`);
}

/**
 * Retire un joueur d'une room
 */
export function removePlayerFromRoom(playerToken) {
    const player = players[playerToken];
    if (!player || !player.currentRoom) return;

    const roomCode = player.currentRoom;
    const room = rooms[roomCode];
    if (!room) return;

    // Retirer le joueur
    room.players = room.players.filter(p => p !== player);
    player.currentRoom = null;
    player.isMaster = false;

    // Si master a quitté, donner le rôle au premier joueur restant
    const masterStillHere = room.players.some(p => p.isMaster);
    if (!masterStillHere && room.players.length > 0) {
        room.players[0].isMaster = true;
        try { room.players[0].ws.send(JSON.stringify({ type: 'master', master: true })); } catch(e) {}
        console.log(`🔑 Nouveau master : ${room.players[0].pseudo} dans la room ${roomCode}`);
    }

    // Mettre à jour la liste côté clients
    updateRoomPlayers(roomCode);

    // Supprimer la room si vide
    if (room.players.length === 0) {
        delete rooms[roomCode];
        console.log(`🗑️ Room ${roomCode} supprimée (vide)`);
    }
}

export function chooseRandomLetter() {
    const choosenLetter = arrayRandom(possibleLetters);
    console.log(choosenLetter);

    return choosenLetter;
}
