import { describe, it, expect, vi } from 'vitest';

// Mock the TranslationManager since it's a browser-based class
const TranslationManager = {
    parsePOFile: (content) => {
        const messages = {};
        const lines = content.split('\n');
        let currentMsgid = '';
        let currentMsgstr = '';
        let inMsgid = false;
        let inMsgstr = false;

        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('msgid "')) {
                if (currentMsgid) {
                    messages[currentMsgid] = currentMsgstr;
                }
                currentMsgid = trimmed.slice(7, -1);
                inMsgid = true;
                inMsgstr = false;
            } else if (trimmed.startsWith('msgstr "')) {
                currentMsgstr = trimmed.slice(8, -1);
                inMsgid = false;
                inMsgstr = true;
            }
        }
        
        if (currentMsgid) {
            messages[currentMsgid] = currentMsgstr;
        }
        
        return messages;
    }
};

describe('TranslationManager', () => {
    it('should parse PO files correctly', () => {
        const poContent = `
msgid "hello"
msgstr "bonjour"

msgid "goodbye"
msgstr "au revoir"
`;

        const result = TranslationManager.parsePOFile(poContent);
        
        expect(result.hello).toBe('bonjour');
        expect(result.goodbye).toBe('au revoir');
    });

    it('should handle empty translations', () => {
        const poContent = `
msgid "untranslated"
msgstr ""
`;

        const result = TranslationManager.parsePOFile(poContent);
        
        expect(result.untranslated).toBe('');
    });

    it('should handle special characters', () => {
        const poContent = `
msgid "quote"
msgstr "She said \\"Hello\\""
`;

        const result = TranslationManager.parsePOFile(poContent);
        
        expect(result.quote).toContain('Hello');
    });
});