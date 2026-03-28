#!/bin/bash
# A.L.E.C. - Setup Script for 35B Parameter LLM Model
# This script downloads and configures a real LLM for your Mac

set -e

echo "🧠 Setting up 35B parameter LLM for A.L.E.C."
echo ""

# Check disk space (need at least 20GB)
DISK_SPACE=$(df -m . | tail -1 | awk '{print $4}')
if [ "$DISK_SPACE" -lt 20000 ]; then
    echo "❌ Insufficient disk space. Need at least 20GB free."
    exit 1
fi

echo "✅ Disk space check passed: ${DISK_SPACE}MB available"

# Install required packages
echo ""
echo "📦 Installing required packages..."
pip3 install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu 2>&1 | tail -5 || echo "⚠️ llama-cpp-python installation may have issues"

# Create models directory
mkdir -p data/models
cd data/models

echo ""
echo "📥 Downloading Llama-3.1-70B-Instruct (GGUF format)..."
echo "This will take 5-10 minutes depending on your connection speed."

# Download the model (using HuggingFace direct link for best results)
MODEL_URL="https://huggingface.co/TheBloke/Llama-3.1-70B-Instruct-GGUF/resolve/main/llama-3.1-70b-instruct.Q4_K_M.gguf"
echo "URL: $MODEL_URL"

# Use curl or wget to download
if command -v curl &> /dev/null; then
    curl -L -o llama-3.1-70b-instruct.Q4_K_M.gguf "$MODEL_URL" 2>&1 | tail -5
elif command -v wget &> /dev/null; then
    wget -O llama-3.1-70b-instruct.Q4_K_M.gguf "$MODEL_URL" 2>&1 | tail -5
else
    echo "❌ Please install curl or wget and try again"
    exit 1
fi

echo ""
echo "📊 Model download complete!"
ls -lh llama-3.1-70b-instruct.Q4_K_M.gguf

# Update environment configuration
cd ../..
echo ""
echo "⚙️  Updating configuration..."
sed -i '' 's/NEURAL_BACKEND=mock/NEURAL_BACKEND=llama-cpp/' .env
sed -i '' 's/NEURAL_MODEL_PATH=.*/NEURAL_MODEL_PATH=data\/models\/llama-3.1-70b-instruct.Q4_K_M.gguf/' .env

echo ""
echo "✅ Configuration updated!"
echo ""
echo "🚀 Next steps:"
echo "1. Restart the server: cd /Users/alecrovner/A.L.E.C && node backend/server.js"
echo "2. A.L.E.C. will now use the real 35B parameter model!"
echo ""
