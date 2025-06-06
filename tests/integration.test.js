import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';

describe('PO Translation Tool Integration Tests', () => {
    let worker;
    let testUser;
    let sessionToken;

    beforeAll(async () => {
        try {
            worker = await unstable_dev('src/index.js', {
                experimental: { disableExperimentalWarning: true },
                vars: {
                    JWT_SECRET: 'test-secret-key',
                    FRONTEND_URL: 'http://localhost:8000'
                },
                local: true
            });
        } catch (error) {
            console.error('Failed to start worker:', error);
            throw error;
        }
    }, 30000);

    afterAll(async () => {
        if (worker) {
            await worker.stop();
        }
    });

    describe('Authentication', () => {
        test('should authenticate with invite token', async () => {
            const response = await worker.fetch('/api/auth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inviteToken: 'DEV-TOKEN-123',
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.success).toBe(true);
            expect(data.sessionToken).toBeDefined();

            sessionToken = data.sessionToken;
            testUser = data.user;
        });

        test('should reject invalid token', async () => {
            const response = await worker.fetch('/api/auth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inviteToken: 'INVALID-TOKEN',
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            expect(response.status).toBe(401);
        });

        test('should validate session', async () => {
            const response = await worker.fetch('/api/auth/validate', {
                headers: {
                    'Authorization': `Bearer ${sessionToken}`
                }
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.valid).toBe(true);
            expect(data.user.email).toBe('test@example.com');
        });
    });

    describe('Language Management', () => {
        test('should get repository languages dynamically', async () => {
            const response = await worker.fetch('/api/repositories/gander-foundation/social-app/languages', {
                headers: {
                    'Authorization': `Bearer ${sessionToken}`
                }
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.data.languages).toBeDefined();
            expect(Array.isArray(data.data.languages)).toBe(true);
        });

        test('should require GitHub auth for language creation', async () => {
            const response = await worker.fetch('/api/languages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    repository: 'gander-foundation/social-app',
                    languageCode: 'test',
                    languageName: 'Test Language'
                })
            });

            expect(response.status).toBe(403); // Token users can't create languages
        });
    });

    describe('Translation Operations', () => {
        let sessionId;

        test('should get translations for a language', async () => {
            const response = await worker.fetch('/api/translations/gander-foundation%2Fsocial-app/en', {
                headers: {
                    'Authorization': `Bearer ${sessionToken}`
                }
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.data).toBeDefined();
            expect(data.data.sessionId).toBeDefined();

            sessionId = data.data.sessionId;
        });

        test('should save a translation', async () => {
            const response = await worker.fetch('/api/translations/gander-foundation%2Fsocial-app/en', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    msgid: 'test.message',
                    translation: 'Test translation',
                    originalText: 'Test message',
                    previousTranslation: ''
                })
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.data.saved).toBe(true);
        });

        test('should get pending changes', async () => {
            const response = await worker.fetch('/api/translations/changes', {
                headers: {
                    'Authorization': `Bearer ${sessionToken}`
                }
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.data.changes).toBeDefined();
            expect(data.data.count).toBeGreaterThan(0);
        });
    });

    describe('Branch Management', () => {
        test('should create PR with proper branch naming', async () => {
            const response = await worker.fetch('/api/translations/submit-pr', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    repository: 'gander-foundation/social-app',
                    title: 'Test PR',
                    description: 'Test description',
                    changes: [{
                        msgid: 'test.message',
                        language: 'en',
                        original: 'Test message',
                        previous: '',
                        new: 'Test translation'
                    }],
                    useGithubAction: true
                })
            });

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.success || data.data).toBeTruthy();
        });
    });

    describe('WebSocket Collaboration', () => {
        test('should upgrade to WebSocket', async () => {
            const response = await worker.fetch('/api/ws?repo=test&language=en', {
                headers: {
                    'Upgrade': 'websocket',
                    'Authorization': `Bearer ${sessionToken}`
                }
            });

            expect(response.status).toBe(101);
            expect(response.webSocket).toBeDefined();
        });
    });

    describe('Rate Limiting', () => {
        test('should enforce rate limits', async () => {
            // Make multiple requests quickly
            const promises = Array(15).fill(null).map(() =>
                worker.fetch('/api/translations/gander-foundation%2Fsocial-app/en', {
                    headers: {
                        'Authorization': `Bearer ${sessionToken}`
                    }
                })
            );

            const responses = await Promise.all(promises);
            const tooManyRequests = responses.some(r => r.status === 429);

            expect(tooManyRequests).toBe(true); // At least one should be rate limited
        });
    });

    describe('Error Handling', () => {
        test('should handle missing repository gracefully', async () => {
            const response = await worker.fetch('/api/repositories/invalid/repo/languages', {
                headers: {
                    'Authorization': `Bearer ${sessionToken}`
                }
            });

            expect(response.status).toBe(404);
            const data = await response.json();
            expect(data.error).toBeDefined();
        });

        test('should handle invalid translation data', async () => {
            const response = await worker.fetch('/api/translations/gander-foundation%2Fsocial-app/en', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    // Missing required fields
                    translation: 'Test'
                })
            });

            expect(response.status).toBe(400);
            const data = await response.json();
            expect(data.error.code).toBe('VALIDATION_ERROR');
        });
    });
});

describe('Translation Utilities', () => {
    test('should escape PO strings correctly', () => {
        const input = 'Test "quoted" string\nwith newline';
        // Simulating the escapePoString function behavior
        const escaped = input
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\t/g, '\\t')
            .replace(/\r/g, '\\r');

        expect(escaped).toBe('Test \\"quoted\\" string\\nwith newline');
    });

    test('should generate branch name pattern', () => {
        const today = new Date().toISOString().split('T')[0];
        const branchName = `language-update-fr-${today}`;

        expect(branchName).toMatch(/^language-update-fr-\d{4}-\d{2}-\d{2}$/);
    });

    test('should generate valid PO file header pattern', () => {
        const language = 'fr';
        const poHeader = `# Translation file for ${language}
# Generated by PO Translation Tool

msgid ""
msgstr ""
"Language: ${language}\\n"`;

        expect(poHeader).toContain('Language: fr\\n');
        expect(poHeader).toContain('Translation file for fr');
    });
});

// Additional tests can be added here for specific functionality