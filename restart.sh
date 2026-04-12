#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# ALEC — Restart all services
# Usage: bash restart.sh
# ─────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")"
echo "↺ Restarting ALEC…"
bash stop.sh
sleep 1
bash start.sh
