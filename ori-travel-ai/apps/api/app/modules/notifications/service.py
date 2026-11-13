"""In-app notifications. Used by alerts, booking and invitations."""

from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import NotFoundError
from app.models.alerts import Notification
from app.models.auth import User


def _check_link(link: str | None) -> str | None:
    if link is None:
        return None
    if not link.startswith("/") or link.startswith("//") or "\\" in link or any(c in link for c in "\r\n\t "):
        raise ValueError("Notification link must be a relative in-app path starting with a single '/'")
    return link[:300]


def notify(db: Session, user_id: str, kind: str, title: str, body: str | None = None, link: str | None = None) -> Notification:
    link = _check_link(link)
    n = Notification(user_id=user_id, kind=kind[:32], title=title[:200], body=body, link=link)
    db.add(n)
    db.flush()
    return n


def notify_roles(db: Session, roles: tuple[str, ...], kind: str, title: str, body: str | None = None, link: str | None = None) -> int:
    link = _check_link(link)
    user_ids = list(db.scalars(select(User.id).where(User.role.in_(list(roles)), User.is_active.is_(True))))
    for uid in user_ids:
        notify(db, uid, kind, title, body, link)
    return len(user_ids)


def list_for_user(db: Session, user_id: str, *, unread_only: bool, offset: int, limit: int) -> tuple[list[Notification], int]:
    cond = [Notification.user_id == user_id]
    if unread_only:
        cond.append(Notification.read_at.is_(None))
    total = int(db.scalar(select(func.count()).select_from(Notification).where(*cond)) or 0)
    rows = db.scalars(
        select(Notification).where(*cond).order_by(Notification.created_at.desc(), Notification.id).offset(offset).limit(limit)
    )
    return list(rows), total


def unread_count(db: Session, user_id: str) -> int:
    return int(
        db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None)))
        or 0
    )


def mark_read(db: Session, user_id: str, notification_id: str) -> Notification:
    n = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id))
    if n is None:
        raise NotFoundError("ההתראה לא נמצאה")
    if n.read_at is None:
        n.read_at = utcnow()
    db.commit()
    db.refresh(n)
    return n


def mark_all_read(db: Session, user_id: str) -> int:
    res = db.execute(
        update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None)).values(read_at=utcnow())
    )
    db.commit()
    return res.rowcount or 0
