import readline from 'readline';
import { players, rooms } from './rooms.js';
import * as gameManager from './gameManager.js';

export function initConsole() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on('line', (input) => {
        const cmd = input.trim();

        if (cmd === 'list') {
            console.log('👥 Joueurs connectés :', Object.keys(players));
            return;
        }

        if (cmd === 'rooms') {
            console.log('🏠 Rooms actives :', Object.keys(rooms));
            return;
        }

        if (cmd.startsWith('kick_')) {
            // kick_0 ou kick_1 ...
            const idx = parseInt(cmd.split('_')[1], 10);
            const names = Object.keys(players);
            const target = names[idx];
            if (target && players[target]) {
                const roomCode = players[target].currentRoom;
                if (roomCode) {
                    gameManager.removePlayerFromRoom(target);
                    console.log(`👢 Joueur ${target} kické de la room ${roomCode}`);
                } else {
                    console.log(`❌ Joueur ${target} n'est dans aucune room`);
                }
            } else {
                console.log('❌ Joueur introuvable');
            }
            return;
        }

        if (cmd.startsWith('msg_')) {
            const parts = cmd.split(' ');
            const idx = parseInt(parts[0].split('_')[1], 10);
            const msg = parts.slice(1).join(' ') || 'Ping';
            const names = Object.keys(players);
            const target = names[idx];
            if (target && players[target]) {
                players[target].ws.send(JSON.stringify({ type:'message', text: msg }));
                console.log(`📤 Message envoyé à ${target}`);
            } else {
                console.log('❌ Joueur introuvable ou déconnecté');
            }
            return;
        }

        if (cmd === 'reset_ai' || cmd === 'resetai' || cmd === 'reset_ai_weights') {
            gameManager.resetAIWeights();
            return;
        }

        if (cmd === '') {
            console.log('⚠️ Commande vide');
            return;
        }

        console.log('❌ Commande inconnue. Utilise: list | rooms | reset_ai | kick_0 | msg_0 <msg>');
    });
}
