#!/bin/bash

# test-runner.sh - Helper script to run tests with better error handling

echo "🧪 Running PO Translation Tool Tests..."
echo ""

# Clean up any previous test artifacts
echo "📦 Cleaning up test environment..."
rm -rf .wrangler 2>/dev/null
rm -rf .mf 2>/dev/null

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if miniflare is installed
if ! npm list miniflare >/dev/null 2>&1; then
    echo "📦 Installing miniflare..."
    npm install --save-dev miniflare
fi

# Run tests
echo ""
echo "🏃 Running tests..."
npm run test

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All tests passed!"
else
    echo ""
    echo "❌ Some tests failed. Troubleshooting tips:"
    echo ""
    echo "1. Make sure all dependencies are installed:"
    echo "   npm install"
    echo ""
    echo "2. Try clearing the cache:"
    echo "   rm -rf node_modules/.cache"
    echo ""
    echo "3. Run tests in debug mode:"
    echo "   NODE_ENV=test npm run test -- --reporter=verbose"
    echo ""
    echo "4. Run a single test file:"
    echo "   npm run test tests/setup.test.js"
    exit 1
fi