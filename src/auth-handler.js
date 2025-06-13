import jwt from '@tsndr/cloudflare-worker-jwt';

export class AuthHandler {
    static async generateSessionToken(userId, authMethod, env) {
        // Use a fallback secret if JWT_SECRET is not set (for development)
        const secret = env.JWT_SECRET || 'fallback-development-secret-change-in-production';

        const token = await jwt.sign({
            userId,
            authMethod,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        }, secret);

        return token;
    }

    static async githubAuth(request) {
        try {
            const { token } = await request.json();

            if (!token) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Token required'
                }), {
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
                const errorText = await githubResponse.text();
                console.error('GitHub API error:', errorText);

                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid GitHub token',
                    details: `GitHub API responded with ${githubResponse.status}`
                }), {
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
            const sessionData = {
                userId: user.id,
                authMethod: 'github',
                githubToken: token,
                githubUsername: githubUser.login,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };

            try {
                await request.env.KV_BINDING.put(
                    `session:${sessionToken}`,
                    JSON.stringify(sessionData),
                    { expirationTtl: 86400 } // 24 hours
                );
            } catch (kvError) {
                console.error('KV storage error:', kvError);
                // Continue anyway - session might still work with JWT validation
            }

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
                success: false,
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
                    success: false,
                    error: 'Invite token and email required'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get valid tokens from KV
            let validTokens;
            try {
                validTokens = await request.env.KV_BINDING.get('valid_tokens', 'json');
            } catch (kvError) {
                console.error('KV error getting valid tokens:', kvError);
                validTokens = null;
            }

            // Default tokens for development/testing
            if (!validTokens) {
                validTokens = {
                    tokens: ['TRANSLATOR-2024-ALPHA-001', 'DEV-TOKEN-123', 'TEST-TOKEN-456'],
                    validUntil: '2025-12-31'
                };

                // Try to store default tokens
                try {
                    await request.env.KV_BINDING.put('valid_tokens', JSON.stringify(validTokens));
                } catch (kvError) {
                    console.error('KV error storing default tokens:', kvError);
                }
            }

            if (!validTokens.tokens.includes(inviteToken)) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid invite token'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check token expiration
            if (validTokens.validUntil && new Date(validTokens.validUntil) < new Date()) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invite token expired'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Create user
            const user = await request.db.createUser(email, name || email, 'token');

            // Generate session token
            const sessionToken = await AuthHandler.generateSessionToken(user.id, 'token', request.env);

            // Store session in KV
            const sessionData = {
                userId: user.id,
                authMethod: 'token',
                inviteToken,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };

            try {
                await request.env.KV_BINDING.put(
                    `session:${sessionToken}`,
                    JSON.stringify(sessionData),
                    { expirationTtl: 86400 }
                );
            } catch (kvError) {
                console.error('KV storage error:', kvError);
                // Continue anyway
            }

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
                success: false,
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
                return new Response(JSON.stringify({
                    valid: false,
                    error: 'No authorization header'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const sessionToken = authHeader.substring(7);
            const secret = request.env.JWT_SECRET || 'fallback-development-secret-change-in-production';

            // First verify JWT structure and signature
            let isValid;
            let payload;

            try {
                isValid = await jwt.verify(sessionToken, secret);
                if (isValid) {
                    payload = jwt.decode(sessionToken);
                }
            } catch (jwtError) {
                console.error('JWT verification error:', jwtError);
                isValid = false;
            }

            if (!isValid || !payload) {
                return new Response(JSON.stringify({
                    valid: false,
                    error: 'Invalid token format or signature'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check JWT expiration
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                return new Response(JSON.stringify({
                    valid: false,
                    error: 'Token expired'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get session from KV (if available)
            let session = null;
            try {
                session = await request.env.KV_BINDING.get(`session:${sessionToken}`, 'json');
            } catch (kvError) {
                console.error('KV error getting session:', kvError);
                // Continue without KV session data
            }

            // If no session in KV but JWT is valid, try to get user from DB
            let user = null;
            if (payload.userId) {
                try {
                    user = await request.db.getUserById(payload.userId);
                } catch (dbError) {
                    console.error('Database error getting user:', dbError);
                }
            }

            // If we have session data, check expiration
            if (session && session.expiresAt && new Date(session.expiresAt) < new Date()) {
                // Clean up expired session
                try {
                    await request.env.KV_BINDING.delete(`session:${sessionToken}`);
                } catch (kvError) {
                    console.error('KV error deleting expired session:', kvError);
                }

                return new Response(JSON.stringify({
                    valid: false,
                    error: 'Session expired'
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Build user response
            const userResponse = {
                id: payload.userId,
                name: user?.name || 'Unknown User',
                email: user?.email || 'unknown@example.com',
                authMethod: payload.authMethod || 'unknown',
                githubUsername: user?.github_username
            };

            return new Response(JSON.stringify({
                valid: true,
                user: userResponse
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Validation error:', error);
            return new Response(JSON.stringify({
                valid: false,
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
            throw new Error('Unauthorized - No auth header');
        }

        const sessionToken = authHeader.substring(7);
        const secret = request.env.JWT_SECRET || 'fallback-development-secret-change-in-production';

        // Verify JWT
        let isValid;
        let payload;

        try {
            isValid = await jwt.verify(sessionToken, secret);
            if (isValid) {
                payload = jwt.decode(sessionToken);
            }
        } catch (jwtError) {
            console.error('JWT verification error in requireAuth:', jwtError);
            throw new Error('Invalid token');
        }

        if (!isValid || !payload) {
            throw new Error('Invalid token');
        }

        // Check expiration
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expired');
        }

        // Get session from KV (if available)
        let session = null;
        try {
            session = await request.env.KV_BINDING.get(`session:${sessionToken}`, 'json');
        } catch (kvError) {
            console.warn('KV error in requireAuth, continuing with JWT only:', kvError);
            // Create minimal session from JWT
            session = {
                userId: payload.userId,
                authMethod: payload.authMethod,
                expiresAt: new Date(payload.exp * 1000).toISOString()
            };
        }

        if (session && session.expiresAt && new Date(session.expiresAt) < new Date()) {
            throw new Error('Session expired');
        }

        // Add session info to request
        request.session = session || {
            userId: payload.userId,
            authMethod: payload.authMethod
        };
        request.userId = payload.userId;

        return session;
    }
}