"""MOCK supplier for booking simulation. Never talks to a network.

It behaves like a real supplier's booking endpoint from the caller's point of
view: requests carry an idempotency key, the supplier keeps its own ledger
(``SimulatedSupplierBooking``) and can be queried later by that key — which is
what reconciliation of an UNKNOWN outcome relies on.

Scenarios:
* ``success`` (also ``price_change`` / ``expired`` once they reach submission) —
  booking created, reference ``SIM-XXXXXX`` returned.
* ``supplier_failure`` — supplier rejects; nothing is booked.
* ``timeout_unknown`` — supplier DOES create the booking, but the response is
  lost (``SupplierTimeout``); the caller cannot know the outcome.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import BookingIntent, SimulatedSupplierBooking

SCENARIOS = ("success", "price_change", "expired", "supplier_failure", "timeout_unknown")
STATUS_CONFIRMED = "CONFIRMED"
STATUS_REJECTED = "REJECTED"
REJECTION_MESSAGE = "הספק המדומה דחה את ההזמנה (תרחיש סימולציה: כשל ספק). לא בוצעה הזמנה ולא בוצע חיוב."


class SupplierTimeout(Exception):
    """The request was sent but no response arrived — outcome unknown."""


@dataclass(frozen=True)
class SupplierResult:
    status: str  # CONFIRMED / REJECTED
    reference: str | None
    replayed: bool = False


def _reference(idempotency_key: str) -> str:
    # Deterministic per key so a replay can never mint a second reference.
    return "SIM-" + hashlib.sha256(f"ori-sim:{idempotency_key}".encode()).hexdigest()[:6].upper()


def lookup(db: Session, idempotency_key: str) -> SimulatedSupplierBooking | None:
    """Supplier-side lookup by idempotency key (used by reconcile)."""
    return db.scalar(select(SimulatedSupplierBooking).where(SimulatedSupplierBooking.idempotency_key == idempotency_key))


def _result(record: SimulatedSupplierBooking, *, replayed: bool) -> SupplierResult:
    return SupplierResult(status=record.status, reference=record.reference, replayed=replayed)


def create_booking(db: Session, intent: BookingIntent, idempotency_key: str, scenario: str) -> SupplierResult:
    """Create (or replay) a simulated supplier booking. Flushes; the caller commits."""
    if intent.execution_mode != "SIMULATION":
        raise RuntimeError("mock supplier may only be used for SIMULATION intents")
    existing = lookup(db, idempotency_key)
    if existing is not None:
        if existing.booking_intent_id != intent.id:
            raise RuntimeError("idempotency key belongs to another booking")
        return _result(existing, replayed=True)
    rejected = scenario == "supplier_failure"
    record = SimulatedSupplierBooking(
        idempotency_key=idempotency_key,
        booking_intent_id=intent.id,
        provider_id=intent.provider_id,
        status=STATUS_REJECTED if rejected else STATUS_CONFIRMED,
        reference=None if rejected else _reference(idempotency_key),
        terms_hash=intent.terms_hash or "",
        amount_minor=intent.current_amount_minor,
        currency=intent.currency,
        scenario=scenario,
    )
    db.add(record)
    db.flush()
    if scenario == "timeout_unknown":
        raise SupplierTimeout
    return _result(record, replayed=False)
