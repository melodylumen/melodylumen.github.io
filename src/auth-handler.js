import jwt from '@tsndr/cloudflare-worker-jwt';

export class AuthHandler {
    static async generateSessionToken(userId, authMethod, env) {
        const token = await jwt.sign({
            userId,
            authMethod,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        }, env.JWT_SECRET || 'development-secret');

        return token;
    }

    static async githubAuth(request) {
        try {
            const { token } = await request.json();

            if (!token) {
                return new Response(JSON.stringify({ error: 'Token required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Validate GitHub token
            const githubResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'PO-Translation-Tool'
                }
            });

            if (!githubResponse.ok) {
                return new Response(JSON.stringify({ error: 'Invalid GitHub token' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const githubUser = await githubResponse.json();

            // Create or update user in database
            const user = await request.db.createUser(
                githubUser.email || `${githubUser.login}@users.noreply.github.com`,
                githubUser.name || githubUser.login,
                'github',
                githubUser.login
            );

            // Generate session token
            const sessionToken = await AuthHandler.generateSessionToken(user.id, 'github', request.env);

            // Store session in KV with 24 hour expiration
            await request.env.KV_BINDING.put(
                `session:${sessionToken}`,
                JSON.stringify({
                    userId: user.id,
                    authMethod: 'github',
                    githubToken: token,
                    githubUsername: githubUser.login,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }),
                { expirationTtl: 86400 } // 24 hours
            );

            return new Response(JSON.stringify({
                success: true,
                sessionToken,
                user: {
                    id: user.id,
                    name: githubUser.name || githubUser.login,
                    email: githubUser.email,
                    githubUsername: githubUser.login
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('GitHub auth error:', error);
            return new Response(JSON.stringify({
                error: 'Authentication failed',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async tokenAuth(request) {
        try {
            const { inviteToken, email, name } = await request.json();

            if (!inviteToken || !email) {
                return new Response(JSON.stringify({
                    error: 'Invite token and email required'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get valid tokens from KV
            let validTokens = await request.env.KV_BINDING.get('valid_tokens', 'json');

            // Default tokens for development
            if (!validTokens) {
                validTokens = {
                    tokens: ['TRANSLATOR-2024-ALPHA-001', 'DEV-TOKEN-123'],
                    validUntil: '2025-12-31'
                };
            }

            if (!validTokens.tokens.includes(inviteToken)) {
                return new Response(JSON.stringify({ error: 'Invalid invite token' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check token expiration
            if (validTokens.validUntil && new Date(validTokens.validUntil) < new Date()) {
                return new Response(JSON.stringify({ error: 'Invite token expired' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Create user
            const user = await request.db.createUser(email, name || email, 'token');

            // Generate session token
            const sessionToken = await AuthHandler.generateSessionToken(user.id, 'token', request.env);

            // Store session in KV
            await request.env.KV_BINDING.put(
                `session:${sessionToken}`,
                JSON.stringify({
                    userId: user.id,
                    authMethod: 'token',
                    inviteToken,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }),
                { expirationTtl: 86400 }
            );

            return new Response(JSON.stringify({
                success: true,
                sessionToken,
                user: {
                    id: user.id,
                    name: name || email,
                    email
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Token auth error:', error);
            return new Response(JSON.stringify({
                error: 'Authentication failed',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async validate(request) {
        try {
            const authHeader = request.headers.get('Authorization');

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return new Response(JSON.stringify({ error: 'No authorization header' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const sessionToken = authHeader.substring(7);

            // First check if it's a JWT
            const isValid = await jwt.verify(sessionToken, request.env.JWT_SECRET || 'development-secret');

            if (!isValid) {
                return new Response(JSON.stringify({ error: 'Invalid token' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Decode the token to get user ID
            const payload = jwt.decode(sessionToken);

            // Get session from KV
            const session = await request.env.KV_BINDING.get(
                `session:${sessionToken}`,
                'json'
            );

            if (!session) {
                return new Response(JSON.stringify({ error: 'Session not found' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check expiration
            if (new Date(session.expiresAt) < new Date()) {
                await request.env.KV_BINDING.delete(`session:${sessionToken}`);
                return new Response(JSON.stringify({ error: 'Session expired' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get user details
            const user = await request.db.getUserById(session.userId);

            return new Response(JSON.stringify({
                valid: true,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    authMethod: session.authMethod,
                    githubUsername: user.github_username
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Validation error:', error);
            return new Response(JSON.stringify({
                error: 'Validation failed',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Middleware to verify auth on protected routes
    static async requireAuth(request) {
        const authHeader = request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Unauthorized');
        }

        const sessionToken = authHeader.substring(7);

        // Verify JWT
        const isValid = await jwt.verify(sessionToken, request.env.JWT_SECRET || 'development-secret');
        if (!isValid) {
            throw new Error('Invalid token');
        }

        const session = await request.env.KV_BINDING.get(
            `session:${sessionToken}`,
            'json'
        );

        if (!session || new Date(session.expiresAt) < new Date()) {
            throw new Error('Invalid or expired session');
        }

        // Add session info to request
        request.session = session;
        request.userId = session.userId;

        return session;
    }
}