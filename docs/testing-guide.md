# Testing Guide for PO Translation Tool

## Issue Resolution

The `TypeError: Cannot set property crypto of #` error occurs when Vitest tries to run tests in a Cloudflare Workers environment (miniflare) but the crypto global conflicts with Node.js's crypto module.

### Solution Applied

1. **Simplified Test Environment**: Changed from `miniflare` to `node` environment for basic unit tests
2. **Removed Complex Setup**: Removed the complex Miniflare setup that was causing conflicts
3. **Created Focused Tests**: Rewrote tests to focus on unit testing without requiring the full Workers runtime

## Running Tests

### Quick Start
```bash
# Run all tests once
npm test

# Or use the test runner script
./test-runner.sh

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui
```

### Running Specific Tests
```bash
# Run a single test file
npx vitest run tests/setup.test.js

# Run tests matching a pattern
npx vitest run -t "Translation"

# Run with verbose output
npx vitest run --reporter=verbose
```

## Test Structure

### Unit Tests
- `tests/setup.test.js` - Basic environment setup verification
- `tests/translation-manager.test.js` - PO file parsing logic
- `tests/api.test.js` - API endpoint structure tests
- `tests/integration.test.js` - Component integration tests

### Worker Tests
For testing the actual Cloudflare Worker functionality:
- `tests/basic.test.js` - Basic worker endpoint tests using `unstable_dev`

## Troubleshooting

### If tests still fail with crypto errors:

1. **Clear all caches**:
   ```bash
   rm -rf node_modules/.cache
   rm -rf .wrangler
   rm -rf .mf
   ```

2. **Reinstall dependencies**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Run tests individually**:
   ```bash
   # Start with the simplest test
   npx vitest run tests/setup.test.js
   
   # Then run others one by one
   npx vitest run tests/translation-manager.test.js
   ```

4. **Use Node environment for unit tests**:
   The current configuration uses Node environment for unit tests. For Worker-specific tests, you may need to run them separately:
   ```bash
   # Run worker tests with wrangler
   wrangler dev src/index.js --test
   ```

## Writing New Tests

### Unit Tests (No Worker Environment)
```javascript
import { describe, it, expect } from 'vitest';

describe('My Feature', () => {
    it('should work correctly', () => {
        const result = myFunction('input');
        expect(result).toBe('expected');
    });
});
```

### Worker Tests (Requires Worker Environment)
```javascript
import { unstable_dev } from 'wrangler';

describe('Worker Tests', () => {
    let worker;
    
    beforeAll(async () => {
        worker = await unstable_dev('src/index.js', {
            experimental: { disableExperimentalWarning: true }
        });
    });
    
    afterAll(async () => {
        await worker.stop();
    });
    
    it('should handle requests', async () => {
        const response = await worker.fetch('/api/endpoint');
        expect(response.status).toBe(200);
    });
});
```

## CI/CD Considerations

For GitHub Actions or other CI environments:

```yaml
- name: Run Tests
  run: |
    npm ci
    npm test
  env:
    NODE_ENV: test
```

## Known Limitations

1. **Durable Objects**: Cannot be easily tested in unit tests - use integration tests or manual testing
2. **WebSocket**: Mock WebSocket connections for unit tests
3. **D1 Database**: Use in-memory SQLite or mocks for unit tests

## Best Practices

1. **Separate Concerns**: Keep business logic separate from Worker-specific code
2. **Mock External Services**: Mock GitHub API, database calls, etc.
3. **Test Data**: Use consistent test data across tests
4. **Cleanup**: Always cleanup resources in `afterAll` hooks