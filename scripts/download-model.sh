#!/bin/bash
# ───────────────────────────────────────────────────────────────
# A.L.E.C. — Model Downloader
# Downloads the base model for A.L.E.C.'s neural engine.
#
# Default: Qwen3-32B Q6_K (~28 GB) — requires 64GB+ unified memory
# Fallback: Qwen3-32B Q4_K_M (~20 GB) — for 32-48GB systems
# Legacy:   Qwen2.5-Coder-7B Q4_K_M (~4.4 GB) — lightweight fallback
# ───────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$PROJECT_DIR/data/models"

# Detect available RAM to pick the right model
TOTAL_RAM_GB=0
if [[ "$(uname)" == "Darwin" ]]; then
    TOTAL_RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
elif [[ -f /proc/meminfo ]]; then
    TOTAL_RAM_GB=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1048576 ))
fi

echo "🧠 A.L.E.C. Model Downloader"
echo "   System RAM: ${TOTAL_RAM_GB} GB"
echo ""

# Select model based on available RAM
if [ "$TOTAL_RAM_GB" -ge 64 ]; then
    # M5 Max 64GB+ → Qwen3-32B Q6_K (near-lossless, native tool calling)
    MODEL_NAME="qwen3-32b-q6_k.gguf"
    MODEL_URL="https://huggingface.co/unsloth/Qwen3-32B-GGUF/resolve/main/Qwen3-32B-Q6_K.gguf"
    MODEL_DISPLAY="Qwen3-32B (Q6_K — near-lossless)"
    MODEL_SIZE="~28 GB"
    MIN_DISK=32000
elif [ "$TOTAL_RAM_GB" -ge 32 ]; then
    # 32-48GB → Qwen3-32B Q4_K_M (still excellent, smaller footprint)
    MODEL_NAME="qwen3-32b-q4_k_m.gguf"
    MODEL_URL="https://huggingface.co/unsloth/Qwen3-32B-GGUF/resolve/main/Qwen3-32B-Q4_K_M.gguf"
    MODEL_DISPLAY="Qwen3-32B (Q4_K_M)"
    MODEL_SIZE="~20 GB"
    MIN_DISK=24000
else
    # <32GB → Legacy 7B model
    MODEL_NAME="qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    MODEL_DISPLAY="Qwen2.5-Coder-7B (Q4_K_M — lightweight)"
    MODEL_SIZE="~4.4 GB"
    MIN_DISK=6000
fi

# Allow override via environment variable
if [ -n "$ALEC_MODEL_URL" ]; then
    MODEL_URL="$ALEC_MODEL_URL"
    MODEL_NAME="$(basename "$MODEL_URL")"
    MODEL_DISPLAY="Custom: $MODEL_NAME"
fi

echo "   Model: $MODEL_DISPLAY"
echo "   Size:  $MODEL_SIZE"
echo "   File:  $MODEL_NAME"
echo ""

# Check if model already exists
if [ -f "$MODEL_DIR/$MODEL_NAME" ]; then
    SIZE=$(ls -lh "$MODEL_DIR/$MODEL_NAME" | awk '{print $5}')
    echo "✅ Model already exists ($SIZE): $MODEL_DIR/$MODEL_NAME"
    echo ""
    echo "   To re-download, delete it first:"
    echo "   rm $MODEL_DIR/$MODEL_NAME"
    echo ""
    echo "   To use a different model, set ALEC_MODEL_URL:"
    echo "   ALEC_MODEL_URL=https://... bash scripts/download-model.sh"
    exit 0
fi

# Check disk space
DISK_FREE_MB=$(df -m "$PROJECT_DIR" | tail -1 | awk '{print $4}')
if [ "$DISK_FREE_MB" -lt "$MIN_DISK" ]; then
    echo "❌ Insufficient disk space. Need at least $((MIN_DISK / 1000)) GB free (have $((DISK_FREE_MB / 1000)) GB)."
    exit 1
fi
echo "✅ Disk space: $((DISK_FREE_MB / 1000)) GB available"

# Create models directory
mkdir -p "$MODEL_DIR"

echo ""
echo "📥 Downloading from HuggingFace..."
echo "   URL: $MODEL_URL"
echo "   Destination: $MODEL_DIR/$MODEL_NAME"
echo ""
echo "   This will take a while for large models. Go grab a coffee."
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

# Update .env to point to the new model
ENV_FILE="$PROJECT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    # Update MODEL_PATH in .env
    if grep -q "^MODEL_PATH=" "$ENV_FILE"; then
        sed -i.bak "s|^MODEL_PATH=.*|MODEL_PATH=data/models/$MODEL_NAME|" "$ENV_FILE"
    else
        echo "MODEL_PATH=data/models/$MODEL_NAME" >> "$ENV_FILE"
    fi
    # Update context length for Qwen3-32B (supports 128K but use 32K for speed)
    if [[ "$MODEL_NAME" == *"qwen3-32b"* ]]; then
        if grep -q "^MODEL_CONTEXT_LENGTH=" "$ENV_FILE"; then
            sed -i.bak "s|^MODEL_CONTEXT_LENGTH=.*|MODEL_CONTEXT_LENGTH=32768|" "$ENV_FILE"
        else
            echo "MODEL_CONTEXT_LENGTH=32768" >> "$ENV_FILE"
        fi
    fi
    rm -f "$ENV_FILE.bak"
    echo "✅ Updated .env with new model path"
fi

echo ""
echo "🚀 Ready! Start A.L.E.C.: bash scripts/start-alec.sh"
echo ""
echo "   The model upgrade from 7B → 32B gives A.L.E.C.:"
echo "   • Native tool calling (agent behavior)"
echo "   • 4.5x more parameters (much smarter)"
echo "   • 128K context window (vs 4K before)"
echo "   • Better structured data handling"
echo "   • Reliable instruction following"
echo "   • Near-zero hallucination on injected data"
