// src/translation-handler.js - Handle translation endpoints
import { AuthHandler } from './auth-handler.js';

export class TranslationHandler {
    static async getRepositories(request) {
        // Return configured repositories
        // In production, this could be stored in KV or D1
        const repositories = [
            {
                owner: 'gander-foundation',
                name: 'social-app',
                description: 'Gander Social Application',
                translationPath: 'src/locale/locales',
                languages: ['cr', 'iu', 'oj', 'miq', 'innu'],
                requiresAuth: true
            }
            // Add more repositories as needed
        ];

        return new Response(JSON.stringify({ repositories }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    static async getLanguages(request) {
        // Extract params from URL
        const url = new URL(request.url);
        const pathParts = url.pathname.split('/');
        const owner = pathParts[pathParts.length - 3];
        const repo = pathParts[pathParts.length - 2];

        // In production, check repository config
        const languages = ['cr', 'iu', 'oj', 'miq', 'innu']; // Example

        return new Response(JSON.stringify({ languages }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    static async getTranslations(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const pathParts = url.pathname.split('/');
            const repo = pathParts[pathParts.length - 2];
            const language = pathParts[pathParts.length - 1];

            // Get or create session
            const session = await request.db.getActiveSession(
                request.userId,
                repo,
                language
            );

            let sessionId = session?.id;
            if (!sessionId) {
                sessionId = await request.db.createSession(request.userId, repo, language);
            }

            // Get translation progress for this session
            const progress = await request.db.getTranslationProgress(sessionId);

            // Transform to expected format
            const translations = {};
            progress.forEach(item => {
                translations[item.msgid] = {
                    original: item.original_text,
                    current: item.translated_text,
                    previous: item.previous_translation
                };
            });

            return new Response(JSON.stringify({
                sessionId,
                language,
                translations,
                metadata: {
                    totalCount: Object.keys(translations).length,
                    repository: repo
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async saveTranslation(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const pathParts = url.pathname.split('/');
            const repo = pathParts[pathParts.length - 2];
            const language = pathParts[pathParts.length - 1];

            const data = await request.json();
            const { msgid, translation, originalText, previousTranslation, filePath } = data;

            // Get or create session
            let session = await request.db.getActiveSession(request.userId, repo, language);
            if (!session) {
                const sessionId = await request.db.createSession(request.userId, repo, language);
                session = { id: sessionId };
            }

            // Save translation
            await request.db.saveTranslation(
                session.id,
                msgid,
                filePath || `${language}/messages.po`,
                originalText,
                translation,
                previousTranslation
            );

            // Record in edit history
            await request.db.recordEdit(
                msgid,
                filePath || `${language}/messages.po`,
                request.userId,
                session.id,
                'edit',
                previousTranslation,
                translation
            );

            // Update metrics
            const wordCount = translation.split(/\s+/).length;
            const charCount = translation.length;
            await request.db.updateMetrics(
                request.userId,
                language,
                1, // translations completed
                wordCount,
                charCount,
                1 // rough estimate of time spent
            );

            // Broadcast update via WebSocket (if implemented)
            // await broadcastTranslationUpdate(repo, language, msgid, translation, request.userId);

            return new Response(JSON.stringify({
                success: true,
                sessionId: session.id
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async getPendingChanges(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const repo = url.searchParams.get('repo');

            const changes = await request.db.getPendingChanges(request.userId, repo);

            return new Response(JSON.stringify({
                changes,
                count: changes.length
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async submitPR(request) {
        try {
            await AuthHandler.requireAuth(request);

            const data = await request.json();
            const { repository, title, description, changes, useGithubAction } = data;

            // Get user details
            const user = await request.db.getUserById(request.userId);

            if (useGithubAction || !request.session.githubToken) {
                // Trigger GitHub Action to create PR
                await TranslationHandler.triggerGitHubAction(
                    request.env,
                    repository,
                    changes,
                    title,
                    description,
                    user
                );

                // Mark changes as submitted
                const changeIds = changes.map(c => `${c.sessionId}:${c.msgid}`);
                await request.db.markChangesAsSubmitted(changeIds, 'pending');

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Pull request creation initiated. You will receive a notification when complete.'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });

            } else {
                // Direct GitHub PR creation (for users with GitHub auth)
                // This would use the GitHub API directly
                // Implementation depends on your specific needs

                return new Response(JSON.stringify({
                    success: false,
                    error: 'Direct PR creation not yet implemented'
                }), {
                    status: 501,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

        } catch (error) {
            console.error('PR submission error:', error);
            return new Response(JSON.stringify({
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    static async triggerGitHubAction(env, repository, changes, title, description, translator) {
        // Trigger GitHub Action via repository dispatch
        const [owner, repo] = repository.split('/');

        const payload = {
            event_type: 'translation-submission',
            client_payload: {
                title,
                description,
                translator: {
                    name: translator.name,
                    email: translator.email
                },
                changes: changes.map(change => ({
                    language: change.language,
                    msgid: change.msgid,
                    original: change.original,
                    previous: change.previous,
                    new: change.new,
                    filePath: change.filePath || `${change.language}/messages.po`
                })),
                timestamp: new Date().toISOString()
            }
        };

        // Use GitHub App token or PAT stored in environment
        const githubToken = env.GITHUB_APP_TOKEN || env.GITHUB_PAT;

        if (!githubToken) {
            throw new Error('GitHub token not configured for PR creation');
        }

        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/dispatches`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to trigger GitHub Action: ${response.statusText} - ${error}`);
        }

        return true;
    }
}