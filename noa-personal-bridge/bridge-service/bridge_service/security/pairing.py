"""One-time pairing codes: 8 symbols from Crockford base32 minus the look-alikes 0/O/1/I/L/U."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import stat
from pathlib import Path

logger = logging.getLogger("bridge_service.security")

PEPPER_FILE_NAME = "pepper.key"

# Crockford base32 already excludes I, L, O, U; we also drop 0 and 1 (confusable when read aloud).
PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
PAIRING_CODE_LENGTH = 8
_ALLOWED = frozenset(PAIRING_ALPHABET)


def generate_pairing_code() -> str:
    return "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(PAIRING_CODE_LENGTH))


def normalize_pairing_code(raw: str) -> str | None:
    """Uppercase, drop spaces/dashes. Returns None when it cannot possibly be a valid code."""
    code = raw.strip().upper().replace("-", "").replace(" ", "")
    if len(code) != PAIRING_CODE_LENGTH or not set(code) <= _ALLOWED:
        return None
    return code


def hash_pairing_code(code: str, pepper: bytes) -> str:
    """HMAC-SHA256 keyed with the server pepper (security review L-11).

    A copy of the database alone no longer lets anyone invert an unused 8-symbol code: the pepper
    lives outside the database (BRIDGE_PAIRING_PEPPER or ``pepper.key`` next to the DB file).
    Codes created before this change (plain sha256) simply stop matching — create a new one.
    """
    if not pepper:
        raise ValueError("pairing pepper is required")
    return hmac.new(pepper, b"pairing:" + code.encode("utf-8"), hashlib.sha256).hexdigest()


def pepper_path_for(db_path: str | os.PathLike[str]) -> Path:
    """``pepper.key`` in the database's directory (e.g. data/pepper.key)."""
    return Path(db_path).parent / PEPPER_FILE_NAME


def load_or_create_pepper(path: str | os.PathLike[str]) -> bytes:
    """Read the pepper file, creating it (0600, dir 0700) with 32 random bytes if missing."""
    path = Path(path)
    try:
        return _read_pepper(path)
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="ascii") as fh:
            fh.write(secrets.token_hex(32) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.link(tmp, path)  # atomic and never overwrites a pepper another process just wrote
        except FileExistsError:
            pass
    finally:
        os.unlink(tmp)
    return _read_pepper(path)


def _read_pepper(path: Path) -> bytes:
    with open(path, encoding="ascii") as fh:
        value = fh.read().strip()
    mode = stat.S_IMODE(os.stat(path).st_mode)
    # POSIX permission bits are meaningless on Windows (os.stat reports 0o666 for any writable
    # file; access is governed by ACLs on the user profile), so only warn on POSIX systems.
    if os.name == "posix" and mode & 0o077:
        logger.warning("pepper file is readable by group/others; chmod 600 it", extra={"event": "pepper_perms"})
    if len(value) < 32:
        raise ValueError(f"pepper file {path} is too short or empty")
    return value.encode("ascii")


def resolve_pairing_pepper(configured: str | None, db_path: str | os.PathLike[str]) -> bytes:
    """BRIDGE_PAIRING_PEPPER if set, else the pepper file next to the database."""
    if configured:
        return configured.encode("utf-8")
    return load_or_create_pepper(pepper_path_for(db_path))
