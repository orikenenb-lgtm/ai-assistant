# shellcheck shell=bash
# shellcheck disable=SC2034
# Shared helpers for Ori Travel AI scripts (sourced, not executed).
# Paths are derived from this file's location, never from the caller's cwd.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
VENV_DIR="$API_DIR/.venv"
ENV_FILE="$API_DIR/.env"
ENV_EXAMPLE="$API_DIR/.env.example"

if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'; C_OFF=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_OFF=""
fi

info() { printf '%s[..]%s %s\n' "$C_CYAN" "$C_OFF" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s[!!]%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
err()  { printf '%s[XX]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
die()  { err "$*"; exit 1; }

# Path of the venv interpreter (Linux/macOS: bin/, Git-Bash on Windows: Scripts/).
venv_python() {
  if [ -x "$VENV_DIR/bin/python" ]; then echo "$VENV_DIR/bin/python"
  elif [ -x "$VENV_DIR/Scripts/python.exe" ]; then echo "$VENV_DIR/Scripts/python.exe"
  else return 1; fi
}

# Find a system Python >= 3.12. Prints the command to use.
find_system_python() {
  local c
  for c in python3.13 python3.12 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
      echo "$c"; return 0
    fi
  done
  return 1
}

# Node >= 20 check. Returns 0 when node and npm are usable.
check_node() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 20 ]
}

free_port() { # exit 0 when nothing listens on $1 (127.0.0.1)
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
