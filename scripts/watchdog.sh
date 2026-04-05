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

CHECK_INTERVAL=60    # seconds between health checks
UPDATE_INTERVAL=300  # seconds between git pull checks (5 min)
MAX_RESTARTS=10      # max restarts per hour before giving up
RESTART_COUNT=0
LAST_RESET=$(date +%s)
LAST_UPDATE_CHECK=0

echo "🐕 A.L.E.C. Watchdog started (health every ${CHECK_INTERVAL}s, updates every ${UPDATE_INTERVAL}s)"

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

    # ── Auto-update: check for new commits every UPDATE_INTERVAL ──
    NOW_UPDATE=$(date +%s)
    if [ $((NOW_UPDATE - LAST_UPDATE_CHECK)) -gt $UPDATE_INTERVAL ]; then
        LAST_UPDATE_CHECK=$NOW_UPDATE
        
        # Fetch latest from GitHub
        cd "$PROJECT_DIR"
        git fetch origin main --quiet 2>/dev/null
        
        LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null)
        REMOTE_HEAD=$(git rev-parse origin/main 2>/dev/null)
        
        if [ -n "$REMOTE_HEAD" ] && [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
            echo "$(date): 🔄 New code detected — updating A.L.E.C..."
            echo "  Local:  $LOCAL_HEAD"
            echo "  Remote: $REMOTE_HEAD"
            
            # Pull the update
            git reset --hard origin/main 2>/dev/null
            
            # Reinstall Node deps if package.json changed
            if git diff --name-only "$LOCAL_HEAD" "$REMOTE_HEAD" 2>/dev/null | grep -q "package.json"; then
                echo "$(date): 📦 package.json changed — running npm install"
                npm install --no-audit --no-fund --quiet 2>/dev/null
            fi
            
            # Reinstall Python deps if requirements.txt changed
            if git diff --name-only "$LOCAL_HEAD" "$REMOTE_HEAD" 2>/dev/null | grep -q "requirements.txt"; then
                echo "$(date): 🐍 requirements.txt changed — running pip install"
                source "$PROJECT_DIR/services/neural/.venv/bin/activate" 2>/dev/null
                pip install -r services/neural/requirements.txt --quiet 2>/dev/null
            fi
            
            echo "$(date): ✅ Code updated to $(git rev-parse --short HEAD) — restarting..."
            
            # Force restart with new code
            kill $(lsof -ti:3001) 2>/dev/null
            kill $(lsof -ti:8000) 2>/dev/null
            sleep 2
            # The health check below will detect it's down and restart
        fi
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
