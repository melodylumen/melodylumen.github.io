export class TranslationRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = new Map(); // connectionId -> session info
        this.activeEditors = new Map(); // msgid -> Set of user IDs
    }

    async fetch(request) {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket", { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        await this.handleSession(server, request);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async handleSession(webSocket, request) {
        webSocket.accept();

        const url = new URL(request.url);
        const sessionId = url.searchParams.get('sessionId');
        const userId = url.searchParams.get('userId');
        const userName = url.searchParams.get('userName');

        const connectionId = crypto.randomUUID();

        this.sessions.set(connectionId, {
            webSocket,
            sessionId,
            userId,
            userName,
            connectedAt: Date.now()
        });

        webSocket.addEventListener('message', async (msg) => {
            await this.handleMessage(connectionId, msg.data);
        });

        webSocket.addEventListener('close', () => {
            this.handleClose(connectionId);
        });
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
            }
        } catch (error) {
            console.error('Message handling error:', error);
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
                    session.webSocket.send(payload);
                } catch (error) {
                    // Connection might be closed
                    this.sessions.delete(connectionId);
                }
            }
        }
    }

    handleClose(connectionId) {
        const session = this.sessions.get(connectionId);
        if (!session) return;

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