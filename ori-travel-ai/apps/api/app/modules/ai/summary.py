"""Deterministic Hebrew summaries built ONLY from server data (no model).

Every number in these texts is formatted from the offers / params themselves.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.modules.ai.intent import CATEGORY_HE, HE_MONTH_NAMES, Slots, place_name
from app.modules.providers.data.geo import resolve_city
from app.schemas.common import Money
from app.schemas.offers import ActivityDetails, CanonicalOffer, CarDetails, FlightDetails, HotelDetails
from app.schemas.search import SearchResponse

FALLBACK_LABEL = "מצב בסיסי ללא מודל AI"
DEMO_WARNING = "התוצאות הן נתוני הדגמה (DEMO) — לא מחירים ולא זמינות אמיתיים."
BOOKING_NOTE = "הזמנה מתבצעת רק במסך ההזמנה הנפרד, באישור מבוגר/ת מורשה."
SYMBOLS = {"ILS": "₪", "USD": "$", "EUR": "€", "GBP": "£"}
WEEKDAYS_HE = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]
CAR_CLASS_HE = {"mini": "מיני", "economy": "חסכוני", "compact": "קומפקטי", "midsize": "משפחתי", "fullsize": "גדול",
                "suv": "SUV", "van": "ואן", "premium": "יוקרה"}


def fmt_amount(amount: Decimal, currency: str) -> str:
    s = f"{amount:,.2f}"
    if s.endswith(".00"):
        s = s[:-3]
    sym = SYMBOLS.get(currency)
    return f"{s} {sym}" if sym else f"{s} {currency}"


def fmt_money(m: Money) -> str:
    return fmt_amount(m.amount, m.currency)


def fmt_date(d: date | str) -> str:
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return d.strftime("%d.%m.%Y")


def weekday_he(d: date) -> str:
    return f"יום {WEEKDAYS_HE[d.weekday()]}" if d.weekday() != 5 else "שבת"


def fmt_duration(minutes: int) -> str:
    h, m = divmod(int(minutes), 60)
    return f"{h}:{m:02d} שעות"


def pax_text(adults: int, children_ages: list[int]) -> str:
    parts = ["מבוגר אחד" if adults == 1 else f"{adults} מבוגרים"]
    if children_ages:
        ages = ", ".join(str(a) for a in children_ages)
        parts.append(f"ילד אחד (גיל {ages})" if len(children_ages) == 1 else f"{len(children_ages)} ילדים (גילים {ages})")
    return " ו-".join(parts)


def _city_he(text: str) -> str:
    city = resolve_city(text)
    return city.name_he if city else text


def describe_params(params: dict[str, Any]) -> str:
    cat = params.get("category")
    if cat == "flight":
        s = f"מ{place_name(params['origin'])} ל{place_name(params['destination'])}, יציאה {fmt_date(params['depart_date'])}"
        if params.get("return_date"):
            s += f", חזרה {fmt_date(params['return_date'])}"
        return f"{s}, {pax_text(params.get('adults', 1), params.get('children_ages') or [])}"
    if cat == "hotel":
        rooms = params.get("rooms") or []
        adults = sum(r.get("adults", 0) for r in rooms)
        ages = [a for r in rooms for a in r.get("children_ages", [])]
        nights = (date.fromisoformat(params["check_out"]) - date.fromisoformat(params["check_in"])).days
        return (f"ב{_city_he(params['destination'])}, {fmt_date(params['check_in'])}–{fmt_date(params['check_out'])} "
                f"({nights} לילות), {pax_text(adults, ages)}")
    if cat == "car":
        return (f"איסוף ב{place_name(params['pickup_location'])} {fmt_date(params['pickup_at'])}, "
                f"החזרה {fmt_date(params['dropoff_at'])}")
    if cat == "activity":
        return (f"ב{_city_he(params['destination'])}, {fmt_date(params['date_from'])}–{fmt_date(params['date_to'])}, "
                f"{pax_text(params.get('adults', 2), params.get('children_ages') or [])}")
    return ""


def describe_slots(slots: Slots) -> str:
    parts: list[str] = []
    if slots.category:
        parts.append(CATEGORY_HE[slots.category])
    if slots.origin and slots.origin_explicit:
        parts.append(f"מ{place_name(slots.origin)}")
    if slots.destination:
        parts.append(f"ל{place_name(slots.destination)}" if slots.category == "flight" else f"ב{place_name(slots.destination)}")
    elif slots.country_hint:
        parts.append(f"ב{slots.country_hint}")
    if slots.start_date:
        span = fmt_date(slots.start_date) + (f"–{fmt_date(slots.end_date)}" if slots.end_date else "")
        parts.append(span)
    elif slots.month_hint:
        parts.append(f"ב{HE_MONTH_NAMES[slots.month_hint]}")
    if slots.nights and not slots.end_date:
        parts.append(f"{slots.nights} לילות")
    if slots.adults:
        parts.append("מבוגר אחד" if slots.adults == 1 else f"{slots.adults} מבוגרים")
    if slots.children_count:
        parts.append("ילד אחד" if slots.children_count == 1 else f"{slots.children_count} ילדים")
    if slots.family_size and not slots.adults:
        parts.append(f"משפחה של {slots.family_size}")
    if slots.budget is not None and slots.budget_currency:
        parts.append(f"תקציב עד {fmt_amount(slots.budget, slots.budget_currency)}")
    return ", ".join(parts)


def offer_label(o: CanonicalOffer) -> str:
    d = o.details
    if isinstance(d, FlightDetails):
        carrier = d.slices[0].segments[0].carrier_name if d.slices and d.slices[0].segments else o.title
        stops = "ישירה" if d.max_stops == 0 else ("עצירה אחת" if d.max_stops == 1 else f"{d.max_stops} עצירות")
        return f"{carrier} ({stops})"
    if isinstance(d, HotelDetails):
        stars = f" {d.star_rating:g}★" if d.star_rating else ""
        return f"{d.hotel_name}{stars}"
    if isinstance(d, CarDetails):
        gear = "אוטומט" if d.transmission == "automatic" else "ידני"
        return f"{d.model_example} · {d.vendor} ({CAR_CLASS_HE.get(d.car_class, d.car_class)}, {gear})"
    if isinstance(d, ActivityDetails):
        return d.name
    return o.title


def _comparable(offers: list[CanonicalOffer], currency: str | None) -> list[CanonicalOffer]:
    same = [o for o in offers if o.price.total.currency == currency]
    if same:
        return same
    first = offers[0].price.total.currency
    return [o for o in offers if o.price.total.currency == first]


def summarize_search(resp: SearchResponse, *, label: bool = True) -> str:
    """Deterministic Hebrew summary: cheapest, best score, and a category-specific third pick."""
    lines: list[str] = []
    if label:
        lines.append(f"{FALLBACK_LABEL} — הסיכום נבנה אוטומטית מנתוני השרת.")
    lines.append(f"חיפשתי {CATEGORY_HE.get(resp.category, resp.category)}: {describe_params(resp.params)}.")
    offers = resp.offers
    if not offers:
        lines.append("לא נמצאו הצעות מתאימות. אפשר לשנות תאריכים, יעד או סינון ולנסות שוב.")
        return "\n".join(lines)
    demo = " (נתוני הדגמה — לא מחירים אמיתיים)" if resp.has_demo_results and not resp.has_live_results else ""
    lines.append(f"נמצאו {len(offers)} הצעות{demo}.")
    pool = _comparable(offers, resp.params.get("currency"))
    cheapest = min(pool, key=lambda o: (o.price.total.amount, o.id))
    best = next((o for o in offers if o.score is not None and o.score.rank == 1), offers[0])
    if cheapest.id == best.id:
        score = f" (ציון {best.score.total:.0f})" if best.score else ""
        lines.append(f"• הזולה ביותר וגם המדורגת ראשונה: {offer_label(best)} — {fmt_money(best.price.total)}{score}")
    else:
        lines.append(f"• הזולה ביותר: {offer_label(cheapest)} — {fmt_money(cheapest.price.total)}")
        score = f" (ציון {best.score.total:.0f})" if best.score else ""
        lines.append(f"• המדורגת ראשונה לפי העדפות המשפחה: {offer_label(best)} — {fmt_money(best.price.total)}{score}")
    third = _third_pick(offers)
    if third:
        lines.append(third)
    lines.append(f"הפרטים המלאים בכרטיסים. {BOOKING_NOTE}")
    return "\n".join(lines)


def _third_pick(offers: list[CanonicalOffer]) -> str | None:
    d0 = offers[0].details
    if isinstance(d0, FlightDetails):
        o = min(offers, key=lambda x: (x.details.total_duration_minutes, x.price.total.amount))  # type: ignore[union-attr]
        return f"• הקצרה ביותר: {offer_label(o)} — {fmt_duration(o.details.total_duration_minutes)}, {fmt_money(o.price.total)}"  # type: ignore[union-attr]
    if isinstance(d0, HotelDetails):
        located = [x for x in offers if x.details.distance_to_center_km is not None]  # type: ignore[union-attr]
        if not located:
            return None
        o = min(located, key=lambda x: (x.details.distance_to_center_km, x.price.total.amount))  # type: ignore[union-attr]
        return (f"• הקרובה ביותר למרכז: {offer_label(o)} — {o.details.distance_to_center_km:g} ק״מ מהמרכז, "  # type: ignore[union-attr]
                f"{fmt_money(o.price.total)}")
    if isinstance(d0, CarDetails):
        autos = [x for x in offers if x.details.transmission == "automatic"]  # type: ignore[union-attr]
        if not autos:
            return None
        o = min(autos, key=lambda x: (x.price.total.amount, x.id))
        return f"• האוטומטי הזול ביותר: {offer_label(o)} — {fmt_money(o.price.total)}"
    if isinstance(d0, ActivityDetails):
        rated = [x for x in offers if x.details.rating is not None]  # type: ignore[union-attr]
        if not rated:
            return None
        o = max(rated, key=lambda x: (x.details.rating, -x.price.total.amount))  # type: ignore[union-attr]
        return f"• בעלת הדירוג הגבוה ביותר: {offer_label(o)} — {o.details.rating:g}/5, {fmt_money(o.price.total)}"  # type: ignore[union-attr]
    return None
