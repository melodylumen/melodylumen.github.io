#!/bin/bash
# check-setup.sh - Verify PO Translation Tool setup

echo "🔍 Checking PO Translation Tool Setup"
echo "======================================"

# Check if Node.js is installed
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

# Check if npm is installed
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ npm: $NPM_VERSION"
else
    echo "❌ npm not found"
    exit 1
fi

# Check if wrangler is installed
if command -v wrangler &> /dev/null; then
    WRANGLER_VERSION=$(wrangler --version)
    echo "✅ Wrangler CLI: $WRANGLER_VERSION"
else
    echo "❌ Wrangler CLI not found. Install with: npm install -g wrangler"
    exit 1
fi

# Check if Python 3 is installed
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✅ Python 3: $PYTHON_VERSION"
else
    echo "❌ Python 3 not found. Please install Python 3"
    exit 1
fi

# Check if wrangler.toml exists
if [ -f "wrangler.toml" ]; then
    echo "✅ wrangler.toml exists"
    
    # Check if IDs are filled in
    if grep -q 'id = ""' wrangler.toml; then
        echo "⚠️  wrangler.toml has empty IDs. Please configure your KV and D1 IDs."
    else
        echo "✅ wrangler.toml appears configured"
    fi
else
    echo "❌ wrangler.toml not found. Copy from wrangler.toml.template"
    exit 1
fi

# Check if dependencies are installed
if [ -d "node_modules" ]; then
    echo "✅ Dependencies installed"
else
    echo "⚠️  Dependencies not installed. Run: npm install"
fi

# Check if config.local.js exists
if [ -f "config.local.js" ]; then
    echo "✅ Local configuration file exists"
else
    echo "⚠️  config.local.js not found (this is okay for production)"
fi

echo ""
echo "🎯 Setup Status:"

# Try to login to Cloudflare (just check, don't actually login)
if wrangler whoami &> /dev/null; then
    CLOUDFLARE_USER=$(wrangler whoami)
    echo "✅ Logged into Cloudflare as: $CLOUDFLARE_USER"
else
    echo "⚠️  Not logged into Cloudflare. Run: wrangler login"
fi

# Test worker deployment (without actually deploying)
echo ""
echo "🧪 Testing Configuration:"

# Test D1 database connection
if wrangler d1 execute po-translation-db --command="SELECT 1" --local &> /dev/null; then
    echo "✅ D1 database accessible"
else
    echo "❌ D1 database not accessible. Check your database configuration."
fi

echo ""
echo "📋 Next Steps:"
echo "1. Run: ./start-dev.sh (or chmod +x start-dev.sh first)"
echo "2. Open: http://localhost:8000"
echo "3. Login with token: DEV-TOKEN-123"
echo ""
echo "🔗 Useful Commands:"
echo "   wrangler dev          # Start worker locally"
echo "   wrangler deploy       # Deploy to production"
echo "   wrangler tail         # View worker logs"
echo "   npm test             # Run tests"
