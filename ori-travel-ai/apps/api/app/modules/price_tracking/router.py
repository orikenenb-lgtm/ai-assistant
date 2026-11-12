"""Price alerts (contract 3.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_editor
from app.core.errors import ConflictError
from app.core.ratelimit import limiter
from app.modules.price_tracking import service
from app.modules.price_tracking.schemas import AlertCreate, AlertOut, AlertUpdate, CheckOut, SnapshotOut
from app.schemas.common import OkResponse

router = APIRouter(prefix="/api/alerts", tags=["price_tracking"])

MANUAL_CHECK_COOLDOWN_SECONDS = 300


@router.get("", response_model=list[AlertOut])
def list_alerts(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.list_alerts(db, ctx.user)


@router.post("", response_model=AlertOut, status_code=201)
def create_alert(body: AlertCreate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    alert = service.create_alert(db, ctx.user, body, request)
    return service.alert_out(db, alert, ctx.user.display_name)


@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert(
    alert_id: str, body: AlertUpdate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    alert = service.update_alert(db, ctx.user, service.get_alert_for(db, ctx.user, alert_id), body, request)
    return service.alert_out(db, alert)


@router.delete("/{alert_id}", response_model=OkResponse)
def delete_alert(alert_id: str, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    service.delete_alert(db, ctx.user, service.get_alert_for(db, ctx.user, alert_id), request)
    return OkResponse()


@router.post("/{alert_id}/check", response_model=CheckOut)
def check_alert(alert_id: str, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    alert = service.get_alert_for(db, ctx.user, alert_id)
    if not alert.is_active:
        raise ConflictError("ההתראה מושבתת — הפעילו אותה כדי לבדוק מחיר", code="ALERT_INACTIVE")
    limiter.check(
        f"alert-check:{alert.id}",
        1,
        MANUAL_CHECK_COOLDOWN_SECONDS,
        "ניתן לבדוק התראה ידנית פעם אחת כל 5 דקות. נסו שוב מאוחר יותר",
    )
    result = service.check_alert(db, alert)
    return CheckOut(
        status=result.status,
        best_offer=result.best_offer,
        triggered=result.triggered,
        target_reached=result.target_reached,
        snapshot=service.snapshot_out(result.snapshot) if result.snapshot else None,
        alert=service.alert_out(db, result.alert),
    )


@router.get("/{alert_id}/snapshots", response_model=list[SnapshotOut])
def alert_snapshots(alert_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.list_snapshots(db, service.get_alert_for(db, ctx.user, alert_id))
