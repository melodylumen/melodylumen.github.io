# PO Translation Tool - Next Steps & Recommendations

## 1. Implement Durable Objects for WebSocket Handling

The current WebSocket implementation in `websocket-handler.js` is basic and won't scale properly. Here's why you need Durable Objects:

### Current Limitations
- WebSocket connections are ephemeral in Workers
- No way to broadcast to all connected clients
- State isn't shared between Worker instances
- Can't maintain persistent connections across requests

### Durable Objects Solution

```javascript
// src/translation-room.js - Durable Object for real-time collaboration
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
```

### Integration Changes

Update `wrangler.toml`:
```toml
[[durable_objects.bindings]]
name = "TRANSLATION_ROOMS"
class_name = "TranslationRoom"

[[migrations]]
tag = "v2"
new_classes = ["TranslationRoom"]
```

Update the main worker to use Durable Objects:
```javascript
// In src/index.js
router.get('/api/ws', async (request, env) => {
  const roomId = request.headers.get('X-Room-Id');
  if (!roomId) {
    return new Response('Room ID required', { status: 400 });
  }
  
  const id = env.TRANSLATION_ROOMS.idFromName(roomId);
  const room = env.TRANSLATION_ROOMS.get(id);
  
  return room.fetch(request);
});
```

## 2. Security Enhancements

### Input Validation
- Add comprehensive input validation for all API endpoints
- Sanitize file paths to prevent directory traversal
- Implement rate limiting to prevent abuse

### Authentication Improvements
```javascript
// Add JWT-based sessions instead of simple UUIDs
import jwt from '@tsndr/cloudflare-worker-jwt';

async function generateSessionToken(userId, authMethod) {
  const token = await jwt.sign({
    userId,
    authMethod,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  }, env.JWT_SECRET);
  
  return token;
}
```

### CORS Configuration
Update CORS to be more restrictive:
```javascript
const corsHeaders = {
  'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://your-org.github.io',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true'
};
```

## 3. Error Handling & Monitoring

### Structured Error Responses
```javascript
class APIError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Usage
if (!token) {
  throw new APIError('Authentication required', 401, 'AUTH_REQUIRED');
}
```

### Add Sentry Integration
```javascript
// In src/index.js
import { Toucan } from 'toucan-js';

export default {
  async fetch(request, env, ctx) {
    const sentry = new Toucan({
      dsn: env.SENTRY_DSN,
      context: ctx,
      request,
    });

    try {
      // Your existing code
    } catch (error) {
      sentry.captureException(error);
      // Return error response
    }
  }
};
```

## 4. Performance Optimizations

### Database Query Optimization
```javascript
// Add connection pooling and prepared statements
class DatabaseHelper {
  constructor(db) {
    this.db = db;
    this.statements = new Map();
  }

  async prepare(key, sql) {
    if (!this.statements.has(key)) {
      this.statements.set(key, this.db.prepare(sql));
    }
    return this.statements.get(key);
  }

  async getTranslationsBatch(sessionIds) {
    const placeholders = sessionIds.map(() => '?').join(',');
    const stmt = await this.prepare(
      'batch_translations',
      `SELECT * FROM translation_progress 
       WHERE session_id IN (${placeholders})
       ORDER BY msgid`
    );
    return stmt.bind(...sessionIds).all();
  }
}
```

### Caching Strategy
```javascript
// Add KV caching for frequently accessed data
async function getCachedTranslations(env, repo, language) {
  const cacheKey = `translations:${repo}:${language}`;
  const cached = await env.KV.get(cacheKey, 'json');
  
  if (cached && cached.timestamp > Date.now() - 3600000) { // 1 hour
    return cached.data;
  }
  
  // Fetch fresh data
  const fresh = await fetchTranslations(repo, language);
  
  // Cache it
  await env.KV.put(cacheKey, JSON.stringify({
    data: fresh,
    timestamp: Date.now()
  }), { expirationTtl: 3600 });
  
  return fresh;
}
```

## 5. Frontend Enhancements

### Progressive Web App
Add PWA capabilities for offline translation work:
```javascript
// service-worker.js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('po-tool-v1').then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/styles/main.css',
        '/scripts/app.js',
        // ... other assets
      ]);
    })
  );
});
```

### Autosave with Conflict Resolution
```javascript
class TranslationSync {
  constructor(api) {
    this.api = api;
    this.pendingChanges = new Map();
    this.syncInterval = null;
  }

  startAutoSync() {
    this.syncInterval = setInterval(() => {
      this.syncPendingChanges();
    }, 5000); // Every 5 seconds
  }

  async syncPendingChanges() {
    if (this.pendingChanges.size === 0) return;
    
    const changes = Array.from(this.pendingChanges.values());
    
    try {
      await this.api.batchSaveTranslations(changes);
      this.pendingChanges.clear();
    } catch (error) {
      // Handle conflicts
      if (error.code === 'CONFLICT') {
        await this.resolveConflicts(error.conflicts);
      }
    }
  }
}
```

## 6. GitHub Integration Improvements

### GitHub App Instead of PAT
Create a GitHub App for better security and permissions:
```javascript
// GitHub App authentication
import { createAppAuth } from '@octokit/auth-app';

const auth = createAppAuth({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  installationId: env.GITHUB_APP_INSTALLATION_ID,
});

const { token } = await auth({ type: 'installation' });
```

### Webhook Security
Verify GitHub webhook signatures:
```javascript
function verifyGitHubWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = `sha256=${hmac.digest('hex')}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}
```

## 7. Testing Strategy

### Unit Tests
```javascript
// tests/translation-manager.test.js
import { describe, it, expect } from 'vitest';
import { TranslationManager } from '../scripts/translation-manager.js';

describe('TranslationManager', () => {
  it('should parse PO files correctly', () => {
    const poContent = `
msgid "hello"
msgstr "bonjour"
    `;
    
    const manager = new TranslationManager();
    const result = manager.parsePOFile(poContent);
    
    expect(result.hello).toBe('bonjour');
  });
});
```

### Integration Tests
```javascript
// tests/api.test.js
import { unstable_dev } from 'wrangler';

describe('API Integration', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.js', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should authenticate with GitHub', async () => {
    const response = await worker.fetch('/api/auth/github', {
      method: 'POST',
      body: JSON.stringify({ token: 'test-token' }),
    });
    
    expect(response.status).toBe(200);
  });
});
```

## 8. Monitoring & Analytics

### Translation Analytics Dashboard
```javascript
// Add analytics endpoints
router.get('/api/analytics/overview', async (request) => {
  const stats = await db.getTranslationStats();
  
  return new Response(JSON.stringify({
    totalTranslations: stats.total,
    activeTranslators: stats.activeUsers,
    languageProgress: stats.byLanguage,
    recentActivity: stats.recentChanges
  }));
});
```

### Real-time Metrics
```javascript
// Track performance metrics
class MetricsCollector {
  async trackTranslation(userId, language, wordCount, duration) {
    await env.ANALYTICS.writeDataPoint({
      blobs: ['translation_completed'],
      doubles: [wordCount, duration],
      indexes: [userId, language]
    });
  }
}
```

## 9. Deployment Pipeline

### GitHub Actions for Cloudflare Deployment
```yaml
name: Deploy to Cloudflare
on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'wrangler.toml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npm run test
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy
```

## 10. Documentation

### API Documentation with OpenAPI
```yaml
# openapi.yaml
openapi: 3.0.0
info:
  title: PO Translation Tool API
  version: 1.0.0
paths:
  /api/auth/github:
    post:
      summary: Authenticate with GitHub
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                token:
                  type: string
      responses:
        200:
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  sessionToken:
                    type: string
                  user:
                    type: object
```

## Priority Order for Implementation

1. **Durable Objects** (Critical for scaling)
2. **Security enhancements** (Authentication, validation)
3. **Error handling & monitoring** (Sentry, structured errors)
4. **GitHub App migration** (Better than PAT)
5. **Testing suite** (Ensure reliability)
6. **Performance optimizations** (Caching, query optimization)
7. **PWA features** (Offline capability)
8. **Analytics dashboard** (Track usage)
9. **API documentation** (For contributors)
10. **Autosave & conflict resolution** (UX improvement)

## Estimated Timeline

- **Week 1-2**: Durable Objects + Security
- **Week 3**: Error handling + GitHub App
- **Week 4**: Testing suite
- **Week 5**: Performance + PWA
- **Week 6**: Analytics + Documentation

This roadmap will transform your translation tool into a production-ready system that can handle real-time collaboration at scale while maintaining security and performance.