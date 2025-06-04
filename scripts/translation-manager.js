// scripts/translation-manager.js - Handle translation data and PO file parsing
class TranslationManager {
    constructor(apiClient) {
        this.api = apiClient;
        this.translations = new Map(); // msgid -> translation data
        this.metadata = null;
    }

    async loadTranslations(repo, language, translationPath) {
        try {
            // First try to load from backend (cached/stored translations)
            const storedTranslations = await this.api.getTranslations(repo, language);

            if (storedTranslations && storedTranslations.translations) {
                this.processStoredTranslations(storedTranslations);
                return this.getAll();
            }
        } catch (error) {
            console.log('No stored translations, loading from GitHub:', error);
        }

        // If no stored translations or error, load from GitHub (if available)
        if (this.api.githubToken) {
            const [owner, name] = repo.split('/');
            const enPath = `${translationPath}/en/messages.po`;
            const langPath = `${translationPath}/${language}/messages.po`;

            try {
                // Load both English (source) and target language files
                const [enContent, langContent] = await Promise.all([
                    this.api.fetchPOFile(owner, name, enPath),
                    this.api.fetchPOFile(owner, name, langPath).catch(() => '')
                ]);

                const enMessages = this.parsePOFile(enContent);
                const langMessages = this.parsePOFile(langContent);

                // Combine into translation objects
                this.translations.clear();
                Object.entries(enMessages).forEach(([msgid, original]) => {
                    if (msgid) { // Skip empty msgid (header)
                        this.translations.set(msgid, {
                            msgid,
                            original,
                            translation: langMessages[msgid] || '',
                            previousTranslation: langMessages[msgid] || null,
                            context: null,
                            references: [],
                            flags: [],
                            activeEditors: []
                        });
                    }
                });

                return this.getAll();
            } catch (error) {
                throw new Error(`Failed to load PO files: ${error.message}`);
            }
        } else {
            // For non-GitHub users, we need the backend to provide translations
            throw new Error('Translation data not available. Please contact administrator.');
        }
    }

    processStoredTranslations(data) {
        this.translations.clear();
        this.metadata = data.metadata || {};

        Object.entries(data.translations).forEach(([msgid, translation]) => {
            this.translations.set(msgid, {
                msgid,
                original: translation.original,
                translation: translation.current,
                previousTranslation: translation.previous || null,
                context: translation.context || null,
                references: translation.references || [],
                flags: translation.flags || [],
                activeEditors: []
            });
        });
    }

    parsePOFile(content) {
        const messages = {};
        const lines = content.split('\n');

        let currentEntry = {
            msgctxt: '',
            msgid: '',
            msgstr: '',
            references: [],
            flags: [],
            inMsgid: false,
            inMsgstr: false,
            inMsgctxt: false
        };

        const saveEntry = () => {
            if (currentEntry.msgid) {
                messages[currentEntry.msgid] = currentEntry.msgstr;
            }
            currentEntry = {
                msgctxt: '',
                msgid: '',
                msgstr: '',
                references: [],
                flags: [],
                inMsgid: false,
                inMsgstr: false,
                inMsgctxt: false
            };
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines between entries
            if (trimmed === '' && !currentEntry.inMsgid && !currentEntry.inMsgstr) {
                saveEntry();
                continue;
            }

            // Comments and metadata
            if (trimmed.startsWith('#:')) {
                currentEntry.references.push(trimmed.substring(2).trim());
                continue;
            }

            if (trimmed.startsWith('#,')) {
                currentEntry.flags = trimmed.substring(2).trim().split(',').map(f => f.trim());
                continue;
            }

            if (trimmed.startsWith('#')) {
                continue; // Skip other comments
            }

            // Message context
            if (trimmed.startsWith('msgctxt ')) {
                currentEntry.msgctxt = this.parseQuotedString(trimmed.substring(8));
                currentEntry.inMsgctxt = true;
                currentEntry.inMsgid = false;
                currentEntry.inMsgstr = false;
                continue;
            }

            // Message ID
            if (trimmed.startsWith('msgid ')) {
                currentEntry.msgid = this.parseQuotedString(trimmed.substring(6));
                currentEntry.inMsgid = true;
                currentEntry.inMsgstr = false;
                currentEntry.inMsgctxt = false;
                continue;
            }

            // Message string
            if (trimmed.startsWith('msgstr ')) {
                currentEntry.msgstr = this.parseQuotedString(trimmed.substring(7));
                currentEntry.inMsgid = false;
                currentEntry.inMsgstr = true;
                currentEntry.inMsgctxt = false;
                continue;
            }

            // Continuation lines
            if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                const continuation = this.parseQuotedString(trimmed);
                if (currentEntry.inMsgctxt) {
                    currentEntry.msgctxt += continuation;
                } else if (currentEntry.inMsgid) {
                    currentEntry.msgid += continuation;
                } else if (currentEntry.inMsgstr) {
                    currentEntry.msgstr += continuation;
                }
            }
        }

        // Save last entry
        saveEntry();

        return messages;
    }

    parseQuotedString(str) {
        str = str.trim();
        if (str.startsWith('"') && str.endsWith('"')) {
            return str.slice(1, -1)
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\r/g, '\r')
                .replace(/\\\\/g, '\\');
        }
        return str;
    }

    escapePoString(str) {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\t/g, '\\t')
            .replace(/\r/g, '\\r');
    }

    generatePOContent(language) {
        const now = new Date().toISOString();

        let content = `# Translation file for ${language}
# Generated by PO Translation Tool
# Date: ${now}
#
msgid ""
msgstr ""
"Language: ${language}\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Generator: PO Translation Tool\\n"

`;

        this.translations.forEach((data, msgid) => {
            if (!msgid) return; // Skip empty msgid

            // Add references
            data.references.forEach(ref => {
                content += `#: ${ref}\n`;
            });

            // Add flags
            if (data.flags.length > 0) {
                content += `#, ${data.flags.join(', ')}\n`;
            }

            // Add context if present
            if (data.context) {
                content += `msgctxt "${this.escapePoString(data.context)}"\n`;
            }

            // Add msgid and msgstr
            content += `msgid "${this.escapePoString(msgid)}"\n`;
            content += `msgstr "${this.escapePoString(data.translation || '')}"\n\n`;
        });

        return content;
    }

    // Data access methods
    getTranslation(msgid) {
        return this.translations.get(msgid);
    }

    updateTranslation(msgid, newTranslation) {
        const data = this.translations.get(msgid);
        if (data) {
            data.translation = newTranslation;
        }
    }

    getAll() {
        const result = {};
        this.translations.forEach((data, msgid) => {
            result[msgid] = data;
        });
        return result;
    }

    getStats() {
        let total = 0;
        let translated = 0;
        let empty = 0;
        let modified = 0;

        this.translations.forEach(data => {
            total++;
            if (data.translation) {
                translated++;
                if (data.translation !== data.previousTranslation) {
                    modified++;
                }
            } else {
                empty++;
            }
        });

        return {
            total,
            translated,
            empty,
            modified,
            percentage: total > 0 ? Math.round((translated / total) * 100) : 0
        };
    }

    // Export for PR creation
    exportChanges(changes) {
        const filesByLanguage = new Map();

        changes.forEach(change => {
            if (!filesByLanguage.has(change.language)) {
                filesByLanguage.set(change.language, new Map());
            }
            filesByLanguage.get(change.language).set(change.msgid, change.new);
        });

        const files = [];
        filesByLanguage.forEach((translations, language) => {
            // Apply changes to current state
            translations.forEach((translation, msgid) => {
                this.updateTranslation(msgid, translation);
            });

            // Generate updated PO file
            const content = this.generatePOContent(language);
            files.push({
                language,
                content,
                path: `${language}/messages.po` // Relative path
            });
        });

        return files;
    }
}

// Export for use in other scripts
window.TranslationManager = TranslationManager;