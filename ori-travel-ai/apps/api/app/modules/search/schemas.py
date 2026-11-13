"""Search module API schemas (SearchResponse itself lives in app.schemas.search)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from app.core.money import SUPPORTED_CURRENCIES
from app.schemas.common import ApiModel, Category, CurrencyCode, DataMode, Money
from app.schemas.search import MAX_DAYS_AHEAD, MAX_TRAVELLERS, IataCode


class SearchHistoryItem(ApiModel):
    search_id: str
    category: Category
    params: dict
    status: str
    result_count: int
    created_at: datetime
    origin: str


# ------------------------------------------------------------ fare calendar ----
# V6 contract §1 — POST /api/search/flight/calendar

CALENDAR_MAX_SPAN_DAYS = 41  # depart_to - depart_from  => up to 42 depart dates
CALENDAR_MAX_NIGHTS_VALUES = 7
CALENDAR_MAX_CELLS = 150

CalendarCellStatus = Literal["priced", "no_offers", "not_searched", "error"]
CalendarTier = Literal["best", "low", "mid", "high"]
# OK / PARTIAL / FAILED / UNSUPPORTED: DEMO providers queried per cell.
# NOT_QUERIED / CACHED: usable LIVE providers (never called; CACHED = earlier real results filled cells).
# DISABLED / NOT_CONFIGURED: not used at all.
CalendarSourceStatus = Literal[
    "OK", "PARTIAL", "FAILED", "UNSUPPORTED", "NOT_QUERIED", "CACHED", "DISABLED", "NOT_CONFIGURED"
]


class FlightCalendarRequest(ApiModel):
    """Calendar request; per-cell params reuse FlightSearchParams' rules (pax, origin != destination)."""

    origin: IataCode
    destination: IataCode
    depart_from: date
    depart_to: date
    # [] / null / omitted => one-way. Duplicates are removed, values sorted.
    trip_nights: list[Annotated[int, Field(ge=1, le=30)]] | None = Field(
        default_factory=list, max_length=CALENDAR_MAX_NIGHTS_VALUES
    )
    adults: int = Field(1, ge=1, le=MAX_TRAVELLERS)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=8)
    cabin: Literal["economy", "premium_economy", "business", "first"] = "economy"
    max_stops: int | None = Field(None, ge=0, le=3)
    checked_bags: int = Field(0, ge=0, le=3)
    currency: CurrencyCode = "ILS"

    @field_validator("origin", "destination", "currency", mode="before")
    @classmethod
    def _upper(cls, v: object) -> object:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("trip_nights", mode="after")
    @classmethod
    def _nights(cls, v: list[int] | None) -> list[int]:
        return sorted(set(v or []))

    @model_validator(mode="after")
    def _validate(self) -> FlightCalendarRequest:
        today = date.today()
        if self.currency not in SUPPORTED_CURRENCIES:
            raise ValueError(f"המטבע {self.currency} אינו נתמך")
        if self.depart_to < self.depart_from:
            raise ValueError("טווח התאריכים אינו תקין: תאריך הסיום לפני תאריך ההתחלה")
        if (self.depart_to - self.depart_from).days > CALENDAR_MAX_SPAN_DAYS:
            raise ValueError(
                f"ניתן להציג עד {CALENDAR_MAX_SPAN_DAYS + 1} תאריכי יציאה בלוח אחד "
                f"(טווח של עד {CALENDAR_MAX_SPAN_DAYS} ימים)"
            )
        # Same tolerance as FlightSearchParams (any time zone's "today").
        if self.depart_from < today - timedelta(days=1):
            raise ValueError("depart_from: התאריך כבר עבר — יש לבחור תאריכים עתידיים")
        last_return = self.depart_to + timedelta(days=max(self.trip_nights or [0]))
        if last_return > today + timedelta(days=MAX_DAYS_AHEAD + 1):
            raise ValueError("ניתן לחפש עד שנה קדימה — צמצמו את טווח התאריכים או את מספר הלילות")
        if self.cell_count > CALENDAR_MAX_CELLS:
            raise ValueError(
                f"יותר מדי תאים בלוח ({self.cell_count}) — עד {CALENDAR_MAX_CELLS}. "
                "צמצמו את טווח התאריכים או את מספר אפשרויות הלילות"
            )
        return self

    @property
    def depart_dates(self) -> list[date]:
        return [self.depart_from + timedelta(days=i) for i in range((self.depart_to - self.depart_from).days + 1)]

    @property
    def cell_count(self) -> int:
        return ((self.depart_to - self.depart_from).days + 1) * max(1, len(self.trip_nights or []))

    @property
    def travelers(self) -> int:
        return self.adults + len(self.children_ages)


YEAR_SCAN_MAX_NIGHTS = 30


class FlightYearScanRequest(ApiModel):
    """Year scan: every depart date from tomorrow until a year ahead, for ONE trip length (or one-way).

    Same per-cell rules as the calendar (DEMO adapters + cached real offers, LIVE never called); only the date
    range is fixed by the server instead of the client.
    """

    origin: IataCode
    destination: IataCode
    nights: int | None = Field(None, ge=1, le=YEAR_SCAN_MAX_NIGHTS)  # null => one-way
    adults: int = Field(1, ge=1, le=MAX_TRAVELLERS)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=8)
    cabin: Literal["economy", "premium_economy", "business", "first"] = "economy"
    max_stops: int | None = Field(None, ge=0, le=3)
    checked_bags: int = Field(0, ge=0, le=3)
    currency: CurrencyCode = "ILS"

    @field_validator("origin", "destination", "currency", mode="before")
    @classmethod
    def _upper(cls, v: object) -> object:
        return v.strip().upper() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _validate(self) -> FlightYearScanRequest:
        if self.currency not in SUPPORTED_CURRENCIES:
            raise ValueError(f"המטבע {self.currency} אינו נתמך")
        return self

    @property
    def trip_nights(self) -> list[int]:
        return [self.nights] if self.nights else []

    @property
    def depart_from(self) -> date:
        return date.today() + timedelta(days=1)

    @property
    def depart_to(self) -> date:
        # The return flight must still be within the searchable year.
        return date.today() + timedelta(days=MAX_DAYS_AHEAD - (self.nights or 0))

    @property
    def depart_dates(self) -> list[date]:
        return [self.depart_from + timedelta(days=i) for i in range((self.depart_to - self.depart_from).days + 1)]

    @property
    def travelers(self) -> int:
        return self.adults + len(self.children_ages)


class CalendarCell(ApiModel):
    depart_date: date
    return_date: date | None = None
    nights: int | None = None  # null for one-way
    status: CalendarCellStatus
    # Cheapest TOTAL for all travellers among real adapter quotes for exactly this cell (never invented)
    min_total: Money | None = None
    per_person: Money | None = None  # min_total / travelers
    travelers: int
    tier: CalendarTier | None = None  # relative to the priced cells of this calendar (same currency)
    mode: DataMode | None = None  # of the cheapest offer: DEMO (queried now) or CACHED (earlier real search)
    provider_id: str | None = None
    provider_name: str | None = None
    # Distinct matching offers for the cell (identical offers from several providers counted once)
    offers_count: int = 0
    fetched_at: datetime | None = None
    message: str | None = None  # Hebrew; set for error / not_searched / no_offers


class CalendarStats(ApiModel):
    min: Money | None = None
    max: Money | None = None
    median: Money | None = None
    mean: Money | None = None  # average of the priced cells (same currency)
    priced: int = 0
    no_offers: int = 0
    not_searched: int = 0
    error: int = 0


class CalendarSource(ApiModel):
    provider_id: str
    provider_name: str
    mode: DataMode
    status: CalendarSourceStatus
    message: str | None = None  # Hebrew, user safe
    error_code: str | None = None
    cells_priced: int = 0  # cells whose cheapest offer came from this provider


class FlightCalendarResponse(ApiModel):
    origin: str
    destination: str
    currency: str
    cabin: str
    depart_dates: list[date]
    trip_nights: list[int | None]  # [null] for one-way
    cells: list[CalendarCell]  # ordered by depart_date, then trip_nights order
    stats: CalendarStats
    sources: list[CalendarSource]
    legend_note: str
    coverage_note: str
    has_demo: bool
    generated_at: datetime
