#!/bin/bash
# ───────────────────────────────────────────────────────────────
# A.L.E.C. — Process Manager
# Starts Python Neural Engine + Node.js Backend with auto-reload.
#
# Python: uvicorn --reload watches services/neural/*.py
# Node:   nodemon watches backend/ and frontend/
#
# No manual restarts needed after code changes.
# ───────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load .env
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

NEURAL_PORT=${NEURAL_PORT:-8000}
NODE_PORT=${PORT:-3001}
VENV_DIR="$PROJECT_DIR/services/neural/.venv"
LOG_DIR="/tmp/alec"
mkdir -p "$LOG_DIR"

# PID file for clean shutdown
PID_FILE="$LOG_DIR/alec.pids"

echo "🧠 A.L.E.C. — Adaptive Learning Executive Coordinator"
echo "   Mode: Auto-reload process manager"
echo ""

# ── Preflight checks ────────────────────────────────────────────

if [ ! -d "$VENV_DIR" ]; then
    echo "❌ Python venv not found. Run: bash scripts/setup-local.sh"
    exit 1
fi

MODEL_PATH=${MODEL_PATH:-data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf}
if [ ! -f "$MODEL_PATH" ]; then
    echo "⚠️  Model not found at $MODEL_PATH"
    echo "   Run: bash scripts/download-model.sh"
    echo "   Starting in stub mode..."
    echo ""
fi

# ── Kill stale processes ─────────────────────────────────────────

cleanup_stale() {
    # Kill anything on our ports from a previous run
    for port in $NEURAL_PORT $NODE_PORT; do
        local pids=$(lsof -ti:$port 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "   Cleaning up stale process on port $port (PIDs: $pids)"
            echo "$pids" | xargs kill -9 2>/dev/null || true
            sleep 1
        fi
    done
}
cleanup_stale

# ── Start Tailscale Funnel ──────────────────────────────────────

if command -v tailscale &> /dev/null; then
    tailscale funnel $NODE_PORT &>/dev/null &
    echo "🌐 Tailscale Funnel active on port $NODE_PORT"
fi

# ── Start Python Neural Engine (uvicorn --reload) ───────────────

echo ""
echo "🐍 Starting Python Neural Engine (auto-reload)..."
source "$VENV_DIR/bin/activate"

# uvicorn --reload watches for file changes and auto-restarts
# --reload-dir restricts to just the neural engine code (not models, data, .env)
cd services/neural
uvicorn server:app \
    --host 0.0.0.0 \
    --port "$NEURAL_PORT" \
    --reload \
    --reload-dir "." \
    --reload-include "*.py" \
    --log-level info \
    > "$LOG_DIR/neural.log" 2>&1 &
NEURAL_PID=$!
cd "$PROJECT_DIR"

echo "   PID: $NEURAL_PID (uvicorn --reload)"
echo "   Log: $LOG_DIR/neural.log"

# Wait for neural engine to be ready
for i in $(seq 1 60); do
    if curl -s "http://localhost:$NEURAL_PORT/health" > /dev/null 2>&1; then
        echo "   ✅ Neural engine ready"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "   ⚠️  Neural engine didn't respond in 60s — continuing"
    fi
    sleep 1
done

# ── Start Node.js Backend (nodemon) ─────────────────────────────

echo ""
echo "📡 Starting Node.js Backend (auto-reload)..."

# Use nodemon if available, otherwise plain node
if npx --no-install nodemon --version &>/dev/null 2>&1; then
    npx nodemon \
        --watch backend/ \
        --watch frontend/ \
        --ext js,html,css \
        --ignore 'node_modules/' \
        --ignore 'data/' \
        --delay 1 \
        backend/server.js \
        > "$LOG_DIR/node.log" 2>&1 &
    NODE_PID=$!
    echo "   PID: $NODE_PID (nodemon — auto-reload on backend/ frontend/ changes)"
else
    node backend/server.js > "$LOG_DIR/node.log" 2>&1 &
    NODE_PID=$!
    echo "   PID: $NODE_PID (node — install nodemon for auto-reload: npm install)"
fi

echo "   Log: $LOG_DIR/node.log"

# Wait for Node.js
for i in $(seq 1 15); do
    if curl -s "http://localhost:$NODE_PORT" > /dev/null 2>&1; then
        echo "   ✅ Node.js backend ready"
        break
    fi
    if [ $i -eq 15 ]; then
        echo "   ⚠️  Node.js may still be starting..."
    fi
    sleep 1
done

# Save PIDs for watchdog / external tools
echo "$NEURAL_PID $NODE_PID" > "$PID_FILE"

echo ""
echo "═══════════════════════════════════════════════════════"
echo " 🧠 A.L.E.C. is running (auto-reload enabled)"
echo ""
echo "    Frontend:   http://localhost:$NODE_PORT"
echo "    API:        http://localhost:$NODE_PORT/api/chat"
echo "    Neural:     http://localhost:$NEURAL_PORT/health"
echo "    Training:   POST http://localhost:$NODE_PORT/api/training/start"
echo ""
echo "    Neural PID: $NEURAL_PID (uvicorn --reload)"
echo "    Node PID:   $NODE_PID (nodemon --watch)"
echo "    Logs:       $LOG_DIR/"
echo ""
echo " ✨ Edit any .py in services/neural/ → Python auto-restarts"
echo " ✨ Edit any .js/.html/.css in backend/ or frontend/ → Node auto-restarts"
echo " ✨ No manual restarts needed."
echo ""
echo " Press Ctrl+C to stop."
echo "═══════════════════════════════════════════════════════"

# ── Signal handling ──────────────────────────────────────────────

# SIGUSR1 = graceful reload (used by watchdog after git pull)
reload_handler() {
    echo ""
    echo "🔄 Reload signal received — restarting processes..."
    
    # Kill current processes (uvicorn/nodemon will be restarted)
    kill $NEURAL_PID 2>/dev/null || true
    kill $NODE_PID 2>/dev/null || true
    wait $NEURAL_PID 2>/dev/null || true
    wait $NODE_PID 2>/dev/null || true
    sleep 2
    
    # Re-source env in case it changed
    if [ -f "$PROJECT_DIR/.env" ]; then
        set -a
        source "$PROJECT_DIR/.env"
        set +a
    fi

    # Restart Python
    source "$VENV_DIR/bin/activate"
    cd "$PROJECT_DIR/services/neural"
    uvicorn server:app \
        --host 0.0.0.0 \
        --port "$NEURAL_PORT" \
        --reload \
        --reload-dir "." \
        --reload-include "*.py" \
        --log-level info \
        > "$LOG_DIR/neural.log" 2>&1 &
    NEURAL_PID=$!
    cd "$PROJECT_DIR"

    # Restart Node
    if npx --no-install nodemon --version &>/dev/null 2>&1; then
        npx nodemon \
            --watch backend/ \
            --watch frontend/ \
            --ext js,html,css \
            --ignore 'node_modules/' \
            --ignore 'data/' \
            --delay 1 \
            backend/server.js \
            > "$LOG_DIR/node.log" 2>&1 &
        NODE_PID=$!
    else
        node backend/server.js > "$LOG_DIR/node.log" 2>&1 &
        NODE_PID=$!
    fi

    echo "$NEURAL_PID $NODE_PID" > "$PID_FILE"
    echo "🔄 Restarted — Neural PID: $NEURAL_PID, Node PID: $NODE_PID"
}

cleanup() {
    echo ""
    echo "🛑 Shutting down A.L.E.C...."
    kill $NEURAL_PID 2>/dev/null || true
    kill $NODE_PID 2>/dev/null || true
    # Also kill child processes (uvicorn spawns workers, nodemon spawns node)
    pkill -P $NEURAL_PID 2>/dev/null || true
    pkill -P $NODE_PID 2>/dev/null || true
    wait $NEURAL_PID 2>/dev/null || true
    wait $NODE_PID 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "👋 A.L.E.C. stopped."
    exit 0
}

trap reload_handler SIGUSR1
trap cleanup SIGINT SIGTERM

# ── Tail logs (foreground) ───────────────────────────────────────
# Show combined logs so you see what's happening
tail -f "$LOG_DIR/neural.log" "$LOG_DIR/node.log" &
TAIL_PID=$!

# Wait for either process to exit unexpectedly
while true; do
    if ! kill -0 $NEURAL_PID 2>/dev/null; then
        echo "$(date): ⚠️  Neural engine exited — restarting in 3s..."
        sleep 3
        source "$VENV_DIR/bin/activate"
        cd "$PROJECT_DIR/services/neural"
        uvicorn server:app \
            --host 0.0.0.0 \
            --port "$NEURAL_PORT" \
            --reload \
            --reload-dir "." \
            --reload-include "*.py" \
            --log-level info \
            > "$LOG_DIR/neural.log" 2>&1 &
        NEURAL_PID=$!
        cd "$PROJECT_DIR"
        echo "$NEURAL_PID $NODE_PID" > "$PID_FILE"
        echo "$(date): ✅ Neural engine restarted (PID: $NEURAL_PID)"
    fi
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "$(date): ⚠️  Node.js exited — restarting in 3s..."
        sleep 3
        cd "$PROJECT_DIR"
        if npx --no-install nodemon --version &>/dev/null 2>&1; then
            npx nodemon \
                --watch backend/ \
                --watch frontend/ \
                --ext js,html,css \
                --ignore 'node_modules/' \
                --ignore 'data/' \
                --delay 1 \
                backend/server.js \
                > "$LOG_DIR/node.log" 2>&1 &
            NODE_PID=$!
        else
            node backend/server.js > "$LOG_DIR/node.log" 2>&1 &
            NODE_PID=$!
        fi
        echo "$NEURAL_PID $NODE_PID" > "$PID_FILE"
        echo "$(date): ✅ Node.js restarted (PID: $NODE_PID)"
    fi
    sleep 5
done
