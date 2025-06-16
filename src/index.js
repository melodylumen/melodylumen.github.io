// src/index.js - Updated with GitHub App and Token Management
import { Router } from 'itty-router';
import { DatabaseHelper } from './db-helper.js';
import { AuthHandler } from './auth-handler.js';
import { TranslationHandler } from './translation-handler.js';
import { TranslationRoom } from './translation-room.js';
import { GitHubAppAuth } from './github-app-auth.js';
import { TokenManager } from './token-manager.js';

// Export the Durable Object class
export { TranslationRoom };

const router = Router();

// Helper function to add CORS headers
function corsResponse(response, env, request) {
    const headers = new Headers(response.headers);

    // Get origin from request
    const origin = request.headers.get('Origin');

    // Allow localhost for development and configured frontend URL for production
    const allowedOrigins = [
        'http://localhost:8000',
        'http://localhost:3000',
        'http://127.0.0.1:8000',
        'http://127.0.0.1:3000',
        env.FRONTEND_URL,
        'https://melodylumen.github.io'
    ].filter(Boolean);

    if (origin && allowedOrigins.includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
    } else if (!origin || env.ENVIRONMENT === 'development') {
        // For development or same-origin requests, be more permissive
        headers.set('Access-Control-Allow-Origin', '*');
    }

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
    request.githubApp = new GitHubAppAuth(env);
    return request;
}

// Auth endpoints
router.post('/api/auth/github', AuthHandler.githubAuth); // Legacy PAT auth
router.post('/api/auth/token', AuthHandler.tokenAuth);
router.get('/api/auth/validate', AuthHandler.validate);

// GitHub App OAuth endpoints
router.post('/api/auth/github/oauth', async (request) => {
    await withContext(request, request.env);
    return request.githubApp.initiateOAuth(request);
});

router.post('/api/auth/github/callback', async (request) => {
    await withContext(request, request.env);
    return request.githubApp.completeOAuth(request);
});

// Token Management endpoints (admin only)
router.post('/api/admin/tokens', TokenManager.handleCreateToken);
router.get('/api/admin/tokens', TokenManager.handleListTokens);
router.post('/api/admin/tokens/revoke', TokenManager.handleRevokeToken);
router.get('/api/admin/tokens/stats', TokenManager.handleTokenStats);

// Admin management endpoints
router.get('/api/admin/users', async (request) => {
    try {
        const session = await AuthHandler.requireAuth(request);

        if (!session.isAdmin) {
            return new Response(JSON.stringify({
                error: 'Unauthorized. Admin access required.'
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const search = url.searchParams.get('search');

        let query = `
            SELECT 
                u.*,
                COUNT(DISTINCT ts.id) as session_count,
                COUNT(DISTINCT tp.id) as translation_count,
                MAX(u.last_active) as last_seen
            FROM users u
            LEFT JOIN translation_sessions ts ON u.id = ts.user_id
            LEFT JOIN translation_progress tp ON ts.id = tp.session_id
        `;

        const bindings = [];

        if (search) {
            query += ` WHERE u.name LIKE ? OR u.email LIKE ?`;
            bindings.push(`%${search}%`, `%${search}%`);
        }

        query += ` GROUP BY u.id ORDER BY u.last_active DESC LIMIT ? OFFSET ?`;
        bindings.push(limit, offset);

        const results = await request.db.db.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({
            success: true,
            users: results.results
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Admin users error:', error);
        return new Response(JSON.stringify({
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});

router.post('/api/admin/users/grant-admin', async (request) => {
    try {
        const session = await AuthHandler.requireAuth(request);

        if (!session.isAdmin) {
            return new Response(JSON.stringify({
                error: 'Unauthorized. Admin access required.'
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { githubUsername, permissions } = await request.json();

        // Find user by GitHub username
        const user = await request.db.db.prepare(`
            SELECT id FROM users WHERE github_username = ?
        `).bind(githubUsername).first();

        if (!user) {
            return new Response(JSON.stringify({
                error: 'User not found. They must log in at least once first.'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Grant admin access
        await request.db.db.prepare(`
            INSERT OR REPLACE INTO admin_users (user_id, granted_by, permissions)
            VALUES (?, ?, ?)
        `).bind(user.id, session.userId, JSON.stringify(permissions || {})).run();

        // Update admin list in KV
        const adminList = await request.env.KV_BINDING.get('admin_users', 'json') || { users: [] };
        if (!adminList.users.includes(githubUsername)) {
            adminList.users.push(githubUsername);
            await request.env.KV_BINDING.put('admin_users', JSON.stringify(adminList));
        }

        return new Response(JSON.stringify({
            success: true,
            message: 'Admin access granted'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Grant admin error:', error);
        return new Response(JSON.stringify({
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});

// GitHub webhook endpoint
router.post('/api/webhooks/github', async (request) => {
    try {
        const signature = request.headers.get('X-Hub-Signature-256');
        const event = request.headers.get('X-GitHub-Event');
        const body = await request.text();

        // Verify webhook signature
        const githubApp = new GitHubAppAuth(request.env);

        if (!githubApp.verifyWebhookSignature(body, signature)) {
            return new Response('Invalid signature', { status: 401 });
        }

        const payload = JSON.parse(body);

        // Handle different webhook events
        switch (event) {
            case 'installation':
                // Handle app installation/uninstallation
                await handleInstallationEvent(payload, request.db);
                break;

            case 'pull_request':
                // Track PR events
                await handlePullRequestEvent(payload, request.db);
                break;

            case 'push':
                // Handle push events if needed
                await handlePushEvent(payload, request.db);
                break;
        }

        return new Response('OK', { status: 200 });

    } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Internal error', { status: 500 });
    }
});

// Repository configuration
router.get('/api/repositories', TranslationHandler.getRepositories);
router.get('/api/repositories/:owner/:repo/languages', TranslationHandler.getLanguages);

// Language management
router.post('/api/languages', TranslationHandler.createLanguage);

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

// Admin configuration endpoints
router.get('/api/admin/config/repositories', async (request) => {
    try {
        const session = await AuthHandler.requireAuth(request);

        if (!session.isAdmin) {
            return new Response(JSON.stringify({
                error: 'Unauthorized'
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const repos = await request.env.KV_BINDING.get('configured-repositories', 'json') || [];

        return new Response(JSON.stringify({
            success: true,
            repositories: repos
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});

router.put('/api/admin/config/repositories', async (request) => {
    try {
        const session = await AuthHandler.requireAuth(request);

        if (!session.isAdmin) {
            return new Response(JSON.stringify({
                error: 'Unauthorized'
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { repositories } = await request.json();

        await request.env.KV_BINDING.put(
            'configured-repositories',
            JSON.stringify(repositories)
        );

        // Clear cache
        await request.env.KV_BINDING.delete('repositories-config');

        return new Response(JSON.stringify({
            success: true,
            message: 'Repository configuration updated'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});

// Health check
router.get('/api/health', () => new Response('OK', { status: 200 }));

// Handle OPTIONS for CORS preflight
router.options('*', (request, env) => {
    return corsResponse(new Response(null, { status: 204 }), env, request);
});

// 404 handler
router.all('*', () => new Response('Not Found', { status: 404 }));

// Webhook event handlers
async function handleInstallationEvent(payload, db) {
    const { action, installation } = payload;

    if (action === 'created') {
        await db.db.prepare(`
            INSERT OR REPLACE INTO github_app_installations
            (installation_id, account_type, account_login, account_id, 
             repository_selection, events, permissions)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            installation.id,
            installation.account.type,
            installation.account.login,
            installation.account.id,
            installation.repository_selection,
            JSON.stringify(installation.events),
            JSON.stringify(installation.permissions)
        ).run();
    } else if (action === 'deleted') {
        await db.db.prepare(`
            UPDATE github_app_installations 
            SET is_active = 0 
            WHERE installation_id = ?
        `).bind(installation.id).run();
    }
}

async function handlePullRequestEvent(payload, db) {
    const { action, pull_request } = payload;

    if (action === 'opened' || action === 'closed') {
        // Track PR events for analytics
        await db.db.prepare(`
            INSERT INTO pr_events (pr_number, action, repository, created_at)
            VALUES (?, ?, ?, datetime('now'))
        `).bind(
            pull_request.number,
            action,
            payload.repository.full_name
        ).run();
    }
}

async function handlePushEvent(payload, db) {
    // Implement if needed for tracking merged translations
}

// Main worker handler
export default {
    async fetch(request, env, ctx) {
        try {
            // Add context to request
            await withContext(request, env);

            // Route the request
            const response = await router.handle(request, env, ctx);

            // Add CORS headers
            return corsResponse(response, env, request);

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

            return corsResponse(errorResponse, env, request);
        }
    }
};