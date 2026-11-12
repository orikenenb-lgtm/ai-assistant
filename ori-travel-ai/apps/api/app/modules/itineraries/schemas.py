"""Trip / item / budget API schemas."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.models.trips import COST_STATUSES, TRIP_ITEM_KINDS, TRIP_STATUSES
from app.schemas.common import ApiModel, DecimalStr, Money
from app.schemas.offers import CanonicalOffer  # noqa: F401  (re-export for typing convenience)

ItemKind = Literal["flight", "hotel", "car", "activity", "transfer", "note", "other"]
ItemCostStatus = Literal["known", "estimate", "excluded"]
TripStatus = Literal["planning", "booked", "completed", "cancelled"]

assert set(ItemKind.__args__) == set(TRIP_ITEM_KINDS)  # type: ignore[attr-defined]
assert set(ItemCostStatus.__args__) == set(COST_STATUSES)  # type: ignore[attr-defined]
assert set(TripStatus.__args__) == set(TRIP_STATUSES)  # type: ignore[attr-defined]


def _strip_required(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("הערך אינו יכול להיות ריק")
    return v


def _non_negative(m: Money | None) -> Money | None:
    if m is not None and m.amount < 0:
        raise ValueError("הסכום אינו יכול להיות שלילי")
    return m


# ---------------- trips ----------------


class TripCreate(ApiModel):
    title: str = Field(..., min_length=1, max_length=200)
    destination: str | None = Field(None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    timezone: str | None = Field(None, max_length=64)
    budget: Money | None = None
    notes: str | None = Field(None, max_length=5000)
    status: TripStatus = "planning"
    traveler_ids: list[str] = Field(default_factory=list, max_length=30)

    _t = field_validator("title")(_strip_required)

    @field_validator("budget")
    @classmethod
    def _budget(cls, v: Money | None) -> Money | None:
        return _non_negative(v)


class TripUpdate(ApiModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    destination: str | None = Field(None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    timezone: str | None = Field(None, max_length=64)
    budget: Money | None = None
    notes: str | None = Field(None, max_length=5000)
    status: TripStatus | None = None
    traveler_ids: list[str] | None = Field(None, max_length=30)

    @field_validator("title")
    @classmethod
    def _t(cls, v: str | None) -> str | None:
        return None if v is None else _strip_required(v)

    @field_validator("budget")
    @classmethod
    def _budget(cls, v: Money | None) -> Money | None:
        return _non_negative(v)


class TravelerOut(ApiModel):
    id: str
    display_name: str
    relation: str | None = None
    age_group: str
    is_minor: bool


class OverlapOut(ApiModel):
    item_id: str
    other_item_id: str
    # kinds sorted alphabetically and joined by "-", e.g. "activity-flight"
    kind_pair: str
    message: str


class TripItemCreate(ApiModel):
    kind: ItemKind
    title: str = Field(..., min_length=1, max_length=300)
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: str | None = Field(None, max_length=64)
    location: str | None = Field(None, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    cost: Money | None = None
    cost_status: ItemCostStatus = "estimate"
    notes: str | None = Field(None, max_length=5000)
    # explicit user confirmation to save despite a forbidden overlap (otherwise 409 ITEM_OVERLAP)
    allow_overlap: bool = False

    _t = field_validator("title")(_strip_required)

    @field_validator("cost")
    @classmethod
    def _cost(cls, v: Money | None) -> Money | None:
        return _non_negative(v)


class TripItemUpdate(ApiModel):
    kind: ItemKind | None = None
    title: str | None = Field(None, min_length=1, max_length=300)
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: str | None = Field(None, max_length=64)
    location: str | None = Field(None, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    cost: Money | None = None
    cost_status: ItemCostStatus | None = None
    notes: str | None = Field(None, max_length=5000)
    allow_overlap: bool = False

    @field_validator("title")
    @classmethod
    def _t(cls, v: str | None) -> str | None:
        return None if v is None else _strip_required(v)

    @field_validator("cost")
    @classmethod
    def _cost(cls, v: Money | None) -> Money | None:
        return _non_negative(v)


class FromOfferIn(ApiModel):
    offer_id: str = Field(..., min_length=1, max_length=64)
    allow_overlap: bool = False


class ReorderIn(ApiModel):
    item_ids: list[str] = Field(..., min_length=1, max_length=500)


class TripItemOut(ApiModel):
    id: str
    trip_id: str
    kind: str
    title: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: str | None = None
    # Local calendar date of start_at in the item's (or trip's) timezone; null when date-less
    local_date: date | None = None
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    offer_id: str | None = None
    cost: Money | None = None
    cost_status: str
    notes: str | None = None
    sort_order: int
    offer_snapshot: dict | None = None
    # Convenience flags derived from the snapshot
    data_mode: Literal["DEMO", "LIVE", "CACHED"] | None = None
    offer_expired: bool = False
    # forbidden overlaps this item takes part in (see overlaps.py)
    overlaps: list[OverlapOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class FromOfferOut(ApiModel):
    """``item`` is the first created item; ``items`` has all (a flight yields one per slice)."""

    item: TripItemOut
    items: list[TripItemOut]
    overlaps: list[OverlapOut] = Field(default_factory=list)


class DayOut(ApiModel):
    date: date
    item_ids: list[str]


class CurrencyTotal(ApiModel):
    currency: str
    known: DecimalStr
    estimated: DecimalStr


class TripSummary(ApiModel):
    id: str
    title: str
    destination: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    timezone: str | None = None
    status: str
    budget: Money | None = None
    item_count: int
    traveler_count: int
    day_count: int | None = None
    # Per currency, never mixed
    totals: list[CurrencyTotal]
    has_demo_data: bool = False
    created_at: datetime
    updated_at: datetime


class TripDetail(TripSummary):
    notes: str | None = None
    travelers: list[TravelerOut]
    items: list[TripItemOut]
    days: list[DayOut]
    # Items without a date (shown in an "unscheduled" bucket)
    unscheduled_item_ids: list[str]
    # every forbidden overlapping pair in the trip (one entry per pair)
    overlaps: list[OverlapOut] = Field(default_factory=list)


# ---------------- budget ----------------


class BudgetCurrencyRow(ApiModel):
    currency: str
    known: DecimalStr
    estimated: DecimalStr
    excluded: DecimalStr
    # known + estimated (what counts against the budget)
    counted: DecimalStr


class BudgetKindRow(ApiModel):
    kind: str
    item_count: int
    totals: list[BudgetCurrencyRow]


class BudgetWarning(ApiModel):
    code: str
    message: str
    item_ids: list[str] = Field(default_factory=list)


class BudgetOut(ApiModel):
    trip_id: str
    budget: Money | None = None
    totals: list[BudgetCurrencyRow]
    by_kind: list[BudgetKindRow]
    # budget - (known + estimated); null unless every counted cost is in the budget currency
    remaining: Money | None = None
    remaining_reason: Literal["ok", "no_budget", "mixed_currencies"]
    over_budget: bool = False
    # counted (known + estimated) cost / traveler_count; null unless one currency and travelers > 0
    per_traveler: Money | None = None
    per_traveler_reason: Literal["ok", "no_costs", "no_travelers", "mixed_currencies"] = "no_costs"
    traveler_count: int = 0
    warnings: list[BudgetWarning]


ZERO = Decimal("0")
