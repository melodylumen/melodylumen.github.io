import { Router } from 'itty-router';
import { DatabaseHelper } from './db-helper.js';
import { AuthHandler } from './auth-handler.js';
import { TranslationHandler } from './translation-handler.js';
import { WebSocketHandler } from './websocket-handler.js';
import { TranslationRoom } from './translation-room.js';

// Export the Durable Object class
export { TranslationRoom };

const router = Router();

// Helper function to add CORS headers
function corsResponse(response, env) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', env.FRONTEND_URL || '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Allow-Credentials', 'true');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

// Middleware to inject env and db into request
async function withContext(request, env) {
    request.env = env;
    request.db = new DatabaseHelper(env.DB);
    return request;
}

// Auth endpoints
router.post('/api/auth/github', AuthHandler.githubAuth);
router.post('/api/auth/token', AuthHandler.tokenAuth);
router.get('/api/auth/validate', AuthHandler.validate);

// Repository configuration
router.get('/api/repositories', TranslationHandler.getRepositories);
router.get('/api/repositories/:owner/:repo/languages', TranslationHandler.getLanguages);

// Translation endpoints
router.get('/api/translations/:repo/:language', TranslationHandler.getTranslations);
router.post('/api/translations/:repo/:language', TranslationHandler.saveTranslation);
router.get('/api/translations/changes', TranslationHandler.getPendingChanges);
router.post('/api/translations/submit-pr', TranslationHandler.submitPR);

// WebSocket endpoint
router.get('/api/ws', async (request, env) => {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const repo = url.searchParams.get('repo');
    const language = url.searchParams.get('language');

    if (!repo || !language) {
        return new Response('Missing repo or language parameters', { status: 400 });
    }

    // Create room ID from repo and language
    const roomId = `${repo}:${language}`;
    const id = env.TRANSLATION_ROOMS.idFromName(roomId);
    const room = env.TRANSLATION_ROOMS.get(id);

    // Forward the request to the Durable Object
    return room.fetch(request);
});

// Health check
router.get('/api/health', () => new Response('OK', { status: 200 }));

// Handle OPTIONS for CORS preflight
router.options('*', (request, env) => {
    return corsResponse(new Response(null, { status: 204 }), env);
});

// 404 handler
router.all('*', () => new Response('Not Found', { status: 404 }));

// Main worker handler
export default {
    async fetch(request, env, ctx) {
        try {
            // Add context to request
            await withContext(request, env);

            // Route the request
            const response = await router.handle(request, env, ctx);

            // Add CORS headers
            return corsResponse(response, env);

        } catch (error) {
            console.error('Worker error:', error);

            const errorResponse = new Response(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message,
                code: error.code || 'INTERNAL_ERROR'
            }), {
                status: error.statusCode || 500,
                headers: { 'Content-Type': 'application/json' }
            });

            return corsResponse(errorResponse, env);
        }
    }
};