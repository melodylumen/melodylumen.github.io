// tests/api.test.js
import { unstable_dev } from 'wrangler';

describe('API Integration', () => {
    let worker;

    beforeAll(async () => {
        worker = await unstable_dev('src/index.js', {
            experimental: { disableExperimentalWarning: true },
        });
    });

    afterAll(async () => {
        await worker.stop();
    });

    it('should authenticate with GitHub', async () => {
        const response = await worker.fetch('/api/auth/github', {
            method: 'POST',
            body: JSON.stringify({ token: 'test-token' }),
        });

        expect(response.status).toBe(200);
    });
});