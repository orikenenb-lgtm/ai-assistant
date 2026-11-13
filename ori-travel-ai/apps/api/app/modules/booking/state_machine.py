"""Booking state machine — the ONLY place where ``BookingIntent.state`` may change.

The transition table mirrors docs/security/booking-safety.md §1 exactly.
``transition()`` validates the move, appends to ``history`` and writes an audit
event. A SQLAlchemy attribute listener rejects any assignment to
``BookingIntent.state`` made outside ``transition()`` (defence in depth: a
future code path cannot bypass the table by accident).
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from fastapi import Request
from sqlalchemy import event
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import NEVER_SET, NO_VALUE

from app.core.audit import record_audit
from app.core.db import utcnow
from app.core.errors import ConflictError
from app.models.booking import BOOKING_STATES, BookingIntent

DRAFT = "DRAFT"
QUOTE_SELECTED = "QUOTE_SELECTED"
REVALIDATING = "REVALIDATING"
READY_FOR_APPROVAL = "READY_FOR_APPROVAL"
APPROVED = "APPROVED"
SUBMITTING = "SUBMITTING"
CONFIRMED = "CONFIRMED"
EXPIRED = "EXPIRED"
FAILED = "FAILED"
UNKNOWN = "UNKNOWN"
CANCELLED = "CANCELLED"

# Exactly the transitions allowed by the binding specification.
TRANSITIONS: dict[str, frozenset[str]] = {
    DRAFT: frozenset({QUOTE_SELECTED, CANCELLED}),
    QUOTE_SELECTED: frozenset({REVALIDATING, CANCELLED, EXPIRED}),
    REVALIDATING: frozenset({READY_FOR_APPROVAL, QUOTE_SELECTED, EXPIRED, FAILED}),
    READY_FOR_APPROVAL: frozenset({APPROVED, QUOTE_SELECTED, CANCELLED, EXPIRED}),
    APPROVED: frozenset({SUBMITTING, QUOTE_SELECTED, READY_FOR_APPROVAL, CANCELLED, EXPIRED}),
    SUBMITTING: frozenset({CONFIRMED, FAILED, UNKNOWN}),
    UNKNOWN: frozenset({CONFIRMED, FAILED}),  # only through reconcile
    CONFIRMED: frozenset(),
    EXPIRED: frozenset(),
    FAILED: frozenset(),
    CANCELLED: frozenset(),
}
assert set(TRANSITIONS) == set(BOOKING_STATES)  # noqa: S101 - import-time invariant

TERMINAL_STATES = frozenset(s for s, targets in TRANSITIONS.items() if not targets)
# States in which nothing has been sent to any supplier yet.
PRE_SUBMISSION_STATES = frozenset({DRAFT, QUOTE_SELECTED, READY_FOR_APPROVAL, APPROVED})
# States that may still expire (they have an EXPIRED edge and are stable at rest).
EXPIRABLE_STATES = frozenset({QUOTE_SELECTED, READY_FOR_APPROVAL, APPROVED})

STATE_LABELS_HE = {
    DRAFT: "טיוטה",
    QUOTE_SELECTED: "נבחרה הצעה",
    REVALIDATING: "בבדיקת מחיר",
    READY_FOR_APPROVAL: "ממתין לאישור",
    APPROVED: "מאושר",
    SUBMITTING: "בשליחה",
    CONFIRMED: "אושר על ידי הספק",
    EXPIRED: "פג תוקף",
    FAILED: "נכשל",
    UNKNOWN: "לא ידוע — נדרש בירור",
    CANCELLED: "בוטל",
}

_in_transition: ContextVar[bool] = ContextVar("booking_in_transition", default=False)


class DirectStateAssignmentError(RuntimeError):
    """Raised when code tries to set BookingIntent.state outside transition()."""


@event.listens_for(BookingIntent.state, "set", propagate=True)
def _guard_state_assignment(target: BookingIntent, value: Any, oldvalue: Any, _initiator: Any) -> None:
    if _in_transition.get():
        return
    if oldvalue in (NO_VALUE, NEVER_SET, None) and value == DRAFT:
        return  # a brand new intent always starts as DRAFT
    raise DirectStateAssignmentError("BookingIntent.state may only be changed through booking.state_machine.transition()")


def can_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, frozenset())


def transition(
    db: Session,
    intent: BookingIntent,
    target: str,
    *,
    action: str,
    actor_user_id: str | None,
    reason: str | None = None,
    request: Request | None = None,
    details: dict[str, Any] | None = None,
) -> BookingIntent:
    """Move ``intent`` to ``target`` or raise ``ConflictError(INVALID_TRANSITION)``.

    Appends ``{from, to, at, by, reason}`` to the history and records the audit
    event ``booking.<action>``. The caller commits.
    """
    current = intent.state
    if not can_transition(current, target):
        raise ConflictError(
            f"לא ניתן לעבור ממצב „{STATE_LABELS_HE.get(current, current)}” למצב „{STATE_LABELS_HE.get(target, target)}”",
            code="INVALID_TRANSITION",
            details={"from": current, "to": target},
        )
    token = _in_transition.set(True)
    try:
        intent.state = target
    finally:
        _in_transition.reset(token)
    # Re-assign (not mutate) so SQLAlchemy detects the JSON change.
    intent.history = [
        *(intent.history or []),
        {"from": current, "to": target, "at": utcnow().isoformat(), "by": actor_user_id, "reason": reason},
    ]
    record_audit(
        db,
        f"booking.{action}",
        actor_user_id=actor_user_id,
        entity_type="booking_intent",
        entity_id=intent.id,
        details={"from": current, "to": target, "reason": reason, **(details or {})},
        request=request,
    )
    return intent
