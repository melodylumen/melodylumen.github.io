// tests/basic.test.js - Very basic test to check if vitest works
import { test, expect } from 'vitest';

test('basic math', () => {
    expect(1 + 1).toBe(2);
});

test('basic string', () => {
    expect('hello').toBe('hello');
});
