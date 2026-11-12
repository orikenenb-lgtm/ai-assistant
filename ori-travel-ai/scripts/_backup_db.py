"""SQLite backup / restore helper for Ori Travel AI. Never prints secrets.

Run from anywhere (scripts/backup-db.*, migrate.*, restore-db.* do this); paths come from the app settings.

    python _backup_db.py                          # backup -> data/backups/<name>-<timestamp>.db
    python _backup_db.py --label pre-migrate      # backup -> data/backups/<name>-pre-migrate-<timestamp>.db
    python _backup_db.py --if-pending-migrations --label pre-migrate
                                                  # backup only if the DB exists, has tables AND is behind alembic head
    python _backup_db.py --restore FILE           # restore FILE over the DB (first saves a pre-restore backup)

Exit codes: 0 ok / nothing to do, 2 error (not SQLite, file missing, bad restore file).
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import NoReturn

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from app.core.config import API_ROOT, get_settings  # noqa: E402


def _fail(msg: str) -> NoReturn:
    print(msg, file=sys.stderr)
    raise SystemExit(2)


def _db_path() -> Path:
    url = get_settings().database_url
    if not url.startswith("sqlite"):
        _fail("Database is not SQLite - use pg_dump for PostgreSQL.")
    raw = url.split(":///", 1)[1] if ":///" in url else ""
    if not raw or raw == ":memory:":
        _fail("In-memory database - nothing to back up.")
    src = Path(raw)
    if not src.is_absolute():
        src = (API_ROOT / src).resolve()
    return src


def _ro(path: Path) -> str:
    """Read-only SQLite URI; as_uri() percent-encodes spaces/#/% and handles Windows drive letters."""
    return path.as_uri() + "?mode=ro"


def _table_count(path: Path) -> int:
    with sqlite3.connect(_ro(path), uri=True) as c:
        return int(c.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0])


def _pending_migrations(path: Path) -> bool:
    """True when the DB's alembic revision differs from the code's head."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    heads = set(ScriptDirectory.from_config(cfg).get_heads())
    with sqlite3.connect(_ro(path), uri=True) as c:
        try:
            current = {r[0] for r in c.execute("SELECT version_num FROM alembic_version")}
        except sqlite3.OperationalError:  # no alembic_version table: unversioned DB, treat as pending
            current = set()
    return current != heads


def _backup(src: Path, label: str) -> Path:
    dest_dir = API_ROOT / "data" / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    mid = f"-{label}" if label else ""
    dest = dest_dir / f"{src.stem}{mid}-{datetime.now():%Y%m%d-%H%M%S}.db"
    n = 1
    while dest.exists():  # two backups within the same second
        dest = dest_dir / f"{src.stem}{mid}-{datetime.now():%Y%m%d-%H%M%S}-{n}.db"
        n += 1
    with sqlite3.connect(_ro(src), uri=True) as s, sqlite3.connect(dest) as d:
        s.backup(d)
        d.execute("PRAGMA journal_mode=DELETE")  # single self-contained file, no -wal/-shm siblings
    return dest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="")
    ap.add_argument("--if-pending-migrations", action="store_true")
    ap.add_argument("--restore", metavar="FILE")
    args = ap.parse_args()
    label = "".join(ch for ch in args.label if ch.isalnum() or ch in "-_")
    src = _db_path()

    if args.restore:
        bak = Path(args.restore).expanduser().resolve()
        if not bak.is_file():
            _fail(f"Backup file not found: {bak}")
        try:
            if _table_count(bak) == 0:
                _fail("The backup file has no tables - refusing to restore it.")
            with sqlite3.connect(_ro(bak), uri=True) as c:
                if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    _fail("The backup file failed SQLite integrity_check - refusing to restore it.")
        except sqlite3.DatabaseError as exc:
            _fail(f"Not a valid SQLite database: {exc}")
        if src.is_file() and src.stat().st_size > 0:
            print(f"Current DB saved first: {_backup(src, 'pre-restore')}")
        src.parent.mkdir(parents=True, exist_ok=True)
        for suffix in ("-wal", "-shm"):  # stale journals must not be replayed onto the restored file
            Path(str(src) + suffix).unlink(missing_ok=True)
        try:
            shutil.copyfile(bak, src)
        except PermissionError:
            _fail("Cannot overwrite the database - is the Ori server still running? Stop it and retry.")
        print(f"Restored {bak.name} -> {src}")
        return 0

    if not src.is_file():
        if args.if_pending_migrations:
            print("No database yet - nothing to back up (first run).")
            return 0
        _fail(f"Database file not found: {src}")
    if args.if_pending_migrations:
        if src.stat().st_size == 0 or _table_count(src) == 0:
            print("Empty database - nothing to back up.")
            return 0
        if not _pending_migrations(src):
            print("Database is already at the latest migration - no pre-migrate backup needed.")
            return 0
    print(f"Backup written: {_backup(src, label)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
