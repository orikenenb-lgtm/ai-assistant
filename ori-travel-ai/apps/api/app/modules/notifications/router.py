"""Notifications API (contract 3.2). Users only ever see their own."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user
from app.modules.notifications import service
from app.modules.notifications.schemas import NotificationOut, ReadAllOut, UnreadCount
from app.schemas.common import Page

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100),
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
):
    items, total = service.list_for_user(db, ctx.user_id, unread_only=unread_only, offset=(page - 1) * page_size, limit=page_size)
    return Page[NotificationOut](
        items=[NotificationOut.model_validate(i) for i in items], total=total, page=page, page_size=page_size
    )


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return UnreadCount(count=service.unread_count(db, ctx.user_id))


@router.post("/read-all", response_model=ReadAllOut)
def read_all(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return ReadAllOut(updated=service.mark_all_read(db, ctx.user_id))


@router.post("/{notification_id}/read", response_model=NotificationOut)
def read_one(notification_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return NotificationOut.model_validate(service.mark_read(db, ctx.user_id, notification_id))
