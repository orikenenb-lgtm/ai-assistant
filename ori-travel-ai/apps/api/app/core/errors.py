"""Structured API errors.

Every error response has the shape::

    {"error": {"code": "NOT_FOUND", "message": "<Hebrew message>",
               "details": [...] | null, "request_id": "..."}}
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("ori.errors")


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"
    default_message = "הבקשה אינה תקינה"

    def __init__(self, message: str | None = None, *, details: Any = None, code: str | None = None):
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        self.details = details
        if code:
            self.code = code


class BadRequestError(AppError):
    pass


class UnauthorizedError(AppError):
    status_code = 401
    code = "UNAUTHORIZED"
    default_message = "נדרשת התחברות"


class ForbiddenError(AppError):
    status_code = 403
    code = "FORBIDDEN"
    default_message = "אין לך הרשאה לפעולה זו"


class NotFoundError(AppError):
    status_code = 404
    code = "NOT_FOUND"
    default_message = "הפריט לא נמצא"


class ConflictError(AppError):
    status_code = 409
    code = "CONFLICT"
    default_message = "הפעולה מתנגשת במצב הנוכחי"


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    default_message = "יותר מדי בקשות. נסו שוב בעוד מספר דקות"


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"
    default_message = "השירות אינו זמין כרגע"


_STATUS_CODES = {
    400: ("BAD_REQUEST", "הבקשה אינה תקינה"),
    401: ("UNAUTHORIZED", "נדרשת התחברות"),
    403: ("FORBIDDEN", "אין לך הרשאה לפעולה זו"),
    404: ("NOT_FOUND", "הנתיב או הפריט לא נמצאו"),
    405: ("METHOD_NOT_ALLOWED", "שיטת הבקשה אינה נתמכת"),
    409: ("CONFLICT", "הפעולה מתנגשת במצב הנוכחי"),
    413: ("PAYLOAD_TOO_LARGE", "הבקשה גדולה מדי"),
    429: ("RATE_LIMITED", "יותר מדי בקשות"),
}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def error_body(code: str, message: str, details: Any, request: Request) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": _request_id(request),
        }
    }


def _clean_validation_errors(errors: list[dict]) -> list[dict]:
    cleaned = []
    for e in errors:
        if e.get("type") == "json_invalid":
            # loc holds a character offset, not a field name
            cleaned.append({"field": "", "message": "גוף הבקשה אינו JSON תקין", "type": "json_invalid"})
            continue
        loc = [str(p) for p in e.get("loc", []) if p not in ("body",)]
        cleaned.append({"field": ".".join(loc), "message": e.get("msg", ""), "type": e.get("type")})
    return cleaned


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.details, request),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=error_body(
                "VALIDATION_ERROR",
                "חלק מהשדות אינם תקינים",
                _clean_validation_errors(list(exc.errors())),
                request,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        code, msg = _STATUS_CODES.get(exc.status_code, ("HTTP_ERROR", "שגיאה"))
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, msg, None, request),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):  # pragma: no cover - safety net
        log.exception("Unhandled error (request_id=%s)", _request_id(request))
        return JSONResponse(
            status_code=500,
            content=error_body("INTERNAL_ERROR", "אירעה שגיאה פנימית", None, request),
        )
