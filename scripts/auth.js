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