"""Structured, content-free logging.

Two layers of defence:
1. Allow-list formatter: only a fixed set of metadata attributes is ever serialised.
2. Redaction filter: strips any record attribute (or dict-style args key) whose name suggests
   message content or credentials, so even a careless ``logger.info(..., extra={"text": ...})``
   never reaches a handler.
Exceptions are reduced to their class name — no message, no traceback (both may echo content).
"""

from __future__ import annotations

import json
import logging
import time

FORBIDDEN_ATTRS = frozenset(
    {
        "text",
        "messages",
        "draft_text",
        "sender_display_name",
        "authorization",
        "device_token",
        "pairing_code",
        "body",
    }
)

SAFE_EXTRA_ATTRS = (
    "event",
    "method",
    "path",
    "status",
    "latency_ms",
    "device",
    "request_id",
    "error",
    "exc_type",
    "engine",
)

REDACTED = "[redacted]"


class RedactionFilter(logging.Filter):
    """Strips forbidden attributes from a record. Never drops the record itself."""

    def filter(self, record: logging.LogRecord) -> bool:
        for name in FORBIDDEN_ATTRS:
            if name in record.__dict__:
                delattr(record, name)
                record.redacted = True
        args = record.args
        if isinstance(args, dict) and FORBIDDEN_ATTRS.intersection(args):
            record.args = {k: (REDACTED if k in FORBIDDEN_ATTRS else v) for k, v in args.items()}
            record.redacted = True
        if record.exc_info and record.exc_info[0] is not None:
            record.exc_type = record.exc_info[0].__name__
            record.exc_info = None
            record.exc_text = None
        record.stack_info = None
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for name in SAFE_EXTRA_ATTRS:
            value = record.__dict__.get(name)
            if value is not None:
                payload[name] = value
        if record.exc_info and record.exc_info[0] is not None:
            payload["exc_type"] = record.exc_info[0].__name__
        if getattr(record, "redacted", False):
            payload["redacted"] = True
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Install one JSON stderr handler on the root logger (idempotent)."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_bridge_handler", False):
            root.removeHandler(handler)
    handler = logging.StreamHandler()
    handler._bridge_handler = True  # type: ignore[attr-defined]
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactionFilter())
    root.addHandler(handler)
    root.setLevel(level.upper())
    # Third-party loggers that could print URLs/bodies at debug level.
    for noisy in ("httpx", "httpcore", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def device_prefix(device_id: str | None) -> str | None:
    """Short, non-reversible-enough handle for log correlation (never the token)."""
    if not device_id:
        return None
    return device_id[:8]
