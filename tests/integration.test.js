import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import { TranslationHandler } from '../src/translation-handler.js';

describe('PO Translation Tool Integration Tests', () => {
    let worker;
    let testUser;
    let sessionToken;

    beforeAll(async () => {
        // Start worker in test mode
        worker = await unstable_dev('src/index.js', {
            experimental: { disableExperimentalWarning: true },
            vars: {
                ENVIRONMENT: 'test',
                JWT_SECRET: 'test-secret'
            }
        });
    });

    afterAll(async () => {
        await worker.stop();
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

describe('TranslationHandler Unit Tests', () => {
    describe('Branch Management', () => {
        test('should generate correct branch name', () => {
            const today = new Date().toISOString().split('T')[0];
            const branchName = TranslationHandler.generateBranchName('fr');

            expect(branchName).toBe(`language-update-fr-${today}`);
        });

        test('should escape PO strings correctly', () => {
            const input = 'Test "quoted" string\nwith newline';
            const escaped = TranslationHandler.escapePoString(input);

            expect(escaped).toBe('Test \\"quoted\\" string\\nwith newline');
        });

        test('should generate valid PO file header', () => {
            const poFile = TranslationHandler.generateNewPoFile('fr');

            expect(poFile).toContain('Language: fr\\n');
            expect(poFile).toContain('Content-Type: text/plain; charset=UTF-8');
        });
    });

    describe('PR Body Generation', () => {
        test('should generate comprehensive PR body', () => {
            const changes = [{
                msgid: 'test.message',
                language: 'fr',
                original: 'Test',
                previous: '',
                new: 'Test français'
            }];

            const user = { name: 'Test User', email: 'test@example.com' };
            const body = TranslationHandler.generatePRBody('Test PR', 'Description', changes, user);

            expect(body).toContain('Test User');
            expect(body).toContain('test@example.com');
            expect(body).toContain('Test français');
            expect(body).toContain('Indigenous language preservation');
        });
    });
});

// tests/e2e/full-workflow.test.js
import { describe, test, expect } from 'vitest';
import puppeteer from 'puppeteer';

describe('E2E Translation Workflow', () => {
    let browser;
    let page;

    beforeAll(async () => {
        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
        await page.goto('http://localhost:8000');
    });

    afterAll(async () => {
        await browser.close();
    });

    test('complete translation workflow', async () => {
        // Login with token
        await page.type('#inviteToken', 'DEV-TOKEN-123');
        await page.type('#tokenEmail', 'e2e@test.com');
        await page.type('#tokenName', 'E2E Test');
        await page.click('.btn-token');

        // Wait for app to load
        await page.waitForSelector('#repo-list', { timeout: 5000 });

        // Select repository
        await page.click('.repo-card');
        await page.waitForSelector('.language-grid');

        // Select language
        await page.click('.language-btn');
        await page.waitForSelector('.translation-card');

        // Edit a translation
        const textarea = await page.$('.translation-input');
        await textarea.click({ clickCount: 3 });
        await textarea.type('Test translation');

        // Check change indicator
        await page.waitForSelector('.change-indicator');

        // Submit PR
        await page.click('#submit-pr-btn');
        await page.waitForSelector('#changes-modal');

        // Verify changes
        const changeCount = await page.$eval('#change-count', el => el.textContent);
        expect(parseInt(changeCount)).toBeGreaterThan(0);
    });
});