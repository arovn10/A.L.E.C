#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# ALEC — Stop all services
# Usage: bash stop.sh
# ─────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
ok() { echo -e "${GREEN}✓ $*${NC}"; }

PID_FILE="/tmp/alec/alec.pids"
PORT="${PORT:-3001}"
NEURAL_PORT="${NEURAL_PORT:-8000}"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  ALEC — Stopping Services            ║"
echo "╚══════════════════════════════════════╝"

# Kill by port
for PORT_NUM in "$PORT" "$NEURAL_PORT" 3002; do
  PIDS=$(lsof -ti :"$PORT_NUM" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
    ok "Stopped service on port $PORT_NUM"
  fi
done

# Kill from PID file
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    kill -TERM "$pid" 2>/dev/null || true
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# Stop ollama (optional — leave running for other tools)
# killall ollama 2>/dev/null || true

echo ""
ok "ALEC stopped. Run 'bash start.sh' to restart."
