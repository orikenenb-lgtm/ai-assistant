"""Search input contracts for the four searchable categories + search responses.

Validation rules (dates, ages, occupancy, supplier constraints) live here so
manual search, AI tool calls and price alerts all share them.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.common import ApiModel, Category, CurrencyCode, DataMode, DecimalStr
from app.schemas.offers import CanonicalOffer

IataCode = Annotated[str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]
MAX_DAYS_AHEAD = 365
MAX_TRAVELLERS = 9


def _upper(v: str) -> str:
    return v.strip().upper()


def _check_not_past(d: date, field: str) -> None:
    # Allow "today" in any timezone (UTC-12 .. UTC+14)
    if d < date.today() - timedelta(days=1):
        raise ValueError(f"{field}: התאריך כבר עבר")
    if d > date.today() + timedelta(days=MAX_DAYS_AHEAD + 1):
        raise ValueError(f"{field}: ניתן לחפש עד שנה קדימה")


class _Base(ApiModel):
    currency: CurrencyCode = "ILS"
    max_price: DecimalStr | None = Field(None, gt=0, description="Max total price in `currency`")


class FlightSearchParams(_Base):
    category: Literal["flight"] = "flight"
    origin: IataCode
    destination: IataCode
    depart_date: date
    return_date: date | None = None
    # +/- days of flexibility around depart/return (bounded to limit provider calls)
    flex_days: int = Field(0, ge=0, le=3)
    adults: int = Field(1, ge=1, le=MAX_TRAVELLERS)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=8)
    cabin: Literal["economy", "premium_economy", "business", "first"] = "economy"
    max_stops: int | None = Field(None, ge=0, le=3)
    checked_bags: int = Field(0, ge=0, le=3)
    preferred_departure_window: Literal["any", "morning", "afternoon", "evening", "night"] = "any"

    @field_validator("origin", "destination", mode="before")
    @classmethod
    def _norm_codes(cls, v: object) -> object:
        return _upper(v) if isinstance(v, str) else v

    @model_validator(mode="after")
    def _validate(self) -> FlightSearchParams:
        if self.origin == self.destination:
            raise ValueError("מוצא ויעד חייבים להיות שונים")
        _check_not_past(self.depart_date, "depart_date")
        if self.return_date is not None:
            _check_not_past(self.return_date, "return_date")
            if self.return_date < self.depart_date:
                raise ValueError("תאריך החזרה חייב להיות אחרי תאריך היציאה")
        infants = sum(1 for a in self.children_ages if a < 2)
        if infants > self.adults:
            raise ValueError("כל תינוק (מתחת לגיל 2) צריך מבוגר מלווה")
        if self.adults + len(self.children_ages) > MAX_TRAVELLERS:
            raise ValueError(f"עד {MAX_TRAVELLERS} נוסעים בחיפוש אחד")
        return self


class RoomOccupancy(ApiModel):
    adults: int = Field(2, ge=1, le=6)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=4)


class HotelSearchParams(_Base):
    category: Literal["hotel"] = "hotel"
    # City name (Hebrew/English) or IATA city code; resolved by the provider layer
    destination: str = Field(..., min_length=2, max_length=100)
    check_in: date
    check_out: date
    rooms: list[RoomOccupancy] = Field(default_factory=lambda: [RoomOccupancy()], min_length=1, max_length=5)
    min_stars: int | None = Field(None, ge=1, le=5)
    board: Literal["any", "breakfast", "half_board", "all_inclusive"] = "any"
    free_cancellation_only: bool = False
    kosher_preference: bool = False
    accessibility_required: bool = False

    @model_validator(mode="after")
    def _validate(self) -> HotelSearchParams:
        _check_not_past(self.check_in, "check_in")
        if self.check_out <= self.check_in:
            raise ValueError("תאריך היציאה מהמלון חייב להיות אחרי תאריך הכניסה")
        if (self.check_out - self.check_in).days > 30:
            raise ValueError("ניתן לחפש שהייה של עד 30 לילות")
        return self

    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days


class CarSearchParams(_Base):
    category: Literal["car"] = "car"
    pickup_location: str = Field(..., min_length=2, max_length=100)  # IATA airport or city
    dropoff_location: str | None = Field(None, min_length=2, max_length=100)
    # Local times at the pickup location (naive = local wall clock)
    pickup_at: datetime
    dropoff_at: datetime
    driver_age: int = Field(30, ge=18, le=99)
    car_class: Literal["any", "mini", "economy", "compact", "midsize", "fullsize", "suv", "van", "premium"] = "any"
    transmission: Literal["any", "manual", "automatic"] = "any"
    min_seats: int = Field(2, ge=2, le=9)

    @model_validator(mode="after")
    def _validate(self) -> CarSearchParams:
        _check_not_past(self.pickup_at.date(), "pickup_at")
        if self.dropoff_at <= self.pickup_at + timedelta(hours=1):
            raise ValueError("זמן ההחזרה חייב להיות לפחות שעה אחרי האיסוף")
        if (self.dropoff_at - self.pickup_at).days > 60:
            raise ValueError("ניתן לחפש השכרה של עד 60 יום")
        return self


class ActivitySearchParams(_Base):
    category: Literal["activity"] = "activity"
    destination: str = Field(..., min_length=2, max_length=100)
    date_from: date
    date_to: date
    interests: list[
        Literal["museum", "tour", "outdoor", "family", "food", "water", "nightlife", "shopping", "culture", "adventure"]
    ] = Field(default_factory=list, max_length=10)
    adults: int = Field(2, ge=1, le=MAX_TRAVELLERS)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=8)
    accessibility_required: bool = False
    language: str | None = Field(None, max_length=8)

    @model_validator(mode="after")
    def _validate(self) -> ActivitySearchParams:
        _check_not_past(self.date_from, "date_from")
        if self.date_to < self.date_from:
            raise ValueError("טווח התאריכים אינו תקין")
        if (self.date_to - self.date_from).days > 30:
            raise ValueError("טווח של עד 30 יום")
        return self


SearchParams = Annotated[
    FlightSearchParams | HotelSearchParams | CarSearchParams | ActivitySearchParams,
    Field(discriminator="category"),
]

PARAMS_BY_CATEGORY: dict[str, type[ApiModel]] = {
    "flight": FlightSearchParams,
    "hotel": HotelSearchParams,
    "car": CarSearchParams,
    "activity": ActivitySearchParams,
}

ProviderRunStatus = Literal["OK", "FAILED", "TIMEOUT", "NOT_CONFIGURED", "DISABLED", "CACHED", "UNSUPPORTED"]


class ProviderRun(ApiModel):
    provider_id: str
    provider_name: str
    mode: DataMode
    status: ProviderRunStatus
    result_count: int = 0
    duration_ms: int | None = None
    error_code: str | None = None
    message: str | None = None  # Hebrew, user safe
    fetched_at: datetime | None = None


class SearchHighlights(ApiModel):
    """Notable offers of ONE search (V6 contract §2), computed after filters/dedupe.

    Only offers in the dominant currency (most offers) are compared — no FX.
    """

    currency: CurrencyCode
    cheapest_offer_id: str
    fastest_offer_id: str | None = None  # flights only
    best_score_offer_id: str
    comparable_count: int
    note: str  # Hebrew: "cheapest among the offers found", never "cheapest in the market"


class SearchResponse(ApiModel):
    search_id: str
    category: Category
    status: Literal["completed", "partial", "failed"]
    params: dict
    created_at: datetime
    completed_at: datetime | None = None
    providers: list[ProviderRun]
    offers: list[CanonicalOffer]
    total_offers_before_dedupe: int = 0
    weights: dict[str, int]
    # Honest coverage statement in Hebrew
    coverage_note: str
    has_demo_results: bool = False
    has_live_results: bool = False
    # V6 (additive): null when there are no offers
    highlights: SearchHighlights | None = None
