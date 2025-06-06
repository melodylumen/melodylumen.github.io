import { describe, it, expect, beforeAll } from 'vitest';
import { unstable_dev } from 'wrangler';

describe('Basic Worker Tests', () => {
    let worker;

    beforeAll(async () => {
        worker = await unstable_dev('src/index.js', {
            experimental: { disableExperimentalWarning: true },
            local: true,
            vars: {
                JWT_SECRET: 'test-secret',
                FRONTEND_URL: 'http://localhost:8000'
            }
        });
    });

    afterAll(async () => {
        if (worker) {
            await worker.stop();
        }
    });

    it('should return OK for health check', async () => {
        const response = await worker.fetch('/api/health');
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe('OK');
    });

    it('should return 404 for unknown routes', async () => {
        const response = await worker.fetch('/unknown');
        expect(response.status).toBe(404);
    });

    it('should handle CORS preflight', async () => {
        const response = await worker.fetch('/api/auth/validate', {
            method: 'OPTIONS'
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });
});