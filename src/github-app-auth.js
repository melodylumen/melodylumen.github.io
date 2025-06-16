// src/github-app-auth.js
import jwt from '@tsndr/cloudflare-worker-jwt';
import { AuthHandler } from './auth-handler.js';

export class GitHubAppAuth {
    constructor(env) {
        this.env = env;
        this.appId = env.GITHUB_APP_ID;
        this.privateKey = env.GITHUB_APP_PRIVATE_KEY;
        this.clientId = env.GITHUB_APP_CLIENT_ID;
        this.clientSecret = env.GITHUB_APP_CLIENT_SECRET;
        this.webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET;
    }

    // Generate JWT for GitHub App authentication
    async generateAppJWT() {
        const now = Math.floor(Date.now() / 1000);

        const payload = {
            iat: now - 60, // Issued 60 seconds ago to account for clock drift
            exp: now + 600, // Expires in 10 minutes
            iss: this.appId
        };

        // GitHub requires RS256 algorithm
        // We'll need to use a library that supports RS256 with private keys
        // For now, we'll use a placeholder - in production, use @octokit/auth-app
        const token = await this.signJWT(payload, this.privateKey);
        return token;
    }

    // Placeholder for RS256 signing - replace with proper implementation
    async signJWT(payload, privateKey) {
        // In production, use a proper RS256 signing library
        // For Cloudflare Workers, consider using SubtleCrypto or a compatible library
        throw new Error('RS256 signing not implemented - use @octokit/auth-app or similar');
    }

    // Get installation access token
    async getInstallationToken(installationId) {
        const appJWT = await this.generateAppJWT();

        const response = await fetch(
            `https://api.github.com/app/installations/${installationId}/access_tokens`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appJWT}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'PO-Translation-Tool'
                }
            }
        );

        if (!response.ok) {
            throw new Error('Failed to get installation token');
        }

        const data = await response.json();
        return data.token;
    }

    // OAuth flow - Step 1: Redirect to GitHub
    static getAuthorizationURL(clientId, redirectUri, state) {
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            state: state,
            scope: 'user:email read:user'
        });

        return `https://github.com/login/oauth/authorize?${params}`;
    }

    // OAuth flow - Step 2: Handle callback
    async handleOAuthCallback(code, state) {
        // Verify state to prevent CSRF
        const storedState = await this.env.KV_BINDING.get(`oauth_state:${state}`);
        if (!storedState) {
            throw new Error('Invalid state parameter');
        }

        // Clean up state
        await this.env.KV_BINDING.delete(`oauth_state:${state}`);

        // Exchange code for access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code
            })
        });

        if (!tokenResponse.ok) {
            throw new Error('Failed to exchange code for token');
        }

        const tokenData = await tokenResponse.json();

        // Get user information
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'PO-Translation-Tool'
            }
        });

        if (!userResponse.ok) {
            throw new Error('Failed to get user information');
        }

        const githubUser = await userResponse.json();

        // Get user emails if primary email is not public
        let email = githubUser.email;
        if (!email) {
            const emailsResponse = await fetch('https://api.github.com/user/emails', {
                headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'PO-Translation-Tool'
                }
            });

            if (emailsResponse.ok) {
                const emails = await emailsResponse.json();
                const primaryEmail = emails.find(e => e.primary);
                email = primaryEmail?.email || `${githubUser.login}@users.noreply.github.com`;
            }
        }

        return {
            user: githubUser,
            email: email,
            accessToken: tokenData.access_token,
            scope: tokenData.scope
        };
    }

    // Initialize OAuth flow
    async initiateOAuth(request) {
        const state = crypto.randomUUID();

        // Store state for verification
        await this.env.KV_BINDING.put(
            `oauth_state:${state}`,
            JSON.stringify({
                created: Date.now(),
                ip: request.headers.get('CF-Connecting-IP')
            }),
            { expirationTtl: 600 } // 10 minutes
        );

        const redirectUri = this.env.GITHUB_OAUTH_CALLBACK_URL ||
            'https://melodylumen.github.io/auth/callback';

        const authUrl = GitHubAppAuth.getAuthorizationURL(
            this.clientId,
            redirectUri,
            state
        );

        return new Response(JSON.stringify({
            authUrl,
            state
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Complete OAuth flow and create session
    async completeOAuth(request) {
        const { code, state } = await request.json();

        if (!code || !state) {
            return new Response(JSON.stringify({
                error: 'Missing code or state parameter'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const { user, email, accessToken } = await this.handleOAuthCallback(code, state);

            // Create or update user in database
            const dbUser = await request.db.createUser(
                email,
                user.name || user.login,
                'github-app',
                user.login
            );

            // Check if user has admin permissions
            const isAdmin = await this.checkAdminStatus(user.login);

            // Generate session token
            const sessionToken = await AuthHandler.generateSessionToken(
                dbUser.id,
                'github-app',
                this.env
            );

            // Store session with GitHub access token
            await this.env.KV_BINDING.put(
                `session:${sessionToken}`,
                JSON.stringify({
                    userId: dbUser.id,
                    authMethod: 'github-app',
                    githubToken: accessToken,
                    githubUsername: user.login,
                    isAdmin: isAdmin,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }),
                { expirationTtl: 86400 }
            );

            return new Response(JSON.stringify({
                success: true,
                sessionToken,
                user: {
                    id: dbUser.id,
                    name: user.name || user.login,
                    email: email,
                    githubUsername: user.login,
                    isAdmin: isAdmin
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('OAuth completion error:', error);
            return new Response(JSON.stringify({
                error: 'OAuth authentication failed',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Check if user is an admin
    async checkAdminStatus(githubUsername) {
        // Get admin list from KV
        const adminList = await this.env.KV_BINDING.get('admin_users', 'json') || {
            users: [],
            teams: []
        };

        // Check if user is in admin list
        if (adminList.users.includes(githubUsername)) {
            return true;
        }

        // Check team membership if configured
        // This would require additional API calls to check organization team membership

        return false;
    }

    // Verify webhook signature
    verifyWebhookSignature(payload, signature) {
        const expectedSignature = `sha256=${this.createHmac(payload, this.webhookSecret)}`;
        return this.timingSafeEqual(signature, expectedSignature);
    }

    // Create HMAC signature
    createHmac(data, secret) {
        // Use Web Crypto API for HMAC
        // This is a placeholder - implement proper HMAC-SHA256
        return 'placeholder';
    }

    // Timing-safe string comparison
    timingSafeEqual(a, b) {
        if (a.length !== b.length) return false;

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }

        return result === 0;
    }
}