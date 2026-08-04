const DEFAULT_AUTH_SERVICE_URL = 'http://localhost:4000';

export function getAuthServiceBaseUrl() {
    const configured = process.env.AUTH_SERVICE_URL?.trim();
    if (configured) {
        return configured.replace(/\/$/, '');
    }

    return DEFAULT_AUTH_SERVICE_URL;
}

export async function verifyToken(token) {
    const authUrl = getAuthServiceBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(`${authUrl}/api/verify-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('⚠️ Central Auth verification failed:', error?.message || error);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function updateStats(userId, win, malusSec) {
    const gameServerSecret = process.env.GAME_SERVER_SECRET;
    if (!gameServerSecret) {
        console.error('GAME_SERVER_SECRET manquant : statistiques non envoyées.');
        return;
    }
    const authUrl = getAuthServiceBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        await fetch(`${authUrl}/api/update-stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-kboom-game-secret': gameServerSecret },
            body: JSON.stringify({ userId, win, malusSec }),
            signal: controller.signal,
        });
    } catch (error) {
        console.error('⚠️ Failed to update central stats:', error?.message || error);
    } finally {
        clearTimeout(timeout);
    }
}
