// scripts/admin.js - Admin management utilities

const WORKER_URL = process.env.WORKER_URL || 'https://gander-social-translation-tool.workers.dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

class AdminClient {
    constructor(workerUrl, adminToken) {
        this.baseUrl = workerUrl;
        this.token = adminToken;
    }

    async request(method, endpoint, data = null) {
        const response = await fetch(`${this.baseUrl}/api/admin${endpoint}`, {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: data ? JSON.stringify(data) : null
        });

        if (!response.ok) {
            throw new Error(`Admin API error: ${response.statusText}`);
        }

        return response.json();
    }

    // Token Management
    async updateTokens(tokens, validUntil) {
        return this.request('PUT', '/tokens', { tokens, validUntil });
    }

    async listTokens() {
        return this.request('GET', '/tokens');
    }

    async revokeToken(token) {
        return this.request('DELETE', `/tokens/${token}`);
    }

    // Repository Management
    async updateRepositories(repositories) {
        return this.request('PUT', '/repositories', repositories);
    }

    async addRepository(repo) {
        return this.request('POST', '/repositories', repo);
    }

    async removeRepository(owner, name) {
        return this.request('DELETE', `/repositories/${owner}/${name}`);
    }

    // User Management
    async listUsers(limit = 100, offset = 0) {
        return this.request('GET', `/users?limit=${limit}&offset=${offset}`);
    }

    async getUserStats(userId) {
        return this.request('GET', `/users/${userId}/stats`);
    }

    async deactivateUser(userId) {
        return this.request('POST', `/users/${userId}/deactivate`);
    }

    // Session Management
    async listActiveSessions() {
        return this.request('GET', '/sessions/active');
    }

    async terminateSession(sessionId) {
        return this.request('DELETE', `/sessions/${sessionId}`);
    }

    // Database Maintenance
    async cleanupOldSessions(days = 30) {
        return this.request('POST', '/maintenance/cleanup-sessions', { days });
    }

    async exportData(type = 'all') {
        return this.request('GET', `/export/${type}`);
    }

    // Metrics
    async getMetrics(startDate, endDate) {
        return this.request('GET', `/metrics?start=${startDate}&end=${endDate}`);
    }

    async getLanguageStats() {
        return this.request('GET', '/metrics/languages');
    }
}

// CLI Commands
const admin = new AdminClient(WORKER_URL, ADMIN_TOKEN);

const commands = {
    // Token management
    async addTokens(tokens) {
        const validUntil = new Date();
        validUntil.setFullYear(validUntil.getFullYear() + 1);

        const result = await admin.updateTokens(tokens, validUntil.toISOString());
        console.log('Tokens added:', result);
    },

    async listTokens() {
        const tokens = await admin.listTokens();
        console.table(tokens);
    },

    // Repository management
    async addRepo(owner, name, description, translationPath) {
        const repo = {
            owner,
            name,
            description,
            translationPath: translationPath || 'src/locale/locales',
            requiresAuth: true
        };

        const result = await admin.addRepository(repo);
        console.log('Repository added:', result);
    },

    async listRepos() {
        const repos = await admin.request('GET', '/repositories');
        console.table(repos);
    },

    // User management
    async listUsers(limit = 10) {
        const users = await admin.listUsers(limit);
        console.table(users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            authMethod: u.auth_method,
            lastActive: u.last_active
        })));
    },

    async userStats(userId) {
        const stats = await admin.getUserStats(userId);
        console.log('User Statistics:');
        console.log('Total translations:', stats.totalTranslations);
        console.log('Languages worked on:', stats.languages);
        console.log('Total time spent:', stats.totalTimeMinutes, 'minutes');
        console.log('Recent activity:');
        console.table(stats.recentActivity);
    },

    // Maintenance
    async cleanup(days = 30) {
        const result = await admin.cleanupOldSessions(days);
        console.log(`Cleaned up ${result.deleted} old sessions`);
    },

    async export(type = 'users') {
        const data = await admin.exportData(type);
        const filename = `export_${type}_${new Date().toISOString()}.json`;
        require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`Data exported to ${filename}`);
    },

    // Metrics
    async metrics(days = 30) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const metrics = await admin.getMetrics(
            startDate.toISOString(),
            endDate.toISOString()
        );

        console.log('Translation Metrics:');
        console.log('Total translations:', metrics.totalTranslations);
        console.log('Active users:', metrics.activeUsers);
        console.log('Languages:', metrics.languageCount);

        console.log('\nDaily activity:');
        console.table(metrics.dailyActivity);
    },

    async languageStats() {
        const stats = await admin.getLanguageStats();
        console.table(stats.map(s => ({
            language: s.language_code,
            translations: s.total_translations,
            translators: s.unique_translators,
            completionRate: `${s.completion_rate}%`,
            lastActivity: s.last_activity
        })));
    }
};

// CLI Interface
const command = process.argv[2];
const args = process.argv.slice(3);

if (!command || !commands[command]) {
    console.log('Available commands:');
    console.log('  addTokens <token1> <token2> ...');
    console.log('  listTokens');
    console.log('  addRepo <owner> <name> <description> [translationPath]');
    console.log('  listRepos');
    console.log('  listUsers [limit]');
    console.log('  userStats <userId>');
    console.log('  cleanup [days]');
    console.log('  export [type]');
    console.log('  metrics [days]');
    console.log('  languageStats');
    process.exit(1);
}

// Execute command
commands[command](...args).catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});

// Export for use in other scripts
module.exports = { AdminClient };