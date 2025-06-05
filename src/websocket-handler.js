export class WebSocketHandler {
    static async handleUpgrade(request) {
        const url = new URL(request.url);
        const repo = url.searchParams.get('repo');
        const language = url.searchParams.get('language');
        const token = url.searchParams.get('token');

        if (!repo || !language || !token) {
            return new Response('Missing parameters', { status: 400 });
        }

        // Verify session token
        const session = await request.env.gander_social_translations.get(
            `session:${token}`,
            'json'
        );

        if (!session || new Date(session.expiresAt) < new Date()) {
            return new Response('Invalid session', { status: 401 });
        }

        // Create WebSocket pair
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // Accept the WebSocket connection
        server.accept();

        // Store connection info
        const connectionId = crypto.randomUUID();
        const connectionInfo = {
            userId: session.userId,
            repo,
            language,
            connectionId,
            connectedAt: new Date().toISOString()
        };

        // Store in KV for broadcasting
        await request.env.gander_social_translations.put(
            `ws:${connectionId}`,
            JSON.stringify(connectionInfo),
            { expirationTtl: 3600 } // 1 hour
        );

        // Handle messages
        server.addEventListener('message', async (event) => {
            await this.handleMessage(server, event, connectionInfo, request.env);
        });

        // Handle close
        server.addEventListener('close', async () => {
            await request.env.gander_social_translations.delete(`ws:${connectionId}`);
        });

        return new Response(null, {
            status: 101,
            webSocket: client
        });
    }

    static async handleMessage(ws, event, connectionInfo, env) {
        try {
            const message = JSON.parse(event.data);
            const { type, msgid, user } = message;

            switch (type) {
                case 'startEdit':
                    // Broadcast to other users
                    await this.broadcast(env, connectionInfo, {
                        type: 'startEdit',
                        msgid,
                        user,
                        userId: connectionInfo.userId
                    });
                    break;

                case 'endEdit':
                    // Broadcast to other users
                    await this.broadcast(env, connectionInfo, {
                        type: 'endEdit',
                        msgid,
                        user,
                        userId: connectionInfo.userId
                    });
                    break;

                case 'ping':
                    // Heartbeat
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default:
                    console.log('Unknown message type:', type);
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    }

    static async broadcast(env, sender, message) {
        // Get all active connections for the same repo/language
        const { repo, language, connectionId: senderId } = sender;

        // In a production system, you'd use Durable Objects for this
        // For now, we'll use a simplified approach with KV

        // This is a simplified broadcast - in production, use Durable Objects
        console.log(`Broadcasting message from ${senderId}:`, message);

        // Note: Real broadcasting would require maintaining active WebSocket
        // connections in a Durable Object or similar persistent storage
    }

    static async handleClose(ws, code, reason, wasClean) {
        console.log('WebSocket closed:', { code, reason, wasClean });
    }
}

// Note: For production use, implement a Durable Object for WebSocket handling
// This provides just the basic structure