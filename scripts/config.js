// scripts/config.js - Repository configuration management
class RepositoryConfig {
    constructor() {
        this.targetRepo = null;
        this.baseBranch = 'main';
        this.translationPath = '';
    }

    async loadConfig() {
        try {
            const response = await fetch('./config/repositories.json');
            const config = await response.json();
            return config;
        } catch (error) {
            console.error('Failed to load repository configuration:', error);
            return null;
        }
    }

    setTargetRepository(owner, repo, path) {
        this.targetRepo = { owner, repo };
        this.translationPath = path;
        localStorage.setItem('targetRepo', JSON.stringify({
            owner, repo, path
        }));
    }

    async fetchPoFiles() {
        if (!this.targetRepo) return null;

        const { owner, repo } = this.targetRepo;
        const auth = AuthManager.getInstance();

        if (auth.authMethod === 'github') {
            // Use GitHub API to fetch files
            const headers = {
                'Authorization': `token ${auth.credentials.token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${this.translationPath}`,
                { headers }
            );

            return response.json();
        } else {
            // For non-GitHub users, fetch from your proxy or cached files
            return this.fetchCachedPoFiles();
        }
    }

    async fetchFileContent(path) {
        const { owner, repo } = this.targetRepo;
        const auth = AuthManager.getInstance();

        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
            {
                headers: {
                    'Authorization': `token ${auth.credentials.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        const data = await response.json();
        // Decode base64 content
        return atob(data.content);
    }
}