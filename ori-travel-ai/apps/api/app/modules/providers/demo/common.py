"""Shared machinery for DEMO adapters (fictional suppliers, real geography).

Determinism
-----------
Every DEMO adapter is a pure function of its input:

* A shared *market* inventory (flights on a route/day, hotels in a city, car
  fleets at a location, activities in a city) is generated with
  ``random.Random(seed)`` where ``seed = sha256(canonical product params)``.
  Both DEMO providers of a category read the same market, which is how they
  end up selling truly-equivalent products (exercising dedupe).
* Provider-specific choices (which products it sells, its price markup) use
  ``seed = sha256(canonical params + provider_id + product id)``.
* Prices are computed (not drawn) from pax/rooms/nights/days so they scale
  sensibly; the only time-dependent fields are ``fetched_at``/``expires_at``.

Revalidation trigger (documented, DEMO only)
--------------------------------------------
``revalidate()`` returns ``unchanged`` (re-quoted with a fresh expiry) unless a
scenario is requested by, in order of precedence:

1. ``settings["revalidation_scenario"]`` passed by
   ``providers.service.revalidate_offer`` from the owner-editable provider
   settings (``unchanged | price_changed | expired | unavailable``);
2. a test override via ``adapter.set_revalidation_override(supplier_offer_id, scenario)``;
3. a ``supplier_offer_id`` suffix ``~PRICE_CHANGED`` / ``~EXPIRED`` / ``~UNAVAILABLE``.

``price_changed`` deterministically raises the base fare by 7%.
"""

from __future__ import annotations

import hashlib
import json
import random
import threading
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any, ClassVar

from pydantic import TypeAdapter

from app.core.db import utcnow
from app.core.money import quantize
from app.modules.comparison.fx import demo_usd_to
from app.modules.providers.base import (
    BookingOptions,
    ProviderAdapter,
    ProviderCapabilities,
    ProviderError,
    ProviderHealth,
    ProviderUnsupportedError,
    RawOffer,
    RevalidationResult,
    SearchContext,
)
from app.modules.providers.normalization import build_breakdown, component, compute_dedupe_key, money
from app.schemas.common import ApiModel, Category
from app.schemas.offers import CancellationPolicy, CanonicalOffer, OfferDetails, SourceInfo

DEMO_NOTE = "נתוני הדגמה — לא מחיר אמיתי ולא זמינות אמיתית"
DEMO_OFFER_TTL = timedelta(minutes=30)
DEFAULT_MAX_RESULTS = 20
REVALIDATION_SCENARIOS = ("unchanged", "price_changed", "expired", "unavailable")
PRICE_CHANGE_FACTOR = Decimal("0.07")

_DETAILS_ADAPTER: TypeAdapter[Any] = TypeAdapter(OfferDetails)


# ------------------------------------------------------------ seeding ----


def stable_hash(*parts: Any) -> str:
    payload = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def seeded_rng(*parts: Any) -> random.Random:
    return random.Random(int(stable_hash(*parts)[:16], 16))


def unit(*parts: Any) -> float:
    """Deterministic float in [0, 1) for the given parts."""
    return int(stable_hash(*parts)[:13], 16) / float(16**13)


def dec(value: float | int | str | Decimal) -> Decimal:
    return Decimal(str(value))


def round_dec(value: Decimal, places: str = "0.0001") -> Decimal:
    return value.quantize(Decimal(places), rounding=ROUND_HALF_EVEN)


def supplier_id(prefix: str, *parts: Any) -> str:
    return f"{prefix}-{stable_hash(*parts)[:12].upper()}"


# ------------------------------------------------------- price inputs ----

_MONTH_FACTOR = {1: "0.85", 2: "0.85", 3: "0.95", 4: "1.15", 5: "1.0", 6: "1.1", 7: "1.35", 8: "1.35",
                 9: "1.1", 10: "1.15", 11: "0.85", 12: "1.1"}


def season_factor(d: date) -> Decimal:
    """Rough family-travel seasonality (summer, holidays) — DEMO pricing input."""
    if d.month == 12 and d.day >= 20:
        return Decimal("1.3")
    return Decimal(_MONTH_FACTOR[d.month])


def usd(amount: Decimal, currency: str) -> Decimal:
    """Synthetic USD price expressed in the requested currency (DEMO FX table)."""
    return demo_usd_to(amount, currency)


def split_travellers(adults: int, children_ages: list[int], *, child_max: int = 11, infant_max: int = 1) -> dict[str, int]:
    """Airline/attraction style passenger types: 12+ = adult, 2-11 = child, 0-1 = infant."""
    child = sum(1 for a in children_ages if infant_max < a <= child_max)
    infant = sum(1 for a in children_ages if a <= infant_max)
    teen = sum(1 for a in children_ages if a > child_max)
    return {"adult": adults + teen, "child": child, "infant": infant}


# ------------------------------------------------------------ adapter ----


class DemoAdapter(ProviderAdapter):
    """Base class: deterministic synthetic offers, clearly labeled DEMO."""

    provider_id: str = ""
    display_name: str = ""
    categories: ClassVar[tuple[Category, ...]] = ()
    supplier_prefix: str = "DEMO"
    description: str = ""
    rate_limit_per_minute: int = 120
    timeout_seconds: float | None = None
    default_max_results: int = DEFAULT_MAX_RESULTS
    # Non-secret settings an owner may change via PUT /api/providers/{id}
    allowed_settings: ClassVar[dict[str, tuple]] = {
        "max_results": ("int", 1, 50),
        "revalidation_scenario": ("enum", ("auto", *REVALIDATION_SCENARIOS)),
        "simulate_error": ("bool",),
    }

    def __init__(self) -> None:
        self._overrides: dict[str, str] = {}
        self._lock = threading.Lock()

    # ---- contract ----
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            provider_id=self.provider_id,
            display_name=self.display_name,
            mode="DEMO",
            categories=list(self.categories),
            supports_search=True,
            supports_revalidate=True,
            supports_booking_options=True,
            supports_hosted_checkout=False,
            supports_live_booking=False,
            requires_credentials=[],
            official_docs_url=None,
            deep_link_domains=[],
            rate_limit_note="נתוני הדגמה מקומיים — ללא פנייה לרשת",
            notes=f"{self.description} {DEMO_NOTE}. ספק בדיוני עם גאוגרפיה אמיתית.".strip(),
        )

    def is_configured(self) -> bool:
        return True

    def health(self) -> ProviderHealth:
        return ProviderHealth(
            provider_id=self.provider_id,
            status="OK",
            checked_at=utcnow(),
            message="ספק הדגמה פעיל — נתונים סינתטיים, ללא חיבור לרשת",
            latency_ms=0,
        )

    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        if not self.supports(category):
            raise ProviderUnsupportedError("הספק אינו תומך בקטגוריה זו", code="UNSUPPORTED")
        settings = ctx.provider_settings or {}
        if settings.get("simulate_error"):
            raise ProviderError("תקלה מדומה בספק ההדגמה (הוגדרה בהגדרות הספק)", code="SIMULATED_ERROR")
        payloads = self.generate(category, params)
        try:
            limit = int(settings.get("max_results") or self.default_max_results)
        except (TypeError, ValueError):
            limit = self.default_max_results
        fetched = utcnow()
        return [
            RawOffer(
                supplier_offer_id=p["supplier_offer_id"],
                payload=p,
                fetched_at=fetched,
                expires_at=fetched + DEMO_OFFER_TTL,
            )
            for p in payloads[: max(1, min(limit, 50))]
        ]

    def generate(self, category: Category, params: ApiModel) -> list[dict[str, Any]]:  # pragma: no cover - abstract
        raise NotImplementedError

    def normalize(self, category: Category, raw: RawOffer, ctx: SearchContext) -> CanonicalOffer:
        p = raw.payload
        price = p["price"]
        currency = price["currency"]
        components = [
            component(
                c["label"],
                c["kind"],
                c["amount"],
                c.get("currency", currency),
                status=c.get("status", "known"),
                included=c.get("included", True),
            )
            for c in price["components"]
        ]
        breakdown = build_breakdown(
            components,
            currency,
            excluded_notes=price.get("excluded_notes", ()),
            nights=price.get("nights"),
            persons=price.get("persons"),
            days=price.get("days"),
        )
        canc = dict(p["cancellation"])
        if canc.get("change_fee") is not None:
            canc["change_fee"] = money(canc["change_fee"], currency)
        offer = CanonicalOffer(
            id="",
            category=category,
            title=p["title"],
            subtitle=p.get("subtitle"),
            source=SourceInfo(
                provider_id=self.provider_id,
                provider_name=self.display_name,
                mode="DEMO",
                fetched_at=raw.fetched_at,
                expires_at=raw.expires_at,
                supplier_offer_id=raw.supplier_offer_id,
                deep_link=None,
                note=DEMO_NOTE,
            ),
            price=breakdown,
            cancellation=CancellationPolicy(**canc),
            details=_DETAILS_ADAPTER.validate_python(p["details"]),
            dedupe_key="",
            warnings=list(p.get("warnings", ())),
        )
        return offer.model_copy(update={"dedupe_key": compute_dedupe_key(offer)})

    # ---- revalidation / booking ----
    def set_revalidation_override(self, supplier_offer_id: str, scenario: str | None) -> None:
        """Test hook: force a revalidation outcome for one supplier offer id."""
        with self._lock:
            if scenario is None:
                self._overrides.pop(supplier_offer_id, None)
            elif scenario in REVALIDATION_SCENARIOS:
                self._overrides[supplier_offer_id] = scenario
            else:
                raise ValueError(f"unknown scenario {scenario}")

    def _scenario(self, offer: CanonicalOffer, settings: dict[str, Any] | None) -> str:
        configured = (settings or {}).get("revalidation_scenario")
        if configured in REVALIDATION_SCENARIOS:
            return configured
        sid = offer.source.supplier_offer_id
        with self._lock:
            if sid in self._overrides:
                return self._overrides[sid]
        upper = sid.upper()
        for scenario in ("price_changed", "expired", "unavailable"):
            if upper.endswith("~" + scenario.upper()):
                return scenario
        return "unchanged"

    def revalidate(self, offer: CanonicalOffer, *, settings: dict[str, Any] | None = None) -> RevalidationResult:
        now = utcnow()
        if offer.source.provider_id != self.provider_id:
            return RevalidationResult(
                status="error", offer_id=offer.id, checked_at=now, message="ההצעה אינה שייכת לספק זה"
            )
        scenario = self._scenario(offer, settings)
        if scenario == "expired":
            return RevalidationResult(
                status="expired",
                offer_id=offer.id,
                checked_at=now,
                message="תוקף ההצעה פג אצל הספק (הדגמה) — יש לבצע חיפוש חדש",
            )
        if scenario == "unavailable":
            return RevalidationResult(
                status="unavailable",
                offer_id=offer.id,
                checked_at=now,
                message="ההצעה אזלה אצל הספק (הדגמה) — יש לבחור הצעה אחרת",
            )
        source = offer.source.model_copy(update={"fetched_at": now, "expires_at": now + DEMO_OFFER_TTL})
        if scenario == "price_changed":
            price = _raise_price(offer)
            refreshed = offer.model_copy(update={"source": source, "price": price, "score": None})
            return RevalidationResult(
                status="price_changed",
                offer_id=offer.id,
                new_total=price.total,
                checked_at=now,
                message=(
                    f"המחיר עודכן אצל הספק (הדגמה): {offer.price.total.amount} → {price.total.amount} "
                    f"{price.total.currency}. יש לאשר מחדש לפני המשך."
                ),
                refreshed_offer=refreshed,
            )
        refreshed = offer.model_copy(update={"source": source})
        return RevalidationResult(
            status="unchanged",
            offer_id=offer.id,
            new_total=offer.price.total,
            checked_at=now,
            message="המחיר והזמינות אומתו מחדש (הדגמה) — ללא שינוי",
            refreshed_offer=refreshed,
        )

    def booking_options(self, offer: CanonicalOffer) -> BookingOptions:
        return BookingOptions(
            hosted_checkout_url=None,
            simulation_available=True,
            live_api_booking=False,
            instructions=(
                "זוהי הצעת הדגמה: ניתן לתרגל את תהליך הכנת ההזמנה במצב סימולציה בלבד. "
                "לא תתבצע הזמנה אמיתית, לא יבוצע חיוב ולא יישלחו פרטים לספק."
            ),
        )


def _raise_price(offer: CanonicalOffer):
    """Deterministic +7% on the first included base component (DEMO price_changed scenario)."""
    pb = offer.price
    currency = pb.total.currency
    comps = list(pb.components)
    idx = next(
        (i for i, c in enumerate(comps) if c.kind == "base" and c.included_in_total),
        next(i for i, c in enumerate(comps) if c.included_in_total),
    )
    target = comps[idx]
    delta = quantize(pb.total.amount * PRICE_CHANGE_FACTOR, currency)
    if delta <= 0:
        delta = quantize(Decimal(1), currency)
    comps[idx] = target.model_copy(update={"amount": money(target.amount.amount + delta, currency)})
    nights = _divisor(pb.total.amount, pb.per_night)
    persons = _divisor(pb.total.amount, pb.per_person)
    days = _divisor(pb.total.amount, pb.per_day)
    return build_breakdown(comps, currency, excluded_notes=pb.excluded_notes, nights=nights, persons=persons, days=days)


def _divisor(total: Decimal, per) -> int | None:
    if per is None or per.amount <= 0:
        return None
    return max(1, int((total / per.amount).to_integral_value(rounding=ROUND_HALF_EVEN)))
