"""Grounding: money extraction (Hebrew/English formats), verification against tool results, booking-claim stripping."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.ai.grounding import REMOVED_PRICE, extract_money, ground_text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("המחיר 1,200 ₪ ל-2 מבוגרים", [("1200", "ILS")]),
        ("עד 3000 ש״ח", [("3000", "ILS")]),
        ('עד 3,000 ש"ח', [("3000", "ILS")]),
        ("עולה 99 שקלים", [("99", "ILS")]),
        ("1,234.50 ILS", [("1234.50", "ILS")]),
        ("₪1,234", [("1234", "ILS")]),
        ("$1,500 for 2 adults", [("1500", "USD")]),
        ("1500$", [("1500", "USD")]),
        ("USD 1,500", [("1500", "USD")]),
        ("1,500 דולר", [("1500", "USD")]),
        ("€800", [("800", "EUR")]),
        ("800 יורו", [("800", "EUR")]),
        ("£500", [("500", "GBP")]),
        ('500 ליש"ט', [("500", "GBP")]),
        ("CZK 2,000", [("2000", "CZK")]),
        ("בין 1,000 ל-1,500 ₪", [("1000", "ILS"), ("1500", "ILS")]),
        ("250 שחקנים ו-4 כוכבים", []),
    ],
)
def test_extract_money_formats(text, expected):
    assert [(format(m.amount, "f"), m.currency) for m in extract_money(text)] == expected


ALLOWED = [(Decimal("1234.00"), "ILS"), (Decimal("411.33"), "ILS"), (Decimal("349.00"), "EUR")]


def test_verified_prices_stay_within_half_percent_and_same_currency():
    g = ground_text("הטיסה עולה 1,234 ₪. ללילה כ-411 ₪. במלון: 349 יורו. בערך 1,238 ₪.", ALLOWED)
    assert g.ok and g.removed_claims == [] and REMOVED_PRICE not in g.text
    assert g.prices_checked == 4


def test_unverified_or_wrong_currency_prices_are_replaced():
    g = ground_text("המלון עולה 999 ₪ ללילה. הטיסה עולה 1,234 $. הזולה: 1,234 ₪.", ALLOWED)
    assert not g.ok
    assert g.text.count(REMOVED_PRICE) == 2
    assert "999" not in g.text and "1,234 $" not in g.text and "1,234 ₪" in g.text
    assert len(g.removed_claims) == 2 and g.prices_removed == 2


def test_bare_numbers_in_price_sentences_are_checked_but_units_dates_and_flight_numbers_are_not():
    g = ground_text("המחיר הכולל 4,321. טיסה LY315 עולה 1,234 ₪ ונוחתת ב-14:30. המלון 2.3 ק״מ מהמרכז, 4 כוכבים.", ALLOWED)
    assert "4,321" not in g.text and REMOVED_PRICE in g.text
    assert "LY315" in g.text and "14:30" in g.text and "2.3 ק״מ" in g.text
    assert g.prices_removed == 1


@pytest.mark.parametrize(
    "claim",
    [
        "הזמנתי לכם את הטיסה!",
        "ההזמנה אושרה ונשלחה למייל.",
        "שילמתי בכרטיס האשראי.",
        "התשלום בוצע בהצלחה.",
        "I've booked the flight for you.",
        "Your booking is confirmed.",
        "Great news, booked it for you!",
        "Here is your confirmation number: ABC123.",
    ],
)
def test_booking_claims_are_removed(claim):
    g = ground_text(f"מצאתי אפשרויות טובות. {claim} כדאי לבדוק את הכרטיסים.", [])
    assert not g.ok and g.booking_claims_removed == 1
    assert claim not in g.text
    assert "מצאתי אפשרויות טובות." in g.text and "כדאי לבדוק את הכרטיסים." in g.text


def test_negated_booking_statements_are_kept():
    text = "לא הזמנתי שום דבר — אני לא יכול להזמין. I have not booked anything."
    g = ground_text(text, [])
    assert g.ok and g.text == text


def test_no_prices_allowed_removes_every_amount():
    g = ground_text("יום נהדר בפריז. הכניסה עולה 25 €.", [])
    assert not g.ok and "25 €" not in g.text and REMOVED_PRICE in g.text
