"""Audit log viewer (owner only). Details are redacted at write time."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, require_owner
from app.models.auth import User
from app.models.system import AuditEvent
from app.modules.audit.schemas import AuditEventOut
from app.schemas.common import Page

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=Page[AuditEventOut])
def list_audit(
    action: str | None = Query(None, max_length=64),
    actor_user_id: str | None = Query(None, max_length=32),
    entity_type: str | None = Query(None, max_length=64),
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100),
    ctx: AuthContext = Depends(require_owner),
    db: Session = Depends(get_db),
):
    cond = []
    if action:
        cond.append(AuditEvent.action == action)
    if actor_user_id:
        cond.append(AuditEvent.actor_user_id == actor_user_id)
    if entity_type:
        cond.append(AuditEvent.entity_type == entity_type)
    total = int(db.scalar(select(func.count()).select_from(AuditEvent).where(*cond)) or 0)
    rows = db.execute(
        select(AuditEvent, User.display_name)
        .outerjoin(User, User.id == AuditEvent.actor_user_id)
        .where(*cond)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = []
    for ev, name in rows:
        out = AuditEventOut.model_validate(ev)
        out.actor_display_name = name
        items.append(out)
    return Page[AuditEventOut](items=items, total=total, page=page, page_size=page_size)
