#!/usr/bin/env bash
# Manage the Chrome virtual display (Xvfb + Chrome + VNC)
# Usage: ./scripts/chrome-vdisplay.sh <command> [args]

set -euo pipefail

DISPLAY_NUM=99
VNC_PORT=5950
CDP_PORT=9222
VNC_SERVICE=x11vnc-chrome.service

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  start       Start Xvfb, Chrome, and VNC
  stop        Stop all services
  restart     Restart all services
  status      Show service status and CDP health
  vnc         Start/restart VNC viewer on port $VNC_PORT
  vnc-stop    Stop VNC
  open [url]  Open a URL in Chrome (default: about:blank)
  tabs        List open tabs
  close <id>  Close a tab by ID
  logs        Show recent Chrome service logs
EOF
}

start_services() {
  echo "Starting Xvfb + Chrome..."
  systemctl --user start xvfb.service
  systemctl --user start chrome-debug.service
  sleep 2
  start_vnc
  echo "All services started."
  show_status
}

stop_services() {
  echo "Stopping services..."
  stop_vnc
  systemctl --user stop chrome-debug.service 2>/dev/null || true
  systemctl --user stop xvfb.service 2>/dev/null || true
  echo "All services stopped."
}

restart_services() {
  echo "Restarting services..."
  systemctl --user restart xvfb.service
  systemctl --user restart chrome-debug.service
  sleep 2
  stop_vnc
  start_vnc
  echo "All services restarted."
  show_status
}

show_status() {
  echo "=== Services ==="
  for svc in xvfb.service chrome-debug.service; do
    state=$(systemctl --user is-active "$svc" 2>/dev/null || true)
    printf "  %-25s %s\n" "$svc" "$state"
  done

  vnc_state=$(systemctl --user is-active "$VNC_SERVICE" 2>/dev/null || true)
  printf "  %-25s %s (port $VNC_PORT)\n" "$VNC_SERVICE" "$vnc_state"

  echo ""
  echo "=== CDP ==="
  if curl -s --max-time 3 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    browser=$(curl -s "http://localhost:${CDP_PORT}/json/version" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Browser','unknown'))" 2>/dev/null)
    echo "  Chrome CDP responding on port $CDP_PORT ($browser)"
  else
    echo "  Chrome CDP NOT responding on port $CDP_PORT"
  fi
}

start_vnc() {
  # Kill any stray unmanaged x11vnc on this display to avoid port conflicts
  pkill -f "x11vnc -display :${DISPLAY_NUM}" 2>/dev/null || true
  systemctl --user restart "$VNC_SERVICE"
  sleep 1
  if [[ "$(systemctl --user is-active "$VNC_SERVICE" 2>/dev/null)" == "active" ]]; then
    echo "VNC running on port $VNC_PORT (display :${DISPLAY_NUM}, via $VNC_SERVICE)"
  else
    echo "Warning: $VNC_SERVICE failed to start" >&2
  fi
}

stop_vnc() {
  systemctl --user stop "$VNC_SERVICE" 2>/dev/null || true
  pkill -f "x11vnc -display :${DISPLAY_NUM}" 2>/dev/null || true
}

open_url() {
  local url="${1:-about:blank}"
  result=$(curl -s -X PUT "http://localhost:${CDP_PORT}/json/new?${url}")
  tab_id=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
  echo "Opened: $url (tab $tab_id)"
}

list_tabs() {
  curl -s "http://localhost:${CDP_PORT}/json" | python3 -c "
import sys, json
tabs = [t for t in json.load(sys.stdin) if t['type'] == 'page']
if not tabs:
    print('  No tabs open')
else:
    for t in tabs:
        print(f\"  {t['id']}  {t['url'][:80]}  {t.get('title','')[:40]}\")
"
}

close_tab() {
  local tab_id="$1"
  if curl -s "http://localhost:${CDP_PORT}/json/close/${tab_id}" | grep -q "Target is closing"; then
    echo "Closed tab $tab_id"
  else
    echo "Failed to close tab $tab_id" >&2
    exit 1
  fi
}

show_logs() {
  journalctl --user -u chrome-debug.service -u xvfb.service --no-pager -n 30
}

# --- Main ---

cmd="${1:-}"
shift || true

case "$cmd" in
  start)    start_services ;;
  stop)     stop_services ;;
  restart)  restart_services ;;
  status)   show_status ;;
  vnc)      start_vnc ;;
  vnc-stop) stop_vnc; echo "VNC stopped." ;;
  open)     open_url "${1:-}" ;;
  tabs)     list_tabs ;;
  close)
    [[ -z "${1:-}" ]] && { echo "Usage: $(basename "$0") close <tab-id>" >&2; exit 1; }
    close_tab "$1"
    ;;
  logs)     show_logs ;;
  *)        usage ;;
esac
