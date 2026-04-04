// gameManager.js
import { players, rooms } from './rooms.js';

const possibleLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'M', 'P', 'R', 'S', 'T',];

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
            maxRounds: 10,
            currentRound: 0,
            currentPlayerIndex: 0, // Index du joueur dont c'est le tour
            currentLetter: null,
            playerOrder: [], // Liste ordonnée des tokens des joueurs
            scores: {}, // token -> score
            currentVote: {
                votes: {}
            }, // token -> true/false
            malus: {},
            timerConfig: {
                duration: 60000
            },
            playerTimers: {
                /*totalTimeLeft: null,
                turnStartTimestamp: null,
                isPaused: true,
                isEliminated: false,*/
            }
        }
    };
    console.log(`🔹 Room créée : ${roomCode}`);
    return roomCode;
}

function applyMalusToActivePlayer(room, currentPlayerToken) {
    const roomCode = room;
    console.log(rooms[roomCode].gameState.playerOrder.length);
    if (rooms[roomCode].gameState.playerOrder.length <= 2) {
        console.log("Pas de malus à 2 joueurs")
        return;
    }

    room.gameState.malus[currentPlayerToken].refusedWords++;
    refusedCount = room.gameState.malus[currentPlayerToken].refusedWords;

    if (refusedCount >= 2) {
        room.gameState.malus[currentPlayerToken].totalMalus += 10000;
        pseudo = players[currentPlayerToken]?.pseudo;
        console.log(`⚠️ Malus de 10s pour ${pseudo} (2 mots refusés)`);
    }
    return;
}

function applyMalusToWrongNoVoters(room, currentPlayerToken) {
    const roomCode = room;
    if (rooms[roomCode].gameState.playerOrder.length <= 2) {
        return;
    }

    room.gameState.currentVote.votes.forEach((vote, token) => {
        if (token === currentPlayerToken) {
            return;
        }

        if (vote === false) {
            room.gameState.malus[token].wrongNoVotes++;
            wrongCount = room.gameState;malus[token].wrongNoVotes;

            if (wrongNoVotes >= 2) {
                room.gameState.malus[token].totalMalus += 15000;
                pseudo = players[token]?.pseudo;
                console.log(`⚠️ Malus de 15s pour ${pseudo} (2 votes "non" incorrects)`);
            }
        }
    });
    return;
}

function applyMalusToWrongYesVoters(room, currentPlayerToken) {
    const roomCode = room;
    if (rooms[roomCode].gameState.playerOrder.length <= 2) {
        return;
    }

    room.gameState.currentVote.votes.forEach((vote, token) => {
        if (vote === true) {
            room.gameState.malus[token].wrongYesVotes++;
            wrongCount = rooms.gameState.malus[token].wrongYesVotes;

            if (wrongYesVotess >= 2) {
                room.gameState.malus[token].totalMalus += 15000;
                pseudo = players[token]?.pseudo;
                console.log(`⚠️ Malus de 15s pour ${pseudo} (2 votes "oui" incorrects)`);
            }
        }
    })
}

/*
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
    rooms[roomCode].gameState.playerTimers[playerToken] = {
        totalTimeLeft: null,
        turnStartTimestamp: null,
        isPaused: true,
        isEliminated: false
    };
    rooms[roomCode].gameState.malus[playerToken] = {
        totalMalus: 0,
        refusedWords: 0,
        wrongNoVotes: 0,
        wrongYesVotes: 0,
    };
    
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
export function startGame(roomCode, maxRounds, timerDuration) {
    const room = rooms[roomCode];
    if (!room) return;

    // Initialiser le jeu
    room.gameState.isStarted = true;
    room.gameState.currentRound = 1;
    room.gameState.currentPlayerIndex = 0;
    room.gameState.currentLetter = chooseRandomLetter();
    room.gameState.maxRounds = maxRounds;
    room.gameState.timerConfig.duration = timerDuration;

    // Filtrer les joueurs connectés
    room.players = room.players.filter(p => p.ws.readyState === p.ws.OPEN);
    
    // ✅ CORRECTION : Ne pas recréer playerOrder, juste filtrer pour garder les joueurs connectés
    room.gameState.playerOrder = room.gameState.playerOrder.filter(token => {
        const player = players[token];
        return player && room.players.includes(player);
    });

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];

    console.log(`🎮 Partie démarrée dans la room ${roomCode}`);
    console.log(`🎲 Lettre choisie : ${room.gameState.currentLetter}`);
    console.log(`👤 Premier joueur : ${players[currentPlayerToken]?.pseudo}`);
    console.log(`📋 Ordre de passage :`, room.gameState.playerOrder.map(t => players[t]?.pseudo));

    // Initialiser TOUS les timers AVANT la boucle
    room.gameState.playerOrder.forEach(token => {
        room.gameState.playerOrder.forEach(token => {
            const malusJoueur = room.gameState.malus[token]?.totalMalus || 0;
            let tempsInitial = timerDuration - malusJoueur;

            if (tempsInitial < 0 ) tempsInitial = 0;

            room.gameState.playerTimers[token].totalTimeLeft = tempsInitial;

            if (malusJoueur > 0) {
                const pseudo = players[token]?.pseudo;
                console.log(`⚠️ ${pseudo} commence avec ${tempsInitial}ms (malus de ${malusJoueur}ms)`);
            }
        })
    });

    // Démarrer le timer du joueur actif
    room.gameState.playerTimers[currentPlayerToken].isPaused = false;
    room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp = Date.now();

    // Créer allTimers UNE SEULE FOIS avant la boucle
    const allTimers = Object.entries(room.gameState.playerTimers).map(([token, timerData]) => ({
        token: token,
        pseudo: players[token]?.pseudo,
        totalTimeLeft: timerData.totalTimeLeft,
        isPaused: timerData.isPaused,
        isEliminated: timerData.isEliminated,
        malus: room.gameState.malus[token]?.totalMalus || 0,
    }));

    // Envoyer à tous les joueurs
    room.players.forEach((player) => {
        // Trouver le token du joueur actuel
        const playerToken = room.gameState.playerOrder.find(token => players[token] === player);
        
        if (!playerToken) {
            console.error('Token non trouvé pour', player.pseudo);
            return;
        }

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
                maxRounds: room.gameState.maxRounds,
                timeLeft: room.gameState.playerTimers[playerToken].totalTimeLeft,
                isTimerPaused: room.gameState.playerTimers[playerToken].isPaused,
                timerStartTimestamp: room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp,
                allTimers: allTimers,
                message: 'La partie a commencé',
            }));
        } catch(e) {
            console.error('Erreur startGame pour', player.pseudo, e.message);
        }
    });
}
export function validateAnswer(roomCode, playerToken, timeRemaining) {
    const room = rooms[roomCode];

    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }
    console.log(`✅ Réponse validée pour la room ${roomCode}`);

    const playerTimer = room.gameState.playerTimers[playerToken];
    const marge = 2000;

    // Calul serveur
    let tempsEcoule = Date.now() - playerTimer.turnStartTimestamp;
    let tempsRestantServeur = playerTimer.totalTimeLeft - tempsEcoule;

    if (tempsRestantServeur < 0) {
        tempsRestantServeur = 0;
    }

    // Difference
    let difference = Math.abs(tempsRestantServeur - timeRemaining);
    let tempsRestantFinal;

    // Décision
    if (difference > marge) {
        tempsRestantFinal = tempsRestantServeur;
        console.log(`⚠️ Difference suspecte : client=${timeRemaining}, serveur=${timeRemaining}`);
    }
    else {
        tempsRestantFinal = (tempsRestantServeur + timeRemaining) / 2;
    }

    if (tempsRestantFinal < 0) {
        tempsRestantFinal = 0;
    }

    // Mise à jour
    playerTimer.totalTimeLeft = Math.floor(tempsRestantFinal);
    playerTimer.isPaused = true;
    playerTimer.turnStartTimestamp = null;

    // Reset votes
    room.gameState.currentVote.votes = {};

    // Créer allTimers
    const allTimers = Object.entries(room.gameState.playerTimers).map(([token, timerData]) => ({
        token: token,
        pseudo: players[token]?.pseudo,
        totalTimeLeft: timerData.totalTimeLeft,
        isPaused: timerData.isPaused,
        isEliminated: timerData.isEliminated,
        malus: room.gameState.malus[token]?.totalMalus || 0,
    }));

    // Envoyer à tous les joueurs
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'answerValidated',
                roomCode: roomCode,
                message: 'La réponse a été validée',
                allTimers: allTimers,
            }));
        } catch(e) {
            console.error('Erreur validateAnswer pour', player.pseudo, e.message);
        }
    })
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

    if (totalVotes !== totalPlayers) {
        return;
    }

    if (totalVotes === totalPlayers) {
        // Calculer le score des joueurs
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

        const results = vote_pour - vote_contre;

        console.log(`📊 Résultat du vote pour la room ${roomCode} : ${vote_pour} pour, ${vote_contre} contre (Total : ${results})`);

        const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];

        if (results === 0) {
            console.log(`⚖️ Egalité dans la room ${roomCode} : Aucun malus`)
        }

        if (results > 0) {
            console.log(`✅ La réponse est validée pour la room ${roomCode}`);
            room.gameState.scores[currentPlayerToken] = (room.gameState.scores[currentPlayerToken] || 0) + 1;
            applyMalusToWrongNoVoters(room, currentPlayerToken);
            nextTurn(roomCode);
        }
        else {
            console.log(`❌ La réponse est rejetée pour la room ${roomCode}`);
            applyMalusToActivePlayer(room, currentPlayerToken);
            applyMalusToWrongYesVoters(room, currentPlayerToken);
            replayTurn(roomCode);
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

    if (room.gameState.playerOrder.length === 0) {
        console.log(`🏁 Partie terminée dans la room ${roomCode} (Tous les joueurs éliminés)`);
        finishGame(roomCode);
        return;
    }

    // Passer au joueur suivant
    room.gameState.currentPlayerIndex++;
    
    // Si on a fait le tour de tous les joueurs, nouvelle manche
    
    if (room.gameState.currentPlayerIndex >= room.gameState.playerOrder.length) {
        room.gameState.currentPlayerIndex = 0;
        room.gameState.currentRound++;
    }

    if (room.gameState.currentRound > room.gameState.maxRounds) {
        console.log(`🏁 Partie terminée dans la room ${roomCode}`);
        finishGame(roomCode);
        return;
    }

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
    const currentPlayer = players[currentPlayerToken];

    console.log(`👤 Tour de : ${currentPlayer?.pseudo}`);

    room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp = Date.now();
    room.gameState.playerTimers[currentPlayerToken].isPaused = false;

    // Filtrer les joueurs encore connectés
    room.players = room.players.filter(p => p.ws.readyState === p.ws.OPEN);

    const allTimers = Object.entries(room.gameState.playerTimers).map(([token, timerData]) => ({
        token: token,
        pseudo: players[token]?.pseudo,
        totalTimeLeft: timerData.totalTimeLeft,
        isPaused: timerData.isPaused,
        isEliminated: timerData.isEliminated,
        malus: room.gameState.malus[token]?.totalMalus || 0,
    }));

    // Notifier tous les joueurs
    room.players.forEach((player) => {
        const playerToken = Object.keys(players).find(t => players[t] === player);
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
                timeLeft: room.gameState.playerTimers[playerToken].totalTimeLeft,
                isTimerPaused: room.gameState.playerTimers[playerToken].isPaused,
                timerStartTimestamp: room.gameState.playerTimers[playerToken].turnStartTimestamp,
                allTimers: allTimers,
                message: isCurrentPlayer ? "C'est votre tour !" : `C'est au tour de ${currentPlayer?.pseudo}`,
            }));
        } catch(e) {
            console.error('Erreur nextRound pour', player.pseudo, e.message);
        }
    });
}

export function replayTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
    const currentPlayer = players[currentPlayerToken];

    room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp = Date.now();
    room.gameState.playerTimers[currentPlayerToken].isPaused = false;

    room.players = room.players.filter(p => p.ws.readyState=== p.ws.OPEN);

    const allTimers = Object.entries(room.gameState.playerTimers).map(([token, timerData]) => ({
        token: token,
        pseudo: players[token]?.pseudo,
        totalTimeLeft: timerData.totalTimeLeft,
        isPaused: timerData.isPaused,
        isEliminated: timerData.isEliminated,
        malus: room.gameState.malus[token]?.totalMalus || 0,
    }));

    room.players.forEach((player) => {
        const playerToken = Object.keys(players).find(t => players[t] === player);
        const isCurrentPlayer = playerToken === currentPlayerToken;

        try {
            player.ws.send(JSON.stringify({
                type: 'replayTurn',
                roomCode: roomCode,
                isCurrentPlayer: isCurrentPlayer,
                currentPlayerPseudo: currentPlayer?.pseudo,
                currentPlayerToken: currentPlayerToken,
                playerOrder: room.gameState.playerOrder.map(t => ({
                    token: t,
                    pseudo: players[t]?.pseudo,
                    isCurrent: t === currentPlayerToken
                })),
                timeLeft: room.gameState.playerTimers[playerToken].totalTimeLeft,
                isTimerPaused: room.gameState.playerTimers[playerToken].isPaused,
                timerStartTimestamp: room.gameState.playerTimers[playerToken].turnStartTimestamp,
                allTimers: allTimers,
                message: isCurrentPlayer ? "C'est encore votre tour !" : `Le tour de ${currentPlayer?.pseudo} à refaire`,
            }))
        } catch (e) {
            console.error('Erreur replayTurn pour', player.pseudo, e.message);
        }
    })
}

export function eliminatePlayer(roomCode, playerToken, reason) {
    if (!rooms[roomCode] || !rooms[roomCode].gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    const room = rooms[roomCode];
    const player = players[playerToken];
    const eliminatedPlayerPseudo = player?.pseudo || 'Inconnu';
    const eliminatedPlayerToken = playerToken;
    const wasCurrentPlayer = playerToken === room.gameState.playerOrder[room.gameState.currentPlayerIndex];

    room.gameState.playerTimers[eliminatedPlayerToken].isEliminated = true;
    room.gameState.playerTimers[eliminatedPlayerToken].totalTimeLeft = 0;
    room.gameState.playerTimers[eliminatedPlayerToken].isPaused = true;


    if (room.gameState.playerOrder.length === 0) {
        console.log(`🏁 Partie terminée dans la room ${roomCode} (Tous les joueurs éliminés)`);
        finishGame(roomCode);
        return;
    }
    
    console.log(`👤 ${eliminatedPlayerPseudo} a été éliminé de la room ${roomCode} (Raison : ${reason})`);
    const removedIndex = room.gameState.playerOrder.indexOf(eliminatedPlayerToken);    
    room.gameState.playerOrder = room.gameState.playerOrder.filter(t => t !== eliminatedPlayerToken);

    if (removedIndex < room.gameState.currentPlayerIndex) {
        room.gameState.currentPlayerIndex--;
    }
    if (room.gameState.currentPlayerIndex >= room.gameState.playerOrder.length) {
        room.gameState.currentPlayerIndex = 0;
    }

    const allTimers = Object.entries(room.gameState.playerTimers).map(([token, timerData]) => ({
        token: token,
        pseudo: players[token]?.pseudo,
        totalTimeLeft: timerData.totalTimeLeft,
        isPaused: timerData.isPaused,
        isEliminated: timerData.isEliminated,
        malus: room.gameState.malus[token]?.totalMalus || 0,
    }));

    room.players.forEach((p) => {
        const playerToken = Object.keys(players).find(t => players[t] === p);

        try {
            p.ws.send(JSON.stringify({
                type: 'playerEliminated',
                playerOrder: room.gameState.playerOrder.map(t => ({
                    token: t,
                    pseudo: players[t]?.pseudo || 'Inconnu',
                    isCurrent: t === room.gameState.playerOrder[room.gameState.currentPlayerIndex],
                })),
                allTimers: allTimers,
                playerToken: eliminatedPlayerToken,
                playerPseudo: eliminatedPlayerPseudo,
                message: `Le joueur ${eliminatedPlayerPseudo} a été éliminé. Raison : ${reason}`,
            }))
            console.log(`🔔 Notifié ${p.pseudo} de l'élimination de ${eliminatedPlayerPseudo}`);
            } catch (e) {
                console.error('Erreur eliminatedPlayer pour', p.pseudo, e.message);
            }
        });
    if (wasCurrentPlayer) {
        nextTurn(roomCode);
    }
    return;
}

export function finishGame(roomCode) {
    const room = rooms[roomCode];
    if(!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    room.players.forEach((player) => {
        const playerToken = Object.keys(players).find(t => players[t] === player);

        try {
            player.ws.send(JSON.stringify({
                type: 'finishGame',
                roomCode: roomCode,
                scores: room.gameState.scores,
                yourScore: room.gameState.scores[playerToken],
            }));
        } catch(e) {
            console.error('Erreur finishGame pour', player.pseudo, e.message);
        }
    });

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

        room.players.forEach((p) => {
            const pToken = Object.keys(players).find(t => players[t] === p);
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