#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# A.L.E.C. — First-Time Installation Script
# Adaptive Learning Executive Coordinator
#
# Run this ONCE on a new machine. It does everything:
#   1. Checks prerequisites (Node.js, Python, disk space)
#   2. Creates directory structure
#   3. Installs Node.js dependencies
#   4. Creates Python virtual environment
#   5. Installs Python dependencies with Metal/CUDA support
#   6. Downloads the base model (~4.4 GB)
#   7. Generates secure .env configuration
#   8. Seeds the admin account
#   9. Starts A.L.E.C. for the first time
#
# Usage:
#   git clone https://github.com/arovn10/A.L.E.C.git
#   cd A.L.E.C
#   bash install.sh
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${PURPLE}═══════════════════════════════════════════════════════${NC}"
echo -e "${PURPLE}   🧠 A.L.E.C. — Adaptive Learning Executive Coordinator${NC}"
echo -e "${PURPLE}   First-Time Installation${NC}"
echo -e "${PURPLE}═══════════════════════════════════════════════════════${NC}"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────
echo -e "${BLUE}[1/9] Checking prerequisites...${NC}"

# Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found.${NC}"
    echo "  Install from: https://nodejs.org/ (v18 or higher)"
    echo "  Or: brew install node"
    exit 1
fi
NODE_VER=$(node --version)
echo -e "  ${GREEN}✓${NC} Node.js $NODE_VER"

# Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python 3 not found.${NC}"
    echo "  Install from: https://python.org/ (v3.11 or higher)"
    echo "  Or: brew install python"
    exit 1
fi
PY_VER=$(python3 --version)
echo -e "  ${GREEN}✓${NC} $PY_VER"

# pip
if ! python3 -m pip --version &> /dev/null; then
    echo -e "${RED}✗ pip not found.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} pip available"

# Disk space (need at least 8 GB)
DISK_FREE_MB=$(df -m "$SCRIPT_DIR" | tail -1 | awk '{print $4}')
if [ "$DISK_FREE_MB" -lt 8000 ]; then
    echo -e "${RED}✗ Not enough disk space. Need 8 GB free, have ${DISK_FREE_MB} MB.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Disk space: ${DISK_FREE_MB} MB free"

# RAM
if command -v sysctl &> /dev/null; then
    RAM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1073741824}')
    echo -e "  ${GREEN}✓${NC} RAM: ${RAM_GB} GB"
fi

# Detect hardware
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo -e "  ${GREEN}✓${NC} Apple Silicon detected — Metal acceleration enabled"
    GPU_LAYERS=-1
else
    echo -e "  ${YELLOW}!${NC} Intel Mac — CPU inference only (slower but works)"
    GPU_LAYERS=0
fi
echo ""

# ── Step 2: Create directory structure ───────────────────────
echo -e "${BLUE}[2/9] Creating directory structure...${NC}"
mkdir -p data/models data/models/lora data/models/checkpoints data/sft data/context
mkdir -p data/uploads data/exports data/knowledge
mkdir -p logs chat history skills smarthome tokens
touch data/models/.gitkeep logs/.gitkeep data/sft/.gitkeep
echo -e "  ${GREEN}✓${NC} Directories created"
echo ""

# ── Step 3: Install Node.js dependencies ─────────────────────
echo -e "${BLUE}[3/9] Installing Node.js dependencies...${NC}"
npm install --no-audit --no-fund 2>&1 | tail -3
echo -e "  ${GREEN}✓${NC} Node.js dependencies installed"
echo ""

# ── Step 4: Create Python virtual environment ────────────────
echo -e "${BLUE}[4/9] Setting up Python environment...${NC}"
VENV_DIR="$SCRIPT_DIR/services/neural/.venv"
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo -e "  ${GREEN}✓${NC} Virtual environment created"
else
    echo -e "  ${GREEN}✓${NC} Virtual environment exists"
fi
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
echo ""

# ── Step 5: Install Python dependencies ──────────────────────
echo -e "${BLUE}[5/9] Installing Python dependencies (this may take a few minutes)...${NC}"
if [ "$ARCH" = "arm64" ]; then
    echo "  Installing llama-cpp-python with Metal support..."
    CMAKE_ARGS="-DLLAMA_METAL=on" pip install llama-cpp-python -q 2>&1 | tail -2
else
    pip install llama-cpp-python -q 2>&1 | tail -2
fi
pip install -r services/neural/requirements.txt -q 2>&1 | tail -3
echo -e "  ${GREEN}✓${NC} All Python dependencies installed"
echo ""

# ── Step 6: Download the base model ─────────────────────────
echo -e "${BLUE}[6/9] Downloading A.L.E.C. base model (~4.4 GB)...${NC}"
MODEL_FILE="data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
if [ -f "$MODEL_FILE" ]; then
    SIZE=$(ls -lh "$MODEL_FILE" | awk '{print $5}')
    echo -e "  ${GREEN}✓${NC} Model already downloaded ($SIZE)"
else
    MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    echo "  Downloading from HuggingFace..."
    curl -L --progress-bar -o "$MODEL_FILE" "$MODEL_URL"
    SIZE=$(ls -lh "$MODEL_FILE" | awk '{print $5}')
    echo -e "  ${GREEN}✓${NC} Model downloaded ($SIZE)"
fi
echo ""

# ── Step 7: Generate .env configuration ──────────────────────
echo -e "${BLUE}[7/9] Generating configuration...${NC}"
if [ -f .env ]; then
    echo -e "  ${YELLOW}!${NC} .env already exists — skipping (edit manually if needed)"
else
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
    
    echo -e "  Setting up admin account..."
    read -p "  Admin email (default: admin@alec.local): " ADMIN_EMAIL
    ADMIN_EMAIL=${ADMIN_EMAIL:-admin@alec.local}
    
    read -sp "  Admin password: " ADMIN_PASSWORD
    echo ""
    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD="changeme123!"
        echo -e "  ${YELLOW}!${NC} Using default password — change it in .env"
    fi

    cat > .env << ENVEOF
# A.L.E.C. — Adaptive Learning Executive Coordinator
# Generated by install.sh on $(date)

# Server
PORT=3001
NEURAL_PORT=8000
HOST=0.0.0.0
NODE_ENV=development

# Security (auto-generated)
JWT_SECRET=$JWT_SECRET

# Admin Account
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Model
MODEL_PATH=data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf
MODEL_CONTEXT_LENGTH=4096
N_GPU_LAYERS=$GPU_LAYERS
NEURAL_BACKEND=llama-cpp

# Voice
VOICE_INTERFACE_ENABLED=true

# Stoa Group Database (optional — for real estate data)
# STOA_DB_HOST=stoagroupdb.database.windows.net
# STOA_DB_PORT=1433
# STOA_DB_NAME=stoagroupDB
# STOA_DB_USER=
# STOA_DB_PASSWORD=

# Gmail (optional — for language training from emails)
# GMAIL_EMAIL=
# GMAIL_APP_PASSWORD=

# Home Assistant (optional)
# HOME_ASSISTANT_URL=http://your-ha-ip:8123
# HOME_ASSISTANT_ACCESS_TOKEN=
ENVEOF
    echo -e "  ${GREEN}✓${NC} Configuration generated"
fi
echo ""

# ── Step 8: Initialize database ──────────────────────────────
echo -e "${BLUE}[8/9] Initializing database...${NC}"
cd services/neural
python3 -c "
from database import ALECDatabase
from auth import AuthManager
import os
db = ALECDatabase()
auth = AuthManager(db=db)
email = os.getenv('ADMIN_EMAIL', 'admin@alec.local')
pw = os.getenv('ADMIN_PASSWORD', 'changeme123!')
auth.seed_admin(email, pw)
print(f'  Admin account ready: {email}')
" 2>&1 || echo -e "  ${YELLOW}!${NC} Database will initialize on first start"
cd "$SCRIPT_DIR"
echo -e "  ${GREEN}✓${NC} Database initialized"
echo ""

# ── Step 9: Start A.L.E.C. ──────────────────────────────────
echo -e "${BLUE}[9/9] Starting A.L.E.C. for the first time...${NC}"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✅ A.L.E.C. installation complete!${NC}"
echo -e ""
echo -e "   ${PURPLE}Starting now...${NC}"
echo -e ""
echo -e "   Open in your browser: ${BLUE}http://localhost:3001${NC}"
echo -e "   Login with your admin email and password."
echo -e ""
echo -e "   To start A.L.E.C. next time:  ${YELLOW}bash scripts/start-alec.sh${NC}"
echo -e "   To stop:                       ${YELLOW}Ctrl+C${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""

bash scripts/start-alec.sh
