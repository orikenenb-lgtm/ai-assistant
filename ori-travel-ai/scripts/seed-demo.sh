#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
PY="$(venv_python)" || die "No virtualenv. Run scripts/setup.sh first."
cd "$API_DIR" && exec "$PY" -m app.cli seed-demo
