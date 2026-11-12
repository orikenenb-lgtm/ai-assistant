#!/usr/bin/env bash
# Ori Travel AI - restore the SQLite DB from a backup file. STOP THE SERVER FIRST.
# The current DB is saved as data/backups/*-pre-restore-*.db before being overwritten.
#   scripts/restore-db.sh apps/api/data/backups/ori_travel-20261112-101500.db
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
[ $# -eq 1 ] || die "usage: restore-db.sh BACKUP_FILE"
PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
if ! free_port "${ORI_PORT:-8000}"; then warn "Something listens on port ${ORI_PORT:-8000} - make sure the Ori server is stopped before restoring."; fi
# resolve relative to the caller's cwd (the python helper runs from apps/api)
[ -f "$1" ] || die "Backup file not found: $1"
FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
(cd "$API_DIR" && "$PY" "$SCRIPT_DIR/_backup_db.py" --restore "$FILE")
warn "The restored data must match the ORI_DATA_KEY in apps/api/.env (the key the backup was made with)."
