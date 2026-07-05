import {initWebsocket} from './wsHandler.js';
import {initConsole} from './console.js';
import express from 'express';
import http from 'http';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ========================================
// Route /ping pour UptimeRobot
// ========================================
app.get('/ping', (req, res) => {
  console.log('🔔 Ping reçu - Serveur actif');
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Serveur Kboom actif'
  });
});

// ========================================
// Route / pour vérifier que le serveur tourne
// ========================================
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Serveur Kboom en ligne',
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// ========================================
// IMPORT DES SERVICES BASE DE DONNÉES
// ========================================
import * as db from './database.js';

// ========================================
// ROUTES D'AUTHENTIFICATION & COMPTES
// ========================================
app.post('/auth/register', (req, res) => {
  const { pseudo, email, password } = req.body;
  if (!pseudo || !email || !password) {
    return res.status(400).json({ success: false, message: "Tous les champs sont requis." });
  }
  const result = db.registerUser(pseudo, email, password);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.status(200).json(result);
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email et mot de passe requis." });
  }
  const result = db.loginUser(email, password);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.status(200).json(result);
});

app.get('/auth/stats/:userId', (req, res) => {
  const stats = db.getUserStats(req.params.userId);
  if (!stats) {
    return res.status(404).json({ success: false, message: "Stats non trouvées." });
  }
  res.status(200).json({ success: true, stats });
});

// ========================================
// ROUTES DE LISTE D'AMIS
// ========================================
app.get('/auth/friends/:userId', (req, res) => {
  const list = db.getFriendsList(req.params.userId);
  res.status(200).json({ success: true, ...list });
});

app.post('/auth/friends/add', (req, res) => {
  const { userId, toPseudo } = req.body;
  if (!userId || !toPseudo) {
    return res.status(400).json({ success: false, message: "Champs requis manquants." });
  }
  const result = db.addFriendRequest(userId, toPseudo);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.status(200).json(result);
});

app.post('/auth/friends/accept', (req, res) => {
  const { userId, friendPseudo } = req.body;
  if (!userId || !friendPseudo) {
    return res.status(400).json({ success: false, message: "Champs requis manquants." });
  }
  const result = db.acceptFriendRequest(userId, friendPseudo);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.status(200).json(result);
});

initWebsocket(server);
initConsole();

// ========================================
// Utiliser process.env.PORT
// ========================================
const PORT = process.env.PORT || 3000; // Si pas de PORT, utilise 3000 en local
const HOST = '0.0.0.0'; // Écouter sur toutes les interfaces

server.listen(PORT, HOST, () => {
  console.log(`🚀 Serveur Kboom lancé sur http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket prêt`);
  console.log(`🔔 Ping disponible sur /ping`);
});