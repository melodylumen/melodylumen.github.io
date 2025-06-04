#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index > -1 ? args[index + 1] : null;
};

const translationFile = getArg('file');
const authorName = getArg('author') || 'Unknown';
const authorEmail = getArg('email') || 'unknown@example.com';

async function processTranslations() {
    let filePath;
    let translations;

    // Determine which file to process
    if (translationFile === 'auto') {
        // Find the newest file in the queue
        const queueDir = path.join(process.cwd(), 'translations-queue');
        const files = await fs.readdir(queueDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {
            console.log('No translation files found in queue');
            process.exit(0);
        }

        // Get the newest file
        const stats = await Promise.all(
            jsonFiles.map(async (file) => ({
                file,
                mtime: (await fs.stat(path.join(queueDir, file))).mtime
            }))
        );

        const newest = stats.sort((a, b) => b.mtime - a.mtime)[0];
        filePath = path.join(queueDir, newest.file);
    } else {
        filePath = path.resolve(translationFile);
    }

    // Read and parse the translation file
    console.log(`Processing translation file: ${filePath}`);
    const content = await fs.readFile(filePath, 'utf8');
    translations = JSON.parse(content);

    // Validate the structure
    if (!translations.language || !translations.translations) {
        throw new Error('Invalid translation file format');
    }

    // Process each translation
    const summary = await applyTranslations(translations);

    // Set outputs for the workflow
    console.log(`::set-output name=languages::${translations.language}`);
    console.log(`::set-output name=file_count::${summary.filesModified}`);
    console.log(`::set-output name=translation_count::${summary.translationCount}`);
    console.log(`::set-output name=summary::${summary.details}`);

    // Move processed file to archive
    const archiveDir = path.join(process.cwd(), 'translations-archive');
    await fs.mkdir(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, `processed-${Date.now()}-${path.basename(filePath)}`);
    await fs.rename(filePath, archivePath);

    console.log('Translation processing complete');
}

async function applyTranslations(data) {
    const { language, translations, metadata } = data;
    const basePath = path.join(process.cwd(), 'src/locale/locales', language);
    const messagesPath = path.join(basePath, 'messages.po');

    // Read existing PO file
    const poContent = await fs.readFile(messagesPath, 'utf8');
    const updatedPo = updatePoFile(poContent, translations);

    // Write updated file
    await fs.writeFile(messagesPath, updatedPo, 'utf8');

    // Generate summary
    const translationCount = Object.keys(translations).length;
    const details = `Updated ${translationCount} translations for ${language}`;

    return {
        filesModified: 1,
        translationCount,
        details
    };
}

function updatePoFile(content, translations) {
    let updated = content;

    for (const [msgid, translation] of Object.entries(translations)) {
        // Escape special characters
        const escapedMsgid = msgid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedTranslation = translation
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n');

        // Find and replace the translation
        const regex = new RegExp(
            `(msgid\\s+"${escapedMsgid}"\\s*\\nmsgstr\\s+")[^"]*("?)`,
            'g'
        );

        updated = updated.replace(regex, `$1${escapedTranslation}$2`);
    }

    return updated;
}

// Run the script
processTranslations().catch(error => {
    console.error('Error processing translations:', error);
    process.exit(1);
});