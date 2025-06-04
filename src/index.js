// src/index.js - Cloudflare Worker Entry Point
import { Router } from 'itty-router';
import { DatabaseHelper } from './db-helper.js';
import { AuthHandler } from './auth-handler.js';
import { TranslationHandler } from './translation-handler.js';
import { WebSocketHandler } from './websocket-handler.js';

const router = Router();

// CORS headers for cross-origin requests
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
router.get('/api/ws', WebSocketHandler.handleUpgrade);

// Health check
router.get('/api/health', () => new Response('OK', { status: 200 }));

// Handle OPTIONS for CORS
router.options('*', () => new Response(null, { headers: corsHeaders }));

// 404 handler
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
    async fetch(request, env, ctx) {
        try {
            // Initialize database helper with env binding
            const db = new DatabaseHelper(env.DB);

            // Add env and db to request for use in handlers
            request.env = env;
            request.db = db;

            const response = await router.handle(request);
            return withCors(response);
        } catch (error) {
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