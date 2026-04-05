#!/bin/bash
# ───────────────────────────────────────────────────────────────
# A.L.E.C. — Download Qwen2.5-Coder-7B-Instruct GGUF model
# The 75% pre-trained foundation for A.L.E.C.'s intelligence.
# ───────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$PROJECT_DIR/data/models"
MODEL_NAME="qwen2.5-coder-7b-instruct-q4_k_m.gguf"
MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"

echo "🧠 A.L.E.C. Model Downloader"
echo "   Model: Qwen2.5-Coder-7B-Instruct (Q4_K_M)"
echo "   Size:  ~4.4 GB"
echo ""

# Check if model already exists
if [ -f "$MODEL_DIR/$MODEL_NAME" ]; then
    SIZE=$(ls -lh "$MODEL_DIR/$MODEL_NAME" | awk '{print $5}')
    echo "✅ Model already exists ($SIZE): $MODEL_DIR/$MODEL_NAME"
    echo "   Delete it and re-run this script to re-download."
    exit 0
fi

# Check disk space (need at least 6 GB free)
DISK_FREE_MB=$(df -m "$PROJECT_DIR" | tail -1 | awk '{print $4}')
if [ "$DISK_FREE_MB" -lt 6000 ]; then
    echo "❌ Insufficient disk space. Need at least 6 GB free (have ${DISK_FREE_MB} MB)."
    exit 1
fi
echo "✅ Disk space: ${DISK_FREE_MB} MB available"

# Create models directory
mkdir -p "$MODEL_DIR"

echo ""
echo "📥 Downloading from HuggingFace..."
echo "   URL: $MODEL_URL"
echo "   Destination: $MODEL_DIR/$MODEL_NAME"
echo ""

# Download with progress bar
if command -v curl &> /dev/null; then
    curl -L --progress-bar -o "$MODEL_DIR/$MODEL_NAME" "$MODEL_URL"
elif command -v wget &> /dev/null; then
    wget --show-progress -O "$MODEL_DIR/$MODEL_NAME" "$MODEL_URL"
else
    echo "❌ Neither curl nor wget found. Install one and try again."
    exit 1
fi

echo ""
echo "✅ Download complete!"
ls -lh "$MODEL_DIR/$MODEL_NAME"
echo ""
echo "🚀 Start A.L.E.C.: bash scripts/start-alec.sh"
