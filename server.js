import {initWebsocket} from './wsHandler.js';
import {initConsole} from './console.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

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

// DB routes removed in favor of central auth-service and Supabase DB.

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