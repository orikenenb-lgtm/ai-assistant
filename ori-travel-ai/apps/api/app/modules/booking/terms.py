"""Terms hash + Hebrew terms summary.

An approval is bound to ``terms_hash``: SHA-256 over a canonical JSON document
describing exactly what will be booked — the structured product fields AND the
exact summary lines shown to the approver. Volatile fields that are never
displayed (fetch time, quote expiry, ranking score) are excluded so that a
re-quote with identical terms keeps the same hash, while any change to what the
approver read changes it.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from app.core.money import CURRENCY_SYMBOLS, from_minor

TERMS_VERSION = 2

BOARD_LABELS_HE = {
    "room_only": "לינה בלבד",
    "breakfast": "לינה וארוחת בוקר",
    "half_board": "חצי פנסיון",
    "full_board": "פנסיון מלא",
    "all_inclusive": "הכול כלול",
}
AGE_GROUP_LABELS_HE = {"adult": "מבוגר/ת", "child": "ילד/ה", "infant": "תינוק/ת"}


def _pick(d: dict[str, Any] | None, *keys: str) -> dict[str, Any]:
    d = d or {}
    return {k: d.get(k) for k in keys}


def _product(details: dict[str, Any]) -> dict[str, Any]:
    kind = details.get("kind")
    if kind == "flight":
        return {
            "kind": "flight",
            "cabin": details.get("cabin"),
            "fare_brand": details.get("fare_brand"),
            "baggage": _pick(details.get("baggage"), "personal_item", "carry_on_included", "checked_included",
                             "checked_bag_weight_kg"),
            "passengers": details.get("passengers"),
            "validating_carrier": details.get("validating_carrier"),
            "slices": [
                {
                    **_pick(s, "origin", "destination", "departing_at", "arriving_at"),
                    "segments": [
                        _pick(seg, "carrier_code", "flight_number", "origin", "destination", "departing_at",
                              "arriving_at", "cabin")
                        for seg in s.get("segments", [])
                    ],
                }
                for s in details.get("slices", [])
            ],
        }
    if kind == "hotel":
        return {"kind": "hotel", **_pick(details, "hotel_id", "hotel_name", "room_name", "board", "check_in",
                                         "check_out", "nights", "rooms", "adults", "children")}
    if kind == "car":
        return {"kind": "car", **_pick(details, "vendor", "car_class", "transmission", "pickup_location",
                                       "dropoff_location", "pickup_at", "dropoff_at", "rental_days", "mileage",
                                       "insurance_included")}
    if kind == "activity":
        return {"kind": "activity", **_pick(details, "activity_id", "name", "city", "available_dates", "start_times",
                                            "participants")}
    # Unknown product kind: bind to everything rather than to nothing.
    return {"kind": kind, "raw": details}


def _traveler_key(t: dict[str, Any]) -> str:
    return str(t.get("family_member_id"))


def canonical_terms(snapshot: dict[str, Any], travelers: list[dict[str, Any]], amount_minor: int, currency: str,
                    execution_mode: str) -> dict[str, Any]:
    """Everything an approval is bound to.

    Besides the structured product fields this includes the EXACT lines of
    ``build_terms_summary`` — whatever the approver reads is hashed, so a
    re-quote that alters any displayed line (title, exclusions, estimated
    price flag, stops, supplier name, ...) can never pass as "unchanged".
    Travelers are ordered by id so the hash does not depend on input order.
    """
    source = snapshot.get("source") or {}
    price = snapshot.get("price") or {}
    ordered = sorted(travelers, key=_traveler_key)
    return {
        "v": TERMS_VERSION,
        "provider_id": source.get("provider_id"),
        "provider_name": source.get("provider_name"),
        "supplier_offer_id": source.get("supplier_offer_id"),
        "category": snapshot.get("category"),
        "title": snapshot.get("title"),
        "execution_mode": execution_mode,
        "product": _product(snapshot.get("details") or {}),
        "price": {
            "total_minor": int(amount_minor),
            "currency": currency,
            "total_status": price.get("total_status"),
            "excluded_notes": list(price.get("excluded_notes") or []),
        },
        "cancellation": snapshot.get("cancellation") or {},
        "travelers": [_traveler_key(t) for t in ordered],
        "summary": build_terms_summary(snapshot, ordered, amount_minor, currency, execution_mode),
    }


def compute_terms_hash(snapshot: dict[str, Any], travelers: list[dict[str, Any]], amount_minor: int, currency: str,
                       execution_mode: str) -> str:
    doc = canonical_terms(snapshot, travelers, amount_minor, currency, execution_mode)
    payload = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ------------------------------------------------------------ Hebrew summary ----


def format_money(amount_minor: int, currency: str) -> str:
    amount = from_minor(amount_minor, currency)
    symbol = CURRENCY_SYMBOLS.get(currency)
    text = f"{amount:,} {currency}"
    return f"{text} ({symbol})" if symbol else text


def _dt(value: Any) -> str:
    """Render an ISO datetime as local wall-clock time (as given by the supplier)."""
    if not value:
        return "לא ידוע"
    try:
        return datetime.fromisoformat(str(value)).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return str(value)


def _d(value: Any) -> str:
    if not value:
        return "לא ידוע"
    try:
        return datetime.fromisoformat(str(value)).strftime("%d/%m/%Y")
    except ValueError:
        return str(value)


def _what_when(details: dict[str, Any]) -> list[str]:
    kind = details.get("kind")
    lines: list[str] = []
    if kind == "flight":
        for i, s in enumerate(details.get("slices", []), start=1):
            flights = ", ".join(f"{seg.get('carrier_code', '')}{seg.get('flight_number', '')}" for seg in s.get("segments", []))
            stops = int(s.get("stops") or 0)
            stops_text = "ישירה" if stops == 0 else f"{stops} עצירות"
            lines.append(
                f"טיסה {i}: {s.get('origin')} ← {s.get('destination')}, המראה {_dt(s.get('departing_at'))}, "
                f"נחיתה {_dt(s.get('arriving_at'))} ({stops_text}; {flights})"
            )
        brand = details.get("fare_brand")
        lines.append(f"מחלקה: {details.get('cabin')}" + (f", תעריף: {brand}" if brand else ""))
        bag = details.get("baggage") or {}
        carry, checked = bag.get("carry_on_included"), bag.get("checked_included")
        lines.append(
            "כבודה: "
            + ("טרולי — לא ידוע" if carry is None else f"טרולי — {carry}")
            + ", "
            + ("מזוודה לבטן המטוס — לא ידוע" if checked is None else f"מזוודה לבטן המטוס — {checked}")
        )
    elif kind == "hotel":
        lines.append(f"מלון: {details.get('hotel_name')} ({details.get('city')})")
        lines.append(f"חדר: {details.get('room_name')} — {BOARD_LABELS_HE.get(details.get('board'), details.get('board'))}")
        lines.append(
            f"כניסה {_d(details.get('check_in'))}, יציאה {_d(details.get('check_out'))} "
            f"({details.get('nights')} לילות, {details.get('rooms')} חדרים, "
            f"{details.get('adults')} מבוגרים, {details.get('children')} ילדים)"
        )
    elif kind == "car":
        lines.append(f"רכב: {details.get('vendor')} — {details.get('car_class')} ({details.get('model_example')} או דומה)")
        lines.append(f"איסוף: {details.get('pickup_location')}, {_dt(details.get('pickup_at'))}")
        lines.append(f"החזרה: {details.get('dropoff_location')}, {_dt(details.get('dropoff_at'))}")
    elif kind == "activity":
        lines.append(f"פעילות: {details.get('name')} ({details.get('city')})")
        dates = details.get("available_dates") or []
        if dates:
            lines.append("תאריך: " + ", ".join(_d(x) for x in dates[:5]))
    return lines


def _refundability(cancellation: dict[str, Any]) -> str:
    refundable = cancellation.get("refundable")
    if refundable is True:
        until = cancellation.get("free_cancellation_until")
        text = "ביטול: ניתן להחזר" + (f" — ביטול חינם עד {_dt(until)}" if until else "")
    elif refundable is False:
        text = "ביטול: ללא החזר כספי"
    else:
        text = "ביטול: תנאי הביטול אינם ידועים — יש לבדוק מול הספק"
    policy = cancellation.get("policy_text")
    return f"{text}. {policy}" if policy else text


def build_terms_summary(
    snapshot: dict[str, Any],
    travelers: list[dict[str, Any]],
    amount_minor: int,
    currency: str,
    execution_mode: str,
) -> list[str]:
    """The exact lines a human reads before approving (Hebrew)."""
    source = snapshot.get("source") or {}
    price = snapshot.get("price") or {}
    lines = [f"מה מזמינים: {snapshot.get('title')}"]
    lines += _what_when(snapshot.get("details") or {})
    names = ", ".join(
        f"{t.get('display_name')} ({AGE_GROUP_LABELS_HE.get(t.get('age_group'), t.get('age_group'))})" for t in travelers
    )
    lines.append(f"נוסעים ({len(travelers)}): {names}")
    total_line = f"מחיר כולל: {format_money(amount_minor, currency)}"
    if price.get("total_status") == "estimated":
        total_line += " — הערכה בלבד של הספק"
    lines.append(total_line)
    for note in price.get("excluded_notes") or []:
        lines.append(f"לא כלול במחיר: {note}")
    lines.append(_refundability(snapshot.get("cancellation") or {}))
    lines.append(f"ספק: {source.get('provider_name')} (מזהה הצעה: {source.get('supplier_offer_id')})")
    if execution_mode == "SIMULATION":
        lines.append("סימולציה בלבד: נתוני הדגמה. לא תתבצע הזמנה אמיתית, לא יבוצע חיוב ולא יישלחו פרטים לספק.")
    elif execution_mode == "HOSTED_CHECKOUT":
        lines.append(
            "ההזמנה והתשלום מתבצעים באתר הספק בלבד. המערכת אינה מזמינה ואינה מחייבת — "
            "המחיר והתנאים הסופיים הם אלה שיוצגו באתר הספק."
        )
    else:
        lines.append("ביצוע הזמנה אמיתית דרך המערכת כבוי.")
    return lines
