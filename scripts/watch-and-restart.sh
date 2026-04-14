#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# A.L.E.C. Auto-Restart Watcher
#
# Polls git every 30 seconds. If new commits are pulled from origin,
# kills the running server and starts a fresh one.
#
# Usage:
#   bash scripts/watch-and-restart.sh
#
# Runs forever in the foreground. Use launchd (see below) to run at login.
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_SCRIPT="$REPO_DIR/backend/server.js"
LOG_FILE="$REPO_DIR/logs/server.log"
PID_FILE="$REPO_DIR/logs/server.pid"
POLL_INTERVAL=30  # seconds between git pull checks

mkdir -p "$REPO_DIR/logs"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Start server ─────────────────────────────────────────────────
start_server() {
  # Kill any process already on port 3001
  local old
  old=$(lsof -ti :3001 2>/dev/null || true)
  if [[ -n "$old" ]]; then
    log "Killing existing process(es) on port 3001: $old"
    kill -9 $old 2>/dev/null || true
    sleep 1
  fi

  # Also kill by PID file if exists
  if [[ -f "$PID_FILE" ]]; then
    local prev_pid
    prev_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "$prev_pid" ]] && kill -0 "$prev_pid" 2>/dev/null; then
      log "Killing previous server PID $prev_pid"
      kill -9 "$prev_pid" 2>/dev/null || true
      sleep 1
    fi
  fi

  log "Starting A.L.E.C. server..."
  cd "$REPO_DIR"
  node "$SERVER_SCRIPT" >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"
  log "Server started (PID $new_pid). Log: $LOG_FILE"
}

# ── Main loop ────────────────────────────────────────────────────
log "A.L.E.C. watcher started. Repo: $REPO_DIR"
log "Polling git every ${POLL_INTERVAL}s..."

# Start server on first run
start_server

while true; do
  sleep "$POLL_INTERVAL"

  cd "$REPO_DIR"

  # Fetch without merging first
  git fetch origin main --quiet 2>/dev/null || {
    log "git fetch failed (no internet?), skipping"
    continue
  }

  LOCAL=$(git rev-parse HEAD 2>/dev/null)
  REMOTE=$(git rev-parse origin/main 2>/dev/null)

  if [[ "$LOCAL" != "$REMOTE" ]]; then
    log "New commits detected ($LOCAL → $REMOTE)"

    git pull origin main --quiet 2>/dev/null || {
      log "git pull failed, skipping restart"
      continue
    }

    # Install any new npm packages
    if git diff --name-only "$LOCAL" "$REMOTE" 2>/dev/null | grep -q "package.json"; then
      log "package.json changed — running npm install..."
      npm install --quiet 2>/dev/null || true
    fi

    log "Restarting server with new code..."
    start_server
  fi
done
