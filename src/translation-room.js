import { DurableObject } from "cloudflare:workers";

export class TranslationRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.sessions = new Map(); // connectionId -> session info
        this.activeEditors = new Map(); // msgid -> Set of user IDs
        // Ensure SQLite storage is initialized (dummy query)
        this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS _init_check (id INTEGER PRIMARY KEY)");
    }

    async fetch(request) {
        try {
            if (request.headers.get("Upgrade") !== "websocket") {
                return new Response("Expected WebSocket", { status: 400 });
            }

            const url = new URL(request.url);
            const repo = url.searchParams.get('repo');
            const language = url.searchParams.get('language');
            const sessionId = url.searchParams.get('sessionId');
            
            // Get session data passed from the main worker
            let sessionData;
            try {
                sessionData = JSON.parse(url.searchParams.get('sessionData') || '{}');
            } catch (error) {
                console.error('Invalid session data:', error);
                return new Response("Invalid session data", { status: 400 });
            }

            if (!repo || !language || !sessionId || !sessionData.userId) {
                return new Response("Missing required parameters", { status: 400 });
            }

            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            await this.handleSession(server, {
                repo,
                language,
                sessionId,
                userId: sessionData.userId,
                authMethod: sessionData.authMethod || 'unknown'
            });

            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        } catch (error) {
            console.error('TranslationRoom fetch error:', error);
            return new Response("WebSocket setup failed", { status: 500 });
        }
    }

    async handleSession(webSocket, sessionInfo) {
        try {
            webSocket.accept();

            const connectionId = crypto.randomUUID();

            this.sessions.set(connectionId, {
                webSocket,
                sessionId: sessionInfo.sessionId,
                userId: sessionInfo.userId,
                userName: `User_${sessionInfo.userId.slice(-6)}`, // Generate a readable name
                repo: sessionInfo.repo,
                language: sessionInfo.language,
                connectedAt: Date.now()
            });

            console.log(`WebSocket connected: ${connectionId} for ${sessionInfo.userId}`);

            webSocket.addEventListener('message', async (msg) => {
                await this.handleMessage(connectionId, msg.data);
            });

            webSocket.addEventListener('close', () => {
                this.handleClose(connectionId);
            });

            webSocket.addEventListener('error', (error) => {
                console.error('WebSocket error for connection:', connectionId, error);
                this.handleClose(connectionId);
            });

            // Send welcome message
            webSocket.send(JSON.stringify({
                type: 'connected',
                connectionId,
                message: 'Connected to translation room'
            }));

        } catch (error) {
            console.error('WebSocket session handling error:', error);
            if (webSocket.readyState === WebSocket.CONNECTING || webSocket.readyState === WebSocket.OPEN) {
                webSocket.close(1011, 'Server error');
            }
        }
    }

    async handleMessage(connectionId, message) {
        const session = this.sessions.get(connectionId);
        if (!session) return;

        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'startEdit':
                    await this.handleStartEdit(session, data.msgid);
                    break;
                case 'endEdit':
                    await this.handleEndEdit(session, data.msgid);
                    break;
                case 'translationUpdate':
                    await this.broadcastTranslationUpdate(session, data);
                    break;
                case 'ping':
                    // Respond to heartbeat
                    session.webSocket.send(JSON.stringify({ type: 'pong' }));
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Message handling error:', error);
            session.webSocket.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    }

    async handleStartEdit(session, msgid) {
        if (!this.activeEditors.has(msgid)) {
            this.activeEditors.set(msgid, new Set());
        }

        this.activeEditors.get(msgid).add(session.userId);

        // Broadcast to all other users
        this.broadcast({
            type: 'userStartedEditing',
            msgid,
            userId: session.userId,
            userName: session.userName
        }, session.userId);
    }

    async handleEndEdit(session, msgid) {
        const editors = this.activeEditors.get(msgid);
        if (editors) {
            editors.delete(session.userId);
            if (editors.size === 0) {
                this.activeEditors.delete(msgid);
            }
        }

        this.broadcast({
            type: 'userStoppedEditing',
            msgid,
            userId: session.userId,
            userName: session.userName
        }, session.userId);
    }

    broadcast(message, excludeUserId = null) {
        const payload = JSON.stringify(message);

        for (const [connectionId, session] of this.sessions) {
            if (session.userId !== excludeUserId) {
                try {
                    if (session.webSocket.readyState === WebSocket.OPEN) {
                        session.webSocket.send(payload);
                    }
                } catch (error) {
                    console.error('Broadcast error, removing connection:', connectionId, error);
                    this.sessions.delete(connectionId);
                }
            }
        }
    }

    handleClose(connectionId) {
        const session = this.sessions.get(connectionId);
        if (!session) return;

        console.log(`WebSocket disconnected: ${connectionId}`);

        // Clean up any active edits
        for (const [msgid, editors] of this.activeEditors) {
            if (editors.has(session.userId)) {
                this.handleEndEdit(session, msgid);
            }
        }

        this.sessions.delete(connectionId);

        // Notify others that user disconnected
        this.broadcast({
            type: 'userDisconnected',
            userId: session.userId,
            userName: session.userName
        });
    }
}