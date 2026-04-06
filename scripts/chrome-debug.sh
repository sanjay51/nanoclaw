#!/usr/bin/env bash
# Launch Chrome with remote debugging enabled so NanoClaw's Chrome MCP server can connect.
# Usage: ./scripts/chrome-debug.sh [--headless]

set -euo pipefail

PORT="${CHROME_DEBUG_PORT:-9222}"
USER_DATA_DIR="${CHROME_USER_DATA_DIR:-$HOME/.config/google-chrome-debug}"

# Find Chrome binary
for candidate in google-chrome-stable google-chrome chromium-browser chromium; do
  if command -v "$candidate" &>/dev/null; then
    CHROME="$candidate"
    break
  fi
done

if [[ -z "${CHROME:-}" ]]; then
  echo "Error: No Chrome/Chromium binary found" >&2
  exit 1
fi

ARGS=(
  --remote-debugging-port="$PORT"
  --remote-debugging-address=0.0.0.0
  --user-data-dir="$USER_DATA_DIR"
  --no-first-run
  --no-default-browser-check
  --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding
)

if [[ "${1:-}" == "--headless" ]]; then
  ARGS+=(--headless=new)
  shift
fi

# Pass through any extra flags
ARGS+=("$@")

echo "Starting $CHROME on CDP port $PORT"
echo "User data dir: $USER_DATA_DIR"
exec "$CHROME" "${ARGS[@]}"
