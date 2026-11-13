#!/usr/bin/env bash
# Ori Travel AI - consistent SQLite backup into apps/api/data/backups/.
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
(cd "$API_DIR" && "$PY" "$SCRIPT_DIR/_backup_db.py")
warn "The encrypted traveler data needs the ORI_DATA_KEY from apps/api/.env."
warn "Back up apps/api/.env SEPARATELY and securely (not next to the DB backup, not in git)."
