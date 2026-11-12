"""Redaction of sensitive values from logs, audit details and error messages."""

from __future__ import annotations

import logging
import re
from typing import Any

SENSITIVE_KEYS = {
    "password",
    "current_password",
    "new_password",
    "token",
    "access_token",
    "api_key",
    "secret",
    "authorization",
    "cookie",
    "passport_number",
    "passport",
    "date_of_birth",
    "legal_first_name",
    "legal_last_name",
    "frequent_flyer",
    "card_number",
    "cvv",
    "cvc",
    "csrf_token",
}

_PATTERNS = [
    # Invitation tokens in URL paths (legacy /invite/<token> links, API preview path)
    (re.compile(r"(/(?:api/auth/)?invit(?:ations|e)/)[A-Za-z0-9_\-]{10,}"), r"\1[REDACTED]"),
    # Payment card-like numbers (13-19 digits with optional separators)
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[REDACTED_CARD]"),
    # Bearer / API tokens
    (re.compile(r"(?i)bearer\s+[a-z0-9._\-]+"), "Bearer [REDACTED]"),
    (re.compile(r"(?i)(duffel_(?:test|live)_)[a-z0-9_\-]+"), r"\1[REDACTED]"),
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]+"), "[REDACTED_KEY]"),
    # Emails
    (re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"), "[REDACTED_EMAIL]"),
]


def redact_text(text: str | None) -> str | None:
    if text is None:
        return None
    out = text
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    return out


def redact(value: Any, _depth: int = 0) -> Any:
    """Recursively redact dict/list structures by key and by pattern."""
    if _depth > 8:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if str(k).lower() in SENSITIVE_KEYS or str(k).lower().endswith("_enc"):
                out[k] = "[REDACTED]"
            else:
                out[k] = redact(v, _depth + 1)
        return out
    if isinstance(value, list):
        return [redact(v, _depth + 1) for v in value[:100]]
    if isinstance(value, str):
        return redact_text(value)
    return value


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - logging glue
        if isinstance(record.msg, str):
            record.msg = redact_text(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = redact(record.args)
            else:
                record.args = tuple(
                    redact_text(a) if isinstance(a, str) else a for a in record.args
                )
        return True


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if not any(isinstance(f, RedactingFilter) for f in root.filters):
        logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        for handler in root.handlers:
            handler.addFilter(RedactingFilter())
    # uvicorn's loggers do not propagate to root: attach the filter to them directly
    # (the access log contains full request paths).
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, RedactingFilter) for f in logger.filters):
            logger.addFilter(RedactingFilter())
