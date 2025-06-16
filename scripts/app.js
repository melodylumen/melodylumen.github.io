// scripts/app.js - Updated with GitHub App OAuth support and pagination
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

        // Pagination state
        this.currentPage = 0;
        this.pageSize = 50;
        this.hasMorePages = false;
        this.totalTranslations = 0;
        this.loadedTranslations = new Map(); // msgid -> translation data
        this.isLoading = false;

        // Search state
        this.searchMode = false;
        this.searchTerm = '';
        this.searchDebounceTimer = null;

        // Check for OAuth callback
        this.checkOAuthCallback();
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

    // Check if we're returning from GitHub OAuth
    checkOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');

        if (code && state) {
            this.handleOAuthCallback(code, state);
        }
    }

    async handleOAuthCallback(code, state) {
        try {
            this.showLoading('Completing GitHub authentication...');

            // Complete OAuth flow
            const result = await this.api.completeGitHubOAuth(code, state);

            if (result.success) {
                this.currentUser = result.user;

                // Clear URL parameters
                window.history.replaceState({}, document.title, window.location.pathname);

                // Check if user is admin
                if (result.user.isAdmin) {
                    this.showAdminPrompt();
                } else {
                    this.showApp();
                }
            }
        } catch (error) {
            alert(`Authentication failed: ${error.message}`);
            this.showAuth();
        } finally {
            this.hideLoading();
        }
    }

    showAdminPrompt() {
        if (confirm('You have admin privileges. Would you like to go to the admin dashboard?')) {
            window.location.href = '/admin.html';
        } else {
            this.showApp();
        }
    }

    // UI State Management
    showAuth() {
        document.getElementById('auth-section').style.display = 'block';
        document.getElementById('app-section').style.display = 'none';

        // Update GitHub button text
        const githubBtn = document.querySelector('.btn-github');
        if (githubBtn) {
            githubBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: middle; margin-right: 8px;">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                Sign in with GitHub
            `;
        }
    }

    showApp() {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('app-section').style.display = 'block';
        document.getElementById('user-name').textContent = this.currentUser.name;

        // Add admin link if user is admin
        if (this.currentUser.isAdmin) {
            const userInfo = document.querySelector('.user-info');
            if (!document.getElementById('admin-link')) {
                const adminLink = document.createElement('a');
                adminLink.id = 'admin-link';
                adminLink.href = '/admin.html';
                adminLink.className = 'btn btn-secondary';
                adminLink.style.marginRight = '10px';
                adminLink.textContent = '🛡️ Admin';
                userInfo.insertBefore(adminLink, userInfo.firstChild);
            }
        }

        this.loadRepositories();
    }

    showLoading(text = 'Loading...') {
        const loadingEl = document.getElementById('loading');
        if (!loadingEl) {
            // Create loading overlay if it doesn't exist
            const overlay = document.createElement('div');
            overlay.id = 'loading';
            overlay.className = 'loading-overlay';
            overlay.style.display = 'flex';
            overlay.innerHTML = `
                <div class="spinner"></div>
                <p id="loading-text">${text}</p>
            `;
            document.body.appendChild(overlay);
        } else {
            loadingEl.style.display = 'flex';
            document.getElementById('loading-text').textContent = text;
        }
    }

    hideLoading() {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
    }

    // Authentication methods
    async loginWithGithub() {
        try {
            this.showLoading('Redirecting to GitHub...');

            // Get OAuth URL from backend
            const result = await this.api.initiateGitHubOAuth();

            if (result.authUrl) {
                // Store state for verification after redirect
                sessionStorage.setItem('oauth_state', result.state);

                // Redirect to GitHub
                window.location.href = result.authUrl;
            }
        } catch (error) {
            alert(`Failed to start GitHub authentication: ${error.message}`);
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

            // Reset pagination state
            this.currentPage = 0;
            this.loadedTranslations.clear();
            this.changes.clear();

            // Connect WebSocket for real-time collaboration
            this.connectWebSocket();

            // Load first page of translations
            await this.loadTranslationPage(0);

            // Update UI
            document.getElementById('workspace-title').textContent =
                `${this.currentRepo.name} - ${this.getLanguageName(language)}`;

            document.getElementById('language-selector').style.display = 'none';
            document.getElementById('translation-workspace').style.display = 'block';

            this.updateChangeCounter();
            this.updatePaginationControls();
        } catch (error) {
            alert(`Failed to load translations: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async loadTranslationPage(page) {
        if (this.isLoading) return;

        this.isLoading = true;
        const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

        try {
            const result = await this.api.getTranslations(
                repoKey,
                this.currentLanguage,
                page,
                this.pageSize,
                this.searchMode ? this.searchTerm : null
            );

            // Store translations in our map
            Object.entries(result.translations).forEach(([msgid, data]) => {
                this.loadedTranslations.set(msgid, data);
            });

            // Update pagination state
            this.currentPage = page;
            this.hasMorePages = result.pagination?.hasMore || false;
            this.totalTranslations = result.pagination?.total || this.loadedTranslations.size;

            // Render the new translations
            if (page === 0) {
                this.renderTranslations();
            } else {
                this.appendTranslations(result.translations);
            }

            this.updatePaginationControls();
        } finally {
            this.isLoading = false;
        }
    }

    renderTranslations() {
        const container = document.getElementById('translation-cards');
        container.innerHTML = '';

        // Add pagination controls at the top
        const topControls = this.createPaginationControls('top');
        container.appendChild(topControls);

        // Render all loaded translations
        this.loadedTranslations.forEach((data, msgid) => {
            const card = this.createTranslationCard(msgid, data);
            container.appendChild(card);
        });

        // Add pagination controls at the bottom
        const bottomControls = this.createPaginationControls('bottom');
        container.appendChild(bottomControls);

        // Add intersection observer for infinite scroll
        this.setupInfiniteScroll();
    }

    appendTranslations(translations) {
        const container = document.getElementById('translation-cards');
        const bottomControls = container.querySelector('.pagination-controls.bottom');

        Object.entries(translations).forEach(([msgid, data]) => {
            const card = this.createTranslationCard(msgid, data);
            container.insertBefore(card, bottomControls);
        });
    }

    createPaginationControls(position) {
        const controls = document.createElement('div');
        controls.className = `pagination-controls ${position}`;
        controls.innerHTML = `
            <div class="pagination-info">
                Showing ${this.loadedTranslations.size} of ${this.totalTranslations || '?'} translations
            </div>
            <div class="pagination-buttons">
                <button onclick="app.previousPage()" ${this.currentPage === 0 ? 'disabled' : ''}>
                    ← Previous
                </button>
                <span class="page-number">Page ${this.currentPage + 1}</span>
                <button onclick="app.nextPage()" ${!this.hasMorePages ? 'disabled' : ''}>
                    Next →
                </button>
            </div>
        `;
        return controls;
    }

    updatePaginationControls() {
        document.querySelectorAll('.pagination-info').forEach(el => {
            el.textContent = `Showing ${this.loadedTranslations.size} of ${this.totalTranslations || '?'} translations`;
        });

        document.querySelectorAll('.page-number').forEach(el => {
            el.textContent = `Page ${this.currentPage + 1}`;
        });

        // Update button states
        document.querySelectorAll('.pagination-controls button').forEach(button => {
            if (button.textContent.includes('Previous')) {
                button.disabled = this.currentPage === 0;
            } else if (button.textContent.includes('Next')) {
                button.disabled = !this.hasMorePages;
            }
        });
    }

    async previousPage() {
        if (this.currentPage > 0) {
            await this.loadTranslationPage(this.currentPage - 1);
        }
    }

    async nextPage() {
        if (this.hasMorePages) {
            await this.loadTranslationPage(this.currentPage + 1);
        }
    }

    setupInfiniteScroll() {
        // Remove any existing observer
        if (this.scrollObserver) {
            this.scrollObserver.disconnect();
        }

        // Create intersection observer for the last few cards
        const cards = document.querySelectorAll('.translation-card');
        if (cards.length > 5) {
            const target = cards[cards.length - 5]; // Watch the 5th from last card

            this.scrollObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting && this.hasMorePages && !this.isLoading) {
                            this.loadMoreTranslations();
                        }
                    });
                },
                { rootMargin: '100px' }
            );

            this.scrollObserver.observe(target);
        }
    }

    async loadMoreTranslations() {
        if (this.hasMorePages && !this.isLoading) {
            const nextPage = this.currentPage + 1;
            await this.loadTranslationPage(nextPage);
        }
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
                >${this.escapeHtml(data.current || data.translation || '')}</textarea>
            </div>
            
            <div class="card-footer">
                ${data.previous || data.previousTranslation ? `
                    <div class="previous-translation">
                        Previous: <em>${this.escapeHtml(data.previous || data.previousTranslation)}</em>
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
            this.ws.send(JSON.stringify({
                type: 'startEdit',
                msgid,
                user: this.currentUser.name
            }));
        }
    }

    async onTranslationBlur(msgid) {
        // Notify others that we've stopped editing
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'endEdit',
                msgid,
                user: this.currentUser.name
            }));
        }

        // Save to backend
        await this.saveTranslation(msgid);
    }

    async onTranslationChange(msgid) {
        const textarea = document.querySelector(`textarea[data-msgid="${msgid}"]`);
        const newValue = textarea.value;
        const data = this.loadedTranslations.get(msgid);

        if (newValue !== (data.current || data.translation || '')) {
            const changeKey = `${this.currentLanguage}:${msgid}`;
            this.changes.set(changeKey, {
                msgid,
                language: this.currentLanguage,
                original: data.original,
                previous: data.current || data.translation || '',
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
            const data = this.loadedTranslations.get(msgid);
            if (data) {
                data.current = change.new;
            }
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

    // Filter and Search with pagination
    filterTranslations() {
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        const filterStatus = document.getElementById('filter-status').value;

        // Clear existing debounce timer
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (searchTerm.length > 2) {
            // Debounce search for server-side search
            this.searchDebounceTimer = setTimeout(async () => {
                this.searchMode = true;
                this.searchTerm = searchTerm;
                this.currentPage = 0;
                this.loadedTranslations.clear();

                this.showLoading('Searching...');
                await this.loadTranslationPage(0);
                this.hideLoading();
            }, 500);
        } else {
            // Local filtering for short searches or status filters
            this.searchMode = false;
            this.searchTerm = '';

            const cards = document.querySelectorAll('.translation-card');
            cards.forEach(card => {
                const msgid = card.dataset.msgid;
                const data = this.loadedTranslations.get(msgid);

                if (!data) {
                    card.style.display = 'none';
                    return;
                }

                const originalText = data.original || '';
                const translationText = data.current || data.translation || '';

                // Search filter
                const matchesSearch = !searchTerm ||
                    msgid.toLowerCase().includes(searchTerm) ||
                    originalText.toLowerCase().includes(searchTerm) ||
                    translationText.toLowerCase().includes(searchTerm);

                // Status filter
                let matchesStatus = true;
                if (filterStatus === 'empty') {
                    matchesStatus = !translationText.trim();
                } else if (filterStatus === 'modified') {
                    const changeKey = `${this.currentLanguage}:${msgid}`;
                    matchesStatus = this.changes.has(changeKey);
                }

                card.style.display = matchesSearch && matchesStatus ? 'block' : 'none';
            });
        }
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
        const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

        this.ws = this.api.connectWebSocket(
            repoKey,
            this.currentLanguage,
            (message) => this.handleWebSocketMessage(message),
            (status) => this.handleWebSocketStatus(status)
        );
    }

    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'startEdit':
                // Another user started editing
                if (data.user !== this.currentUser.name) {
                    this.updateActiveEditor(data.msgid, data.user, true);
                }
                break;

            case 'endEdit':
                // Another user stopped editing
                if (data.user !== this.currentUser.name) {
                    this.updateActiveEditor(data.msgid, data.user, false);
                }
                break;

            case 'translationUpdate':
                // Another user saved a translation
                if (data.userId !== this.currentUser.id) {
                    this.handleRemoteTranslationUpdate(data);
                }
                break;
        }
    }

    handleWebSocketStatus(status) {
        console.log('WebSocket status:', status);
        // Could show connection status in UI
    }

    updateActiveEditor(msgid, user, isActive) {
        const card = document.querySelector(`.translation-card[data-msgid="${msgid}"]`);
        if (!card) return;

        const data = this.loadedTranslations.get(msgid);
        if (!data) return;

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
        const localData = this.loadedTranslations.get(data.msgid);
        if (localData) {
            localData.current = data.translation;
        }

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
        this.disconnectWebSocket();
        this.currentRepo = null;
        this.currentLanguage = null;
        this.changes.clear();
        this.loadedTranslations.clear();
        this.loadRepositories();
    }

    backToLanguages() {
        this.disconnectWebSocket();
        this.currentLanguage = null;
        this.changes.clear();
        this.loadedTranslations.clear();
        this.selectRepository(
            this.currentRepo.owner,
            this.currentRepo.name,
            this.currentRepo.translationPath
        );
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

// Add pagination styles
const style = document.createElement('style');
style.textContent = `
.pagination-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    background: #f8f9fa;
    border-radius: 8px;
    margin: 20px 0;
}

.pagination-controls.top {
    margin-bottom: 20px;
}

.pagination-controls.bottom {
    margin-top: 20px;
}

.pagination-info {
    color: #666;
    font-size: 14px;
}

.pagination-buttons {
    display: flex;
    gap: 15px;
    align-items: center;
}

.pagination-buttons button {
    padding: 8px 16px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.3s ease;
}

.pagination-buttons button:hover:not(:disabled) {
    background: #2980b9;
}

.pagination-buttons button:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
}

.page-number {
    font-weight: 500;
    color: #2c3e50;
}

.loading-more {
    text-align: center;
    padding: 20px;
    color: #7f8c8d;
}

.loading-more .spinner {
    margin: 0 auto;
}
`;
document.head.appendChild(style);

// Updated API Client additions
APIClient.prototype.initiateGitHubOAuth = async function() {
    return this.request('/auth/github/oauth', {
        method: 'POST'
    });
};

APIClient.prototype.completeGitHubOAuth = async function(code, state) {
    const result = await this.request('/auth/github/callback', {
        method: 'POST',
        body: JSON.stringify({ code, state })
    });

    if (result.success) {
        this.setSession(result.sessionToken);
        // Note: GitHub token is now stored server-side only
    }

    return result;
};

// Update APIClient to support pagination
APIClient.prototype.getTranslations = async function(repo, language, page = 0, pageSize = 50, search = null) {
    const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString()
    });

    if (search) {
        params.append('search', search);
    }

    const encodedRepo = encodeURIComponent(repo);
    const result = await this.request(`/translations/${encodedRepo}/${language}?${params}`);
    return result.data || result;
};

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