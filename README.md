# PO Translation Tool

A web-based tool for editing `.po` translation files with real-time collaboration, progress tracking, and automated pull request creation. Designed specifically to support Indigenous language preservation through technology.

## ⚡ Quick Start

1. **Setup**: Follow the detailed [SETUP.md](./SETUP.md) guide
2. **Run**: `./start-dev.sh` or `npm run start-dev`
3. **Access**: Open http://localhost:8000
4. **Login**: Use token `DEV-TOKEN-123` or your GitHub Personal Access Token

## 🌟 Features

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

## 🚀 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  Frontend       │────▶│ Cloudflare      │────▶│    GitHub       │
│  (Static HTML)  │     │ Workers (API)   │     │  Repository     │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   D1 Database   │
                        │ (Session/Progress)│
                        └─────────────────┘
```

## 📋 Setup

### Prerequisites
- Node.js 18+
- Python 3 (for serving frontend)
- Cloudflare account (free tier works)

### Quick Setup Commands

```bash
# 1. Install dependencies
npm install
npm install -g wrangler

# 2. Check your setup
npm run setup-check

# 3. Follow the detailed setup guide
# See SETUP.md for complete instructions

# 4. Start development
npm run start-dev
```

### For Local Development with Remote Worker

If you already have a deployed worker and just want to run the frontend locally:

1. Create `config.local.js`:
```javascript
window.WORKER_URL = 'https://your-worker-url.workers.dev';
```

2. Start the frontend:
```bash
python3 -m http.server 8000
```

3. Open http://localhost:8000

## 🔧 Configuration

### Repository Configuration

The tool automatically detects languages from your repository structure. To add custom repositories, update the worker's configuration or use the admin interface.

### Supported Languages

Languages are dynamically detected from repository structure. The tool has built-in support for:

**Indigenous Languages:**
- Cree (ᓀᐦᐃᔭᐍᐏᐣ) - `cr`
- Inuktitut (ᐃᓄᒃᑎᑐᑦ) - `iu`
- Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ) - `oj`
- Mi'kmaq - `miq`
- Innu-aimun - `innu`

**Common Languages:**
- English, French, Spanish, German, and 30+ others

## 🛠️ Development

### Project Structure
```
po-translation-tool/
├── index.html              # Frontend application
├── config.local.js         # Local development config
├── scripts/                # Frontend JavaScript
│   ├── app.js             # Main application
│   ├── api-client.js      # API communication
│   └── config.js          # Configuration
├── src/                    # Cloudflare Worker backend
│   ├── index.js           # Main worker
│   ├── auth-handler.js    # Authentication
│   └── translation-handler.js # Translation logic
├── wrangler.toml.template  # Configuration template
└── SETUP.md               # Detailed setup guide
```

### Available Scripts
- `npm run dev` - Start worker locally
- `npm run start-dev` - Start both frontend and worker
- `npm run setup-check` - Verify your setup
- `npm run test` - Run tests
- `npm run deploy` - Deploy to production

## 🌍 For Translators

1. **Access the tool**: Navigate to the hosted URL
2. **Login**: Use invite token or GitHub Personal Access Token
3. **Select repository and language**: Choose what you want to translate
4. **Translate**: Edit translations in the web interface
5. **Submit**: Review changes and create a pull request

### Creating New Languages (GitHub auth required)

1. Click **"+ Create New Language"** after selecting a repository
2. Enter language code (e.g., 'fr', 'cree', 'iu')
3. Enter language name (e.g., 'French', 'Cree')
4. Choose source language to copy from (usually English)

## 📚 Documentation

- [SETUP.md](./SETUP.md) - Complete setup guide
- [API Documentation](./docs/) - API endpoints and usage
- [GitHub Actions Guide](./docs/github-action-pr.md) - Automated PR processing

## 🤝 Contributing

1. Fork the repository
2. Follow the setup guide
3. Make your changes
4. Submit a pull request

## 🐛 Troubleshooting

### Common Issues

1. **CORS errors**: Check worker URL in `config.local.js`
2. **Database errors**: Ensure schema is applied with `npm run db:init`
3. **Authentication issues**: Verify GitHub token has `repo` scope
4. **Worker not starting**: Check `wrangler dev` output for errors

### Getting Help

- Check browser console for frontend errors
- Check worker logs: `wrangler tail`
- Verify setup: `npm run setup-check`
- Review [SETUP.md](./SETUP.md) for detailed instructions

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

This tool was created to support Indigenous language preservation efforts, with special focus on:
- Cree (ᓀᐦᐃᔭᐍᐏᐣ)
- Inuktitut (ᐃᓄᒃᑎᑐᑦ)
- Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ)
- Mi'kmaq
- Innu-aimun

🪶 _Supporting Indigenous language preservation through technology_