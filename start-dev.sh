#!/bin/bash
# start-dev.sh - Start development servers for PO Translation Tool

echo "🚀 Starting PO Translation Tool Development Environment"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Please install it first:"
    echo "   npm install -g wrangler"
    exit 1
fi

# Check if Python is available for frontend server
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3 to serve the frontend."
    exit 1
fi

# Function to kill background processes on exit
cleanup() {
    echo "🛑 Stopping development servers..."
    if [ ! -z "$WORKER_PID" ]; then
        kill $WORKER_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    exit
}

# Set trap to cleanup on Ctrl+C
trap cleanup INT

# Check if wrangler.toml exists, if not, help user set it up
if [ ! -f "wrangler.toml" ]; then
    echo "⚠️  wrangler.toml not found. Creating from template..."
    cp wrangler.toml.template wrangler.toml
    
    echo "📝 Please configure your wrangler.toml file:"
    echo "   1. Create KV namespace: wrangler kv:namespace create po_translations"
    echo "   2. Create D1 database: wrangler d1 create po-translation-db"
    echo "   3. Update wrangler.toml with the IDs from the commands above"
    echo "   4. Run this script again"
    exit 1
fi

# Start Cloudflare Worker in development mode
echo "🔧 Starting Cloudflare Worker (port 8787)..."
wrangler dev &
WORKER_PID=$!

# Wait a moment for worker to start
sleep 3

# Start frontend server
echo "🌐 Starting Frontend Server (port 8000)..."
cd . && python3 -m http.server 8000 &
FRONTEND_PID=$!

echo ""
echo "✅ Development environment started!"
echo ""
echo "🔗 Frontend:    http://localhost:8000"
echo "🔗 Worker API:  http://localhost:8787"
echo "🔗 Health Check: http://localhost:8787/api/health"
echo ""
echo "📚 Test Credentials:"
echo "   - Invite Token: DEV-TOKEN-123"
echo "   - Or use your GitHub Personal Access Token"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for either process to exit
wait $WORKER_PID $FRONTEND_PID
