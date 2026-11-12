"""Hebrew (RTL) PDF export of a trip using reportlab + python-bidi and the bundled DejaVu Sans font.

Layout is done by hand on the canvas: text is wrapped in *logical* order, then each line is
reordered for display with ``bidi.algorithm.get_display`` and drawn right-aligned.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from threading import Lock

from bidi.algorithm import get_display
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from app.modules.itineraries.schemas import BudgetOut, TripDetail, TripItemOut
from app.modules.itineraries.service import zone_of

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"
FONT = "OriDejaVuSans"
FONT_BOLD = "OriDejaVuSans-Bold"

KIND_LABEL = {
    "flight": "טיסה",
    "hotel": "מלון",
    "car": "רכב",
    "activity": "פעילות",
    "transfer": "הסעה",
    "note": "הערה",
    "other": "אחר",
}
COST_LABEL = {"known": "ידוע", "estimate": "הערכה", "excluded": "לא נכלל"}
STATUS_LABEL = {"planning": "בתכנון", "booked": "הוזמן", "completed": "הסתיים", "cancelled": "בוטל"}
WEEKDAY = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]

FOOTER_DEMO = "הופק ע״י Ori Travel AI — נתוני DEMO אינם מחירים אמיתיים"
FOOTER_PLAIN = "הופק ע״י Ori Travel AI"

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f‎‏‪-‮⁦-⁩]")
_fonts_lock = Lock()
_fonts_ready = False


@dataclass
class Block:
    style: str  # title | subtitle | h1 | h2 | text | item | sub | small | gap
    text: str = ""


STYLES = {
    # style: (font, size, indent, leading, space_before)
    "title": (FONT_BOLD, 20, 0, 26, 0),
    "subtitle": (FONT, 12, 0, 17, 0),
    "h1": (FONT_BOLD, 15, 0, 20, 14),
    "h2": (FONT_BOLD, 12, 0, 17, 8),
    "text": (FONT, 10.5, 0, 15, 0),
    "item": (FONT_BOLD, 10.5, 8, 15, 4),
    "sub": (FONT, 9.5, 22, 13, 0),
    "small": (FONT, 8.5, 0, 12, 0),
    "gap": (FONT, 8, 0, 8, 0),
}


def ensure_fonts() -> None:
    global _fonts_ready
    with _fonts_lock:
        if _fonts_ready:
            return
        pdfmetrics.registerFont(TTFont(FONT, str(FONT_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont(FONT_BOLD, str(FONT_DIR / "DejaVuSans-Bold.ttf")))
        _fonts_ready = True


def clean_text(text: str | None, limit: int = 1500) -> str:
    """Strip control/bidi-override characters (text is drawn verbatim, never interpreted as markup)."""
    if not text:
        return ""
    t = _CTRL.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))
    return t[:limit]


def _fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _fmt_money(m) -> str:
    return f"{m.amount} {m.currency}"


def _item_time(item: TripItemOut, trip: TripDetail) -> str:
    if item.start_at is None:
        return ""
    z = zone_of(item.timezone, trip.timezone)
    s = item.start_at.astimezone(z)
    out = s.strftime("%H:%M")
    if item.end_at is not None:
        e = item.end_at.astimezone(z)
        out += f"–{e.strftime('%H:%M')}"
        if e.date() != s.date():
            out += f" ({e.strftime('%d/%m')})"
    return out


def _item_blocks(item: TripItemOut, trip: TripDetail) -> list[Block]:
    head = f"{KIND_LABEL.get(item.kind, item.kind)}: {item.title}"
    t = _item_time(item, trip)
    if t:
        head = f"{t}  {head}"
    blocks = [Block("item", head)]
    if item.location:
        blocks.append(Block("sub", f"מיקום: {item.location}"))
    if item.cost is not None:
        blocks.append(Block("sub", f"עלות: {_fmt_money(item.cost)} ({COST_LABEL.get(item.cost_status, item.cost_status)})"))
    else:
        blocks.append(Block("sub", f"עלות: {COST_LABEL.get(item.cost_status, item.cost_status)} (ללא סכום)"))
    if item.data_mode == "DEMO":
        blocks.append(Block("sub", "DEMO — נתוני הדגמה, לא מחיר אמיתי"))
    elif item.data_mode:
        blocks.append(Block("sub", f"מקור הנתונים: {item.data_mode}"))
    if item.offer_expired:
        blocks.append(Block("sub", "תוקף ההצעה פג — יש לאמת מחיר מחדש"))
    if item.notes:
        blocks.append(Block("sub", f"הערות: {item.notes}"))
    return blocks


def pdf_blocks(trip: TripDetail, budget: BudgetOut) -> list[Block]:
    """Logical content of the PDF (before bidi reordering) — also used by tests."""
    b: list[Block] = [Block("title", trip.title)]
    sub = []
    if trip.destination:
        sub.append(trip.destination)
    if trip.start_date and trip.end_date:
        sub.append(f"{_fmt_date(trip.start_date)} – {_fmt_date(trip.end_date)}")
    elif trip.start_date:
        sub.append(f"החל מ-{_fmt_date(trip.start_date)}")
    if sub:
        b.append(Block("subtitle", " · ".join(sub)))
    b.append(Block("text", f"סטטוס: {STATUS_LABEL.get(trip.status, trip.status)}"))
    if trip.timezone:
        b.append(Block("text", f"אזור זמן: {trip.timezone}"))
    if trip.travelers:
        b.append(Block("text", "נוסעים: " + ", ".join(t.display_name for t in trip.travelers)))
    if trip.notes:
        b.append(Block("text", f"הערות: {trip.notes}"))

    by_id = {i.id: i for i in trip.items}
    b.append(Block("h1", "לוח זמנים יומי"))
    if not trip.items:
        b.append(Block("text", "עדיין לא נוספו פריטים לטיול."))
    for day in trip.days:
        b.append(Block("h2", f"יום {WEEKDAY[day.date.weekday()]}, {_fmt_date(day.date)}"))
        for iid in day.item_ids:
            b.extend(_item_blocks(by_id[iid], trip))
    if trip.unscheduled_item_ids:
        b.append(Block("h2", "ללא תאריך"))
        for iid in trip.unscheduled_item_ids:
            b.extend(_item_blocks(by_id[iid], trip))

    b.append(Block("h1", "סיכום תקציב"))
    if budget.budget is not None:
        b.append(Block("text", f"תקציב מוגדר: {_fmt_money(budget.budget)}"))
    else:
        b.append(Block("text", "לא הוגדר תקציב לטיול."))
    if not budget.totals:
        b.append(Block("text", "אין עלויות רשומות."))
    for row in budget.totals:
        b.append(
            Block(
                "text",
                f"{row.currency} — ידוע: {row.known} · הערכה: {row.estimated} · לא נכלל: {row.excluded}",
            )
        )
    if budget.remaining is not None:
        b.append(Block("text", f"יתרה: {_fmt_money(budget.remaining)}"))
    elif budget.remaining_reason == "mixed_currencies":
        b.append(Block("text", "יתרה: לא ניתן לחשב — עלויות במטבעות שונים (אין המרה אוטומטית)."))
    for w in budget.warnings:
        b.append(Block("small", f"• {w.message}"))
    return b


def footer_text(trip: TripDetail) -> str:
    return FOOTER_DEMO if trip.has_demo_data else FOOTER_PLAIN


def _wrap(text: str, font: str, size: float, max_width: float) -> list[str]:
    """Wrap logical text into lines no wider than max_width (measured on the display form)."""

    def width(s: str) -> float:
        return stringWidth(get_display(s, base_dir="R"), font, size)

    lines: list[str] = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            lines.append("")
            continue
        cur = ""
        for w in words:
            cand = f"{cur} {w}" if cur else w
            if width(cand) <= max_width:
                cur = cand
                continue
            if cur:
                lines.append(cur)
                cur = ""
            while width(w) > max_width and len(w) > 1:  # very long token: hard split
                cut = len(w)
                while cut > 1 and width(w[:cut]) > max_width:
                    cut -= 1
                lines.append(w[:cut])
                w = w[cut:]
            cur = w
        lines.append(cur)
    return lines


def render_pdf(blocks: list[Block], footer: str) -> bytes:
    ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, pageCompression=1)
    c.setTitle("Ori Travel AI - trip itinerary")
    c.setAuthor("Ori Travel AI")
    width, height = A4
    margin = 42
    right = width - margin
    top = height - margin
    bottom = margin + 28
    state = {"y": top, "page": 1}

    def draw_footer() -> None:
        c.setFont(FONT, 8)
        c.setFillGray(0.35)
        c.drawRightString(right, margin - 8, get_display(footer, base_dir="R"))
        c.drawString(margin, margin - 8, str(state["page"]))
        c.setFillGray(0)

    def new_page() -> None:
        draw_footer()
        c.showPage()
        state["page"] += 1
        state["y"] = top

    for blk in blocks:
        font, size, indent, leading, before = STYLES[blk.style]
        text = clean_text(blk.text)
        avail = right - margin - indent
        lines = _wrap(text, font, size, avail) if text else [""]
        needed = before + leading * (3 if blk.style in ("h1", "h2", "item") else 1)
        if state["y"] - needed < bottom:
            new_page()
        elif before:
            state["y"] -= before
        for line in lines:
            if state["y"] - leading < bottom:
                new_page()
            state["y"] -= leading
            if line:
                c.setFont(font, size)
                if blk.style == "small":
                    c.setFillGray(0.3)
                c.drawRightString(right - indent, state["y"] + leading * 0.22, get_display(line, base_dir="R"))
                c.setFillGray(0)
        if blk.style in ("h1", "title"):
            c.setStrokeGray(0.6)
            c.line(margin, state["y"] - 4, right, state["y"] - 4)
            state["y"] -= 4
    draw_footer()
    c.showPage()
    c.save()
    return buf.getvalue()


def build_trip_pdf(trip: TripDetail, budget: BudgetOut) -> bytes:
    return render_pdf(pdf_blocks(trip, budget), footer_text(trip))
