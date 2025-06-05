import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'miniflare',
        environmentOptions: {
            modules: true,
            script: '',
            wranglerConfigPath: './wrangler.toml',
            kvNamespaces: ['gander_social_translations'],
            d1Databases: ['DB']
        }
    }
});