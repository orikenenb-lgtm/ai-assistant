"""App factory. ``uvicorn bridge_service.main:app`` or ``python -m bridge_service.main``."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from bridge_service import __version__
from bridge_service.ai.base import DraftEngine
from bridge_service.api.errors import ApiError, error_response
from bridge_service.api.middleware import BridgeMiddleware
from bridge_service.api.routes import router
from bridge_service.api.state import BridgeState
from bridge_service.config import Settings, get_settings
from bridge_service.security.pairing import resolve_pairing_pepper
from bridge_service.storage.db import Database

logger = logging.getLogger("bridge_service")


def _build_engine(settings: Settings) -> DraftEngine:
    # Imported lazily so the HTTP layer (and its tests) never depends on the AI package internals.
    from bridge_service.ai.factory import create_engine

    return create_engine(settings)


def create_app(settings: Settings | None = None, engine: DraftEngine | None = None) -> FastAPI:
    settings = settings or get_settings()
    db = Database(settings.db_path)
    db.migrate()
    # Retention (security review L-10): drop long-revoked devices and dead pairing codes.
    purged = db.purge()
    if purged.devices or purged.pairing_codes:
        logger.info(
            "retention purge",
            extra={"event": "purge", "devices": purged.devices, "pairing_codes": purged.pairing_codes},
        )
    pepper = resolve_pairing_pepper(settings.pairing_pepper, settings.db_path)
    engine = engine if engine is not None else _build_engine(settings)
    state = BridgeState.build(settings, db, engine, pepper)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "bridge started",
            extra={"event": "startup", "engine": state.engine_name},
        )
        try:
            yield
        finally:
            try:
                await state.engine.aclose()
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "engine close failed",
                    extra={"event": "shutdown", "exc_type": type(exc).__name__},
                )

    docs = settings.debug_docs
    app = FastAPI(
        title="NOA Personal Bridge",
        version=__version__,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.state.bridge = state

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.code, headers=exc.headers, message=exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response("invalid_request")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed", 413: "too_large"}.get(
            exc.status_code, "invalid_request"
        )
        return error_response(code)

    app.include_router(router)
    # No CORS middleware on purpose: the only client is a native app.
    app.add_middleware(BridgeMiddleware, max_body_bytes=settings.max_body_bytes)
    return app


def __getattr__(name: str) -> Any:
    """``bridge_service.main:app`` is built on first access, not at import time."""
    if name == "app":
        from bridge_service.logging_setup import configure_logging

        settings = get_settings()
        configure_logging(settings.log_level)
        application = create_app(settings)
        globals()["app"] = application
        return application
    raise AttributeError(name)


def run() -> None:
    import uvicorn

    settings = get_settings()
    from bridge_service.logging_setup import configure_logging

    configure_logging(settings.log_level)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        access_log=settings.access_log,
        log_config=None,  # keep our JSON root handler
        server_header=False,
        proxy_headers=False,  # client IP handling lives in security.auth.client_ip
    )


if __name__ == "__main__":
    run()
