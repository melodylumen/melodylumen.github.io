import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node', // Use node environment for simpler testing
        setupFiles: ['./tests/setup.js'],
        testTimeout: 10000,
        include: ['tests/**/*.test.js'],
        exclude: ['tests/e2e/**', 'tests/integration/**']
    }
});