#!/bin/bash
# Restart the Python neural engine. Safe to copy-paste from anywhere.
cd "$(dirname "$0")/.." || exit 1
kill $(lsof -ti:8000) 2>/dev/null
sleep 2
cd services/neural
source .venv/bin/activate
nohup python server.py > /tmp/alec/neural.log 2>&1 &
echo "Neural engine started (PID $!)"
echo "Log: tail -f /tmp/alec/neural.log"
