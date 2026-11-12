"""Booking preparation service (docs/security/booking-safety.md).

Safety invariants enforced here:

* State only changes through ``state_machine.transition`` (table = the spec).
* An approval is bound to ``terms_hash``; any material change invalidates it.
* The supplier is re-checked immediately before submission.
* Submission is idempotent per client key and is SIMULATION-only. LIVE API
  execution is refused unconditionally — there is no live executor in V1.
* UNKNOWN blocks everything except ``reconcile``.
* CONFIRMED is impossible without a supplier reference.

Request-scoped functions commit their own work. Where a safety downgrade has to
survive the error that reports it (expiry, invalidated approval), the change is
committed first and the ``AppError`` is raised afterwards.
"""

from __future__ import annotations

import copy
import hmac
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.deps import AuthContext
from app.core.errors import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.core.money import from_minor, to_minor
from app.models.auth import ROLE_ADULT, ROLE_OWNER, User
from app.models.booking import BOOKING_STATES, Approval, BookingIntent, Reservation, SimulatedSupplierBooking
from app.models.family import FamilyMember
from app.models.trips import Trip
from app.modules.auth.service import check_password_for_step_up
from app.modules.booking import demo_supplier, mock_supplier
from app.modules.booking import state_machine as sm
from app.modules.booking.schemas import (
    ApprovalOut,
    BookingCan,
    BookingCreate,
    BookingOut,
    BookingSummary,
    CheckoutLinkOut,
    DemoCheckoutOut,
    HistoryEntry,
    ReservationOut,
    TravelerOut,
)
from app.modules.booking.terms import build_terms_summary, compute_terms_hash, format_money
from app.modules.notifications.service import notify
from app.modules.providers import registry
from app.modules.providers import service as provider_service
from app.modules.providers.base import RevalidationResult
from app.modules.search import service as search_service
from app.schemas.common import Money, Page
from app.schemas.offers import CanonicalOffer

log = logging.getLogger("ori.booking")

MODE_SIMULATION = "SIMULATION"
MODE_HOSTED = "HOSTED_CHECKOUT"
# A price check older than this cannot back an approval.
REVALIDATION_MAX_AGE = timedelta(minutes=15)
ENTITY = "booking_intent"

MSG_RECONCILE_REQUIRED = "תוצאת השליחה לספק אינה ידועה. יש לבצע בירור מול הספק לפני כל פעולה נוספת."
MSG_OFFER_EXPIRED = "תוקף ההצעה פג. יש לבצע חיפוש חדש ולהכין הזמנה חדשה."
MSG_LIVE_DISABLED = "ביצוע הזמנה אמיתית דרך המערכת כבוי. ניתן לבצע סימולציה או להמשיך באתר הספק."
MSG_APPROVAL_LAPSED = "תוקף האישור פג. יש לבדוק את המחיר ולאשר מחדש."
MSG_AWAITING_SUPPLIER = "ממתין להשלמה באתר הספק"
MSG_CANCEL_CONFIRMED = "הזמנה שאושרה אצל הספק אינה ניתנת לביטול דרך המערכת. יש לבטל ישירות מול הספק."


# ------------------------------------------------------------------ loading ----


def get_intent(db: Session, intent_id: str) -> BookingIntent:
    intent = db.get(BookingIntent, intent_id) if intent_id and len(intent_id) <= 64 else None
    if intent is None:
        raise NotFoundError("ההזמנה לא נמצאה", code="BOOKING_NOT_FOUND")
    return intent


def _traveler_ids(intent: BookingIntent) -> list[str]:
    return [t["family_member_id"] for t in intent.travelers or []]


def current_terms_hash(intent: BookingIntent) -> str:
    return compute_terms_hash(intent.offer_snapshot, intent.travelers or [], intent.current_amount_minor, intent.currency,
                              intent.execution_mode)


def _load_travelers(db: Session, member_ids: list[str]) -> list[dict[str, Any]]:
    rows = {m.id: m for m in db.scalars(select(FamilyMember).where(FamilyMember.id.in_(member_ids)))}
    missing = [i for i in member_ids if i not in rows]
    if missing:
        raise BadRequestError("אחד הנוסעים שנבחרו אינו קיים במשפחה", code="TRAVELER_NOT_FOUND", details={"missing": missing})
    return [
        {
            "family_member_id": rows[i].id,
            "display_name": rows[i].display_name,
            "age_group": rows[i].age_group,
            "is_minor": bool(rows[i].is_minor),
        }
        for i in member_ids
    ]


_GROUPS = ("adult", "child", "infant")
_GROUP_PLURAL_HE = {"adult": "מבוגרים", "child": "ילדים", "infant": "תינוקות"}


def _counts_text(counts: dict[str, int]) -> str:
    return ", ".join(f"{int(counts.get(g) or 0)} {_GROUP_PLURAL_HE[g]}" for g in _GROUPS)


def _validate_composition(details: dict[str, Any], travelers: list[dict[str, Any]]) -> None:
    """The travelers must be exactly who the offer was priced for (AUD-04)."""
    have = dict.fromkeys(_GROUPS, 0)
    other = 0
    for t in travelers:
        if t.get("age_group") in have:
            have[t["age_group"]] += 1
        else:
            other += 1

    def mismatch(message: str, expected: dict[str, int]) -> BadRequestError:
        return BadRequestError(message, code="TRAVELER_MISMATCH", details={"expected": expected, "selected": have})

    if other:
        raise mismatch("לאחד הנוסעים שנבחרו לא מוגדרת קבוצת גיל (מבוגר, ילד או תינוק). יש לעדכן את פרטי בן המשפחה.", {})
    kind = details.get("kind")
    if kind in ("flight", "activity"):
        raw = details.get("passengers" if kind == "flight" else "participants") or {}
        if kind == "activity" and not raw:
            want = None  # the supplier did not state who the price is for
        else:
            want = {g: int(raw.get(g) or 0) for g in _GROUPS}
            unknown = sum(int(v or 0) for k, v in raw.items() if k not in _GROUPS)
            if unknown or want != have:
                what = "הטיסה" if kind == "flight" else "הפעילות"
                raise mismatch(f"{what} תומחרה עבור {_counts_text(want)}, אך נבחרו {_counts_text(have)}. "
                               "יש לבחור נוסעים תואמים או לבצע חיפוש חדש.", want)
        if have["infant"] and not have["adult"]:
            raise mismatch("תינוק חייב להיות מלווה במבוגר אחד לפחות.", want or {})
    elif kind == "hotel":
        want = {"adult": int(details.get("adults") or 0), "child": int(details.get("children") or 0)}
        got = {"adult": have["adult"], "child": have["child"] + have["infant"]}
        if want != got:
            raise mismatch(f"החדר תומחר עבור {want['adult']} מבוגרים ו-{want['child']} ילדים, אך נבחרו "
                           f"{got['adult']} מבוגרים ו-{got['child']} ילדים. יש לבחור אורחים תואמים או לבצע חיפוש חדש.", want)
    if not have["adult"]:
        raise mismatch("נדרש לפחות נוסע מבוגר אחד בהזמנה.", {"adult": 1})


# ---------------------------------------------------------------- approvals ----


def active_approval(intent: BookingIntent) -> Approval | None:
    """Latest approval that was neither invalidated nor consumed (may be past its TTL)."""
    live = [a for a in intent.approvals if a.invalidated_at is None and a.consumed_at is None]
    return max(live, key=lambda a: a.created_at) if live else None


def approval_valid(intent: BookingIntent, approval: Approval | None, now: datetime | None = None) -> bool:
    if approval is None or approval.invalidated_at is not None or approval.consumed_at is not None:
        return False
    if approval.expires_at <= (now or utcnow()):
        return False
    return (
        hmac.compare_digest(approval.terms_hash, current_terms_hash(intent))
        and approval.approved_amount_minor == intent.current_amount_minor
        and approval.currency == intent.currency
    )


def _invalidate_approvals(db: Session, intent: BookingIntent, reason: str, actor_id: str | None,
                          request: Request | None) -> int:
    now = utcnow()
    count = 0
    for a in intent.approvals:
        if a.invalidated_at is None and a.consumed_at is None:
            a.invalidated_at = now
            a.invalidation_reason = reason[:300]
            count += 1
    if count:
        record_audit(db, "booking.approval_invalidated", actor_user_id=actor_id, entity_type=ENTITY,
                     entity_id=intent.id, details={"reason": reason, "count": count}, request=request)
    return count


# ------------------------------------------------------------------- guards ----


def _require_state(intent: BookingIntent, allowed: tuple[str, ...], action_he: str) -> None:
    if intent.state == sm.UNKNOWN:
        raise ConflictError(MSG_RECONCILE_REQUIRED, code="RECONCILE_REQUIRED")
    if intent.state not in allowed:
        label = sm.STATE_LABELS_HE.get(intent.state, intent.state)
        raise ConflictError(f"לא ניתן {action_he} כשההזמנה במצב „{label}”", code="INVALID_TRANSITION",
                            details={"state": intent.state, "allowed_states": list(allowed)})


def _offer_expired(intent: BookingIntent, now: datetime | None = None) -> bool:
    return intent.offer_expires_at is not None and intent.offer_expires_at <= (now or utcnow())


def _expire(db: Session, intent: BookingIntent, actor_id: str | None, request: Request | None, reason: str) -> None:
    _invalidate_approvals(db, intent, "תוקף ההצעה פג", actor_id, request)
    intent.failure_reason = reason[:500]
    sm.transition(db, intent, sm.EXPIRED, action="expire", actor_user_id=actor_id, reason=reason, request=request)


def _ensure_not_expired(db: Session, intent: BookingIntent, actor_id: str, request: Request | None) -> None:
    """Any attempt to move an intent whose quote has expired turns it EXPIRED (committed) and fails."""
    if intent.state in sm.EXPIRABLE_STATES and _offer_expired(intent):
        _expire(db, intent, actor_id, request, MSG_OFFER_EXPIRED)
        db.commit()
        raise ConflictError(MSG_OFFER_EXPIRED, code="OFFER_EXPIRED")


def _demote_lapsed_approval(db: Session, intent: BookingIntent, actor_id: str, request: Request | None) -> bool:
    """APPROVED whose approval is past its TTL goes back to READY_FOR_APPROVAL. Returns True when demoted."""
    if intent.state != sm.APPROVED:
        return False
    approval = active_approval(intent)
    if approval is not None and approval.expires_at > utcnow():
        return False
    _invalidate_approvals(db, intent, "תוקף האישור פג", actor_id, request)
    sm.transition(db, intent, sm.READY_FOR_APPROVAL, action="approval_expired", actor_user_id=actor_id,
                  reason="תוקף האישור פג", request=request)
    return True


# ------------------------------------------------------------ notifications ----


def _notify_other_adults(db: Session, actor_id: str | None, title: str, body: str, intent: BookingIntent) -> None:
    user_ids = db.scalars(select(User.id).where(User.role.in_([ROLE_OWNER, ROLE_ADULT]), User.is_active.is_(True)))
    for uid in user_ids:
        if uid != actor_id:
            notify(db, uid, "booking", title, body, f"/bookings/{intent.id}")


def _title(intent: BookingIntent) -> str:
    return str((intent.offer_snapshot or {}).get("title") or "הזמנה")


# ------------------------------------------------------------------- create ----


def _execution_mode(offer: CanonicalOffer, requested: str | None = None) -> str:
    """SIMULATION for DEMO offers, HOSTED_CHECKOUT for LIVE offers with an allowlisted checkout page.

    ``requested`` lets the user pick between modes the provider really offers (a DEMO provider with a
    DEMO supplier page offers both). It can never widen what the adapter declares, and never means LIVE.
    """
    unavailable = ConflictError(
        "לא ניתן להכין הזמנה להצעה זו: הספק אינו מציע סימולציה או מעבר מאושר לאתר הספק.",
        code="BOOKING_UNAVAILABLE",
    )
    adapter = registry.find_adapter(offer.source.provider_id)
    if adapter is None:
        raise unavailable
    try:
        mode = adapter.capabilities().mode
        options = adapter.booking_options(offer)
    except Exception as exc:  # provider code must never break booking safety decisions
        log.info("booking options unavailable for provider %s: %s", offer.source.provider_id, type(exc).__name__)
        raise unavailable from None
    if mode == "DEMO" and offer.source.mode == "DEMO":
        # DEMO hosted checkout = the in-app DEMO supplier page, and only that exact relative URL (§5).
        demo_hosted = demo_supplier.offers_demo_checkout(adapter, options)
        if requested == MODE_HOSTED:
            if demo_hosted:
                return MODE_HOSTED
            raise unavailable
        if options.simulation_available:
            return MODE_SIMULATION
        if requested is None and demo_hosted:
            return MODE_HOSTED
        raise unavailable
    if requested == MODE_SIMULATION:
        raise unavailable
    if (
        mode == "LIVE"
        and offer.source.mode in ("LIVE", "CACHED")
        and registry.is_usable(adapter)
        and adapter.is_allowed_deep_link(options.hosted_checkout_url)
    ):
        if not _supports_revalidate(adapter):
            # Without a supplier re-check the intent could never leave QUOTE_SELECTED (AUD-05).
            raise ConflictError(
                "לא ניתן להכין הזמנה להצעה זו: הספק אינו מאפשר לאמת את המחיר מראש. "
                "אפשר להמשיך ישירות באתר הספק דרך הקישור שבהצעה; המחיר והתנאים הסופיים ייקבעו שם.",
                code="BOOKING_UNAVAILABLE",
                details={"reason": "REVALIDATION_UNSUPPORTED"},
            )
        return MODE_HOSTED
    raise unavailable


def _supports_revalidate(adapter: Any) -> bool:
    try:
        return bool(adapter.capabilities().supports_revalidate)
    except Exception:
        return False


def create_intent(db: Session, ctx: AuthContext, body: BookingCreate, request: Request | None) -> BookingOut:
    offer = search_service.get_offer(db, body.offer_id)
    if offer.source.expires_at is not None and offer.source.expires_at <= utcnow():
        raise ConflictError(MSG_OFFER_EXPIRED, code="OFFER_EXPIRED", details={"reason": "EXPIRED"})
    mode = _execution_mode(offer, body.execution_mode)
    if body.simulation_scenario is not None and mode != MODE_SIMULATION:
        raise BadRequestError("תרחיש סימולציה מותר רק בהזמנת הדגמה", code="SCENARIO_NOT_ALLOWED")
    travelers = _load_travelers(db, body.traveler_member_ids)
    _validate_composition(offer.details.model_dump(mode="json"), travelers)
    if body.trip_id is not None and db.get(Trip, body.trip_id) is None:
        raise NotFoundError("הטיול לא נמצא", code="TRIP_NOT_FOUND")

    total = offer.price.total
    amount_minor = to_minor(total.amount, total.currency)
    snapshot = offer.model_dump(mode="json", exclude={"score"})
    intent = BookingIntent(
        created_by_id=ctx.user_id,
        offer_id=offer.id,
        trip_id=body.trip_id,
        category=offer.category,
        provider_id=offer.source.provider_id,
        execution_mode=mode,
        offer_snapshot=snapshot,
        travelers=travelers,
        quoted_amount_minor=amount_minor,
        current_amount_minor=amount_minor,
        currency=total.currency,
        offer_expires_at=offer.source.expires_at,
        simulation_scenario=(body.simulation_scenario or "success") if mode == MODE_SIMULATION else None,
        history=[],
    )
    intent.terms_hash = compute_terms_hash(snapshot, travelers, amount_minor, total.currency, mode)
    db.add(intent)
    db.flush()
    record_audit(db, "booking.create", actor_user_id=ctx.user_id, entity_type=ENTITY, entity_id=intent.id,
                 details={"offer_id": offer.id, "provider_id": intent.provider_id, "execution_mode": mode,
                          "travelers": len(travelers), "simulation_scenario": intent.simulation_scenario},
                 request=request)
    sm.transition(db, intent, sm.QUOTE_SELECTED, action="select_quote", actor_user_id=ctx.user_id,
                  reason="נבחרו הצעה ונוסעים", request=request)
    db.commit()
    return to_out(db, intent, ctx)


# ---------------------------------------------------------------- travelers ----


def update_travelers(db: Session, ctx: AuthContext, intent_id: str, member_ids: list[str],
                     request: Request | None) -> BookingOut:
    intent = get_intent(db, intent_id)
    _require_state(intent, (sm.QUOTE_SELECTED, sm.READY_FOR_APPROVAL, sm.APPROVED), "לשנות נוסעים")
    _ensure_not_expired(db, intent, ctx.user_id, request)
    if sorted(member_ids) == sorted(_traveler_ids(intent)):
        return to_out(db, intent, ctx, notice="רשימת הנוסעים לא השתנתה.")
    travelers = _load_travelers(db, member_ids)
    _validate_composition((intent.offer_snapshot or {}).get("details") or {}, travelers)
    intent.travelers = travelers
    intent.terms_hash = current_terms_hash(intent)
    intent.revalidated_at = None
    reason = "רשימת הנוסעים השתנתה"
    invalidated = _invalidate_approvals(db, intent, reason, ctx.user_id, request)
    record_audit(db, "booking.travelers_changed", actor_user_id=ctx.user_id, entity_type=ENTITY, entity_id=intent.id,
                 details={"travelers": len(member_ids), "approval_invalidated": bool(invalidated)}, request=request)
    if intent.state != sm.QUOTE_SELECTED:
        sm.transition(db, intent, sm.QUOTE_SELECTED, action="material_change", actor_user_id=ctx.user_id,
                      reason=reason, request=request)
    db.commit()
    notice = "רשימת הנוסעים עודכנה. " + ("האישור הקודם בוטל. " if invalidated else "") + "יש לבדוק מחיר מחדש."
    return to_out(db, intent, ctx, notice=notice)


# --------------------------------------------------------------- revalidate ----


@dataclass
class _Check:
    outcome: str  # unchanged / changed / expired / error
    message: str
    old_minor: int
    new_minor: int
    old_currency: str
    new_currency: str

    @property
    def price_changed(self) -> bool:
        return self.old_minor != self.new_minor or self.old_currency != self.new_currency


def _ask_supplier(db: Session, intent: BookingIntent, *, after_approval: bool) -> RevalidationResult:
    """Re-check the snapshot with its provider. Never raises: any problem becomes status="error"."""
    now = utcnow()
    try:
        offer = CanonicalOffer.model_validate(intent.offer_snapshot)
        forced: str | None = None
        if intent.execution_mode == MODE_SIMULATION:
            scenario = intent.simulation_scenario
            if scenario == "expired":
                forced = "expired"
            elif (
                scenario == "price_change"
                and after_approval
                and intent.current_amount_minor == intent.quoted_amount_minor
            ):
                # Fires once: at the first supplier check made after a human approval.
                forced = "price_changed"
        if forced is not None:
            adapter = registry.get_adapter(intent.provider_id)
            if adapter.capabilities().mode != "DEMO":
                raise RuntimeError("simulation scenario on a non-DEMO provider")
            return adapter.revalidate(offer, settings={"revalidation_scenario": forced})  # type: ignore[call-arg]
        return provider_service.revalidate_offer(db, offer)
    except Exception as exc:
        log.warning("revalidation failed for booking %s: %s", intent.id, type(exc).__name__)
        return RevalidationResult(status="error", offer_id=str(intent.offer_id or ""), checked_at=now,
                                  message="בדיקת המחיר מול הספק נכשלה. נסו שוב בעוד מספר דקות.")


def _apply_check(intent: BookingIntent, result: RevalidationResult) -> _Check:
    """Fold a supplier answer into the intent's data (never its state)."""
    old_minor, old_currency = intent.current_amount_minor, intent.currency
    base = _Check("error", result.message, old_minor, old_minor, old_currency, old_currency)
    if result.status in ("expired", "unavailable"):
        base.outcome = "expired"
        return base
    if result.status not in ("unchanged", "price_changed"):
        return base
    try:
        snapshot = copy.deepcopy(intent.offer_snapshot)
        new_minor, new_currency = old_minor, old_currency
        if result.refreshed_offer is not None:
            fresh = result.refreshed_offer.model_dump(mode="json", exclude={"score"})
            fresh["id"] = snapshot.get("id")
            snapshot = fresh
            total = result.refreshed_offer.price.total
            new_minor, new_currency = to_minor(total.amount, total.currency), total.currency
        if result.new_total is not None:
            claimed = to_minor(result.new_total.amount, result.new_total.currency)
            if result.refreshed_offer is not None and (claimed, result.new_total.currency) != (new_minor, new_currency):
                raise ValueError("supplier answer is inconsistent")
            new_minor, new_currency = claimed, result.new_total.currency
            if result.refreshed_offer is None:
                snapshot.setdefault("price", {})["total"] = result.new_total.model_dump(mode="json")
        new_hash = compute_terms_hash(snapshot, intent.travelers or [], new_minor, new_currency, intent.execution_mode)
    except Exception as exc:
        log.warning("unusable revalidation answer for booking %s: %s", intent.id, type(exc).__name__)
        base.message = "התקבלה תשובה לא תקינה מהספק. המחיר לא אומת."
        return base

    expires = (snapshot.get("source") or {}).get("expires_at")
    changed = result.status == "price_changed" or new_hash != intent.terms_hash
    intent.offer_snapshot = snapshot
    intent.offer_expires_at = datetime.fromisoformat(expires) if expires else None
    if not changed:
        intent.revalidated_at = utcnow()
        base.outcome = "unchanged"
        return base
    intent.current_amount_minor = new_minor
    intent.currency = new_currency
    intent.terms_hash = new_hash
    intent.revalidated_at = None
    return _Check("changed", result.message, old_minor, new_minor, old_currency, new_currency)


def _changed_reason(check: _Check) -> str:
    if check.price_changed:
        return (f"המחיר השתנה אצל הספק: {format_money(check.old_minor, check.old_currency)} ← "
                f"{format_money(check.new_minor, check.new_currency)}")
    return "תנאי ההצעה השתנו אצל הספק"


def revalidate(db: Session, ctx: AuthContext, intent_id: str, request: Request | None) -> BookingOut:
    """Re-check price/availability.

    REVALIDATING is entered only from QUOTE_SELECTED (the only edge the spec
    allows). READY_FOR_APPROVAL / APPROVED are re-checked in place: unchanged
    keeps the state (an APPROVED intent stays approved), a change goes back to
    QUOTE_SELECTED and invalidates the approval, expiry goes to EXPIRED, and a
    provider error leaves the state as it was — it never advances it.
    """
    intent = get_intent(db, intent_id)
    _require_state(intent, (sm.QUOTE_SELECTED, sm.READY_FOR_APPROVAL, sm.APPROVED), "לבדוק מחיר")
    actor = ctx.user_id
    if _offer_expired(intent):
        _expire(db, intent, actor, request, MSG_OFFER_EXPIRED)
        db.commit()
        return to_out(db, intent, ctx, notice=MSG_OFFER_EXPIRED)

    started_in = intent.state
    if started_in == sm.QUOTE_SELECTED:
        sm.transition(db, intent, sm.REVALIDATING, action="revalidate_start", actor_user_id=actor,
                      reason="בדיקת מחיר מול הספק", request=request)
    check = _apply_check(intent, _ask_supplier(db, intent, after_approval=started_in == sm.APPROVED))
    notice = check.message

    if check.outcome == "unchanged":
        if started_in == sm.QUOTE_SELECTED:
            sm.transition(db, intent, sm.READY_FOR_APPROVAL, action="revalidate", actor_user_id=actor,
                          reason="המחיר והזמינות אומתו", request=request)
        else:
            record_audit(db, "booking.revalidate", actor_user_id=actor, entity_type=ENTITY, entity_id=intent.id,
                         details={"result": "unchanged", "state": intent.state}, request=request)
            if _demote_lapsed_approval(db, intent, actor, request):
                notice = f"{notice}. {MSG_APPROVAL_LAPSED}"
    elif check.outcome == "changed":
        reason = _changed_reason(check)
        invalidated = _invalidate_approvals(db, intent, reason, actor, request)
        sm.transition(db, intent, sm.QUOTE_SELECTED, action="price_changed" if check.price_changed else "terms_changed",
                      actor_user_id=actor, reason=reason, request=request,
                      details={"old_minor": check.old_minor, "new_minor": check.new_minor,
                               "currency": check.new_currency, "approval_invalidated": bool(invalidated)})
        notice = reason + (". האישור הקודם בוטל" if invalidated else "") + ". יש לבדוק מחיר שוב ולאשר את התנאים החדשים."
    elif check.outcome == "expired":
        _expire(db, intent, actor, request, check.message)
    else:  # provider error: never advance, never silently approve
        if started_in == sm.QUOTE_SELECTED:
            sm.transition(db, intent, sm.QUOTE_SELECTED, action="revalidate_failed", actor_user_id=actor,
                          reason="בדיקת המחיר נכשלה", request=request)
        record_audit(db, "booking.revalidate", actor_user_id=actor, entity_type=ENTITY, entity_id=intent.id,
                     outcome="failure", details={"result": "error", "state": intent.state}, request=request)
        notice = f"אזהרה: {check.message} המחיר לא אומת וההזמנה נשארה במצבה הקודם."
    db.commit()
    return to_out(db, intent, ctx, notice=notice)


# ------------------------------------------------------------------ approve ----


def _revalidation_fresh(intent: BookingIntent, now: datetime | None = None) -> bool:
    return intent.revalidated_at is not None and (now or utcnow()) - intent.revalidated_at <= REVALIDATION_MAX_AGE


def approve(db: Session, ctx: AuthContext, intent_id: str, terms_hash: str, password: str,
            request: Request | None) -> BookingOut:
    intent = get_intent(db, intent_id)
    _require_state(intent, (sm.READY_FOR_APPROVAL,), "לאשר")
    _ensure_not_expired(db, intent, ctx.user_id, request)
    if not _revalidation_fresh(intent):
        raise ConflictError("בדיקת המחיר האחרונה אינה עדכנית. יש לבדוק מחיר מחדש לפני האישור.",
                            code="REVALIDATION_REQUIRED")
    current = current_terms_hash(intent)
    if not hmac.compare_digest(current, intent.terms_hash or "") or not hmac.compare_digest(current, terms_hash):
        raise ConflictError("תנאי ההזמנה השתנו מאז שהוצגו לך. יש לעיין בתנאים המעודכנים ולאשר שוב.",
                            code="TERMS_CHANGED")
    # Step-up: the approving human re-enters their own password (throttled).
    check_password_for_step_up(db, ctx.user, password, request)

    now = utcnow()
    summary = build_terms_summary(intent.offer_snapshot, intent.travelers, intent.current_amount_minor,
                                  intent.currency, intent.execution_mode)
    _invalidate_approvals(db, intent, "הוחלף באישור חדש", ctx.user_id, request)
    approval = Approval(
        booking_intent_id=intent.id,
        approved_by_id=ctx.user_id,
        terms_hash=current,
        approved_amount_minor=intent.current_amount_minor,
        currency=intent.currency,
        summary="\n".join(summary),
        created_at=now,
        expires_at=now + timedelta(minutes=get_settings().approval_ttl_minutes),
    )
    intent.approvals.append(approval)
    sm.transition(db, intent, sm.APPROVED, action="approve", actor_user_id=ctx.user_id, reason="אישור אנושי עם סיסמה",
                  request=request, details={"terms_hash": current, "amount_minor": intent.current_amount_minor,
                                            "currency": intent.currency})
    _notify_other_adults(db, ctx.user_id, "הזמנה אושרה",
                         f"{ctx.user.display_name} אישר/ה את „{_title(intent)}” בסך "
                         f"{format_money(intent.current_amount_minor, intent.currency)}.", intent)
    db.commit()
    return to_out(db, intent, ctx, notice="התנאים אושרו. האישור תקף לזמן מוגבל.")


# ------------------------------------------------- pre-submission re-check ----


def _recheck_before_handoff(db: Session, intent: BookingIntent, actor: str, request: Request | None) -> Approval:
    """Shared gate for submit / checkout link: valid approval + immediate supplier re-check.

    On any problem the safe downgrade is committed and an AppError is raised;
    nothing is handed to a supplier.
    """
    _ensure_not_expired(db, intent, actor, request)
    if _demote_lapsed_approval(db, intent, actor, request):
        db.commit()
        raise ConflictError(MSG_APPROVAL_LAPSED, code="APPROVAL_EXPIRED")
    approval = active_approval(intent)
    if not approval_valid(intent, approval):
        reason = "האישור אינו תואם לתנאים הנוכחיים"
        _invalidate_approvals(db, intent, reason, actor, request)
        sm.transition(db, intent, sm.QUOTE_SELECTED, action="terms_changed", actor_user_id=actor, reason=reason,
                      request=request)
        db.commit()
        raise ConflictError("האישור אינו תואם לתנאים הנוכחיים. יש לבדוק מחיר ולאשר מחדש.", code="TERMS_CHANGED")
    assert approval is not None  # noqa: S101 - narrowed by approval_valid

    check = _apply_check(intent, _ask_supplier(db, intent, after_approval=True))
    if check.outcome == "unchanged":
        return approval
    if check.outcome == "changed":
        reason = _changed_reason(check)
        _invalidate_approvals(db, intent, reason, actor, request)
        sm.transition(db, intent, sm.QUOTE_SELECTED, action="price_changed" if check.price_changed else "terms_changed",
                      actor_user_id=actor, reason=reason, request=request,
                      details={"old_minor": check.old_minor, "new_minor": check.new_minor, "phase": "pre_submit"})
        db.commit()
        raise ConflictError(
            f"{reason}. ההזמנה לא נשלחה והאישור בוטל. יש לבדוק מחיר ולאשר מחדש.",
            code="PRICE_CHANGED" if check.price_changed else "TERMS_CHANGED",
            details={
                "old_price": {"amount": str(from_minor(check.old_minor, check.old_currency)), "currency": check.old_currency},
                "new_price": {"amount": str(from_minor(check.new_minor, check.new_currency)), "currency": check.new_currency},
            },
        )
    if check.outcome == "expired":
        _expire(db, intent, actor, request, check.message)
        db.commit()
        raise ConflictError(check.message, code="OFFER_EXPIRED")
    db.rollback()
    raise ServiceUnavailableError(f"{check.message} ההזמנה לא נשלחה.", code="REVALIDATION_FAILED")


# ------------------------------------------------------------------- submit ----


def _confirm(db: Session, intent: BookingIntent, reference: str | None, mode: str, actor: str | None,
             request: Request | None, *, action: str, reason: str, notes: str | None = None,
             demo: bool = False) -> None:
    """The only way to reach CONFIRMED — impossible without a supplier reference."""
    if not reference or not reference.strip():
        raise RuntimeError("CONFIRMED requires a supplier reference")
    intent.supplier_reference = reference
    intent.failure_reason = None
    sm.transition(db, intent, sm.CONFIRMED, action=action, actor_user_id=actor, reason=reason, request=request,
                  details={"supplier_reference": reference, "mode": mode})
    db.add(Reservation(
        booking_intent_id=intent.id,
        provider_id=intent.provider_id,
        supplier_reference=reference,
        mode=mode,
        status="CONFIRMED",
        amount_minor=intent.current_amount_minor,
        currency=intent.currency,
        confirmed_at=utcnow(),
        details={"title": _title(intent), "travelers": intent.travelers, "terms_hash": intent.terms_hash,
                 "is_simulation": mode == MODE_SIMULATION, "is_demo": demo or mode == MODE_SIMULATION,
                 "reference_verified": demo or mode == MODE_SIMULATION},
        notes=notes,
    ))
    if mode == MODE_SIMULATION:
        label = "סימולציה: ההזמנה אושרה"
    elif demo:
        label = "הדגמה: נרשמה אסמכתה של ספק לדוגמה"
    else:
        label = "נרשם אישור הזמנה מהספק"
    _notify_other_adults(db, actor, label, f"„{_title(intent)}” — אסמכתה {reference}.", intent)


def _fail(db: Session, intent: BookingIntent, message: str, actor: str | None, request: Request | None, *,
          action: str) -> None:
    intent.failure_reason = message[:500]
    sm.transition(db, intent, sm.FAILED, action=action, actor_user_id=actor, reason=message, request=request)
    _notify_other_adults(db, actor, "ההזמנה נכשלה", f"„{_title(intent)}”: {message}", intent)


def _mark_unknown(db: Session, intent: BookingIntent, actor: str | None, request: Request | None) -> None:
    intent.failure_reason = MSG_RECONCILE_REQUIRED
    sm.transition(db, intent, sm.UNKNOWN, action="unknown", actor_user_id=actor,
                  reason="לא התקבלה תשובה מהספק — התוצאה אינה ידועה", request=request)
    _notify_other_adults(db, actor, "הזמנה במצב לא ידוע",
                         f"„{_title(intent)}”: לא ידוע אם ההזמנה נקלטה אצל הספק. נדרש בירור.", intent)


def submit(db: Session, ctx: AuthContext, intent_id: str, idempotency_key: str, request: Request | None) -> BookingOut:
    intent = get_intent(db, intent_id)
    actor = ctx.user_id

    # 1. LIVE execution is refused unconditionally. `booking_live_execution` is deliberately NOT consulted:
    #    there is no authorized live executor, so no flag value can enable one.
    if intent.execution_mode == MODE_HOSTED:
        raise ConflictError("הזמנה זו מושלמת באתר הספק ולא נשלחת דרך המערכת. יש לפתוח את קישור הספק.",
                            code="USE_HOSTED_CHECKOUT")
    adapter = registry.find_adapter(intent.provider_id)
    if intent.execution_mode != MODE_SIMULATION or adapter is None or adapter.capabilities().mode != "DEMO":
        raise ForbiddenError(MSG_LIVE_DISABLED, code="LIVE_EXECUTION_DISABLED")

    # 2. Idempotency: the same key on this intent replays the recorded outcome and executes nothing.
    if intent.idempotency_key is not None and hmac.compare_digest(intent.idempotency_key, idempotency_key):
        if intent.state == sm.SUBMITTING:
            # A previous attempt died mid-flight. Never retry an ambiguous request: mark UNKNOWN.
            _mark_unknown(db, intent, actor, request)
            db.commit()
        record_audit(db, "booking.submit_replay", actor_user_id=actor, entity_type=ENTITY, entity_id=intent.id,
                     details={"state": intent.state}, request=request, commit=True)
        return to_out(db, intent, ctx, idempotent_replay=True,
                      notice="בקשה זו כבר טופלה. מוצגת התוצאה המקורית — לא בוצעה שליחה נוספת.")
    key_owner = db.scalar(select(BookingIntent.id).where(BookingIntent.idempotency_key == idempotency_key))
    ledger_owner = db.scalar(select(SimulatedSupplierBooking.booking_intent_id)
                             .where(SimulatedSupplierBooking.idempotency_key == idempotency_key))
    if (key_owner and key_owner != intent.id) or (ledger_owner and ledger_owner != intent.id):
        raise ConflictError("מפתח ה-idempotency כבר שימש להזמנה אחרת.", code="IDEMPOTENCY_KEY_REUSED")

    # 3. State + approval + immediate supplier re-check.
    _require_state(intent, (sm.APPROVED,), "לשלוח")
    approval = _recheck_before_handoff(db, intent, actor, request)

    # 4. Durable "we are about to send" marker, committed BEFORE the supplier is contacted.
    now = utcnow()
    intent.idempotency_key = idempotency_key
    intent.submitted_at = now
    approval.consumed_at = now
    sm.transition(db, intent, sm.SUBMITTING, action="submit", actor_user_id=actor, reason="נשלח לספק המדומה (סימולציה)",
                  request=request, details={"amount_minor": intent.current_amount_minor, "currency": intent.currency,
                                            "terms_hash": intent.terms_hash})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("מפתח ה-idempotency כבר שימש להזמנה אחרת.", code="IDEMPOTENCY_KEY_REUSED") from None

    # 5. Exactly one supplier call. No automatic retry, whatever happens.
    try:
        result = mock_supplier.create_booking(db, intent, idempotency_key, intent.simulation_scenario or "success")
    except mock_supplier.SupplierTimeout:
        _mark_unknown(db, intent, actor, request)
        db.commit()
        return to_out(db, intent, ctx, notice=MSG_RECONCILE_REQUIRED)
    except Exception as exc:
        log.error("mock supplier error for booking %s: %s", intent_id, type(exc).__name__)
        db.rollback()
        intent = get_intent(db, intent_id)
        _mark_unknown(db, intent, actor, request)
        db.commit()
        return to_out(db, intent, ctx, notice=MSG_RECONCILE_REQUIRED)

    if result.status == mock_supplier.STATUS_CONFIRMED and result.reference:
        _confirm(db, intent, result.reference, MODE_SIMULATION, actor, request, action="confirm",
                 reason="הספק המדומה אישר את ההזמנה (סימולציה)")
        notice = f"סימולציה הושלמה: התקבלה אסמכתה {result.reference}. לא בוצעה הזמנה אמיתית ולא בוצע חיוב."
    else:
        _fail(db, intent, mock_supplier.REJECTION_MESSAGE, actor, request, action="fail")
        notice = mock_supplier.REJECTION_MESSAGE
    db.commit()
    return to_out(db, intent, ctx, notice=notice)


def reconcile(db: Session, ctx: AuthContext, intent_id: str, request: Request | None) -> BookingOut:
    """Resolve UNKNOWN by asking the (mock) supplier what it has for our idempotency key."""
    intent = get_intent(db, intent_id)
    if intent.state != sm.UNKNOWN:
        label = sm.STATE_LABELS_HE.get(intent.state, intent.state)
        raise ConflictError(f"בירור מול הספק אפשרי רק כשהתוצאה אינה ידועה (המצב הנוכחי: „{label}”)",
                            code="INVALID_TRANSITION", details={"state": intent.state})
    record = mock_supplier.lookup(db, intent.idempotency_key) if intent.idempotency_key else None
    if record is not None and record.booking_intent_id != intent.id:
        record = None
    if record is not None and record.status == mock_supplier.STATUS_CONFIRMED and record.reference:
        _confirm(db, intent, record.reference, MODE_SIMULATION, ctx.user_id, request, action="reconcile",
                 reason="בירור מול הספק: ההזמנה נמצאה")
        notice = f"הבירור הושלם: ההזמנה נמצאה אצל הספק המדומה (אסמכתה {record.reference})."
    else:
        message = "הבירור הושלם: ההזמנה לא נמצאה אצל הספק. לא בוצעה הזמנה."
        _fail(db, intent, message, ctx.user_id, request, action="reconcile")
        notice = message
    db.commit()
    return to_out(db, intent, ctx, notice=notice)


# ------------------------------------------------------------------- cancel ----


def cancel(db: Session, ctx: AuthContext, intent_id: str, reason: str | None, request: Request | None) -> BookingOut:
    intent = get_intent(db, intent_id)
    if intent.state == sm.CONFIRMED:
        raise ConflictError(MSG_CANCEL_CONFIRMED, code="CANCEL_WITH_SUPPLIER")
    _require_state(intent, tuple(sorted(sm.PRE_SUBMISSION_STATES)), "לבטל")
    _ensure_not_expired(db, intent, ctx.user_id, request)
    text = (reason or "").strip() or "בוטל על ידי המשתמש"
    _invalidate_approvals(db, intent, "ההזמנה בוטלה", ctx.user_id, request)
    sm.transition(db, intent, sm.CANCELLED, action="cancel", actor_user_id=ctx.user_id, reason=text, request=request)
    db.commit()
    return to_out(db, intent, ctx, notice="הכנת ההזמנה בוטלה. לא נשלח דבר לספק.")


# ---------------------------------------------------------- hosted checkout ----


def _require_hosted(intent: BookingIntent) -> None:
    if intent.execution_mode != MODE_HOSTED:
        raise ConflictError("פעולה זו זמינה רק להזמנות שמושלמות באתר הספק.", code="NOT_HOSTED_CHECKOUT")


def _is_demo_hosted(intent: BookingIntent) -> bool:
    """HOSTED_CHECKOUT against a DEMO supplier (by adapter or by the snapshot's own label)."""
    if intent.execution_mode != MODE_HOSTED:
        return False
    if ((intent.offer_snapshot or {}).get("source") or {}).get("mode") == "DEMO":
        return True
    return demo_supplier.is_demo_adapter(registry.find_adapter(intent.provider_id))


def _handoff_url(db: Session, intent: BookingIntent, adapter: Any) -> tuple[str | None, str, bool]:
    """(url or None, instructions, is_demo). The URL is returned only when it passes the allowlist.

    * DEMO adapter: exactly ``/demo-supplier/checkout?ref=<the ref of the session we just opened>``.
      An https URL from a DEMO adapter is refused too — DEMO never navigates off this origin.
    * Any other adapter: ``adapter.is_allowed_deep_link`` (https + the provider's own domain allowlist).
      A relative URL can never pass it.
    """
    demo = demo_supplier.is_demo_adapter(adapter)
    if adapter is None or not registry.is_usable(adapter):
        return None, "", demo
    url: str | None = None
    instructions = ""
    try:
        offer = CanonicalOffer.model_validate(intent.offer_snapshot)
        if demo:
            if not _is_demo_hosted(intent) or not adapter.capabilities().supports_hosted_checkout:
                return None, "", demo
            ref = demo_supplier.ref_of(demo_supplier.open_session(db, intent))
            options = adapter.booking_options(offer, checkout_ref=ref)
            url, instructions = options.hosted_checkout_url, options.instructions
            if url != f"{demo_supplier.CHECKOUT_PATH}?ref={ref}":
                url = None
        else:
            options = adapter.booking_options(offer)
            url, instructions = options.hosted_checkout_url, options.instructions
    except Exception as exc:
        log.warning("booking options failed for booking %s: %s", intent.id, type(exc).__name__)
        return None, "", demo
    allowed = demo_supplier.is_demo_checkout_url(url) if demo else adapter.is_allowed_deep_link(url)
    return (url if allowed else None), instructions, demo


def checkout_link(db: Session, ctx: AuthContext, intent_id: str, request: Request | None) -> CheckoutLinkOut:
    intent = get_intent(db, intent_id)
    _require_hosted(intent)
    _require_state(intent, (sm.APPROVED,), "לפתוח את אתר הספק")
    _recheck_before_handoff(db, intent, ctx.user_id, request)
    adapter = registry.find_adapter(intent.provider_id)
    url, instructions, demo = _handoff_url(db, intent, adapter)
    if url is None:
        db.rollback()
        record_audit(db, "booking.checkout_link", actor_user_id=ctx.user_id, entity_type=ENTITY, entity_id=intent_id,
                     outcome="denied", details={"code": "CHECKOUT_LINK_UNAVAILABLE"}, request=request, commit=True)
        raise ConflictError("לא נמצא קישור מאושר לאתר הספק עבור הזמנה זו.", code="CHECKOUT_LINK_UNAVAILABLE")
    host = "in-app:demo-supplier" if demo else url.split("/")[2]
    record_audit(db, "booking.checkout_link", actor_user_id=ctx.user_id, entity_type=ENTITY, entity_id=intent.id,
                 details={"host": host, "provider_id": intent.provider_id, "demo": demo}, request=request)
    db.commit()
    if demo:
        warnings = [
            "דף ספק לדוגמה (DEMO) בתוך המערכת: אין תשלום, אין חיוב ואין הזמנה אמיתית.",
            "בסיום יוצג בדף הספק מספר אסמכתה לדוגמה. יש לחזור לכאן ולרשום אותו — עד אז ההזמנה אינה מאושרת.",
        ]
    else:
        warnings = [
            "ההזמנה והתשלום מתבצעים באתר הספק בלבד. יש לוודא שם שהמחיר והתנאים זהים למה שאושר.",
            "אחרי השלמת ההזמנה יש לחזור ולרשום כאן את אסמכתת הספק.",
        ]
    return CheckoutLinkOut(
        url=url,
        provider_id=intent.provider_id,
        provider_name=_provider_name(intent),
        instructions=instructions,
        warnings=warnings,
        is_demo=demo,
    )


def record_confirmation(db: Session, ctx: AuthContext, intent_id: str, supplier_reference: str, notes: str | None,
                        request: Request | None) -> BookingOut:
    """Record a booking the user completed on the supplier's own site.

    This records an external fact, so quote/approval TTLs are not re-checked;
    the intent must still be APPROVED with an approval that was never invalidated.

    * LIVE supplier: the reference is whatever the user typed — we cannot verify it (AUD-23, documented).
    * DEMO supplier: the reference MUST exist in the DEMO supplier's ledger, completed, for this very
      intent and its current terms. A mistyped / foreign / not-yet-issued reference is refused.
    """
    intent = get_intent(db, intent_id)
    _require_hosted(intent)
    _require_state(intent, (sm.APPROVED,), "לרשום אסמכתה")
    approval = active_approval(intent)
    if approval is None:
        raise ConflictError("אין אישור תקף להזמנה זו.", code="APPROVAL_REQUIRED")
    demo = _is_demo_hosted(intent)
    if demo:
        session = demo_supplier.find_completed(db, intent, supplier_reference)
        if session is None or not hmac.compare_digest(session.terms_hash, approval.terms_hash):
            raise ConflictError(
                "האסמכתה לא נמצאה אצל ספק ההדגמה עבור הזמנה זו. יש להשלים את התהליך בדף הספק לדוגמה "
                "ולהעתיק משם את האסמכתה בדיוק כפי שהיא מוצגת.",
                code="SUPPLIER_REFERENCE_NOT_FOUND",
            )
        supplier_reference = str(session.reference)
    duplicate = db.scalar(select(Reservation.id).where(Reservation.provider_id == intent.provider_id,
                                                       Reservation.supplier_reference == supplier_reference))
    if duplicate:
        raise ConflictError("אסמכתה זו כבר רשומה להזמנה אחרת.", code="REFERENCE_ALREADY_USED")
    now = utcnow()
    approval.consumed_at = now
    intent.submitted_at = now
    sm.transition(db, intent, sm.SUBMITTING, action="hosted_checkout_completed", actor_user_id=ctx.user_id,
                  reason="ההזמנה הושלמה בדף הספק לדוגמה (הדגמה)" if demo else "ההזמנה בוצעה באתר הספק", request=request)
    _confirm(db, intent, supplier_reference, MODE_HOSTED, ctx.user_id, request, action="record_confirmation",
             reason="אסמכתת ספק ההדגמה אומתה ונרשמה" if demo else "אסמכתת ספק נרשמה ידנית", notes=notes, demo=demo)
    db.commit()
    if demo:
        return to_out(db, intent, ctx, notice="אסמכתת ספק ההדגמה אומתה ונרשמה. לא בוצעה הזמנה אמיתית ולא בוצע חיוב.")
    return to_out(db, intent, ctx, notice="אסמכתת הספק נרשמה.")


# ------------------------------------------------- DEMO supplier page (in-app) ----


def _demo_session_or_404(db: Session, ref: str) -> tuple[SimulatedSupplierBooking, BookingIntent]:
    session = demo_supplier.get_session(db, ref)
    intent = db.get(BookingIntent, session.booking_intent_id) if session is not None else None
    if session is None or intent is None or not _is_demo_hosted(intent):
        raise NotFoundError("דף הספק לדוגמה לא נמצא. יש לפתוח אותו מחדש מתוך ההזמנה.", code="CHECKOUT_SESSION_NOT_FOUND")
    return session, intent


def _demo_session_open(intent: BookingIntent, session: SimulatedSupplierBooking, now: datetime) -> bool:
    """The DEMO supplier only sells what is approved right now: same terms, valid approval, live quote."""
    return (
        session.status == demo_supplier.STATUS_PENDING
        and intent.state == sm.APPROVED
        and demo_supplier.matches_intent(session, intent)
        and not _offer_expired(intent, now)
        and approval_valid(intent, active_approval(intent), now)
    )


def _demo_checkout_out(intent: BookingIntent, session: SimulatedSupplierBooking, ctx: AuthContext) -> DemoCheckoutOut:
    now = utcnow()
    completed = session.status == demo_supplier.STATUS_CONFIRMED and bool(session.reference)
    is_open = not completed and _demo_session_open(intent, session, now)
    recorded = completed and intent.state == sm.CONFIRMED and intent.supplier_reference == session.reference
    if recorded:
        status, message = "COMPLETED", "האסמכתה כבר נרשמה בהזמנה. אין צורך בפעולה נוספת."
    elif completed:
        status = "COMPLETED"
        message = ("התהליך בדף הספק לדוגמה הושלם. ההזמנה עדיין אינה מאושרת במערכת: יש להעתיק את האסמכתה, "
                   "לחזור להזמנה ולרשום אותה שם.")
    elif is_open:
        status, message = "OPEN", "זהו דף ספק לדוגמה. לחיצה על הכפתור מדמה השלמת הזמנה אצל הספק — בלי תשלום ובלי חיוב."
    else:
        status = "EXPIRED"
        message = "הדף הזה כבר אינו תקף: ההזמנה או התנאים המאושרים השתנו. יש לחזור להזמנה ולפתוח את דף הספק מחדש."
    show_terms = completed or is_open
    return DemoCheckoutOut(
        ref=demo_supplier.ref_of(session),
        status=status,
        provider_id=session.provider_id,
        provider_name=_provider_name(intent),
        booking_id=intent.id,
        title=_title(intent),
        summary=build_terms_summary(intent.offer_snapshot, intent.travelers, intent.current_amount_minor, intent.currency,
                                    intent.execution_mode) if show_terms and demo_supplier.matches_intent(session, intent) else [],
        price=_money(session.amount_minor, session.currency),
        supplier_reference=session.reference if completed else None,
        recorded=recorded,
        can_complete=is_open and ctx.can_book,
        message=message,
    )


def demo_checkout_view(db: Session, ctx: AuthContext, ref: str) -> DemoCheckoutOut:
    """Read-only view for the in-app DEMO supplier page. Changes nothing."""
    session, intent = _demo_session_or_404(db, ref)
    return _demo_checkout_out(intent, session, ctx)


def demo_checkout_complete(db: Session, ctx: AuthContext, ref: str, request: Request | None) -> DemoCheckoutOut:
    """"Simulate completing at the supplier": the DEMO supplier issues a reference.

    Deliberately does NOT touch the booking intent — it stays APPROVED (waiting for the
    supplier reference) until ``record_confirmation`` verifies and records that reference.
    """
    session, intent = _demo_session_or_404(db, ref)
    if session.status != demo_supplier.STATUS_CONFIRMED:
        if not _demo_session_open(intent, session, utcnow()):
            raise ConflictError(
                "דף הספק לדוגמה כבר אינו תקף: ההזמנה או התנאים המאושרים השתנו. יש לחזור להזמנה ולפתוח את דף הספק מחדש.",
                code="CHECKOUT_SESSION_EXPIRED",
            )
        if demo_supplier.complete(db, session):
            record_audit(db, "booking.demo_supplier_completed", actor_user_id=ctx.user_id, entity_type=ENTITY,
                         entity_id=intent.id, details={"provider_id": intent.provider_id, "demo": True}, request=request)
        db.commit()
    return _demo_checkout_out(intent, session, ctx)


# ------------------------------------------------------------------ outputs ----


def _money(amount_minor: int, currency: str) -> Money:
    return Money(amount=from_minor(amount_minor, currency), currency=currency)


def _provider_name(intent: BookingIntent) -> str:
    return str(((intent.offer_snapshot or {}).get("source") or {}).get("provider_name") or intent.provider_id)


def _can(intent: BookingIntent, ctx: AuthContext, approval: Approval | None, now: datetime) -> BookingCan:
    if not ctx.can_book:
        return BookingCan()
    state = intent.state
    live = not (state in sm.EXPIRABLE_STATES and _offer_expired(intent, now))
    valid = approval_valid(intent, approval, now)
    simulation = intent.execution_mode == MODE_SIMULATION
    hosted = intent.execution_mode == MODE_HOSTED
    return BookingCan(
        edit_travelers=live and state in sm.EXPIRABLE_STATES,
        revalidate=live and state in sm.EXPIRABLE_STATES,
        approve=live and state == sm.READY_FOR_APPROVAL and _revalidation_fresh(intent, now),
        submit=live and simulation and state == sm.APPROVED and valid,
        reconcile=state == sm.UNKNOWN,
        cancel=live and state in sm.PRE_SUBMISSION_STATES,
        record_confirmation=hosted and state == sm.APPROVED and approval is not None,
        open_checkout=live and hosted and state == sm.APPROVED and valid,
    )


def _occupancy(details: dict[str, Any]) -> int | None:
    kind = details.get("kind")
    if kind == "flight":
        return sum(int(v or 0) for v in (details.get("passengers") or {}).values())
    if kind == "hotel":
        return int(details.get("adults") or 0) + int(details.get("children") or 0)
    if kind == "activity":
        return sum(int(v or 0) for v in (details.get("participants") or {}).values()) or None
    return None


def _warnings(intent: BookingIntent, approval: Approval | None, now: datetime) -> list[str]:
    out: list[str] = []
    snapshot = intent.offer_snapshot or {}
    if intent.execution_mode == MODE_SIMULATION:
        out.append("מצב סימולציה: נתוני הדגמה בלבד. לא תתבצע הזמנה אמיתית ולא יבוצע חיוב.")
    elif intent.execution_mode == MODE_HOSTED and _is_demo_hosted(intent):
        out.append("ספק הדגמה: ההשלמה מתבצעת בדף ספק לדוגמה בתוך המערכת. לא תתבצע הזמנה אמיתית ולא יבוצע חיוב.")
    elif intent.execution_mode == MODE_HOSTED:
        out.append("ההזמנה והתשלום מתבצעים באתר הספק בלבד. המערכת אינה מבצעת הזמנות אמיתיות.")
    else:
        out.append(MSG_LIVE_DISABLED)
    state = intent.state
    if state == sm.UNKNOWN:
        out.append(MSG_RECONCILE_REQUIRED)
    if state in sm.EXPIRABLE_STATES and _offer_expired(intent, now):
        out.append(MSG_OFFER_EXPIRED)
    if intent.current_amount_minor != intent.quoted_amount_minor and state not in sm.TERMINAL_STATES:
        out.append(f"המחיר השתנה מאז ההצעה המקורית: {format_money(intent.quoted_amount_minor, intent.currency)} ← "
                   f"{format_money(intent.current_amount_minor, intent.currency)}.")
    if state == sm.APPROVED and not approval_valid(intent, approval, now):
        out.append(MSG_APPROVAL_LAPSED)
    if state == sm.READY_FOR_APPROVAL and not _revalidation_fresh(intent, now):
        out.append("בדיקת המחיר האחרונה אינה עדכנית. יש לבדוק מחיר מחדש לפני האישור.")
    if (snapshot.get("price") or {}).get("total_status") == "estimated":
        out.append("המחיר הוא הערכה של הספק ולא מחיר סופי.")
    expected = _occupancy(snapshot.get("details") or {})
    if expected is not None and expected != len(intent.travelers or []) and state not in sm.TERMINAL_STATES:
        out.append(f"ההצעה תומחרה עבור {expected} נוסעים, אך נבחרו {len(intent.travelers or [])}.")
    if state == sm.APPROVED and intent.execution_mode == MODE_HOSTED:
        out.append(f"{MSG_AWAITING_SUPPLIER}. ההזמנה אינה מאושרת עד שתירשם כאן אסמכתת הספק.")
    if state == sm.CONFIRMED and intent.execution_mode == MODE_SIMULATION:
        out.append("האסמכתה שייכת לספק מדומה ואינה תקפה אצל שום ספק אמיתי.")
    if state == sm.CONFIRMED and intent.execution_mode == MODE_HOSTED:
        if _is_demo_hosted(intent):
            out.append("האסמכתה שייכת לספק הדגמה ואינה תקפה אצל שום ספק אמיתי. לא בוצעה הזמנה אמיתית ולא בוצע חיוב.")
        else:
            out.append("האסמכתה הוזנה ידנית ולא אומתה מול הספק.")
    return out


def _state_label(intent: BookingIntent) -> str:
    # A hosted-checkout intent that is merely APPROVED must never read as a confirmed booking.
    if intent.state == sm.APPROVED and intent.execution_mode == MODE_HOSTED:
        return MSG_AWAITING_SUPPLIER
    return sm.STATE_LABELS_HE.get(intent.state, intent.state)


def _summary_fields(intent: BookingIntent) -> dict[str, Any]:
    return {
        "id": intent.id,
        "state": intent.state,
        "state_label": _state_label(intent),
        "category": intent.category,
        "title": _title(intent),
        "provider_id": intent.provider_id,
        "provider_name": _provider_name(intent),
        "execution_mode": intent.execution_mode,
        "is_simulation": intent.execution_mode == MODE_SIMULATION,
        "is_demo": ((intent.offer_snapshot or {}).get("source") or {}).get("mode") == "DEMO",
        "current_price": _money(intent.current_amount_minor, intent.currency),
        "price_changed": intent.current_amount_minor != intent.quoted_amount_minor,
        "offer_expired": intent.state in sm.EXPIRABLE_STATES and _offer_expired(intent),
        "travelers_count": len(intent.travelers or []),
        "supplier_reference": intent.supplier_reference,
        "trip_id": intent.trip_id,
        "created_at": intent.created_at,
        "updated_at": intent.updated_at,
    }


def to_out(db: Session, intent: BookingIntent, ctx: AuthContext, *, notice: str | None = None,
           idempotent_replay: bool = False) -> BookingOut:
    now = utcnow()
    approvals = sorted(intent.approvals, key=lambda a: a.created_at)
    shown = active_approval(intent) or (approvals[-1] if approvals else None)
    history = list(intent.history or [])
    user_ids = {h.get("by") for h in history} | {intent.created_by_id, shown.approved_by_id if shown else None}
    user_ids.discard(None)
    names = dict(db.execute(select(User.id, User.display_name).where(User.id.in_(user_ids))).all()) if user_ids else {}
    reservation = db.scalar(select(Reservation).where(Reservation.booking_intent_id == intent.id))
    return BookingOut(
        **_summary_fields(intent),
        offer_id=intent.offer_id,
        offer=intent.offer_snapshot,
        travelers=[TravelerOut(**t) for t in intent.travelers or []],
        quoted_price=_money(intent.quoted_amount_minor, intent.currency),
        simulation_scenario=intent.simulation_scenario,
        terms_hash=current_terms_hash(intent),
        terms_summary=build_terms_summary(intent.offer_snapshot, intent.travelers, intent.current_amount_minor,
                                          intent.currency, intent.execution_mode),
        approval=ApprovalOut(
            id=shown.id,
            approved_by_id=shown.approved_by_id,
            approved_by=names.get(shown.approved_by_id),
            approved_at=shown.created_at,
            expires_at=shown.expires_at,
            amount=_money(shown.approved_amount_minor, shown.currency),
            terms_hash=shown.terms_hash,
            valid=approval_valid(intent, shown, now),
            invalidated_at=shown.invalidated_at,
            invalidation_reason=shown.invalidation_reason,
            consumed_at=shown.consumed_at,
        ) if shown else None,
        can=_can(intent, ctx, shown, now),
        history=[HistoryEntry(**{**h, "by_name": names.get(h.get("by"))}) for h in history],
        failure_reason=intent.failure_reason,
        reservation=ReservationOut(
            id=reservation.id,
            supplier_reference=reservation.supplier_reference,
            mode=reservation.mode,
            status=reservation.status,
            amount=_money(reservation.amount_minor, reservation.currency),
            confirmed_at=reservation.confirmed_at,
            notes=reservation.notes,
        ) if reservation else None,
        revalidated_at=intent.revalidated_at,
        revalidation_fresh=_revalidation_fresh(intent, now),
        offer_expires_at=intent.offer_expires_at,
        submitted_at=intent.submitted_at,
        created_by_id=intent.created_by_id,
        created_by=names.get(intent.created_by_id),
        version=intent.version,
        warnings=_warnings(intent, shown, now),
        notice=notice,
        idempotent_replay=idempotent_replay,
    )


def list_intents(db: Session, *, state: str | None, page: int, page_size: int) -> Page[BookingSummary]:
    cond = []
    if state is not None:
        if state not in BOOKING_STATES:
            raise BadRequestError("מצב הזמנה לא מוכר", code="INVALID_STATE_FILTER")
        cond.append(BookingIntent.state == state)
    total = int(db.scalar(select(func.count()).select_from(BookingIntent).where(*cond)) or 0)
    rows = db.scalars(
        select(BookingIntent).where(*cond).order_by(BookingIntent.created_at.desc(), BookingIntent.id)
        .offset((page - 1) * page_size).limit(page_size)
    )
    return Page[BookingSummary](items=[BookingSummary(**_summary_fields(r)) for r in rows], total=total, page=page,
                                page_size=page_size)

