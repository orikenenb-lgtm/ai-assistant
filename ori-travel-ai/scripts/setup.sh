#!/usr/bin/env bash
# Ori Travel AI - first-time setup (Linux / macOS / CI). Idempotent.
#   scripts/setup.sh [--skip-web] [--seed-demo] [--create-owner EMAIL NAME]
# The owner password is read from $ORI_OWNER_PASSWORD or prompted (hidden).
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

SKIP_WEB=0; SEED=0; OWNER_EMAIL=""; OWNER_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-web) SKIP_WEB=1 ;;
    --seed-demo) SEED=1 ;;
    --create-owner) [ $# -ge 3 ] || die "usage: --create-owner EMAIL NAME"; OWNER_EMAIL="$2"; OWNER_NAME="$3"; shift 2 ;;
    -h|--help) sed -n 2,5p "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# 1. Python -------------------------------------------------------------
SYS_PY="$(find_system_python)" || die "Python >= 3.12 not found. Install it from https://www.python.org/downloads/"
ok "Python: $($SYS_PY --version)"

# 2. Node ---------------------------------------------------------------
if [ "$SKIP_WEB" -eq 0 ]; then
  check_node || die "Node.js >= 20 and npm are required (Node 22 LTS recommended): https://nodejs.org/ (or use --skip-web)"
  ok "Node: $(node --version), npm: $(npm --version)"
fi

# 3. venv + dependencies ---------------------------------------------------
if ! venv_python >/dev/null; then
  info "Creating virtualenv in apps/api/.venv"
  "$SYS_PY" -m venv "$VENV_DIR"
else
  ok "Reusing existing virtualenv"
fi
PY="$(venv_python)"
info "Installing API dependencies (requirements-dev.txt)"
"$PY" -m pip install --disable-pip-version-check -q -r "$API_DIR/requirements-dev.txt"
ok "API dependencies installed"

# 4. .env + encryption key (never overwrite an existing key) ---------------
mkdir -p "$API_DIR/data"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  info "Created apps/api/.env from .env.example"
fi
KEY_STATE="$("$PY" - "$ENV_FILE" <<'PYEOF'
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines(keepends=True)
for i, ln in enumerate(lines):
    if ln.startswith("ORI_DATA_KEY="):
        if ln.split("=", 1)[1].strip():
            print("present"); raise SystemExit
        from cryptography.fernet import Fernet
        lines[i] = "ORI_DATA_KEY=" + Fernet.generate_key().decode() + "\n"
        open(path, "w", encoding="utf-8", newline="").write("".join(lines))
        print("generated"); raise SystemExit
from cryptography.fernet import Fernet
with open(path, "a", encoding="utf-8", newline="") as f:
    f.write("\nORI_DATA_KEY=" + Fernet.generate_key().decode() + "\n")
print("generated")
PYEOF
)"
if [ "$KEY_STATE" = "generated" ]; then
  ok "Generated ORI_DATA_KEY in apps/api/.env (value not printed)"
  warn "BACK UP apps/api/.env securely. Losing ORI_DATA_KEY makes encrypted traveler data unreadable."
else
  ok "Existing ORI_DATA_KEY kept (not modified)"
fi

# 5. migrations -------------------------------------------------------------
info "Applying database migrations"
(cd "$API_DIR" && "$PY" -m app.cli migrate)

# 6. web ----------------------------------------------------------------------
if [ "$SKIP_WEB" -eq 0 ]; then
  info "Installing web dependencies (npm ci)"
  (cd "$WEB_DIR" && npm ci --no-audit --no-fund)
  ok "Web dependencies installed"
else
  warn "Skipping web (--skip-web)"
fi

# 7. optional owner / demo -----------------------------------------------------
if [ -n "$OWNER_EMAIL" ]; then
  if [ -z "${ORI_OWNER_PASSWORD:-}" ]; then
    read -r -s -p "Owner password (hidden): " ORI_OWNER_PASSWORD; echo
  fi
  export ORI_OWNER_PASSWORD
  rc=0
  (cd "$API_DIR" && "$PY" -m app.cli create-owner --email "$OWNER_EMAIL" --name "$OWNER_NAME" --password-env ORI_OWNER_PASSWORD) || rc=$?
  unset ORI_OWNER_PASSWORD
  [ "$rc" -eq 0 ] || die "create-owner failed (exit $rc)"
fi
if [ "$SEED" -eq 1 ]; then
  (cd "$API_DIR" && "$PY" -m app.cli seed-demo)
fi

ok "Setup complete. Next: scripts/start.sh"
