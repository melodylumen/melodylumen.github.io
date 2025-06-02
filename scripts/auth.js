// scripts/auth.js
// Placeholder for user authentication and authorization

function showAuthUI() {
    // Render login or invite/token input
    document.getElementById('auth-section').innerHTML = `
    <button onclick="loginWithGithub()">Login with GitHub</button>
    <input type="text" id="inviteToken" placeholder="Enter invite token">
    <button onclick="loginWithToken()">Login with Token</button>
  `;
}

function loginWithGithub() {
    // TODO: Implement GitHub OAuth
    alert('GitHub OAuth not implemented.');
}

function loginWithToken() {
    // TODO: Implement token-based login
    const token = document.getElementById('inviteToken').value;
    alert('Token login not implemented. Token: ' + token);
}

showAuthUI();

// scripts/auth.js - Enhanced authorization
class AuthManager {
    constructor() {
        this.authMethod = null; // 'github' or 'token'
        this.credentials = null;
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