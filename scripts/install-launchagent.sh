#!/bin/bash
# Install A.L.E.C. as a macOS LaunchAgent — starts on boot, stays alive.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.alec.watchdog"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${PROJECT_DIR}/scripts/watchdog.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/alec-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/alec-watchdog.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "✅ A.L.E.C. watchdog installed as LaunchAgent"
echo "   A.L.E.C. will now start automatically on boot and restart if it crashes."
echo "   Logs: /tmp/alec-watchdog.log"
echo ""
echo "   To stop:    launchctl unload $PLIST_PATH"
echo "   To restart: launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
echo "   To remove:  launchctl unload $PLIST_PATH && rm $PLIST_PATH"
