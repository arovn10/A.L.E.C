#!/bin/bash
# A.L.E.C. - Quick Start with Azure Persistent Learning
# Owned by arovner@campusrentalsllc.com

echo "🚀 Starting A.L.E.C. with Persistent Learning..."
echo "==============================================="

# Check if running in background
if [ "$1" = "--bg" ]; then
    echo "Starting in background mode..."
    node backend/server.js &
else
    echo "Starting in foreground mode (Ctrl+C to stop)..."
    node backend/server.js
fi
