# GitHub Actions for Translation Tool PR Creation

## Understanding GitHub Actions Basics

GitHub Actions are automated workflows that run on GitHub's servers. They can:
- Trigger on events (push, PR, schedule, manual, webhook)
- Run in containers with various operating systems
- Access your repository code
- Use secrets for sensitive data
- Create commits, PRs, and more

## Project Structure

First, create the GitHub Actions directory structure:

```
your-translation-repo/
├── .github/
│   ├── workflows/
│   │   ├── process-translations.yml    # Main workflow
│   │   └── scheduled-pr-creation.yml   # Scheduled batch PRs
│   └── scripts/
│       ├── create-pr.js               # PR creation logic
│       └── process-translations.js     # Translation processing
├── translations-queue/                 # Where submissions are stored
│   └── .gitkeep
└── translation-config.json            # Configuration
```

## Main Translation Processing Workflow

Create `.github/workflows/process-translations.yml`:

```yaml
# This workflow processes translation submissions and creates PRs
name: Process Translation Submissions

# When this workflow runs
on:
  # Manual trigger with inputs
  workflow_dispatch:
    inputs:
      translation_file:
        description: 'Path to translation JSON file'
        required: true
        type: string
      translator_name:
        description: 'Name of translator'
        required: true
        type: string
      translator_email:
        description: 'Email of translator'
        required: true
        type: string
  
  # Trigger when files are added to the queue
  push:
    paths:
      - 'translations-queue/*.json'
    branches:
      - main

# Environment variables available to all jobs
env:
  NODE_VERSION: '18'
  
# The jobs that run
jobs:
  process-translation:
    name: Process Translation and Create PR
    runs-on: ubuntu-latest
    
    # Permissions this job needs
    permissions:
      contents: write      # To create branches and commits
      pull-requests: write # To create pull requests
      issues: write        # To add comments
    
    steps:
      # Step 1: Checkout the repository
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          # Fetch full history for better diffs
          fetch-depth: 0
          # Use a PAT for pushing (optional, for protected branches)
          token: ${{ secrets.GITHUB_TOKEN }}
      
      # Step 2: Setup Node.js
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      # Step 3: Install dependencies
      - name: Install dependencies
        run: |
          npm ci
          # Or if you have specific scripts
          # npm install @octokit/rest csv-parse
      
      # Step 4: Configure Git
      - name: Configure Git
        run: |
          git config --global user.name "Translation Bot"
          git config --global user.email "translations@yourdomain.com"
      
      # Step 5: Process the translation file
      - name: Process translations
        id: process
        run: |
          # Run the processing script
          node .github/scripts/process-translations.js \
            --file "${{ github.event.inputs.translation_file || 'auto' }}" \
            --author "${{ github.event.inputs.translator_name || 'Unknown' }}" \
            --email "${{ github.event.inputs.translator_email || 'unknown@example.com' }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      # Step 6: Create or update branch
      - name: Create feature branch
        id: branch
        run: |
          # Generate branch name
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          BRANCH_NAME="translations/update-${TIMESTAMP}"
          echo "branch_name=${BRANCH_NAME}" >> $GITHUB_OUTPUT
          
          # Create and checkout new branch
          git checkout -b $BRANCH_NAME
          
          # Add changed files
          git add -A
          
          # Check if there are changes
          if git diff --staged --quiet; then
            echo "No changes to commit"
            echo "has_changes=false" >> $GITHUB_OUTPUT
          else
            echo "has_changes=true" >> $GITHUB_OUTPUT
            # Commit changes
            git commit -m "Update translations via automated submission
            
            Translator: ${{ github.event.inputs.translator_name || 'Via Queue' }}
            Email: ${{ github.event.inputs.translator_email || 'N/A' }}
            Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            
            # Push the branch
            git push origin $BRANCH_NAME
          fi
      
      # Step 7: Create Pull Request
      - name: Create Pull Request
        if: steps.branch.outputs.has_changes == 'true'
        uses: peter-evans/create-pull-request@v5
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          branch: ${{ steps.branch.outputs.branch_name }}
          title: "🌐 Translation Update: ${{ steps.process.outputs.languages }}"
          body: |
            ## Translation Update
            
            This PR contains translation updates submitted via the translation tool.
            
            ### Submission Details
            - **Translator**: ${{ github.event.inputs.translator_name || 'Via Queue' }}
            - **Email**: ${{ github.event.inputs.translator_email || 'N/A' }}
            - **Languages**: ${{ steps.process.outputs.languages }}
            - **Files Modified**: ${{ steps.process.outputs.file_count }}
            - **Translations Updated**: ${{ steps.process.outputs.translation_count }}
            
            ### Changes Summary
            ```
            ${{ steps.process.outputs.summary }}
            ```
            
            ### Checklist
            - [ ] Translations have been reviewed for accuracy
            - [ ] No placeholders or variables were accidentally removed
            - [ ] Character encoding is correct (UTF-8)
            - [ ] File format is valid (.po syntax)
            
            ---
            *This PR was automatically generated by the Translation Tool workflow*
          labels: |
            translations
            automated
            needs-review
          reviewers: |
            translation-reviewers
            ${{ github.repository_owner }}
```

## Translation Processing Script

Create `.github/scripts/process-translations.js`:

```javascript
#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 ? args[index + 1] : null;
};

const translationFile = getArg('file');
const authorName = getArg('author') || 'Unknown';
const authorEmail = getArg('email') || 'unknown@example.com';

async function processTranslations() {
  let filePath;
  let translations;
  
  // Determine which file to process
  if (translationFile === 'auto') {
    // Find the newest file in the queue
    const queueDir = path.join(process.cwd(), 'translations-queue');
    const files = await fs.readdir(queueDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      console.log('No translation files found in queue');
      process.exit(0);
    }
    
    // Get the newest file
    const stats = await Promise.all(
      jsonFiles.map(async (file) => ({
        file,
        mtime: (await fs.stat(path.join(queueDir, file))).mtime
      }))
    );
    
    const newest = stats.sort((a, b) => b.mtime - a.mtime)[0];
    filePath = path.join(queueDir, newest.file);
  } else {
    filePath = path.resolve(translationFile);
  }
  
  // Read and parse the translation file
  console.log(`Processing translation file: ${filePath}`);
  const content = await fs.readFile(filePath, 'utf8');
  translations = JSON.parse(content);
  
  // Validate the structure
  if (!translations.language || !translations.translations) {
    throw new Error('Invalid translation file format');
  }
  
  // Process each translation
  const summary = await applyTranslations(translations);
  
  // Set outputs for the workflow
  console.log(`::set-output name=languages::${translations.language}`);
  console.log(`::set-output name=file_count::${summary.filesModified}`);
  console.log(`::set-output name=translation_count::${summary.translationCount}`);
  console.log(`::set-output name=summary::${summary.details}`);
  
  // Move processed file to archive
  const archiveDir = path.join(process.cwd(), 'translations-archive');
  await fs.mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `processed-${Date.now()}-${path.basename(filePath)}`);
  await fs.rename(filePath, archivePath);
  
  console.log('Translation processing complete');
}

async function applyTranslations(data) {
  const { language, translations, metadata } = data;
  const basePath = path.join(process.cwd(), 'src/locale/locales', language);
  const messagesPath = path.join(basePath, 'messages.po');
  
  // Read existing PO file
  const poContent = await fs.readFile(messagesPath, 'utf8');
  const updatedPo = updatePoFile(poContent, translations);
  
  // Write updated file
  await fs.writeFile(messagesPath, updatedPo, 'utf8');
  
  // Generate summary
  const translationCount = Object.keys(translations).length;
  const details = `Updated ${translationCount} translations for ${language}`;
  
  return {
    filesModified: 1,
    translationCount,
    details
  };
}

function updatePoFile(content, translations) {
  let updated = content;
  
  for (const [msgid, translation] of Object.entries(translations)) {
    // Escape special characters
    const escapedMsgid = msgid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedTranslation = translation
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
    
    // Find and replace the translation
    const regex = new RegExp(
      `(msgid\\s+"${escapedMsgid}"\\s*\\nmsgstr\\s+")[^"]*("?)`,
      'g'
    );
    
    updated = updated.replace(regex, `$1${escapedTranslation}$2`);
  }
  
  return updated;
}

// Run the script
processTranslations().catch(error => {
  console.error('Error processing translations:', error);
  process.exit(1);
});
```

## Scheduled Batch Processing Workflow

Create `.github/workflows/scheduled-pr-creation.yml`:

```yaml
name: Scheduled Translation Batch Processing

on:
  # Run every day at 2 AM UTC
  schedule:
    - cron: '0 2 * * *'
  
  # Allow manual trigger
  workflow_dispatch:

jobs:
  batch-process:
    name: Process Translation Queue
    runs-on: ubuntu-latest
    
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Check queue
        id: check
        run: |
          QUEUE_SIZE=$(find translations-queue -name "*.json" -type f | wc -l)
          echo "queue_size=${QUEUE_SIZE}" >> $GITHUB_OUTPUT
          
          if [ $QUEUE_SIZE -eq 0 ]; then
            echo "No translations in queue"
            exit 0
          fi
      
      - name: Process all queued translations
        if: steps.check.outputs.queue_size > 0
        run: |
          # Process each file in the queue
          for file in translations-queue/*.json; do
            if [ -f "$file" ]; then
              echo "Processing $file"
              # Trigger the main workflow for each file
              gh workflow run process-translations.yml \
                -f translation_file="$file" \
                -f translator_name="Batch Process" \
                -f translator_email="batch@translation-tool.com"
            fi
          done
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Security and Configuration

### 1. Repository Secrets

Add these secrets in your repository settings:

```yaml
# Required secrets:
# GITHUB_TOKEN - Automatically provided by GitHub
# 
# Optional secrets for enhanced features:
# SLACK_WEBHOOK - For notifications
# TRANSLATION_API_KEY - For validation services
```

### 2. Branch Protection

Create `.github/branch-protection.json`:

```json
{
  "protection_rules": [
    {
      "pattern": "main",
      "required_reviews": 1,
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": true,
      "required_status_checks": [
        "validate-translations",
        "check-po-syntax"
      ]
    }
  ]
}
```

### 3. CODEOWNERS file

Create `.github/CODEOWNERS`:

```
# Translation files require review from translation team
/src/locale/locales/ @translation-reviewers @lead-translator

# Specific language owners
/src/locale/locales/fr/ @french-team
/src/locale/locales/es/ @spanish-team
```

## Webhook Handler for External Submissions

Create `.github/workflows/webhook-handler.yml`:

```yaml
name: Handle External Translation Submission

on:
  repository_dispatch:
    types: [translation-submission]

jobs:
  process-webhook:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Save translation to queue
        run: |
          # Create queue directory
          mkdir -p translations-queue
          
          # Save the payload
          FILENAME="submission-$(date +%s).json"
          echo '${{ toJson(github.event.client_payload) }}' > translations-queue/$FILENAME
          
          # Commit and push
          git config user.name "Translation Bot"
          git config user.email "bot@translation-tool.com"
          git add translations-queue/$FILENAME
          git commit -m "Add translation submission to queue"
          git push
```

To trigger this webhook:

```bash
curl -X POST \
  -H "Authorization: token YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{
    "event_type": "translation-submission",
    "client_payload": {
      "language": "fr",
      "translations": {
        "welcome.message": "Bienvenue!",
        "goodbye.message": "Au revoir!"
      },
      "metadata": {
        "translator": "Jean Dupont",
        "email": "jean@example.com",
        "timestamp": "2024-01-20T10:00:00Z"
      }
    }
  }'
```

## Validation Workflow

Create `.github/workflows/validate-translations.yml`:

```yaml
name: Validate Translations

on:
  pull_request:
    paths:
      - 'src/locale/locales/**/*.po'

jobs:
  validate:
    name: Validate PO Files
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout PR
        uses: actions/checkout@v4
      
      - name: Install gettext tools
        run: |
          sudo apt-get update
          sudo apt-get install -y gettext
      
      - name: Validate PO syntax
        run: |
          # Find all .po files
          find src/locale/locales -name "*.po" -type f | while read -r file; do
            echo "Validating: $file"
            msgfmt -c -v -o /dev/null "$file" || exit 1
          done
      
      - name: Check for missing translations
        run: |
          # Custom script to check completeness
          node .github/scripts/check-translations.js
      
      - name: Post comment with validation results
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Translation validation failed. Please check the syntax of your .po files.'
            })
```

## Tips for Using GitHub Actions

### 1. **Testing Actions Locally**

Use [act](https://github.com/nektos/act) to test locally:
```bash
act -j process-translation
```

### 2. **Debugging**

Add debug steps:
```yaml
- name: Debug info
  run: |
    echo "Event: ${{ github.event_name }}"
    echo "Ref: ${{ github.ref }}"
    echo "SHA: ${{ github.sha }}"
    echo "Actor: ${{ github.actor }}"
```

### 3. **Monitoring**

View runs at: `https://github.com/YOUR_ORG/YOUR_REPO/actions`

### 4. **Cost Optimization**

- GitHub Actions are free for public repos
- Private repos get 2000 minutes/month free
- Use conditions to skip unnecessary steps
- Cache dependencies to speed up builds

### 5. **Security Best Practices**

- Never hardcode secrets
- Use least-privilege permissions
- Validate all external input
- Review third-party actions

This setup provides a complete automation pipeline for handling translation submissions and creating PRs, perfect for your translation tool's needs!