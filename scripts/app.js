// scripts/app.js - Main application controller
class TranslationApp {
    constructor() {
        this.auth = new AuthManager();
        this.config = new RepositoryConfig();
        this.tracker = new ChangeTracker();
        this.prManager = new PRManager();
        this.currentTranslations = {};
        this.isAuthenticated = false;
    }

    async init() {
        // Check for existing authentication
        this.checkExistingAuth();

        // Setup UI event handlers
        this.setupEventHandlers();

        // Load repository configuration
        const repoConfig = await this.config.loadConfig();
        if (repoConfig) {
            this.displayRepoOptions(repoConfig);
        }
    }

    checkExistingAuth() {
        const savedAuth = localStorage.getItem('poToolAuth');
        if (savedAuth) {
            try {
                const authData = JSON.parse(savedAuth);
                this.auth.authMethod = authData.method;
                this.auth.credentials = authData.credentials;
                this.isAuthenticated = true;
                this.showTranslationInterface();
            } catch (e) {
                console.error('Invalid saved auth:', e);
            }
        }
    }

    setupEventHandlers() {
        // Override global functions from existing scripts
        window.loginWithGithub = () => this.handleGitHubLogin();
        window.loginWithToken = () => this.handleTokenLogin();
        window.submitPR = () => this.handleSubmitPR();
        window.saveTranslation = (msgid) => this.handleSaveTranslation(msgid);
    }

    async handleGitHubLogin() {
        const token = prompt('Enter your GitHub Personal Access Token:\n\nTo create one:\n1. Go to GitHub Settings > Developer settings > Personal access tokens\n2. Generate new token with "repo" scope\n3. Copy and paste it here');

        if (token) {
            try {
                // Validate token by making a test API call
                const response = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (response.ok) {
                    const userData = await response.json();
                    this.auth.authMethod = 'github';
                    this.auth.credentials = { token, username: userData.login };
                    this.saveAuth();
                    this.isAuthenticated = true;
                    alert(`Logged in as ${userData.login}`);
                    this.showTranslationInterface();
                } else {
                    alert('Invalid token. Please check and try again.');
                }
            } catch (error) {
                alert('Error validating token: ' + error.message);
            }
        }
    }

    async handleTokenLogin() {
        const token = document.getElementById('inviteToken').value;
        if (!token) {
            alert('Please enter an invite token');
            return;
        }

        try {
            await this.auth.loginWithInvite(token);
            this.isAuthenticated = true;
            this.saveAuth();
            alert('Successfully logged in with invite token');
            this.showTranslationInterface();
        } catch (error) {
            alert('Invalid invite token');
        }
    }

    saveAuth() {
        localStorage.setItem('poToolAuth', JSON.stringify({
            method: this.auth.authMethod,
            credentials: this.auth.credentials
        }));
    }

    showTranslationInterface() {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('translation-section').style.display = 'block';

        // Load the enhanced translation UI
        this.loadTranslationUI();
    }

    async loadTranslationUI() {
        const container = document.getElementById('translation-section');

        // Create repository selector
        container.innerHTML = `
      <div class="repo-selector">
        <h2>Select Repository</h2>
        <div id="repo-options"></div>
      </div>
      <div id="translation-workspace" style="display: none;">
        <div class="workspace-header">
          <h2>Translation Editor</h2>
          <div class="controls">
            <button onclick="window.translationApp.showPendingChanges()">
              View Changes (${this.tracker.getAllChanges().length})
            </button>
            <button onclick="submitPR()" class="btn-primary">Submit PR</button>
          </div>
        </div>
        <div id="language-selector"></div>
        <div id="translation-cards"></div>
      </div>
    `;
    }

    displayRepoOptions(config) {
        const container = document.getElementById('repo-options');
        if (!container) return;

        container.innerHTML = config.repositories.map(repo => `
      <div class="repo-card" onclick="window.translationApp.selectRepository('${repo.owner}', '${repo.name}', '${repo.translationPath}')">
        <h3>${repo.owner}/${repo.name}</h3>
        <p>${repo.description || 'No description'}</p>
        <small>Path: ${repo.translationPath}</small>
      </div>
    `).join('');
    }

    async selectRepository(owner, name, path) {
        this.config.setTargetRepository(owner, name, path);

        // Hide repo selector, show workspace
        document.querySelector('.repo-selector').style.display = 'none';
        document.getElementById('translation-workspace').style.display = 'block';

        // Load available languages
        await this.loadLanguages();
    }

    async loadLanguages() {
        try {
            const files = await this.config.fetchPoFiles();
            const languages = files
                .filter(f => f.type === 'dir' && f.name !== 'en')
                .map(f => f.name);

            this.displayLanguages(languages);
        } catch (error) {
            alert('Error loading languages: ' + error.message);
        }
    }

    displayLanguages(languages) {
        const container = document.getElementById('language-selector');
        container.innerHTML = `
      <h3>Select Language to Translate</h3>
      <div class="language-grid">
        ${languages.map(lang => `
          <button class="language-btn" onclick="window.translationApp.selectLanguage('${lang}')">
            ${this.getLanguageName(lang)}
          </button>
        `).join('')}
      </div>
    `;
    }

    async selectLanguage(language) {
        this.currentLanguage = language;

        // Load both English template and target language translations
        const enPath = `${this.config.translationPath}/en/messages.po`;
        const langPath = `${this.config.translationPath}/${language}/messages.po`;

        try {
            const [enContent, langContent] = await Promise.all([
                this.config.fetchFileContent(enPath),
                this.config.fetchFileContent(langPath)
            ]);

            const enMessages = this.tracker.parsePOFile(enContent);
            const langMessages = this.tracker.parsePOFile(langContent);

            this.currentTranslations = {
                template: enMessages,
                translations: langMessages
            };

            this.displayTranslations();
        } catch (error) {
            alert('Error loading translation files: ' + error.message);
        }
    }

    displayTranslations() {
        const container = document.getElementById('translation-cards');
        container.innerHTML = '';

        Object.entries(this.currentTranslations.template).forEach(([msgid, originalText]) => {
            const currentTranslation = this.currentTranslations.translations[msgid] || '';
            const card = this.createTranslationCard(msgid, originalText, currentTranslation);
            container.appendChild(card);
        });
    }

    createTranslationCard(msgid, originalText, currentTranslation) {
        const card = document.createElement('div');
        card.className = 'translation-card';
        card.dataset.msgid = msgid;

        const hasChange = this.tracker.changes.has(`${this.currentLanguage}:${msgid}`);

        card.innerHTML = `
      <div class="card-header">
        <code class="msgid">${msgid}</code>
        ${hasChange ? '<span class="change-indicator">Modified</span>' : ''}
      </div>
      <div class="original-text">
        <strong>English:</strong> ${this.escapeHtml(originalText)}
      </div>
      <textarea 
        class="translation-input" 
        data-msgid="${msgid}"
        placeholder="Enter translation..."
      >${this.escapeHtml(currentTranslation)}</textarea>
      <div class="card-actions">
        <button onclick="window.translationApp.saveTranslation('${msgid}')">Save</button>
        ${hasChange ? '<button onclick="window.translationApp.revertChange(\'' + msgid + '\')">Revert</button>' : ''}
      </div>
    `;

        return card;
    }

    saveTranslation(msgid) {
        const textarea = document.querySelector(`textarea[data-msgid="${msgid}"]`);
        const newTranslation = textarea.value;
        const originalText = this.currentTranslations.template[msgid];
        const previousTranslation = this.currentTranslations.translations[msgid] || '';

        // Track the change
        this.tracker.trackChange(
            this.currentLanguage,
            msgid,
            originalText,
            newTranslation,
            previousTranslation
        );

        // Update local state
        this.currentTranslations.translations[msgid] = newTranslation;

        // Update UI
        this.updateChangeCount();
        this.refreshCard(msgid);
    }

    revertChange(msgid) {
        const changeKey = `${this.currentLanguage}:${msgid}`;
        this.tracker.changes.delete(changeKey);
        this.tracker.savePendingChanges();

        // Revert to original translation
        const textarea = document.querySelector(`textarea[data-msgid="${msgid}"]`);
        textarea.value = this.currentTranslations.translations[msgid] || '';

        this.updateChangeCount();
        this.refreshCard(msgid);
    }

    refreshCard(msgid) {
        const card = document.querySelector(`.translation-card[data-msgid="${msgid}"]`);
        const hasChange = this.tracker.changes.has(`${this.currentLanguage}:${msgid}`);

        const indicator = card.querySelector('.change-indicator');
        if (hasChange && !indicator) {
            card.querySelector('.card-header').innerHTML += '<span class="change-indicator">Modified</span>';
        } else if (!hasChange && indicator) {
            indicator.remove();
        }
    }

    updateChangeCount() {
        const count = this.tracker.getAllChanges().length;
        const button = document.querySelector('button[onclick*="showPendingChanges"]');
        if (button) {
            button.textContent = `View Changes (${count})`;
        }
    }

    showPendingChanges() {
        const changes = this.tracker.getAllChanges();
        if (changes.length === 0) {
            alert('No pending changes');
            return;
        }

        let summary = 'Pending Changes:\n\n';
        changes.forEach(change => {
            summary += `${change.language} - ${change.msgid}:\n`;
            summary += `  From: "${change.previousTranslation}"\n`;
            summary += `  To: "${change.newTranslation}"\n\n`;
        });

        alert(summary);
    }

    async handleSubmitPR() {
        const changes = this.tracker.getAllChanges();
        if (changes.length === 0) {
            alert('No changes to submit');
            return;
        }

        const title = prompt('Enter PR title:', `Update ${this.currentLanguage} translations`);
        if (!title) return;

        const description = prompt('Enter PR description (optional):', 'Translation updates from PO Translation Tool');

        try {
            const result = await this.prManager.createPullRequest(title, description || '');

            if (result.success) {
                if (result.prUrl) {
                    alert(`Pull Request created successfully!\n\nView at: ${result.prUrl}`);
                    window.open(result.prUrl, '_blank');
                } else {
                    alert(result.message);
                }
            } else {
                alert(`Error creating PR: ${result.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    getLanguageName(code) {
        const names = {
            'cr': 'Cree (ᓀᐦᐃᔭᐍᐏᐣ)',
            'iu': 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)',
            'oj': 'Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ)',
            'miq': "Mi'kmaq",
            'innu': 'Innu-aimun',
            'fr': 'French',
            'es': 'Spanish'
        };
        return names[code] || code.toUpperCase();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.translationApp = new TranslationApp();
    window.translationApp.init();
});