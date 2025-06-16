export class POFileHandler {
    constructor(githubAPI) {
        this.github = githubAPI;
        this.chunkSize = 100; // Process 100 messages at a time
        this.cacheExpiry = 3600000; // 1 hour cache
    }

    /**
     * Get list of available languages by reading directory structure
     * This is much more efficient than loading PO files
     */
    async getAvailableLanguages(owner, repo, translationPath) {
        try {
            // Get directory listing
            const contents = await this.github.getContent(owner, repo, translationPath, 'main');

            if (!contents || !Array.isArray(contents)) {
                throw new Error('Unable to read translation directory');
            }

            // Filter for directories (each language is a directory)
            const languages = contents
                .filter(item => item.type === 'dir')
                .map(item => ({
                    code: item.name,
                    path: item.path,
                    // We'll fetch the actual language name from the PO header later
                    name: this.getLanguageDisplayName(item.name)
                }));

            return languages;
        } catch (error) {
            console.error('Error fetching languages:', error);
            throw new Error(`Failed to fetch language list: ${error.message}`);
        }
    }

    /**
     * Get language metadata by reading just the PO file header
     * Headers are typically in the first 20-30 lines
     */
    async getLanguageMetadata(owner, repo, language, translationPath) {
        const filePath = `${translationPath}/${language}/messages.po`;

        try {
            // Fetch only the beginning of the file using GitHub's API with size limit
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=main`,
                {
                    headers: {
                        'Authorization': `token ${this.github.token}`,
                        'Accept': 'application/vnd.github.v3.raw',
                        'Range': 'bytes=0-2048' // Get first 2KB only
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch PO header: ${response.statusText}`);
            }

            const headerContent = await response.text();
            const metadata = this.parsePoHeader(headerContent);

            return {
                language: language,
                languageName: metadata['Language'] || this.getLanguageDisplayName(language),
                pluralForms: metadata['Plural-Forms'],
                lastTranslator: metadata['Last-Translator'],
                translationTeam: metadata['Language-Team'],
                poRevisionDate: metadata['PO-Revision-Date']
            };
        } catch (error) {
            console.error(`Error fetching metadata for ${language}:`, error);
            return {
                language: language,
                languageName: this.getLanguageDisplayName(language),
                error: error.message
            };
        }
    }

    /**
     * Parse PO file header to extract metadata
     */
    parsePoHeader(content) {
        const metadata = {};
        const headerMatch = content.match(/msgid\s+""\s*\nmsgstr\s+"((?:[^"\\]|\\.|\\\n)*)"$/m);

        if (headerMatch) {
            const headerContent = headerMatch[1];
            const lines = headerContent.split('\\n');

            lines.forEach(line => {
                const match = line.match(/^([^:]+):\s*(.+)$/);
                if (match) {
                    metadata[match[1].trim()] = match[2].trim();
                }
            });
        }

        return metadata;
    }

    /**
     * Stream PO file content in chunks for memory efficiency
     * Returns an async generator that yields translation entries
     */
    async *streamPOFileContent(owner, repo, language, translationPath, startLine = 0) {
        const filePath = `${translationPath}/${language}/messages.po`;

        // Get file metadata first
        const fileInfo = await this.github.getContent(owner, repo, filePath, 'main');

        if (!fileInfo || !fileInfo.size) {
            throw new Error('Unable to get file information');
        }

        // For very large files, we'll fetch in chunks
        const maxChunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;
        let buffer = '';
        let entryCount = 0;
        let lineNumber = 0;

        while (offset < fileInfo.size) {
            // Fetch chunk
            const chunk = await this.fetchFileChunk(
                owner,
                repo,
                filePath,
                offset,
                Math.min(offset + maxChunkSize, fileInfo.size)
            );

            buffer += chunk;
            offset += chunk.length;

            // Process complete entries in the buffer
            const entries = this.extractCompleteEntries(buffer);
            buffer = entries.remainder;

            for (const entry of entries.entries) {
                // Skip entries before startLine if specified
                if (lineNumber >= startLine) {
                    yield {
                        ...entry,
                        lineNumber,
                        entryNumber: entryCount
                    };

                    entryCount++;

                    // Yield control every N entries to prevent blocking
                    if (entryCount % this.chunkSize === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }

                lineNumber += entry.lineCount || 1;
            }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
            const finalEntries = this.parsePoEntries(buffer);
            for (const entry of finalEntries) {
                yield {
                    ...entry,
                    lineNumber,
                    entryNumber: entryCount
                };
                entryCount++;
            }
        }
    }

    /**
     * Fetch a chunk of file content using range requests
     */
    async fetchFileChunk(owner, repo, path, start, end) {
        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=main`,
            {
                headers: {
                    'Authorization': `token ${this.github.token}`,
                    'Accept': 'application/vnd.github.v3.raw',
                    'Range': `bytes=${start}-${end}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch file chunk: ${response.statusText}`);
        }

        return response.text();
    }

    /**
     * Extract complete PO entries from buffer
     * Returns entries and any incomplete remainder
     */
    extractCompleteEntries(buffer) {
        const entries = [];
        const lines = buffer.split('\n');
        let currentEntry = null;
        let lastCompleteIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Start of new entry
            if (trimmed.startsWith('msgid ') ||
                (trimmed === '' && currentEntry && currentEntry.msgid && currentEntry.msgstr !== undefined)) {

                if (currentEntry && currentEntry.msgid && currentEntry.msgstr !== undefined) {
                    entries.push(currentEntry);
                    lastCompleteIndex = i;
                }

                if (trimmed.startsWith('msgid ')) {
                    currentEntry = {
                        msgid: this.extractQuotedString(trimmed.substring(6)),
                        msgstr: undefined,
                        comments: [],
                        lineCount: 1
                    };
                } else {
                    currentEntry = null;
                }
            }
            // Message string
            else if (currentEntry && trimmed.startsWith('msgstr ')) {
                currentEntry.msgstr = this.extractQuotedString(trimmed.substring(7));
                currentEntry.lineCount++;
            }
            // Continuation lines
            else if (currentEntry && trimmed.startsWith('"') && trimmed.endsWith('"')) {
                if (currentEntry.msgstr === undefined) {
                    currentEntry.msgid += this.extractQuotedString(trimmed);
                } else {
                    currentEntry.msgstr += this.extractQuotedString(trimmed);
                }
                currentEntry.lineCount++;
            }
            // Comments
            else if (trimmed.startsWith('#')) {
                if (currentEntry) {
                    currentEntry.comments.push(line);
                    currentEntry.lineCount++;
                }
            }
        }

        // Determine remainder
        let remainder = '';
        if (lastCompleteIndex < lines.length - 1) {
            remainder = lines.slice(lastCompleteIndex + 1).join('\n');
        }

        return { entries, remainder };
    }

    /**
     * Parse complete PO entries from text
     */
    parsePoEntries(content) {
        const entries = [];
        const entryBlocks = content.split(/\n\s*\n/);

        for (const block of entryBlocks) {
            const entry = this.parsePoEntry(block);
            if (entry && entry.msgid) {
                entries.push(entry);
            }
        }

        return entries;
    }

    /**
     * Parse a single PO entry
     */
    parsePoEntry(block) {
        const lines = block.split('\n');
        const entry = {
            msgid: '',
            msgstr: '',
            comments: [],
            references: [],
            flags: [],
            context: null
        };

        let currentField = null;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('#:')) {
                entry.references.push(trimmed.substring(2).trim());
            } else if (trimmed.startsWith('#,')) {
                entry.flags = trimmed.substring(2).split(',').map(f => f.trim());
            } else if (trimmed.startsWith('#')) {
                entry.comments.push(trimmed);
            } else if (trimmed.startsWith('msgctxt ')) {
                entry.context = this.extractQuotedString(trimmed.substring(8));
                currentField = 'context';
            } else if (trimmed.startsWith('msgid ')) {
                entry.msgid = this.extractQuotedString(trimmed.substring(6));
                currentField = 'msgid';
            } else if (trimmed.startsWith('msgstr ')) {
                entry.msgstr = this.extractQuotedString(trimmed.substring(7));
                currentField = 'msgstr';
            } else if (trimmed.startsWith('"') && trimmed.endsWith('"') && currentField) {
                entry[currentField] += this.extractQuotedString(trimmed);
            }
        }

        return entry;
    }

    /**
     * Extract string content from quoted PO string
     */
    extractQuotedString(str) {
        if (!str) return '';

        // Remove surrounding quotes
        str = str.replace(/^"/, '').replace(/"$/, '');

        // Unescape PO string escapes
        return str
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\\\/g, '\\');
    }

    /**
     * Get display name for language code
     */
    getLanguageDisplayName(code) {
        const languageNames = {
            'ar': 'العربية (Arabic)',
            'bg': 'Български (Bulgarian)',
            'ca': 'Català (Catalan)',
            'cr': 'ᓀᐦᐃᔭᐍᐏᐣ (Cree)',
            'cs': 'Čeština (Czech)',
            'da': 'Dansk (Danish)',
            'de': 'Deutsch (German)',
            'el': 'Ελληνικά (Greek)',
            'en': 'English',
            'eo': 'Esperanto',
            'es': 'Español (Spanish)',
            'et': 'Eesti (Estonian)',
            'fa': 'فارسی (Persian)',
            'fi': 'Suomi (Finnish)',
            'fr': 'Français (French)',
            'ga': 'Gaeilge (Irish)',
            'gl': 'Galego (Galician)',
            'he': 'עברית (Hebrew)',
            'hi': 'हिन्दी (Hindi)',
            'hr': 'Hrvatski (Croatian)',
            'hu': 'Magyar (Hungarian)',
            'id': 'Bahasa Indonesia (Indonesian)',
            'innu': 'Innu-aimun',
            'it': 'Italiano (Italian)',
            'iu': 'ᐃᓄᒃᑎᑐᑦ (Inuktitut)',
            'ja': '日本語 (Japanese)',
            'ka': 'ქართული (Georgian)',
            'ko': '한국어 (Korean)',
            'lt': 'Lietuvių (Lithuanian)',
            'lv': 'Latviešu (Latvian)',
            'miq': "Mi'kmaq",
            'ml': 'മലയാളം (Malayalam)',
            'nl': 'Nederlands (Dutch)',
            'no': 'Norsk (Norwegian)',
            'oj': 'ᐊᓂᔑᓈᐯᒧᐎᓐ (Ojibwe)',
            'pl': 'Polski (Polish)',
            'pt': 'Português (Portuguese)',
            'pt-BR': 'Português Brasileiro (Brazilian Portuguese)',
            'ro': 'Română (Romanian)',
            'ru': 'Русский (Russian)',
            'sk': 'Slovenčina (Slovak)',
            'sl': 'Slovenščina (Slovenian)',
            'sr': 'Српски (Serbian)',
            'sv': 'Svenska (Swedish)',
            'ta': 'தமிழ் (Tamil)',
            'te': 'తెలుగు (Telugu)',
            'th': 'ไทย (Thai)',
            'tr': 'Türkçe (Turkish)',
            'uk': 'Українська (Ukrainian)',
            'ur': 'اردو (Urdu)',
            'vi': 'Tiếng Việt (Vietnamese)',
            'zh-CN': '简体中文 (Simplified Chinese)',
            'zh-TW': '繁體中文 (Traditional Chinese)'
        };

        return languageNames[code] || code.toUpperCase();
    }
}

/**
 * Paginated translation loader for UI
 */
export class TranslationPaginator {
    constructor(poHandler, owner, repo, language, translationPath) {
        this.poHandler = poHandler;
        this.owner = owner;
        this.repo = repo;
        this.language = language;
        this.translationPath = translationPath;
        this.pageSize = 50;
        this.cache = new Map();
    }

    /**
     * Get a page of translations
     */
    async getPage(pageNumber = 0) {
        const cacheKey = `${this.language}-page-${pageNumber}`;

        // Check cache
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (cached.timestamp > Date.now() - 300000) { // 5 minute cache
                return cached.data;
            }
        }

        const startIndex = pageNumber * this.pageSize;
        const translations = [];
        let currentIndex = 0;

        // Stream through the file until we get our page
        for await (const entry of this.poHandler.streamPOFileContent(
            this.owner,
            this.repo,
            this.language,
            this.translationPath
        )) {
            if (currentIndex >= startIndex && currentIndex < startIndex + this.pageSize) {
                translations.push(entry);
            }

            currentIndex++;

            if (currentIndex >= startIndex + this.pageSize) {
                break;
            }
        }

        const result = {
            page: pageNumber,
            pageSize: this.pageSize,
            translations,
            hasMore: translations.length === this.pageSize
        };

        // Cache the result
        this.cache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });

        return result;
    }

    /**
     * Search for translations containing specific text
     */
    async search(searchTerm, maxResults = 100) {
        const results = [];
        const searchLower = searchTerm.toLowerCase();

        for await (const entry of this.poHandler.streamPOFileContent(
            this.owner,
            this.repo,
            this.language,
            this.translationPath
        )) {
            if (entry.msgid.toLowerCase().includes(searchLower) ||
                entry.msgstr.toLowerCase().includes(searchLower)) {
                results.push(entry);

                if (results.length >= maxResults) {
                    break;
                }
            }
        }

        return results;
    }
}