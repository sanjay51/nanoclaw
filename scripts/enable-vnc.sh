#!/usr/bin/env bash
# Enable VNC access to this machine's desktop via x11vnc.
# Connect from Mac using RealVNC Viewer.
#
# Usage:
#   ./scripts/enable-vnc.sh              # start with password prompt
#   ./scripts/enable-vnc.sh --no-pw      # start without password (LAN only!)
#   ./scripts/enable-vnc.sh stop         # kill running x11vnc

set -euo pipefail

VNC_PORT=5900
DISPLAY_NUM=":0"
PW_FILE="$HOME/.vnc/passwd"

stop_vnc() {
    if pgrep -x x11vnc > /dev/null 2>&1; then
        echo "Stopping x11vnc..."
        pkill x11vnc
        echo "Stopped."
    else
        echo "x11vnc is not running."
    fi
}

if [[ "${1:-}" == "stop" ]]; then
    stop_vnc
    exit 0
fi

# Check if already running
if pgrep -x x11vnc > /dev/null 2>&1; then
    echo "x11vnc is already running (PID $(pgrep -x x11vnc))."
    echo "Use '$0 stop' to stop it first."
    exit 1
fi

# Build x11vnc args
ARGS=(
    -display "$DISPLAY_NUM"
    -rfbport "$VNC_PORT"
    -shared           # allow multiple viewers
    -forever          # don't exit after first client disconnects
    -noxdamage        # better compatibility
    -bg               # background after starting
)

if [[ "${1:-}" == "--no-pw" ]]; then
    ARGS+=(-nopw)
    echo "WARNING: Starting without password protection."
else
    # Set up password if not already configured
    if [[ ! -f "$PW_FILE" ]]; then
        mkdir -p "$(dirname "$PW_FILE")"
        echo "Set a VNC password (used by RealVNC Viewer to connect):"
        x11vnc -storepasswd "$PW_FILE"
    fi
    ARGS+=(-rfbauth "$PW_FILE")
fi

echo "Starting x11vnc on port $VNC_PORT..."
x11vnc "${ARGS[@]}"

# Print connection info
echo ""
echo "=== VNC Server Running ==="
echo ""
echo "Connect from Mac with RealVNC Viewer using one of:"
echo ""
for ip in $(hostname -I); do
    # Skip Docker bridge IPs
    case "$ip" in
        172.17.*|172.18.*|fd7a:*) continue ;;
    esac
    echo "  $ip:$VNC_PORT"
done
echo ""
echo "To stop: $0 stop"
