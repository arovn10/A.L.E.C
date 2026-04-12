#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# ALEC — First-time Setup
# Run once on a new machine to install everything and boot ALEC.
# Usage: bash setup.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
die()   { echo -e "${RED}✗ $*${NC}"; exit 1; }

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  ALEC — First-Time Setup             ║"
echo "║  Adaptive Learning Executive         ║"
echo "║  Companion                           ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── macOS check ──────────────────────────────────────────────────
if [[ "$OSTYPE" != "darwin"* ]]; then
  warn "This script is optimised for macOS. Linux should work but is untested."
fi

# ── Homebrew ─────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  ok "Homebrew already installed"
fi

# ── Node.js (>=18) ───────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(parseInt(process.versions.node)<18?1:0)" 2>&1; echo $?) == 1 ]]; then
  info "Installing Node.js 20 via Homebrew…"
  brew install node@20
  brew link node@20 --force
else
  ok "Node.js $(node -v) already installed"
fi

# ── Python 3.11+ ─────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  info "Installing Python 3 via Homebrew…"
  brew install python@3.11
else
  ok "Python $(python3 --version) already installed"
fi

# ── Ollama ───────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  info "Installing Ollama…"
  brew install ollama
else
  ok "Ollama $(ollama --version 2>/dev/null || echo '') already installed"
fi

# ── Pull ALEC's LLM model ────────────────────────────────────────
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:27b-it-qat}"
info "Pulling Ollama model: $OLLAMA_MODEL  (this may take a while on first run)"
# Start ollama in background if not running
ollama serve &>/dev/null &
OLLAMA_PID=$!
sleep 3
ollama pull "$OLLAMA_MODEL" || warn "Could not pull $OLLAMA_MODEL — run 'ollama pull $OLLAMA_MODEL' manually later"

# ── npm dependencies ─────────────────────────────────────────────
info "Installing Node.js dependencies…"
npm install
ok "npm dependencies installed"

# ── Python virtual environment ───────────────────────────────────
VENV="services/neural/.venv"
if [ ! -d "$VENV" ]; then
  info "Creating Python virtual environment…"
  python3 -m venv "$VENV"
fi
info "Installing Python dependencies…"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r services/neural/requirements.txt 2>/dev/null \
  || "$VENV/bin/pip" install --quiet fastapi uvicorn anthropic python-dotenv aiofiles || true
ok "Python environment ready"

# ── .env file ────────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "Creating .env from template…"
  cat > .env << 'ENV'
# ALEC Environment
PORT=3001
NEURAL_PORT=8000
VOICE_PORT=3002
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:27b-it-qat
JWT_SECRET=change-me-to-a-random-secret-at-least-32-chars
NODE_ENV=development
ENV
  ok ".env created — edit it to add your STOA credentials and JWT secret"
else
  ok ".env already exists"
fi

# ── data directories ─────────────────────────────────────────────
mkdir -p data/uploads data/exports services/neural/data
ok "Data directories ready"

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup complete!                     ║${NC}"
echo -e "${GREEN}║                                      ║${NC}"
echo -e "${GREEN}║  Run:  bash start.sh                 ║${NC}"
echo -e "${GREEN}║  Open: http://localhost:3001          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
