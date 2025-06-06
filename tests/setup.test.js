// tests/setup.test.js - Basic setup test
import { describe, test, expect } from 'vitest';

describe('Basic Setup', () => {
    test('should have working test environment', () => {
        expect(1 + 1).toBe(2);
    });

    test('should have access to basic globals', () => {
        expect(typeof globalThis).toBe('object');
    });
});
