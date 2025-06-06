# PO Translation Tool

A web-based tool for editing `.po` translation files with real-time collaboration, progress tracking, and automated pull request creation. Designed specifically to support Indigenous language preservation through technology.

## Features

### Core Features
- 📝 **Web-based PO file editing** - Edit translations directly in your browser
- 🌐 **Dynamic language detection** - Automatically detects available languages from repository
- ➕ **Create new languages** - Add support for new languages with proper file structure
- 🔄 **Real-time collaboration** - See who's editing what in real-time
- 📊 **Progress tracking** - Track translation progress across sessions
- 🔀 **Smart branch management** - Automatic grouping of changes by language and date
- 🤖 **Automated PR creation** - Submit changes as pull requests automatically

### Authentication Options
- **GitHub OAuth** - Full features including language creation and direct PR submission
- **Invite Tokens** - For non-GitHub users with limited features

## Quick Start

### For Translators

1. **Access the tool**: Navigate to the hosted URL (e.g., `https://your-org.github.io/po-translation-tool`)

2. **Login**:
    - **GitHub users**: Use your Personal Access Token with `repo` scope
    - **Other users**: Use the invite token provided by your organization

3. **Select repository and language**:
    - Choose the repository you want to translate
    - Select an existing language or create a new one (GitHub auth required)

4. **Translate**:
    - Edit translations in the web interface
    - Changes are auto-saved locally
    - See real-time indicators when others are editing

5. **Submit changes**:
    - Review your changes
    - Submit as a pull request
    - Changes are grouped by language and date

### Creating a New Language (GitHub Auth Required)

1. After selecting a repository, click **"+ Create New Language"**
2. Enter:
    - **Language code**: Standard ISO code (e.g., 'fr', 'es', 'cree')
    - **Language name**: Full name of the language
    - **Source language**: Usually 'en' to copy all message IDs
3. Click "Create Language"
4. The new language directory and PO file will be created automatically

## Installation & Setup

### Prerequisites
- Node.js 18+
- Cloudflare account (for Workers)
- GitHub repository with appropriate permissions

### 1. Clone and Install

```bash
git clone https://github.com/gander-foundation/po-translation-tool.git
cd po-translation-tool
npm install
```

### 2. Configure Cloudflare Worker

Update `wrangler.toml`:
```toml
name = "your-translation-tool"
[vars]
FRONTEND_URL = "https://your-org.github.io"
JWT_SECRET = "your-secret-key" # Change in production!
```

### 3. Initialize Database

```bash
# Create D1 database
wrangler d1 create po-translation-db

# Apply schema
wrangler d1 execute po-translation-db --file=./schema.sql --local

# Deploy to Cloudflare
wrangler deploy
```

### 4. Configure GitHub Actions

Add to your translation repository:
1. Copy `.github/workflows/process-translations.yml`
2. Copy `.github/scripts/process-translations.js`
3. Add secrets:
    - `GITHUB_TOKEN` (automatic)
    - `CLOUDFLARE_API_TOKEN` (optional)

### 5. Deploy Frontend

The frontend automatically deploys via GitHub Actions when you push to main.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  GitHub Pages   │────▶│ Cloudflare      │────▶│    GitHub       │
│  (Frontend)     │     │ Workers (API)   │     │  Repository     │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   D1 Database   │
                        │ (Session/Progress)│
                        └─────────────────┘
```

## Configuration

### Repository Configuration

Create or update `config/repositories.json`:
```json
{
  "repositories": [
    {
      "owner": "your-org",
      "name": "your-app",
      "description": "Your application",
      "translationPath": "src/locale/locales",
      "requiresAuth": true
    }
  ]
}
```

### Supported Languages

Languages are now dynamically detected from the repository structure. To add language name mappings, update `scripts/config.js`:

```javascript
LANGUAGE_NAMES: {
    cr: 'Cree (ᓀᐦᐃᔭᐍᐏᐣ)',
    iu: 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)',
    // Add more as needed
}
```

## Branch Management

The tool automatically manages branches to prevent conflicts:

- Branch naming: `language-update-{language-code}-{yyyy-mm-dd}`
- All changes for a language on a given day go to the same branch
- Existing branches are reused
- PRs are updated instead of creating duplicates

## API Endpoints

### Authentication
- `POST /api/auth/github` - Authenticate with GitHub
- `POST /api/auth/token` - Authenticate with invite token
- `GET /api/auth/validate` - Validate session

### Repositories & Languages
- `GET /api/repositories` - List available repositories
- `GET /api/repositories/:owner/:repo/languages` - Get languages (dynamic)
- `POST /api/languages` - Create new language (GitHub auth required)

### Translations
- `GET /api/translations/:repo/:language` - Get translations
- `POST /api/translations/:repo/:language` - Save translation
- `GET /api/translations/changes` - Get pending changes
- `POST /api/translations/submit-pr` - Submit pull request

## Security

### Authentication Levels
1. **GitHub Users**: Full access including language creation
2. **Token Users**: Translation editing only

### Best Practices
- Use environment variables for sensitive data
- Implement rate limiting
- Regular security audits
- Monitor PR submissions

## Development

### Local Development

```bash
# Start the worker locally
wrangler dev

# In another terminal, start the frontend
python3 -m http.server 8000

# Access at http://localhost:8000
```

### Testing

```bash
# Run tests
npm test

# Test GitHub Actions locally
act -j process-translation
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

### Code Style
- Use ES6+ features
- Follow existing patterns
- Add comments for complex logic
- Update documentation

## Troubleshooting

### Common Issues

1. **"Cannot create language"**
    - Ensure you're using GitHub authentication
    - Check repository write permissions

2. **"Branch already exists"**
    - This is normal - the tool reuses existing branches
    - Check for open PRs that need review

3. **WebSocket connection fails**
    - Check that Durable Objects are configured
    - Verify CORS settings

## License

MIT License - See LICENSE file for details

## Acknowledgments

This tool was created to support Indigenous language preservation efforts, with special focus on:
- Cree (ᓀᐦᐃᔭᐍᐏᐣ)
- Inuktitut (ᐃᓄᒃᑎᑐᑦ)
- Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ)
- Mi'kmaq
- Innu-aimun

🪶 _Supporting Indigenous language preservation through technology_