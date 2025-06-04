class AuthManager {
    static instance = null;

    constructor() {
        if (AuthManager.instance) {
            return AuthManager.instance;
        }
        this.authMethod = null;
        this.credentials = null;
        AuthManager.instance = this;
    }

    static getInstance() {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager();
        }
        return AuthManager.instance;
    }

    async loginWithGithub() {
        // Use GitHub OAuth App flow (requires backend proxy for security)
        // Alternative: Personal Access Token approach for GitHub Pages
        const token = prompt('Enter your GitHub Personal Access Token:');
        if (token) {
            this.authMethod = 'github';
            this.credentials = { token };
            await this.validateGitHubToken(token);
        }
    }

    async loginWithInvite(inviteCode) {
        // Validate against a pre-shared list stored in the repo
        const validTokens = await this.fetchValidTokens();
        if (validTokens.includes(inviteCode)) {
            this.authMethod = 'token';
            this.credentials = { inviteCode, role: 'translator' };
            this.storeAuth();
        }
    }

    async fetchValidTokens() {
        // Fetch from a protected JSON file in your repo
        const response = await fetch('./config/authorized-tokens.json');
        return response.json();
    }

}
export default AuthManager;