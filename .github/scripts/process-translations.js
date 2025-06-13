#!/usr/bin/env node
// This script processes translation files for a GitHub repository.
const fs = require('fs').promises;
const path = require('path');

// Handle both repository_dispatch and manual workflow_dispatch
async function processTranslations() {
    let payload;

    // Check if this is a repository_dispatch event
    if (process.env.GITHUB_EVENT_NAME === 'repository_dispatch') {
        // Read the event payload
        const eventPath = process.env.GITHUB_EVENT_PATH;
        const event = JSON.parse(await fs.readFile(eventPath, 'utf8'));
        payload = event.client_payload;
    } else {
        // Manual trigger - read from file
        const translationFile = process.argv[2] || 'auto';

        if (translationFile === 'auto') {
            const queueDir = path.join(process.cwd(), 'translations-queue');
            const files = await fs.readdir(queueDir).catch(() => []);
            const jsonFiles = files.filter(f => f.endsWith('.json'));

            if (jsonFiles.length === 0) {
                console.log('No translation files found in queue');
                process.exit(0);
            }

            const newest = jsonFiles.sort((a, b) => {
                const statA = fs.statSync(path.join(queueDir, a));
                const statB = fs.statSync(path.join(queueDir, b));
                return statB.mtime - statA.mtime;
            })[0];

            const filePath = path.join(queueDir, newest);
            payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
        } else {
            payload = JSON.parse(await fs.readFile(translationFile, 'utf8'));
        }
    }

    // Process the translations
    const summary = await applyTranslations(payload);

    // Set outputs for the workflow
    const languages = [...new Set(payload.changes.map(c => c.language))].join(', ');
    console.log(`::set-output name=languages::${languages}`);
    console.log(`::set-output name=file_count::${summary.filesModified}`);
    console.log(`::set-output name=translation_count::${summary.translationCount}`);
    console.log(`::set-output name=translator_name::${payload.translator.name}`);
    console.log(`::set-output name=translator_email::${payload.translator.email}`);
    console.log(`::set-output name=pr_title::${payload.title || generatePRTitle(languages)}`);
    console.log(`::set-output name=pr_body::${generatePRBody(payload)}`);
    console.log(`::set-output name=target_branch::${summary.targetBranch}`);

    console.log('Translation processing complete');
}

async function applyTranslations(payload) {
    const { changes } = payload;

    // Group changes by language and file
    const changesByFile = new Map();
    const languages = new Set();

    changes.forEach(change => {
        const language = change.language;
        languages.add(language);

        const filePath = change.filePath || `src/locale/locales/${language}/messages.po`;

        if (!changesByFile.has(filePath)) {
            changesByFile.set(filePath, []);
        }

        changesByFile.get(filePath).push(change);
    });

    let filesModified = 0;
    let totalTranslations = 0;

    // Process each file
    for (const [filePath, fileChanges] of changesByFile) {
        const fullPath = path.join(process.cwd(), filePath);

        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        let poContent = '';
        try {
            poContent = await fs.readFile(fullPath, 'utf8');
        } catch (error) {
            // File doesn't exist, create a new one
            const language = path.basename(path.dirname(fullPath));
            poContent = generateNewPoFile(language);
        }

        // Apply changes
        const updatedContent = updatePoFile(poContent, fileChanges);

        // Write updated file
        await fs.writeFile(fullPath, updatedContent, 'utf8');

        filesModified++;
        totalTranslations += fileChanges.length;
    }

    // Determine target branch
    const today = new Date().toISOString().split('T')[0];
    const primaryLanguage = [...languages][0];
    const targetBranch = `language-update-${primaryLanguage}-${today}`;

    return {
        filesModified,
        translationCount: totalTranslations,
        details: `Updated ${totalTranslations} translations across ${filesModified} files`,
        targetBranch
    };
}

function updatePoFile(content, changes) {
    let updated = content;

    changes.forEach(change => {
        const { msgid, new: newTranslation } = change;

        // Escape special characters for regex
        const escapedMsgid = msgid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedTranslation = escapePoString(newTranslation);

        // Try to find and replace existing translation
        const regex = new RegExp(
            `(msgid\\s+"${escapedMsgid}"\\s*\\n(?:#[^\\n]*\\n)*msgstr\\s+")[^"]*("?)`,
            'gm'
        );

        if (regex.test(updated)) {
            updated = updated.replace(regex, `$1${escapedTranslation}$2`);
        } else {
            // Translation doesn't exist, append it
            updated += `\nmsgid "${escapePoString(msgid)}"\nmsgstr "${escapedTranslation}"\n`;
        }
    });

    return updated;
}

function escapePoString(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r');
}

function generateNewPoFile(language) {
    return `# Translation file for ${language}
# Generated by PO Translation Tool
# Date: ${new Date().toISOString()}

msgid ""
msgstr ""
"Language: ${language}\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"

`;
}

function generatePRTitle(languages) {
    return `Update ${languages} translations`;
}

function generatePRBody(payload) {
    const { title, description, changes, translator, timestamp } = payload;

    // Group changes by language
    const changesByLanguage = new Map();
    changes.forEach(change => {
        if (!changesByLanguage.has(change.language)) {
            changesByLanguage.set(change.language, []);
        }
        changesByLanguage.get(change.language).push(change);
    });

    let body = `## ${title || 'Translation Update'}\n\n`;

    if (description) {
        body += `${description}\n\n`;
    }

    body += `### Submission Details\n`;
    body += `- **Translator**: ${translator.name} (${translator.email})\n`;
    body += `- **Submitted**: ${new Date(timestamp).toLocaleString()}\n`;
    body += `- **Total Changes**: ${changes.length}\n\n`;

    body += `### Changes by Language\n\n`;

    changesByLanguage.forEach((langChanges, language) => {
        body += `#### ${language} (${langChanges.length} changes)\n\n`;
        body += `<details>\n<summary>View changes</summary>\n\n`;

        langChanges.forEach(change => {
            body += `**\`${change.msgid}\`**\n`;
            body += `- Original: ${change.original}\n`;
            body += `- Previous: ${change.previous || '_(empty)_'}\n`;
            body += `- New: **${change.new}**\n\n`;
        });

        body += `</details>\n\n`;
    });

    body += `---\n`;
    body += `_This PR was automatically created by the [PO Translation Tool](https://github.com/melodylumen/po-translation-tool) via GitHub Actions_`;

    return body;
}

// Run the script
processTranslations().catch(error => {
    console.error('Error processing translations:', error);
    process.exit(1);
});