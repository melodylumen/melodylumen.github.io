// scripts/api-client.js - Updated with dynamic language support
class APIClient {
    constructor() {
        // Use the configured API base URL
        this.baseURL = window.CONFIG?.API_BASE_URL || window.WORKER_URL || 'https://gander-social-translation-tool.melody-rae-lumen.workers.dev';
        this.sessionToken = localStorage.getItem('po_tool_session');
        this.githubToken = null;
        
        if (window.CONFIG?.DEBUG) {
            console.log('🔗 APIClient initialized with base URL:', this.baseURL);
        }
    }

    // Set auth tokens
    setSession(sessionToken) {
        this.sessionToken = sessionToken;
        localStorage.setItem('po_tool_session', sessionToken);
    }

    setGithubToken(token) {
        this.githubToken = token;
    }

    clearSession() {
        this.sessionToken = null;
        this.githubToken = null;
        localStorage.removeItem('po_tool_session');
    }

    // Base request method
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}/api${endpoint}`;

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.sessionToken) {
            headers['Authorization'] = `Bearer ${this.sessionToken}`;
        }

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error?.message || error.error || error.message || 'Request failed');
        }

        return response.json();
    }

    // GitHub API helper
    async githubRequest(endpoint, options = {}) {
        if (!this.githubToken) {
            throw new Error('GitHub token not set');
        }

        const response = await fetch(`https://api.github.com${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `token ${this.githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'GitHub API request failed');
        }

        return response.json();
    }

    // Authentication
    async loginWithGithub(token) {
        const result = await this.request('/auth/github', {
            method: 'POST',
            body: JSON.stringify({ token })
        });

        if (result.success) {
            this.setSession(result.sessionToken);
            this.setGithubToken(token);
        }

        return result;
    }

    async loginWithToken(inviteToken, email, name) {
        const result = await this.request('/auth/token', {
            method: 'POST',
            body: JSON.stringify({ inviteToken, email, name })
        });

        if (result.success) {
            this.setSession(result.sessionToken);
        }

        return result;
    }

    async validateSession() {
        return this.request('/auth/validate');
    }

    // Repository operations
    async getRepositories() {
        const result = await this.request('/repositories');
        return result.data?.repositories || result.repositories || [];
    }

    async getRepositoryLanguages(owner, repo) {
        const result = await this.request(`/repositories/${owner}/${repo}/languages`);
        return result.data || result;
    }

    // Language operations
    async createLanguage(repository, languageCode, languageName, sourceLanguage = 'en') {
        const result = await this.request('/languages', {
            method: 'POST',
            body: JSON.stringify({
                repository,
                languageCode,
                languageName,
                sourceLanguage
            })
        });

        if (result.success && result.data) {
            // Store language name locally for quick access
            localStorage.setItem(`lang_name_${languageCode}`, `${languageName} (${languageCode})`);
            return result.data;
        }

        return result;
    }

    // Translation operations
    async getTranslations(repo, language) {
        // Properly encode repository path
        const encodedRepo = encodeURIComponent(repo);
        const result = await this.request(`/translations/${encodedRepo}/${language}`);
        return result.data || result;
    }

    async saveTranslation(repo, language, msgid, translation, metadata = {}) {
        // Properly encode repository path
        const encodedRepo = encodeURIComponent(repo);
        const result = await this.request(`/translations/${encodedRepo}/${language}`, {
            method: 'POST',
            body: JSON.stringify({
                msgid,
                translation,
                ...metadata
            })
        });
        return result.data || result;
    }

    async getPendingChanges(repo = null) {
        const query = repo ? `?repo=${repo}` : '';
        const result = await this.request(`/translations/changes${query}`);
        return result.data || result;
    }

    async submitPR(repo, title, description, changes) {
        const result = await this.request('/translations/submit-pr', {
            method: 'POST',
            body: JSON.stringify({
                repository: repo,
                title,
                description,
                changes,
                useGithubAction: !this.githubToken // Use GitHub Action if no direct token
            })
        });
        return result.data || result;
    }

    // File operations (for GitHub users)
    async fetchPOFile(owner, repo, path) {
        if (!this.githubToken) {
            throw new Error('GitHub access required');
        }

        const fileData = await this.githubRequest(
            `/repos/${owner}/${repo}/contents/${path}`
        );

        // Decode base64 content
        return atob(fileData.content);
    }

    async createPullRequest(owner, repo, title, body, branch, files) {
        if (!this.githubToken) {
            // Fallback to worker-based PR creation
            return this.submitPR(`${owner}/${repo}`, title, body, files);
        }

        // Direct GitHub PR creation
        // 1. Get default branch
        const repoData = await this.githubRequest(`/repos/${owner}/${repo}`);
        const baseBranch = repoData.default_branch;

        // 2. Get base commit
        const baseRef = await this.githubRequest(
            `/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`
        );
        const baseSha = baseRef.object.sha;

        // 3. Create new branch
        await this.githubRequest(`/repos/${owner}/${repo}/git/refs`, {
            method: 'POST',
            body: JSON.stringify({
                ref: `refs/heads/${branch}`,
                sha: baseSha
            })
        });

        // 4. Update files
        for (const file of files) {
            const currentFile = await this.githubRequest(
                `/repos/${owner}/${repo}/contents/${file.path}`
            );

            await this.githubRequest(
                `/repos/${owner}/${repo}/contents/${file.path}`,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        message: `Update ${file.language} translations`,
                        content: btoa(file.content),
                        sha: currentFile.sha,
                        branch
                    })
                }
            );
        }

        // 5. Create PR
        const pr = await this.githubRequest(`/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            body: JSON.stringify({
                title,
                body,
                head: branch,
                base: baseBranch
            })
        });

        return {
            success: true,
            prUrl: pr.html_url,
            prNumber: pr.number
        };
    }

    // WebSocket for real-time collaboration
    connectWebSocket(repo, language, onMessage, onStatusChange) {
        const wsUrl = this.baseURL.replace('https://', 'wss://').replace('http://', 'ws://');
        const params = new URLSearchParams({
            repo,
            language,
            sessionId: this.sessionToken,
            userId: this.userId || 'unknown',
            userName: this.userName || 'Unknown User'
        });

        const ws = new WebSocket(`${wsUrl}/api/ws?${params}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
            onStatusChange && onStatusChange('connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage && onMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            onStatusChange && onStatusChange('error');
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            onStatusChange && onStatusChange('disconnected');
        };

        // Send periodic heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            } else {
                clearInterval(heartbeat);
            }
        }, 30000); // Every 30 seconds

        // Store heartbeat interval on ws object for cleanup
        ws._heartbeat = heartbeat;

        // Override close to cleanup heartbeat
        const originalClose = ws.close.bind(ws);
        ws.close = function(...args) {
            clearInterval(ws._heartbeat);
            originalClose(...args);
        };

        return ws;
    }
}

// Export for use in other scripts
window.APIClient = APIClient;