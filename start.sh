#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# ALEC — Start all services
# Usage: bash start.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}▸ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }

# Load .env
[ -f .env ] && { set -a; source .env; set +a; }

PORT="${PORT:-3001}"
NEURAL_PORT="${NEURAL_PORT:-8000}"
VOICE_PORT="${VOICE_PORT:-3002}"
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:27b-it-qat}"
LOG_DIR="/tmp/alec"
PID_FILE="$LOG_DIR/alec.pids"
mkdir -p "$LOG_DIR"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  ALEC — Starting Services            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Ollama ───────────────────────────────────────────────────────
if ! curl -sf http://127.0.0.1:11434/ &>/dev/null; then
  info "Starting Ollama…"
  ollama serve > "$LOG_DIR/ollama.log" 2>&1 &
  echo $! >> "$PID_FILE"
  sleep 2
  ok "Ollama started  (log: $LOG_DIR/ollama.log)"
else
  ok "Ollama already running"
fi

# Ensure model is available
if ! ollama list 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
  info "Pulling $OLLAMA_MODEL (first time may take a while)…"
  ollama pull "$OLLAMA_MODEL"
fi

# ── Python Neural Engine ─────────────────────────────────────────
VENV="services/neural/.venv"
if [ -d "$VENV" ]; then
  info "Starting Python neural engine on port $NEURAL_PORT…"
  (cd services/neural && ../.venv/bin/uvicorn server:app --port "$NEURAL_PORT" --reload \
    > "$LOG_DIR/neural.log" 2>&1) &
  # Try the project-level venv path first, fall back to local
  if ! jobs %2 &>/dev/null; then
    (cd services/neural && .venv/bin/uvicorn server:app --port "$NEURAL_PORT" --reload \
      > "$LOG_DIR/neural.log" 2>&1) &
  fi
  echo $! >> "$PID_FILE"
  ok "Neural engine started  (log: $LOG_DIR/neural.log)"
else
  echo "  ⚠  Python venv not found — skipping neural engine. Run bash setup.sh first."
fi

# ── Node.js backend ──────────────────────────────────────────────
info "Starting Node.js backend on port $PORT…"
node backend/server.js > "$LOG_DIR/node.log" 2>&1 &
echo $! >> "$PID_FILE"
ok "Node.js backend started  (log: $LOG_DIR/node.log)"

# ── Open browser ─────────────────────────────────────────────────
sleep 2
URL="http://localhost:$PORT"
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "$URL" &>/dev/null || true
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  ALEC is running at $URL${NC}"
echo -e "${GREEN}  Logs in $LOG_DIR/${NC}"
echo -e "${GREEN}  Stop with: bash stop.sh${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
