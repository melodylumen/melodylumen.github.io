import { AuthHandler } from './auth-handler.js';
import { POFileHandler, TranslationPaginator } from './po-file-handler.js';


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

    async listPullRequests(owner, repo, state = 'open') {
        return this.request('GET', `/repos/${owner}/${repo}/pulls?state=${state}`);
    }

    async listBranches(owner, repo) {
        return this.request('GET', `/repos/${owner}/${repo}/branches`);
    }

    async addLabels(owner, repo, issueNumber, labels) {
        return this.request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
            labels
        });
    }
}

// Response helper
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

export class TranslationHandler {
    static async getRepositories(request) {
        try {
            const cacheKey = 'repositories-config';
            const configKey = 'configured-repositories';

            let repositories = await request.env.KV_BINDING.get(cacheKey, 'json');

            if (!repositories || !repositories.data || repositories.expires < Date.now()) {
                const defaultRepositories = [
                    {
                        owner: 'melodylumen',
                        name: 'social-app',
                        description: 'Gander Social Application - Indigenous Language Support',
                        translationPath: 'src/locale/locales',
                        requiresAuth: true
                    }
                ];

                let configuredRepos = await request.env.KV_BINDING.get(configKey, 'json');
                repositories = configuredRepos || defaultRepositories;

                // If we're using default repositories, store them in the configured-repositories key
                if (!configuredRepos) {
                    await request.env.KV_BINDING.put(
                        configKey,
                        JSON.stringify(defaultRepositories),
                        { expirationTtl: 86400 } // 24 hours
                    );
                }

                // Cache the result
                await request.env.KV_BINDING.put(
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

    /**
     * Get languages with efficient directory listing
     */
    static async getLanguages(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/repositories\/([^\/]+)\/([^\/]+)\/languages/);

            if (!match) {
                return ApiResponse.error('Invalid repository path', 400, 'INVALID_PATH');
            }

            const [, owner, repo] = match;

            // Get repository configuration
            const repositories = await request.env.gander_social_translations.get('configured-repositories', 'json') || [];
            const repoConfig = repositories.find(r => r.owner === owner && r.name === repo);

            if (!repoConfig) {
                return ApiResponse.error('Repository not found', 404, 'REPO_NOT_FOUND');
            }

            // If user has GitHub token, fetch actual languages from repository
            if (request.session.githubToken) {
                try {
                    const github = new GitHubAPI(request.session.githubToken);
                    const poHandler = new POFileHandler(github);

                    // Get language directories efficiently
                    const languages = await poHandler.getAvailableLanguages(
                        owner,
                        repo,
                        repoConfig.translationPath
                    );

                    // For each language, get basic metadata (cached)
                    const languageMetadata = await Promise.all(
                        languages.map(async (lang) => {
                            // Check cache first
                            const cacheKey = `lang-meta:${owner}/${repo}:${lang.code}`;
                            let metadata = await request.env.gander_social_translations.get(cacheKey, 'json');

                            if (!metadata || metadata.expires < Date.now()) {
                                // Fetch fresh metadata
                                metadata = await poHandler.getLanguageMetadata(
                                    owner,
                                    repo,
                                    lang.code,
                                    repoConfig.translationPath
                                );

                                // Cache for 1 hour
                                await request.env.gander_social_translations.put(
                                    cacheKey,
                                    JSON.stringify({
                                        ...metadata,
                                        expires: Date.now() + 3600000
                                    }),
                                    { expirationTtl: 3600 }
                                );
                            }

                            return {
                                code: lang.code,
                                name: metadata.languageName || lang.name,
                                path: lang.path,
                                metadata
                            };
                        })
                    );

                    return ApiResponse.success({
                        languages: languageMetadata,
                        canCreateNew: true,
                        translationPath: repoConfig.translationPath
                    });
                } catch (error) {
                    console.error('Error fetching languages from GitHub:', error);
                    // Fall back to stored data
                }
            }

            // Fallback to database stored languages
            const storedLanguages = await request.db.db.prepare(`
                SELECT DISTINCT 
                    ts.language_code,
                    COUNT(DISTINCT tp.msgid) as translation_count,
                    MAX(tp.completed_at) as last_activity
                FROM translation_sessions ts
                LEFT JOIN translation_progress tp ON ts.id = tp.session_id
                WHERE ts.repository = ?
                GROUP BY ts.language_code
                ORDER BY ts.language_code
            `).bind(`${owner}/${repo}`).all();

            const languages = storedLanguages.results?.map(r => ({
                code: r.language_code,
                name: this.getStoredLanguageName(r.language_code),
                translationCount: r.translation_count,
                lastActivity: r.last_activity
            })) || ['cr', 'iu', 'oj', 'miq', 'innu'].map(code => ({
                code,
                name: this.getStoredLanguageName(code),
                translationCount: 0
            }));

            return ApiResponse.success({
                languages,
                canCreateNew: !!request.session.githubToken,
                translationPath: repoConfig.translationPath
            });

        } catch (error) {
            console.error('Error getting languages:', error);
            return ApiResponse.error('Failed to retrieve languages', 500, 'LANG_FETCH_ERROR');
        }
    }

    /**
     * Get translations with pagination support
     */
    static async getTranslations(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/translations\/([^\/]+)\/([^\/]+)/);

            if (!match) {
                return ApiResponse.error('Invalid translation path', 400, 'INVALID_PATH');
            }

            const [, encodedRepo, language] = match;
            const repo = decodeURIComponent(encodedRepo);

            // Get pagination parameters
            const page = parseInt(url.searchParams.get('page') || '0');
            const pageSize = parseInt(url.searchParams.get('pageSize') || '50');
            const search = url.searchParams.get('search');

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

            // If user has GitHub access, load from GitHub with pagination
            if (request.session.githubToken) {
                const [owner, repoName] = repo.split('/');
                const repositories = await request.env.gander_social_translations.get('configured-repositories', 'json') || [];
                const repoConfig = repositories.find(r => r.owner === owner && r.name === repoName);

                if (repoConfig) {
                    const github = new GitHubAPI(request.session.githubToken);
                    const poHandler = new POFileHandler(github);
                    const paginator = new TranslationPaginator(
                        poHandler,
                        owner,
                        repoName,
                        language,
                        repoConfig.translationPath
                    );

                    let result;
                    if (search) {
                        // Search mode
                        const searchResults = await paginator.search(search, pageSize);
                        result = {
                            page: 0,
                            pageSize,
                            translations: searchResults,
                            hasMore: false,
                            totalResults: searchResults.length
                        };
                    } else {
                        // Pagination mode
                        result = await paginator.getPage(page);
                    }

                    // Get saved translations from database for this page
                    const savedTranslations = await request.db.getTranslationProgress(sessionId);
                    const savedMap = new Map(
                        savedTranslations.map(t => [t.msgid, t])
                    );

                    // Merge with saved translations
                    const translations = {};
                    result.translations.forEach(entry => {
                        const saved = savedMap.get(entry.msgid);
                        translations[entry.msgid] = {
                            original: entry.msgid,
                            current: saved?.translated_text || entry.msgstr,
                            previous: saved?.previous_translation || entry.msgstr,
                            context: entry.context,
                            references: entry.references,
                            flags: entry.flags,
                            lineNumber: entry.lineNumber
                        };
                    });

                    return ApiResponse.success({
                        sessionId,
                        language,
                        translations,
                        pagination: {
                            page: result.page,
                            pageSize: result.pageSize,
                            hasMore: result.hasMore,
                            totalResults: result.totalResults
                        },
                        metadata: {
                            repository: repo,
                            source: 'github'
                        }
                    });
                }
            }

            // Fallback to database translations with pagination
            const offset = page * pageSize;
            const progress = await request.db.db.prepare(`
                SELECT * FROM translation_progress
                WHERE session_id = ?
                ORDER BY msgid
                LIMIT ? OFFSET ?
            `).bind(sessionId, pageSize, offset).all();

            // Get total count for pagination
            const countResult = await request.db.db.prepare(`
                SELECT COUNT(*) as total FROM translation_progress
                WHERE session_id = ?
            `).bind(sessionId).first();

            const translations = {};
            progress.results?.forEach(item => {
                translations[item.msgid] = {
                    original: item.original_text,
                    current: item.translated_text,
                    previous: item.previous_translation
                };
            });

            return ApiResponse.success({
                sessionId,
                language,
                translations,
                pagination: {
                    page,
                    pageSize,
                    hasMore: offset + pageSize < countResult.total,
                    total: countResult.total
                },
                metadata: {
                    repository: repo,
                    source: 'database'
                }
            });

        } catch (error) {
            console.error('Error getting translations:', error);
            return ApiResponse.error(
                error.message || 'Failed to retrieve translations',
                error.message === 'Unauthorized' ? 401 : 500,
                'TRANSLATION_FETCH_ERROR'
            );
        }
    }

    /**
     * Get stored language name
     */
    static getStoredLanguageName(code) {
        const names = {
            'cr': 'Cree (ᓀᐦᐃᔭᐍᐏᐣ)',
            'iu': 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)',
            'oj': 'Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ)',
            'miq': "Mi'kmaq",
            'innu': 'Innu-aimun',
            // ... add more as needed
        };
        return names[code] || code.toUpperCase();
    }

    static async createLanguage(request) {
        try {
            await AuthHandler.requireAuth(request);

            if (!request.session.githubToken) {
                return ApiResponse.error('GitHub authentication required to create new languages', 403, 'GITHUB_AUTH_REQUIRED');
            }

            const data = await request.json();
            const { repository, languageCode, languageName, sourceLanguage = 'en' } = data;

            if (!repository || !languageCode || !languageName) {
                return ApiResponse.error('Repository, language code and name are required', 400, 'VALIDATION_ERROR');
            }

            const [owner, repo] = repository.split('/');
            const github = new GitHubAPI(request.session.githubToken);

            // Get repository configuration
            const repositories = await request.env.KV_BINDING.get('configured-repositories', 'json') || [];
            const repoConfig = repositories.find(r => r.owner === owner && r.name === repo);

            if (!repoConfig) {
                return ApiResponse.error('Repository not found', 404, 'REPO_NOT_FOUND');
            }

            // Check if target branch exists for this language
            const targetBranch = await this.getOrCreateLanguageBranch(github, owner, repo, languageCode);

            // Get source language file
            const sourcePath = `${repoConfig.translationPath}/${sourceLanguage}/messages.po`;
            const sourceFile = await github.getContent(owner, repo, sourcePath, 'main');

            if (!sourceFile) {
                return ApiResponse.error('Source language file not found', 404, 'SOURCE_NOT_FOUND');
            }

            // Decode source content
            const sourceContent = Buffer.from(sourceFile.content, 'base64').toString('utf8');

            // Create new language directory and file
            const newPath = `${repoConfig.translationPath}/${languageCode}/messages.po`;

            // Prepare new PO file with empty translations
            const newContent = this.prepareNewLanguageFile(sourceContent, languageCode, languageName);

            // Create the file in the target branch
            await github.createOrUpdateFile(
                owner,
                repo,
                newPath,
                `Create ${languageName} (${languageCode}) translation file`,
                newContent,
                null, // No SHA for new file
                targetBranch
            );

            // Store language metadata
            await request.env.KV_BINDING.put(
                `language:${repository}:${languageCode}`,
                JSON.stringify({
                    code: languageCode,
                    name: languageName,
                    createdBy: request.userId,
                    createdAt: new Date().toISOString()
                })
            );

            return ApiResponse.success({
                languageCode,
                languageName,
                branch: targetBranch,
                path: newPath
            });

        } catch (error) {
            console.error('Error creating language:', error);
            return ApiResponse.error('Failed to create language', 500, 'CREATE_LANG_ERROR', { message: error.message });
        }
    }

    static async getOrCreateLanguageBranch(github, owner, repo, languageCode) {
        const today = new Date().toISOString().split('T')[0];
        const branchName = `language-update-${languageCode}-${today}`;

        try {
            // Check if branch already exists
            await github.getRef(owner, repo, `heads/${branchName}`);
            return branchName;
        } catch (error) {
            // Branch doesn't exist, check for open PRs with similar branches
            const prs = await github.listPullRequests(owner, repo, 'open');

            // Look for existing language update branches
            const existingBranch = prs.find(pr =>
                pr.head.ref.startsWith(`language-update-${languageCode}-`)
            );

            if (existingBranch) {
                return existingBranch.head.ref;
            }

            // Create new branch
            const mainRef = await github.getRef(owner, repo, 'heads/main');
            await github.createRef(owner, repo, branchName, mainRef.object.sha);

            return branchName;
        }
    }

    static prepareNewLanguageFile(sourceContent, languageCode, languageName) {
        const lines = sourceContent.split('\n');
        const newLines = [];
        let inMsgstr = false;
        let headerProcessed = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Update header
            if (!headerProcessed && trimmed === 'msgid ""') {
                newLines.push(line);
                // Skip to msgstr and update it
                while (i < lines.length - 1 && !lines[i + 1].trim().startsWith('msgstr')) {
                    i++;
                    newLines.push(lines[i]);
                }
                i++; // Skip msgstr line
                newLines.push('msgstr ""');

                // Update header content
                while (i < lines.length - 1 && lines[i + 1].trim().startsWith('"')) {
                    i++;
                    const headerLine = lines[i];
                    if (headerLine.includes('Language:')) {
                        newLines.push(`"Language: ${languageCode}\\n"`);
                    } else if (headerLine.includes('Language-Team:')) {
                        newLines.push(`"Language-Team: ${languageName}\\n"`);
                    } else {
                        newLines.push(headerLine);
                    }
                }
                headerProcessed = true;
                continue;
            }

            // Clear all msgstr values (except header)
            if (trimmed.startsWith('msgstr ') && headerProcessed) {
                newLines.push('msgstr ""');
                inMsgstr = true;
                continue;
            }

            // Skip msgstr continuation lines
            if (inMsgstr && trimmed.startsWith('"') && trimmed.endsWith('"')) {
                continue;
            }

            // Reset inMsgstr flag
            if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('msgid') || trimmed.startsWith('msgctxt')) {
                inMsgstr = false;
            }

            newLines.push(line);
        }

        // Add header comment
        const header = `# Translation file for ${languageName} (${languageCode})
# Generated by PO Translation Tool
# Date: ${new Date().toISOString()}

`;

        return header + newLines.join('\n');
    }

    static async submitPR(request) {
        try {
            await AuthHandler.requireAuth(request);

            const data = await request.json();
            const { repository, title, description, changes, useGithubAction } = data;

            if (!title || !changes || changes.length === 0) {
                return ApiResponse.error('Title and changes are required', 400, 'VALIDATION_ERROR');
            }

            const user = await request.db.getUserById(request.userId);

            // Group changes by language to determine target branches
            const changesByLanguage = new Map();
            changes.forEach(change => {
                const lang = change.language_code || change.language;
                if (!changesByLanguage.has(lang)) {
                    changesByLanguage.set(lang, []);
                }
                changesByLanguage.get(lang).push(change);
            });

            // Try direct GitHub PR creation if user has GitHub auth
            if (request.session.githubToken && !useGithubAction) {
                try {
                    const results = [];
                    const [owner, repo] = repository.split('/');
                    const github = new GitHubAPI(request.session.githubToken);

                    // Create PRs for each language
                    for (const [language, langChanges] of changesByLanguage) {
                        const targetBranch = await this.getOrCreateLanguageBranch(github, owner, repo, language);

                        const result = await this.createLanguagePR(
                            github,
                            owner,
                            repo,
                            language,
                            targetBranch,
                            langChanges,
                            user
                        );

                        results.push(result);
                    }

                    // Mark changes as submitted
                    const changeIds = changes.map(c => `${c.sessionId}:${c.msgid}`);
                    await request.db.markChangesAsSubmitted(changeIds, results[0]?.prNumber || 'multiple');

                    return ApiResponse.success({
                        prs: results,
                        method: 'direct'
                    });
                } catch (directError) {
                    console.error('Direct PR creation failed, falling back to GitHub Action:', directError);
                }
            }

            // Fall back to GitHub Action
            await this.triggerGitHubAction(request.env, repository, changes, title, description, user);

            const changeIds = changes.map(c => `${c.sessionId}:${c.msgid}`);
            await request.db.markChangesAsSubmitted(changeIds, 'pending');

            return ApiResponse.success({
                message: 'Pull request creation initiated via GitHub Action',
                method: 'github-action'
            });

        } catch (error) {
            console.error('PR submission error:', error);
            return ApiResponse.error('Failed to submit pull request', 500, 'PR_SUBMISSION_ERROR', { message: error.message });
        }
    }

    static async createLanguagePR(github, owner, repo, language, targetBranch, changes, user) {
        // Group changes by file
        const fileChanges = new Map();
        changes.forEach(change => {
            const filePath = change.filePath || `src/locale/locales/${language}/messages.po`;
            if (!fileChanges.has(filePath)) {
                fileChanges.set(filePath, []);
            }
            fileChanges.get(filePath).push(change);
        });

        // Update each file
        for (const [filePath, fileChanges] of fileChanges) {
            const fileData = await github.getContent(owner, repo, filePath, targetBranch);

            let currentContent = '';
            let currentSha = null;

            if (fileData) {
                currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
                currentSha = fileData.sha;
            } else {
                // File doesn't exist, create new
                currentContent = this.generateNewPoFile(language);
            }

            // Apply changes
            let updatedContent = currentContent;
            fileChanges.forEach(change => {
                const escapedMsgid = change.msgid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedTranslation = this.escapePoString(change.new || change.translated_text);

                const regex = new RegExp(
                    `(msgid\\s+"${escapedMsgid}"\\s*\\n(?:#[^\\n]*\\n)*msgstr\\s+")[^"]*("?)`,
                    'gm'
                );

                if (regex.test(updatedContent)) {
                    updatedContent = updatedContent.replace(regex, `$1${escapedTranslation}$2`);
                } else {
                    // Add new translation
                    updatedContent += `\nmsgid "${this.escapePoString(change.msgid)}"\nmsgstr "${escapedTranslation}"\n`;
                }
            });

            // Commit changes
            await github.createOrUpdateFile(
                owner,
                repo,
                filePath,
                `Update ${language} translations - ${fileChanges.length} changes`,
                updatedContent,
                currentSha,
                targetBranch
            );
        }

        // Check if PR already exists for this branch
        const existingPRs = await github.listPullRequests(owner, repo, 'open');
        const existingPR = existingPRs.find(pr => pr.head.ref === targetBranch);

        if (existingPR) {
            // Update existing PR
            return {
                prUrl: existingPR.html_url,
                prNumber: existingPR.number,
                updated: true
            };
        }

        // Create new PR
        const pr = await github.createPullRequest(
            owner,
            repo,
            `Update ${language} translations`,
            this.generatePRBody(`${language} translations update`, null, changes, user),
            targetBranch,
            'main'
        );

        // Add labels
        await github.addLabels(owner, repo, pr.number, ['translations', language, 'automated']);

        return {
            prUrl: pr.html_url,
            prNumber: pr.number
        };
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
                    filePath: change.file_path || change.filePath || `src/locale/locales/${change.language}/messages.po`
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
        body += `_This PR was created by the [PO Translation Tool](https://github.com/melodylumen/po-translation-tool)_\n`;
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

    // Existing methods remain the same...
    static async getTranslations(request) {
        try {
            await AuthHandler.requireAuth(request);

            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/translations\/([^\/]+)\/([^\/]+)/);

            if (!match) {
                return ApiResponse.error('Invalid translation path', 400, 'INVALID_PATH');
            }

            const [, encodedRepo, language] = match;
            // Decode the repository parameter
            const repo = decodeURIComponent(encodedRepo);

            console.log(`Getting translations for ${repo} in ${language}`);

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

            // If no translations found in database, provide some sample translations
            if (Object.keys(translations).length === 0) {
                console.log('No translations in database, providing sample translations');

                // Sample translations for testing - these would normally come from parsing PO files
                const sampleTranslations = {
                    'welcome.message': {
                        original: 'Welcome to Gander Social!',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'navigation.home': {
                        original: 'Home',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'navigation.profile': {
                        original: 'Profile',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'navigation.settings': {
                        original: 'Settings',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'button.save': {
                        original: 'Save',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'button.cancel': {
                        original: 'Cancel',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'error.network': {
                        original: 'Network error occurred. Please try again.',
                        current: '',
                        previous: null,
                        activeEditors: []
                    },
                    'success.saved': {
                        original: 'Your changes have been saved successfully.',
                        current: '',
                        previous: null,
                        activeEditors: []
                    }
                };

                // Add sample translations to database for future use
                for (const [msgid, data] of Object.entries(sampleTranslations)) {
                    await request.db.saveTranslation(
                        sessionId,
                        msgid,
                        `src/locale/locales/${language}/messages.po`,
                        data.original,
                        data.current,
                        data.previous
                    );
                }

                Object.assign(translations, sampleTranslations);
            }

            return ApiResponse.success({
                sessionId,
                language,
                translations,
                metadata: {
                    totalCount: Object.keys(translations).length,
                    repository: repo
                }
            });

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

            const url = new URL(request.url);
            const match = url.pathname.match(/\/api\/translations\/([^\/]+)\/([^\/]+)/);

            if (!match) {
                return ApiResponse.error('Invalid translation path', 400, 'INVALID_PATH');
            }

            const [, encodedRepo, language] = match;
            // Decode the repository parameter
            const repo = decodeURIComponent(encodedRepo);

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
                filePath || `src/locale/locales/${language}/messages.po`,
                originalText,
                translation,
                previousTranslation
            );

            // Record in edit history
            await request.db.recordEdit(
                msgid,
                filePath || `src/locale/locales/${language}/messages.po`,
                request.userId,
                session.id,
                'edit',
                previousTranslation,
                translation
            );

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
}