"""Shared normalization helpers used by every adapter and by the search orchestrator.

* Money / PriceBreakdown builders: ``total`` is ALWAYS the exact sum of the
  components with ``included_in_total=True`` (validated, never trusted).
* Sanitization of untrusted supplier text: HTML tags, control and bidi-override
  characters are removed and length is capped. Supplier text is data, never
  instructions or markup.
* Deep links are dropped (with a warning) unless ``adapter.is_allowed_deep_link``.
* ``compute_dedupe_key``: category-specific hash of the fields that define a
  truly-equivalent product. It never includes the price, the currency or the
  provider, so the same flight/room/car/activity sold by two providers collides.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import unicodedata
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from app.core.money import quantize
from app.schemas.common import Money
from app.schemas.offers import (
    ActivityDetails,
    CanonicalOffer,
    CarDetails,
    CostStatus,
    FlightDetails,
    HotelDetails,
    PriceBreakdown,
    PriceComponent,
    PriceComponentKind,
)

if TYPE_CHECKING:  # pragma: no cover
    from app.modules.providers.base import ProviderAdapter

MAX_TEXT = 300
MAX_TITLE = 200
MAX_LONG_TEXT = 2000
MAX_LIST_ITEMS = 40
DEEP_LINK_REMOVED_WARNING = "קישור הספק הוסר משום שאינו מוביל לדומיין מאושר של הספק"


class NormalizationError(ValueError):
    """Raised when provider data is internally inconsistent and must be rejected."""


# ---------------------------------------------------------------- text ----

_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")
# Bidi embedding/override/isolate controls can visually spoof text; remove them.
_BIDI_CONTROLS = {ord(c): None for c in "‪‫‬‭‮⁦⁧⁨⁩"}
# Zero-width / format characters other than LRM/RLM/ZWJ/ZWNJ (which Hebrew text may use)
_KEEP_FORMAT = {"‎", "‏", "‌", "‍"}


def clean_text(value: Any, max_len: int = MAX_TEXT) -> str | None:
    """Return safe plain text (no markup, no control chars), or None when empty."""
    if value is None:
        return None
    s = str(value)
    # Decode entities twice so double-encoded markup (&amp;lt;script&amp;gt;) is caught too.
    for _ in range(2):
        s = html.unescape(s)
    s = _TAG_RE.sub(" ", s)
    s = s.replace("<", " ").replace(">", " ")
    s = s.translate(_BIDI_CONTROLS)
    s = "".join(
        " " if unicodedata.category(ch) == "Cc" else ch
        for ch in s
        if unicodedata.category(ch) != "Cf" or ch in _KEEP_FORMAT
    )
    s = _WS_RE.sub(" ", s).strip()
    if not s:
        return None
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip() + "…"
    return s


def clean_text_list(values: Iterable[Any] | None, max_len: int = MAX_TEXT, max_items: int = MAX_LIST_ITEMS) -> list[str]:
    out: list[str] = []
    for v in values or ():
        c = clean_text(v, max_len)
        if c and c not in out:
            out.append(c)
        if len(out) >= max_items:
            break
    return out


# Keys inside a dumped CanonicalOffer that are identifiers / validated separately.
_SKIP_KEYS = {"deep_link", "dedupe_key", "id"}
_LONG_TEXT_KEYS = {"description", "policy_text", "note", "notes"}
_ID_KEYS = {"supplier_offer_id", "hotel_id", "activity_id"}


def _sanitize_value(key: str | None, value: Any) -> Any:
    if isinstance(value, str):
        if key in _ID_KEYS:
            return clean_text(value, 255)
        if key == "title":
            return clean_text(value, MAX_TITLE)
        return clean_text(value, MAX_LONG_TEXT if key in _LONG_TEXT_KEYS else MAX_TEXT)
    if isinstance(value, dict):
        return {k: (v if k in _SKIP_KEYS else _sanitize_value(k, v)) for k, v in value.items()}
    if isinstance(value, list):
        items = [_sanitize_value(key, v) for v in value[:100]]
        if all(isinstance(v, str) or v is None for v in value):
            return [v for v in items if v]
        return items
    return value


def sanitize_offer(offer: CanonicalOffer) -> CanonicalOffer:
    """Clean every free-text field of an offer (re-validates the model)."""
    data = offer.model_dump(mode="python")
    cleaned = _sanitize_value(None, data)
    return CanonicalOffer.model_validate(cleaned)


# --------------------------------------------------------------- money ----


def money(amount: Decimal | str | int, currency: str) -> Money:
    return Money(amount=quantize(Decimal(str(amount)), currency), currency=currency)


def component(
    label: str,
    kind: PriceComponentKind,
    amount: Decimal | str | int,
    currency: str,
    *,
    status: CostStatus = "known",
    included: bool = True,
) -> PriceComponent:
    if status == "excluded" and included:
        raise NormalizationError("excluded component cannot be included in total")
    return PriceComponent(
        label=label, kind=kind, amount=money(amount, currency), status=status, included_in_total=included
    )


def build_breakdown(
    components: Sequence[PriceComponent],
    currency: str,
    *,
    excluded_notes: Iterable[str] = (),
    nights: int | None = None,
    persons: int | None = None,
    days: int | None = None,
) -> PriceBreakdown:
    """Compute total = sum(included components). Totals are never taken from suppliers blindly."""
    included = [c for c in components if c.included_in_total]
    if not included:
        raise NormalizationError("price has no included components")
    for c in included:
        if c.amount.currency != currency:
            raise NormalizationError("included component currency differs from total currency")
    total = quantize(sum((c.amount.amount for c in included), Decimal(0)), currency)
    if total <= 0:
        raise NormalizationError("total must be positive")
    total_status = "estimated" if any(c.status == "estimated" for c in included) else "known"

    def per(divisor: int | None) -> Money | None:
        if not divisor or divisor <= 0:
            return None
        return money(total / divisor, currency)

    return PriceBreakdown(
        total=Money(amount=total, currency=currency),
        total_status=total_status,
        components=list(components),
        excluded_notes=list(excluded_notes),
        per_night=per(nights),
        per_person=per(persons),
        per_day=per(days),
    )


def validate_breakdown(pb: PriceBreakdown) -> None:
    """Raise NormalizationError unless total == sum of included components (same currency)."""
    included = [c for c in pb.components if c.included_in_total]
    if not included:
        raise NormalizationError("price has no included components")
    for c in pb.components:
        if c.status == "excluded" and c.included_in_total:
            raise NormalizationError("excluded component marked as included")
    for c in included:
        if c.amount.currency != pb.total.currency:
            raise NormalizationError("included component currency differs from total currency")
    total = sum((c.amount.amount for c in included), Decimal(0))
    if quantize(total, pb.total.currency) != quantize(pb.total.amount, pb.total.currency):
        raise NormalizationError("price total does not equal the sum of included components")
    if pb.total.amount <= 0:
        raise NormalizationError("total must be positive")
    if pb.total_status == "known" and any(c.status == "estimated" for c in included):
        raise NormalizationError("known total cannot include estimated components")


# --------------------------------------------------------------- dedupe ---


def _norm(value: Any) -> str:
    if value is None:
        return ""
    s = unicodedata.normalize("NFKD", str(value).casefold())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join("".join(ch if ch.isalnum() else " " for ch in s).split())


def _utc(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M")


def _pricing_basis(offer: CanonicalOffer) -> list[list[Any]]:
    """What is (not) included in the total — offers that price different things are not merged."""
    basis = {
        (c.kind, c.status, c.included_in_total)
        for c in offer.price.components
        if c.status != "known" or not c.included_in_total
    }
    return [list(b) for b in sorted(basis)]


def dedupe_parts(offer: CanonicalOffer) -> list[Any]:
    d = offer.details
    c = offer.cancellation
    parts: list[Any]
    if isinstance(d, FlightDetails):
        parts = [
            "flight",
            [
                [
                    [s.carrier_code.upper().strip(), _norm(s.flight_number), s.origin.upper(), s.destination.upper(),
                     _utc(s.departing_at), _norm(s.cabin)]
                    for s in sl.segments
                ]
                for sl in d.slices
            ],
            _norm(d.cabin),
            _norm(d.fare_brand),
            [d.baggage.carry_on_included, d.baggage.checked_included, d.baggage.checked_bag_weight_kg],
            sorted((k, v) for k, v in d.passengers.items() if v),
            c.refundable,
            c.changeable,
        ]
    elif isinstance(d, HotelDetails):
        parts = [
            "hotel",
            _norm(d.hotel_name),
            round(d.latitude, 3) if d.latitude is not None else None,
            round(d.longitude, 3) if d.longitude is not None else None,
            _norm(d.city),
            _norm(d.room_name),
            d.board,
            d.check_in.isoformat(),
            d.check_out.isoformat(),
            d.rooms,
            d.adults,
            d.children,
            c.refundable,
            c.free_cancellation_until.astimezone(UTC).date().isoformat() if c.free_cancellation_until else None,
        ]
    elif isinstance(d, CarDetails):
        parts = [
            "car",
            _norm(d.vendor),
            d.car_class,
            _norm(d.model_example),
            d.transmission,
            d.seats,
            _norm(d.pickup_location),
            _norm(d.dropoff_location),
            _utc(d.pickup_at),
            _utc(d.dropoff_at),
            _norm(d.mileage),
            _norm(d.fuel_policy),
            sorted(_norm(i) for i in d.insurance_included),
            c.refundable,
        ]
    elif isinstance(d, ActivityDetails):
        parts = [
            "activity",
            _norm(d.name),
            _norm(d.city),
            _norm(d.meeting_point),
            d.duration_minutes,
            sorted(d.start_times),
            sorted(x.isoformat() for x in d.available_dates),
            sorted((k, v) for k, v in d.participants.items() if v),
            c.refundable,
        ]
    else:  # pragma: no cover - discriminated union is exhaustive
        raise NormalizationError("unknown offer details kind")
    parts.append(_pricing_basis(offer))
    return parts


def compute_dedupe_key(offer: CanonicalOffer) -> str:
    payload = json.dumps(dedupe_parts(offer), ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"{offer.category}:{digest[:48]}"


# ------------------------------------------------------------- finalize ---


def finalize_offer(adapter: ProviderAdapter, offer: CanonicalOffer) -> CanonicalOffer:
    """Enforce the canonical contract on an adapter's normalized offer.

    Checks provider identity and data mode, validates the price breakdown,
    removes non-allowlisted deep links, sanitizes text and (re)computes the
    dedupe key centrally so all providers share one definition.
    """
    caps = adapter.capabilities()
    if offer.source.provider_id != adapter.provider_id:
        raise NormalizationError("offer provider_id does not match adapter")
    if offer.source.mode != caps.mode:
        raise NormalizationError("offer data mode does not match adapter mode")
    if offer.category != offer.details.kind:
        raise NormalizationError("offer category does not match details kind")
    if offer.category not in caps.categories:
        raise NormalizationError("adapter returned an offer outside its declared categories")
    validate_breakdown(offer.price)

    warnings = list(offer.warnings)
    source = offer.source
    if source.deep_link and not adapter.is_allowed_deep_link(source.deep_link):
        source = source.model_copy(update={"deep_link": None})
        warnings.append(DEEP_LINK_REMOVED_WARNING)
    offer = offer.model_copy(update={"source": source, "warnings": warnings, "id": "", "score": None})
    offer = sanitize_offer(offer)
    if not offer.source.supplier_offer_id:
        raise NormalizationError("missing supplier offer id")
    return offer.model_copy(update={"dedupe_key": compute_dedupe_key(offer)})
