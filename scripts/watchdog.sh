#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# A.L.E.C. Watchdog — keeps A.L.E.C. alive automatically.
#
# Checks every 60 seconds if A.L.E.C. is running.
# If it's down, restarts it automatically.
#
# Usage (run once, it stays running):
#   bash scripts/watchdog.sh &
#
# Or add to crontab for persistence across reboots:
#   crontab -e
#   @reboot cd ~/Desktop/App\ Development/A.l.E.C && bash scripts/watchdog.sh &
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

CHECK_INTERVAL=60  # seconds
MAX_RESTARTS=10    # max restarts per hour before giving up
RESTART_COUNT=0
LAST_RESET=$(date +%s)

echo "🐕 A.L.E.C. Watchdog started (checking every ${CHECK_INTERVAL}s)"

while true; do
    sleep $CHECK_INTERVAL

    # Reset counter every hour
    NOW=$(date +%s)
    if [ $((NOW - LAST_RESET)) -gt 3600 ]; then
        RESTART_COUNT=0
        LAST_RESET=$NOW
    fi

    # Check if too many restarts
    if [ $RESTART_COUNT -ge $MAX_RESTARTS ]; then
        echo "$(date): ⚠️ Too many restarts ($RESTART_COUNT/hr) — backing off"
        sleep 300  # Wait 5 minutes
        RESTART_COUNT=0
        continue
    fi

    # Check if Node.js is running on port 3001
    if ! curl -s --max-time 5 http://localhost:3001/health > /dev/null 2>&1; then
        echo "$(date): ❌ A.L.E.C. is down — restarting..."
        RESTART_COUNT=$((RESTART_COUNT + 1))

        # Kill any zombie processes
        kill $(lsof -ti:3001) 2>/dev/null
        kill $(lsof -ti:8000) 2>/dev/null
        sleep 2

        # Load .env
        if [ -f .env ]; then
            set -a
            source .env
            set +a
        fi

        # Activate venv and start
        VENV_DIR="$PROJECT_DIR/services/neural/.venv"
        if [ -d "$VENV_DIR" ]; then
            source "$VENV_DIR/bin/activate"
        fi

        # Start Python neural engine
        cd services/neural
        nohup python server.py > /tmp/alec-neural.log 2>&1 &
        cd "$PROJECT_DIR"
        sleep 5

        # Start Node.js backend
        nohup node backend/server.js > /tmp/alec-node.log 2>&1 &
        sleep 3

        # Start Tailscale Funnel
        if command -v tailscale &> /dev/null; then
            tailscale funnel ${PORT:-3001} &>/dev/null &
        fi

        # Verify
        sleep 5
        if curl -s --max-time 5 http://localhost:3001/health > /dev/null 2>&1; then
            echo "$(date): ✅ A.L.E.C. restarted successfully (restart #$RESTART_COUNT)"
        else
            echo "$(date): ⚠️ Restart attempt #$RESTART_COUNT may have failed"
        fi
    fi
done
