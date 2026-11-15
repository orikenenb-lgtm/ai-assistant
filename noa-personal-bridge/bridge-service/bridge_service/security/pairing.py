"""One-time pairing codes: 8 symbols from Crockford base32 minus the look-alikes 0/O/1/I/L/U."""

from __future__ import annotations

import secrets

from bridge_service.security.tokens import sha256_hex

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


def hash_pairing_code(code: str) -> str:
    return sha256_hex("pairing:" + code)
