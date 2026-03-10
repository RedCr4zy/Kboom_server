import { players, rooms } from './rooms.js';

// ==========================================
// CONFIGURATION DU JEU
// ==========================================
const GAME_CONFIG = {
    TOTAL_ROUNDS: 3,
    ROUND_DURATION: 60, // secondes
    MIN_WORD_LENGTH: 3,
    POINTS_PER_WORD: 10,
    BONUS_UNIQUE_WORD: 5, // Bonus si personne d'autre n'a trouvé le mot
};

// ==========================================
// LETTRES DISPONIBLES
// ==========================================
const AVAILABLE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ==========================================
// GÉNÉRATION DE ROOM
// ==========================================
function generateRoom() {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomCode] = {
        players: [],
        sockets: [],
        createdAt: Date.now(),
        gameState: {
            isStarted: false,
            currentRound: 0,
            currentLetter: null,
            submissions: {}, // token -> {words: [], submittedAt: timestamp}
            scores: {}, // token -> totalScore
            roundHistory: [], // Historique des manches
        }
    };
    return roomCode;
}

// ==========================================
// AJOUTER UN JOUEUR À UNE ROOM
// ==========================================
export function addPlayerToRoom(roomCode, playerToken, isMaster = false) {
    if (!rooms[roomCode]) {
        console.log('❌ Room', roomCode, 'inexistante');
        return false;
    }

    if (!players[playerToken]) {
        console.log('❌ Joueur', playerToken, 'introuvable');
        return false;
    }

    rooms[roomCode].players.push(players[playerToken]);
    players[playerToken].currentRoom = roomCode;
    players[playerToken].isMaster = isMaster;

    // Initialiser le score du joueur
    if (!rooms[roomCode].gameState.scores[playerToken]) {
        rooms[roomCode].gameState.scores[playerToken] = 0;
    }

    console.log('✅ Joueur', players[playerToken].pseudo, 'ajouté à la room', roomCode);

    updateRoomPlayers(roomCode);

    return true;
}

// ==========================================
// METTRE À JOUR LA LISTE DES JOUEURS
// ==========================================
export function updateRoomPlayers(roomCode) {
    if (!rooms[roomCode]) return;

    // Filtrer les joueurs déconnectés
    rooms[roomCode].players = rooms[roomCode].players.filter(
        player => player.ws.readyState === player.ws.OPEN
    );

    const playerList = rooms[roomCode].players.map(p => ({
        pseudo: p.pseudo,
        isMaster: p.isMaster || false,
    }));

    console.log(`📊 Update room ${roomCode}:`, playerList);

    // Envoyer à tous les joueurs de la room
    rooms[roomCode].players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'updatePlayers',
                players: playerList,
                roomCode: roomCode
            }));
        } catch (err) {
            console.error('❌ Erreur envoi à', player.pseudo, err.message);
        }
    });
}

// ==========================================
// CRÉER UNE PARTIE
// ==========================================
export function createGame(playerToken) {
    const roomCode = generateRoom();
    addPlayerToRoom(roomCode, playerToken, true);

    players[playerToken].ws.send(JSON.stringify({
        type: 'redirection',
        message: 'Room créée',
        roomCode: roomCode,
        isMaster: true
    }));
}

// ==========================================
// DÉMARRER LA PARTIE
// ==========================================
export function startGame(roomCode) {
    if (!rooms[roomCode]) {
        console.log('❌ Room inexistante');
        return;
    }

    const room = rooms[roomCode];

    if (room.gameState.isStarted) {
        console.log('⚠️ La partie a déjà commencé');
        return;
    }

    // Initialiser l'état de jeu
    room.gameState.isStarted = true;
    room.gameState.currentRound = 1;
    room.gameState.currentLetter = getRandomLetter();
    room.gameState.submissions = {};

    console.log(`🎮 Partie démarrée dans la room ${roomCode}`);
    console.log(`🔤 Lettre: ${room.gameState.currentLetter}`);

    // Notifier tous les joueurs
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'gameStarted',
                letter: room.gameState.currentLetter,
                round: room.gameState.currentRound,
                totalRounds: GAME_CONFIG.TOTAL_ROUNDS,
            }));
        } catch (err) {
            console.error('❌ Erreur envoi gameStarted à', player.pseudo, err);
        }
    });

    // Démarrer le timer de la manche
    startRoundTimer(roomCode);
}

// ==========================================
// TIMER DE MANCHE
// ==========================================
function startRoundTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // Timer de 60 secondes
    setTimeout(() => {
        if (rooms[roomCode]) {
            endRound(roomCode);
        }
    }, GAME_CONFIG.ROUND_DURATION * 1000);
}

// ==========================================
// SOUMETTRE DES MOTS
// ==========================================
export function submitWords(roomCode, playerToken, words, round) {
    if (!rooms[roomCode]) {
        console.log('❌ Room inexistante');
        return;
    }

    const room = rooms[roomCode];

    if (room.gameState.currentRound !== round) {
        console.log('⚠️ Mauvais numéro de manche');
        return;
    }

    // Enregistrer les mots du joueur
    room.gameState.submissions[playerToken] = {
        words: words,
        submittedAt: Date.now(),
    };

    console.log(`📝 ${players[playerToken].pseudo} a soumis ${words.length} mots`);

    // Vérifier si tous les joueurs ont soumis
    if (Object.keys(room.gameState.submissions).length === room.players.length) {
        console.log('✅ Tous les joueurs ont soumis, fin de manche anticipée');
        endRound(roomCode);
    }
}

// ==========================================
// TERMINER UNE MANCHE
// ==========================================
function endRound(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    console.log(`⏱️ Fin de la manche ${room.gameState.currentRound}`);

    // Calculer les scores de cette manche
    const roundResults = calculateRoundScores(roomCode);

    // Enregistrer dans l'historique
    room.gameState.roundHistory.push({
        round: room.gameState.currentRound,
        letter: room.gameState.currentLetter,
        results: roundResults,
    });

    // Notifier les joueurs des résultats
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'roundResults',
                round: room.gameState.currentRound,
                results: roundResults,
            }));
        } catch (err) {
            console.error('❌ Erreur envoi roundResults:', err);
        }
    });

    // Passer à la manche suivante ou terminer la partie
    if (room.gameState.currentRound < GAME_CONFIG.TOTAL_ROUNDS) {
        nextRound(roomCode);
    } else {
        endGame(roomCode);
    }
}

// ==========================================
// MANCHE SUIVANTE
// ==========================================
function nextRound(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.gameState.currentRound++;
    room.gameState.currentLetter = getRandomLetter();
    room.gameState.submissions = {};

    console.log(`➡️ Manche ${room.gameState.currentRound} - Lettre: ${room.gameState.currentLetter}`);

    // Notifier les joueurs
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'nextRound',
                round: room.gameState.currentRound,
                letter: room.gameState.currentLetter,
                totalRounds: GAME_CONFIG.TOTAL_ROUNDS,
            }));
        } catch (err) {
            console.error('❌ Erreur envoi nextRound:', err);
        }
    });

    // Démarrer le timer
    startRoundTimer(roomCode);
}

// ==========================================
// CALCULER LES SCORES D'UNE MANCHE
// ==========================================
function calculateRoundScores(roomCode) {
    const room = rooms[roomCode];
    if (!room) return {};

    const results = {};
    const allWords = {}; // Compter les occurrences de chaque mot

    // Collecter tous les mots
    Object.entries(room.gameState.submissions).forEach(([token, submission]) => {
        submission.words.forEach(word => {
            const normalized = word.toLowerCase().trim();
            if (!allWords[normalized]) {
                allWords[normalized] = [];
            }
            allWords[normalized].push(token);
        });
    });

    // Calculer les points pour chaque joueur
    Object.entries(room.gameState.submissions).forEach(([token, submission]) => {
        let roundScore = 0;
        const validWords = [];
        const invalidWords = [];

        submission.words.forEach(word => {
            const normalized = word.toLowerCase().trim();
            const letter = room.gameState.currentLetter.toLowerCase();

            // Vérifications
            const isValidLength = normalized.length >= GAME_CONFIG.MIN_WORD_LENGTH;
            const startsWithLetter = normalized.startsWith(letter);

            if (isValidLength && startsWithLetter) {
                validWords.push(word);
                roundScore += GAME_CONFIG.POINTS_PER_WORD;

                // Bonus si mot unique
                if (allWords[normalized].length === 1) {
                    roundScore += GAME_CONFIG.BONUS_UNIQUE_WORD;
                }
            } else {
                invalidWords.push(word);
            }
        });

        // Mettre à jour le score total
        if (!room.gameState.scores[token]) {
            room.gameState.scores[token] = 0;
        }
        room.gameState.scores[token] += roundScore;

        results[token] = {
            pseudo: players[token].pseudo,
            roundScore: roundScore,
            totalScore: room.gameState.scores[token],
            validWords: validWords,
            invalidWords: invalidWords,
        };
    });

    return results;
}

// ==========================================
// TERMINER LA PARTIE
// ==========================================
function endGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    console.log(`🏁 Fin de la partie dans la room ${roomCode}`);

    // Créer le classement final
    const rankings = Object.entries(room.gameState.scores)
        .map(([token, score]) => {
            const player = players[token];
            const totalValidWords = room.gameState.roundHistory.reduce((count, round) => {
                const result = round.results[token];
                return count + (result ? result.validWords.length : 0);
            }, 0);

            return {
                token: token,
                pseudo: player ? player.pseudo : 'Inconnu',
                score: score,
                validWords: totalValidWords,
            };
        })
        .sort((a, b) => b.score - a.score); // Tri par score décroissant

    console.log('🏆 Classement final:', rankings);

    // Notifier tous les joueurs
    room.players.forEach(player => {
        try {
            player.ws.send(JSON.stringify({
                type: 'gameEnded',
                rankings: rankings,
                history: room.gameState.roundHistory,
            }));
        } catch (err) {
            console.error('❌ Erreur envoi gameEnded:', err);
        }
    });

    // Réinitialiser l'état de jeu
    room.gameState.isStarted = false;
    room.gameState.currentRound = 0;
    room.gameState.currentLetter = null;
    room.gameState.submissions = {};
}

// ==========================================
// RELANCER UNE PARTIE
// ==========================================
export function restartGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    console.log(`🔄 Relancement de la partie dans la room ${roomCode}`);

    // Réinitialiser les scores
    room.gameState.scores = {};
    room.gameState.roundHistory = [];

    room.players.forEach(player => {
        const token = Object.keys(players).find(
            t => players[t] === player
        );
        if (token) {
            room.gameState.scores[token] = 0;
        }
    });

    // Redémarrer
    startGame(roomCode);
}

// ==========================================
// QUITTER UNE ROOM
// ==========================================
export function leaveRoom(roomCode, playerToken) {
    if (!rooms[roomCode]) return;

    const room = rooms[roomCode];
    const player = players[playerToken];

    if (!player) return;

    // Retirer le joueur
    room.players = room.players.filter(p => p !== player);
    player.currentRoom = null;

    console.log(`👋 ${player.pseudo} a quitté la room ${roomCode}`);

    // Si la room est vide, la supprimer
    if (room.players.length === 0) {
        delete rooms[roomCode];
        console.log(`🗑️ Room ${roomCode} supprimée (vide)`);
        return;
    }

    // Si le master part, transférer à quelqu'un d'autre
    if (player.isMaster && room.players.length > 0) {
        const newMaster = room.players[0];
        newMaster.isMaster = true;

        const newMasterToken = Object.keys(players).find(
            t => players[t] === newMaster
        );

        if (newMasterToken) {
            newMaster.ws.send(JSON.stringify({
                type: 'master',
                message: 'Vous êtes maintenant le maître de la partie',
            }));
        }
    }

    // Mettre à jour la liste
    updateRoomPlayers(roomCode);
}

// ==========================================
// UTILITAIRES
// ==========================================
function getRandomLetter() {
    return AVAILABLE_LETTERS[Math.floor(Math.random() * AVAILABLE_LETTERS.length)];
}

// Exporter la fonction generateRoom
export { generateRoom };
