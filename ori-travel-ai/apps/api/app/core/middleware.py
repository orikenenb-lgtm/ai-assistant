"""HTTP middleware: request id, security headers, origin check, body size limit."""

from __future__ import annotations

import json
import logging
import time
import uuid
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.redaction import redact_text

log = logging.getLogger("ori.http")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
MAX_BODY_BYTES = 1_000_000  # 1 MB is plenty for JSON APIs


def _error(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": None, "request_id": request_id}},
        headers={"X-Request-ID": request_id},
    )


class BodySizeLimitMiddleware:
    """Enforce the body size limit on the bytes actually received.

    ``Content-Length`` alone is not enough: a chunked request has no length
    header. For API requests the body is buffered (bounded by the limit) and
    replayed to the application; anything larger is rejected with 413.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await self._reject(send)
                return
        messages: list[Message] = []
        total = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                messages.append(message)
                break
            total += len(message.get("body", b""))
            if total > self.max_bytes:
                await self._reject(send)
                return
            messages.append(message)
            more = message.get("more_body", False)

        async def replay() -> Message:
            if messages:
                return messages.pop(0)
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = json.dumps(
            {"error": {"code": "PAYLOAD_TOO_LARGE", "message": "הבקשה גדולה מדי", "details": None, "request_id": None}},
            ensure_ascii=False,
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if 8 <= len(incoming) <= 64 and incoming.isalnum() else uuid.uuid4().hex
        request.state.request_id = request_id

        if request.url.path.startswith("/api/"):
            # Origin check for state-changing requests (CSRF defence in depth).
            if request.method not in SAFE_METHODS:
                origin = request.headers.get("origin")
                if origin and not _origin_allowed(origin, request):
                    return _error(403, "ORIGIN_REJECTED", "מקור הבקשה אינו מורשה", request_id)
                ctype = request.headers.get("content-type", "")
                length = request.headers.get("content-length")
                has_body = (length and length != "0") or request.headers.get("transfer-encoding")
                if has_body and not ctype.startswith("application/json"):
                    return _error(415, "UNSUPPORTED_MEDIA_TYPE", "יש לשלוח JSON בלבד", request_id)

        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        response.headers["X-Request-ID"] = request_id
        _apply_security_headers(request, response)
        if request.url.path.startswith("/api/"):
            # Paths can carry secrets (e.g. legacy invitation links) — always redact.
            log.info(
                "%s %s -> %s (%sms)", request.method, redact_text(request.url.path), response.status_code, elapsed_ms
            )
        return response


def _origin_allowed(origin: str, request: Request) -> bool:
    settings = get_settings()
    if origin in settings.cors_origin_list:
        return True
    # Same-origin requests (web app served by FastAPI itself). The Host header is
    # validated by TrustedHostMiddleware (ORI_ALLOWED_HOSTS), so it can be trusted here.
    host = request.headers.get("host")
    parsed = urlsplit(origin)
    return bool(host) and parsed.netloc == host


OSM_TILE_SOURCES = "https://tile.openstreetmap.org https://*.tile.openstreetmap.org"


def _apply_security_headers(request: Request, response: Response) -> None:
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if get_settings().cookie_secure:
        # Only meaningful (and only sent) when the app is served over HTTPS
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.url.path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")
        if not request.url.path.startswith("/api/docs"):
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    else:
        # Web app: allow self + OpenStreetMap tiles (map is opt-in in settings)
        h.setdefault(
            "Content-Security-Policy",
            f"default-src 'self'; img-src 'self' data: {OSM_TILE_SOURCES}; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; "
            "font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
