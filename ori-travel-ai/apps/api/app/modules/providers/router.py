"""Providers API: status list, health checks, owner configuration, diagnostics."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_editor, require_owner
from app.core.ratelimit import limiter
from app.modules.providers import registry, service
from app.modules.providers.base import ProviderHealth
from app.modules.providers.schemas import DiagnosticsOut, ProviderConfigIn, ProviderStatusOut

router = APIRouter(tags=["providers"])

HEALTH_CHECK_LIMIT = 10
HEALTH_CHECK_WINDOW_SECONDS = 300


@router.get("/api/providers", response_model=list[ProviderStatusOut])
def list_providers(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)) -> list[ProviderStatusOut]:
    return service.list_statuses(db)


@router.get("/api/providers/diagnostics", response_model=DiagnosticsOut)
def provider_diagnostics(
    days: int = Query(30, ge=1, le=365),
    ctx: AuthContext = Depends(require_editor),
    db: Session = Depends(get_db),
) -> DiagnosticsOut:
    return service.diagnostics(db, days)


@router.get("/api/providers/{provider_id}", response_model=ProviderStatusOut)
def get_provider(provider_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    adapter = registry.get_adapter(provider_id)
    cfg = registry.get_config(db, provider_id)
    db.commit()
    return service.status_for(db, adapter, cfg, service.last_run_statuses(db).get(provider_id))


@router.post("/api/providers/{provider_id}/health-check", response_model=ProviderHealth)
def provider_health_check(
    provider_id: str, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
) -> ProviderHealth:
    registry.get_adapter(provider_id)
    limiter.check(
        f"provider-health:{ctx.user_id}",
        HEALTH_CHECK_LIMIT,
        HEALTH_CHECK_WINDOW_SECONDS,
        "יותר מדי בדיקות תקינות — נסו שוב בעוד מספר דקות",
    )
    result = service.health_check(db, provider_id)
    db.commit()
    return result


@router.put("/api/providers/{provider_id}", response_model=ProviderStatusOut)
def update_provider(
    provider_id: str,
    body: ProviderConfigIn,
    request: Request,
    ctx: AuthContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> ProviderStatusOut:
    return service.update_config(
        db, provider_id, enabled=body.enabled, settings=body.settings, user_id=ctx.user_id, request=request
    )
