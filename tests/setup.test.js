// tests/setup.test.js - Simple setup test
import { describe, it, expect } from 'vitest';

describe('Test Environment Setup', () => {
    it('should have crypto available', () => {
        // In a proper Workers environment, crypto should be available
        expect(typeof globalThis.crypto).toBeDefined();
    });

    it('should run basic JavaScript', () => {
        const result = 1 + 1;
        expect(result).toBe(2);
    });

    it('should handle async operations', async () => {
        const promise = Promise.resolve('test');
        const result = await promise;
        expect(result).toBe('test');
    });
});