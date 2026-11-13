"""RFC 5545 iCalendar export for a trip."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from app.core.db import utcnow
from app.core.money import from_minor
from app.models.trips import Trip, TripItem
from app.modules.itineraries.service import snapshot_expired

PRODID = "-//Ori Travel AI//Family Trips 1.0//HE"
UID_SUFFIX = "@ori-travel-ai"
CRLF = "\r\n"
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

COST_LABEL = {"known": "ידוע", "estimate": "הערכה", "excluded": "לא נכלל"}


def escape_text(value: str | None) -> str:
    """RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines."""
    if not value:
        return ""
    v = _CTRL.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))
    return v.replace("\\", "\\\\").replace(";", r"\;").replace(",", "\\,").replace("\n", "\\n")


def fold_line(line: str) -> list[str]:
    """Fold at 75 octets (UTF-8); continuation lines begin with one space."""
    out: list[str] = []
    cur = ""
    cur_bytes = 0
    limit = 75
    for ch in line:
        n = len(ch.encode("utf-8"))
        if cur_bytes + n > limit:
            out.append(cur)
            cur, cur_bytes, limit = " ", 1, 75
        cur += ch
        cur_bytes += n
    out.append(cur)
    return out


def _utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _description(item: TripItem) -> str:
    lines: list[str] = []
    if item.notes:
        lines.append(item.notes)
    if item.cost_amount_minor is not None and item.cost_currency:
        amount = from_minor(item.cost_amount_minor, item.cost_currency)
        lines.append(f"עלות: {amount} {item.cost_currency} ({COST_LABEL.get(item.cost_status, item.cost_status)})")
    else:
        lines.append(f"עלות: {COST_LABEL.get(item.cost_status, item.cost_status)} — ללא סכום")
    snap = item.offer_snapshot
    if snap:
        source = snap.get("source") or {}
        mode = source.get("mode")
        if mode == "DEMO":
            lines.append("מקור: DEMO — נתוני הדגמה, לא מחיר אמיתי")
        elif mode:
            lines.append(f"מקור: {mode}")
        if source.get("fetched_at"):
            lines.append(f"נכון ל: {source['fetched_at']}")
        if snapshot_expired(snap):
            lines.append("שימו לב: תוקף ההצעה פג — יש לאמת מחיר וזמינות מחדש")
    return "\n".join(lines)


def build_ics(trip: Trip, now: datetime | None = None) -> bytes:
    stamp = _utc(now or utcnow())
    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(trip.title)}",
    ]
    if trip.start_date:
        end = trip.end_date or trip.start_date
        lines += [
            "BEGIN:VEVENT",
            f"UID:trip-{trip.id}{UID_SUFFIX}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{trip.start_date.strftime('%Y%m%d')}",
            # DTEND of an all-day event is exclusive
            f"DTEND;VALUE=DATE:{(end + timedelta(days=1)).strftime('%Y%m%d')}",
            f"SUMMARY:{escape_text(trip.title)}",
        ]
        if trip.destination:
            lines.append(f"LOCATION:{escape_text(trip.destination)}")
        if trip.notes:
            lines.append(f"DESCRIPTION:{escape_text(trip.notes)}")
        lines.append("TRANSP:TRANSPARENT")
        lines.append("END:VEVENT")
    for item in sorted(trip.items, key=lambda i: (i.start_at or datetime.max.replace(tzinfo=UTC), i.sort_order)):
        if item.start_at is None:
            continue
        lines += [
            "BEGIN:VEVENT",
            f"UID:item-{item.id}{UID_SUFFIX}",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{_utc(item.start_at)}",
        ]
        if item.end_at is not None:
            lines.append(f"DTEND:{_utc(item.end_at)}")
        lines.append(f"SUMMARY:{escape_text(item.title)}")
        if item.location:
            lines.append(f"LOCATION:{escape_text(item.location)}")
        if item.latitude is not None and item.longitude is not None:
            lines.append(f"GEO:{item.latitude:.6f};{item.longitude:.6f}")
        lines.append(f"DESCRIPTION:{escape_text(_description(item))}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    folded: list[str] = []
    for line in lines:
        folded.extend(fold_line(line))
    return (CRLF.join(folded) + CRLF).encode("utf-8")
