import { players, rooms } from './rooms.js';
import fs from 'fs';
import path from 'path';

const possibleLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'M', 'P', 'R', 'S', 'T',];

function arrayRandom(a) {
  return a[Math.floor(Math.random() * a.length)];
}

// =======================
// ROOM GENERATION
// =======================
function generateRoom() {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomCode] = { 
        players: [], 
        createdAt: Date.now(),
        gameState: {
            isStarted: false,
            maxRounds: 10,
            currentRound: 0,
            currentPlayerIndex: 0,
            currentLetter: null,
            canEliminatedPlayersVote: false,
            playerOrder: [],
            scores: {},
            currentVote: {
                votes: {}
            },
            malus: {},
            timerConfig: {
                duration: 60000
            },
            playerTimers: {},
            playerWhoAlreadyVote: [],
        }
    };
    console.log(`🔹 Room créée : ${roomCode}`);
    return roomCode;
}

// =======================
// MALUS LOGIC & BROADCAST
// =======================
function broadcastMalus(room, token, seconds, reason) {
    const playerTimer = room.gameState.playerTimers[token];
    let isNowEliminated = false;
    if (playerTimer) {
        playerTimer.totalTimeLeft -= (seconds * 1000);
        if (playerTimer.totalTimeLeft <= 0) {
            playerTimer.totalTimeLeft = 0;
            isNowEliminated = true;
        }
    }

    const pseudo = players[token]?.pseudo || 'Inconnu';
    const allTimers = createAllTimersList(room);

    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === player.ws.OPEN) {
            try {
                player.ws.send(JSON.stringify({
                    type: 'malusApplied',
                    pseudo: pseudo,
                    seconds: seconds,
                    reason: reason,
                    allTimers: allTimers,
                }));
            } catch(e) {}
        }
    });

    if (isNowEliminated) {
        const roomCode = Object.keys(rooms).find(code => rooms[code] === room);
        if (roomCode) {
            eliminatePlayer(roomCode, token, "Temps écoulé (Malus)");
        }
    }
}

function applyMalusToActivePlayer(room, currentPlayerToken) {
    if (room.gameState.playerOrder.length <= 2) {
        console.log("Pas de malus à 2 joueurs");
        return;
    }

    room.gameState.malus[currentPlayerToken].refusedWords++;
    let refusedCount = room.gameState.malus[currentPlayerToken].refusedWords;

    if (refusedCount >= 2) {
        room.gameState.malus[currentPlayerToken].totalMalus += 10000;
        console.log(`⚠️ Malus de 10s pour ${players[currentPlayerToken]?.pseudo} (2 mots refusés)`);
        broadcastMalus(room, currentPlayerToken, 10, "2 mots refusés");
    }
    return;
}

function applyMalusToWrongNoVoters(room, currentPlayerToken) {
    if (room.gameState.playerOrder.length <= 2) {
        return;
    }

    Object.entries(room.gameState.currentVote.votes).forEach(([token, vote]) => {
        if (token === currentPlayerToken) {
            return;
        }

        if (vote === false) {
            room.gameState.malus[token].wrongNoVotes++;
            let wrongCount = room.gameState.malus[token].wrongNoVotes;

            if (wrongCount >= 2) {
                room.gameState.malus[token].totalMalus += 15000;
                console.log(`⚠️ Malus de 15s pour ${players[token]?.pseudo} (2 votes "non" incorrects)`);
                broadcastMalus(room, token, 15, '2 votes "non" incorrects');
            }
        }
    });
    return;
}

function applyMalusToWrongYesVoters(room, currentPlayerToken) {
    if (room.gameState.playerOrder.length <= 2) {
        return;
    }

    Object.entries(room.gameState.currentVote.votes).forEach(([token, vote]) => {
        if (token === currentPlayerToken) {
            return;
        }
        if (vote === true) {
            room.gameState.malus[token].wrongYesVotes++;
            let wrongCount = room.gameState.malus[token].wrongYesVotes;

            if (wrongCount >= 2) {
                room.gameState.malus[token].totalMalus += 15000;
                console.log(`⚠️ Malus de 15s pour ${players[token]?.pseudo} (2 votes "oui" incorrects)`);
                broadcastMalus(room, token, 15, '2 votes "oui" incorrects');
            }
        }
    });
}

// =======================
// PLAYER ROOM MANAGEMENT
// =======================
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

export function createGame(playerToken) {
    const roomCode = generateRoom();
    addPlayerToRoom(roomCode, playerToken, true);
    return roomCode;
}

export function updateRoomPlayers(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const playerList = room.players.map(p => ({
        pseudo: p.pseudo,
        isReady: p.isReady || false,
        isMaster: p.isMaster || false,
        isOffline: p.isOffline || false
    }));

    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === player.ws.OPEN) {
            try {
                player.ws.send(JSON.stringify({
                    type: 'updatePlayers',
                    players: playerList,
                    roomCode: roomCode,
                    maxRounds: room.gameState.maxRounds,
                    maxTime: room.gameState.timerConfig.duration,
                    canEliminatedPlayersVote: room.gameState.canEliminatedPlayersVote,
                    randomizeOrder: room.gameState.randomizeOrder
                }));
            } catch(e) {
                console.error('Erreur updateRoomPlayers pour', player.pseudo, e.message);
            }
        }
    });

    console.log(`🔄 Room ${roomCode} mise à jour :`, playerList);
}

// =======================
// HELPERS FOR TIMERS LIST
// =======================
function createAllTimersList(room) {
    return room.gameState.playerOrder.map(token => {
        const timerData = room.gameState.playerTimers[token];
        return {
            token: token,
            pseudo: players[token]?.pseudo,
            totalTimeLeft: timerData ? timerData.totalTimeLeft : 0,
            isPaused: timerData ? timerData.isPaused : true,
            isEliminated: timerData ? timerData.isEliminated : false,
            malus: room.gameState.malus[token]?.totalMalus || 0,
            score: room.gameState.scores[token] || 0,
        };
    });
}

// =======================
// GAME FLOW METHODS
// =======================
export function startGame(roomCode, maxRounds, timerDuration, canEliminatedPlayersVote, randomizeOrder = false) {
    const room = rooms[roomCode];
    if (!room) return;

    room.gameState.isStarted = true;
    room.gameState.currentRound = 1;
    room.gameState.currentPlayerIndex = 0;
    room.gameState.currentLetter = chooseRandomLetter();
    room.gameState.maxRounds = maxRounds;
    room.gameState.timerConfig.duration = timerDuration;
    room.gameState.canEliminatedPlayersVote = canEliminatedPlayersVote;
    room.gameState.randomizeOrder = randomizeOrder;
    
    room.gameState.playerOrder = room.gameState.playerOrder.filter(token => {
        const player = players[token];
        return player && room.players.includes(player);
    });

    if (randomizeOrder) {
        // Mélange Fisher-Yates
        for (let i = room.gameState.playerOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [room.gameState.playerOrder[i], room.gameState.playerOrder[j]] = [room.gameState.playerOrder[j], room.gameState.playerOrder[i]];
        }
    }

    const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];

    console.log(`🎮 Partie démarrée dans la room ${roomCode}`);
    console.log(`🎲 Lettre choisie : ${room.gameState.currentLetter}`);
    console.log(`👤 Premier joueur : ${players[currentPlayerToken]?.pseudo}`);
    console.log(`📋 Ordre de passage :`, room.gameState.playerOrder.map(t => players[t]?.pseudo));

    room.gameState.playerOrder.forEach(token => {
        const malusJoueur = room.gameState.malus[token]?.totalMalus || 0;
        let tempsInitial = timerDuration - malusJoueur;

        if (tempsInitial < 0 ) tempsInitial = 0;

        room.gameState.playerTimers[token].totalTimeLeft = tempsInitial;

        if (malusJoueur > 0) {
            const pseudo = players[token]?.pseudo;
            console.log(`⚠️ ${pseudo} commence avec ${tempsInitial}ms (malus de ${malusJoueur}ms)`);
        }
    });

    room.gameState.playerTimers[currentPlayerToken].isPaused = false;
    room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp = Date.now();

    const allTimers = createAllTimersList(room);

    room.players.forEach((player) => {
        const playerToken = room.gameState.playerOrder.find(token => players[token] === player);
        if (!playerToken) return;

        const isCurrentPlayer = playerToken === currentPlayerToken;
        if (player.ws && player.ws.readyState === player.ws.OPEN) {
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

    let tempsEcoule = Date.now() - playerTimer.turnStartTimestamp;
    let tempsRestantServeur = playerTimer.totalTimeLeft - tempsEcoule;

    if (tempsRestantServeur < 0) {
        tempsRestantServeur = 0;
    }

    let difference = Math.abs(tempsRestantServeur - timeRemaining);
    let tempsRestantFinal;

    if (difference > marge) {
        tempsRestantFinal = tempsRestantServeur;
        console.log(`⚠️ Difference suspecte : client=${timeRemaining}, serveur=${timeRemaining}`);
    } else {
        tempsRestantFinal = (tempsRestantServeur + timeRemaining) / 2;
    }

    if (tempsRestantFinal < 0) {
        tempsRestantFinal = 0;
    }

    playerTimer.totalTimeLeft = Math.floor(tempsRestantFinal);
    playerTimer.isPaused = true;
    playerTimer.turnStartTimestamp = null;

    room.gameState.currentVote.votes = {};
    room.gameState.playerWhoAlreadyVote = [];

    const allTimers = createAllTimersList(room);

    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === player.ws.OPEN) {
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
        }
    });
}

export function validateOrNot(roomCode, playerToken, answer) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    if (room.gameState.canEliminatedPlayersVote === false) {
        if (!room.gameState.playerOrder.includes(playerToken)) {
            console.log('Joueur éliminé ou non dans la partie.');
            return;
        }
    }

    console.log(`✅ Vote reçu pour la room ${roomCode} : ${players[playerToken]?.pseudo} a voté ${answer}`);

    room.gameState.currentVote.votes[playerToken] = answer;

    if (!room.gameState.playerWhoAlreadyVote.includes(playerToken)) {
        room.gameState.playerWhoAlreadyVote.push(playerToken);
    }

    let vote_pour = 0;
    let vote_contre = 0;

    Object.values(room.gameState.currentVote.votes).forEach(vote => {
        if (vote === true) {
            vote_pour++;
        } else {
            vote_contre++;
        }
    });

    const results = vote_pour - vote_contre;

    room.gameState.playerWhoAlreadyVote.forEach(playerTokenItem => {
        const player = players[playerTokenItem];
        if (player && player.ws && player.ws.readyState === player.ws.OPEN) {
            try {
                player.ws.send(JSON.stringify({
                    type: 'voteUpdate',
                    votes: room.gameState.currentVote.votes,
                    votesPour: vote_pour,
                    votesContre: vote_contre,
                    totalVotes: Object.keys(room.gameState.currentVote.votes).length,
                    totalPlayers: room.gameState.playerOrder.length,
                    message: `Vote enregistré : ${results > 0 ? 'Pour' : results < 0 ? 'Contre' : 'Égalité'} (${vote_pour} pour, ${vote_contre} contre)`
                }));
            } catch(e) {
                console.error('Erreur voteResult pour', player.pseudo, e.message);
            }
        }
    });

    const totalPlayers = room.gameState.playerOrder.length;
    const totalVotes = Object.keys(room.gameState.currentVote.votes).length;

    if (totalVotes !== totalPlayers) {
        return;
    }

    if (totalVotes === totalPlayers) {
        console.log(`📊 Résultat du vote pour la room ${roomCode} : ${vote_pour} pour, ${vote_contre} contre (Total : ${results})`);

        room.players.forEach(player => {
            if (player.ws && player.ws.readyState === player.ws.OPEN) {
                try {
                    player.ws.send(JSON.stringify({
                        type: 'voteResult',
                        votes: room.gameState.currentVote.votes,
                        votesPour: vote_pour,
                        votesContre: vote_contre,
                        totalVotes: totalVotes,
                        totalPlayers: totalPlayers,
                    }));
                } catch (e) {
                    console.error('Erreur send voteResult pour', player.pseudo, e.message);
                }
            }
        });

        const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];

        if (results > 0) {
            console.log(`✅ La réponse est validée pour la room ${roomCode}`);
            room.gameState.scores[currentPlayerToken] = (room.gameState.scores[currentPlayerToken] || 0) + 1;
            applyMalusToWrongNoVoters(room, currentPlayerToken);
            setTimeout(() => {
                nextTurn(roomCode);
            }, 3500);
        }
        else if (results === 0) {
            console.log(`⚖️ Egalité dans la room ${roomCode} : Aucun malus`);
            setTimeout(() => {
                replayTurn(roomCode);
            }, 3500);
        }
        else {
            console.log(`❌ La réponse est rejetée pour la room ${roomCode}`);
            applyMalusToActivePlayer(room, currentPlayerToken);
            applyMalusToWrongYesVoters(room, currentPlayerToken);
            setTimeout(() => {
                replayTurn(roomCode);
            }, 3500);
        }
    }
}

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

    room.gameState.currentPlayerIndex++;
    
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

    room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp = Date.now() + 2500;
    room.gameState.playerTimers[currentPlayerToken].isPaused = false;

    const allTimers = createAllTimersList(room);

    room.players.forEach((player) => {
        const playerToken = Object.keys(players).find(t => players[t] === player);
        const isCurrentPlayer = playerToken === currentPlayerToken;

        if (player.ws && player.ws.readyState === player.ws.OPEN) {
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

    room.gameState.playerTimers[currentPlayerToken].turnStartTimestamp = Date.now() + 2500;
    room.gameState.playerTimers[currentPlayerToken].isPaused = false;

    const allTimers = createAllTimersList(room);

    room.players.forEach((player) => {
        const playerToken = Object.keys(players).find(t => players[t] === player);
        const isCurrentPlayer = playerToken === currentPlayerToken;

        if (player.ws && player.ws.readyState === player.ws.OPEN) {
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
                }));
            } catch (e) {
                console.error('Erreur replayTurn pour', player.pseudo, e.message);
            }
        }
    });
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

    if (removedIndex <= room.gameState.currentPlayerIndex) {
        room.gameState.currentPlayerIndex--; 
    }

    if (room.gameState.currentPlayerIndex < 0) {
        room.gameState.currentPlayerIndex = 0;
    }

    if (room.gameState.currentPlayerIndex >= room.gameState.playerOrder.length) {
        room.gameState.currentPlayerIndex = 0;
    }

    const allTimers = createAllTimersList(room);

    console.log(`Pseudo du joueur éliminé : ${eliminatedPlayerPseudo}`);

    room.players.forEach((p) => {
        if (p.ws && p.ws.readyState === p.ws.OPEN) {
            try {
                p.ws.send(JSON.stringify({
                    type: 'playerEliminated',
                    playerOrder: room.gameState.playerOrder.map(t => ({
                        token: t,
                        pseudo: players[t]?.pseudo || 'Inconnu',
                        isCurrent: t === room.gameState.playerOrder[room.gameState.currentPlayerIndex],
                    })),
                    allTimers: allTimers,
                    eliminatedPlayerToken: eliminatedPlayerToken,
                    eliminatedPlayerPseudo: eliminatedPlayerPseudo,
                    message: `Le joueur ${eliminatedPlayerPseudo} a été éliminé. Raison : ${reason}`,
                }));
                console.log(`🔔 Notifié ${p.pseudo} de l'élimination de ${eliminatedPlayerPseudo}`);
            } catch (e) {
                console.error('Erreur eliminatedPlayer pour', p.pseudo, e.message);
            }
        }
    });
        
    if (wasCurrentPlayer) {
        setTimeout(() => {
            nextTurn(roomCode);
        }, 3000);
    }
    return;
}

export function finishGame(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isStarted) {
        console.log('❌ Room inexistante ou partie non démarrée');
        return;
    }

    room.gameState.endedPlayerCount = room.players.length;

    const statsByPlayer = {};
    room.gameState.playerOrder.forEach(token => {
        const player = players[token];
        if (player) {
            statsByPlayer[player.pseudo] = {
                score: room.gameState.scores[token] || 0,
                totalMalus: room.gameState.malus[token]?.totalMalus || 0,
                refusedWords: room.gameState.malus[token]?.refusedWords || 0,
                wrongNoVotes: room.gameState.malus[token]?.wrongNoVotes || 0,
                wrongYesVotes: room.gameState.malus[token]?.wrongYesVotes || 0,
            };
        }
    });

    // Calculer le ou les gagnants de la partie
    let highestScore = -1;
    let winners = [];
    Object.entries(room.gameState.scores).forEach(([token, score]) => {
        if (score > highestScore) {
            highestScore = score;
            winners = [token];
        } else if (score === highestScore) {
            winners.push(token);
        }
    });

    // Enregistrer les statistiques persistantes des joueurs en base de données local
    room.gameState.playerOrder.forEach(token => {
        const player = players[token];
        if (player && player.userId) {
            const isWinner = winners.includes(token);
            const malusSec = Math.floor((room.gameState.malus[token]?.totalMalus || 0) / 1000);
            const authUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:4000';
            fetch(`${authUrl}/api/update-stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: player.userId,
                    win: isWinner,
                    malusSec: malusSec
                })
            }).catch(err => console.error("⚠️ Failed to update central stats:", err.message));
        }
    });

    room.players.forEach((player) => {
        const playerToken = Object.keys(players).find(t => players[t] === player);

        if (player.ws && player.ws.readyState === player.ws.OPEN) {
            try {
                player.ws.send(JSON.stringify({
                    type: 'finishGame',
                    roomCode: roomCode,
                    stats: statsByPlayer,
                    scores: room.gameState.scores,
                    yourScore: room.gameState.scores[playerToken],
                }));
            } catch(e) {
                console.error('Erreur finishGame pour', player.pseudo, e.message);
            }
        }
    });
}

export function resetGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.gameState.isStarted = false;
    room.gameState.currentRound = 0;
    room.gameState.currentPlayerIndex = 0;
    room.gameState.currentLetter = null;
    room.gameState.playerWhoAlreadyVote = [];

    room.gameState.playerOrder.forEach(token => {
        room.gameState.scores[token] = 0;
        room.gameState.playerTimers[token] = {
            totalTimeLeft: room.gameState.timerConfig.duration,
            turnStartTimestamp: null,
            isPaused: true,
            isEliminated: false
        };
        room.gameState.malus[token] = {
            totalMalus: 0,
            refusedWords: 0,
            wrongNoVotes: 0,
            wrongYesVotes: 0,
        };
    });

    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === player.ws.OPEN) {
            try {
                player.ws.send(JSON.stringify({
                    type: 'gameReset',
                    roomCode: roomCode
                }));
            } catch(e) {
                console.error('Erreur resetGame pour', player.pseudo, e.message);
            }
        }
    });

    updateRoomPlayers(roomCode);
}

export function removePlayerFromRoom(playerToken) {
    const player = players[playerToken];
    if (!player || !player.currentRoom) return;

    const roomCode = player.currentRoom;
    const room = rooms[roomCode];
    if (!room) return;

    room.gameState.playerOrder = room.gameState.playerOrder.filter(t => t !== playerToken);

    if (room.gameState.isStarted && room.gameState.currentPlayerIndex >= room.gameState.playerOrder.length) {
        room.gameState.currentPlayerIndex = 0;
    }

    room.players = room.players.filter(p => p !== player);
    player.currentRoom = null;
    player.isMaster = false;

    console.log(`👋 ${player.pseudo} a quitté la room ${roomCode}`);

    const masterStillHere = room.players.some(p => p.isMaster);
    if (!masterStillHere && room.players.length > 0) {
        room.players[0].isMaster = true;
        if (room.players[0].ws && room.players[0].ws.readyState === room.players[0].ws.OPEN) {
            try { room.players[0].ws.send(JSON.stringify({ type: 'master', master: true })); } catch(e) {}
        }
        console.log(`🔑 Nouveau master : ${room.players[0].pseudo} dans la room ${roomCode}`);
    }

    updateRoomPlayers(roomCode);

    if (room.gameState.isStarted && room.players.length > 0) {
        const currentPlayerToken = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
        const currentPlayer = players[currentPlayerToken];

        room.players.forEach((p) => {
            const pToken = Object.keys(players).find(t => players[t] === p);
            if (p.ws && p.ws.readyState === p.ws.OPEN) {
                try {
                    p.ws.send(JSON.stringify({
                        type: 'playerLeft',
                        leftPlayer: player.pseudo,
                        currentPlayerPseudo: currentPlayer?.pseudo,
                        isCurrentPlayer: pToken === currentPlayerToken,
                    }));
                } catch(e) {}
            }
        });
    }

    if (room.players.length === 0) {
        delete rooms[roomCode];
        console.log(`🗑️ Room ${roomCode} supprimée (vide)`);
    }
}

export function chooseRandomLetter() {
    const choosenLetter = arrayRandom(possibleLetters);
    console.log(`🎲 Lettre choisie : ${choosenLetter}`);
    return choosenLetter;
}

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

// =====================================================
// AI SUGGESTED CONFIG & Q-LEARNING FEEDBACK
// =====================================================

const weightsPath = path.join(process.cwd(), 'ai_weights.json');

const defaultWeights = {
    "2": { maxRounds: 5, maxTime: 45000, canEliminatedPlayersVote: false, randomizeOrder: true },
    "3": { maxRounds: 5, maxTime: 45000, canEliminatedPlayersVote: false, randomizeOrder: true },
    "4": { maxRounds: 6, maxTime: 60000, canEliminatedPlayersVote: false, randomizeOrder: true },
    "5": { maxRounds: 6, maxTime: 60000, canEliminatedPlayersVote: true, randomizeOrder: true },
    "6": { maxRounds: 7, maxTime: 75000, canEliminatedPlayersVote: true, randomizeOrder: true },
    "7": { maxRounds: 7, maxTime: 75000, canEliminatedPlayersVote: true, randomizeOrder: true },
    "8": { maxRounds: 8, maxTime: 90000, canEliminatedPlayersVote: true, randomizeOrder: true }
};

let aiWeights = { ...defaultWeights };

try {
    if (fs.existsSync(weightsPath)) {
        const data = fs.readFileSync(weightsPath, 'utf8');
        aiWeights = JSON.parse(data);
        console.log("🤖 AI Weights loaded successfully from ai_weights.json");
    } else {
        fs.writeFileSync(weightsPath, JSON.stringify(defaultWeights, null, 2), 'utf8');
        console.log("🤖 Created default ai_weights.json");
    }
} catch (e) {
    console.error("⚠️ Failed to load AI weights, using defaults:", e.message);
}

function saveWeights() {
    try {
        fs.writeFileSync(weightsPath, JSON.stringify(aiWeights, null, 2), 'utf8');
    } catch (e) {
        console.error("⚠️ Failed to save AI weights:", e.message);
    }
}

export function getSuggestedConfig(playerCount) {
    const key = playerCount.toString();
    if (aiWeights[key]) {
        return aiWeights[key];
    }
    
    if (playerCount <= 1) {
        return { maxRounds: 5, maxTime: 45000, canEliminatedPlayersVote: false, randomizeOrder: true };
    }
    return { maxRounds: 8, maxTime: 90000, canEliminatedPlayersVote: true, randomizeOrder: true };
}

export function recordFeedback(roomCode, rating, top, flop) {
    const room = rooms[roomCode];
    if (!room) return;

    const playerCount = room.gameState.endedPlayerCount || room.players.length;
    updateAIWeights(playerCount, rating, top, flop);
}

export function updateAIWeights(playerCount, rating, top, flop) {
    const key = playerCount.toString();
    if (!aiWeights[key]) {
        aiWeights[key] = { maxRounds: 6, maxTime: 60000, canEliminatedPlayersVote: false, randomizeOrder: true };
    }

    const config = aiWeights[key];

    // Q-Learning / Feedback adaptation logic
    if (rating < 4 || flop) {
        if (flop === "Partie trop longue") {
            if (config.maxRounds > 3) config.maxRounds -= 1;
            if (config.maxTime > 15000) config.maxTime -= 5000;
        } else if (flop === "Partie trop courte") {
            if (config.maxRounds < 15) config.maxRounds += 1;
            if (config.maxTime < 120000) config.maxTime += 5000;
        } else if (flop === "Pas assez de temps pour répondre") {
            if (config.maxTime < 120000) config.maxTime += 10000;
        } else if (flop === "Malus trop sévères") {
            if (config.maxTime < 120000) config.maxTime += 5000;
        }
    }

    console.log(`🤖 AI updated suggested config for ${playerCount} players:`, config);
    saveWeights();
}