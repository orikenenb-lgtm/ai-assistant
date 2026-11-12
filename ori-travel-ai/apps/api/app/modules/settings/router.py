"""Family settings API (contract 3.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_editor, require_owner
from app.modules.settings import service
from app.modules.settings.schemas import (
    DisplaySettings,
    EnabledToggle,
    RankingWeights,
    RetentionRunOut,
    RetentionSettings,
    SettingsOut,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def get_settings_all(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.get_all(db)


@router.put("/ranking-weights", response_model=SettingsOut)
def put_weights(body: RankingWeights, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    return service.update_setting(db, ctx.user_id, "ranking_weights", body.model_dump(), request)


@router.put("/scheduler", response_model=SettingsOut)
def put_scheduler(body: EnabledToggle, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    return service.update_setting(db, ctx.user_id, "scheduler", body.model_dump(), request)


@router.put("/map", response_model=SettingsOut)
def put_map(body: EnabledToggle, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    return service.update_setting(db, ctx.user_id, "map", body.model_dump(), request)


@router.put("/display", response_model=SettingsOut)
def put_display(body: DisplaySettings, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    return service.update_setting(db, ctx.user_id, "display", body.model_dump(), request)


@router.put("/retention", response_model=SettingsOut)
def put_retention(body: RetentionSettings, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    return service.update_setting(db, ctx.user_id, "retention", body.model_dump(), request)


@router.post("/retention/run", response_model=RetentionRunOut)
def run_retention(request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    return service.run_retention(db, ctx.user_id, request)
