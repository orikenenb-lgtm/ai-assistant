"""HTTP middleware: request id, security headers, origin check, body size limit."""

from __future__ import annotations

import logging
import time
import uuid
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings

log = logging.getLogger("ori.http")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
MAX_BODY_BYTES = 1_000_000  # 1 MB is plenty for JSON APIs


def _error(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": None, "request_id": request_id}},
        headers={"X-Request-ID": request_id},
    )


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if 8 <= len(incoming) <= 64 and incoming.isalnum() else uuid.uuid4().hex
        request.state.request_id = request_id

        if request.url.path.startswith("/api/"):
            # Body size limit (declared length)
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
                return _error(413, "PAYLOAD_TOO_LARGE", "הבקשה גדולה מדי", request_id)

            # Origin check for state-changing requests (CSRF defence in depth).
            if request.method not in SAFE_METHODS:
                origin = request.headers.get("origin")
                if origin and not _origin_allowed(origin, request):
                    return _error(403, "ORIGIN_REJECTED", "מקור הבקשה אינו מורשה", request_id)
                ctype = request.headers.get("content-type", "")
                has_body = (length and length != "0") or request.headers.get("transfer-encoding")
                if has_body and not ctype.startswith("application/json"):
                    return _error(415, "UNSUPPORTED_MEDIA_TYPE", "יש לשלוח JSON בלבד", request_id)

        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        response.headers["X-Request-ID"] = request_id
        _apply_security_headers(request, response)
        if request.url.path.startswith("/api/"):
            log.info("%s %s -> %s (%sms)", request.method, request.url.path, response.status_code, elapsed_ms)
        return response


def _origin_allowed(origin: str, request: Request) -> bool:
    settings = get_settings()
    if origin in settings.cors_origin_list:
        return True
    # Same-origin requests (web app served by FastAPI itself)
    host = request.headers.get("host")
    parsed = urlsplit(origin)
    return bool(host) and parsed.netloc == host


def _apply_security_headers(request: Request, response: Response) -> None:
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if request.url.path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")
        if not request.url.path.startswith("/api/docs"):
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    else:
        # Web app: allow self + OpenStreetMap tiles (map is opt-in in settings)
        h.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; "
            "font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
