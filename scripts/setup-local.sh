#!/bin/bash
# A.L.E.C. - Local Development Setup Script
# This script sets up the development environment on your Mac

set -e

echo "🚀 Setting up A.L.E.C. Personal AI Companion..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
cd "$(dirname "$0")/.."
npm install

echo ""
echo "🧠 Setting up directory structure..."
mkdir -p data/models logs chat history skills smarthome tokens

# Create empty .gitkeep files in directories that need them
touch data/models/.gitkeep
touch logs/.gitkeep
touch chat/.gitkeep
touch history/.gitkeep
touch skills/.gitkeep
touch smarthome/.gitkeep
touch tokens/.gitkeep

echo ""
echo "🔐 Generating configuration files..."
if [ ! -f .env ]; then
    cat > .env << 'EOF'
# A.L.E.C. Configuration
NODE_ENV=development

# JWT Secret (change in production!)
JWT_SECRET=your-secret-key-change-in-production

# Neural Model Path
NEURAL_MODEL_PATH=/app/data/models/personal_model.bin

# API Settings
PORT=3001

# STOA Access Token (separate from full capabilities)
STOA_ACCESS_TOKEN=your-stoa-token-here

# Full Capabilities Token (unlocks all features)
FULL_CAPABILITIES_TOKEN=your-full-capability-token-here

# Voice Interface Settings
VOICE_INTERFACE_ENABLED=true
VOICE_WS_URL=ws://localhost:3001/voice

# Neural Network Settings
NEURAL_NETWORK_TYPE=llama-3.1-8b
CONTEXT_SIZE=8192
N_BATCH=512
EOF
    echo "✅ Created .env file"
else
    echo "ℹ️  .env file already exists (skipping)"
fi

echo ""
echo "🎯 Starting A.L.E.C. server..."
npm start &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to initialize..."
sleep 5

# Check if server is running
if curl -s http://localhost:3001/health > /dev/null; then
    echo ""
    echo "✅ A.L.E.C. is now running!"
    echo ""
    echo "🌐 Frontend available at: http://localhost:3001"
    echo "📡 API available at: http://localhost:3001/api/chat"
    echo "🎤 Voice WebSocket at: ws://localhost:3001/voice"
    echo ""
    echo "🔑 To get started, generate a token via the Settings menu"
    echo ""
    echo "Press Ctrl+C to stop the server"

    # Keep process running
    wait $SERVER_PID
else
    echo ""
    echo "❌ Server failed to start. Check logs for errors."
    exit 1
fi
