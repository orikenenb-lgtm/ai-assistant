#!/usr/bin/env bash
# scripts/create-owner.sh EMAIL NAME   (password: $ORI_OWNER_PASSWORD or hidden prompt)
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
[ $# -ge 2 ] || die "usage: create-owner.sh EMAIL NAME"
PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
if [ -z "${ORI_OWNER_PASSWORD:-}" ]; then read -r -s -p "Owner password (hidden): " ORI_OWNER_PASSWORD; echo; fi
export ORI_OWNER_PASSWORD
rc=0
(cd "$API_DIR" && "$PY" -m app.cli create-owner --email "$1" --name "$2" --password-env ORI_OWNER_PASSWORD) || rc=$?
unset ORI_OWNER_PASSWORD
exit "$rc"
