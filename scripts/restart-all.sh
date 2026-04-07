#!/usr/bin/env bash
# ── A.L.E.C. Full Restart ──
# Usage: bash scripts/restart-all.sh
#   or:  bash scripts/restart-all.sh --pull   (git pull first)
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
echo "── A.L.E.C. repo: $REPO"

# ── Optional: git pull ──
if [[ "$1" == "--pull" ]]; then
  echo "── Pulling latest from origin/main..."
  git stash 2>/dev/null || true
  git fetch origin
  git rebase origin/main
  git stash pop 2>/dev/null || true
fi

# ── Clear caches ──
echo "── Clearing caches..."
rm -f data/query_cache.json
find services/neural/__pycache__ -name '*.pyc' -delete 2>/dev/null || true

# ── Kill existing processes ──
echo "── Killing existing processes..."
kill $(lsof -ti:8000) 2>/dev/null || true
kill $(lsof -ti:3001) 2>/dev/null || true
sleep 2

# ── Start Neural Engine ──
echo "── Starting neural engine..."
cd "$REPO/services/neural"
if [ -d ".venv" ]; then
  source .venv/bin/activate
elif [ -d "venv" ]; then
  source venv/bin/activate
fi
nohup python server.py > /tmp/alec-neural.log 2>&1 &
NEURAL_PID=$!
echo "   PID: $NEURAL_PID  Log: /tmp/alec-neural.log"

# ── Wait for neural health ──
echo "── Waiting for neural engine..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "   NEURAL UP!"
    break
  fi
  sleep 2
done

# ── Start Node Backend ──
echo "── Starting Node backend..."
cd "$REPO"
nohup node backendserver.js > /tmp/alec-node.log 2>&1 &
NODE_PID=$!
echo "   PID: $NODE_PID  Log: /tmp/alec-node.log"
sleep 3

# ── Verify ──
echo ""
echo "════════════════════════════════════════"
echo "  A.L.E.C. RESTART COMPLETE"
echo "════════════════════════════════════════"
echo "  Neural: http://localhost:8000  (PID $NEURAL_PID)"
echo "  Web UI: http://localhost:3001  (PID $NODE_PID)"
echo "  Logs:   /tmp/alec-neural.log"
echo "          /tmp/alec-node.log"
echo "════════════════════════════════════════"
