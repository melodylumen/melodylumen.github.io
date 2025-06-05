# PO Translation Tool - Testing Guide

## Quick Start for Testing

### Prerequisites
- Node.js 18+ and npm
- Python 3 (for local web server)
- Git

### Initial Setup

1. **Clone and install dependencies:**
```bash
git clone <your-repo-url>
cd po-translation-tool
npm install
```

2. **Run the setup script:**
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

This will:
- Install all dependencies
- Create a local D1 database
- Seed test data
- Create development configuration files

3. **Start the development servers:**
```bash
./start-dev.sh
```

This starts:
- Frontend at http://localhost:8000
- Worker API at http://localhost:8787

## Test Credentials

### For Token Authentication:
- **Invite Token**: `DEV-TOKEN-123`
- **Email**: Any valid email
- **Name**: Any name

### For GitHub Authentication:
You'll need a real GitHub Personal Access Token with `repo` scope:
1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Generate new token (classic) with `repo` scope
3. Copy the token and use it to login

### Pre-seeded Test Users:
- **Alice Developer** (GitHub user)
    - Email: alice@example.com
    - Has existing French translations

- **Bob Translator** (Token user)
    - Email: bob@example.com
    - Has existing Spanish translations

## Testing Workflows

### 1. Basic Translation Flow
1. Open http://localhost:8000
2. Login with token `DEV-TOKEN-123`
3. Select "gander-foundation/social-app" repository
4. Choose a language (e.g., French)
5. Edit translations
6. Click "Submit PR"

### 2. Real-time Collaboration Testing
Open two browser windows:
1. Login as different users in each window
2. Select the same repository and language
3. Start editing the same translation
4. You should see real-time indicators

### 3. API Testing
Test the API directly:

```bash
# Health check
curl http://localhost:8787/api/health

# Login with token
curl -X POST http://localhost:8787/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "inviteToken": "DEV-TOKEN-123",
    "email": "test@example.com",
    "name": "Test User"
  }'

# Get repositories (requires auth)
curl http://localhost:8787/api/repositories \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

## Troubleshooting

### Common Issues

1. **"D1_ERROR: no such table"**
    - Run: `wrangler d1 execute gander-social-translation-db --file=./schema.sql --local`

2. **"KV namespace not found"**
    - The KV namespace is created automatically on first use in local mode

3. **CORS errors**
    - Make sure you're accessing the frontend via http://localhost:8000
    - Check that the worker is running on http://localhost:8787

4. **WebSocket connection fails**
    - Durable Objects require wrangler dev to be running
    - Check the console for connection errors

### Debug Mode

Enable debug logging:
```javascript
// In browser console
localStorage.setItem('debug', 'true');
```

View worker logs:
```bash
# In the terminal running wrangler dev
# Logs will appear automatically
```

## Testing Checklist

- [ ] User can login with invite token
- [ ] User can login with GitHub PAT
- [ ] Repository list loads correctly
- [ ] Language selection works
- [ ] Translations load from database
- [ ] User can edit translations
- [ ] Changes are saved locally
- [ ] Real-time collaboration indicators work
- [ ] PR creation simulation works
- [ ] Logout clears session

## Advanced Testing

### Database Inspection

```bash
# View all users
wrangler d1 execute gander-social-translation-db \
  --command="SELECT * FROM users" --local

# View active sessions
wrangler d1 execute gander-social-translation-db \
  --command="SELECT * FROM translation_sessions" --local

# Check translation progress
wrangler d1 execute gander-social-translation-db \
  --command="SELECT * FROM translation_progress" --local
```

### Reset Test Data

```bash
# Re-run seed data
wrangler d1 execute gander-social-translation-db \
  --file=./seed-data.sql --local
```

### Performance Testing

Monitor performance:
1. Open Browser DevTools > Network tab
2. Check API response times
3. Monitor WebSocket messages
4. Use Performance tab for frontend profiling

## Next Steps

Once basic testing is complete:
1. Configure real GitHub repository access
2. Set up production Cloudflare resources
3. Deploy to Cloudflare Workers
4. Configure GitHub Actions for PR creation
5. Add custom languages and repositories

See the full documentation in `docs/` for production deployment.