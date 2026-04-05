#!/bin/bash
# Restart the Python neural engine with health verification.
# Safe to copy-paste from anywhere (ASCII only, no smart quotes).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG="/tmp/alec/neural.log"
PORT=8000

mkdir -p /tmp/alec

echo "-- Stopping neural engine on port $PORT..."
kill $(lsof -ti:$PORT) 2>/dev/null
sleep 2

echo "-- Starting neural engine..."
cd "$PROJECT_DIR/services/neural" || exit 1
source .venv/bin/activate
nohup python server.py > "$LOG" 2>&1 &
PID=$!
echo "-- PID: $PID"
echo "-- Log: $LOG"

echo "-- Waiting for /health endpoint..."
for i in $(seq 1 60); do
    RESP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health" 2>/dev/null)
    if [ "$RESP" = "200" ]; then
        MODEL=$(curl -s "http://localhost:$PORT/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model_loaded','?'))" 2>/dev/null)
        STOA=$(curl -s "http://localhost:$PORT/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stoa_connected','?'))" 2>/dev/null)
        echo ""
        echo "=============================="
        echo "  HEALTH CHECK: PASS"
        echo "  Model loaded: $MODEL"
        echo "  Stoa DB:      $STOA"
        echo "  PID:          $PID"
        echo "  Port:         $PORT"
        echo "=============================="
        exit 0
    fi
    printf "."
    sleep 1
done

echo ""
echo "=============================="
echo "  HEALTH CHECK: FAIL"
echo "  Engine did not respond in 60s"
echo "  Check log: tail -50 $LOG"
echo "=============================="
tail -10 "$LOG"
exit 1
