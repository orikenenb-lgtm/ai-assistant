"""Grounding: money extraction (Hebrew/English formats), verification against tool results, booking-claim stripping."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.ai.grounding import ANY_CURRENCY, REMOVED_PRICE, amounts_from_text, extract_money, ground_text


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


# ------------------------------------------------- AUD-06 regression tests ----
# Audit setup: a single allowed amount of 3,100.45 ₪. Every line below used to pass untouched.
AUDIT_ALLOWED = [(Decimal("3100.45"), "ILS")]


@pytest.mark.parametrize(
    ("text", "leak"),
    [
        # audit report, verbatim
        ("המחיר הוא 1.200 ₪ בלבד.", "1.200"),
        ("המחיר ₪1.200 לאדם.", "1.200"),
        ("המחיר 1200.555 ₪", "1200.555"),
        ("המחיר 12 אלף ₪.", "12 אלף"),
        ("המחיר אלפיים שקלים.", "אלפיים"),
        ("עולה 99 בלבד.", "99"),
        # coordinator list
        ("המחיר 12 אלפים שקלים.", "12 אלפים"),
        ("המחיר 12K ₪.", "12K"),
        ("המחיר ₪12k.", "12k"),
        ("רק 1.5 מיליון ₪", "1.5"),
        ("זה עולה אלף ומאתיים שקל.", "ומאתיים"),
        ("It costs two thousand dollars.", "thousand"),
        ("רק 99 ש״ח", "99"),
        ("only 45 dollars", "45"),
        # new variants
        ("עולה 99 ללילה.", "99"),
        ("the price is 99USD", "99"),
        ("the price is 1500NIS", "1500"),
        ("מחיר: 1\u200f200 ₪", "200"),  # bidi mark between digits
        ("מחיר 1'200 ₪", "1'200"),
        ("מחיר 1’200 ₪", "1’200"),
        ("מחיר 1\u202f200 ₪", "200"),  # narrow no-break space thousands separator
        ("€ 1.234,50 לחדר", "1.234,50"),
        ("1,000-1,500 ₪", "1,500"),
        ("$1,000-1,500", "1,500"),
        ("1-2 אלף ₪", "אלף"),
        ("כ-3 אלף שקל", "3 אלף"),
        ("מאות דולרים בלבד", "מאות"),
        ("about a hundred and fifty euros", "fifty"),
        ("costs 12 grand", "12"),
        ("המחיר הכולל: ١٢٠٠ ₪", "١٢٠٠"),  # Arabic-Indic digits
        ("סה״כ 4,321", "4,321"),
        ("עולה בערך 2,500, כולל מסים.", "2,500"),
        ("המחיר 1,200 בערך ₪", "1,200"),  # currency not directly adjacent
        ("₪ אלפיים", "אלפיים"),
    ],
)
def test_aud06_bypasses_are_removed(text, leak):
    g = ground_text(text, AUDIT_ALLOWED)
    assert REMOVED_PRICE in g.text, g.text
    assert leak not in g.text, g.text
    assert not g.ok and g.prices_removed >= 1


@pytest.mark.parametrize(
    ("text", "allowed"),
    [
        ("המחיר הוא 1.200 ₪ בלבד.", [(Decimal("1200"), "ILS")]),  # European thousands separator, verified
        ("המחיר ₪1.200 לאדם.", [(Decimal("1200.00"), "ILS")]),
        ("המחיר 12 אלף ₪.", [(Decimal("12000"), "ILS")]),
        ("המחיר 12K ₪.", [(Decimal("12010"), "ILS")]),  # within 0.5%
        ("€ 1.234,50 לחדר", [(Decimal("1234.50"), "EUR")]),
        ("רק 99 ש״ח", [(Decimal("99"), "ILS")]),
        ("עולה 99 בלבד.", [(Decimal("99.00"), "EUR")]),  # bare number: any currency
        ("בין 1,000 ל-1,500 ₪", [(Decimal("1000"), "ILS"), (Decimal("1500"), "ILS")]),
    ],
)
def test_aud06_verified_variants_are_kept(text, allowed):
    g = ground_text(text, allowed)
    assert g.ok and g.text == text, g.text


def test_both_thousands_and_decimal_readings_are_tried():
    [m] = extract_money("₪1.200")
    assert m.amount == Decimal("1200") and set(m.candidates) == {Decimal("1200"), Decimal("1.200")}
    [m] = extract_money("12 אלף ₪")
    assert m.amount == Decimal("12000") and m.currency == "ILS"
    # the reading must also be in the same currency
    assert REMOVED_PRICE in ground_text("המחיר 1.200 $", [(Decimal("1200"), "ILS")]).text


@pytest.mark.parametrize(
    "claim",
    [
        "ההזמנה שלך אושרה.",
        "הטיסה הוזמנה בהצלחה!",
        "המלון שוריין.",
        "Your flight is booked.",
        "I've reserved the room.",
        "The reservation is confirmed.",
        "You're all set!",
        "הכרטיסים הונפקו.",
        "שריינו לכם את המלון.",
        "אני מזמין לכם עכשיו.",
        "We booked it for you.",
        "I'll book it now.",
        "החדר שמור לכם.",
        "Booking reference: ABC123.",
        "אתם מסודרים!",
        "Your tickets have been issued.",
    ],
)
def test_aud06_booking_claims_are_removed(claim):
    g = ground_text(f"מצאתי אפשרויות טובות. {claim}", [])
    assert g.booking_claims_removed == 1 and not g.ok
    assert g.text == "מצאתי אפשרויות טובות."


@pytest.mark.parametrize(
    "text",
    [
        "לא ביצעתי הזמנה.",
        "I can't book or pay.",
        "I haven't booked anything.",
        "אינני יכול להזמין — רק לחפש.",
        "הטיסה לא הוזמנה.",
        "I will not book anything.",
        "Your flight is not booked yet.",
        "ההזמנה עדיין לא אושרה.",
    ],
)
def test_aud06_negated_statements_are_kept(text):
    g = ground_text(text, [])
    assert g.ok and g.text == text


@pytest.mark.parametrize(
    "text",
    [
        "1. מלון רומא (דמו) — 4★, 3,100.45 ₪ ל-3 לילות, דירוג 8.7, 0.6 ק״מ מהמרכז.",
        "יציאה ב-08:30, נחיתה 11:45 (3:45 שעות), המחיר 3,100.45 ₪ ל-2 מבוגרים.",
        "מצאתי 15 הצעות; הזולה 3,100 ₪ ב-12 בדצמבר 2026, טיסה LY315.",
        "המחיר לטיסה ב-12.12 הוא 3,100.45 ₪, עם 20 ק״ג כבודה.",
        "טיסה ב-2026-12-12 עולה 3,100.45 ₪.",
        "ציון 76 מתוך 100, המחיר 3,100.45 ₪.",
        "ילד בן 12 משלם 3,100.45 ₪.",
        "המחיר 3,100.45 ₪ כולל 2 מזוודות ו-10% הנחה.",
    ],
)
def test_aud06_no_false_positives_on_legitimate_answers(text):
    g = ground_text(text, AUDIT_ALLOWED)
    assert g.ok and g.text == text, (g.text, g.removed_claims)


def test_user_typed_amounts_are_allowed_even_without_currency():
    allowed = amounts_from_text("טיסה לרומא, תקציב 3000")
    assert (Decimal("3000"), ANY_CURRENCY) in allowed
    g = ground_text("הבנתי, תקציב של 3,000 ₪.", allowed)
    assert g.ok and "3,000 ₪" in g.text
    assert amounts_from_text("עד 1.500 € לאדם") == [(Decimal("1500"), "EUR")]
