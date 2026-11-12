"""Canonical offer contract — the single normalized shape for every provider.

Rules (enforced by normalization + tests):
* Prices come ONLY from provider data. The AI may never invent or alter them.
* ``price.total`` is the total KNOWN price for the exact bundle (fare/room/car).
  Components marked ``status="estimated"`` or ``"excluded"`` are listed
  separately so users see what is and isn't included.
* Original currency is preserved. Conversions are separate, labeled, timestamped.
* ``source.mode`` is DEMO / LIVE / CACHED and is always shown in the UI.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import Field

from app.schemas.common import ApiModel, Category, DataMode, DecimalStr, Money

PriceComponentKind = Literal["base", "tax", "fee", "extra", "discount"]
CostStatus = Literal["known", "estimated", "excluded"]


class PriceComponent(ApiModel):
    label: str  # Hebrew display label, e.g. "מיסים והיטלים"
    kind: PriceComponentKind
    amount: Money
    status: CostStatus = "known"
    included_in_total: bool = True


class PriceBreakdown(ApiModel):
    total: Money
    # known: exact supplier total; estimated: supplier gave an estimate only
    total_status: Literal["known", "estimated"] = "known"
    components: list[PriceComponent] = Field(default_factory=list)
    # Things NOT included that the traveller may pay (e.g. city tax at hotel)
    excluded_notes: list[str] = Field(default_factory=list)
    per_night: Money | None = None
    per_person: Money | None = None
    per_day: Money | None = None


class SourceInfo(ApiModel):
    provider_id: str
    provider_name: str
    mode: DataMode
    fetched_at: datetime
    expires_at: datetime | None = None
    supplier_offer_id: str
    # Provider-hosted page (validated against the provider's domain allowlist)
    deep_link: str | None = None
    # Human readable coverage/disclaimer note
    note: str | None = None


class CancellationPolicy(ApiModel):
    refundable: bool | None = None  # None = unknown
    free_cancellation_until: datetime | None = None
    changeable: bool | None = None
    change_fee: Money | None = None
    policy_text: str | None = None


# ---------- category details ----------


class FlightSegment(ApiModel):
    carrier_code: str
    carrier_name: str
    flight_number: str
    origin: str  # IATA airport code
    origin_name: str | None = None
    destination: str
    destination_name: str | None = None
    # Local wall-clock times with UTC offset (ISO 8601), e.g. 2026-12-01T08:15:00+02:00
    departing_at: datetime
    arriving_at: datetime
    duration_minutes: int
    cabin: str
    aircraft: str | None = None
    operating_carrier_name: str | None = None


class FlightSlice(ApiModel):
    origin: str
    destination: str
    departing_at: datetime
    arriving_at: datetime
    duration_minutes: int
    stops: int
    segments: list[FlightSegment]
    layovers_minutes: list[int] = Field(default_factory=list)


class Baggage(ApiModel):
    personal_item: bool = True
    carry_on_included: int | None = None  # pieces, None = unknown
    checked_included: int | None = None
    checked_bag_weight_kg: int | None = None
    notes: str | None = None


class FlightDetails(ApiModel):
    kind: Literal["flight"] = "flight"
    slices: list[FlightSlice]
    cabin: str
    fare_brand: str | None = None
    baggage: Baggage
    passengers: dict[str, int]  # {"adult": 2, "child": 1, "infant": 0}
    validating_carrier: str | None = None
    total_duration_minutes: int
    max_stops: int


class HotelDetails(ApiModel):
    kind: Literal["hotel"] = "hotel"
    hotel_name: str
    hotel_id: str
    star_rating: float | None = None
    guest_rating: float | None = None  # 0-10
    review_count: int | None = None
    address: str | None = None
    city: str
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    distance_to_center_km: float | None = None
    room_name: str
    board: Literal["room_only", "breakfast", "half_board", "full_board", "all_inclusive"]
    check_in: date
    check_out: date
    nights: int
    rooms: int
    adults: int
    children: int
    amenities: list[str] = Field(default_factory=list)
    # Only true when the supplier explicitly states it (never inferred)
    kosher_info: str | None = None
    accessibility_features: list[str] = Field(default_factory=list)


class CarDetails(ApiModel):
    kind: Literal["car"] = "car"
    vendor: str
    car_class: str  # mini / economy / compact / midsize / fullsize / suv / van / premium
    model_example: str
    transmission: Literal["manual", "automatic"]
    seats: int
    bags: int
    air_conditioning: bool = True
    fuel_policy: str | None = None
    mileage: str | None = None  # "unlimited" / "200km/day"
    pickup_location: str
    dropoff_location: str
    pickup_at: datetime
    dropoff_at: datetime
    rental_days: int
    driver_min_age: int | None = None
    young_driver_fee_applies: bool | None = None
    insurance_included: list[str] = Field(default_factory=list)
    deposit: Money | None = None


class ActivityDetails(ApiModel):
    kind: Literal["activity"] = "activity"
    name: str
    activity_id: str
    category: str  # e.g. "museum", "tour", "outdoor", "family", "food"
    city: str
    description: str | None = None
    duration_minutes: int | None = None
    available_dates: list[date] = Field(default_factory=list)
    start_times: list[str] = Field(default_factory=list)  # "09:00"
    languages: list[str] = Field(default_factory=list)
    meeting_point: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    rating: float | None = None  # 0-5
    review_count: int | None = None
    family_friendly: bool | None = None
    min_age: int | None = None
    accessibility_features: list[str] = Field(default_factory=list)
    participants: dict[str, int] = Field(default_factory=dict)


OfferDetails = Annotated[
    FlightDetails | HotelDetails | CarDetails | ActivityDetails, Field(discriminator="kind")
]


class ScoreBreakdown(ApiModel):
    """Transparent, deterministic ranking explanation (0-100 per factor)."""

    total: DecimalStr
    cost: DecimalStr
    convenience: DecimalStr
    flexibility: DecimalStr
    quality: DecimalStr
    weights: dict[str, int]
    reasons: list[str] = Field(default_factory=list)  # Hebrew explanations
    rank: int | None = None
    # When ranking had to compare different currencies without FX data
    comparable: bool = True


class CanonicalOffer(ApiModel):
    id: str  # our persisted offer id
    category: Category
    title: str
    subtitle: str | None = None
    source: SourceInfo
    price: PriceBreakdown
    cancellation: CancellationPolicy
    details: OfferDetails
    dedupe_key: str
    # Other providers that returned an equivalent offer (after dedupe)
    also_offered_by: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    score: ScoreBreakdown | None = None

    @property
    def is_demo(self) -> bool:
        return self.source.mode == "DEMO"


class ConvertedAmount(ApiModel):
    """A labeled currency conversion. Never replaces the original price."""

    original: Money
    converted: Money
    rate: DecimalStr
    rate_source: str
    rate_mode: DataMode
    rate_timestamp: datetime
