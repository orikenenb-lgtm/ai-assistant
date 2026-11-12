"""Field-level encryption for sensitive traveler data.

Uses Fernet (AES-128-CBC + HMAC-SHA256) with a key from ``ORI_DATA_KEY``.
Ciphertexts are stored as ``"v1:<token>"`` so the scheme can be rotated.

LOCAL KEY LIMITATION (documented in docs/security/threat-model.md): in local
development the key lives in ``apps/api/.env`` on the same disk as the SQLite
database. This protects against leaking the DB file alone (backups, sharing),
not against an attacker with full access to the machine. A production setup
should keep the key in an OS keychain / secrets manager.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

PREFIX = "v1:"


class EncryptionUnavailableError(RuntimeError):
    """Raised when sensitive data must be stored but no key is configured."""


class DecryptionError(RuntimeError):
    pass


def generate_key() -> str:
    return Fernet.generate_key().decode("ascii")


def _fernet() -> Fernet:
    key = get_settings().data_key
    if not key:
        raise EncryptionUnavailableError(
            "ORI_DATA_KEY is not configured; sensitive traveler data cannot be stored"
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError) as exc:  # malformed key
        raise EncryptionUnavailableError("ORI_DATA_KEY is malformed") from exc


def encryption_available() -> bool:
    try:
        _fernet()
    except EncryptionUnavailableError:
        return False
    return True


def encrypt_str(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return PREFIX + _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_str(value: str | None) -> str | None:
    if value is None:
        return None
    if not value.startswith(PREFIX):
        raise DecryptionError("Unknown ciphertext format")
    try:
        return _fernet().decrypt(value[len(PREFIX) :].encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise DecryptionError("Ciphertext could not be decrypted (wrong key?)") from exc


def mask(value: str | None, visible: int = 3) -> str | None:
    """Mask a sensitive value for display, e.g. passport 'XXXXX123'."""
    if not value:
        return None
    if len(value) <= visible:
        return "•" * len(value)
    return "•" * (len(value) - visible) + value[-visible:]
