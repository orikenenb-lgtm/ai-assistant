"""Password hashing and opaque token helpers."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # Argon2id with library defaults

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256

# A valid hash used to equalise timing when the user does not exist.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing-equalisation")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """Constant-ish time verification; returns False for unknown users too."""
    target = password_hash or _DUMMY_HASH
    try:
        ok = _hasher.verify(target, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return ok and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# A small offline list of very common passwords / patterns (lower-case, compared after normalisation)
_COMMON_PASSWORDS = frozenset(
    {
        "password", "password1", "password123", "passw0rd", "qwerty", "qwerty123", "qwertyuiop",
        "123456", "1234567", "12345678", "123456789", "1234567890", "111111", "000000", "abc123",
        "iloveyou", "letmein", "welcome", "admin", "admin123", "monkey", "dragon", "football",
        "sunshine", "princess", "shalom", "israel", "israel123", "telaviv", "jerusalem",
    }
)


def validate_password_strength(password: str) -> str | None:
    """Return a Hebrew error message, or None when the password is acceptable.

    Rules: at least 10 characters; at least 3 of 4 character classes (lower, upper,
    digit, symbol) — or a long passphrase of 16+ characters; no single character may
    make up half of the password; not a common password.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"הסיסמה חייבת להכיל לפחות {MIN_PASSWORD_LENGTH} תווים"
    if len(password) > MAX_PASSWORD_LENGTH:
        return "הסיסמה ארוכה מדי"
    classes = sum(
        [
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() for c in password),
        ]
    )
    if classes < 3 and len(password) < 16:
        return "הסיסמה צריכה לשלב לפחות שלושה סוגי תווים (אותיות קטנות, גדולות, ספרות, סימנים) — או להיות משפט סיסמה של 16 תווים ומעלה"
    most_common = max(password.count(c) for c in set(password))
    if most_common * 2 >= len(password):
        return "הסיסמה חוזרת על אותו תו יותר מדי פעמים"
    normalized = "".join(c for c in password.lower() if c.isalnum())
    if normalized in _COMMON_PASSWORDS or password.lower() in _COMMON_PASSWORDS:
        return "זו סיסמה נפוצה מדי — בחרו סיסמה אחרת"
    return None


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
