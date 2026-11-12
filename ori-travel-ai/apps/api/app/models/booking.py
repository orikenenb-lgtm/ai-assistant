"""Booking preparation: intents, approvals and reservations.

State machine (see docs/security/booking-safety.md):
DRAFT -> QUOTE_SELECTED -> REVALIDATING -> READY_FOR_APPROVAL -> APPROVED
      -> SUBMITTING -> CONFIRMED
plus terminal/side states EXPIRED, FAILED, UNKNOWN, CANCELLED.
Real booking execution is OFF in V1 (simulation + provider-hosted checkout only).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime
from app.models._common import JSONType, created_at_col, pk, updated_at_col

BOOKING_STATES = (
    "DRAFT",
    "QUOTE_SELECTED",
    "REVALIDATING",
    "READY_FOR_APPROVAL",
    "APPROVED",
    "SUBMITTING",
    "CONFIRMED",
    "EXPIRED",
    "FAILED",
    "UNKNOWN",
    "CANCELLED",
)


class BookingIntent(Base):
    __tablename__ = "booking_intents"

    id: Mapped[str] = pk()
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    offer_id: Mapped[str | None] = mapped_column(
        ForeignKey("offers.id", ondelete="SET NULL"), nullable=True
    )
    trip_id: Mapped[str | None] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # SIMULATION (mock supplier) / HOSTED_CHECKOUT (provider deep link) / LIVE (disabled)
    execution_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="SIMULATION")
    # Canonical offer snapshot the user selected (exact bundle/fare/room)
    offer_snapshot: Mapped[dict] = mapped_column(JSONType, nullable=False)
    # [{family_member_id, display_name, age_group}] — no document numbers here
    travelers: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    quoted_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    current_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    state: Mapped[str] = mapped_column(String(24), nullable=False, default="DRAFT", index=True)
    # Hash binding exact offer + travelers + price + currency + supplier + dates + terms
    terms_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    revalidated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    offer_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    supplier_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Simulation scenario for the mock supplier (success/price_change/...)
    simulation_scenario: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # State history [{from, to, at, by, reason}]
    history: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    # Optimistic concurrency control
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __mapper_args__ = {"version_id_col": version}

    approvals: Mapped[list[Approval]] = relationship(
        back_populates="booking_intent", cascade="all, delete-orphan", passive_deletes=True
    )


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = pk()
    booking_intent_id: Mapped[str] = mapped_column(
        ForeignKey("booking_intents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    approved_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    terms_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    approved_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # Human readable summary of exactly what was approved (Hebrew)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    invalidated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    invalidation_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    booking_intent: Mapped[BookingIntent] = relationship(back_populates="approvals")


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[str] = pk()
    booking_intent_id: Mapped[str] = mapped_column(
        ForeignKey("booking_intents.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Supplier confirmation reference is mandatory for CONFIRMED reservations.
    supplier_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    # SIMULATION / HOSTED_CHECKOUT (manually recorded) / LIVE
    mode: Mapped[str] = mapped_column(String(24), nullable=False)
    # CONFIRMED (verified against the supplier ledger) / RECORDED_UNVERIFIED (user-typed, LIVE hosted checkout)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="CONFIRMED")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    confirmed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    details: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = created_at_col()


class SimulatedSupplierBooking(Base):
    """The MOCK supplier's own ledger (simulation only — never a real booking).

    Persisted so that idempotency and UNKNOWN reconciliation survive restarts:
    the mock supplier looks requests up by the client idempotency key exactly
    like a real supplier would.
    """

    __tablename__ = "simulated_supplier_bookings"

    id: Mapped[str] = pk()
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    booking_intent_id: Mapped[str] = mapped_column(
        ForeignKey("booking_intents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # CONFIRMED (supplier created the booking) / REJECTED (supplier refused)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # Supplier reference, e.g. SIM-1A2B3C; only present for CONFIRMED records
    reference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    terms_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    scenario: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = created_at_col()
