"""FastAPI application factory for Ori Travel AI."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from app.core.redaction import configure_logging
from app.modules.ai.router import router as ai_router
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.booking.router import router as booking_router
from app.modules.comparison.router import router as comparison_router
from app.modules.family.router import router as family_router
from app.modules.health.router import router as health_router
from app.modules.itineraries.router import router as itineraries_router
from app.modules.notifications.router import router as notifications_router
from app.modules.price_tracking import scheduler
from app.modules.price_tracking.router import router as price_tracking_router
from app.modules.providers.router import router as providers_router
from app.modules.saved.router import router as saved_router
from app.modules.search.router import router as search_router
from app.modules.settings.router import router as settings_router
from app.modules.travelers.router import router as travelers_router

ROUTERS = [
    health_router,
    auth_router,
    family_router,
    travelers_router,
    providers_router,
    search_router,
    comparison_router,
    itineraries_router,
    saved_router,
    price_tracking_router,
    notifications_router,
    booking_router,
    ai_router,
    audit_router,
    settings_router,
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if not settings.is_test:
        scheduler.maybe_start()
    try:
        yield
    finally:
        scheduler.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    problems = settings.production_problems()
    if problems:
        raise RuntimeError("Refusing to start with unsafe production settings: " + "; ".join(problems))
    app = FastAPI(
        title="Ori Travel AI API",
        version="1.0.0",
        description="Private, family-only travel discovery, comparison, itinerary and booking-preparation API.",
        docs_url="/api/docs" if settings.env != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.env != "production" else None,
        lifespan=lifespan,
    )
    install_error_handlers(app)
    app.add_middleware(RequestContextMiddleware)
    # Middleware added later runs first: body-size limit, then Host validation, then CORS.
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_host_list)
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
        )
    for r in ROUTERS:
        app.include_router(r)

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(path: str):
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "NOT_FOUND", "message": "הנתיב לא נמצא", "details": None, "request_id": None}},
        )

    _mount_web(app, settings.web_dist_dir if settings.serve_web else None)
    return app


def _mount_web(app: FastAPI, dist_dir: str | None) -> None:
    """Serve the built SPA (apps/web/dist) with client-side routing fallback."""
    if not dist_dir:
        return
    dist = Path(dist_dir)
    index = dist / "index.html"
    if not index.is_file():
        return
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
