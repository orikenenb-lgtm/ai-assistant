#!/usr/bin/env bash
# Ori Travel AI - apply DB migrations safely: when the database already exists and is behind the
# code, a timestamped backup (data/backups/*-pre-migrate-*.db) is taken FIRST. Stop the server before running.
#   scripts/migrate.sh
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
info "Checking whether a pre-migration backup is needed"
(cd "$API_DIR" && "$PY" "$SCRIPT_DIR/_backup_db.py" --if-pending-migrations --label pre-migrate) \
  || die "Backup failed - migrations were NOT applied. Fix the problem above first."
info "Applying database migrations"
(cd "$API_DIR" && "$PY" -m app.cli migrate)
