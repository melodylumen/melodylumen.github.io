// scripts/prManager.js - Handle PR creation
class PRManager {
    constructor() {
        this.repoConfig = new RepositoryConfig();
        this.changeTracker = new ChangeTracker();
    }

    async createPullRequest(title, description) {
        const auth = AuthManager.getInstance();

        if (auth.authMethod === 'github') {
            return this.createGitHubPR(title, description);
        } else {
            return this.createPRViaProxy(title, description);
        }
    }

    async createGitHubPR(title, description) {
        const { owner, repo } = this.repoConfig.targetRepo;
        const auth = AuthManager.getInstance();
        const changes = this.changeTracker.getAllChanges();

        if (changes.length === 0) {
            throw new Error('No changes to submit');
        }

        try {
            // Step 1: Get the default branch
            const repoResponse = await fetch(
                `https://api.github.com/repos/${owner}/${repo}`,
                {
                    headers: {
                        'Authorization': `token ${auth.credentials.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );
            const repoData = await repoResponse.json();
            const defaultBranch = repoData.default_branch;

            // Step 2: Get the latest commit SHA
            const refResponse = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
                {
                    headers: {
                        'Authorization': `token ${auth.credentials.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );
            const refData = await refResponse.json();
            const baseSha = refData.object.sha;

            // Step 3: Create a new branch
            const branchName = `translations-${Date.now()}`;
            const createBranchResponse = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/git/refs`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${auth.credentials.token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ref: `refs/heads/${branchName}`,
                        sha: baseSha
                    })
                }
            );

            if (!createBranchResponse.ok) {
                throw new Error('Failed to create branch');
            }

            // Step 4: Update files for each language
            const fileUpdates = await this.prepareFileUpdates(changes);

            for (const update of fileUpdates) {
                await this.updateFile(
                    owner,
                    repo,
                    update.path,
                    update.content,
                    update.sha,
                    branchName,
                    `Update ${update.language} translations`
                );
            }

            // Step 5: Create the pull request
            const prResponse = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/pulls`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${auth.credentials.token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        title: title,
                        body: this.generatePRBody(description, changes),
                        head: branchName,
                        base: defaultBranch
                    })
                }
            );

            if (!prResponse.ok) {
                throw new Error('Failed to create pull request');
            }

            const prData = await prResponse.json();
            this.changeTracker.clearChanges();

            return {
                success: true,
                prUrl: prData.html_url,
                prNumber: prData.number
            };

        } catch (error) {
            console.error('Error creating PR:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async createPRViaProxy(title, description) {
        // For non-GitHub users, send changes to a backend service
        // This could be a GitHub Action, serverless function, or other service
        const changes = this.changeTracker.getAllChanges();

        const payload = {
            title,
            description,
            changes,
            submittedBy: this.changeTracker.getCurrentUser(),
            timestamp: new Date().toISOString()
        };

        // Option 1: Save to a JSON file that a GitHub Action can process
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `translation-pr-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        // Option 2: Send to a webhook or API endpoint
        // const response = await fetch('YOUR_WEBHOOK_URL', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify(payload)
        // });

        return {
            success: true,
            message: 'Translation changes exported. Please send the file to the repository maintainer.'
        };
    }

    async prepareFileUpdates(changes) {
        const fileUpdates = [];
        const changesByLanguage = {};

        // Group changes by language
        changes.forEach(change => {
            if (!changesByLanguage[change.language]) {
                changesByLanguage[change.language] = [];
            }
            changesByLanguage[change.language].push(change);
        });

        // Prepare updates for each language file
        for (const [language, langChanges] of Object.entries(changesByLanguage)) {
            const filePath = `${this.repoConfig.translationPath}/${language}/messages.po`;

            // Get current file content and SHA
            const fileData = await this.getFileData(filePath);
            if (fileData) {
                const updatedContent = this.changeTracker.generatePoFileContent(
                    language,
                    fileData.content,
                    langChanges
                );

                fileUpdates.push({
                    language,
                    path: filePath,
                    content: updatedContent,
                    sha: fileData.sha
                });
            }
        }

        return fileUpdates;
    }

    async getFileData(path) {
        const { owner, repo } = this.repoConfig.targetRepo;
        const auth = AuthManager.getInstance();

        try {
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
                {
                    headers: {
                        'Authorization': `token ${auth.credentials.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                return {
                    content: atob(data.content),
                    sha: data.sha
                };
            }
        } catch (error) {
            console.error(`Error fetching file ${path}:`, error);
        }
        return null;
    }

    async updateFile(owner, repo, path, content, sha, branch, message) {
        const auth = AuthManager.getInstance();

        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${auth.credentials.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message,
                    content: btoa(content),
                    sha,
                    branch
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to update file ${path}`);
        }

        return response.json();
    }

    generatePRBody(description, changes) {
        let body = description + '\n\n';
        body += '## Translation Changes\n\n';

        const changesByLanguage = {};
        changes.forEach(change => {
            if (!changesByLanguage[change.language]) {
                changesByLanguage[change.language] = 0;
            }
            changesByLanguage[change.language]++;
        });

        body += '### Summary\n';
        Object.entries(changesByLanguage).forEach(([lang, count]) => {
            body += `- **${lang}**: ${count} translation${count > 1 ? 's' : ''} updated\n`;
        });

        body += '\n### Detailed Changes\n';
        body += '<details>\n<summary>Click to expand</summary>\n\n';

        changes.forEach(change => {
            body += `#### ${change.language} - \`${change.msgid}\`\n`;
            body += `- **Original**: ${change.originalText}\n`;
            body += `- **Previous**: ${change.previousTranslation || '(empty)'}\n`;
            body += `- **New**: ${change.newTranslation}\n`;
            body += `- **Changed by**: ${change.author}\n\n`;
        });

        body += '</details>\n\n';
        body += '---\n';
        body += '_This PR was created by the PO Translation Tool_';

        return body;
    }
}