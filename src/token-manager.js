// src/token-manager.js
import { AuthHandler } from './auth-handler.js';

export class TokenManager {
    constructor(env, db) {
        this.env = env;
        this.db = db;
    }

    // Generate a new invite token
    async generateInviteToken(createdBy, metadata = {}) {
        const token = `TRANS-${Date.now()}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;

        const tokenData = {
            token,
            createdBy,
            createdAt: new Date().toISOString(),
            expiresAt: metadata.expiresAt || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days default
            usageLimit: metadata.usageLimit || null,
            usageCount: 0,
            description: metadata.description || '',
            allowedLanguages: metadata.allowedLanguages || null,
            allowedRepositories: metadata.allowedRepositories || null,
            isActive: true
        };

        // Store in database
        await this.db.db.prepare(`
            INSERT INTO invite_tokens (
                token, created_by, created_at, expires_at,
                usage_limit, usage_count, description,
                allowed_languages, allowed_repositories, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            tokenData.token,
            tokenData.createdBy,
            tokenData.createdAt,
            tokenData.expiresAt,
            tokenData.usageLimit,
            tokenData.usageCount,
            tokenData.description,
            JSON.stringify(tokenData.allowedLanguages),
            JSON.stringify(tokenData.allowedRepositories),
            tokenData.isActive ? 1 : 0
        ).run();

        // Also store in KV for quick validation
        await this.updateTokenCache();

        return tokenData;
    }

    // Validate invite token
    async validateInviteToken(token) {
        const tokenData = await this.db.db.prepare(`
            SELECT * FROM invite_tokens
            WHERE token = ? AND is_active = 1
        `).bind(token).first();

        if (!tokenData) {
            return { valid: false, reason: 'Token not found' };
        }

        // Check expiration
        if (new Date(tokenData.expires_at) < new Date()) {
            return { valid: false, reason: 'Token expired' };
        }

        // Check usage limit
        if (tokenData.usage_limit && tokenData.usage_count >= tokenData.usage_limit) {
            return { valid: false, reason: 'Token usage limit exceeded' };
        }

        return {
            valid: true,
            tokenData: {
                ...tokenData,
                allowed_languages: JSON.parse(tokenData.allowed_languages || 'null'),
                allowed_repositories: JSON.parse(tokenData.allowed_repositories || 'null')
            }
        };
    }

    // Use invite token (increment usage count)
    async useInviteToken(token) {
        await this.db.db.prepare(`
            UPDATE invite_tokens
            SET usage_count = usage_count + 1,
                last_used_at = datetime('now')
            WHERE token = ?
        `).bind(token).run();

        // Update cache
        await this.updateTokenCache();
    }

    // Revoke token
    async revokeToken(token, revokedBy) {
        await this.db.db.prepare(`
            UPDATE invite_tokens
            SET is_active = 0,
                revoked_at = datetime('now'),
                revoked_by = ?
            WHERE token = ?
        `).bind(revokedBy, token).run();

        // Update cache
        await this.updateTokenCache();

        return { success: true };
    }

    // List tokens
    async listTokens(options = {}) {
        let query = `
            SELECT
                t.*,
                u.name as creator_name,
                u.email as creator_email
            FROM invite_tokens t
                     LEFT JOIN users u ON t.created_by = u.id
            WHERE 1=1
        `;

        const bindings = [];

        if (options.active !== undefined) {
            query += ' AND t.is_active = ?';
            bindings.push(options.active ? 1 : 0);
        }

        if (options.createdBy) {
            query += ' AND t.created_by = ?';
            bindings.push(options.createdBy);
        }

        query += ' ORDER BY t.created_at DESC';

        if (options.limit) {
            query += ' LIMIT ?';
            bindings.push(options.limit);
        }

        const results = await this.db.db.prepare(query).bind(...bindings).all();

        return results.results.map(token => ({
            ...token,
            allowed_languages: JSON.parse(token.allowed_languages || 'null'),
            allowed_repositories: JSON.parse(token.allowed_repositories || 'null')
        }));
    }

    // Get token statistics
    async getTokenStats() {
        const stats = await this.db.db.prepare(`
            SELECT
                COUNT(*) as total_tokens,
                COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_tokens,
                COUNT(CASE WHEN is_active = 0 THEN 1 END) as revoked_tokens,
                SUM(usage_count) as total_uses,
                COUNT(CASE WHEN expires_at < datetime('now') THEN 1 END) as expired_tokens
            FROM invite_tokens
        `).first();

        const recentActivity = await this.db.db.prepare(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as tokens_created,
                SUM(usage_count) as uses
            FROM invite_tokens
            WHERE created_at > datetime('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `).all();

        return {
            summary: stats,
            recentActivity: recentActivity.results
        };
    }

    // Update token cache in KV
    async updateTokenCache() {
        const activeTokens = await this.db.db.prepare(`
            SELECT token, expires_at, usage_limit, usage_count
            FROM invite_tokens
            WHERE is_active = 1
              AND (expires_at IS NULL OR expires_at > datetime('now'))
              AND (usage_limit IS NULL OR usage_count < usage_limit)
        `).all();

        const tokenList = activeTokens.results.map(t => t.token);

        await this.env.KV_BINDING.put(
            'valid_tokens',
            JSON.stringify({
                tokens: tokenList,
                lastUpdated: new Date().toISOString()
            }),
            { expirationTtl: 3600 } // Cache for 1 hour
        );
    }

    // Check if user can manage tokens
    async canManageTokens(userId) {
        const session = await this.env.KV_BINDING.get(`session_user:${userId}`, 'json');
        return session?.isAdmin || false;
    }

    // Admin endpoints handlers
    static async handleCreateToken(request) {
        try {
            const session = await AuthHandler.requireAuth(request);
            const tokenManager = new TokenManager(request.env, request.db);

            // Check admin permission
            if (!session.isAdmin) {
                return new Response(JSON.stringify({
                    error: 'Unauthorized. Admin access required.'
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const data = await request.json();
            const token = await tokenManager.generateInviteToken(session.userId, data);

            return new Response(JSON.stringify({
                success: true,
                token
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Create token error:', error);
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async handleListTokens(request) {
        try {
            const session = await AuthHandler.requireAuth(request);
            const tokenManager = new TokenManager(request.env, request.db);

            if (!session.isAdmin) {
                return new Response(JSON.stringify({
                    error: 'Unauthorized. Admin access required.'
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const url = new URL(request.url);
            const options = {
                active: url.searchParams.get('active') === 'true',
                limit: parseInt(url.searchParams.get('limit') || '100')
            };

            const tokens = await tokenManager.listTokens(options);

            return new Response(JSON.stringify({
                success: true,
                tokens
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('List tokens error:', error);
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async handleRevokeToken(request) {
        try {
            const session = await AuthHandler.requireAuth(request);
            const tokenManager = new TokenManager(request.env, request.db);

            if (!session.isAdmin) {
                return new Response(JSON.stringify({
                    error: 'Unauthorized. Admin access required.'
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const { token } = await request.json();
            await tokenManager.revokeToken(token, session.userId);

            return new Response(JSON.stringify({
                success: true,
                message: 'Token revoked successfully'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Revoke token error:', error);
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async handleTokenStats(request) {
        try {
            const session = await AuthHandler.requireAuth(request);
            const tokenManager = new TokenManager(request.env, request.db);

            if (!session.isAdmin) {
                return new Response(JSON.stringify({
                    error: 'Unauthorized. Admin access required.'
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const stats = await tokenManager.getTokenStats();

            return new Response(JSON.stringify({
                success: true,
                stats
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Token stats error:', error);
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}