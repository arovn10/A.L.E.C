#!/bin/bash
# ───────────────────────────────────────────────────────────────
# A.L.E.C. — Start both Python Neural Engine + Node.js Backend
# ───────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load .env if present
if [ -f .env ]; then
    export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
fi

NEURAL_PORT=${NEURAL_PORT:-8000}
NODE_PORT=${PORT:-3001}
VENV_DIR="$PROJECT_DIR/services/neural/.venv"

echo "🧠 Starting A.L.E.C. — Autonomous Language Embedded Cognition"
echo ""

# Check if venv exists
if [ ! -d "$VENV_DIR" ]; then
    echo "❌ Python venv not found. Run: bash scripts/setup-local.sh"
    exit 1
fi

# Check if model exists
MODEL_PATH=${MODEL_PATH:-data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf}
if [ ! -f "$MODEL_PATH" ]; then
    echo "⚠️  Model not found at $MODEL_PATH"
    echo "   Run: bash scripts/download-model.sh"
    echo "   Starting without model (stub mode)..."
    echo ""
fi

# ── Start Python Neural Engine ───────────────────────────────────
echo "🐍 Starting Python Neural Engine on port $NEURAL_PORT..."
source "$VENV_DIR/bin/activate"
cd services/neural
python server.py &
NEURAL_PID=$!
cd "$PROJECT_DIR"

# Wait for neural engine to be ready
echo "   Waiting for neural engine..."
for i in $(seq 1 30); do
    if curl -s "http://localhost:$NEURAL_PORT/health" > /dev/null 2>&1; then
        echo "   ✅ Neural engine ready (PID: $NEURAL_PID)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "   ⚠️  Neural engine didn't respond in 30s — continuing anyway"
    fi
    sleep 1
done

echo ""

# ── Start Node.js Backend ───────────────────────────────────────
echo "📡 Starting Node.js Backend on port $NODE_PORT..."
node backend/server.js &
NODE_PID=$!

# Wait for Node.js
sleep 3
if curl -s "http://localhost:$NODE_PORT/health" > /dev/null 2>&1; then
    echo "   ✅ Node.js backend ready (PID: $NODE_PID)"
else
    echo "   ⚠️  Node.js backend may still be starting..."
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo " 🧠 A.L.E.C. is running!"
echo ""
echo "    Frontend:   http://localhost:$NODE_PORT"
echo "    API:        http://localhost:$NODE_PORT/api/chat"
echo "    Neural:     http://localhost:$NEURAL_PORT/health"
echo "    Training:   POST http://localhost:$NODE_PORT/api/training/start"
echo ""
echo "    Neural PID: $NEURAL_PID"
echo "    Node PID:   $NODE_PID"
echo ""
echo " Press Ctrl+C to stop both servers."
echo "═══════════════════════════════════════════════════════"

# Trap Ctrl+C to kill both processes
cleanup() {
    echo ""
    echo "🛑 Shutting down A.L.E.C...."
    kill $NEURAL_PID 2>/dev/null
    kill $NODE_PID 2>/dev/null
    wait $NEURAL_PID 2>/dev/null
    wait $NODE_PID 2>/dev/null
    echo "👋 A.L.E.C. stopped. See you next time."
}
trap cleanup SIGINT SIGTERM

# Wait for either process to exit
wait -n $NEURAL_PID $NODE_PID 2>/dev/null
cleanup
