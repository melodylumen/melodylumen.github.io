// src/index.js - Cloudflare Worker Entry Point
import { Router } from 'itty-router';
import { DatabaseHelper } from './db-helper.js';
import { AuthHandler } from './auth-handler.js';
import { TranslationHandler } from './translation-handler.js';
import { WebSocketHandler } from './websocket-handler.js';
import { Toucan } from 'toucan-js';


const router = Router();

// CORS headers for cross-origin requests
const corsHeaders = {
    'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://your-org.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
};

// Middleware to add CORS headers
const withCors = (response) => {
    Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
    });
    return response;
};

// Auth endpoints
router.post('/api/auth/github', AuthHandler.githubAuth);
router.post('/api/auth/token', AuthHandler.tokenAuth);
router.get('/api/auth/validate', AuthHandler.validate);

// Translation endpoints
router.get('/api/translations/:repo/:language', TranslationHandler.getTranslations);
router.post('/api/translations/:repo/:language', TranslationHandler.saveTranslation);
router.get('/api/translations/changes', TranslationHandler.getPendingChanges);
router.post('/api/translations/submit-pr', TranslationHandler.submitPR);

// Repository configuration
router.get('/api/repositories', TranslationHandler.getRepositories);
router.get('/api/repositories/:owner/:repo/languages', TranslationHandler.getLanguages);

// WebSocket for real-time collaboration
router.get('/api/ws', async (request, env) => {
    const roomId = request.headers.get('X-Room-Id');
    if (!roomId) {
        return new Response('Room ID required', { status: 400 });
    }

    const id = env.TRANSLATION_ROOMS.idFromName(roomId);
    const room = env.TRANSLATION_ROOMS.get(id);

    return room.fetch(request);
});

// Health check
router.get('/api/health', () => new Response('OK', { status: 200 }));

// Handle OPTIONS for CORS
router.options('*', () => new Response(null, { headers: corsHeaders }));

// 404 handler
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
    async fetch(request, env, ctx) {
        const sentry = new Toucan({
            dsn: env.SENTRY_DSN,
            context: ctx,
            request,
        });

        try {
            // Initialize database helper with env binding
            const db = new DatabaseHelper(env.DB);

            // Add env and db to request for use in handlers
            request.env = env;
            request.db = db;

            const response = await router.handle(request);
            return withCors(response);
        } catch (error) {
            sentry.captureException(error);
            console.error('Worker error:', error);
            return withCors(new Response(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }));
        }
    },
    // Handle WebSocket connections
    async webSocketMessage(ws, message) {
        await WebSocketHandler.handleMessage(ws, message);
    },

    async webSocketClose(ws, code, reason, wasClean) {
        await WebSocketHandler.handleClose(ws, code, reason, wasClean);
    }
};
