"""Device tokens: 32 random bytes (base64url), stored only as sha256 hex."""

from __future__ import annotations

import hashlib
import hmac
import secrets

TOKEN_BYTES = 32
MAX_TOKEN_CHARS = 256


def generate_device_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def generate_device_id() -> str:
    return "dev_" + secrets.token_hex(8)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def token_matches(token: str, stored_sha256: str) -> bool:
    """Constant-time comparison of a presented token against a stored hash."""
    return hmac.compare_digest(sha256_hex(token).encode("ascii"), stored_sha256.encode("ascii"))
