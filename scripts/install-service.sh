#!/bin/bash
# Install A.L.E.C. as a persistent macOS service via launchd.
# Survives reboots, auto-restarts on crash, starts on login.
# Run once: bash scripts/install-service.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="/tmp/alec"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

# Find the venv python
VENV_PYTHON="$PROJECT_DIR/services/neural/.venv/bin/python"
if [ ! -f "$VENV_PYTHON" ]; then
    echo "ERROR: Python venv not found at $VENV_PYTHON"
    echo "Run: bash scripts/setup-local.sh first"
    exit 1
fi

NODE_BIN=$(which node)
if [ -z "$NODE_BIN" ]; then
    echo "ERROR: node not found in PATH"
    exit 1
fi

echo "Installing A.L.E.C. launchd services..."
echo "  Project: $PROJECT_DIR"
echo "  Python:  $VENV_PYTHON"
echo "  Node:    $NODE_BIN"

# ── Node.js Backend ──────────────────────────────────────────

cat > "$PLIST_DIR/com.alec.node.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.alec.node</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/backend/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/node.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/node.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST

# ── Python Neural Engine ─────────────────────────────────────

cat > "$PLIST_DIR/com.alec.neural.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.alec.neural</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VENV_PYTHON</string>
        <string>$PROJECT_DIR/services/neural/server.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR/services/neural</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/neural.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/neural.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
PLIST

# ── Tailscale Funnel ─────────────────────────────────────────

cat > "$PLIST_DIR/com.alec.funnel.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.alec.funnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/tailscale</string>
        <string>funnel</string>
        <string>3001</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/funnel.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/funnel.err</string>
    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>
PLIST

# ── Unload old versions if they exist ────────────────────────

for svc in com.alec.node com.alec.neural com.alec.funnel; do
    launchctl bootout "gui/$(id -u)/$svc" 2>/dev/null || true
done

# Kill any existing processes
kill $(lsof -ti:3001) 2>/dev/null || true
kill $(lsof -ti:8000) 2>/dev/null || true
sleep 2

# ── Load and start ───────────────────────────────────────────

launchctl load "$PLIST_DIR/com.alec.neural.plist"
echo "  Loaded: com.alec.neural (Python :8000)"

launchctl load "$PLIST_DIR/com.alec.node.plist"
echo "  Loaded: com.alec.node (Node :3001)"

launchctl load "$PLIST_DIR/com.alec.funnel.plist"
echo "  Loaded: com.alec.funnel (Tailscale Funnel :443)"

echo ""
echo "A.L.E.C. services installed."
echo ""
echo "  Node log:    tail -f $LOG_DIR/node.log"
echo "  Neural log:  tail -f $LOG_DIR/neural.log"
echo "  Funnel log:  tail -f $LOG_DIR/funnel.log"
echo ""
echo "  Status:      launchctl list | grep alec"
echo "  Stop:        launchctl unload ~/Library/LaunchAgents/com.alec.*.plist"
echo "  Restart:     launchctl kickstart -k gui/$(id -u)/com.alec.neural"
echo ""
echo "These services will auto-start on every login and restart on crash."
