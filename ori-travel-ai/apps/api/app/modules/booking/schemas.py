"""Request/response schemas for the booking-preparation API (contract §3.5)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field, field_validator

from app.schemas.common import ApiModel, Money

ExecutionMode = Literal["SIMULATION", "HOSTED_CHECKOUT", "LIVE"]
SimulationScenario = Literal["success", "price_change", "expired", "supplier_failure", "timeout_unknown"]
MemberId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class _Request(ApiModel):
    # Unknown fields (e.g. "state", "price", "supplier_reference") are rejected, never ignored.
    model_config = ConfigDict(extra="forbid")


def _unique(ids: list[str]) -> list[str]:
    if len(set(ids)) != len(ids):
        raise ValueError("אותו נוסע מופיע יותר מפעם אחת")
    return ids


class BookingCreate(_Request):
    offer_id: str = Field(..., min_length=1, max_length=64)
    traveler_member_ids: list[MemberId] = Field(..., min_length=1, max_length=9)
    trip_id: str | None = Field(None, min_length=1, max_length=64)
    simulation_scenario: SimulationScenario | None = None

    _u = field_validator("traveler_member_ids")(_unique)


class TravelersUpdate(_Request):
    traveler_member_ids: list[MemberId] = Field(..., min_length=1, max_length=9)

    _u = field_validator("traveler_member_ids")(_unique)


class ApproveRequest(_Request):
    terms_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    password: str = Field(..., min_length=1, max_length=256)
    # Must be literally true: an explicit human confirmation.
    confirm: Literal[True]


class SubmitRequest(_Request):
    idempotency_key: str = Field(..., min_length=36, max_length=36)

    @field_validator("idempotency_key")
    @classmethod
    def _uuid(cls, v: str) -> str:
        try:
            parsed = uuid.UUID(v)
        except ValueError as exc:
            raise ValueError("מפתח idempotency חייב להיות UUID תקין") from exc
        if str(parsed) != v.lower():
            raise ValueError("מפתח idempotency חייב להיות UUID תקין")
        return str(parsed)


class CancelRequest(_Request):
    reason: str | None = Field(None, max_length=300)


class RecordConfirmationRequest(_Request):
    supplier_reference: str = Field(..., min_length=4, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    notes: str | None = Field(None, max_length=1000)


# ------------------------------------------------------------------ responses ----


class TravelerOut(ApiModel):
    family_member_id: str
    display_name: str
    age_group: str
    is_minor: bool = False


class ApprovalOut(ApiModel):
    id: str
    approved_by_id: str | None
    approved_by: str | None  # display name
    approved_at: datetime
    expires_at: datetime
    amount: Money
    terms_hash: str
    valid: bool
    invalidated_at: datetime | None = None
    invalidation_reason: str | None = None
    consumed_at: datetime | None = None


class BookingCan(ApiModel):
    """Server-computed permissions for the CURRENT user in the CURRENT state."""

    edit_travelers: bool = False
    revalidate: bool = False
    approve: bool = False
    submit: bool = False
    reconcile: bool = False
    cancel: bool = False
    record_confirmation: bool = False
    open_checkout: bool = False


class HistoryEntry(ApiModel):
    from_state: str | None = Field(None, alias="from")
    to: str
    at: datetime
    by: str | None = None
    by_name: str | None = None
    reason: str | None = None


class ReservationOut(ApiModel):
    id: str
    supplier_reference: str
    mode: str
    status: str
    amount: Money
    confirmed_at: datetime
    notes: str | None = None


class BookingSummary(ApiModel):
    id: str
    state: str
    state_label: str
    category: str
    title: str
    provider_id: str
    provider_name: str
    execution_mode: ExecutionMode
    is_simulation: bool
    current_price: Money
    price_changed: bool
    # The supplier quote has lapsed; the next action attempt will move the intent to EXPIRED
    offer_expired: bool = False
    travelers_count: int
    supplier_reference: str | None = None
    trip_id: str | None = None
    created_at: datetime
    updated_at: datetime


class BookingOut(BookingSummary):
    offer_id: str | None = None
    # CanonicalOffer snapshot (JSON) of exactly what was selected / last re-quoted
    offer: dict[str, Any]
    travelers: list[TravelerOut]
    quoted_price: Money
    simulation_scenario: str | None = None
    terms_hash: str
    terms_summary: list[str]
    approval: ApprovalOut | None = None
    can: BookingCan
    history: list[HistoryEntry]
    failure_reason: str | None = None
    reservation: ReservationOut | None = None
    revalidated_at: datetime | None = None
    # True when the last price check is recent enough to approve
    revalidation_fresh: bool = False
    offer_expires_at: datetime | None = None
    submitted_at: datetime | None = None
    created_by_id: str | None = None
    created_by: str | None = None
    version: int
    warnings: list[str] = Field(default_factory=list)
    # Transient: Hebrew message describing the outcome of THIS request (e.g. supplier re-check)
    notice: str | None = None
    # Transient: submit was a replay of an already processed idempotency key
    idempotent_replay: bool = False


class CheckoutLinkOut(ApiModel):
    url: str
    provider_id: str
    provider_name: str
    instructions: str
    warnings: list[str] = Field(default_factory=list)
