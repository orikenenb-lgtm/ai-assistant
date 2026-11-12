"""Family settings + server flags, and the data-retention purge."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from app.core.app_settings import get_setting, set_setting
from app.core.audit import record_audit
from app.core.config import get_settings
from app.core.crypto import encryption_available
from app.core.db import utcnow
from app.models.alerts import Notification
from app.models.auth import AuthSession, Invitation
from app.models.booking import BookingIntent
from app.models.search import Offer, PriceSnapshot, SavedOffer, SearchRequest
from app.models.system import AuditEvent
from app.models.trips import TripItem
from app.modules.settings.schemas import AiOut, BookingOut, RetentionRunOut, SchedulerOut, SettingsOut


def _ai_section() -> AiOut:
    s = get_settings()
    provider = s.ai_provider
    if provider == "anthropic":
        configured = bool(s.anthropic_api_key)
        model: str | None = s.anthropic_model
    elif provider == "ollama":
        configured = True
        model = s.ollama_model
    else:
        configured = False
        model = None
    return AiOut(provider=provider, configured=configured, model=model, paid_allowed=s.ai_allow_paid)


def get_all(db: Session) -> SettingsOut:
    s = get_settings()
    return SettingsOut(
        ranking_weights=get_setting(db, "ranking_weights"),
        scheduler=SchedulerOut(enabled=bool(get_setting(db, "scheduler").get("enabled")), allowed_by_server=s.scheduler_allowed),
        map={"enabled": bool(get_setting(db, "map").get("enabled"))},
        display=get_setting(db, "display"),
        retention=get_setting(db, "retention"),
        ai=_ai_section(),
        booking=BookingOut(live_execution=False),
        encryption_available=encryption_available(),
        live_providers_enabled=s.live_providers_enabled,
    )


def update_setting(db: Session, actor_id: str, key: str, value: dict[str, Any], request: Request | None) -> SettingsOut:
    old = get_setting(db, key)
    set_setting(db, key, value, actor_id)
    record_audit(
        db,
        "settings.update",
        actor_user_id=actor_id,
        entity_type="settings",
        entity_id=key,
        details={"old": old, "new": value},
        request=request,
    )
    db.commit()
    return get_all(db)


def run_retention(db: Session, actor_id: str, request: Request | None) -> RetentionRunOut:
    retention = get_setting(db, "retention")
    now = utcnow()
    search_cutoff = now - timedelta(days=int(retention["search_days"]))
    audit_cutoff = now - timedelta(days=int(retention["audit_days"]))

    referenced = (
        select(SavedOffer.offer_id)
        .union(
            select(TripItem.offer_id).where(TripItem.offer_id.is_not(None)),
            select(BookingIntent.offer_id).where(BookingIntent.offer_id.is_not(None)),
            select(PriceSnapshot.offer_id).where(PriceSnapshot.offer_id.is_not(None)),
        )
        .subquery()
    )
    offers = db.execute(
        delete(Offer).where(Offer.created_at < search_cutoff, Offer.id.not_in(select(referenced.c.offer_id)))
    ).rowcount or 0
    # ProviderSearch rows cascade; kept offers have their search link set to NULL by the FK.
    searches = db.execute(delete(SearchRequest).where(SearchRequest.created_at < search_cutoff)).rowcount or 0
    audits = db.execute(delete(AuditEvent).where(AuditEvent.created_at < audit_cutoff)).rowcount or 0

    grace = now - timedelta(days=30)
    sessions = db.execute(
        delete(AuthSession).where(or_(AuthSession.revoked_at < grace, AuthSession.expires_at < grace))
    ).rowcount or 0
    invitations = db.execute(
        delete(Invitation).where(
            or_(
                Invitation.accepted_at < grace,
                Invitation.revoked_at < grace,
                and_(Invitation.accepted_at.is_(None), Invitation.expires_at < grace),
            )
        )
    ).rowcount or 0
    notifications = db.execute(
        delete(Notification).where(Notification.read_at.is_not(None), Notification.created_at < search_cutoff)
    ).rowcount or 0
    # Old price snapshots go, except the most recent one of every alert.
    keep: set[str] = set()
    for alert_id in set(db.scalars(select(PriceSnapshot.alert_id).where(PriceSnapshot.alert_id.is_not(None)))):
        latest = db.scalar(
            select(PriceSnapshot.id)
            .where(PriceSnapshot.alert_id == alert_id)
            .order_by(PriceSnapshot.captured_at.desc(), PriceSnapshot.id.desc())
            .limit(1)
        )
        if latest:
            keep.add(latest)
    snap_stmt = delete(PriceSnapshot).where(PriceSnapshot.captured_at < search_cutoff)
    if keep:
        snap_stmt = snap_stmt.where(PriceSnapshot.id.not_in(keep))
    snapshots = db.execute(snap_stmt).rowcount or 0

    out = RetentionRunOut(
        search_requests_deleted=searches,
        offers_deleted=offers,
        audit_events_deleted=audits,
        sessions_deleted=sessions,
        invitations_deleted=invitations,
        notifications_deleted=notifications,
        price_snapshots_deleted=snapshots,
    )
    record_audit(
        db,
        "settings.retention_run",
        actor_user_id=actor_id,
        entity_type="settings",
        entity_id="retention",
        details=out.model_dump(),
        request=request,
    )
    db.commit()
    return out
