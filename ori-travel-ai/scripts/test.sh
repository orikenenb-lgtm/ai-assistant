#!/usr/bin/env bash
# Ori Travel AI - run all checks. Exit code is non-zero if any step fails.
#   scripts/test.sh [--api-only] [--web-only] [--e2e]
set -uo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

DO_API=1; DO_WEB=1; DO_E2E=0
for a in "$@"; do
  case "$a" in
    --api-only) DO_WEB=0 ;;
    --web-only) DO_API=0 ;;
    --e2e) DO_E2E=1 ;;
    -h|--help) sed -n 2,3p "$0"; exit 0 ;;
    *) die "unknown option: $a" ;;
  esac
done

NAMES=(); RESULTS=()
step() { # step "name" command...
  local name="$1"; shift
  info "$name"
  if "$@"; then NAMES+=("$name"); RESULTS+=("PASS"); else NAMES+=("$name"); RESULTS+=("FAIL"); fi
}

if [ "$DO_API" -eq 1 ]; then
  PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
  step "api: ruff"   bash -c 'cd "$1" && "$2" -m ruff check .' _ "$API_DIR" "$PY"
  step "api: pytest" bash -c 'cd "$1" && "$2" -m pytest' _ "$API_DIR" "$PY"
fi
if [ "$DO_WEB" -eq 1 ]; then
  check_node || die "Node >= 20 required (or --api-only)."
  [ -d "$WEB_DIR/node_modules" ] || die "apps/web/node_modules missing. Run scripts/setup.sh."
  step "web: typecheck" bash -c 'cd "$1" && npm run typecheck' _ "$WEB_DIR"
  step "web: lint"      bash -c 'cd "$1" && npm run lint' _ "$WEB_DIR"
  step "web: vitest"    bash -c 'cd "$1" && npm test' _ "$WEB_DIR"
  step "web: build"     bash -c 'cd "$1" && npm run build' _ "$WEB_DIR"
fi
if [ "$DO_E2E" -eq 1 ]; then
  PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
  e2e() {
    # Throwaway DB + owner, API serving the built web app on a free port.
    local tmp port pid rc=0
    tmp="$(mktemp -d)"; port=8765
    free_port "$port" || { err "port $port busy"; return 1; }
    export ORI_DATABASE_URL="sqlite:///$tmp/e2e.db" ORI_OWNER_PASSWORD="E2e-Passw0rd-Local-1"
    # Throwaway server only: a full desktop+mobile browser run needs more than the per-user default budgets
    export ORI_SEARCH_RATE_LIMIT=300 ORI_CALENDAR_RATE_LIMIT=60
    # Throwaway encryption key for the throwaway DB (traveler-profile specs need one)
    ORI_DATA_KEY="$(cd "$API_DIR" && "$PY" -m app.cli gen-key)"; export ORI_DATA_KEY
    (cd "$API_DIR" && "$PY" -m app.cli migrate && "$PY" -m app.cli create-owner --email owner@e2e.test --name "בעלים" --password-env ORI_OWNER_PASSWORD) || return 1
    (cd "$API_DIR" && exec "$PY" -m uvicorn app.main:app --no-proxy-headers --host 127.0.0.1 --port "$port") &
    pid=$!
    for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
    (cd "$WEB_DIR" && E2E_BASE_URL="http://127.0.0.1:$port" E2E_OWNER_EMAIL=owner@e2e.test npm run e2e) || rc=$?
    kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
    unset ORI_OWNER_PASSWORD ORI_DATA_KEY ORI_SEARCH_RATE_LIMIT ORI_CALENDAR_RATE_LIMIT; rm -rf "$tmp"
    return "$rc"
  }
  [ -f "$WEB_DIR/dist/index.html" ] || (cd "$WEB_DIR" && npm run build)
  step "web: e2e (playwright)" e2e
fi

echo
echo "================ Summary ================"
fail=0
for i in "${!NAMES[@]}"; do
  printf '  %-28s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"
  [ "${RESULTS[$i]}" = "PASS" ] || fail=1
done
echo "========================================="
if [ "$fail" -eq 0 ]; then ok "All checks passed"; else err "Some checks failed"; fi
exit "$fail"
