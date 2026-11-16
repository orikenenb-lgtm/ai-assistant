"""SQLite storage (stdlib ``sqlite3``, WAL mode, versioned idempotent migrations).

PRIVACY INVARIANT: there is deliberately no table for messages, drafts, sender names or
conversation references. Only device credentials (as sha256) and pairing codes (as HMAC-SHA256).

RETENTION (security review L-10): ``devices.last_seen_at`` has DAY granularity (UTC midnight,
epoch seconds) so the file holds no timeline of when private messages arrived; ``purge()`` (run
at every start and by ``admin purge``) deletes devices revoked more than 30 days ago.
"""

from __future__ import annotations

import os
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

DAY_SECONDS = 86_400

# (version, statements). Append only; never edit a released migration.
MIGRATIONS: tuple[tuple[int, tuple[str, ...]], ...] = (
    (
        1,
        (
            """
            CREATE TABLE IF NOT EXISTS devices (
                id            TEXT PRIMARY KEY,
                token_sha256  TEXT NOT NULL UNIQUE,
                name          TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                last_seen_at  INTEGER,
                revoked_at    INTEGER
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS pairing_codes (
                code_sha256  TEXT PRIMARY KEY,
                created_at   INTEGER NOT NULL,
                expires_at   INTEGER NOT NULL,
                used_at      INTEGER
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires ON pairing_codes(expires_at)",
        ),
    ),
    (
        2,
        (
            # L-10: coarsen existing last_seen_at values to the UTC day (idempotent by itself too).
            f"UPDATE devices SET last_seen_at = (last_seen_at / {DAY_SECONDS}) * {DAY_SECONDS}"
            " WHERE last_seen_at IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS idx_devices_revoked ON devices(revoked_at)",
        ),
    ),
)

# Expired/used pairing codes are deleted after this many seconds (they are useless afterwards).
PAIRING_CODE_RETENTION_SECONDS = 24 * 3600
# Revoked devices are deleted this long after revocation.
REVOKED_DEVICE_RETENTION_SECONDS = 30 * DAY_SECONDS


@dataclass(frozen=True)
class PurgeResult:
    devices: int
    pairing_codes: int


@dataclass(frozen=True)
class Device:
    id: str
    token_sha256: str
    name: str
    created_at: int
    last_seen_at: int | None
    revoked_at: int | None

    @property
    def revoked(self) -> bool:
        return self.revoked_at is not None


def _now() -> int:
    return int(time.time())


def day_of(ts: int) -> int:
    """UTC midnight (epoch seconds) of the day containing ``ts``."""
    return ts - ts % DAY_SECONDS


class Database:
    """Thin repository. A short-lived connection per operation keeps it thread-safe."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)

    # -- infrastructure ------------------------------------------------------------------
    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            else:
                conn.execute("COMMIT")

    def migrate(self) -> list[int]:
        """Create the file (0600, dir 0700) and apply pending migrations. Returns applied versions."""
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not self.path.exists():
                fd = os.open(self.path, os.O_CREAT | os.O_WRONLY, 0o600)
                os.close(fd)
        applied: list[int] = []
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
            )
        for version, statements in MIGRATIONS:
            with self.transaction() as conn:
                done = conn.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?", (version,)
                ).fetchone()
                if done:
                    continue
                for sql in statements:
                    conn.execute(sql)
                conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (version, _now()),
                )
                applied.append(version)
        return applied

    def schema_version(self) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
            return int(row["v"] or 0)

    # -- pairing codes -------------------------------------------------------------------
    def add_pairing_code(self, code_sha256: str, ttl_seconds: int) -> int:
        """Store a code hash; returns expires_at. Also prunes long-dead codes."""
        now = _now()
        expires_at = now + ttl_seconds
        with self.transaction() as conn:
            conn.execute(
                "DELETE FROM pairing_codes WHERE expires_at < ?",
                (now - PAIRING_CODE_RETENTION_SECONDS,),
            )
            conn.execute(
                "INSERT INTO pairing_codes(code_sha256, created_at, expires_at) VALUES (?, ?, ?)",
                (code_sha256, now, expires_at),
            )
        return expires_at

    def redeem_pairing_code(
        self, code_sha256: str, device_id: str, token_sha256: str, device_name: str
    ) -> bool:
        """Atomically mark the code used and create the device. False if invalid/expired/used."""
        now = _now()
        with self.transaction() as conn:
            cur = conn.execute(
                "UPDATE pairing_codes SET used_at = ?"
                " WHERE code_sha256 = ? AND used_at IS NULL AND expires_at > ?",
                (now, code_sha256, now),
            )
            if cur.rowcount != 1:
                return False
            conn.execute(
                "INSERT INTO devices(id, token_sha256, name, created_at, last_seen_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (device_id, token_sha256, device_name, now, day_of(now)),
            )
        return True

    # -- devices -------------------------------------------------------------------------
    @staticmethod
    def _device(row: sqlite3.Row | None) -> Device | None:
        if row is None:
            return None
        return Device(
            id=row["id"],
            token_sha256=row["token_sha256"],
            name=row["name"],
            created_at=row["created_at"],
            last_seen_at=row["last_seen_at"],
            revoked_at=row["revoked_at"],
        )

    def get_device_by_token_hash(self, token_sha256: str) -> Device | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM devices WHERE token_sha256 = ?", (token_sha256,)
            ).fetchone()
        return self._device(row)

    def get_device(self, device_id: str) -> Device | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
        return self._device(row)

    def list_devices(self) -> list[Device]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM devices ORDER BY created_at, id").fetchall()
        return [d for d in (self._device(r) for r in rows) if d is not None]

    def touch_device(self, device_id: str, min_interval_seconds: int = 60) -> None:
        """Set last_seen_at to TODAY (UTC midnight): day granularity, at most one write per day.

        ``min_interval_seconds`` is kept for backward compatibility and ignored.
        """
        del min_interval_seconds
        today = day_of(_now())
        with self.connect() as conn:
            conn.execute(
                "UPDATE devices SET last_seen_at = ?"
                " WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)",
                (today, device_id, today),
            )

    def purge(
        self,
        revoked_retention_seconds: int = REVOKED_DEVICE_RETENTION_SECONDS,
        now: int | None = None,
    ) -> PurgeResult:
        """Delete devices revoked more than ``revoked_retention_seconds`` ago and dead pairing codes."""
        now = _now() if now is None else now
        with self.transaction() as conn:
            devices = conn.execute(
                "DELETE FROM devices WHERE revoked_at IS NOT NULL AND revoked_at < ?",
                (now - revoked_retention_seconds,),
            ).rowcount
            codes = conn.execute(
                "DELETE FROM pairing_codes WHERE expires_at < ?",
                (now - PAIRING_CODE_RETENTION_SECONDS,),
            ).rowcount
        return PurgeResult(devices=devices, pairing_codes=codes)

    def revoke_device(self, device_id: str) -> bool:
        """Revoke a device. Returns True if it existed and was active."""
        with self.connect() as conn:
            cur = conn.execute(
                "UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
                (_now(), device_id),
            )
            return cur.rowcount == 1
