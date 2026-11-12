"""DEMO supplier-hosted checkout (docs/security/booking-safety.md §5). Never talks to a network.

A DEMO provider that declares ``supports_hosted_checkout`` sends the user to an
**in-app** page that plays the role of the supplier's own site:
``/demo-supplier/checkout?ref=<opaque>``. No payment, no card fields, no charge.

The DEMO supplier keeps its checkout sessions in its own ledger
(``simulated_supplier_bookings``; ``idempotency_key = "checkout:<ref>"``,
``scenario = "hosted_checkout"``):

* ``PENDING``   — the session was opened by ``POST /api/bookings/{id}/checkout-link``.
* ``CONFIRMED`` — the user pressed "complete at supplier" on the DEMO page; the
  supplier minted a reference (``DEMO-XXXXXXXXXX``).
* ``VOID``      — superseded because the approved terms changed.

Completing the session does NOT touch the booking intent. The intent stays
APPROVED ("waiting for completion on the supplier's site") until an authorized
adult records the supplier's reference, and that reference is verified against
this ledger (``find_completed``).
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import BookingIntent, SimulatedSupplierBooking

# The ONLY relative URL the booking service will ever hand out, and only for DEMO adapters.
CHECKOUT_PATH = "/demo-supplier/checkout"
CHECKOUT_URL_RE = re.compile(r"/demo-supplier/checkout\?ref=[A-Za-z0-9_-]{16,64}")
REF_RE = re.compile(r"[A-Za-z0-9_-]{16,64}")

SCENARIO = "hosted_checkout"
KEY_PREFIX = "checkout:"
STATUS_PENDING = "PENDING"
STATUS_CONFIRMED = "CONFIRMED"
STATUS_VOID = "VOID"
REFERENCE_PREFIX = "DEMO-"


def is_demo_checkout_url(url: Any) -> bool:
    """Exact match of ``^/demo-supplier/checkout\\?ref=[A-Za-z0-9_-]{16,64}$`` (no trailing newline, nothing else)."""
    return isinstance(url, str) and CHECKOUT_URL_RE.fullmatch(url) is not None


def is_demo_adapter(adapter: Any) -> bool:
    try:
        return adapter is not None and adapter.capabilities().mode == "DEMO"
    except Exception:
        return False


def offers_demo_checkout(adapter: Any, options: Any) -> bool:
    """A DEMO adapter that declares hosted checkout + revalidation and returns a well-formed in-app URL."""
    try:
        caps = adapter.capabilities()
    except Exception:
        return False
    return (
        caps.mode == "DEMO"
        and bool(caps.supports_hosted_checkout)
        and bool(caps.supports_revalidate)
        and is_demo_checkout_url(getattr(options, "hosted_checkout_url", None))
    )


def new_ref() -> str:
    return secrets.token_urlsafe(24)  # 32 characters of [A-Za-z0-9_-]


def _key(ref: str) -> str:
    return KEY_PREFIX + ref


def _reference(ref: str) -> str:
    # Deterministic per session, so completing twice can never mint a second reference.
    return REFERENCE_PREFIX + hashlib.sha256(f"ori-demo-checkout:{ref}".encode()).hexdigest()[:10].upper()


def get_session(db: Session, ref: str) -> SimulatedSupplierBooking | None:
    if not isinstance(ref, str) or REF_RE.fullmatch(ref) is None:
        return None
    return db.scalar(select(SimulatedSupplierBooking).where(
        SimulatedSupplierBooking.idempotency_key == _key(ref), SimulatedSupplierBooking.scenario == SCENARIO))


def ref_of(session: SimulatedSupplierBooking) -> str:
    return session.idempotency_key[len(KEY_PREFIX):]


def matches_intent(session: SimulatedSupplierBooking, intent: BookingIntent) -> bool:
    """The session was opened for exactly the terms the intent has now."""
    return (
        session.booking_intent_id == intent.id
        and session.provider_id == intent.provider_id
        and hmac.compare_digest(session.terms_hash, intent.terms_hash or "")
        and session.amount_minor == intent.current_amount_minor
        and session.currency == intent.currency
    )


def open_session(db: Session, intent: BookingIntent) -> SimulatedSupplierBooking:
    """Return the intent's open session for its CURRENT terms, creating one if needed. Flushes; caller commits.

    Open sessions for older terms are voided, so a stale tab can never complete them.
    """
    if intent.execution_mode != "HOSTED_CHECKOUT":
        raise RuntimeError("DEMO supplier checkout may only be used for HOSTED_CHECKOUT intents")
    rows = db.scalars(select(SimulatedSupplierBooking).where(
        SimulatedSupplierBooking.booking_intent_id == intent.id, SimulatedSupplierBooking.scenario == SCENARIO)
        .order_by(SimulatedSupplierBooking.created_at.desc())).all()
    current: SimulatedSupplierBooking | None = None
    for row in rows:
        if row.status == STATUS_VOID:
            continue
        if current is None and matches_intent(row, intent):
            current = row  # PENDING, or already completed at the supplier for these exact terms
        elif row.status == STATUS_PENDING:
            row.status = STATUS_VOID
    if current is None:
        current = SimulatedSupplierBooking(
            idempotency_key=_key(new_ref()),
            booking_intent_id=intent.id,
            provider_id=intent.provider_id,
            status=STATUS_PENDING,
            reference=None,
            terms_hash=intent.terms_hash or "",
            amount_minor=intent.current_amount_minor,
            currency=intent.currency,
            scenario=SCENARIO,
        )
        db.add(current)
    db.flush()
    return current


def complete(db: Session, session: SimulatedSupplierBooking) -> bool:
    """Supplier side of "the customer finished checkout". Idempotent; returns True when newly completed."""
    if session.status == STATUS_CONFIRMED and session.reference:
        return False
    if session.status != STATUS_PENDING:
        raise RuntimeError("checkout session is not open")
    session.status = STATUS_CONFIRMED
    session.reference = _reference(ref_of(session))
    db.flush()
    return True


def find_completed(db: Session, intent: BookingIntent, reference: str) -> SimulatedSupplierBooking | None:
    """The completed DEMO-supplier session that issued ``reference`` for THIS intent's current terms, if any."""
    wanted = (reference or "").strip().upper()
    if not wanted.startswith(REFERENCE_PREFIX):
        return None
    rows = db.scalars(select(SimulatedSupplierBooking).where(
        SimulatedSupplierBooking.booking_intent_id == intent.id,
        SimulatedSupplierBooking.scenario == SCENARIO,
        SimulatedSupplierBooking.status == STATUS_CONFIRMED,
    )).all()
    for row in rows:
        if row.reference and hmac.compare_digest(row.reference, wanted) and matches_intent(row, intent):
            return row
    return None
