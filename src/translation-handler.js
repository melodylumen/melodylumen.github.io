import { AuthHandler } from './auth-handler.js';

class GitHubAPI {
    constructor(token) {
        this.token = token;
        this.baseURL = 'https://api.github.com';
    }

    async request(method, path, body = null) {
        const response = await fetch(`${this.baseURL}${path}`, {
            method,
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'PO-Translation-Tool'
            },
            body: body ? JSON.stringify(body) : null
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`GitHub API error: ${response.statusText} - ${error}`);
        }

        return response.json();
    }

    // Repository methods
    async getRepo(owner, repo) {
        return this.request('GET', `/repos/${owner}/${repo}`);
    }

    async getRef(owner, repo, ref) {
        return this.request('GET', `/repos/${owner}/${repo}/git/refs/${ref}`);
    }

    async createRef(owner, repo, ref, sha) {
        return this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
            ref: `refs/heads/${ref}`,
            sha
        });
    }

    async getContent(owner, repo, path, ref) {
        try {
            return await this.request('GET', `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`);
        } catch (error) {
            // File doesn't exist
            return null;
        }
    }

    async createOrUpdateFile(owner, repo, path, message, content, sha, branch) {
        return this.request('PUT', `/repos/${owner}/${repo}/contents/${path}`, {
            message,
            content: Buffer.from(content).toString('base64'),
            sha,
            branch
        });
    }

    async createPullRequest(owner, repo, title, body, head, base) {
        return this.request('POST', `/repos/${owner}/${repo}/pulls`, {
            title,
            body,
            head,
            base
        });
    }

    async addLabels(owner, repo, issueNumber, labels) {
        return this.request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
            labels
        });
    }
}

// Response helper for consistent API responses
class ApiResponse {
    static success(data, status = 200) {
        return new Response(JSON.stringify({
            success: true,
            data,
            timestamp: new Date().toISOString()
        }), {
            status,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    static error(message, status = 500, code = 'INTERNAL_ERROR', details = {}) {
        return new Response(JSON.stringify({
            success: false,
            error: {
                message,
                code,
                details,
                timestamp: new Date().toISOString()
            }
        }), {
            status,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Input validation helper
class Validator {
    static validateTranslation(data) {
        const errors = [];

        if (!data.msgid || typeof data.msgid !== 'string') {
            errors.push('msgid is required and must be a string');
        }

        if (typeof data.translation !== 'string') {
            errors.push('translation must be a string');
        }

        if (data.translation && data.translation.length > 5000) {
            errors.push('translation exceeds maximum length of 5000 characters');
        }

        // Check for preserved patterns (placeholders)
        const preservePatterns = [
            /\{\{.*?\}\}/g,
            /\{[0-9]+\}/g,
            /%[sdif]/g,
            /\$\{.*?\}/g
        ];

        if (data.originalText && data.translation) {
            preservePatterns.forEach(pattern => {
                const originalMatches = data.originalText.match(pattern) || [];
                const translationMatches = data.translation.match(pattern) || [];

                if (originalMatches.length !== translationMatches.length) {
                    errors.push(`Translation must preserve placeholders: ${pattern}`);
                }
            });
        }

        return errors;
    }

    static validateRepository(owner, repo) {
        const pattern = /^[a-zA-Z0-9-_.]+$/;
        return pattern.test(owner) && pattern.test(repo);
    }
}

export class TranslationHandler {
    // Rate limiting helper
    static async checkRateLimit(request) {
        const userId = request.userId;
        const today = new Date().toISOString().slice(0, 10);
        const rateLimitKey = `ratelimit:${userId}:${today}`;

        const limit = 1000; // 1000 requests per day
        const count = await request.env.gander_social_translations.get(rateLimitKey, 'json') || { count: 0 };

        if (count.count >= limit) {
            return {
                allowed: false,
                limit,
                remaining: 0,
                reset: new Date().setUTCHours(24, 0, 0, 0)
            };
        }

        // Increment counter
        await request.env.gander_social_translations.put(
            rateLimitKey,
            JSON.stringify({ count: count.count + 1 }),
            { expirationTtl: 86400 } // 24 hours
        );

        return {
            allowed: true,
            limit,
            remaining: limit - count.count - 1,
            reset: new Date().setUTCHours(24, 0, 0, 0)
        };
    }

    // Get repositories with caching
    static async getRepositories(request) {
        try {
            // Check cache first
            const cacheKey = 'repositories-config';
            let repositories = await request.env.gander_social_translations.get(cacheKey, 'json');

            if (!repositories || !repositories.data || repositories.expires < Date.now()) {
                // Default repositories
                const defaultRepositories = [
                    {
                        owner: 'gander-foundation',
                        name: 'social-app',
                        description: 'Gander Social Application - Indigenous Language Support',
                        translationPath: 'src/locale/locales',
                        languages: ['cr', 'iu', 'oj', 'miq', 'innu'],
                        requiresAuth: true
                    }
                ];

                // Try to load from configuration
                const configuredRepos = await request.env.gander_social_translations.get('configured-repositories', 'json');
                repositories = configuredRepos || defaultRepositories;

                // Cache for 1 hour
                await request.env.gander_social_translations.put(
                    cacheKey,
                    JSON.stringify({
                        data: repositories,
                        expires: Date.now() + 3600000
                    }),
                    { expirationTtl: 3600 }
                );
            } else {
                repositories = repositories.data;
            }

            return ApiResponse.success({ repositories });

        } catch (error) {
            console.error('Error getting repositories:', error);
            return ApiResponse.error('Failed to retrieve repositories', 500, 'REPO_FETCH_ERROR');
        }
    }

    static async getLanguages(request) {
        try {
            // Parse URL safely
            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/repositories\/([^\/]+)\/([^\/]+)\/languages/);

            if (!match) {
                return ApiResponse.error('Invalid repository path', 400, 'INVALID_PATH');
            }

            const [, owner, repo] = match;

            // Validate repository name
            if (!Validator.validateRepository(owner, repo)) {
                return ApiResponse.error('Invalid repository name', 400, 'INVALID_REPO_NAME');
            }

            // Check cache
            const cacheKey = `languages:${owner}/${repo}`;
            let languages = await request.env.gander_social_translations.get(cacheKey, 'json');

            if (!languages || languages.expires < Date.now()) {
                // Get repository configuration
                const repositories = await request.env.gander_social_translations.get('configured-repositories', 'json');
                const repoConfig = repositories?.find(r => r.owner === owner && r.name === repo);

                languages = repoConfig?.languages || ['cr', 'iu', 'oj', 'miq', 'innu'];

                // Cache for 1 hour
                await request.env.gander_social_translations.put(
                    cacheKey,
                    JSON.stringify({
                        data: languages,
                        expires: Date.now() + 3600000
                    }),
                    { expirationTtl: 3600 }
                );
            } else {
                languages = languages.data;
            }

            return ApiResponse.success({ languages });

        } catch (error) {
            console.error('Error getting languages:', error);
            return ApiResponse.error('Failed to retrieve languages', 500, 'LANG_FETCH_ERROR');
        }
    }

    static async getTranslations(request) {
        try {
            await AuthHandler.requireAuth(request);

            // Check rate limit
            const rateLimit = await this.checkRateLimit(request);
            if (!rateLimit.allowed) {
                return ApiResponse.error('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED', {
                    limit: rateLimit.limit,
                    reset: rateLimit.reset
                });
            }

            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/translations\/([^\/]+)\/([^\/]+)/);

            if (!match) {
                return ApiResponse.error('Invalid translation path', 400, 'INVALID_PATH');
            }

            const [, repo, language] = match;

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

            // Get active editors for real-time collaboration
            const activeEditors = await request.db.getActiveEditors();

            // Transform to expected format
            const translations = {};
            progress.forEach(item => {
                const msgidEditors = activeEditors
                    .filter(e => e.msgid === item.msgid)
                    .map(e => ({ userId: e.user_id, name: e.name }));

                translations[item.msgid] = {
                    original: item.original_text,
                    current: item.translated_text,
                    previous: item.previous_translation,
                    activeEditors: msgidEditors
                };
            });

            // Add rate limit headers
            const response = ApiResponse.success({
                sessionId,
                language,
                translations,
                metadata: {
                    totalCount: Object.keys(translations).length,
                    repository: repo
                }
            });

            response.headers.set('X-RateLimit-Limit', rateLimit.limit);
            response.headers.set('X-RateLimit-Remaining', rateLimit.remaining);
            response.headers.set('X-RateLimit-Reset', rateLimit.reset);

            return response;

        } catch (error) {
            console.error('Error getting translations:', error);
            return ApiResponse.error(
                error.message || 'Failed to retrieve translations',
                error.message === 'Unauthorized' ? 401 : 500,
                'TRANSLATION_FETCH_ERROR'
            );
        }
    }

    static async saveTranslation(request) {
        try {
            await AuthHandler.requireAuth(request);

            // Check rate limit
            const rateLimit = await this.checkRateLimit(request);
            if (!rateLimit.allowed) {
                return ApiResponse.error('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED', {
                    limit: rateLimit.limit,
                    reset: rateLimit.reset
                });
            }

            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/translations\/([^\/]+)\/([^\/]+)/);

            if (!match) {
                return ApiResponse.error('Invalid translation path', 400, 'INVALID_PATH');
            }

            const [, repo, language] = match;

            const data = await request.json();

            // Validate input
            const validationErrors = Validator.validateTranslation(data);
            if (validationErrors.length > 0) {
                return ApiResponse.error('Validation failed', 400, 'VALIDATION_ERROR', {
                    errors: validationErrors
                });
            }

            const { msgid, translation, originalText, previousTranslation, filePath } = data;

            // Get or create session
            let session = await request.db.getActiveSession(request.userId, repo, language);
            if (!session) {
                const sessionId = await request.db.createSession(request.userId, repo, language);
                session = { id: sessionId };
            }

            // Use transaction for related operations
            const statements = [
                // Save translation
                request.db.db.prepare(`
                    INSERT OR REPLACE INTO translation_progress 
                    (id, session_id, msgid, file_path, original_text, translated_text, 
                     previous_translation, status, completed_at, word_count, character_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 
                            CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END, ?, ?)
                `).bind(
                    `${session.id}:${msgid}`,
                    session.id,
                    msgid,
                    filePath || `${language}/messages.po`,
                    originalText,
                    translation,
                    previousTranslation,
                    translation && translation.trim() ? 'completed' : 'pending',
                    translation && translation.trim() ? 'completed' : 'pending',
                    translation.split(/\s+/).filter(w => w.length > 0).length,
                    translation.length
                ),

                // Record in edit history
                request.db.db.prepare(`
                    INSERT INTO edit_history
                    (id, msgid, file_path, user_id, session_id, action, previous_value, new_value, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `).bind(
                    crypto.randomUUID(),
                    msgid,
                    filePath || `${language}/messages.po`,
                    request.userId,
                    session.id,
                    'edit',
                    previousTranslation,
                    translation
                ),

                // Update session activity
                request.db.db.prepare(
                    'UPDATE translation_sessions SET last_active = datetime("now") WHERE id = ?'
                ).bind(session.id)
            ];

            // Execute as transaction
            await request.db.db.batch(statements);

            // Update metrics asynchronously
            request.env.ctx.waitUntil(
                request.db.updateMetrics(
                    request.userId,
                    language,
                    1,
                    translation.split(/\s+/).filter(w => w.length > 0).length,
                    translation.length,
                    1
                )
            );

            // Broadcast update via WebSocket if available
            if (request.env.TRANSLATION_ROOMS) {
                const roomId = `${repo}:${language}`;
                const id = request.env.TRANSLATION_ROOMS.idFromName(roomId);
                const room = request.env.TRANSLATION_ROOMS.get(id);

                request.env.ctx.waitUntil(
                    room.broadcast({
                        type: 'translationUpdate',
                        msgid,
                        translation,
                        userId: request.userId,
                        userName: (await request.db.getUserById(request.userId))?.name,
                        timestamp: new Date().toISOString()
                    })
                );
            }

            return ApiResponse.success({
                sessionId: session.id,
                saved: true
            });

        } catch (error) {
            console.error('Error saving translation:', error);
            return ApiResponse.error(
                'Failed to save translation',
                500,
                'SAVE_ERROR',
                { message: error.message }
            );
        }
    }

    static async getPendingChanges(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const repo = url.searchParams.get('repo');

            const changes = await request.db.getPendingChanges(request.userId, repo);

            // Group changes by repository and language for better organization
            const groupedChanges = {};
            changes.forEach(change => {
                const key = `${change.repository}:${change.language_code}`;
                if (!groupedChanges[key]) {
                    groupedChanges[key] = {
                        repository: change.repository,
                        language: change.language_code,
                        changes: []
                    };
                }
                groupedChanges[key].changes.push(change);
            });

            return ApiResponse.success({
                changes,
                grouped: Object.values(groupedChanges),
                count: changes.length
            });

        } catch (error) {
            console.error('Error getting pending changes:', error);
            return ApiResponse.error(
                'Failed to retrieve pending changes',
                500,
                'CHANGES_FETCH_ERROR'
            );
        }
    }

    static async submitPR(request) {
        try {
            await AuthHandler.requireAuth(request);

            const data = await request.json();
            const { repository, title, description, changes, useGithubAction } = data;

            if (!title || !changes || changes.length === 0) {
                return ApiResponse.error(
                    'Title and changes are required',
                    400,
                    'VALIDATION_ERROR'
                );
            }

            // Get user details
            const user = await request.db.getUserById(request.userId);

            // Try direct GitHub PR creation first if user has GitHub auth
            if (request.session.githubToken && !useGithubAction) {
                try {
                    const result = await this.createDirectPR(
                        request.session.githubToken,
                        repository,
                        title,
                        description,
                        changes,
                        user
                    );

                    // Mark changes as submitted
                    const changeIds = changes.map(c => `${c.sessionId}:${c.msgid}`);
                    await request.db.markChangesAsSubmitted(changeIds, result.prNumber);

                    return ApiResponse.success({
                        prUrl: result.prUrl,
                        prNumber: result.prNumber,
                        method: 'direct'
                    });
                } catch (directError) {
                    console.error('Direct PR creation failed, falling back to GitHub Action:', directError);
                }
            }

            // Fall back to GitHub Action
            await this.triggerGitHubAction(
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

            return ApiResponse.success({
                message: 'Pull request creation initiated via GitHub Action',
                method: 'github-action'
            });

        } catch (error) {
            console.error('PR submission error:', error);
            return ApiResponse.error(
                'Failed to submit pull request',
                500,
                'PR_SUBMISSION_ERROR',
                { message: error.message }
            );
        }
    }

    static async triggerGitHubAction(env, repository, changes, title, description, translator) {
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
                    language: change.language_code || change.language,
                    msgid: change.msgid,
                    original: change.original_text || change.original,
                    previous: change.previous_translation || change.previous,
                    new: change.translated_text || change.new,
                    filePath: change.file_path || change.filePath || `${change.language}/messages.po`
                })),
                timestamp: new Date().toISOString()
            }
        };

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
                    'Content-Type': 'application/json',
                    'User-Agent': 'PO-Translation-Tool'
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

    static generatePRBody(title, description, changes, user) {
        const changesByLanguage = new Map();
        changes.forEach(change => {
            const lang = change.language_code || change.language;
            if (!changesByLanguage.has(lang)) {
                changesByLanguage.set(lang, []);
            }
            changesByLanguage.get(lang).push(change);
        });

        let body = `## ${title}\n\n`;

        if (description) {
            body += `${description}\n\n`;
        }

        body += `### Translation Summary\n\n`;
        body += `- **Translator**: ${user.name} (${user.email})\n`;
        body += `- **Total Changes**: ${changes.length}\n`;
        body += `- **Languages**: ${Array.from(changesByLanguage.keys()).join(', ')}\n\n`;

        body += `### Changes by Language\n\n`;

        changesByLanguage.forEach((langChanges, language) => {
            body += `<details>\n<summary>${language} (${langChanges.length} changes)</summary>\n\n`;

            langChanges.forEach(change => {
                body += `#### \`${change.msgid}\`\n`;
                body += `- **Original**: ${change.original_text || change.original}\n`;
                body += `- **Previous**: ${change.previous_translation || change.previous || '_(empty)_'}\n`;
                body += `- **New**: **${change.translated_text || change.new}**\n\n`;
            });

            body += `</details>\n\n`;
        });

        body += `---\n`;
        body += `_This PR was created by the [PO Translation Tool](https://github.com/gander-foundation/po-translation-tool)_\n`;
        body += `_Supporting Indigenous language preservation through technology 🪶_`;

        return body;
    }

    static escapePoString(str) {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\t/g, '\\t')
            .replace(/\r/g, '\\r');
    }

    static generateNewPoFile(language) {
        return `# Translation file for ${language}
                # Generated by PO Translation Tool
                # Date: ${new Date().toISOString()}
                #
                msgid ""
                msgstr ""
                "Language: ${language}\\n"
                "MIME-Version: 1.0\\n"
                "Content-Type: text/plain; charset=UTF-8\\n"
                "Content-Transfer-Encoding: 8bit\\n"
                "X-Generator: PO Translation Tool\\n"
                
                `;
    }

    static async createDirectPR(token, repository, title, description, changes, user) {
        const [owner, repo] = repository.split('/');
        const github = new GitHubAPI(token);

        try {
            // Get default branch
            const repoData = await github.getRepo(owner, repo);
            const baseBranch = repoData.default_branch;

            // Create branch name
            const timestamp = Date.now();
            const branch = `translations-${user.name.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`;

            // Get base commit
            const baseRef = await github.getRef(owner, repo, `heads/${baseBranch}`);

            // Create new branch
            await github.createRef(owner, repo, branch, baseRef.object.sha);

            // Group changes by file
            const fileChanges = new Map();
            changes.forEach(change => {
                const filePath = change.filePath || `src/locale/locales/${change.language}/messages.po`;
                if (!fileChanges.has(filePath)) {
                    fileChanges.set(filePath, []);
                }
                fileChanges.get(filePath).push(change);
            });

            // Update each file
            for (const [filePath, fileChanges] of fileChanges) {
                // Get current file content
                let currentContent = '';
                let currentSha = null;

                const fileData = await github.getContent(owner, repo, filePath, baseBranch);

                if (fileData) {
                    currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
                    currentSha = fileData.sha;
                } else {
                    // File doesn't exist, create new
                    currentContent = TranslationHandler.generateNewPoFile(
                        filePath.split('/').pop().replace('.po', '')
                    );
                }

                // Apply changes
                let updatedContent = currentContent;
                fileChanges.forEach(change => {
                    const escapedMsgid = change.msgid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const escapedTranslation = TranslationHandler.escapePoString(change.new);

                    const regex = new RegExp(
                        `(msgid\\s+"${escapedMsgid}"\\s*\\n(?:#[^\\n]*\\n)*msgstr\\s+")[^"]*("?)`,
                        'gm'
                    );

                    if (regex.test(updatedContent)) {
                        updatedContent = updatedContent.replace(regex, `$1${escapedTranslation}$2`);
                    } else {
                        // Add new translation
                        updatedContent += `\nmsgid "${TranslationHandler.escapePoString(change.msgid)}"\nmsgstr "${escapedTranslation}"\n`;
                    }
                });

                // Commit changes
                await github.createOrUpdateFile(
                    owner,
                    repo,
                    filePath,
                    `Update ${filePath.split('/').pop()} translations`,
                    updatedContent,
                    currentSha,
                    branch
                );
            }

            // Create pull request
            const pr = await github.createPullRequest(
                owner,
                repo,
                title,
                TranslationHandler.generatePRBody(title, description, changes, user),
                branch,
                baseBranch
            );

            // Add labels
            await github.addLabels(owner, repo, pr.number, ['translations', 'automated']);

            return {
                prUrl: pr.html_url,
                prNumber: pr.number
            };
        } catch (error) {
            console.error('Direct PR creation failed:', error);
            throw error;
        }
    }
}