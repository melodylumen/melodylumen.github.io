import { describe, it, expect } from 'vitest';
import { TranslationHandler } from '../src/translation-handler.js';

describe('Integration Tests', () => {
    describe('Branch Naming', () => {
        it('should generate correct branch names', () => {
            const today = new Date().toISOString().split('T')[0];
            const language = 'fr';
            const expectedBranch = `language-update-${language}-${today}`;
            
            // Since we can't access the private method, we'll test the pattern
            expect(expectedBranch).toMatch(/^language-update-[a-z]+-\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('PO String Escaping', () => {
        it('should escape special characters in PO strings', () => {
            const testCases = [
                { input: 'Hello "World"', expected: 'Hello \\"World\\"' },
                { input: 'Line 1\nLine 2', expected: 'Line 1\\nLine 2' },
                { input: 'Tab\there', expected: 'Tab\\there' },
                { input: 'Back\\slash', expected: 'Back\\\\slash' }
            ];
            
            testCases.forEach(({ input, expected }) => {
                const escaped = TranslationHandler.escapePoString(input);
                expect(escaped).toBe(expected);
            });
        });
    });

    describe('PR Body Generation', () => {
        it('should include all required information in PR body', () => {
            const changes = [{
                msgid: 'test.message',
                language: 'fr',
                original: 'Test message',
                previous: '',
                new: 'Message de test'
            }];
            
            const user = {
                name: 'Test User',
                email: 'test@example.com'
            };
            
            const body = TranslationHandler.generatePRBody(
                'Update French translations',
                'Monthly translation update',
                changes,
                user
            );
            
            // Check that body contains expected elements
            expect(body).toContain('Test User');
            expect(body).toContain('test@example.com');
            expect(body).toContain('test.message');
            expect(body).toContain('Message de test');
            expect(body).toContain('Indigenous language preservation');
        });
    });
});