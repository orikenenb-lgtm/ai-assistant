"""Rule-based Hebrew/English intent parser (no model): categories, places, dates, travellers, budget, questions."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.modules.ai.intent import extract_slots, parse_conversation, parse_intent

# Fixed "today" for deterministic slot extraction (a Thursday).
TODAY = date(2026, 11, 12)


def _u(text: str) -> dict:
    return parse_intent(text, today=TODAY).understood


# (text, expected subset of `understood`)
PHRASINGS: list[tuple[str, dict]] = [
    ("טיסה לרומא ב-12/12 ל-5 לילות, 2 מבוגרים ו-2 ילדים בני 5 ו-8",
     {"category": "flight", "destination": "ROM", "start_date": "2026-12-12", "end_date": "2026-12-17", "adults": 2,
      "children_ages": [5, 8]}),
    ("אני ואשתי רוצים לטוס מתל אביב לפריז בין ה-3 ל-10 בינואר",
     {"category": "flight", "origin": "TLV", "destination": "PAR", "start_date": "2027-01-03", "end_date": "2027-01-10",
      "adults": 2}),
    ("מלון ברומא עם ארוחת בוקר 12-19/12 לשני מבוגרים",
     {"category": "hotel", "destination": "ROM", "start_date": "2026-12-12", "end_date": "2026-12-19", "adults": 2,
      "board": "breakfast"}),
    ("השכרת רכב אוטומט באתונה מ-20.12 עד 27.12",
     {"category": "car", "destination": "ATH", "start_date": "2026-12-20", "end_date": "2026-12-27",
      "transmission": "automatic"}),
    ("מה לעשות בברצלונה עם ילדים בני 4 ו-9 בסוף השבוע הבא",
     {"category": "activity", "destination": "BCN", "start_date": "2026-11-19", "end_date": "2026-11-21",
      "children_ages": [4, 9]}),
    ("טיסה ישירה ללונדון בעוד שבועיים לשבוע, עד 3000 ש״ח",
     {"category": "flight", "destination": "LON", "start_date": "2026-11-26", "end_date": "2026-12-03", "max_stops": 0,
      "budget": "3000", "budget_currency": "ILS"}),
    ("flight from Tel Aviv to Rome on December 12 for 2 adults",
     {"category": "flight", "origin": "TLV", "destination": "ROM", "start_date": "2026-12-12", "adults": 2}),
    ("hotel in Paris Dec 3-7, 2 adults and a child aged 6, budget $1500",
     {"category": "hotel", "destination": "PAR", "start_date": "2026-12-03", "end_date": "2026-12-07", "adults": 2,
      "children_ages": [6], "budget": "1500", "budget_currency": "USD"}),
    ("לטוס לאתונה ב-3 בפברואר ולחזור ב-10 בפברואר",
     {"category": "flight", "destination": "ATH", "start_date": "2027-02-03", "end_date": "2027-02-10"}),
    ("טיסה לפאפוס בעוד 3 ימים", {"category": "flight", "destination": "PFO", "start_date": "2026-11-15"}),
    ("hotel in Vienna next week for 5 nights",
     {"category": "hotel", "destination": "VIE", "start_date": "2026-11-15", "end_date": "2026-11-20", "nights": 5}),
    ("מלון 4 כוכבים בבודפשט עם ביטול חינם ל-3 לילות מ-14.2, עד 500 ₪ ללילה",
     {"category": "hotel", "destination": "BUD", "start_date": "2027-02-14", "end_date": "2027-02-17", "min_stars": 4,
      "free_cancellation": True, "budget": "500", "budget_basis": "night"}),
    ("שני מבוגרים ושלושה ילדים בני 3, 6 ו-10 מלון ברודוס 10-15/8",
     {"category": "hotel", "destination": "RHO", "adults": 2, "children_ages": [3, 6, 10], "start_date": "2027-08-10"}),
    ("טיסה מרומא לתל אביב ב-1/12", {"category": "flight", "origin": "FCO", "destination": "TLV", "start_date": "2026-12-01"}),
    ("flight to Nice from Paris on 2/1", {"category": "flight", "origin": "CDG", "destination": "NCE", "start_date": "2027-01-02"}),
    ("a nice hotel in Rome 1/12-3/12", {"category": "hotel", "destination": "ROM", "start_date": "2026-12-01"}),
    ("טיסה כיוון אחד לבנגקוק ב-28/12, 2 מבוגרים", {"category": "flight", "destination": "BKK", "one_way": True, "adults": 2}),
    ("השכרת רכב SUV בשדה בלרנקה מ-5.1 עד 9.1",
     {"category": "car", "destination": "LCA", "car_class": "suv", "start_date": "2027-01-05", "end_date": "2027-01-09"}),
    ("אטרקציות לילדים בפריז 3-6 בינואר, ילדה בת 7 וילד בן 11",
     {"category": "activity", "destination": "PAR", "children_ages": [7, 11], "interests": ["family"]}),
    ("טיסה לרומא ב-28/12 וחזרה ב-3/1", {"start_date": "2026-12-28", "end_date": "2027-01-03", "round_trip": True}),
    ("טיסה לבודפשט ב-12/12, עד 1,500 € לאדם, 2 מבוגרים",
     {"destination": "BUD", "budget": "1500", "budget_currency": "EUR", "budget_basis": "person"}),
    ("flight to Tbilisi 5-12 Jan 2027, 2 adults 1 child (4)",
     {"destination": "TBS", "start_date": "2027-01-05", "end_date": "2027-01-12", "adults": 2, "children_ages": [4]}),
    ("רכב 7 מקומות במילאנו ל-3 ימים מ-10/1", {"category": "car", "destination": "MIL", "min_seats": 7, "days": 3}),
    ("סיור בעברית ברומא ב-13.12", {"category": "activity", "language": "he", "interests": ["tour"]}),
    ("need a car in Larnaca from 5/1 to 9/1, driver aged 23", {"category": "car", "destination": "LCA", "driver_age": 23}),
    ("אני לבד, טיסה לאמסטרדם מחר", {"adults": 1, "destination": "AMS", "start_date": "2026-11-13"}),
    ("טיסה במחלקת עסקים ל-NYC ב-15/03", {"cabin": "business", "destination": "NYC", "start_date": "2027-03-15"}),
    ("טיסה מ-TLV ל-FCO ב-2026-12-20",
     {"origin": "TLV", "destination": "ROM", "destination_airport": "FCO", "start_date": "2026-12-20"}),
    ("מלון 4.5 כוכבים בלונדון 1-4/12", {"min_stars": 4, "start_date": "2026-12-01", "end_date": "2026-12-04"}),
    ("טיסה לדובאי ב-12 בדצמבר עם תינוק", {"destination": "DXB", "infants": 1, "start_date": "2026-12-12"}),
    ("מלון כשר ונגיש באילת לסופ\"ש", {"category": "hotel", "destination": "ETH", "kosher": True, "accessible": True,
                                       "start_date": "2026-11-12", "end_date": "2026-11-14"}),
]


@pytest.mark.parametrize(("text", "expected"), PHRASINGS, ids=[p[0][:40] for p in PHRASINGS])
def test_parser_phrasings(text, expected):
    understood = _u(text)
    for key, value in expected.items():
        assert understood.get(key) == value, (key, understood)


def test_at_least_25_phrasings_are_covered():
    assert len(PHRASINGS) >= 25


@pytest.mark.parametrize(
    ("text", "missing", "question_part"),
    [
        ("טיסה לרומא", ["depart_date"], "באיזה תאריך"),
        ("מלון בפראג בדצמבר", ["check_in"], "בדצמבר"),
        ("אטרקציות בלונדון", ["date_from"], "תאריכים"),
        ("צימר", ["destination", "check_in"], "באיזו עיר"),
        ("טיסה ליוון ב-5/1", ["destination"], "ביוון"),
        ("טיסה במחלקת עסקים ל-NYC ב-15/03 הלוך חזור", ["return_date"], "מתי חוזרים"),
        ("שלום, מה שלומך?", ["category"], "טיסות, מלון, רכב או אטרקציות"),
        ("טיסה לתל אביב", ["origin", "depart_date"], "מאיפה"),
        ("אני, אשתי ו-2 ילדים, טיסה לניו יורק ב-20/12", ["children_ages"], "בני כמה"),
        ("טיסה לברלין עם הילדים ב-1/2", ["travelers"], "כמה מבוגרים וכמה ילדים"),
        ("flights to Barcelona next weekend for a family of 4", ["travelers"], "כמה מבוגרים וכמה ילדים"),
    ],
)
def test_missing_fields_yield_one_short_hebrew_question(text, missing, question_part):
    r = parse_intent(text, today=TODAY)
    assert r.params is None
    assert r.missing_fields == missing
    q = r.clarifying_question
    assert q and question_part in q
    assert q.count("?") == 1 and len(q) <= 80  # ONE short question


def test_family_of_four_asks_composition_after_dates():
    r = parse_intent("משפחה של 4 רוצה מלון באילת", today=TODAY)
    assert r.missing_fields == ["check_in", "travelers"]
    r2 = parse_conversation(["משפחה של 4 רוצה מלון באילת", "מ-10/12 ל-3 לילות"], today=TODAY)
    assert r2.missing_fields == ["travelers"]
    assert "ובני כמה" in r2.clarifying_question


def test_complete_request_builds_validated_params():
    today = date.today()
    r = parse_intent("טיסה לרומא בעוד שבועיים ל-5 לילות, 2 מבוגרים וילד בן 6, ישירה", today=today)
    assert r.complete and r.missing_fields == [] and r.clarifying_question is None
    p = r.params
    assert p["category"] == "flight" and p["origin"] == "TLV" and p["destination"] == "FCO"
    assert p["depart_date"] == (today + timedelta(days=14)).isoformat()
    assert p["return_date"] == (today + timedelta(days=19)).isoformat()
    assert p["adults"] == 2 and p["children_ages"] == [6] and p["max_stops"] == 0
    assert "הנחתי יציאה מנתב״ג (TLV)" in r.assumptions


def test_hotel_params_rooms_and_budget_per_night():
    today = date.today()
    r = parse_intent("מלון בבודפשט בעוד חודש ל-3 לילות, עד 500 ₪ ללילה, 2 מבוגרים וילדה בת 4", today=today)
    assert r.complete
    p = r.params
    assert p["rooms"] == [{"adults": 2, "children_ages": [4]}]
    assert p["max_price"] == "1500" and p["currency"] == "ILS"


def test_car_and_activity_params():
    today = date.today()
    car = parse_intent("השכרת רכב אוטומט בלרנקה בעוד 10 ימים ל-4 ימים, נהג בן 24", today=today).params
    assert car["pickup_location"] == "LCA" and car["transmission"] == "automatic" and car["driver_age"] == 24
    assert car["pickup_at"].endswith("T10:00:00") and car["dropoff_at"].startswith((today + timedelta(days=14)).isoformat())
    act = parse_intent("מוזיאונים ברומא בעוד שבוע ל-3 לילות", today=today).params
    assert act["destination"] == "Rome" and act["interests"] == ["museum"]
    assert act["date_from"] == (today + timedelta(days=7)).isoformat()
    assert act["date_to"] == (today + timedelta(days=10)).isoformat()


def test_relative_weekends_and_weekdays():
    thursday = date(2026, 11, 12)
    s = extract_slots("סוף השבוע הבא", thursday)
    assert (s.start_date, s.end_date) == (date(2026, 11, 19), date(2026, 11, 21))
    s = extract_slots("next weekend", date(2026, 11, 9))  # Monday
    assert (s.start_date, s.end_date) == (date(2026, 11, 19), date(2026, 11, 21))
    s = extract_slots("this weekend", date(2026, 11, 14))  # Saturday -> today
    assert s.start_date == date(2026, 11, 14)
    assert extract_slots("ביום חמישי", thursday).start_date == date(2026, 11, 19)
    assert extract_slots("מחרתיים", thursday).start_date == date(2026, 11, 14)
    assert extract_slots("in 2 weeks", thursday).start_date == date(2026, 11, 26)


def test_date_without_year_rolls_to_next_occurrence_and_ranges_cross_year():
    s = extract_slots("10/11-15/11", date(2026, 11, 12))
    assert s.start_date == date(2027, 11, 10) and s.end_date == date(2027, 11, 15)
    s = extract_slots("28/12 עד 3/1", date(2026, 11, 12))
    assert s.start_date == date(2026, 12, 28) and s.end_date == date(2027, 1, 3)


def test_not_dates_ratings_and_money_are_not_dates():
    s = extract_slots("דירוג 8.7 ומעלה, עד 1.500 ₪", TODAY)
    assert s.start_date is None


def test_three_letter_lowercase_words_are_not_airport_codes():
    s = extract_slots("I want to go with her by bus", TODAY)
    assert s.destination is None and s.origin is None


def test_past_explicit_date_returns_hebrew_validation_question():
    r = parse_intent("טיסה לרומא ב-1/1/2020", today=date.today())
    assert r.params is None and r.missing_fields == ["invalid_params"]
    assert "עבר" in r.clarifying_question and r.errors


def test_multi_turn_slot_filling():
    today = date.today()
    r = parse_conversation(["אני רוצה טיסה", "לרומא", "בעוד חודש לשבוע, 2 מבוגרים"], today=today)
    assert r.complete and r.params["destination"] == "FCO" and r.params["adults"] == 2
    r = parse_conversation(["טיסה לרומא בעוד חודש לשבוע, 2 מבוגרים", "ועכשיו מלון שם"], today=today)
    assert r.category == "hotel" and r.params["destination"] == "Rome"
    assert r.params["check_out"] == (today + timedelta(days=37)).isoformat()


def test_follow_up_duration_recomputes_end_date():
    r = parse_conversation(["מלון ברומא 12/12-15/12", "בעצם ל-5 לילות"], today=TODAY)
    assert r.understood["start_date"] == "2026-12-12" and r.understood["nights"] == 5
    assert r.understood.get("end_date") is None  # re-derived when building params
