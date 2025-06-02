# PO Translation Tool - Setup Guide

## Project Structure

```
po-translation-tool/
├── index.html
├── scripts/
│   ├── auth.js              # Authentication manager
│   ├── config.js            # Repository configuration
│   ├── changeTracker.js     # Track translation changes
│   ├── prManager.js         # Pull request creation
│   └── app.js               # Main application controller
├── config/
│   ├── repositories.json    # List of translatable repositories
│   ├── authorized-tokens.json # Invite tokens (keep private)
│   └── languages.json       # Supported languages
├── styles/
│   └── main.css            # Application styles
└── .github/
    └── workflows/
        └── gh-pages.yml    # GitHub Pages deployment

```

## Setup Instructions

### 1. Fork and Clone the Repository

```bash
git clone https://github.com/YOUR-USERNAME/po-translation-tool.git
cd po-translation-tool
```

### 2. Configure Repositories

Edit `config/repositories.json` to add your translatable repositories:

```json
{
  "repositories": [
    {
      "owner": "your-org",
      "name": "your-app",
      "description": "Your application",
      "translationPath": "path/to/locale/files",
      "languages": ["fr", "es", "de"],
      "requiresAuth": true
    }
  ]
}
```

### 3. Set Up Authorization

#### For GitHub Users:
1. Users need to create a Personal Access Token:
   - Go to GitHub Settings > Developer settings > Personal access tokens
   - Generate new token with `repo` scope
   - Save the token securely

#### For Non-GitHub Users:
1. Generate invite tokens (use a secure random generator)
2. Add them to `config/authorized-tokens.json`
3. Share tokens with authorized translators

### 4. Enable GitHub Pages

1. Go to your repository Settings
2. Navigate to Pages section
3. Set source to "GitHub Actions"
4. The workflow will automatically deploy on push to main

### 5. Configure Repository Access

For the tool to work with target repositories:

#### Option A: Direct GitHub API Access
- Requires users to have read access to target repos
- Users authenticate with their GitHub PAT

#### Option B: GitHub App (Recommended for organizations)
1. Create a GitHub App for your organization
2. Grant it read/write access to repository contents and pull requests
3. Install it on target repositories
4. Update the tool to use App authentication

### 6. Security Considerations

1. **Never commit sensitive tokens** to the repository
2. Use environment variables or GitHub Secrets for sensitive data
3. Consider implementing a backend service for token validation
4. Regularly rotate invite tokens
5. Monitor and audit PR submissions

## Usage Guide

### For Translators

1. Navigate to: `https://YOUR-USERNAME.github.io/po-translation-tool`
2. Login with GitHub PAT or invite token
3. Select target repository
4. Choose language to translate
5. Edit translations (changes are auto-saved locally)
6. Submit PR when ready

### For Repository Maintainers

1. Review submitted PRs in target repository
2. Check translation quality and formatting
3. Merge approved translations
4. Update invite tokens periodically

## Advanced Configuration

### Using a Backend Service

For production use, consider adding a backend service to:
- Validate invite tokens securely
- Proxy GitHub API requests
- Handle PR creation for non-GitHub users
- Store translation progress

### GitHub Action for Non-GitHub Users

Create a workflow that processes exported translation files:

```yaml
name: Process Translation Submissions
on:
  workflow_dispatch:
    inputs:
      translation_file:
        description: 'Translation submission file'
        required: true

jobs:
  create-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Process translations
        run: |
          # Process the uploaded JSON file
          # Create PR with changes
```

### Custom Language Support

Add new languages to `config/languages.json`:

```json
{
  "supported": {
    "zh": {
      "name": "Chinese",
      "nativeName": "中文",
      "direction": "ltr"
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **"Invalid token" error**
   - Ensure GitHub PAT has `repo` scope
   - Check token hasn't expired

2. **Can't see repository files**
   - Verify user has read access to repository
   - Check translation path is correct

3. **PR creation fails**
   - Ensure user has fork permissions
   - Check branch protection rules

### Development Tips

1. Test locally with Python HTTP server:
   ```bash
   python -m http.server 8000
   ```

2. Use browser DevTools to debug API calls

3. Check browser console for detailed error messages

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details