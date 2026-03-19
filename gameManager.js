// gameManager.js
import { players, rooms } from './rooms.js';

const possibleLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V'];

function arrayRandom(a) {
  return a[Math.floor(Math.random() * a.length)];
}

/**
 * Génère un code de room unique à 4 chiffres
 */
function generateRoom() {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomCode] = { 
        players: [], 
        createdAt: Date.now(),
        // ✅ AJOUT : État du jeu
        gameState: {
            isStarted: false,
            currentRound: 0,
            currentPlayerIndex: 0, // Index du joueur dont c'est le tour
            currentLetter: null,
            playerOrder: [], // Liste ordonnée des tokens des joueurs
            scores: {}, // token -> score
            currentVote: {
                votes: {}
            } // token -> true/false
        }
    };
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
    
    // ✅ AJOUT : Ajouter le joueur à l'ordre de passage
    rooms[roomCode].gameState.playerOrder.push(playerToken);
    rooms[roomCode].gameState.scores[playerToken] = 0;
    
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

    // Initialiser le jeu
    room.gameState.isStarted = true;
    room.gameState.currentRound = 1;
    room.gameState.currentPlayerIndex = 0;
    room.gameState.currentLetter = chooseRandomLetter();

    // Filtrer les joueurs connectés et mettre à jour l'ordre
    room.players = room.players.filter(p => p.ws.readyState === p.ws.OPEN);
    room.gameState.playerOrder = room.players.map((_, index) => {
        const token = Object.keys(players).find(t => players[t] === room.players[index]);
        return token;
    }).filter(Boolean);

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];

    console.log(`🎮 Partie démarrée dans la room ${roomCode}`);
    console.log(`🎲 Lettre choisie : ${room.gameState.currentLetter}`);
    console.log(`👤 Premier joueur : ${players[currentPlayerToken]?.pseudo}`);
    console.log(`📋 Ordre de passage :`, room.gameState.playerOrder.map(t => players[t]?.pseudo));

    // Envoyer à tous les joueurs
    room.players.forEach((player, index) => {
        const playerToken = room.gameState.playerOrder[index];
        const isCurrentPlayer = playerToken === currentPlayerToken;

        try {
            player.ws.send(JSON.stringify({
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
                message: 'La partie a commencé',
            }));
        } catch(e) {
            console.error('Erreur startGame pour', player.pseudo, e.message);
        }
    });
}

export function validateAnswer(roomCode) {
    const room = rooms[roomCode];

    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }
    console.log(`✅ Réponse validée pour la room ${roomCode}`);

    room.gameState.currentVote.votes = {}; // Réinitialiser les votes

    // Notifier tous les joueurs
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'answerValidated',
                roomCode: roomCode,
                message: 'La réponse a été validée'
            }));
        } catch(e) {
            console.error('Erreur validateAnswer pour', player.pseudo, e.message);
        }
    });
}

export function validateOrNot(roomCode, playerToken, answer) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    console.log(`✅ Vote reçu pour la room ${roomCode} : ${players[playerToken]?.pseudo} a voté ${answer}`);

    // Enregistrer le vote
    room.gameState.currentVote.votes[playerToken] = answer;

    // Vérifier si tous les joueurs ont voté
    const totalPlayers = room.gameState.playerOrder.length;
    const totalVotes = Object.keys(room.gameState.currentVote.votes).length;

    if (totalVotes === totalPlayers) {
        // Calculer le score des joueurs
        /*const scores = room.gameState.playerOrder.map(t => {
            const votes = room.gameState.currentVote.votes;
            let vote_pour = 0;
            let vote_contre = 0;

            Object.values(votes).forEach(vote => {
                if (vote === true) {
                    vote_pour++;
                } else {
                    vote_contre++;
                }
            });

            const pourcentage = (vote_pour / totalVotes) * 100;
        )*/

        let vote_pour = 0;
        let vote_contre = 0;

        Object.values(room.gameState.currentVote.votes).forEach(vote => {
            if (vote === true) {
                vote_pour++;
            }
            else {
                vote_contre++;
            }
        });

        const pourcentage = (vote_pour / vote_contre) * 100;

        console.log(`📊 Résultat du vote pour la room ${roomCode} : ${vote_pour} pour, ${vote_contre} contre (${pourcentage.toFixed(2)}%)`);

        if (pourcentage >= 50) {
            console.log(`✅ La réponse est validée pour la room ${roomCode}`);
            nextTurn(roomCode);
        }
    }
}


/**
 * ✅ NOUVELLE FONCTION : Passer au tour suivant
 * @param {string} roomCode - Code de la room
 */
export function nextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    // Passer au joueur suivant
    room.gameState.currentPlayerIndex++;
    
    // Si on a fait le tour de tous les joueurs, nouvelle manche
    
    /*if (room.gameState.currentPlayerIndex >= room.gameState.playerOrder.length) {
        room.gameState.currentPlayerIndex = 0;
        room.gameState.currentRound++;
        room.gameState.currentLetter = chooseRandomLetter();
        console.log(`🔄 Nouvelle manche ${room.gameState.currentRound} - Lettre : ${room.gameState.currentLetter}`);
    }*/

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
    const currentPlayer = players[currentPlayerToken];

    console.log(`👤 Tour de : ${currentPlayer?.pseudo}`);

    // Filtrer les joueurs encore connectés
    room.players = room.players.filter(p => p.ws.readyState === p.ws.OPEN);

    // Notifier tous les joueurs
    room.players.forEach((player, index) => {
        const playerToken = room.gameState.playerOrder[index];
        const isCurrentPlayer = playerToken === currentPlayerToken;

        try {
            player.ws.send(JSON.stringify({
                type: 'nextTurn',
                roomCode: roomCode,
                letter: room.gameState.currentLetter,
                round: room.gameState.currentRound,
                isCurrentPlayer: isCurrentPlayer,
                currentPlayerPseudo: currentPlayer?.pseudo,
                currentPlayerToken: currentPlayerToken,
                playerOrder: room.gameState.playerOrder.map(t => ({
                    token: t,
                    pseudo: players[t]?.pseudo,
                    isCurrent: t === currentPlayerToken
                })),
                message: isCurrentPlayer ? "C'est votre tour !" : `C'est au tour de ${currentPlayer?.pseudo}`,
            }));
        } catch(e) {
            console.error('Erreur nextRound pour', player.pseudo, e.message);
        }
    });
}

/**
 * ✅ NOUVELLE FONCTION : Le joueur actuel termine son tour
 * @param {string} roomCode - Code de la room
 * @param {string} playerToken - Token du joueur qui termine
 */
export function endCurrentTurn(roomCode, playerToken) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
    
    // Vérifier que c'est bien le tour du joueur
    if (playerToken !== currentPlayerToken) {
        console.log(`⚠️ Ce n'est pas le tour de ${players[playerToken]?.pseudo}`);
        return;
    }

    console.log(`✅ ${players[playerToken]?.pseudo} termine son tour`);
    
    // Passer au tour suivant
    nextRound(roomCode);
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

    // Retirer le joueur de l'ordre de passage
    room.gameState.playerOrder = room.gameState.playerOrder.filter(t => t !== playerToken);

    // Ajuster l'index du joueur actuel si nécessaire
    if (room.gameState.isStarted && room.gameState.currentPlayerIndex >= room.gameState.playerOrder.length) {
        room.gameState.currentPlayerIndex = 0;
    }

    // Retirer le joueur
    room.players = room.players.filter(p => p !== player);
    player.currentRoom = null;
    player.isMaster = false;

    console.log(`👋 ${player.pseudo} a quitté la room ${roomCode}`);

    // Si master a quitté, donner le rôle au premier joueur restant
    const masterStillHere = room.players.some(p => p.isMaster);
    if (!masterStillHere && room.players.length > 0) {
        room.players[0].isMaster = true;
        try { room.players[0].ws.send(JSON.stringify({ type: 'master', master: true })); } catch(e) {}
        console.log(`🔑 Nouveau master : ${room.players[0].pseudo} dans la room ${roomCode}`);
    }

    // Mettre à jour la liste côté clients
    updateRoomPlayers(roomCode);

    // Si la partie est en cours, notifier le changement de tour
    if (room.gameState.isStarted && room.players.length > 0) {
        const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
        const currentPlayer = players[currentPlayerToken];

        room.players.forEach((p, index) => {
            const pToken = room.gameState.playerOrder[index];
            try {
                p.ws.send(JSON.stringify({
                    type: 'playerLeft',
                    leftPlayer: player.pseudo,
                    currentPlayerPseudo: currentPlayer?.pseudo,
                    isCurrentPlayer: pToken === currentPlayerToken,
                }));
            } catch(e) {}
        });
    }

    // Supprimer la room si vide
    if (room.players.length === 0) {
        delete rooms[roomCode];
        console.log(`🗑️ Room ${roomCode} supprimée (vide)`);
    }
}

/**
 * Choisit une lettre aléatoire
 */
export function chooseRandomLetter() {
    const choosenLetter = arrayRandom(possibleLetters);
    console.log(`🎲 Lettre choisie : ${choosenLetter}`);
    return choosenLetter;
}

/**
 * ✅ NOUVELLE FONCTION : Obtenir l'état actuel de la partie
 * @param {string} roomCode - Code de la room
 */
export function getGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return null;

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];

    return {
        isStarted: room.gameState.isStarted,
        currentRound: room.gameState.currentRound,
        currentLetter: room.gameState.currentLetter,
        currentPlayerPseudo: players[currentPlayerToken]?.pseudo,
        currentPlayerToken: currentPlayerToken,
        playerOrder: room.gameState.playerOrder.map(t => ({
            token: t,
            pseudo: players[t]?.pseudo,
            score: room.gameState.scores[t] || 0
        })),
    };
}