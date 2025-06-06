# PO Translation Tool - Local Development Setup

This guide will help you set up the PO Translation Tool to run locally with a remote Cloudflare Worker backend.

## Prerequisites

- Node.js 18+
- Python 3 (for serving the frontend)
- Git
- Cloudflare account (free tier works)

## Quick Setup

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd po-translation-tool
npm install
```

### 2. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 3. Login to Cloudflare

```bash
wrangler login
```

### 4. Create Required Resources

Create a KV namespace for session storage:
```bash
wrangler kv:namespace create po_translations
wrangler kv:namespace create po_translations --preview
```

Create a D1 database:
```bash
wrangler d1 create po-translation-db
```

**Save the IDs returned by these commands - you'll need them in the next step.**

### 5. Configure wrangler.toml

Copy the template and fill in your IDs:
```bash
cp wrangler.toml.template wrangler.toml
```

Edit `wrangler.toml` and replace the empty `id` fields with the IDs from step 4:
```toml
[[kv_namespaces]]
binding = "gander_social_translations"
id = "your-kv-namespace-id-here"
preview_id = "your-preview-kv-namespace-id-here"

[[d1_databases]]
binding = "DB"
database_name = "po-translation-db"
database_id = "your-d1-database-id-here"
```

### 6. Initialize Database Schema

Apply the database schema:
```bash
wrangler d1 execute po-translation-db --file=./schema.sql --local
wrangler d1 execute po-translation-db --file=./schema.sql --remote
```

Seed with test data (optional):
```bash
wrangler d1 execute po-translation-db --file=./tests/seed-data.sql --local
```

### 7. Deploy the Worker

```bash
wrangler deploy
```

**Important:** After deployment, note the worker URL (e.g., `https://po-translation-tool.your-subdomain.workers.dev`)

### 8. Configure Frontend for Your Worker

Edit `config.local.js` and update the worker URL:
```javascript
window.WORKER_URL = 'https://your-worker-url.workers.dev';
```

## Running Locally

### Option 1: Use the Development Script

```bash
chmod +x start-dev.sh
./start-dev.sh
```

### Option 2: Manual Start

Start the worker (for development and testing):
```bash
wrangler dev
```

In another terminal, start the frontend:
```bash
python3 -m http.server 8000
```

## Access the Application

1. Open your browser to: `http://localhost:8000`
2. Login using one of these methods:
   - **Invite Token**: `DEV-TOKEN-123` (works out of the box)
   - **GitHub Token**: Your Personal Access Token with `repo` scope

## Testing GitHub Integration

To test with real GitHub repositories:

1. Create a Personal Access Token:
   - Go to GitHub Settings > Developer settings > Personal access tokens
   - Generate token with `repo` scope
   - Use this token to login to the app

2. Configure a test repository in `config/repositories.json` (optional)

3. The app will automatically detect languages in your repository structure

## Configuration for Production

### Frontend Deployment (GitHub Pages)

1. Update `wrangler.toml` FRONTEND_URL to your GitHub Pages URL
2. Deploy the worker: `wrangler deploy`
3. Push to GitHub - Pages will auto-deploy

### Environment Variables

For production, set these in Cloudflare Dashboard:
- `JWT_SECRET`: A secure random string
- `GITHUB_APP_TOKEN`: For automated PR creation (optional)

## Troubleshooting

### "CORS Error"
- Ensure your worker is deployed and the URL in `config.local.js` is correct
- Check that the worker's CORS settings allow your frontend origin

### "Database Error"
- Verify the database schema was applied: `wrangler d1 execute po-translation-db --command="SELECT name FROM sqlite_master WHERE type='table';" --remote`
- Re-run the schema if needed

### "Cannot find repository"
- Ensure your GitHub token has access to the repository
- Check that the repository structure matches expectations (contains locale files)

### Worker Not Starting
- Check for syntax errors: `wrangler dev`
- Verify all dependencies are installed: `npm install`

## Development Features

When running locally (`localhost`), the app automatically:
- Loads local configuration
- Enables debug logging
- Uses development-friendly CORS settings
- Provides test authentication tokens

## File Structure

```
po-translation-tool/
├── index.html              # Frontend application
├── config.local.js         # Local development config
├── scripts/                # Frontend JavaScript
├── src/                    # Cloudflare Worker backend
├── wrangler.toml.template  # Configuration template
├── schema.sql              # Database schema
└── start-dev.sh           # Development startup script
```

## Support

If you encounter issues:
1. Check the browser developer console for errors
2. Check the worker logs: `wrangler tail`
3. Verify your configuration matches this guide
4. Ensure all required Cloudflare resources are created

## Next Steps

Once everything is working:
1. Add your repositories to the configuration
2. Invite translators and provide them with invite tokens
3. Set up GitHub Actions for automated PR processing (see `.github/workflows/`)
4. Configure production environment variables

🪶 _Supporting Indigenous language preservation through technology_
