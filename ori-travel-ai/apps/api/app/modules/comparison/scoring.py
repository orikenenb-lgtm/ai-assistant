"""Deterministic, explainable offer scoring (0-100 per factor).

total = sum(weight_f * factor_f) / 100 with weights in percent (sum 100).

* cost        — 100 - 1.5 x (% above the cheapest), floor 0; computed ONLY within the same
                (category, currency) group. Mixed currencies are never
                converted: every offer of that category gets
                ``comparable=False`` and a Hebrew reason.
* convenience — flights: total duration vs fastest, stops, layovers, night
                departures, preferred departure window; hotels: distance to
                centre; cars: transmission, pickup counter, seats vs need,
                mileage; activities: duration and start times.
* flexibility — refundable / free cancellation still open / changeable.
* quality     — flights: baggage, cabin; hotels: guest rating + stars;
                cars: insurance; activities: rating, reviews, family fit.

Ties are broken by total price, then provider_id, then supplier_offer_id, so
the same inputs always produce the same ranking. The input list is not mutated.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.core.app_settings import DEFAULT_RANKING_WEIGHTS
from app.core.db import utcnow
from app.schemas.offers import (
    ActivityDetails,
    CanonicalOffer,
    CarDetails,
    FlightDetails,
    HotelDetails,
    ScoreBreakdown,
)

FACTORS = ("cost", "convenience", "flexibility", "quality")
ONE_DP = Decimal("0.1")
HUNDRED = Decimal(100)
# cost = 100 - 1.5 points per 1% above the cheapest offer of the same currency (floor 0)
COST_PENALTY_PER_PCT = Decimal("1.5")

_WINDOWS = {"morning": (5, 12), "afternoon": (12, 17), "evening": (17, 21), "night": (21, 29)}
_WINDOW_HE = {"morning": "בוקר", "afternoon": "צהריים", "evening": "ערב", "night": "לילה"}


class WeightsError(ValueError):
    """Invalid ranking weights (message is Hebrew, user safe)."""


def normalize_weights(weights: Mapping[str, Any] | None) -> dict[str, int]:
    if weights is None:
        return dict(DEFAULT_RANKING_WEIGHTS)
    if set(weights) != set(FACTORS):
        raise WeightsError("יש לציין משקל לכל אחד מהגורמים: עלות, נוחות, גמישות ואיכות")
    out: dict[str, int] = {}
    for f in FACTORS:
        v = weights[f]
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 100:
            raise WeightsError("כל משקל חייב להיות מספר שלם בין 0 ל-100")
        out[f] = v
    if sum(out.values()) != 100:
        raise WeightsError("סכום המשקלים חייב להיות 100")
    return out


def parse_weights_param(text: str) -> dict[str, int]:
    """Parse 'cost:40,convenience:25,flexibility:20,quality:15'."""
    pairs: dict[str, int] = {}
    for chunk in text.split(","):
        if not chunk.strip():
            continue
        if ":" not in chunk:
            raise WeightsError("פורמט משקלים לא תקין — למשל cost:40,convenience:25,flexibility:20,quality:15")
        k, v = chunk.split(":", 1)
        k = k.strip().lower()
        if k not in FACTORS or k in pairs:
            raise WeightsError("פורמט משקלים לא תקין — למשל cost:40,convenience:25,flexibility:20,quality:15")
        try:
            pairs[k] = int(v.strip())
        except ValueError as exc:
            raise WeightsError("כל משקל חייב להיות מספר שלם בין 0 ל-100") from exc
    return normalize_weights(pairs)


def _clamp(v: Decimal | float | int) -> Decimal:
    d = Decimal(str(v))
    return max(Decimal(0), min(HUNDRED, d)).quantize(ONE_DP, rounding=ROUND_HALF_UP)


def _pct(numerator: Decimal, denominator: Decimal) -> int:
    if denominator <= 0:
        return 0
    return int(((numerator / denominator - 1) * HUNDRED).to_integral_value(rounding=ROUND_HALF_UP))


# ------------------------------------------------------------------- cost ----


def _cost(offer: CanonicalOffer, cheapest: Decimal) -> tuple[Decimal, list[str]]:
    total = offer.price.total.amount
    reasons: list[str] = []
    if total <= 0:
        return HUNDRED, reasons
    if total <= cheapest:
        score = HUNDRED
        reasons.append("המחיר הנמוך ביותר בקבוצה")
    else:
        over_pct = (total / cheapest - 1) * HUNDRED
        score = _clamp(HUNDRED - COST_PENALTY_PER_PCT * over_pct)
        reasons.append(f"יקר ב-{_pct(total, cheapest)}% מההצעה הזולה ביותר")
    if offer.price.total_status == "estimated":
        reasons.append("המחיר הכולל הוא הערכה")
    if any(not c.included_in_total for c in offer.price.components):
        reasons.append("יש עלויות שאינן כלולות במחיר (ראו פירוט)")
    return score, reasons


# ------------------------------------------------------------ convenience ----


def _flight_convenience(d: FlightDetails, fastest: int, prefs: Mapping[str, Any]) -> tuple[Decimal, list[str]]:
    reasons: list[str] = []
    s = Decimal(100)
    if fastest > 0 and d.total_duration_minutes > fastest:
        ratio = Decimal(d.total_duration_minutes) / Decimal(fastest)
        s -= min(Decimal(40), (ratio - 1) * Decimal(80))
        reasons.append(f"משך כולל ארוך ב-{_pct(Decimal(d.total_duration_minutes), Decimal(fastest))}% מהמהירה ביותר")
    stops = sum(sl.stops for sl in d.slices)
    if stops == 0:
        reasons.append("טיסות ישירות")
    else:
        s -= 12 * stops
        reasons.append(f"{stops} עצירות ביניים בסך הכול" if stops > 1 else "עצירת ביניים אחת")
    for sl in d.slices:
        for lay in sl.layovers_minutes:
            if lay > 240:
                s -= 8
                reasons.append("המתנה ארוכה בין טיסות")
            elif lay < 60:
                s -= 5
                reasons.append("זמן קונקשן קצר")
        dep_h = sl.departing_at.hour
        arr_h = sl.arriving_at.hour
        if dep_h < 6:
            s -= 8
            reasons.append("המראה בשעות הלילה")
        if arr_h < 5:
            s -= 5
            reasons.append("נחיתה באמצע הלילה")
    window = prefs.get("preferred_departure_window")
    if window in _WINDOWS and d.slices:
        lo, hi = _WINDOWS[window]
        h = d.slices[0].departing_at.hour
        h = h + 24 if window == "night" and h < 5 else h
        if lo <= h < hi:
            reasons.append(f"המראה בחלון המועדף ({_WINDOW_HE[window]})")
        else:
            s -= 10
            reasons.append(f"המראה מחוץ לחלון המועדף ({_WINDOW_HE[window]})")
    return _clamp(s), reasons


def _hotel_convenience(d: HotelDetails) -> tuple[Decimal, list[str]]:
    dist = d.distance_to_center_km
    if dist is None:
        return Decimal(50), ["המרחק ממרכז העיר אינו ידוע"]
    s = Decimal(100) if dist <= 1 else Decimal(100) - (Decimal(str(dist)) - 1) * 12
    return _clamp(max(Decimal(20), s)), [f"{dist} ק\"מ ממרכז העיר"]


def _car_convenience(d: CarDetails, prefs: Mapping[str, Any]) -> tuple[Decimal, list[str]]:
    s = Decimal(100)
    reasons: list[str] = []
    if d.transmission == "manual":
        s -= 15
        reasons.append("תיבת הילוכים ידנית")
    else:
        reasons.append("תיבת הילוכים אוטומטית")
    if "שאטל" in d.pickup_location:
        s -= 12
        reasons.append("איסוף בשאטל מחוץ לטרמינל")
    need = prefs.get("min_seats")
    if isinstance(need, int) and d.seats < need:
        s -= 40
        reasons.append("פחות מושבים מהנדרש")
    if d.mileage and d.mileage != "unlimited":
        s -= 10
        reasons.append("מגבלת קילומטרים יומית")
    if d.bags <= 1:
        s -= 5
        reasons.append("תא מטען קטן")
    return _clamp(s), reasons


def _activity_convenience(d: ActivityDetails) -> tuple[Decimal, list[str]]:
    reasons: list[str] = []
    if d.duration_minutes is None:
        s = Decimal(60)
        reasons.append("משך הפעילות אינו ידוע")
    elif d.duration_minutes <= 240:
        s = Decimal(100)
    elif d.duration_minutes <= 360:
        s = Decimal(85)
        reasons.append("פעילות ארוכה")
    else:
        s = Decimal(70)
        reasons.append("פעילות של יום שלם")
    hours = [int(t.split(":")[0]) for t in d.start_times if t[:2].isdigit()]
    if hours and min(hours) >= 20:
        s -= 15
        reasons.append("שעת התחלה מאוחרת לילדים")
    elif hours and max(hours) < 8:
        s -= 10
        reasons.append("שעת התחלה מוקדמת מאוד")
    if len(d.start_times) >= 2:
        s += 5
        reasons.append("כמה מועדי התחלה לבחירה")
    return _clamp(s), reasons


# ------------------------------------------------------------ flexibility ----


def _flexibility(offer: CanonicalOffer, now: datetime) -> tuple[Decimal, list[str]]:
    c = offer.cancellation
    if c.refundable is True:
        if c.free_cancellation_until is None or c.free_cancellation_until > now:
            if c.free_cancellation_until is not None:
                return Decimal(100), [f"ביטול חינם עד {c.free_cancellation_until:%d/%m/%Y}"]
            return Decimal(100), ["ניתן לבטל ולקבל החזר"]
        return Decimal(45), ["מועד הביטול החינמי כבר עבר"]
    if c.refundable is False:
        if c.changeable:
            fee = c.change_fee.amount if c.change_fee is not None else Decimal(0)
            if fee > 0:
                return Decimal(45), ["ללא החזר; שינוי אפשרי בתשלום"]
            return Decimal(60), ["ללא החזר; שינוי אפשרי"]
        return Decimal(10), ["ללא החזר וללא אפשרות שינוי"]
    return Decimal(30), ["מדיניות הביטול אינה ידועה"]


# ---------------------------------------------------------------- quality ----


def _flight_quality(d: FlightDetails, prefs: Mapping[str, Any]) -> tuple[Decimal, list[str]]:
    s = Decimal(50)
    reasons: list[str] = []
    b = d.baggage
    if b.checked_included:
        s += 20
        reasons.append("כולל מזוודה לבטן")
    elif b.checked_included == 0:
        reasons.append("ללא מזוודה לבטן")
    if b.carry_on_included:
        s += 10
        reasons.append("כולל טרולי")
    elif b.carry_on_included == 0:
        reasons.append("תיק אישי בלבד")
    if d.cabin in ("business", "first"):
        s += 15
        reasons.append("מחלקת עסקים/ראשונה")
    elif d.cabin == "premium_economy":
        s += 8
        reasons.append("פרימיום אקונומי")
    needed = prefs.get("checked_bags")
    if isinstance(needed, int) and needed > (b.checked_included or 0):
        s -= 15
        reasons.append("התעריף אינו כולל את מספר המזוודות שביקשתם")
    return _clamp(s), reasons


def _hotel_quality(d: HotelDetails, prefs: Mapping[str, Any]) -> tuple[Decimal, list[str]]:
    reasons: list[str] = []
    parts: list[tuple[Decimal, Decimal]] = []
    if d.guest_rating is not None:
        parts.append((Decimal(str(d.guest_rating)) * 10, Decimal("0.65")))
        reasons.append(f"דירוג אורחים {d.guest_rating}/10")
    if d.star_rating is not None:
        parts.append((Decimal(str(d.star_rating)) / 5 * HUNDRED, Decimal("0.35")))
        reasons.append(f"{d.star_rating:g} כוכבים")
    if not parts:
        s = Decimal(50)
        reasons.append("אין מידע על דירוג")
    else:
        weight = sum(w for _, w in parts)
        s = sum(v * w for v, w in parts) / weight
    if prefs.get("kosher_preference") and d.kosher_info:
        s += 5
        reasons.append("מידע מפורש על כשרות")
    return _clamp(s), reasons


def _car_quality(d: CarDetails) -> tuple[Decimal, list[str]]:
    s = Decimal(55) + Decimal(8) * min(len(d.insurance_included), 4)
    reasons = [f"{len(d.insurance_included)} כיסויי ביטוח כלולים"] if d.insurance_included else ["אין מידע על ביטוח"]
    if any("ללא השתתפות עצמית" in i for i in d.insurance_included):
        s += 10
        reasons.append("כיסוי ללא השתתפות עצמית")
    if d.mileage == "unlimited":
        s += 5
        reasons.append("קילומטראז' בלתי מוגבל")
    return _clamp(s), reasons


def _activity_quality(d: ActivityDetails) -> tuple[Decimal, list[str]]:
    reasons: list[str] = []
    if d.rating is None:
        s = Decimal(50)
        reasons.append("אין דירוג")
    else:
        s = Decimal(str(d.rating)) * 20
        reasons.append(f"דירוג {d.rating}/5")
    if d.review_count is not None and d.review_count < 30:
        s -= 10
        reasons.append("מעט ביקורות")
    if d.family_friendly:
        s += 5
        reasons.append("מתאים למשפחות")
    return _clamp(s), reasons


# ------------------------------------------------------------------ score ----


def _sort_key(o: CanonicalOffer) -> tuple:
    assert o.score is not None
    return (-o.score.total, o.price.total.amount, o.price.total.currency, o.source.provider_id,
            o.source.supplier_offer_id)


def score_offers(
    offers: list[CanonicalOffer],
    weights: Mapping[str, Any] | None,
    *,
    preferences: Mapping[str, Any] | None = None,
    now: datetime | None = None,
) -> list[CanonicalOffer]:
    """Return NEW offer objects with ``score`` set, sorted by rank (1 = best)."""
    w = normalize_weights(weights)
    prefs = preferences or {}
    now = now or utcnow()
    if not offers:
        return []

    cheapest: dict[tuple[str, str], Decimal] = {}
    currencies: dict[str, set[str]] = defaultdict(set)
    fastest: dict[str, int] = {}
    for o in offers:
        key = (o.category, o.price.total.currency)
        amount = o.price.total.amount
        cheapest[key] = min(cheapest.get(key, amount), amount)
        currencies[o.category].add(o.price.total.currency)
        if isinstance(o.details, FlightDetails):
            fastest[o.category] = min(fastest.get(o.category, o.details.total_duration_minutes),
                                      o.details.total_duration_minutes)
    mixed_categories = len(currencies) > 1

    scored: list[CanonicalOffer] = []
    for o in offers:
        d = o.details
        cost, cost_r = _cost(o, cheapest[(o.category, o.price.total.currency)])
        if isinstance(d, FlightDetails):
            conv, conv_r = _flight_convenience(d, fastest.get(o.category, 0), prefs)
            qual, qual_r = _flight_quality(d, prefs)
        elif isinstance(d, HotelDetails):
            conv, conv_r = _hotel_convenience(d)
            qual, qual_r = _hotel_quality(d, prefs)
        elif isinstance(d, CarDetails):
            conv, conv_r = _car_convenience(d, prefs)
            qual, qual_r = _car_quality(d)
        else:
            assert isinstance(d, ActivityDetails)
            conv, conv_r = _activity_convenience(d)
            qual, qual_r = _activity_quality(d)
        flex, flex_r = _flexibility(o, now)
        factors = {"cost": cost, "convenience": conv, "flexibility": flex, "quality": qual}
        total = (sum(Decimal(w[f]) * factors[f] for f in FACTORS) / HUNDRED).quantize(ONE_DP, rounding=ROUND_HALF_UP)
        comparable = True
        reasons = [*cost_r, *conv_r, *flex_r, *qual_r]
        if len(currencies[o.category]) > 1:
            comparable = False
            reasons.insert(0, "ההצעות במטבעות שונים — העלות הושוותה רק בתוך כל מטבע, ללא המרת מטבע")
        if mixed_categories:
            comparable = False
            reasons.insert(0, "הצעות מקטגוריות שונות אינן ניתנות להשוואה ישירה")
        score = ScoreBreakdown(
            total=total,
            cost=cost,
            convenience=conv,
            flexibility=flex,
            quality=qual,
            weights=dict(w),
            reasons=reasons,
            rank=None,
            comparable=comparable,
        )
        scored.append(o.model_copy(update={"score": score}))

    scored.sort(key=_sort_key)
    ranked: list[CanonicalOffer] = []
    for i, o in enumerate(scored, start=1):
        assert o.score is not None
        ranked.append(o.model_copy(update={"score": o.score.model_copy(update={"rank": i})}))
    return ranked


def preferences_from_params(params: Mapping[str, Any] | None) -> dict[str, Any]:
    """Extract scoring preferences from stored search params (soft criteria)."""
    if not params:
        return {}
    keys = ("preferred_departure_window", "checked_bags", "min_seats", "kosher_preference")
    return {k: params[k] for k in keys if k in params}
