// scripts/api-client.js - API client for Cloudflare Workers backend
class APIClient {
    constructor() {
        // Use environment variable or default to local development
        this.baseURL = window.WORKER_URL || 'https://gander-social-translation-tool.workers.dev';
        this.sessionToken = localStorage.getItem('po_tool_session');
        this.githubToken = null;
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
            throw new Error(error.error || error.message || 'Request failed');
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
        // Get from worker config
        const config = await this.request('/repositories');
        return config.repositories;
    }

    async getRepositoryLanguages(owner, repo) {
        // First check if we have GitHub access
        if (this.githubToken) {
            // Get languages from the actual repository
            const path = `${owner}/${repo}`;
            const repoConfig = await this.request(`/repositories/${owner}/${repo}/languages`);

            if (repoConfig.useGithub) {
                const contents = await this.githubRequest(
                    `/repos/${owner}/${repo}/contents/${repoConfig.translationPath}`
                );

                return contents
                    .filter(item => item.type === 'dir' && item.name !== 'en')
                    .map(item => item.name);
            }
        }

        // Fallback to configured languages
        return this.request(`/repositories/${owner}/${repo}/languages`);
    }

    // Translation operations
    async getTranslations(repo, language) {
        return this.request(`/translations/${repo}/${language}`);
    }

    async saveTranslation(repo, language, msgid, translation, metadata = {}) {
        return this.request(`/translations/${repo}/${language}`, {
            method: 'POST',
            body: JSON.stringify({
                msgid,
                translation,
                ...metadata
            })
        });
    }

    async getPendingChanges(repo = null) {
        const query = repo ? `?repo=${repo}` : '';
        return this.request(`/translations/changes${query}`);
    }

    async submitPR(repo, title, description, changes) {
        return this.request('/translations/submit-pr', {
            method: 'POST',
            body: JSON.stringify({
                repository: repo,
                title,
                description,
                changes,
                useGithubAction: !this.githubToken // Use GitHub Action if no direct token
            })
        });
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
        const ws = new WebSocket(`${wsUrl}/api/ws?repo=${repo}&language=${language}&token=${this.sessionToken}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
            onStatusChange && onStatusChange('connected');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            onMessage && onMessage(data);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            onStatusChange && onStatusChange('error');
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            onStatusChange && onStatusChange('disconnected');
        };

        return ws;
    }
}

// Export for use in other scripts
window.APIClient = APIClient;