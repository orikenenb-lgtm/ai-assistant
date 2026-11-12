"""Small, safe HTTP helper shared by the LIVE adapters.

Guarantees:

* Only hard-coded ``https://`` base URLs; request paths are built by the adapter
  from constants and validated identifiers (never from user-controlled URLs) so
  there is no SSRF surface. Redirects are not followed.
* Response bodies are read incrementally and rejected above ``MAX_RESPONSE_BYTES``.
* Errors are mapped to ``ProviderError`` subclasses with user-safe Hebrew
  messages. Headers, tokens and raw bodies never end up in messages or logs.
* ``transport`` can be injected (``httpx.MockTransport``) so tests never touch
  the network.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import quote

import httpx

from app.modules.providers.base import (
    ProviderError,
    ProviderNotConfiguredError,
    ProviderRateLimitedError,
    ProviderTimeoutError,
)

log = logging.getLogger("ori.providers.live")

MAX_RESPONSE_BYTES = 8 * 1024 * 1024
USER_AGENT = "OriTravelAI/0.1 (private family travel planner; +provider-integration)"
_SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")
_SAFE_CODE = re.compile(r"^[a-z0-9_]{1,50}$")
MAX_RETRY_AFTER_SECONDS = 3600

MSG_BAD_RESPONSE = "תשובת הספק אינה תקינה — לא ניתן לעבד אותה"
MSG_TOO_LARGE = "תשובת הספק גדולה מדי ולכן נדחתה"
MSG_TIMEOUT = "הספק לא הגיב בזמן"
MSG_NETWORK = "לא ניתן להתחבר לספק כרגע"
MSG_SERVER = "הספק מחזיר שגיאת שרת זמנית"
MSG_REJECTED = "הספק דחה את פרטי הבקשה"


@dataclass
class HttpResult:
    status: int
    headers: Mapping[str, str]
    data: dict[str, Any]


def safe_identifier(value: object) -> str:
    """Validate an identifier that is interpolated into a URL path."""
    if not isinstance(value, str) or not _SAFE_ID.match(value):
        raise ProviderError("מזהה ההצעה אינו תקין", code="BAD_IDENTIFIER")
    return quote(value, safe="")


def parse_retry_after(headers: Mapping[str, str], *, now: datetime | None = None) -> int | None:
    """Seconds to wait before retrying.

    Reads ``Retry-After`` / ``ratelimit-reset`` which may be delta-seconds or an HTTP-date.
    """
    for name in ("retry-after", "ratelimit-reset", "x-ratelimit-reset"):
        raw = headers.get(name)
        if raw is None:
            continue
        text = str(raw).strip()
        try:
            value = int(float(text))
        except ValueError:
            try:
                when = parsedate_to_datetime(text)
            except (TypeError, ValueError):
                continue
            if when.tzinfo is None:
                when = when.replace(tzinfo=UTC)
            value = int((when - (now or datetime.now(UTC))).total_seconds())
        return max(0, min(value, MAX_RETRY_AFTER_SECONDS))
    return None


def _error_code(body: dict[str, Any] | None) -> str | None:
    """First provider error code (``errors[0].code``), only when it is a short slug."""
    try:
        code = body["errors"][0]["code"]  # type: ignore[index]
    except (TypeError, KeyError, IndexError):
        return None
    return code if isinstance(code, str) and _SAFE_CODE.match(code) else None


class LiveHttp:
    """Synchronous JSON client for one provider (one base URL, fixed headers)."""

    def __init__(
        self,
        *,
        provider_label: str,
        base_url: str,
        headers: Mapping[str, str],
        timeout_seconds: float,
        transport: httpx.BaseTransport | None = None,
        max_bytes: int = MAX_RESPONSE_BYTES,
    ) -> None:
        if not base_url.startswith("https://"):
            raise ValueError("live providers must use https base URLs")
        self.provider_label = provider_label
        self.base_url = base_url.rstrip("/")
        self._headers = {**headers, "User-Agent": USER_AGENT}
        t = max(0.05, float(timeout_seconds))
        self._timeout = httpx.Timeout(t, connect=min(t, 5.0))
        self._transport = transport
        self._max_bytes = max_bytes

    def __enter__(self) -> LiveHttp:
        self._client = httpx.Client(
            base_url=self.base_url,
            headers=self._headers,
            timeout=self._timeout,
            transport=self._transport,
            follow_redirects=False,
        )
        return self

    def __exit__(self, *exc: object) -> None:
        self._client.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json_body: Any | None = None,
        allow_404: bool = False,
    ) -> HttpResult:
        if not path.startswith("/") or "://" in path or "//" in path or ".." in path:
            raise ProviderError("בקשה לא תקינה", code="BAD_PATH")
        try:
            with self._client.stream(method, path, params=params, json=json_body) as resp:
                status = resp.status_code
                headers = {k.lower(): v for k, v in resp.headers.items()}
                body = self._read_limited(resp)
        except httpx.TimeoutException as exc:
            log.warning("provider=%s request timed out (%s)", self.provider_label, type(exc).__name__)
            raise ProviderTimeoutError(MSG_TIMEOUT, retryable=True) from None
        except httpx.HTTPError as exc:
            log.warning("provider=%s transport error (%s)", self.provider_label, type(exc).__name__)
            raise ProviderError(MSG_NETWORK, code="NETWORK_ERROR", retryable=True) from None

        parsed = self._parse_json(body) if body else None
        if status >= 400:
            if status == 404 and allow_404:
                return HttpResult(status, headers, parsed if isinstance(parsed, dict) else {})
            self._raise_for_status(status, headers, parsed if isinstance(parsed, dict) else None)
        if status in (301, 302, 303, 307, 308):
            raise ProviderError(MSG_BAD_RESPONSE, code="BAD_RESPONSE")
        if not isinstance(parsed, dict):
            raise ProviderError(MSG_BAD_RESPONSE, code="BAD_RESPONSE")
        return HttpResult(status, headers, parsed)

    # ---- internals ----
    def _read_limited(self, resp: httpx.Response) -> bytes:
        declared = resp.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > self._max_bytes:
            raise ProviderError(MSG_TOO_LARGE, code="RESPONSE_TOO_LARGE")
        chunks: list[bytes] = []
        size = 0
        for chunk in resp.iter_bytes():
            size += len(chunk)
            if size > self._max_bytes:
                raise ProviderError(MSG_TOO_LARGE, code="RESPONSE_TOO_LARGE")
            chunks.append(chunk)
        return b"".join(chunks)

    @staticmethod
    def _parse_json(body: bytes) -> Any:
        try:
            return json.loads(body)
        except (ValueError, RecursionError):
            return None

    def _raise_for_status(self, status: int, headers: Mapping[str, str], body: dict[str, Any] | None) -> None:
        code = _error_code(body)
        label = self.provider_label
        log.warning("provider=%s http_status=%s error_code=%s", label, status, code)
        if status == 401:
            raise ProviderNotConfiguredError(
                "הספק דחה את פרטי הגישה — בדקו את מפתח ה-API ואת סביבת העבודה", code="AUTH_FAILED"
            )
        if status == 403:
            raise ProviderError("אין הרשאה לביצוע הפעולה אצל הספק — בדקו את הרשאות החשבון", code="FORBIDDEN")
        if status == 429:
            wait = parse_retry_after(headers)
            suffix = f" (נסו שוב בעוד כ-{wait} שניות)" if wait is not None else ""
            exc = ProviderRateLimitedError(f"הספק הגביל זמנית את קצב הבקשות{suffix}", retryable=True)
            exc.retry_after_seconds = wait  # type: ignore[attr-defined]
            raise exc
        if status in (400, 422):
            raise ProviderError(MSG_REJECTED, code="VALIDATION_ERROR")
        if status == 404:
            raise ProviderError("הפריט המבוקש לא נמצא אצל הספק", code="NOT_FOUND")
        if status >= 500:
            raise ProviderError(MSG_SERVER, code="UPSTREAM_ERROR", retryable=True)
        raise ProviderError("הספק החזיר תשובה בלתי צפויה", code="UPSTREAM_ERROR")
