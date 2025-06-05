#!/bin/bash

# Setup script for PO Translation Tool

echo "🚀 Setting up PO Translation Tool..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install Wrangler globally if not installed
if ! command -v wrangler &> /dev/null; then
    echo "📦 Installing Wrangler CLI..."
    npm install -g wrangler
fi

# Login to Cloudflare (optional for local development)
echo "🔐 Cloudflare login (optional for local development)..."
echo "Press Enter to skip if you want to test locally only"
read -p "Login to Cloudflare? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    wrangler login
fi

# Create D1 database (local)
echo "🗄️ Creating local D1 database..."
wrangler d1 create gander-social-translation-db --local || true

# Initialize database schema
echo "📋 Initializing database schema..."
wrangler d1 execute gander-social-translation-db --file=./schema.sql --local

# Seed test data
echo "🌱 Seeding test data..."
wrangler d1 execute gander-social-translation-db --file=./seed-data.sql --local

# Create .env file for local development
echo "📝 Creating .env file..."
cat > .env << EOL
# Local development environment variables
FRONTEND_URL=http://localhost:8000
JWT_SECRET=local-development-secret-change-in-production
GITHUB_APP_TOKEN=your-github-app-token-here
EOL

# Create a local dev script
echo "📝 Creating local development script..."
cat > start-dev.sh << 'EOL'
#!/bin/bash
# Start both the worker and frontend in parallel

echo "Starting Cloudflare Worker..."
wrangler dev &
WORKER_PID=$!

echo "Starting Frontend Server..."
cd . && python3 -m http.server 8000 &
FRONTEND_PID=$!

echo "Worker PID: $WORKER_PID"
echo "Frontend PID: $FRONTEND_PID"

# Function to kill both processes
cleanup() {
    echo "Stopping servers..."
    kill $WORKER_PID $FRONTEND_PID 2>/dev/null
    exit
}

# Set up trap to catch Ctrl+C
trap cleanup INT

echo "✅ Development servers started!"
echo "Frontend: http://localhost:8000"
echo "Worker API: http://localhost:8787"
echo "Press Ctrl+C to stop both servers"

# Wait for either process to exit
wait $WORKER_PID $FRONTEND_PID
EOL

chmod +x start-dev.sh

# Create test credentials file
echo "🔑 Creating test credentials..."
mkdir -p config
cat > config/test-credentials.json << EOL
{
  "testTokens": [
    "DEV-TOKEN-123",
    "TEST-TOKEN-456"
  ],
  "testGitHubPAT": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "note": "These are test credentials for local development only"
}
EOL

echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Run './start-dev.sh' to start both frontend and worker"
echo "2. Open http://localhost:8000 in your browser"
echo "3. Login with:"
echo "   - Invite token: DEV-TOKEN-123"
echo "   - Or use a GitHub Personal Access Token"
echo ""
echo "🧪 For testing:"
echo "- Run 'npm test' to run unit tests"
echo "- Check 'config/test-credentials.json' for test tokens"
echo ""
echo "📚 Documentation:"
echo "- See docs/ folder for detailed guides"
echo "- Check README.md for usage instructions"