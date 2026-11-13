"""Duffel (flights) — LIVE adapter (search + revalidation, NO booking).

Docs: https://duffel.com/docs/api/v2/offer-requests , https://duffel.com/docs/api/v2/offers
(request/response shapes below follow the research notes in
``docs/integrations/provider-api-notes.md``; fields marked [prior] there were
NOT verified against the live API and are covered by mocked fixtures only).

Flow
----
``search``      ``POST /air/offer_requests?return_offers=false`` (slices + passengers + cabin)
                then ``GET /air/offers?offer_request_id=..&sort=total_amount&limit=..``.
``revalidate``  ``GET /air/offers/{id}`` (404 => expired; compares total + currency).
``health``      ``GET /air/airlines?limit=1`` (free, authenticated). No call when not configured.

Safety
------
* Token comes only from ``ORI_DUFFEL_ACCESS_TOKEN`` and is never logged or put in messages.
* Test tokens (``duffel_test_...``) return the fictional "Duffel Airways"; offers are labeled.
* A live token (``duffel_live_...``) is refused unless the owner sets the provider setting
  ``allow_live_mode=true`` (searches may be billed by Duffel above a search:book ratio).
* Cost guard: in-process daily search cap (provider setting ``daily_search_cap``, default 50).
* No consumer deep link exists; booking is NOT available through this adapter.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, ClassVar

import httpx

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.money import UnsupportedCurrencyError, quantize
from app.modules.providers.base import (
    BookingOptions,
    ProviderCapabilities,
    ProviderError,
    ProviderHealth,
    ProviderNotConfiguredError,
    ProviderRateLimitedError,
    ProviderUnsupportedError,
    RawOffer,
    RevalidationResult,
    SearchContext,
)
from app.modules.providers.data.geo import AIRPORTS, airport_zone, city_of_airport
from app.modules.providers.live.common import NOT_CONNECTED_MESSAGE, LiveAdapter
from app.modules.providers.live.httpclient import LiveHttp, safe_identifier
from app.modules.providers.normalization import (
    NormalizationError,
    build_breakdown,
    clean_text,
    component,
    compute_dedupe_key,
    finalize_offer,
    money,
)
from app.schemas.common import ApiModel, Category
from app.schemas.offers import (
    Baggage,
    CancellationPolicy,
    CanonicalOffer,
    FlightDetails,
    FlightSegment,
    FlightSlice,
    SourceInfo,
)
from app.schemas.search import FlightSearchParams

log = logging.getLogger("ori.providers.live.duffel")

DUFFEL_BASE_URL = "https://api.duffel.com"
DUFFEL_VERSION = "v2"
MAX_OFFERS = 50
DEFAULT_DAILY_SEARCH_CAP = 50
TEST_NOTE = "מצב בדיקה של Duffel — חברת תעופה בדיונית"
LIVE_NOTE = "מחיר חי מ-Duffel — כיסוי חלקי של חברות תעופה; יש לאמת מחדש לפני הזמנה"
TEST_WARNING = "נתוני בדיקה (Duffel Airways) — לא טיסה אמיתית ולא מחיר אמיתי"
_TOKEN_RE = re.compile(r"^duffel_(test|live)_[A-Za-z0-9_\-.=]{8,}$")
_OFFER_ID_RE = re.compile(r"^off_[A-Za-z0-9]+$")
_REQUEST_ID_RE = re.compile(r"^orq_[A-Za-z0-9]+$")
_DURATION_RE = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")
_PAX_TYPES = {"adult": "adult", "child": "child", "infant_without_seat": "infant", "infant_with_seat": "infant"}


# ------------------------------------------------------------ cost guard ----


class DailySearchCounter:
    """In-process per-UTC-day counter of billable searches (offer requests)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._day: date | None = None
        self._count = 0

    def reserve(self, cap: int) -> bool:
        today = datetime.now(UTC).date()
        with self._lock:
            if self._day != today:
                self._day, self._count = today, 0
            if self._count >= cap:
                return False
            self._count += 1
            return True

    def used_today(self) -> int:
        today = datetime.now(UTC).date()
        with self._lock:
            return self._count if self._day == today else 0

    def reset(self) -> None:
        with self._lock:
            self._day, self._count = None, 0


_search_counter = DailySearchCounter()


def reset_daily_search_counter() -> None:
    """Test hook."""
    _search_counter.reset()


def searches_used_today() -> int:
    return _search_counter.used_today()


# --------------------------------------------------------------- parsing ----


def parse_iso_duration_minutes(value: object) -> int | None:
    """ISO-8601 duration (``PT2H30M``, ``P1DT3H``) -> whole minutes; None when invalid."""
    if not isinstance(value, str):
        return None
    m = _DURATION_RE.match(value.strip())
    if not m or value.strip() in ("P", "PT"):
        return None
    days, hours, minutes, seconds = m.groups()
    total = int(days or 0) * 1440 + int(hours or 0) * 60 + int(minutes or 0)
    total += int(Decimal(seconds or 0) // 60)
    return total


def _dec(value: object, field: str) -> Decimal:
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise NormalizationError(f"invalid decimal in {field}") from None
    if not d.is_finite() or d < 0:
        raise NormalizationError(f"invalid amount in {field}")
    return d


def _dt(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise NormalizationError(f"missing datetime {field}")
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise NormalizationError(f"invalid datetime {field}") from None


def _expiry(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _obj(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _stops_text(stops: int) -> str:
    return "ישירה" if stops == 0 else ("עצירת ביניים אחת" if stops == 1 else f"{stops} עצירות")


# ---------------------------------------------------------------- adapter ----


class DuffelAdapter(LiveAdapter):
    provider_id = "duffel"
    display_name = "Duffel (טיסות)"
    categories: ClassVar[tuple[Category, ...]] = ("flight",)
    credential_fields = ("duffel_access_token",)
    official_docs_url = "https://duffel.com/docs/api"
    deep_link_domains = ()
    rate_limit_note = (
        "מגבלות קצב לפי חשבון Duffel; מגבלת חיפושים יומית פנימית (ברירת מחדל 50) למניעת חיובי חיפוש עודף"
    )
    description = (
        "API רשמי לחיפוש טיסות (NDC וספקים נוספים). כיסוי חלקי של השוק — לא כל חברות התעופה זמינות. "
        "מצב בדיקה (duffel_test) מחזיר חברת תעופה בדיונית. אין הזמנה דרך המערכת וגם אין קישור הזמנה ישיר. "
        "מגבלת חיפושים יומית בתוך התהליך (daily_search_cap, ברירת מחדל 50) כי Duffel עשויה לחייב על חיפושים עודפים "
        "ביחס להזמנות. חיפוש גמיש בתאריכים (flex_days) אינו נתמך כדי לא לנפח את מספר החיפושים."
    )
    implemented: ClassVar[bool] = True
    allowed_settings: ClassVar[dict[str, tuple]] = {
        "max_results": ("int", 1, MAX_OFFERS),
        "daily_search_cap": ("int", 1, 500),
        "allow_live_mode": ("bool",),
    }

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    # ---- capabilities / config ----
    def capabilities(self) -> ProviderCapabilities:
        return super().capabilities().model_copy(
            update={
                "supports_revalidate": True,
                "supports_booking_options": True,
                "supports_hosted_checkout": False,
                "supports_live_booking": False,
            }
        )

    @staticmethod
    def _token() -> str | None:
        raw = get_settings().duffel_access_token
        return raw.strip() if raw and raw.strip() else None

    def is_configured(self) -> bool:
        token = self._token()
        return bool(get_settings().live_providers_enabled) and bool(token and _TOKEN_RE.match(token))

    def is_sandbox(self) -> bool:
        """Test-mode token: results come from Duffel's sandbox (fictional airline), reported as mode SANDBOX."""
        return self._is_test_token()

    @classmethod
    def _is_test_token(cls) -> bool:
        token = cls._token() or ""
        return token.startswith("duffel_test_")

    def _open(self, timeout: float) -> LiveHttp:
        token = self._token()
        if not token or not _TOKEN_RE.match(token):
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        return LiveHttp(
            provider_label=self.provider_id,
            base_url=DUFFEL_BASE_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Duffel-Version": DUFFEL_VERSION,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout_seconds=timeout,
            transport=self._transport,
        )

    # ---- health ----
    def health(self) -> ProviderHealth:
        now = utcnow()
        if not self.is_configured():
            return ProviderHealth(
                provider_id=self.provider_id, status="NOT_CONFIGURED", checked_at=now, message=NOT_CONNECTED_MESSAGE
            )
        t0 = time.perf_counter()
        timeout = float(get_settings().provider_timeout_seconds)
        try:
            with self._open(timeout) as http:
                http.request("GET", "/air/airlines", params={"limit": 1})
        except ProviderNotConfiguredError as exc:
            return ProviderHealth(
                provider_id=self.provider_id, status="NOT_CONFIGURED", checked_at=utcnow(), message=exc.message
            )
        except ProviderRateLimitedError as exc:
            return ProviderHealth(provider_id=self.provider_id, status="DEGRADED", checked_at=utcnow(), message=exc.message)
        except ProviderError as exc:
            return ProviderHealth(provider_id=self.provider_id, status="FAILED", checked_at=utcnow(), message=exc.message)
        latency = int((time.perf_counter() - t0) * 1000)
        mode = "מצב בדיקה" if self._is_test_token() else "מצב חי"
        return ProviderHealth(
            provider_id=self.provider_id,
            status="OK",
            checked_at=utcnow(),
            message=f"החיבור ל-Duffel תקין ({mode})",
            latency_ms=latency,
        )

    # ---- search ----
    @staticmethod
    def build_offer_request(params: FlightSearchParams) -> dict[str, Any]:
        slices = [{"origin": params.origin, "destination": params.destination, "departure_date": params.depart_date.isoformat()}]
        if params.return_date:
            slices.append(
                {"origin": params.destination, "destination": params.origin, "departure_date": params.return_date.isoformat()}
            )
        passengers: list[dict[str, Any]] = [{"type": "adult"} for _ in range(params.adults)]
        passengers += [{"age": int(a)} for a in params.children_ages]
        data: dict[str, Any] = {"slices": slices, "passengers": passengers, "cabin_class": params.cabin}
        if params.max_stops is not None and params.max_stops <= 2:
            data["max_connections"] = params.max_stops
        return {"data": data}

    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        if not self.is_configured():
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        if category != "flight" or not isinstance(params, FlightSearchParams):
            raise ProviderUnsupportedError("הספק תומך בחיפוש טיסות בלבד", code="UNSUPPORTED")
        settings = ctx.provider_settings or {}
        token = self._token() or ""
        if token.startswith("duffel_live_") and settings.get("allow_live_mode") is not True:
            raise ProviderUnsupportedError(
                "אסימון חי של Duffel נחסם: חיפושים חיים עלולים להיות מחויבים. "
                "להפעלה יש להגדיר בהגדרות הספק allow_live_mode=true",
                code="LIVE_MODE_NOT_ALLOWED",
            )
        cap = _int_setting(settings.get("daily_search_cap"), DEFAULT_DAILY_SEARCH_CAP, 1, 500)
        limit = _int_setting(settings.get("max_results"), MAX_OFFERS, 1, MAX_OFFERS)
        if not _search_counter.reserve(cap):
            raise ProviderError(
                f"הגעתם למגבלת החיפושים היומית ב-Duffel ({cap}) — המגבלה קיימת כדי למנוע חיובי חיפוש עודף. "
                "ניתן להגדיל אותה בהגדרות הספק (daily_search_cap)",
                code="DAILY_SEARCH_CAP",
                retryable=False,
            )
        with self._open(ctx.timeout_seconds) as http:
            created = http.request(
                "POST", "/air/offer_requests", params={"return_offers": "false"}, json_body=self.build_offer_request(params)
            )
            request_id = _obj(created.data.get("data")).get("id")
            if not isinstance(request_id, str) or not _REQUEST_ID_RE.match(request_id):
                raise ProviderError("תשובת הספק אינה תקינה — לא ניתן לעבד אותה", code="BAD_RESPONSE")
            listing = http.request(
                "GET",
                "/air/offers",
                params={"offer_request_id": request_id, "sort": "total_amount", "limit": limit},
            )
        items = listing.data.get("data")
        if not isinstance(items, list):
            raise ProviderError("תשובת הספק אינה תקינה — לא ניתן לעבד אותה", code="BAD_RESPONSE")
        test_mode = self._is_test_token()
        fetched = utcnow()
        request_ctx = {
            "cabin": params.cabin,
            "checked_bags": params.checked_bags,
            "flex_days": params.flex_days,
        }
        raws: list[RawOffer] = []
        for item in items[:limit]:
            offer = _obj(item)
            oid = offer.get("id")
            if not isinstance(oid, str) or not _OFFER_ID_RE.match(oid):
                continue
            raws.append(
                RawOffer(
                    supplier_offer_id=oid,
                    payload={"offer": offer, "request": request_ctx, "test_mode": test_mode},
                    fetched_at=fetched,
                    expires_at=_expiry(offer.get("expires_at")),
                )
            )
        return raws

    # ---- normalize ----
    def normalize(self, category: Category, raw: RawOffer, ctx: SearchContext) -> CanonicalOffer:
        offer = _obj(raw.payload.get("offer"))
        req = _obj(raw.payload.get("request"))
        # Duffel says per offer whether it is live; the token prefix is only a fallback when the field is missing.
        live_flag = offer.get("live_mode")
        test_mode = live_flag is False or (live_flag is None and bool(raw.payload.get("test_mode")))
        warnings: list[str] = []
        if test_mode:
            warnings.append(TEST_WARNING)

        currency = offer.get("total_currency")
        if not isinstance(currency, str) or len(currency) != 3:
            raise NormalizationError("missing currency")
        try:
            quantize(Decimal(1), currency)
        except UnsupportedCurrencyError:
            raise NormalizationError("unsupported currency") from None

        pax_list = [_obj(p) for p in _list(offer.get("passengers"))]
        passengers: dict[str, int] = {}
        for p in pax_list:
            kind = _PAX_TYPES.get(str(p.get("type")), "adult")
            passengers[kind] = passengers.get(kind, 0) + 1
        if not passengers:
            raise NormalizationError("offer has no passengers")

        slices, naive_seen = self._slices(offer, str(req.get("cabin") or "economy"))
        if naive_seen:
            warnings.append("שעות הטיסה מקומיות; עבור חלק משדות התעופה לא ניתן היה לקבוע אזור זמן")
        price = self._price(offer, currency, sum(passengers.values()), warnings)

        cabin = slices[0].segments[0].cabin
        brands = []
        for s in _list(offer.get("slices")):
            b = clean_text(_obj(s).get("fare_brand_name"), 60)
            if b and b not in brands:
                brands.append(b)
        fare_brand = " / ".join(brands) or None
        baggage = self._baggage(offer, pax_list, req, warnings, price)

        owner = _obj(offer.get("owner"))
        owner_name = clean_text(owner.get("name"), 80) or "חברת תעופה"
        pay = _obj(offer.get("payment_requirements"))
        if pay.get("requires_instant_payment") is True:
            warnings.append("הספק דורש תשלום מיידי בעת הזמנה (ללא החזקת מקום)")
        if int(req.get("flex_days") or 0) > 0:
            warnings.append("הגמישות בתאריכים לא נבדקה — הוצגו התאריכים המדויקים שהוזנו בלבד")

        o_iata, d_iata = slices[0].origin, slices[0].destination
        first_slice = _obj(_list(offer.get("slices"))[0])
        trip_text = "הלוך-חזור" if len(slices) > 1 else "כיוון אחד"
        max_stops = max(s.stops for s in slices)
        subtitle_parts = [owner_name, trip_text, _stops_text(max_stops)] + ([fare_brand] if fare_brand else [])
        details = FlightDetails(
            slices=slices,
            cabin=cabin,
            fare_brand=fare_brand,
            baggage=baggage,
            passengers=passengers,
            validating_carrier=_str(owner.get("iata_code")),
            total_duration_minutes=sum(s.duration_minutes for s in slices),
            max_stops=max_stops,
        )
        result = CanonicalOffer(
            id="",
            category="flight",
            title=f"{_city_label(o_iata, first_slice.get('origin'))} – {_city_label(d_iata, first_slice.get('destination'))}",
            subtitle=" · ".join(subtitle_parts),
            source=SourceInfo(
                provider_id=self.provider_id,
                provider_name=self.display_name,
                mode="SANDBOX" if test_mode else "LIVE",
                fetched_at=raw.fetched_at,
                expires_at=_expiry(offer.get("expires_at")) or raw.expires_at,
                supplier_offer_id=raw.supplier_offer_id,
                deep_link=None,
                note=TEST_NOTE if test_mode else LIVE_NOTE,
            ),
            price=price,
            cancellation=self._cancellation(offer, currency),
            details=details,
            dedupe_key="",
            warnings=warnings,
        )
        return result.model_copy(update={"dedupe_key": compute_dedupe_key(result)})

    def _slices(self, offer: dict[str, Any], default_cabin: str) -> tuple[list[FlightSlice], bool]:
        naive_seen = False
        out: list[FlightSlice] = []
        raw_slices = [_obj(s) for s in _list(offer.get("slices"))]
        if not raw_slices:
            raise NormalizationError("offer has no slices")
        for s in raw_slices:
            segments: list[FlightSegment] = []
            layovers: list[int] = []
            raw_segments = [_obj(x) for x in _list(s.get("segments"))]
            if not raw_segments:
                raise NormalizationError("slice has no segments")
            for seg in raw_segments:
                o_iata = _str(_obj(seg.get("origin")).get("iata_code"))
                d_iata = _str(_obj(seg.get("destination")).get("iata_code"))
                if not o_iata or not d_iata:
                    raise NormalizationError("segment without airport codes")
                dep, a1 = _localize(_dt(seg.get("departing_at"), "departing_at"), o_iata)
                arr, a2 = _localize(_dt(seg.get("arriving_at"), "arriving_at"), d_iata)
                naive_seen = naive_seen or a1 or a2
                minutes = parse_iso_duration_minutes(seg.get("duration"))
                if minutes is None:
                    if dep.tzinfo and arr.tzinfo:
                        minutes = int((arr - dep).total_seconds() // 60)
                    else:
                        raise NormalizationError("segment duration missing")
                marketing = _obj(seg.get("marketing_carrier"))
                operating = _obj(seg.get("operating_carrier"))
                code = _str(marketing.get("iata_code")) or _str(operating.get("iata_code"))
                if not code:
                    raise NormalizationError("segment without carrier")
                name = clean_text(marketing.get("name"), 80) or code
                op_name = clean_text(operating.get("name"), 80)
                seg_pax = [_obj(p) for p in _list(seg.get("passengers"))]
                cabin = _str(seg_pax[0].get("cabin_class")) if seg_pax else None
                number = _str(str(seg.get("marketing_carrier_flight_number") or "")) or "?"
                segments.append(
                    FlightSegment(
                        carrier_code=code,
                        carrier_name=name,
                        flight_number=number,
                        origin=o_iata,
                        origin_name=_airport_name(o_iata, _obj(seg.get("origin"))),
                        destination=d_iata,
                        destination_name=_airport_name(d_iata, _obj(seg.get("destination"))),
                        departing_at=dep,
                        arriving_at=arr,
                        duration_minutes=minutes,
                        cabin=cabin or default_cabin,
                        aircraft=clean_text(_obj(seg.get("aircraft")).get("name"), 60),
                        operating_carrier_name=op_name if op_name and op_name != name else None,
                    )
                )
            for prev, nxt in zip(segments, segments[1:], strict=False):
                if prev.arriving_at.tzinfo and nxt.departing_at.tzinfo:
                    gap = (nxt.departing_at - prev.arriving_at).total_seconds()
                else:
                    gap = (nxt.departing_at.replace(tzinfo=None) - prev.arriving_at.replace(tzinfo=None)).total_seconds()
                layovers.append(max(0, int(gap // 60)))
            duration = parse_iso_duration_minutes(s.get("duration"))
            if duration is None:
                duration = sum(x.duration_minutes for x in segments) + sum(layovers)
            out.append(
                FlightSlice(
                    origin=segments[0].origin,
                    destination=segments[-1].destination,
                    departing_at=segments[0].departing_at,
                    arriving_at=segments[-1].arriving_at,
                    duration_minutes=duration,
                    stops=len(segments) - 1,
                    segments=segments,
                    layovers_minutes=layovers,
                )
            )
        return out, naive_seen

    @staticmethod
    def _price(offer: dict[str, Any], currency: str, persons: int, warnings: list[str]):
        total = _dec(offer.get("total_amount"), "total_amount")
        base_raw, tax_raw = offer.get("base_amount"), offer.get("tax_amount")
        if base_raw is None or tax_raw is None:
            comps = [component("מחיר כולל (ללא פירוט)", "base", total, currency)]
        else:
            base, tax = _dec(base_raw, "base_amount"), _dec(tax_raw, "tax_amount")
            diff = quantize(total, currency) - quantize(base, currency) - quantize(tax, currency)
            comps = [component("תעריף בסיס", "base", base, currency)]
            if tax > 0:
                comps.append(component("מיסים והיטלים", "tax", tax, currency))
            if diff > 0:
                comps.append(component("עמלות/תוספות (הפרש מהסכום הכולל)", "fee", diff, currency, status="estimated"))
                warnings.append("פירוט המחיר אינו תואם לסכום הכולל שהספק דיווח — הסכום הכולל נשמר וההפרש סומן כהערכה")
            elif diff < 0:
                comps = [component("מחיר כולל (הפירוט אינו עקבי)", "base", total, currency, status="estimated")]
                warnings.append("פירוט המחיר שהספק דיווח אינו עקבי עם הסכום הכולל — המחיר מסומן כהערכה")
        return build_breakdown(comps, currency, persons=persons or None)

    @staticmethod
    def _baggage(offer: dict[str, Any], pax: list[dict[str, Any]], req: dict[str, Any], warnings: list[str], price) -> Baggage:
        adult_ids = [p.get("id") for p in pax if p.get("type") == "adult"] or [p.get("id") for p in pax[:1]]
        checked: list[int] = []
        carry: list[int] = []
        seen = False
        for s in _list(offer.get("slices")):
            for seg in _list(_obj(s).get("segments")):
                for p in _list(_obj(seg).get("passengers")):
                    p = _obj(p)
                    if adult_ids and p.get("passenger_id") not in adult_ids:
                        continue
                    bags = _list(p.get("baggages"))
                    seen = True
                    c = sum(int(_obj(b).get("quantity") or 0) for b in bags if _obj(b).get("type") == "checked")
                    k = sum(int(_obj(b).get("quantity") or 0) for b in bags if _obj(b).get("type") == "carry_on")
                    checked.append(c)
                    carry.append(k)
                    break
        if not seen:
            return Baggage(carry_on_included=None, checked_included=None, notes="פרטי מטען לא סופקו על ידי הספק")
        c_min, k_min = min(checked), min(carry)
        parts = [f"{c_min} מזוודות לבטן כלולות לנוסע" if c_min else "ללא מזוודה לבטן",
                 f"{k_min} תיקי יד כלולים" if k_min else "תיק יד לפי מדיניות חברת התעופה"]
        wanted = int(req.get("checked_bags") or 0)
        if wanted > c_min:
            note = (
                f"התעריף כולל {c_min} מזוודות לבטן לנוסע; מזוודות נוספות בתשלום שאינו כלול במחיר ומחירן לא נבדק"
            )
            warnings.append(note)
            price.excluded_notes.append(note)
        return Baggage(carry_on_included=k_min, checked_included=c_min, checked_bag_weight_kg=None, notes="; ".join(parts))

    @staticmethod
    def _cancellation(offer: dict[str, Any], total_currency: str) -> CancellationPolicy:
        conds = _obj(offer.get("conditions"))
        texts: list[str] = []

        def one(key: str, label_yes: str, label_no: str, label_unknown: str):
            c = conds.get(key)
            if not isinstance(c, dict):
                texts.append(label_unknown)
                return None, None
            allowed = c.get("allowed")
            fee = None
            amt, cur = c.get("penalty_amount"), c.get("penalty_currency")
            if amt is not None and isinstance(cur, str):
                try:
                    fee = money(_dec(amt, key), cur)
                except (NormalizationError, UnsupportedCurrencyError):
                    fee = None
            if allowed is True:
                texts.append(label_yes + (f" בקנס של {fee.amount} {fee.currency}" if fee and fee.amount > 0 else ""))
            elif allowed is False:
                texts.append(label_no)
            else:
                texts.append(label_unknown)
            return (allowed if isinstance(allowed, bool) else None), fee

        refundable, _ = one("refund_before_departure", "ניתן לבטל ולקבל החזר לפני ההמראה", "אין החזר כספי",
                            "מדיניות ההחזר לא צוינה")
        changeable, change_fee = one("change_before_departure", "ניתן לשנות לפני ההמראה", "אין אפשרות שינוי",
                                     "מדיניות השינוי לא צוינה")
        return CancellationPolicy(
            refundable=refundable,
            free_cancellation_until=None,
            changeable=changeable,
            change_fee=change_fee,
            policy_text="; ".join(texts),
        )

    # ---- revalidate / booking ----
    def revalidate(self, offer: CanonicalOffer) -> RevalidationResult:
        now = utcnow()
        if offer.source.provider_id != self.provider_id:
            return RevalidationResult(status="error", offer_id=offer.id, checked_at=now, message="ההצעה אינה שייכת לספק זה")
        sid = offer.source.supplier_offer_id
        if not _OFFER_ID_RE.match(sid or ""):
            return RevalidationResult(status="error", offer_id=offer.id, checked_at=now, message="מזהה ההצעה אצל הספק אינו תקין")
        if not self.is_configured():
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        with self._open(float(get_settings().provider_timeout_seconds)) as http:
            res = http.request("GET", f"/air/offers/{safe_identifier(sid)}", allow_404=True)
        checked = utcnow()
        if res.status == 404:
            return RevalidationResult(
                status="expired",
                offer_id=offer.id,
                checked_at=checked,
                message="ההצעה כבר אינה זמינה אצל Duffel (פג תוקף) — יש לבצע חיפוש חדש",
            )
        data = _obj(res.data.get("data"))
        raw = RawOffer(supplier_offer_id=sid, payload={"offer": data, "request": {}, "test_mode": self._is_test_token()},
                       fetched_at=checked, expires_at=_expiry(data.get("expires_at")))
        try:
            fresh = finalize_offer(self, self.normalize("flight", raw, SearchContext("revalidate", checked, 0)))
        except (NormalizationError, ValueError):
            return RevalidationResult(status="error", offer_id=offer.id, checked_at=checked,
                                      message="תשובת הספק לבדיקה חוזרת אינה תקינה")
        fresh = fresh.model_copy(update={"id": offer.id})
        if fresh.source.expires_at is not None and fresh.source.expires_at <= checked:
            return RevalidationResult(status="expired", offer_id=offer.id, checked_at=checked,
                                      message="תוקף ההצעה אצל Duffel פג — יש לבצע חיפוש חדש")
        old, new = offer.price.total, fresh.price.total
        if old.currency == new.currency and old.amount == new.amount:
            return RevalidationResult(status="unchanged", offer_id=offer.id, new_total=new, checked_at=checked,
                                      message="המחיר והזמינות אומתו מחדש מול Duffel — ללא שינוי", refreshed_offer=fresh)
        return RevalidationResult(
            status="price_changed",
            offer_id=offer.id,
            new_total=new,
            checked_at=checked,
            message=f"המחיר עודכן אצל Duffel: {old.amount} {old.currency} → {new.amount} {new.currency}. יש לאשר מחדש לפני המשך.",
            refreshed_offer=fresh,
        )

    def booking_options(self, offer: CanonicalOffer) -> BookingOptions:
        return BookingOptions(
            hosted_checkout_url=None,
            simulation_available=False,
            live_api_booking=False,
            instructions=(
                "Duffel אינה מספקת דף הזמנה לצרכן. הזמנה דרך Duffel מצריכה אינטגרציית הזמנות נפרדת ומאושרת, "
                "שאינה חלק מגרסה זו — המערכת לא מבצעת הזמנה ולא חיוב. ניתן להשתמש בפרטי ההצעה כדי להזמין ישירות "
                "באתר חברת התעופה או אצל סוכן."
            ),
        )


# ---------------------------------------------------------------- helpers ----


def _int_setting(value: object, default: int, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return max(lo, min(hi, value))


def _localize(value: datetime, iata: str) -> tuple[datetime, bool]:
    """Attach the airport's zone to a naive local time. Returns (aware_or_naive, still_naive)."""
    if value.tzinfo is not None:
        return value, False
    airport = AIRPORTS.get(iata)
    if airport is None:
        return value, True
    return value.replace(tzinfo=airport_zone(airport)), False


def _airport_name(iata: str, node: dict[str, Any]) -> str | None:
    airport = AIRPORTS.get(iata)
    return airport.name_he if airport else clean_text(node.get("name"), 80)


def _city_label(iata: str, node: object) -> str:
    airport = AIRPORTS.get(iata)
    if airport is not None:
        return city_of_airport(airport).name_he
    return clean_text(_obj(node).get("city_name"), 60) or iata


__all__ = [
    "DUFFEL_BASE_URL",
    "DuffelAdapter",
    "parse_iso_duration_minutes",
    "reset_daily_search_counter",
    "searches_used_today",
]
