#!/usr/bin/env bash
# Ori Travel AI - run locally.
#   scripts/start.sh [app|dev] [--rebuild] [--lan] [--port N]
#   app (default): build web if dist/ missing, FastAPI serves API + SPA on 127.0.0.1:8000
#   dev          : API with --reload (8000) + Vite (5173)
# Binds to 127.0.0.1 only unless --lan is passed (see docs/operations/windows-setup.md).
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

MODE="app"; REBUILD=0; LAN=0; PORT="${ORI_PORT:-8000}"; WEB_PORT="${VITE_PORT:-5173}"
while [ $# -gt 0 ]; do
  case "$1" in
    app|dev) MODE="$1" ;;
    --rebuild) REBUILD=1 ;;
    --lan) LAN=1 ;;
    --port) [ $# -ge 2 ] || die "--port needs a value"; PORT="$2"; shift ;;
    -h|--help) sed -n 2,6p "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

PY="$(venv_python)" || die "No virtualenv found. Run scripts/setup.sh first."
[ -f "$ENV_FILE" ] || warn "apps/api/.env is missing - run scripts/setup.sh (encrypted traveler data will be unavailable)."
HOST="127.0.0.1"
if [ "$LAN" -eq 1 ]; then
  HOST="0.0.0.0"
  warn "LAN mode: the app is reachable by other devices on your network over plain HTTP."
  warn "Anyone on the network can reach the login page. Prefer HTTPS via a reverse proxy and set ORI_COOKIE_SECURE=true."
fi
free_port "$PORT" || die "Port $PORT is busy. Use --port N."

if [ "$MODE" = "app" ]; then
  check_node || [ -f "$WEB_DIR/dist/index.html" ] || die "Node >= 20 is needed to build the web app."
  if [ "$REBUILD" -eq 1 ] || [ ! -f "$WEB_DIR/dist/index.html" ]; then
    info "Building web app"
    (cd "$WEB_DIR" && npm run build)
  fi
  ok "Open: http://localhost:$PORT   (Ctrl+C to stop)"
  cd "$API_DIR"
  exec "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT"
fi

# dev mode
check_node || die "Node >= 20 is required for dev mode."
free_port "$WEB_PORT" || die "Port $WEB_PORT is busy. Set VITE_PORT."
PIDS=()
kill_tree() { # kill a process and all its descendants (npm -> sh -> vite, uvicorn reloader)
  local c
  for c in $(pgrep -P "$1" 2>/dev/null || true); do kill_tree "$c"; done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  trap - INT TERM EXIT
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill_tree "$p"
  done
  wait 2>/dev/null || true
  info "Stopped."
}
trap cleanup INT TERM EXIT
(cd "$API_DIR" && exec "$PY" -m uvicorn app.main:app --reload --host "$HOST" --port "$PORT") &
PIDS+=("$!")
(cd "$WEB_DIR" && VITE_API_TARGET="http://127.0.0.1:$PORT" VITE_PORT="$WEB_PORT" exec npm run dev) &
PIDS+=("$!")
ok "API: http://127.0.0.1:$PORT   Web (dev): http://localhost:$WEB_PORT   (Ctrl+C stops both)"
# portable 'wait for any' (bash 3.2 on macOS has no wait -n)
while kill -0 "${PIDS[0]}" 2>/dev/null && kill -0 "${PIDS[1]}" 2>/dev/null; do sleep 1; done
