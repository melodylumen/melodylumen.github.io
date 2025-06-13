// scripts/app.js - Updated with dynamic language detection and creation
class TranslationApp {
    constructor() {
        this.api = new APIClient();
        this.translationManager = new TranslationManager(this.api);
        this.currentUser = null;
        this.currentRepo = null;
        this.currentLanguage = null;
        this.availableLanguages = [];
        this.canCreateLanguage = false;
        this.ws = null;
        this.changes = new Map();
    }

    async init() {
        // Check for existing session
        if (this.api.sessionToken) {
            try {
                const validation = await this.api.validateSession();
                if (validation.valid) {
                    this.currentUser = validation.user;
                    this.showApp();
                    return;
                }
            } catch (error) {
                console.error('Session validation failed:', error);
                this.api.clearSession();
            }
        }

        // Show auth screen
        this.showAuth();
    }

    // UI State Management
    showAuth() {
        document.getElementById('auth-section').style.display = 'block';
        document.getElementById('app-section').style.display = 'none';
    }

    showApp() {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('app-section').style.display = 'block';
        document.getElementById('user-name').textContent = this.currentUser.name;

        this.loadRepositories();
    }

    showLoading(text = 'Loading...') {
        document.getElementById('loading').style.display = 'flex';
        document.getElementById('loading-text').textContent = text;
    }

    hideLoading() {
        document.getElementById('loading').style.display = 'none';
    }

    // Authentication
    async loginWithGithub() {
        const token = prompt(
            'Enter your GitHub Personal Access Token:\n\n' +
            'To create one:\n' +
            '1. Go to GitHub Settings > Developer settings > Personal access tokens\n' +
            '2. Generate new token with "repo" scope\n' +
            '3. Copy and paste it here'
        );

        if (!token) return;

        try {
            this.showLoading('Authenticating...');
            const result = await this.api.loginWithGithub(token);

            if (result.success) {
                this.currentUser = result.user;
                this.showApp();
            }
        } catch (error) {
            alert(`Login failed: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async loginWithToken() {
        const inviteToken = document.getElementById('inviteToken').value;
        const email = document.getElementById('tokenEmail').value;
        const name = document.getElementById('tokenName').value;

        if (!inviteToken || !email) {
            alert('Please enter both invite token and email');
            return;
        }

        try {
            this.showLoading('Authenticating...');
            const result = await this.api.loginWithToken(inviteToken, email, name);

            if (result.success) {
                this.currentUser = result.user;
                this.showApp();
            }
        } catch (error) {
            alert(`Login failed: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async logout() {
        if (confirm('Are you sure you want to logout?')) {
            this.api.clearSession();
            this.currentUser = null;
            this.disconnectWebSocket();
            this.showAuth();
        }
    }

    // Repository Management
    async loadRepositories() {
        try {
            this.showLoading('Loading repositories...');
            const repos = await this.api.getRepositories();

            const repoList = document.getElementById('repo-list');
            repoList.innerHTML = repos.map(repo => `
                <div class="repo-card" onclick="app.selectRepository('${repo.owner}', '${repo.name}', '${repo.translationPath}')">
                    <h3>${repo.owner}/${repo.name}</h3>
                    <p>${repo.description || 'No description available'}</p>
                    <div class="repo-meta">
                        <span>Path: ${repo.translationPath}</span>
                    </div>
                </div>
            `).join('');

            document.getElementById('repo-selector').style.display = 'block';
            document.getElementById('language-selector').style.display = 'none';
            document.getElementById('translation-workspace').style.display = 'none';
        } catch (error) {
            alert(`Failed to load repositories: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async selectRepository(owner, name, translationPath) {
        this.currentRepo = { owner, name, translationPath };

        try {
            this.showLoading('Loading languages...');
            const response = await this.api.getRepositoryLanguages(owner, name);

            this.availableLanguages = response.languages || [];
            this.canCreateLanguage = response.canCreateNew || false;

            this.renderLanguageSelector();

            document.getElementById('repo-selector').style.display = 'none';
            document.getElementById('language-selector').style.display = 'block';
        } catch (error) {
            alert(`Failed to load languages: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    renderLanguageSelector() {
        const languageList = document.getElementById('language-list');

        // Add existing languages
        let html = this.availableLanguages.map(lang => `
            <button class="language-btn" onclick="app.selectLanguage('${lang}')">
                <span class="lang-code">${lang.toUpperCase()}</span>
                <span class="lang-name">${this.getLanguageName(lang)}</span>
            </button>
        `).join('');

        // Add create new language button if user has permission
        if (this.canCreateLanguage) {
            html += `
                <button class="language-btn create-new" onclick="app.showCreateLanguageDialog()">
                    <span class="lang-code">+</span>
                    <span class="lang-name">Create New Language</span>
                </button>
            `;
        }

        languageList.innerHTML = html;
    }

    async showCreateLanguageDialog() {
        // Create modal dialog
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Create New Language</h2>
                    <button onclick="this.closest('.modal').remove()" class="close-btn">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="new-lang-code">Language Code (e.g., 'fr', 'es', 'de'):</label>
                        <input type="text" id="new-lang-code" placeholder="e.g., fr" maxlength="10" />
                        <small>Use standard ISO 639-1 or 639-3 codes when possible</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="new-lang-name">Language Name:</label>
                        <input type="text" id="new-lang-name" placeholder="e.g., French" />
                    </div>
                    
                    <div class="form-group">
                        <label for="source-lang">Copy translations from:</label>
                        <select id="source-lang">
                            <option value="en">English (source)</option>
                            ${this.availableLanguages.map(lang =>
            `<option value="${lang}">${this.getLanguageName(lang)} (${lang})</option>`
        ).join('')}
                        </select>
                        <small>Usually you want to copy from English to get all message IDs</small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="this.closest('.modal').remove()" class="btn-secondary">Cancel</button>
                    <button onclick="app.createNewLanguage()" class="btn-primary">Create Language</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.style.display = 'flex';

        // Focus on language code input
        document.getElementById('new-lang-code').focus();
    }

    async createNewLanguage() {
        const langCode = document.getElementById('new-lang-code').value.trim().toLowerCase();
        const langName = document.getElementById('new-lang-name').value.trim();
        const sourceLanguage = document.getElementById('source-lang').value;

        if (!langCode || !langName) {
            alert('Please enter both language code and name');
            return;
        }

        // Validate language code format
        if (!/^[a-z]{2,10}(-[A-Za-z0-9]+)?$/.test(langCode)) {
            alert('Invalid language code format. Use 2-10 lowercase letters, optionally followed by a hyphen and alphanumeric characters.');
            return;
        }

        // Check if language already exists
        if (this.availableLanguages.includes(langCode)) {
            alert('This language already exists');
            return;
        }

        try {
            this.showLoading('Creating new language...');

            const result = await this.api.createLanguage(
                `${this.currentRepo.owner}/${this.currentRepo.name}`,
                langCode,
                langName,
                sourceLanguage
            );

            if (result.languageCode) {
                alert(`Language "${langName}" (${langCode}) created successfully!`);

                // Close modal
                document.querySelector('.modal').remove();

                // Refresh language list
                await this.selectRepository(
                    this.currentRepo.owner,
                    this.currentRepo.name,
                    this.currentRepo.translationPath
                );
            }
        } catch (error) {
            alert(`Failed to create language: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async selectLanguage(language) {
        this.currentLanguage = language;
        const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

        try {
            this.showLoading('Loading translations...');

            // Try to connect WebSocket for real-time collaboration (optional)
            this.connectWebSocket();

            // Load translations
            const translations = await this.translationManager.loadTranslations(
                repoKey,
                language,
                this.currentRepo.translationPath
            );

            // Update UI
            document.getElementById('workspace-title').textContent =
                `${this.currentRepo.name} - ${this.getLanguageName(language)}`;

            // Populate language switcher
            this.populateLanguageSwitcher();

            this.renderTranslations(translations);

            document.getElementById('language-selector').style.display = 'none';
            document.getElementById('translation-workspace').style.display = 'block';

            this.updateChangeCounter();
        } catch (error) {
            alert(`Failed to load translations: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async switchLanguage(newLanguage) {
        if (newLanguage === this.currentLanguage) {
            return; // Already on this language
        }

        // Check if there are unsaved changes
        if (this.changes.size > 0) {
            const confirmSwitch = confirm(
                `You have ${this.changes.size} unsaved changes. ` +
                `These changes will be preserved when you switch languages. Continue?`
            );
            if (!confirmSwitch) {
                // Reset the select to current language
                document.getElementById('current-language-select').value = this.currentLanguage;
                return;
            }
        }

        // Disconnect current WebSocket if any
        this.disconnectWebSocket();

        // Switch to new language
        await this.selectLanguage(newLanguage);
    }

    populateLanguageSwitcher() {
        const select = document.getElementById('current-language-select');
        if (!select || !this.availableLanguages) return;

        // Clear existing options
        select.innerHTML = '';

        // Add all available languages
        this.availableLanguages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang;
            option.textContent = `${lang.toUpperCase()} - ${this.getLanguageName(lang)}`;
            if (lang === this.currentLanguage) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }


    // Translation Management
    renderTranslations(translations) {
        const container = document.getElementById('translation-cards');
        container.innerHTML = '';

        Object.entries(translations).forEach(([msgid, data]) => {
            const card = this.createTranslationCard(msgid, data);
            container.appendChild(card);
        });
    }

    createTranslationCard(msgid, data) {
        const card = document.createElement('div');
        card.className = 'translation-card';
        card.dataset.msgid = msgid;

        const changeKey = `${this.currentLanguage}:${msgid}`;
        const hasChange = this.changes.has(changeKey);
        const activeEditors = data.activeEditors || [];

        card.innerHTML = `
            <div class="card-header">
                <code class="msgid">${this.escapeHtml(msgid)}</code>
                <div class="card-status">
                    ${hasChange ? '<span class="change-indicator">Modified</span>' : ''}
                    ${activeEditors.length > 0 ? `
                        <span class="active-editors" title="${activeEditors.join(', ')}">
                            ${activeEditors.length} editing
                        </span>
                    ` : ''}
                </div>
            </div>
            
            <div class="original-text">
                <label>English:</label>
                <div class="text-content">${this.escapeHtml(data.original)}</div>
            </div>
            
            <div class="translation-field">
                <label>${this.getLanguageName(this.currentLanguage)}:</label>
                <textarea 
                    class="translation-input" 
                    data-msgid="${this.escapeHtml(msgid)}"
                    placeholder="Enter translation..."
                    onfocus="app.onTranslationFocus('${this.escapeHtml(msgid)}')"
                    onblur="app.onTranslationBlur('${this.escapeHtml(msgid)}')"
                    oninput="app.onTranslationChange('${this.escapeHtml(msgid)}')"
                >${this.escapeHtml(data.translation || '')}</textarea>
            </div>
            
            <div class="card-footer">
                ${data.previousTranslation ? `
                    <div class="previous-translation">
                        Previous: <em>${this.escapeHtml(data.previousTranslation)}</em>
                    </div>
                ` : ''}
                
                <div class="card-actions">
                    ${hasChange ? `
                        <button onclick="app.revertChange('${this.escapeHtml(msgid)}')" class="btn-secondary">
                            Revert
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        return card;
    }

    async onTranslationFocus(msgid) {
        // Notify others that we're editing this translation
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({
                    type: 'startEdit',
                    msgid,
                    user: this.currentUser?.name || 'Anonymous'
                }));
            } catch (error) {
                console.warn('Failed to send WebSocket message:', error);
            }
        }
    }

    async onTranslationBlur(msgid) {
        // Notify others that we've stopped editing
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({
                    type: 'endEdit',
                    msgid,
                    user: this.currentUser?.name || 'Anonymous'
                }));
            } catch (error) {
                console.warn('Failed to send WebSocket message:', error);
            }
        }

        // Save to backend
        await this.saveTranslation(msgid);
    }

    async onTranslationChange(msgid) {
        const textarea = document.querySelector(`textarea[data-msgid="${msgid}"]`);
        const newValue = textarea.value;
        const data = this.translationManager.getTranslation(msgid);

        if (newValue !== data.translation) {
            const changeKey = `${this.currentLanguage}:${msgid}`;
            this.changes.set(changeKey, {
                msgid,
                language: this.currentLanguage,
                original: data.original,
                previous: data.translation || '',
                new: newValue,
                timestamp: new Date().toISOString()
            });

            this.updateChangeCounter();
            this.refreshCard(msgid);
        }
    }

    async saveTranslation(msgid) {
        const changeKey = `${this.currentLanguage}:${msgid}`;
        const change = this.changes.get(changeKey);

        if (!change) return;

        try {
            const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;
            await this.api.saveTranslation(
                repoKey,
                this.currentLanguage,
                msgid,
                change.new,
                {
                    originalText: change.original,
                    previousTranslation: change.previous,
                    filePath: `${this.currentRepo.translationPath}/${this.currentLanguage}/messages.po`
                }
            );

            // Update local state
            this.translationManager.updateTranslation(msgid, change.new);
        } catch (error) {
            console.error('Failed to save translation:', error);
            // Keep the change in memory for retry
        }
    }

    revertChange(msgid) {
        const changeKey = `${this.currentLanguage}:${msgid}`;
        const change = this.changes.get(changeKey);

        if (change) {
            // Revert textarea value
            const textarea = document.querySelector(`textarea[data-msgid="${msgid}"]`);
            textarea.value = change.previous;

            // Remove from changes
            this.changes.delete(changeKey);

            this.updateChangeCounter();
            this.refreshCard(msgid);
        }
    }

    // UI Updates
    updateChangeCounter() {
        const count = this.changes.size;
        document.getElementById('change-count').textContent = count;
        document.getElementById('submit-pr-btn').disabled = count === 0;
    }

    refreshCard(msgid) {
        const card = document.querySelector(`.translation-card[data-msgid="${msgid}"]`);
        if (!card) return;

        const changeKey = `${this.currentLanguage}:${msgid}`;
        const hasChange = this.changes.has(changeKey);

        const indicator = card.querySelector('.change-indicator');
        const statusDiv = card.querySelector('.card-status');

        if (hasChange && !indicator) {
            statusDiv.insertAdjacentHTML('afterbegin', '<span class="change-indicator">Modified</span>');
        } else if (!hasChange && indicator) {
            indicator.remove();
        }
    }

    // Filter and Search
    filterTranslations() {
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        const filterStatus = document.getElementById('filter-status').value;

        const cards = document.querySelectorAll('.translation-card');

        cards.forEach(card => {
            const msgid = card.dataset.msgid;
            const originalText = card.querySelector('.original-text .text-content').textContent.toLowerCase();
            const translationText = card.querySelector('.translation-input').value.toLowerCase();

            // Search filter
            const matchesSearch = !searchTerm ||
                msgid.toLowerCase().includes(searchTerm) ||
                originalText.includes(searchTerm) ||
                translationText.includes(searchTerm);

            // Status filter
            let matchesStatus = true;
            if (filterStatus === 'empty') {
                matchesStatus = !card.querySelector('.translation-input').value.trim();
            } else if (filterStatus === 'modified') {
                matchesStatus = card.querySelector('.change-indicator') !== null;
            }

            card.style.display = matchesSearch && matchesStatus ? 'block' : 'none';
        });
    }

    // Pull Request Management
    showChanges() {
        if (this.changes.size === 0) {
            alert('No changes to review');
            return;
        }

        const changesList = document.getElementById('changes-list');
        changesList.innerHTML = '';

        // Group changes by language
        const changesByLanguage = new Map();
        this.changes.forEach((change, key) => {
            if (!changesByLanguage.has(change.language)) {
                changesByLanguage.set(change.language, []);
            }
            changesByLanguage.get(change.language).push(change);
        });

        changesByLanguage.forEach((changes, language) => {
            const section = document.createElement('div');
            section.className = 'change-section';
            section.innerHTML = `
                <h3>${this.getLanguageName(language)} (${changes.length} changes)</h3>
                <div class="change-items">
                    ${changes.map(change => `
                        <div class="change-item">
                            <div class="change-msgid">${this.escapeHtml(change.msgid)}</div>
                            <div class="change-diff">
                                <div class="diff-old">- ${this.escapeHtml(change.previous || '(empty)')}</div>
                                <div class="diff-new">+ ${this.escapeHtml(change.new)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            changesList.appendChild(section);
        });

        document.getElementById('changes-modal').style.display = 'flex';
    }

    closeChangesModal() {
        document.getElementById('changes-modal').style.display = 'none';
    }

    async proceedToSubmitPR() {
        this.closeChangesModal();
        await this.submitPR();
    }

    async submitPR() {
        if (this.changes.size === 0) {
            alert('No changes to submit');
            return;
        }

        const title = prompt(
            'Pull Request Title:',
            `Update ${this.getLanguageName(this.currentLanguage)} translations`
        );

        if (!title) return;

        const description = prompt(
            'Pull Request Description (optional):',
            `Translation updates for ${this.currentRepo.name}`
        );

        try {
            this.showLoading('Creating pull request...');

            // Prepare changes data
            const changesArray = Array.from(this.changes.values());
            const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

            const result = await this.api.submitPR(
                repoKey,
                title,
                description,
                changesArray
            );

            if (result.success) {
                if (result.prs) {
                    // Multiple PRs created (one per language)
                    let message = 'Pull requests created successfully!\n\n';
                    result.prs.forEach(pr => {
                        message += `${pr.updated ? 'Updated' : 'Created'}: ${pr.prUrl}\n`;
                    });
                    alert(message);

                    // Open first PR in new tab
                    if (result.prs[0].prUrl) {
                        window.open(result.prs[0].prUrl, '_blank');
                    }
                } else {
                    alert(`Pull request created successfully!${result.prUrl ? `\n\nView at: ${result.prUrl}` : ''}`);

                    if (result.prUrl) {
                        window.open(result.prUrl, '_blank');
                    }
                }

                // Clear changes
                this.changes.clear();
                this.updateChangeCounter();

                // Refresh all cards
                document.querySelectorAll('.translation-card').forEach(card => {
                    this.refreshCard(card.dataset.msgid);
                });
            }
        } catch (error) {
            alert(`Failed to create pull request: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    // WebSocket Management
    connectWebSocket() {
        // For now, disable WebSocket to avoid blocking the app
        console.log('WebSocket temporarily disabled for stability');
        return;

        const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

        try {
            this.ws = this.api.connectWebSocket(
                repoKey,
                this.currentLanguage,
                (message) => this.handleWebSocketMessage(message),
                (status) => this.handleWebSocketStatus(status)
            );
        } catch (error) {
            console.warn('WebSocket connection failed, continuing without real-time features:', error);
            this.ws = null;
        }
    }

    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'connected':
                console.log('WebSocket connected successfully');
                break;
                
            case 'userStartedEditing':
                // Another user started editing
                if (data.userId !== this.currentUser?.id) {
                    this.updateActiveEditor(data.msgid, data.userName, true);
                }
                break;

            case 'userStoppedEditing':
                // Another user stopped editing
                if (data.userId !== this.currentUser?.id) {
                    this.updateActiveEditor(data.msgid, data.userName, false);
                }
                break;

            case 'translationUpdate':
                // Another user saved a translation
                if (data.userId !== this.currentUser?.id) {
                    this.handleRemoteTranslationUpdate(data);
                }
                break;
                
            case 'pong':
                // Heartbeat response - ignore
                break;
                
            default:
                console.log('Unknown WebSocket message type:', data.type);
        }
    }

    handleWebSocketStatus(status) {
        console.log('WebSocket status:', status);
        
        if (status === 'error' || status === 'disconnected') {
            // Attempt to reconnect after a delay, but don't block the UI
            setTimeout(() => {
                if (this.currentRepo && this.currentLanguage && !this.ws) {
                    console.log('Attempting to reconnect WebSocket...');
                    this.connectWebSocket();
                }
            }, 5000);
        }
    }

    updateActiveEditor(msgid, user, isActive) {
        const card = document.querySelector(`.translation-card[data-msgid="${msgid}"]`);
        if (!card) return;

        const data = this.translationManager.getTranslation(msgid);
        if (!data.activeEditors) data.activeEditors = [];

        if (isActive && !data.activeEditors.includes(user)) {
            data.activeEditors.push(user);
        } else if (!isActive) {
            data.activeEditors = data.activeEditors.filter(u => u !== user);
        }

        // Update UI
        const activeEditorsSpan = card.querySelector('.active-editors');
        const statusDiv = card.querySelector('.card-status');

        if (data.activeEditors.length > 0) {
            if (activeEditorsSpan) {
                activeEditorsSpan.textContent = `${data.activeEditors.length} editing`;
                activeEditorsSpan.title = data.activeEditors.join(', ');
            } else {
                statusDiv.insertAdjacentHTML('beforeend', `
                    <span class="active-editors" title="${data.activeEditors.join(', ')}">
                        ${data.activeEditors.length} editing
                    </span>
                `);
            }
        } else if (activeEditorsSpan) {
            activeEditorsSpan.remove();
        }
    }

    handleRemoteTranslationUpdate(data) {
        // Update local translation data
        this.translationManager.updateTranslation(data.msgid, data.translation);

        // Update UI if not currently being edited locally
        const changeKey = `${this.currentLanguage}:${data.msgid}`;
        if (!this.changes.has(changeKey)) {
            const textarea = document.querySelector(`textarea[data-msgid="${data.msgid}"]`);
            if (textarea) {
                textarea.value = data.translation;
            }
        }
    }

    // Navigation
    backToRepos() {
        if (this.changes.size > 0) {
            const confirmLeave = confirm(
                `You have ${this.changes.size} unsaved changes. ` +
                `These will be lost if you go back to repository selection. Continue?`
            );
            if (!confirmLeave) return;
        }

        this.disconnectWebSocket();
        this.currentRepo = null;
        this.currentLanguage = null;
        this.availableLanguages = [];
        this.changes.clear();
        this.loadRepositories();
    }

    backToLanguages() {
        this.disconnectWebSocket();
        this.currentLanguage = null;

        // Show language selector, hide workspace
        document.getElementById('translation-workspace').style.display = 'none';
        document.getElementById('language-selector').style.display = 'block';

        // If we have pending changes, show a note
        if (this.changes.size > 0) {
            const message = document.createElement('div');
            message.className = 'pending-changes-notice';
            message.innerHTML = `
                <p style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0; border: 1px solid #ffeaa7;">
                    📝 You have ${this.changes.size} pending changes that will be preserved when you select a new language.
                </p>
            `;

            const languageSelector = document.getElementById('language-selector');
            const existingNotice = languageSelector.querySelector('.pending-changes-notice');
            if (existingNotice) {
                existingNotice.remove();
            }
            languageSelector.insertBefore(message, languageSelector.querySelector('h2').nextSibling);
        }
    }

    // Utility Methods
    getLanguageName(code) {
        // First check stored language metadata
        const storedName = localStorage.getItem(`lang_name_${code}`);
        if (storedName) {
            return storedName;
        }

        // Fallback to known languages
        const names = {
            'cr': 'Cree (ᓀᐦᐃᔭᐍᐏᐣ)',
            'iu': 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)',
            'oj': 'Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ)',
            'miq': "Mi'kmaq",
            'innu': 'Innu-aimun',
            'fr': 'French',
            'es': 'Spanish',
            'de': 'German',
            'pt': 'Portuguese',
            'it': 'Italian',
            'ja': 'Japanese',
            'ko': 'Korean',
            'zh': 'Chinese',
            'en': 'English'
        };
        return names[code] || code.toUpperCase();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Application error:', event.error);
    // Could send to error tracking service
});

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TranslationApp();
    window.app.init();
});