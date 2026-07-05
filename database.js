import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'database.json');

// Structure par défaut de la base
const defaultData = {
    users: [], // Array de { id, pseudo, email, password, stats, friends, pendingRequests }
};

// =======================
// LECTURE & ECRITURE
// =======================
function readDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Erreur de lecture de la base de données:", e.message);
        return defaultData;
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Erreur d'écriture de la base de données:", e.message);
    }
}

// =======================
// AUTHENTIFICATION ACTIONS
// =======================
export function registerUser(pseudo, email, password) {
    const db = readDb();
    const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() || u.pseudo.toLowerCase() === pseudo.toLowerCase());
    if (existing) {
        return { success: false, message: "Pseudo ou Email déjà utilisé" };
    }

    const newUser = {
        id: Math.random().toString(36).substring(2, 9),
        pseudo,
        email,
        password, // Stockage simple pour exécution locale directe
        stats: {
            gamesPlayed: 0,
            wins: 0,
            totalMalus: 0
        },
        friends: [],
        pendingRequests: []
    };

    db.users.push(newUser);
    writeDb(db);
    return { success: true, user: newUser };
}

export function loginUser(email, password) {
    const db = readDb();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!user) {
        return { success: false, message: "Identifiants incorrects" };
    }
    return { success: true, user };
}

export function getUserStats(userId) {
    const db = readDb();
    const user = db.users.find(u => u.id === userId);
    return user ? user.stats : null;
}

// =======================
// PERSISTENT GAMES END STATS
// =======================
export function incrementUserStats(pseudo, win, malusAdded) {
    const db = readDb();
    const user = db.users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase());
    if (user) {
        user.stats.gamesPlayed++;
        if (win) user.stats.wins++;
        user.stats.totalMalus += malusAdded;
        writeDb(db);
    }
}

// =======================
// FRIENDS ACTIONS
// =======================
export function addFriendRequest(fromUserId, toPseudo) {
    const db = readDb();
    const fromUser = db.users.find(u => u.id === fromUserId);
    const toUser = db.users.find(u => u.pseudo.toLowerCase() === toPseudo.toLowerCase());

    if (!fromUser || !toUser) {
        return { success: false, message: "Utilisateur non trouvé" };
    }
    if (fromUser.pseudo.toLowerCase() === toPseudo.toLowerCase()) {
        return { success: false, message: "Vous ne pouvez pas vous ajouter vous-même" };
    }
    if (fromUser.friends.includes(toUser.pseudo)) {
        return { success: false, message: "Déjà dans votre liste d'amis" };
    }
    if (toUser.pendingRequests.includes(fromUser.pseudo)) {
        return { success: false, message: "Demande déjà en attente" };
    }

    toUser.pendingRequests.push(fromUser.pseudo);
    writeDb(db);
    return { success: true, message: "Demande d'ami envoyée" };
}

export function acceptFriendRequest(userId, friendPseudo) {
    const db = readDb();
    const user = db.users.find(u => u.id === userId);
    const friend = db.users.find(u => u.pseudo.toLowerCase() === friendPseudo.toLowerCase());

    if (!user || !friend) return { success: false, message: "Utilisateur non trouvé" };

    user.pendingRequests = user.pendingRequests.filter(p => p.toLowerCase() !== friendPseudo.toLowerCase());
    
    if (!user.friends.includes(friend.pseudo)) {
        user.friends.push(friend.pseudo);
    }
    if (!friend.friends.includes(user.pseudo)) {
        friend.friends.push(user.pseudo);
    }

    writeDb(db);
    return { success: true, message: "Demande d'ami acceptée !" };
}

export function getFriendsList(userId) {
    const db = readDb();
    const user = db.users.find(u => u.id === userId);
    if (!user) return { friends: [], pendingRequests: [] };
    return {
        friends: user.friends,
        pendingRequests: user.pendingRequests
    };
}
