"""Viator Partner API (activities) — LIVE adapter, Basic affiliate access.

Docs: https://docs.viator.com/partner-api/technical/ (see ``docs/integrations/provider-api-notes.md`` §5).

* ``POST /products/search`` with ``exp-api-key``, ``Accept: application/json;version=2.0`` and
  ``Accept-Language``. Hosts: production ``https://api.viator.com/partner`` or sandbox
  ``https://api.sandbox.viator.com/partner`` (provider setting ``environment``).
* Basic affiliate access has NO live availability: prices are the product's "from" price and are
  always ``total_status="estimated"`` with an explicit warning. Product URLs (affiliate tracked) are
  kept only when they are https links on ``viator.com``.
* No booking: ``booking_options`` only offers the affiliate product page.

UNVERIFIED (request/response shapes and ids are [prior] knowledge; only mocked fixtures were tested):
the body of ``/products/search``, the ``products[]`` response fields, the supported-currency list and
the destination ids below.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import timedelta
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
    SearchContext,
)
from app.modules.providers.data.geo import resolve_city
from app.modules.providers.live.common import NOT_CONNECTED_MESSAGE, LiveAdapter
from app.modules.providers.live.httpclient import LiveHttp
from app.modules.providers.normalization import (
    DEEP_LINK_REMOVED_WARNING,
    NormalizationError,
    build_breakdown,
    clean_text,
    component,
    compute_dedupe_key,
    money,
)
from app.schemas.common import ApiModel, Category
from app.schemas.offers import ActivityDetails, CancellationPolicy, CanonicalOffer, SourceInfo
from app.schemas.search import ActivitySearchParams

log = logging.getLogger("ori.providers.live.viator")

VIATOR_BASE_URLS = {
    "production": "https://api.viator.com/partner",
    "sandbox": "https://api.sandbox.viator.com/partner",
}
MAX_PRODUCTS = 50
DEFAULT_COUNT = 20
_KEY_RE = re.compile(r"^[A-Za-z0-9\-_.]{8,200}$")

# IATA-city-code (our geo table) -> Viator destination id.
# UNVERIFIED: recalled from prior knowledge, NOT checked against the official `GET /destinations`
# taxonomy. Wrong ids would return another city's activities, so every offer carries a warning and
# the owner must spot-check before relying on this table.
VIATOR_DESTINATION_IDS: dict[str, str] = {
    "ROM": "511",
    "PAR": "479",
    "LON": "737",
    "BCN": "562",
    "ATH": "496",
    "PRG": "462",
    "AMS": "525",
    "VIE": "454",
    "BUD": "499",
    "IST": "585",
    "NYC": "687",
    "MAD": "566",
    "LIS": "538",
    "BER": "488",
    "DXB": "828",
}
UNVERIFIED_DESTINATION_WARNING = "מזהה היעד ב-Viator לא אומת מול התיעוד הרשמי — ודאו שהפעילות אכן בעיר המבוקשת"
# Currencies assumed to be accepted by the API (UNVERIFIED). Anything else falls back to USD.
VIATOR_CURRENCIES = frozenset({"USD", "EUR", "GBP", "AUD", "CAD", "CHF", "JPY", "SEK", "NOK", "DKK"})
ESTIMATE_WARNING = (
    "מחיר 'החל מ' בלבד: גישת Basic של Viator אינה כוללת בדיקת זמינות ומחיר בזמן אמת — "
    "המחיר הסופי, התאריכים והשעות נקבעים באתר Viator"
)


class ViatorAdapter(LiveAdapter):
    provider_id = "viator"
    display_name = "Viator (אטרקציות)"
    categories: ClassVar[tuple[Category, ...]] = ("activity",)
    credential_fields = ("viator_api_key",)
    official_docs_url = "https://docs.viator.com/partner-api/technical/"
    deep_link_domains = ("viator.com",)
    rate_limit_note = "מגבלות קצב לפי רמת השותף ב-Viator (גישת Basic); קריאות החיפוש ללא עלות"
    description = (
        "API רשמי לשותפים של Viator לסיורים ואטרקציות — גישת affiliate בסיסית: חיפוש בלבד. "
        "המחירים הם 'החל מ' (הערכה), ללא זמינות בזמן אמת; ההזמנה מתבצעת באתר Viator דרך קישור שותפים. "
        "נתמכים רק יעדים שקיים להם מזהה יעד בטבלה הפנימית (לא אומתה מול התיעוד הרשמי)."
    )
    implemented: ClassVar[bool] = True
    allowed_settings: ClassVar[dict[str, tuple]] = {
        "max_results": ("int", 1, MAX_PRODUCTS),
        "language": ("enum", ("he", "en")),
        "environment": ("enum", ("production", "sandbox")),
    }

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def capabilities(self) -> ProviderCapabilities:
        return super().capabilities().model_copy(
            update={
                "supports_revalidate": False,
                "supports_booking_options": True,
                "supports_hosted_checkout": True,
                "supports_live_booking": False,
            }
        )

    @staticmethod
    def _key() -> str | None:
        raw = get_settings().viator_api_key
        return raw.strip() if raw and raw.strip() else None

    def is_configured(self) -> bool:
        key = self._key()
        return bool(get_settings().live_providers_enabled) and bool(key and _KEY_RE.match(key))

    def _open(self, timeout: float, settings: dict[str, Any], language: str) -> LiveHttp:
        key = self._key()
        if not key or not _KEY_RE.match(key):
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        env = settings.get("environment")
        base = VIATOR_BASE_URLS.get(env if isinstance(env, str) else "production", VIATOR_BASE_URLS["production"])
        return LiveHttp(
            provider_label=self.provider_id,
            base_url=base,
            headers={
                "exp-api-key": key,
                "Accept": "application/json;version=2.0",
                "Accept-Language": "he" if language == "he" else "en-US",
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
        body = {"filtering": {"destination": VIATOR_DESTINATION_IDS["ROM"]}, "pagination": {"start": 1, "count": 1},
                "currency": "USD"}
        try:
            with self._open(float(get_settings().provider_timeout_seconds), {}, "en") as http:
                http.request("POST", "/products/search", json_body=body)
        except ProviderNotConfiguredError as exc:
            return ProviderHealth(provider_id=self.provider_id, status="NOT_CONFIGURED", checked_at=utcnow(),
                                  message=exc.message)
        except ProviderRateLimitedError as exc:
            return ProviderHealth(provider_id=self.provider_id, status="DEGRADED", checked_at=utcnow(), message=exc.message)
        except ProviderError as exc:
            return ProviderHealth(provider_id=self.provider_id, status="FAILED", checked_at=utcnow(), message=exc.message)
        return ProviderHealth(
            provider_id=self.provider_id,
            status="OK",
            checked_at=utcnow(),
            message="החיבור ל-Viator תקין (חיפוש בלבד, גישת Basic)",
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )

    # ---- search ----
    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        if not self.is_configured():
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        if category != "activity" or not isinstance(params, ActivitySearchParams):
            raise ProviderUnsupportedError("הספק תומך בחיפוש פעילויות בלבד", code="UNSUPPORTED")
        settings = ctx.provider_settings or {}
        city = resolve_city(params.destination)
        dest_id = VIATOR_DESTINATION_IDS.get(city.code) if city else None
        if city is None or dest_id is None:
            raise ProviderUnsupportedError("היעד אינו נתמך בחיבור ל-Viator בגרסה זו", code="UNSUPPORTED_LOCATION")
        count = settings.get("max_results")
        count = count if isinstance(count, int) and not isinstance(count, bool) else DEFAULT_COUNT
        count = max(1, min(MAX_PRODUCTS, count))
        currency = params.currency if params.currency in VIATOR_CURRENCIES else "USD"
        language = settings.get("language") or ("he" if (params.language or "").lower().startswith("he") else "en")
        body = {
            "filtering": {
                "destination": dest_id,
                "startDate": params.date_from.isoformat(),
                "endDate": params.date_to.isoformat(),
            },
            "sorting": {"sort": "DEFAULT"},
            "pagination": {"start": 1, "count": count},
            "currency": currency,
        }
        with self._open(ctx.timeout_seconds, settings, str(language)) as http:
            res = http.request("POST", "/products/search", json_body=body)
        products = res.data.get("products")
        if not isinstance(products, list):
            raise ProviderError("תשובת הספק אינה תקינה — לא ניתן לעבד אותה", code="BAD_RESPONSE")
        fetched = utcnow()
        raws: list[RawOffer] = []
        for item in products[:count]:
            if not isinstance(item, dict):
                continue
            code = item.get("productCode")
            if not isinstance(code, str) or not re.match(r"^[A-Za-z0-9_\-]{1,60}$", code):
                continue
            raws.append(
                RawOffer(
                    supplier_offer_id=code,
                    payload={
                        "product": item,
                        "request": {
                            "city_he": city.name_he,
                            "adults": params.adults,
                            "children": len(params.children_ages),
                            "requested_currency": params.currency,
                            "sandbox": settings.get("environment") == "sandbox",
                        },
                    },
                    fetched_at=fetched,
                    expires_at=fetched + timedelta(hours=1),
                )
            )
        return raws

    # ---- normalize ----
    def normalize(self, category: Category, raw: RawOffer, ctx: SearchContext) -> CanonicalOffer:
        product = raw.payload.get("product") if isinstance(raw.payload.get("product"), dict) else {}
        req = raw.payload.get("request") if isinstance(raw.payload.get("request"), dict) else {}
        title = clean_text(product.get("title"), 200)
        if not title:
            raise NormalizationError("product without title")
        pricing = product.get("pricing") if isinstance(product.get("pricing"), dict) else {}
        summary = pricing.get("summary") if isinstance(pricing.get("summary"), dict) else {}
        currency = pricing.get("currency")
        try:
            from_price = Decimal(str(summary.get("fromPrice")))
            if not from_price.is_finite() or from_price <= 0:
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            raise NormalizationError("product without a usable from-price") from None
        if not isinstance(currency, str):
            raise NormalizationError("product without currency")
        try:
            quantize(Decimal(1), currency)
        except UnsupportedCurrencyError:
            raise NormalizationError("unsupported currency") from None

        adults = int(req.get("adults") or 1)
        children = int(req.get("children") or 0)
        travellers = max(1, adults + children)
        price = build_breakdown(
            [
                component(
                    f"מחיר 'החל מ' לאדם × {travellers} משתתפים (הערכה)",
                    "base",
                    from_price * travellers,
                    currency,
                    status="estimated",
                )
            ],
            currency,
            excluded_notes=["מחירי ילדים, שעות ותאריכים נקבעים באתר Viator"],
            persons=travellers,
        )
        price = price.model_copy(update={"per_person": money(from_price, currency)})

        warnings = [ESTIMATE_WARNING, UNVERIFIED_DESTINATION_WARNING]
        if req.get("requested_currency") and req.get("requested_currency") != currency:
            warnings.append(f"המחיר מוצג במטבע {currency} כפי שהחזיר הספק (התבקש {req.get('requested_currency')})")
        link = product.get("productUrl")
        deep_link = link if isinstance(link, str) and self.is_allowed_deep_link(link) else None
        if link and deep_link is None:
            warnings.append(DEEP_LINK_REMOVED_WARNING)

        duration = product.get("duration") if isinstance(product.get("duration"), dict) else {}
        minutes = duration.get("fixedDurationInMinutes") or duration.get("variableDurationFromMinutes")
        minutes = int(minutes) if isinstance(minutes, int | float) and not isinstance(minutes, bool) and minutes > 0 else None
        reviews = product.get("reviews") if isinstance(product.get("reviews"), dict) else {}
        rating = reviews.get("combinedAverageRating")
        rating = float(rating) if isinstance(rating, int | float) and not isinstance(rating, bool) and 0 <= rating <= 5 else None
        count = reviews.get("totalReviews")
        count = int(count) if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else None
        participants = {"adult": adults}
        if children:
            participants["child"] = children

        note = "Viator — גישת affiliate בסיסית: מחיר 'החל מ' ללא זמינות בזמן אמת"
        if req.get("sandbox"):
            note += " (סביבת sandbox — נתוני בדיקה)"
        offer = CanonicalOffer(
            id="",
            category="activity",
            title=title,
            subtitle=f"{req.get('city_he') or ''} · Viator".strip(" ·"),
            source=SourceInfo(
                provider_id=self.provider_id,
                provider_name=self.display_name,
                mode="LIVE",
                fetched_at=raw.fetched_at,
                expires_at=raw.expires_at,
                supplier_offer_id=raw.supplier_offer_id,
                deep_link=deep_link,
                note=note,
            ),
            price=price,
            cancellation=CancellationPolicy(
                refundable=None, policy_text="מדיניות הביטול נקבעת לכל מוצר — יש לבדוק באתר Viator לפני ההזמנה"
            ),
            details=ActivityDetails(
                name=title,
                activity_id=raw.supplier_offer_id,
                category="tour",
                city=str(req.get("city_he") or ""),
                description=clean_text(product.get("description"), 2000),
                duration_minutes=minutes,
                rating=rating,
                review_count=count,
                participants=participants,
            ),
            dedupe_key="",
            warnings=warnings,
        )
        return offer.model_copy(update={"dedupe_key": compute_dedupe_key(offer)})

    def booking_options(self, offer: CanonicalOffer) -> BookingOptions:
        link = offer.source.deep_link
        return BookingOptions(
            hosted_checkout_url=link if self.is_allowed_deep_link(link) else None,
            simulation_available=False,
            live_api_booking=False,
            instructions=(
                "ההזמנה מתבצעת באתר Viator בלבד, דרך קישור השותפים — המערכת אינה מבצעת הזמנה או חיוב. "
                "המחיר המוצג הוא 'החל מ' והוא עלול להשתנות; יש לבדוק זמינות, שעות ומדיניות ביטול באתר."
            ),
        )


__all__ = ["VIATOR_BASE_URLS", "VIATOR_DESTINATION_IDS", "ViatorAdapter"]
