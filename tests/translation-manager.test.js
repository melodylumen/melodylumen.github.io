import { describe, it, expect } from 'vitest';
import { TranslationManager } from '../scripts/translation-manager.js';

describe('TranslationManager', () => {
    it('should parse PO files correctly', () => {
        const poContent = `
msgid "hello"
msgstr "bonjour"
    `;

        const manager = new TranslationManager();
        const result = manager.parsePOFile(poContent);

        expect(result.hello).toBe('bonjour');
    });
});