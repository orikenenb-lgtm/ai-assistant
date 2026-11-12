"""Copy the SQLite database to apps/api/data/backups/ using SQLite's online backup API.

Run from apps/api (scripts/backup-db.* do this). Never prints secrets.
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from app.core.config import API_ROOT, get_settings  # noqa: E402

url = get_settings().database_url
if not url.startswith("sqlite"):
    print("Database is not SQLite - use pg_dump for PostgreSQL.", file=sys.stderr)
    raise SystemExit(2)
raw = url.split(":///", 1)[1] if ":///" in url else ""
if not raw or raw == ":memory:":
    print("In-memory database - nothing to back up.", file=sys.stderr)
    raise SystemExit(2)
src = Path(raw)
if not src.is_absolute():
    src = (API_ROOT / src).resolve()
if not src.is_file():
    print(f"Database file not found: {src}", file=sys.stderr)
    raise SystemExit(2)
dest_dir = API_ROOT / "data" / "backups"
dest_dir.mkdir(parents=True, exist_ok=True)
dest = dest_dir / f"{src.stem}-{datetime.now():%Y%m%d-%H%M%S}.db"
with sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True) as s, sqlite3.connect(dest) as d:
    s.backup(d)
print(f"Backup written: {dest}")
