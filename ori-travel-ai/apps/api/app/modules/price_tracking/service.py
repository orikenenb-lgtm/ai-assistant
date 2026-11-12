"""Price alerts: CRUD helpers and the shared check logic (manual + scheduler)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import ConflictError, NotFoundError
from app.core.money import from_minor, to_minor
from app.core.redaction import redact_text
from app.models.alerts import Alert
from app.models.auth import User
from app.models.search import PriceSnapshot
from app.modules.notifications.service import notify
from app.modules.price_tracking.schemas import AlertCreate, AlertOut, AlertUpdate, SnapshotOut
from app.modules.providers.errors import UnprocessableError
from app.modules.search.service import canonical_params, parse_search_params, run_search
from app.schemas.common import Money
from app.schemas.offers import CanonicalOffer

log = logging.getLogger("ori.alerts")

MAX_ALERTS_PER_USER = 25
CONSECUTIVE_FAILURES_NOTIFY = 3
NO_SNAPSHOT_PROVIDER = "n/a"
NO_SNAPSHOT_MODE = "NONE"

MSG_SEARCH_FAILED = "בדיקת המחיר נכשלה זמנית — ננסה שוב בבדיקה הבאה"
MSG_BAD_PARAMS = "פרמטרי החיפוש של ההתראה אינם תקינים — מומלץ לערוך או ליצור התראה מחדש"
MSG_NO_RESULTS = "לא נמצאו תוצאות במטבע ההתראה"
MSG_EXPIRED = "תאריכי החיפוש כבר עברו — ההתראה הושבתה אוטומטית"


# ---------------- output ----------------


def _money(minor: int | None, currency: str | None) -> Money | None:
    if minor is None or not currency:
        return None
    return Money(amount=from_minor(minor, currency), currency=currency)


def alert_out(db: Session, alert: Alert, owner_name: str | None = None) -> AlertOut:
    if owner_name is None:
        owner = db.get(User, alert.user_id)
        owner_name = owner.display_name if owner else None
    mode = alert.last_best_mode if alert.last_best_mode in ("DEMO", "LIVE", "CACHED") else None
    return AlertOut(
        id=alert.id,
        user_id=alert.user_id,
        owner_name=owner_name,
        name=alert.name,
        category=alert.category,  # type: ignore[arg-type]
        search_params=alert.search_params,
        target_price=_money(alert.target_amount_minor, alert.currency),
        currency=alert.currency,
        is_active=alert.is_active,
        check_interval_minutes=alert.check_interval_minutes,
        last_checked_at=alert.last_checked_at,
        next_check_at=(
            alert.last_checked_at + timedelta(minutes=alert.check_interval_minutes) if alert.last_checked_at else None
        ),
        last_best_price=_money(alert.last_best_amount_minor, alert.currency),
        last_best_mode=mode,  # type: ignore[arg-type]
        last_status=alert.last_status,
        last_error=alert.last_error,
        created_at=alert.created_at,
        updated_at=alert.updated_at,
    )


def snapshot_out(s: PriceSnapshot) -> SnapshotOut:
    ok = s.status == "OK"
    return SnapshotOut(
        id=s.id,
        alert_id=s.alert_id,
        offer_id=s.offer_id,
        provider_id=s.provider_id if s.provider_id != NO_SNAPSHOT_PROVIDER else None,
        mode=s.mode if s.mode in ("DEMO", "LIVE", "CACHED") else None,  # type: ignore[arg-type]
        price=_money(s.amount_minor, s.currency) if ok else None,
        status=s.status,
        error_message=s.error_message,
        captured_at=s.captured_at,
    )


# ---------------- access / CRUD ----------------


def get_alert_for(db: Session, user: User, alert_id: str) -> Alert:
    alert = db.get(Alert, alert_id) if alert_id and len(alert_id) <= 64 else None
    if alert is None or (alert.user_id != user.id and user.role != "owner"):
        raise NotFoundError("ההתראה לא נמצאה", code="ALERT_NOT_FOUND")
    return alert


def list_alerts(db: Session, user: User) -> list[AlertOut]:
    stmt = select(Alert, User.display_name).join(User, User.id == Alert.user_id).order_by(Alert.created_at.desc(), Alert.id)
    if user.role != "owner":
        stmt = stmt.where(Alert.user_id == user.id)
    return [alert_out(db, a, name) for a, name in db.execute(stmt).all()]


def _validate_params(category: str, payload: dict):
    params = parse_search_params(payload, category)
    return params


def _check_interval(minutes: int) -> None:
    minimum = get_settings().alert_min_interval_minutes
    if minutes < minimum:
        raise UnprocessableError(
            f"תדירות הבדיקה המינימלית היא פעם ב-{minimum} דקות",
            details=[{"field": "check_interval_minutes", "message": f"המינימום הוא {minimum} דקות"}],
        )


def _check_target(target: Money | None, currency: str) -> None:
    if target is None:
        return
    if target.amount <= 0:
        raise UnprocessableError("מחיר היעד חייב להיות חיובי", details=[{"field": "target_price", "message": "ערך לא חיובי"}])
    if target.currency != currency:
        raise UnprocessableError(
            "מטבע מחיר היעד חייב להיות זהה למטבע החיפוש",
            details=[{"field": "target_price.currency", "message": f"נדרש {currency}"}],
        )


def create_alert(db: Session, user: User, body: AlertCreate, request: Request | None = None) -> Alert:
    params = _validate_params(body.category, body.search_params)
    _check_interval(body.check_interval_minutes)
    _check_target(body.target_price, params.currency)
    count = len(list(db.scalars(select(Alert.id).where(Alert.user_id == user.id))))
    if count >= MAX_ALERTS_PER_USER:
        raise ConflictError(f"ניתן להגדיר עד {MAX_ALERTS_PER_USER} התראות", code="ALERT_LIMIT")
    alert = Alert(
        user_id=user.id,
        name=body.name.strip(),
        category=body.category,
        search_params=canonical_params(params),
        currency=params.currency,
        target_amount_minor=to_minor(body.target_price.amount, params.currency) if body.target_price else None,
        check_interval_minutes=body.check_interval_minutes,
        is_active=True,
        last_status="NEVER",
    )
    db.add(alert)
    db.flush()
    record_audit(db, "alert.create", actor_user_id=user.id, entity_type="alert", entity_id=alert.id, request=request)
    db.commit()
    return alert


def update_alert(db: Session, user: User, alert: Alert, body: AlertUpdate, request: Request | None = None) -> Alert:
    fields = body.model_fields_set
    for required in ("name", "check_interval_minutes", "is_active", "search_params"):
        if required in fields and getattr(body, required) is None:
            raise UnprocessableError("שדה חובה אינו יכול להיות ריק", details=[{"field": required, "message": "שדה חובה"}])
    old_currency = alert.currency
    currency = alert.currency
    if "search_params" in fields:
        params = _validate_params(alert.category, body.search_params or {})
        alert.search_params = canonical_params(params)
        currency = params.currency
        # A different search invalidates the previous price history summary
        alert.currency = currency
        alert.last_best_amount_minor = None
        alert.last_best_mode = None
        alert.last_status = "NEVER"
        alert.last_error = None
        alert.last_checked_at = None
    if "target_price" in fields:
        _check_target(body.target_price, currency)
        alert.target_amount_minor = to_minor(body.target_price.amount, currency) if body.target_price else None
    elif alert.target_amount_minor is not None and currency != old_currency:
        alert.target_amount_minor = None
    if "check_interval_minutes" in fields:
        _check_interval(body.check_interval_minutes)  # type: ignore[arg-type]
        alert.check_interval_minutes = body.check_interval_minutes  # type: ignore[assignment]
    if "name" in fields:
        alert.name = body.name.strip()  # type: ignore[union-attr]
    if "is_active" in fields:
        if body.is_active and not alert.is_active:
            try:
                parse_search_params(alert.search_params, alert.category)
            except UnprocessableError:
                raise UnprocessableError(
                    "לא ניתן להפעיל התראה שתאריכי החיפוש שלה עברו — עדכנו את החיפוש", code="ALERT_EXPIRED"
                ) from None
            alert.last_status = "NEVER" if alert.last_status == "EXPIRED" else alert.last_status
            alert.last_error = None if alert.last_status == "NEVER" else alert.last_error
        alert.is_active = bool(body.is_active)
    alert.updated_at = utcnow()
    record_audit(db, "alert.update", actor_user_id=user.id, entity_type="alert", entity_id=alert.id, request=request)
    db.commit()
    return alert


def delete_alert(db: Session, user: User, alert: Alert, request: Request | None = None) -> None:
    alert_id = alert.id
    db.delete(alert)
    record_audit(db, "alert.delete", actor_user_id=user.id, entity_type="alert", entity_id=alert_id, request=request)
    db.commit()


def list_snapshots(db: Session, alert: Alert, limit: int = 200) -> list[SnapshotOut]:
    rows = db.scalars(
        select(PriceSnapshot)
        .where(PriceSnapshot.alert_id == alert.id)
        .order_by(PriceSnapshot.captured_at.desc(), PriceSnapshot.id)
        .limit(limit)
    )
    return [snapshot_out(s) for s in rows]


# ---------------- check logic ----------------


@dataclass
class CheckResult:
    status: str
    best_offer: CanonicalOffer | None
    triggered: bool
    target_reached: bool
    snapshot: PriceSnapshot | None
    alert: Alert


def search_start_date(category: str, params: dict) -> date | None:
    key = {"flight": "depart_date", "hotel": "check_in", "car": "pickup_at", "activity": "date_from"}.get(category)
    raw = params.get(key) if key else None
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw)).date() if "T" in str(raw) or " " in str(raw) else date.fromisoformat(str(raw))
    except ValueError:
        return None


def _failure_streak(db: Session, alert_id: str, limit: int = 10) -> int:
    rows = db.scalars(
        select(PriceSnapshot.status)
        .where(PriceSnapshot.alert_id == alert_id)
        .order_by(PriceSnapshot.captured_at.desc(), PriceSnapshot.id)
        .limit(limit)
    )
    n = 0
    for status in rows:
        if status != "FAILED":
            break
        n += 1
    return n


def _record_snapshot(db: Session, alert: Alert, *, status: str, offer: CanonicalOffer | None = None, error: str | None = None):
    snap = PriceSnapshot(
        alert_id=alert.id,
        offer_id=offer.id if offer else None,
        provider_id=offer.source.provider_id if offer else NO_SNAPSHOT_PROVIDER,
        mode=offer.source.mode if offer else NO_SNAPSHOT_MODE,
        dedupe_key=offer.dedupe_key if offer else None,
        amount_minor=to_minor(offer.price.total.amount, offer.price.total.currency) if offer else None,
        currency=offer.price.total.currency if offer else None,
        status=status,
        error_message=error,
    )
    db.add(snap)
    db.flush()
    return snap


def _fmt(minor: int, currency: str) -> str:
    return f"{from_minor(minor, currency)} {currency}"


def check_alert(db: Session, alert: Alert, now: datetime | None = None) -> CheckResult:
    """Run one price check. Commits. Never raises for provider/search problems."""
    now = now or utcnow()
    alert_id = alert.id

    start = search_start_date(alert.category, alert.search_params)
    if start is not None and start < now.date():
        alert.is_active = False
        alert.last_status = "EXPIRED"
        alert.last_error = MSG_EXPIRED
        alert.last_checked_at = now
        notify(
            db,
            alert.user_id,
            "system",
            f"ההתראה ״{alert.name}״ הושבתה",
            "תאריכי החיפוש כבר עברו, ולכן ההתראה הושבתה אוטומטית.",
            "/alerts",
        )
        db.commit()
        return CheckResult("EXPIRED", None, False, False, None, alert)

    previous_best = alert.last_best_amount_minor
    best: CanonicalOffer | None = None
    status = "OK"
    error: str | None = None
    try:
        response = run_search(db, alert.user_id, alert.search_params, origin="alert")
        in_currency = [o for o in response.offers if o.price.total.currency == alert.currency]
        if in_currency:
            best = min(in_currency, key=lambda o: (o.price.total.amount, o.id))
        elif response.status == "failed" and not response.offers:
            status, error = "FAILED", MSG_SEARCH_FAILED
        else:
            status, error = "NO_RESULTS", MSG_NO_RESULTS if response.offers else None
    except UnprocessableError:
        db.rollback()
        status, error = "FAILED", MSG_BAD_PARAMS
    except Exception as exc:  # user-safe message only; details go to the (redacted) log
        db.rollback()
        log.warning("alert check failed alert=%s: %s", alert_id, redact_text(f"{type(exc).__name__}: {exc}"))
        status, error = "FAILED", MSG_SEARCH_FAILED

    alert = db.get(Alert, alert_id) or alert
    if status == "OK" and best is None:  # defensive
        status = "NO_RESULTS"
    triggered = False
    reached = False
    snap: PriceSnapshot | None
    if status == "OK" and best is not None:
        snap = _record_snapshot(db, alert, status="OK", offer=best)
        best_minor = to_minor(best.price.total.amount, best.price.total.currency)
        alert.last_best_amount_minor = best_minor
        alert.last_best_mode = best.source.mode
        alert.last_error = None
        target = alert.target_amount_minor
        if target is not None and best_minor <= target:
            reached = True
            triggered = previous_best is None or previous_best > target
        if triggered:
            demo = " (נתוני הדגמה — לא מחיר אמיתי)" if best.source.mode == "DEMO" else ""
            cached = " (נתונים ממטמון)" if best.source.mode == "CACHED" else ""
            notify(
                db,
                alert.user_id,
                "price_drop",
                f"ירידת מחיר: {alert.name}",
                f"נמצא מחיר {_fmt(best_minor, alert.currency)} — בגובה יעד המחיר שהגדרתם "
                f"({_fmt(target, alert.currency)}).{demo}{cached}",  # type: ignore[arg-type]
                "/alerts",
            )
    else:
        snap = _record_snapshot(db, alert, status=status, error=error)
        if status == "NO_RESULTS":
            alert.last_best_amount_minor = None
            alert.last_best_mode = None
        alert.last_error = error
    alert.last_status = status
    alert.last_checked_at = now
    if status == "FAILED" and _failure_streak(db, alert.id) == CONSECUTIVE_FAILURES_NOTIFY:
        notify(
            db,
            alert.user_id,
            "alert_failed",
            f"בדיקת ההתראה ״{alert.name}״ נכשלת שוב ושוב",
            "בדיקת המחיר נכשלה שלוש פעמים ברצף. נמשיך לנסות; ניתן גם לבדוק ידנית או לערוך את ההתראה.",
            "/alerts",
        )
    db.commit()
    return CheckResult(status, best, triggered, reached, snap, alert)
