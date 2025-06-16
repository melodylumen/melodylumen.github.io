// scripts/admin-app.js
class AdminApp {
    constructor() {
        this.api = new APIClient();
        this.currentSection = 'dashboard';
        this.stats = {};
        this.tokens = [];
        this.users = [];
        this.newToken = null;
    }

    async init() {
        // Verify admin session
        try {
            const validation = await this.api.validateSession();
            if (!validation.valid || !validation.user.isAdmin) {
                window.location.href = '/';
                return;
            }

            this.currentUser = validation.user;
            document.getElementById('admin-user-name').textContent = this.currentUser.name;

            // Load initial data
            await this.loadDashboard();

        } catch (error) {
            console.error('Admin validation failed:', error);
            window.location.href = '/';
        }
    }

    // Section navigation
    showSection(section) {
        // Update nav buttons
        document.querySelectorAll('.nav-button').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        // Hide all sections
        document.querySelectorAll('.admin-section').forEach(sec => {
            sec.classList.remove('active');
        });

        // Show selected section
        document.getElementById(`${section}-section`).classList.add('active');
        this.currentSection = section;

        // Load section data
        switch (section) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'tokens':
                this.loadTokens('active');
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'settings':
                this.loadSettings();
                break;
        }
    }

    // Dashboard
    async loadDashboard() {
        try {
            // Load statistics
            const [tokenStats, userStats, translationStats] = await Promise.all([
                this.api.request('/admin/tokens/stats'),
                this.api.request('/admin/users?limit=1'), // Just for count
                this.api.request('/translations/stats')
            ]);

            // Update stat cards
            document.getElementById('stat-active-tokens').textContent =
                tokenStats.stats?.summary?.active_tokens || 0;
            document.getElementById('stat-total-users').textContent =
                userStats.users?.length || 0;
            document.getElementById('stat-translations').textContent =
                translationStats.monthlyCount || 0;
            document.getElementById('stat-languages').textContent =
                translationStats.activeLanguages || 0;

            // Draw charts
            this.drawTokenUsageChart(tokenStats.stats?.recentActivity || []);
            this.drawTranslationActivityChart(translationStats.dailyActivity || []);

        } catch (error) {
            console.error('Failed to load dashboard:', error);
        }
    }

    drawTokenUsageChart(data) {
        const canvas = document.getElementById('token-usage-chart');
        if (!canvas) return;

        // Simple chart rendering - in production use Chart.js
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Placeholder - implement actual chart
        ctx.fillStyle = '#3498db';
        ctx.fillText('Token usage chart placeholder', 10, 20);
    }

    drawTranslationActivityChart(data) {
        const canvas = document.getElementById('translation-activity-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Placeholder - implement actual chart
        ctx.fillStyle = '#2ecc71';
        ctx.fillText('Translation activity chart placeholder', 10, 20);
    }

    // Token Management
    async createToken(event) {
        event.preventDefault();

        const form = event.target;
        const formData = new FormData(form);

        const tokenData = {
            description: formData.get('description'),
            expiresAt: this.calculateExpiration(parseInt(formData.get('expiration'))),
            usageLimit: formData.get('usageLimit') ? parseInt(formData.get('usageLimit')) : null,
            allowedLanguages: formData.get('allowedLanguages') ?
                formData.get('allowedLanguages').split(',').map(l => l.trim()) : null,
            allowedRepositories: formData.get('allowedRepositories') ?
                formData.get('allowedRepositories').split(',').map(r => r.trim()) : null
        };

        try {
            const result = await this.api.request('/admin/tokens', {
                method: 'POST',
                body: JSON.stringify(tokenData)
            });

            if (result.success) {
                this.newToken = result.token.token;
                document.getElementById('new-token-display').textContent = this.newToken;
                this.showModal('token-modal');

                // Reset form and reload tokens
                form.reset();
                await this.loadTokens('active');
            }
        } catch (error) {
            alert(`Failed to create token: ${error.message}`);
        }
    }

    calculateExpiration(days) {
        if (days === 0) return null; // Never expires

        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString();
    }

    async loadTokens(filter = 'all') {
        try {
            const result = await this.api.request(`/admin/tokens?active=${filter === 'active'}`);
            this.tokens = result.tokens || [];
            this.renderTokensTable();
        } catch (error) {
            console.error('Failed to load tokens:', error);
        }
    }

    renderTokensTable() {
        const tbody = document.getElementById('tokens-list');

        if (this.tokens.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <div class="empty-state-icon">🎫</div>
                        <p>No tokens found</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.tokens.map(token => {
            const status = this.getTokenStatus(token);
            const usagePercent = token.usage_limit ?
                (token.usage_count / token.usage_limit * 100) : 0;

            return `
                <tr>
                    <td>
                        <span class="token-code">${token.token}</span>
                        <button class="btn btn-secondary" onclick="adminApp.copyTokenValue('${token.token}')">
                            📋
                        </button>
                    </td>
                    <td>${this.escapeHtml(token.description || 'No description')}</td>
                    <td>
                        <span class="status-badge status-${status}">
                            ${status.toUpperCase()}
                        </span>
                    </td>
                    <td>
                        <div class="usage-bar">
                            <div class="usage-fill" style="width: ${usagePercent}%"></div>
                        </div>
                        ${token.usage_count}${token.usage_limit ? `/${token.usage_limit}` : ''}
                    </td>
                    <td>${new Date(token.created_at).toLocaleDateString()}</td>
                    <td>${token.expires_at ? new Date(token.expires_at).toLocaleDateString() : 'Never'}</td>
                    <td>
                        ${token.is_active ? `
                            <button class="btn btn-danger" onclick="adminApp.revokeToken('${token.token}')">
                                Revoke
                            </button>
                        ` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    getTokenStatus(token) {
        if (!token.is_active) return 'revoked';
        if (token.expires_at && new Date(token.expires_at) < new Date()) return 'expired';
        return 'active';
    }

    async revokeToken(token) {
        if (!confirm(`Are you sure you want to revoke token ${token}?`)) {
            return;
        }

        try {
            await this.api.request('/admin/tokens/revoke', {
                method: 'POST',
                body: JSON.stringify({ token })
            });

            await this.loadTokens('all');
            alert('Token revoked successfully');
        } catch (error) {
            alert(`Failed to revoke token: ${error.message}`);
        }
    }

    copyToken() {
        this.copyTokenValue(this.newToken);
    }

    copyTokenValue(token) {
        navigator.clipboard.writeText(token).then(() => {
            alert('Token copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy token:', err);
            // Fallback
            const textArea = document.createElement('textarea');
            textArea.value = token;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('Token copied to clipboard');
        });
    }

    async exportTokens() {
        try {
            const result = await this.api.request('/admin/tokens?limit=1000');
            const tokens = result.tokens || [];

            // Convert to CSV
            const csv = this.tokensToCSV(tokens);

            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tokens_export_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            alert(`Failed to export tokens: ${error.message}`);
        }
    }

    tokensToCSV(tokens) {
        const headers = ['Token', 'Description', 'Status', 'Usage', 'Created', 'Expires', 'Creator'];
        const rows = tokens.map(token => [
            token.token,
            token.description || '',
            this.getTokenStatus(token),
            `${token.usage_count}${token.usage_limit ? `/${token.usage_limit}` : ''}`,
            new Date(token.created_at).toISOString(),
            token.expires_at || 'Never',
            token.creator_email || ''
        ]);

        return [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
    }

    // User Management
    async loadUsers() {
        try {
            // Load admin users
            const adminResult = await this.api.request('/admin/users?role=admin');
            this.renderAdminUsers(adminResult.users || []);

            // Load recent users
            const usersResult = await this.api.request('/admin/users?limit=50');
            this.users = usersResult.users || [];
            this.renderUsersTable();
        } catch (error) {
            console.error('Failed to load users:', error);
        }
    }

    renderAdminUsers(admins) {
        const list = document.getElementById('admin-users-list');

        if (admins.length === 0) {
            list.innerHTML = '<li class="empty-state">No admin users</li>';
            return;
        }

        list.innerHTML = admins.map(admin => `
            <li class="admin-item">
                <div class="admin-info">
                    <div class="admin-avatar">
                        ${admin.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <strong>${this.escapeHtml(admin.name)}</strong>
                        <br>
                        <small>${this.escapeHtml(admin.email)}</small>
                        ${admin.github_username ? `<small> (@${admin.github_username})</small>` : ''}
                    </div>
                </div>
                <div>
                    <button class="btn btn-danger" onclick="adminApp.removeAdmin('${admin.id}')">
                        Remove Admin
                    </button>
                </div>
            </li>
        `).join('');
    }

    renderUsersTable() {
        const tbody = document.getElementById('users-list');

        if (this.users.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <div class="empty-state-icon">👥</div>
                        <p>No users found</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.users.map(user => `
            <tr>
                <td>
                    <strong>${this.escapeHtml(user.name)}</strong>
                    ${user.github_username ? `<br><small>@${user.github_username}</small>` : ''}
                </td>
                <td>${this.escapeHtml(user.email)}</td>
                <td>${user.auth_method}</td>
                <td>${user.last_active ? new Date(user.last_active).toLocaleDateString() : 'Never'}</td>
                <td>${user.translation_count || 0}</td>
                <td>
                    <button class="btn btn-secondary" onclick="adminApp.viewUserDetails('${user.id}')">
                        View
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async searchUsers() {
        const search = document.getElementById('user-search').value;

        if (search.length < 2 && search.length > 0) return;

        try {
            const result = await this.api.request(`/admin/users?search=${encodeURIComponent(search)}`);
            this.users = result.users || [];
            this.renderUsersTable();
        } catch (error) {
            console.error('Search failed:', error);
        }
    }

    showAddAdminModal() {
        this.showModal('add-admin-modal');
    }

    async addAdmin(event) {
        event.preventDefault();

        const form = event.target;
        const formData = new FormData(form);

        const data = {
            githubUsername: formData.get('githubUsername'),
            permissions: {
                canManageTokens: formData.get('canManageTokens') === 'on',
                canManageUsers: formData.get('canManageUsers') === 'on',
                canViewStats: formData.get('canViewStats') === 'on'
            }
        };

        try {
            await this.api.request('/admin/users/grant-admin', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            alert('Admin access granted successfully');
            this.closeModal('add-admin-modal');
            form.reset();
            await this.loadUsers();
        } catch (error) {
            alert(`Failed to grant admin access: ${error.message}`);
        }
    }

    async removeAdmin(userId) {
        if (!confirm('Are you sure you want to remove admin access?')) {
            return;
        }

        try {
            await this.api.request(`/admin/users/${userId}/remove-admin`, {
                method: 'POST'
            });

            await this.loadUsers();
        } catch (error) {
            alert(`Failed to remove admin: ${error.message}`);
        }
    }

    async viewUserDetails(userId) {
        // Implement user details modal
        alert('User details view not implemented yet');
    }

    // Settings
    async loadSettings() {
        try {
            // Load repository configuration
            const repoResult = await this.api.request('/admin/config/repositories');
            const repos = repoResult.repositories || [];

            document.getElementById('repo-config').value =
                JSON.stringify(repos, null, 2);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async saveRepoConfig() {
        try {
            const configText = document.getElementById('repo-config').value;
            const repositories = JSON.parse(configText);

            await this.api.request('/admin/config/repositories', {
                method: 'PUT',
                body: JSON.stringify({ repositories })
            });

            alert('Repository configuration saved successfully');
        } catch (error) {
            alert(`Failed to save configuration: ${error.message}`);
        }
    }

    // Modal management
    showModal(modalId) {
        document.getElementById(modalId).style.display = 'flex';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    // Utility
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    logout() {
        if (confirm('Are you sure you want to logout?')) {
            this.api.clearSession();
            window.location.href = '/';
        }
    }
}

// Initialize admin app
const adminApp = new AdminApp();
document.addEventListener('DOMContentLoaded', () => {
    adminApp.init();
});