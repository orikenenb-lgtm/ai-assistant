"""ICS (RFC 5545) and PDF exports."""

from __future__ import annotations

import re
from datetime import date, datetime

import pytest

from app.modules.itineraries.ics import escape_text, fold_line
from app.modules.itineraries.pdf import FOOTER_DEMO, pdf_blocks
from tests.test_budget import add
from tests.test_trips import first_offer, make_trip


def unfold(raw: bytes) -> list[str]:
    text = raw.decode("utf-8")
    assert "\r\n" in text and "\n" not in text.replace("\r\n", ""), "must use CRLF only"
    assert text.endswith("\r\n")
    return text[:-2].replace("\r\n ", "").split("\r\n")


def test_escape_and_fold_unit():
    assert escape_text("a,b;c\\d\ne") == "a\\,b\\;c\\\\d\\ne"
    assert escape_text("x\r\ny") == "x\\ny"
    assert escape_text(None) == ""
    line = "SUMMARY:" + "שלום עולם, " * 20
    parts = fold_line(line)
    assert len(parts) > 1
    assert all(len(p.encode("utf-8")) <= 75 for p in parts)
    assert all(p.startswith(" ") for p in parts[1:])
    assert "".join([parts[0]] + [p[1:] for p in parts[1:]]) == line
    # never splits inside a multi-byte character
    for p in parts:
        p.encode("utf-8").decode("utf-8")


def test_ics_structure(auth_client):
    c = auth_client("adult")
    t = make_trip(c, title="רומא; חורף, 2026", destination="רומא, איטליה")
    add(c, t["id"], "activity", "ארוחה, קפה; ועוד\\ שורה" + " ארוכה מאוד" * 12, ("12", "ILS"), "known",
        start_at="2026-12-01T10:00:00Z", end_at="2026-12-01T11:30:00Z", location="רחוב א', רומא",
        notes="שורה ראשונה\nשורה שנייה")
    add(c, t["id"], "note", "בלי זמן")
    hotel = first_offer(c, "hotel")
    c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": hotel["id"]})

    res = c.get(f"/api/trips/{t['id']}/export.ics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    assert res.headers["content-disposition"] == f'attachment; filename="trip-{t["id"]}.ics"'
    raw = res.content
    for physical in raw.decode("utf-8").split("\r\n"):
        assert len(physical.encode("utf-8")) <= 75
    lines = unfold(raw)
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-1] == "END:VCALENDAR"
    assert "VERSION:2.0" in lines and any(ln.startswith("PRODID:") for ln in lines)
    assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 3  # trip span + 2 timed items
    # all-day trip span (DTEND exclusive)
    assert any(re.fullmatch(r"DTSTART;VALUE=DATE:\d{8}", ln) for ln in lines)
    assert any(re.fullmatch(r"DTEND;VALUE=DATE:\d{8}", ln) for ln in lines)
    uids = [ln for ln in lines if ln.startswith("UID:")]
    assert len(set(uids)) == 3 and all(u.endswith("@ori-travel-ai") for u in uids)
    assert any(u.startswith(f"UID:trip-{t['id']}") for u in uids)
    assert all(re.fullmatch(r"DTSTAMP:\d{8}T\d{6}Z", ln) for ln in lines if ln.startswith("DTSTAMP"))
    starts = [ln for ln in lines if ln.startswith("DTSTART:")]
    assert len(starts) == 2 and all(re.fullmatch(r"DTSTART:\d{8}T\d{6}Z", s) for s in starts)
    assert "DTSTART:20261201T100000Z" in lines and "DTEND:20261201T113000Z" in lines
    # escaping in TEXT values
    summary = next(ln for ln in lines if ln.startswith("SUMMARY:ארוחה"))
    assert "\\," in summary and r"\;" in summary and "\\\\" in summary
    assert "SUMMARY:רומא\\; חורף\\, 2026" in lines
    assert "LOCATION:רחוב א'\\, רומא" in lines
    desc = [ln for ln in lines if ln.startswith("DESCRIPTION:") and "שורה ראשונה" in ln][0]
    assert "\\n" in desc and "ILS" in desc
    # hotel from a DEMO offer carries source mode + freshness
    hotel_desc = next(ln for ln in lines if ln.startswith("DESCRIPTION:") and "DEMO" in ln)
    assert "נכון ל" in hotel_desc
    assert not any(ln.startswith("SUMMARY:בלי זמן") for ln in lines)
    # parse timestamps for sanity
    datetime.strptime(starts[0].split(":")[1], "%Y%m%dT%H%M%SZ")


def test_ics_trip_without_dates_has_only_timed_items(auth_client):
    c = auth_client("adult")
    t = make_trip(c, start_date=None, end_date=None)
    lines = unfold(c.get(f"/api/trips/{t['id']}/export.ics").content)
    assert lines.count("BEGIN:VEVENT") == 0 and "END:VCALENDAR" in lines


def test_exports_readable_by_viewer_and_404(auth_client):
    adult, viewer = auth_client("adult"), auth_client("viewer")
    t = make_trip(adult)
    assert viewer.get(f"/api/trips/{t['id']}/export.ics").status_code == 200
    assert viewer.get(f"/api/trips/{t['id']}/export.pdf").status_code == 200
    assert viewer.get("/api/trips/nope/export.pdf").status_code == 404
    assert viewer.get("/api/trips/nope/export.ics").status_code == 404


def test_pdf_generated_with_hebrew_title(auth_client):
    c = auth_client("adult")
    t = make_trip(c, title="טיול משפחתי לרומא <b>&amp;</b>", notes="הערה\x00 עם תו בקרה")
    hotel = first_offer(c, "hotel")
    c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": hotel["id"]})
    add(c, t["id"], "note", "הערה חופשית ארוכה " * 15)
    add(c, t["id"], "other", "הערכה", ("50", "EUR"), "estimate")
    add(c, t["id"], "other", "לא נכלל", ("20", "ILS"), "excluded")
    res = c.get(f"/api/trips/{t['id']}/export.pdf")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"] == f'attachment; filename="trip-{t["id"]}.pdf"'
    data = res.content
    assert data.startswith(b"%PDF") and b"%%EOF" in data[-1024:] and len(data) > 5000
    assert b"DejaVuSans" in data  # bundled Hebrew-capable font is embedded

    # logical content (before bidi reordering)
    detail = c.get(f"/api/trips/{t['id']}").json()
    budget = c.get(f"/api/trips/{t['id']}/budget").json()
    from app.modules.itineraries.schemas import BudgetOut, TripDetail

    blocks = pdf_blocks(TripDetail.model_validate(detail), BudgetOut.model_validate(budget))
    texts = [b.text for b in blocks]
    assert texts[0].startswith("טיול משפחתי לרומא")
    joined = "\n".join(texts)
    for needle in ("לוח זמנים יומי", "סיכום תקציב", "ידוע", "הערכה", "לא נכלל", "DEMO", "מלון:", "ללא תאריך"):
        assert needle in joined
    assert "יתרה: לא ניתן לחשב" in joined  # mixed currencies in the budget summary

    try:
        from pdfminer.high_level import extract_text  # optional dev dependency
    except ImportError:
        return
    import io

    text = extract_text(io.BytesIO(data))
    assert "Ori Travel AI" in text and any("֐" <= ch <= "׿" for ch in text)


def test_pdf_footer_only_claims_demo_when_applicable(auth_client):
    from app.modules.itineraries.pdf import FOOTER_PLAIN, footer_text
    from app.modules.itineraries.schemas import TripDetail

    c = auth_client("adult")
    t = make_trip(c)
    plain = TripDetail.model_validate(c.get(f"/api/trips/{t['id']}").json())
    assert footer_text(plain) == FOOTER_PLAIN
    hotel = first_offer(c, "hotel")
    c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": hotel["id"]})
    demo = TripDetail.model_validate(c.get(f"/api/trips/{t['id']}").json())
    assert footer_text(demo) == FOOTER_DEMO == "הופק ע״י Ori Travel AI — נתוני DEMO אינם מחירים אמיתיים"


def test_pdf_many_items_paginates(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    for i in range(80):
        # This test is about PDF pagination, not scheduling: the 80 activities intentionally
        # share start times, so the user-confirmed overlap flag is set (V6 overlap rule).
        add(c, t["id"], "activity", f"פעילות מספר {i}", ("10", "ILS"), "known",
            start_at=f"2026-12-{1 + i % 20:02d}T09:00:00Z", allow_overlap=True)
    data = c.get(f"/api/trips/{t['id']}/export.pdf").content
    assert data.startswith(b"%PDF")
    assert data.count(b"/Type /Page\n") + data.count(b"/Type /Page ") >= 3 or data.count(b"/Type /Page") >= 3


def test_dates_used_in_tests_are_future():
    assert date.today().year >= 2026
    with pytest.raises(UnicodeError):
        b"\xff".decode("utf-8")
