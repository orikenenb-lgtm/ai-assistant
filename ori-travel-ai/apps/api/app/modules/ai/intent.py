"""Rule-based Hebrew/English travel-intent parser (works with NO model).

``parse_intent(text, today=...)`` extracts *slots* (category, places, dates,
travellers, budget, preferences), merges them with earlier slots (multi-turn
slot filling) and builds validated search params via
``search.service.parse_search_params``. When something essential is missing it
returns ``missing_fields`` plus ONE short Hebrew clarifying question for the
most important field.

Places come from the offline geography dataset (``providers.data.geo``), with
Hebrew prefixes stripped ("לרומא", "מתל אביב", "בפריז"). ``today`` is injectable
for deterministic tests (relative dates: "בעוד שבועיים", "סוף השבוע הבא").
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, fields, replace
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from app.core.errors import AppError
from app.modules.ai.grounding import extract_money
from app.modules.providers.data.geo import CITIES, City, get_airport, normalize_place, resolve_city
from app.modules.search.service import parse_search_params

HEB = "֐-׿"
NB = rf"(?<![{HEB}A-Za-z])"  # start of a word (Hebrew/English)
NE = rf"(?![{HEB}A-Za-z])"  # end of a word
PFX = "(?:[ובלהמש]|וה|ול|וב|ומ|מה|לה|בה|של|שב|שה|כש)?"  # optional Hebrew prefix letters

CATEGORY_HE = {"flight": "טיסות", "hotel": "מלונות", "car": "השכרת רכב", "activity": "אטרקציות"}
HE_MONTHS = {"ינואר": 1, "פברואר": 2, "מרץ": 3, "מרס": 3, "אפריל": 4, "מאי": 5, "יוני": 6, "יולי": 7, "אוגוסט": 8,
             "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12}
HE_MONTH_NAMES = {1: "ינואר", 2: "פברואר", 3: "מרץ", 4: "אפריל", 5: "מאי", 6: "יוני", 7: "יולי", 8: "אוגוסט",
                  9: "ספטמבר", 10: "אוקטובר", 11: "נובמבר", 12: "דצמבר"}
EN_MONTHS = {"january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4, "apr": 4, "may": 5,
             "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sept": 9, "sep": 9,
             "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12}
HE_WEEKDAYS = {"ראשון": 6, "שני": 0, "שלישי": 1, "רביעי": 2, "חמישי": 3, "שישי": 4, "שבת": 5}  # python weekday()
HE_NUMBERS = {"אחד": 1, "אחת": 1, "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2, "שלושה": 3, "שלוש": 3, "שלושת": 3,
              "ארבעה": 4, "ארבע": 4, "ארבעת": 4, "חמישה": 5, "חמש": 5, "חמשת": 5, "שישה": 6, "שש": 6, "ששת": 6,
              "שבעה": 7, "שבע": 7, "שבעת": 7, "שמונה": 8, "שמונת": 8, "תשעה": 9, "תשע": 9, "תשעת": 9, "עשרה": 10,
              "עשר": 10, "עשרת": 10}
EN_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
              "ten": 10}
EXTRA_PLACE_ALIASES = {"נתבג": "TLV", "בן גוריון": "TLV", "ben gurion": "TLV", "נמל התעופה בן גוריון": "TLV"}
AMBIGUOUS_LOWER_EN = {"nice"}  # English place names that are also common words: require capitalisation

MAX_TEXT = 4000

# ------------------------------------------------------------- keywords ----

_CATEGORY_PATTERNS: dict[str, list[str]] = {
    "flight": [
        rf"{NB}{PFX}(?:טיסה|טיסות|טיסת|לטוס|טסים|טס|טסה|נטוס|כרטיסי טיסה|כרטיס טיסה|הלוך חזור|הלוך ושוב){NE}",
        r"\b(?:flights?|fly|flying|airfare|plane tickets?|round[- ]trip|one[- ]way)\b",
    ],
    "hotel": [
        rf"{NB}{PFX}(?:מלון|מלונות|בית מלון|בתי מלון|לינה|ללון|לישון|צימר|צימרים|אכסניה|הוסטל|דירת נופש|ריזורט|אירוח){NE}",
        r"\b(?:hotels?|accommodations?|lodging|resorts?|hostels?|airbnb|place to stay|where to stay)\b",
    ],
    "car": [
        rf"{NB}{PFX}(?:רכב|רכבים|השכרת רכב|אוטו|מכונית|ג'יפ){NE}",
        r"\b(?:car rentals?|rental cars?|rent a car|cars?|vehicle)\b",
    ],
    "activity": [
        rf"{NB}{PFX}(?:אטרקציה|אטרקציות|פעילות|פעילויות|מה לעשות|סיור|סיורים|מוזיאון|מוזיאונים|הופעה|הופעות|בילוי|בילויים){NE}",
        r"\b(?:attractions?|activit(?:y|ies)|things to do|tours?|museums?|sightseeing|excursions?)\b",
    ],
}
_CATEGORY_RES = {k: [re.compile(p, re.IGNORECASE) for p in v] for k, v in _CATEGORY_PATTERNS.items()}
_CATEGORY_PRIORITY = ("flight", "hotel", "car", "activity")

_INTERESTS: dict[str, str] = {
    "museum": rf"{NB}{PFX}(?:מוזיאון|מוזיאונים|גלריה|גלריות){NE}|\bmuseums?\b|\bgaller(?:y|ies)\b",
    "tour": rf"{NB}{PFX}(?:סיור|סיורים|סיור מודרך|מדריך){NE}|\b(?:guided )?tours?\b",
    "outdoor": rf"{NB}{PFX}(?:טבע|אופניים|טיולי טבע|הליכה|מסלול){NE}|\b(?:outdoors?|nature|hiking|biking|bike)\b",
    "family": rf"{NB}{PFX}(?:משפחתי|משפחתיות|משפחתית|לילדים|פארק שעשועים|לונה פארק){NE}|\b(?:family|kids activities|for kids)\b",
    "food": rf"{NB}{PFX}(?:אוכל|קולינרי|קולינריה|בישול|טעימות|מסעדות){NE}|\b(?:food|culinary|cooking|tasting)\b",
    "water": rf"{NB}{PFX}(?:מים|ים|שיט|חוף|חופים|פארק מים|שנורקל){NE}|\b(?:water|beach|boat|cruise|snorkel(?:ing)?)\b",
    "nightlife": rf"{NB}{PFX}(?:חיי לילה|ברים|מועדונים|מסיבות){NE}|\b(?:nightlife|bars|clubs)\b",
    "shopping": rf"{NB}{PFX}(?:קניות|שופינג|שווקים|שוק){NE}|\b(?:shopping|markets?)\b",
    "culture": rf"{NB}{PFX}(?:תרבות|מופע|מופעים|היסטוריה|היסטורי|אומנות|אמנות){NE}|\b(?:culture|cultural|shows?|history|art)\b",
    "adventure": rf"{NB}{PFX}(?:אתגר|אתגרים|אקסטרים|הרפתקה|הרפתקאות|פארק חבלים){NE}|\b(?:adventure|extreme)\b",
}
_INTEREST_RES = {k: re.compile(v, re.IGNORECASE) for k, v in _INTERESTS.items()}

# -------------------------------------------------------------- slots ----


@dataclass
class Slots:
    """Everything understood so far. ``None`` = not mentioned (merging keeps older values)."""

    category: str | None = None
    origin: str | None = None  # IATA airport code
    destination: str | None = None  # IATA city code
    destination_airport: str | None = None
    origin_explicit: bool | None = None
    country_hint: str | None = None  # Hebrew country name when only a country was given
    start_date: date | None = None
    end_date: date | None = None
    month_hint: int | None = None
    nights: int | None = None
    days: int | None = None
    adults: int | None = None
    children_count: int | None = None
    children_ages: list[int] | None = None
    children_unknown: bool | None = None  # "with the kids" without a count
    infants: int | None = None
    family_size: int | None = None
    budget: Decimal | None = None
    budget_currency: str | None = None
    budget_basis: str | None = None  # total / night / person
    cabin: str | None = None
    max_stops: int | None = None
    board: str | None = None
    min_stars: int | None = None
    free_cancellation: bool | None = None
    kosher: bool | None = None
    accessible: bool | None = None
    transmission: str | None = None
    car_class: str | None = None
    min_seats: int | None = None
    driver_age: int | None = None
    interests: list[str] | None = None
    one_way: bool | None = None
    round_trip: bool | None = None
    flex_days: int | None = None
    departure_window: str | None = None
    language: str | None = None
    rooms: int | None = None
    near_airport: bool | None = None

    def merged_with(self, newer: Slots) -> Slots:
        out = replace(self)
        for f in fields(Slots):
            value = getattr(newer, f.name)
            if value is None or value == []:
                continue
            setattr(out, f.name, value)
        # A newly mentioned destination invalidates an older country-only hint.
        if newer.destination is not None:
            out.country_hint = None
        return out

    def is_empty(self) -> bool:
        return all(getattr(self, f.name) in (None, []) for f in fields(Slots))

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for f in fields(Slots):
            v = getattr(self, f.name)
            if v is None:
                continue
            if isinstance(v, date):
                v = v.isoformat()
            elif isinstance(v, Decimal):
                v = format(v, "f")
            out[f.name] = v
        for key, code in (("origin", self.origin), ("destination", self.destination)):
            if code:
                out[f"{key}_name"] = place_name(code)
        return out


@dataclass
class ParseResult:
    category: str | None
    params: dict[str, Any] | None
    missing_fields: list[str]
    clarifying_question: str | None
    understood: dict[str, Any]
    assumptions: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    slots: Slots = field(default_factory=Slots)
    model: Any = None  # validated params model (internal)

    @property
    def complete(self) -> bool:
        return self.params is not None

    def public(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "params": self.params,
            "missing_fields": self.missing_fields,
            "clarifying_question": self.clarifying_question,
            "understood": self.understood,
            "assumptions": self.assumptions,
            "errors": self.errors,
        }


def place_name(code: str) -> str:
    city = CITIES.get(code)
    if city:
        return city.name_he
    airport = get_airport(code)
    if airport:
        return CITIES[airport.city_code].name_he
    return code


# --------------------------------------------------------- normalisation ----

_TRANSLATE = str.maketrans({"״": '"', "׳": "'", "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "־": "-", "–": "-",
                            "—": "-", "‏": " ", "‎": " ", "\xa0": " ", "\t": " "})
_PREFIX_HYPHEN = re.compile(rf"(?<![{HEB}])([ובלמה]{{1,2}})-(?=[{HEB}])")


def normalize(text: str) -> str:
    s = (text or "")[:MAX_TEXT].translate(_TRANSLATE)
    s = "".join(ch if ch.isprintable() or ch == "\n" else " " for ch in s)
    return _PREFIX_HYPHEN.sub(r"\1", s)


def _blank(s: str, start: int, end: int) -> str:
    return s[:start] + " " * (end - start) + s[end:]


def _replace_number_words(s: str) -> str:
    """Hebrew/English number words -> digits, length-preserving (positions stay aligned)."""

    def he(m: re.Match[str]) -> str:
        prefix, word = m.group(1) or "", m.group(2)
        digits = str(HE_NUMBERS[word])
        return prefix + digits + " " * (len(word) - len(digits))

    def en(m: re.Match[str]) -> str:
        word = m.group(0)
        digits = str(EN_NUMBERS[word.lower()])
        return digits + " " * (len(word) - len(digits))

    he_alt = "|".join(sorted(HE_NUMBERS, key=len, reverse=True))
    s = re.sub(rf"(?<![{HEB}])(ו|ה|ב|ל|ש)?({he_alt})(?![{HEB}])", he, s)
    return re.sub(r"\b(?:" + "|".join(EN_NUMBERS) + r")\b", en, s, flags=re.IGNORECASE)


# ------------------------------------------------------------- category ----


def detect_categories(text: str) -> list[str]:
    hits: list[tuple[int, int, str]] = []
    for cat, patterns in _CATEGORY_RES.items():
        positions = [m.start() for p in patterns for m in p.finditer(text)]
        if positions:
            hits.append((min(positions), _CATEGORY_PRIORITY.index(cat), cat))
    return [c for _, _, c in sorted(hits)]


# --------------------------------------------------------------- places ----

_TOKEN_RE = re.compile(rf"[A-Za-z]+(?:'[A-Za-z]+)?|[{HEB}]+(?:['\"][{HEB}]*)*")
_ROLE_BY_LETTER = {"מ": "origin", "ל": "destination", "ב": "in"}
_EN_ROLE = re.compile(r"\b(from|to|into|in|at|near|around|via)\s+$", re.IGNORECASE)
_EN_ROLE_MAP = {"from": "origin", "to": "destination", "into": "destination", "in": "in", "at": "in", "near": "in",
                "around": "in"}
_STANDALONE_PREFIX = re.compile(rf"(?<![{HEB}])([מלב])-?\s*$")


@dataclass
class PlaceHit:
    city: City
    airport: str | None
    role: str | None
    start: int
    end: int


def _countries() -> dict[str, str]:
    out: dict[str, str] = {}
    for c in CITIES.values():
        out.setdefault(normalize_place(c.country_he), c.country_he)
    return out


_COUNTRIES = _countries()


def _lookup_place(phrase: str, raw_first: str) -> tuple[City, str | None] | None:
    norm = normalize_place(phrase)
    if not norm:
        return None
    if norm in EXTRA_PLACE_ALIASES:
        code = EXTRA_PLACE_ALIASES[norm]
        return CITIES[code], code
    ascii_word = phrase.isascii()
    if ascii_word and len(phrase) == 3 and phrase.isalpha():
        if not phrase.isupper():
            return None  # "the", "her", "mad" are words, "HER"/"FCO" are codes
        airport = get_airport(phrase)
        if airport:
            return CITIES[airport.city_code], airport.iata
        city = CITIES.get(phrase)
        return (city, None) if city else None
    if ascii_word and norm in AMBIGUOUS_LOWER_EN and not raw_first[:1].isupper():
        return None
    city = resolve_city(phrase)
    return (city, None) if city else None


def _strip_options(token: str) -> list[tuple[str, str | None]]:
    """(stripped token, prefix letters) candidates; the bare token first."""
    out: list[tuple[str, str | None]] = [(token, None)]
    if not re.match(rf"[{HEB}]", token):
        return out
    for n in (1, 2):
        prefix, rest = token[:n], token[n:]
        if len(rest) < 2:
            break
        if all(ch in "ובלהמש" for ch in prefix):
            out.append((rest, prefix))
    return out


def find_places(text: str) -> list[PlaceHit]:
    tokens = [(m.group(0), m.start(), m.end()) for m in _TOKEN_RE.finditer(text)]
    hits: list[PlaceHit] = []
    i = 0
    while i < len(tokens):
        matched = False
        for length in (4, 3, 2, 1):
            if i + length > len(tokens):
                continue
            group = tokens[i:i + length]
            # n-grams must be contiguous words (no punctuation between them)
            if any(text[group[k][2]:group[k + 1][1]].strip() not in ("", "-") for k in range(length - 1)):
                continue
            first, start = group[0][0], group[0][1]
            rest = " ".join(t[0] for t in group[1:])
            for stripped, prefix in _strip_options(first):
                phrase = f"{stripped} {rest}".strip()
                found = _lookup_place(phrase, stripped)
                if not found:
                    continue
                city, airport = found
                role = _ROLE_BY_LETTER.get(prefix[-1]) if prefix else None
                if role is None:
                    before = text[:start]
                    m = _EN_ROLE.search(before)
                    if m:
                        role = _EN_ROLE_MAP.get(m.group(1).lower())
                    else:
                        m2 = _STANDALONE_PREFIX.search(before)
                        if m2:
                            role = _ROLE_BY_LETTER[m2.group(1)]
                hits.append(PlaceHit(city, airport, role, start, group[-1][2]))
                i += length
                matched = True
                break
            if matched:
                break
        if not matched:
            i += 1
    return hits


def find_country(text: str) -> str | None:
    for m in _TOKEN_RE.finditer(text):
        for stripped, _ in _strip_options(m.group(0)):
            name = _COUNTRIES.get(normalize_place(stripped))
            if name:
                return name
    return None


# ---------------------------------------------------------------- dates ----

_HE_MON = "|".join(sorted(HE_MONTHS, key=len, reverse=True))
_EN_MON = "|".join(sorted(EN_MONTHS, key=len, reverse=True))
_DAY_PFX = rf"(?:(?<![{HEB}])[ובלמה]{{1,2}}-?)?"
_ORD = r"(?:st|nd|rd|th)?"

_RE_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_RE_NUM_RANGE = re.compile(r"(?<![\d./:,])(\d{1,2})\s*-\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d:]|[./]\d)")
_RE_NUM = re.compile(r"(?<![\d./:,])(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d:]|[./]\d)")
_RE_HE_RANGE = re.compile(
    rf"(?<!\d){_DAY_PFX}(\d{{1,2}})\s*(?:-|עד|ועד|until|to|ל-?|ול-?)\s*(?:ה-?|ל-?)?(\d{{1,2}})\s+(?:[בל]-?)?({_HE_MON})(?![{HEB}])"
    r"(?:\s+(\d{4}))?"
)
_RE_HE_DAY = re.compile(rf"(?<!\d){_DAY_PFX}(\d{{1,2}})\s+(?:[בל]-?)?({_HE_MON})(?![{HEB}])(?:\s+(\d{{4}}))?")
_RE_EN_MON_DAY = re.compile(
    rf"\b({_EN_MON})\.?\s+(\d{{1,2}}){_ORD}(?:\s*-\s*(\d{{1,2}}){_ORD})?(?:,?\s+(\d{{4}}))?\b", re.IGNORECASE
)
_RE_EN_DAY_MON = re.compile(
    rf"\b(\d{{1,2}}){_ORD}(?:\s*-\s*(\d{{1,2}}){_ORD})?\s+(?:of\s+)?({_EN_MON})\b\.?(?:,?\s+(\d{{4}}))?", re.IGNORECASE
)
_RE_HE_MONTH_ONLY = re.compile(rf"(?<![{HEB}])(?:[בל]|מ|ב-|ל-|בחודש\s+)({_HE_MON})(?![{HEB}])")
_RE_EN_MONTH_ONLY = re.compile(rf"\b(?:in|during)\s+({_EN_MON})\b", re.IGNORECASE)
_RE_NOT_DATE_AFTER = re.compile(r"\s*(?:כוכבים|כוכב|stars?|ק\"מ|km|%|שעות|hours|מתוך|out of|ביקורות)", re.IGNORECASE)
_RE_NOT_DATE_BEFORE = re.compile(r"(?:דירוג|ציון|rating|score)\s*:?\s*$", re.IGNORECASE)

_RE_NEXT_WEEKEND = re.compile(r"(?:סוף\s+ה?שבוע|סופ\"ש|סופש)\s+הבא|next\s+weekend|weekend\s+after\s+next", re.IGNORECASE)
_RE_THIS_WEEKEND = re.compile(r"(?:סוף\s+ה?שבוע|סופ\"ש|סופש)(?:\s+הזה|\s+הקרוב)?|this\s+weekend|the\s+weekend|a\s+weekend",
                              re.IGNORECASE)
_RE_NEXT_WEEK = re.compile(rf"(?<![{HEB}])(?:ב|ל)?שבוע\s+הבא|next\s+week\b", re.IGNORECASE)
_RE_IN_OFFSET = re.compile(
    rf"(?<![{HEB}])(?:בעוד|in)\s+(?:(\d{{1,3}})\s*(ימים|יום|שבועות|שבוע|חודשים|חודש|days?|weeks?|months?)|"
    r"(יומיים|שבועיים|חודשיים|שבוע|חודש|a\s+week|a\s+month|a\s+fortnight|a\s+couple\s+of\s+weeks))",
    re.IGNORECASE,
)
_RE_DAY_AFTER = re.compile(rf"(?<![{HEB}])מחרתיים(?![{HEB}])|day\s+after\s+tomorrow", re.IGNORECASE)
_RE_TOMORROW = re.compile(rf"(?<![{HEB}])ממחר|(?<![{HEB}])מחר(?![{HEB}])|\btomorrow\b", re.IGNORECASE)
_RE_TODAY = re.compile(rf"(?<![{HEB}])(?:היום|מהיום)(?![{HEB}])|\btoday\b|\btonight\b", re.IGNORECASE)
_RE_WEEKDAY = re.compile(rf"(?<![{HEB}])(?:ב|מ)?יום\s+({'|'.join(HE_WEEKDAYS)})(?![{HEB}])|(?<![{HEB}])בשבת(?![{HEB}])")

_RE_NIGHTS = re.compile(r"(?<!\d)(\d{1,2})\s*(?:-\s*)?(?:לילות|לילה|nights?)\b|(?<!\d)(\d{1,2})(?=\s*(?:לילות|לילה))",
                        re.IGNORECASE)
_RE_ONE_NIGHT = re.compile(rf"(?<![{HEB}])(?:ל)?לילה\s+1(?!\d)", re.IGNORECASE)
_RE_DAYS = re.compile(rf"(?<!\d)(\d{{1,2}})\s*(?:-\s*)?(?:ימים|יום(?![{HEB}])|days?\b)", re.IGNORECASE)
_RE_TWO_DAYS = re.compile(rf"(?<![{HEB}])(?:ל|של\s+|למשך\s+)?יומיים(?![{HEB}])")
_RE_WEEKS_N = re.compile(rf"(?<!\d)(\d)\s*(?:שבועות|weeks?)(?![{HEB}])", re.IGNORECASE)
_RE_TWO_WEEKS = re.compile(rf"(?<![{HEB}])(?:ל|של\s+|למשך\s+)?שבועיים(?![{HEB}])|\b(?:a\s+)?fortnight\b", re.IGNORECASE)
_RE_ONE_WEEK = re.compile(
    rf"(?:(?<![{HEB}])ל-?|(?<![{HEB}])למשך\s+|(?<![{HEB}])של\s+|^|(?<=\s))שבוע(?:\s+ימים|\s+1)?(?![{HEB}])|\b(?:for\s+)?a\s+week\b",
    re.IGNORECASE,
)


def _mk_date(year: int | None, month: int, day: int, today: date) -> tuple[date, bool] | None:
    """Build a date; without a year use the next occurrence on/after today. Returns (date, explicit_year)."""
    try:
        if year is not None:
            if year < 100:
                year += 2000
            return date(year, month, day), True
        d = date(today.year, month, day)
        if d < today:
            d = date(today.year + 1, month, day)
        return d, False
    except ValueError:
        return None


@dataclass
class DateFindings:
    dates: list[tuple[int, date, bool]] = field(default_factory=list)  # (position, date, explicit_year)
    rel_start: date | None = None
    rel_end: date | None = None
    month_hint: int | None = None
    nights: int | None = None
    days: int | None = None


def _weekend(today: date, nxt: bool) -> tuple[date, date]:
    """Israeli weekend trip: Thursday -> Saturday. During Fri/Sat 'this weekend' starts today."""
    wd = today.weekday()  # Mon=0 .. Sun=6
    if wd in (4, 5):
        start = today
        end = today + timedelta(days=5 - wd)
        thursday = today - timedelta(days=wd - 3)
    else:
        thursday = today + timedelta(days=(3 - wd) % 7)
        start, end = thursday, thursday + timedelta(days=2)
    if nxt:
        start = thursday + timedelta(days=7)
        end = start + timedelta(days=2)
    return start, end


def find_dates(w: str, today: date) -> tuple[DateFindings, str]:
    """Extract dates/durations from ``w`` (number words already replaced). Returns findings and the blanked text."""
    f = DateFindings()

    def add(pos: int, d: tuple[date, bool] | None) -> None:
        if d is not None:
            f.dates.append((pos, d[0], d[1]))

    for m in _RE_ISO.finditer(w):
        add(m.start(), _mk_date(int(m.group(1)), int(m.group(2)), int(m.group(3)), today))
        w = _blank(w, m.start(), m.end())
    for m in _RE_HE_RANGE.finditer(w):
        mon = HE_MONTHS[m.group(3)]
        year = int(m.group(4)) if m.group(4) else None
        add(m.start(), _mk_date(year, mon, int(m.group(1)), today))
        add(m.start() + 1, _mk_date(year, mon, int(m.group(2)), today))
        w = _blank(w, m.start(), m.end())
    for m in _RE_HE_DAY.finditer(w):
        add(m.start(), _mk_date(int(m.group(3)) if m.group(3) else None, HE_MONTHS[m.group(2)], int(m.group(1)), today))
        w = _blank(w, m.start(), m.end())
    for m in _RE_EN_MON_DAY.finditer(w):
        mon = EN_MONTHS[m.group(1).lower()]
        year = int(m.group(4)) if m.group(4) else None
        add(m.start(), _mk_date(year, mon, int(m.group(2)), today))
        if m.group(3):
            add(m.start() + 1, _mk_date(year, mon, int(m.group(3)), today))
        w = _blank(w, m.start(), m.end())
    for m in _RE_EN_DAY_MON.finditer(w):
        mon = EN_MONTHS[m.group(3).lower()]
        year = int(m.group(4)) if m.group(4) else None
        add(m.start(), _mk_date(year, mon, int(m.group(1)), today))
        if m.group(2):
            add(m.start() + 1, _mk_date(year, mon, int(m.group(2)), today))
        w = _blank(w, m.start(), m.end())
    for m in _RE_NUM_RANGE.finditer(w):
        year = int(m.group(4)) if m.group(4) else None
        mon = int(m.group(3))
        if 1 <= mon <= 12:
            add(m.start(), _mk_date(year, mon, int(m.group(1)), today))
            add(m.start() + 1, _mk_date(year, mon, int(m.group(2)), today))
            w = _blank(w, m.start(), m.end())
    for m in _RE_NUM.finditer(w):
        if _RE_NOT_DATE_AFTER.match(w, m.end()) or _RE_NOT_DATE_BEFORE.search(w[: m.start()]):
            continue
        day, mon = int(m.group(1)), int(m.group(2))
        if not (1 <= mon <= 12 and 1 <= day <= 31):
            continue
        add(m.start(), _mk_date(int(m.group(3)) if m.group(3) else None, mon, day, today))
        w = _blank(w, m.start(), m.end())

    # relative expressions
    m = _RE_NEXT_WEEKEND.search(w)
    if m:
        f.rel_start, f.rel_end = _weekend(today, nxt=True)
        w = _blank(w, m.start(), m.end())
    else:
        m = _RE_THIS_WEEKEND.search(w)
        if m:
            f.rel_start, f.rel_end = _weekend(today, nxt=False)
            w = _blank(w, m.start(), m.end())
    m = _RE_NEXT_WEEK.search(w)
    if m:
        if f.rel_start is None:
            f.rel_start = today + timedelta(days=(6 - today.weekday()) % 7 or 7)  # next Sunday
        w = _blank(w, m.start(), m.end())
    for m in _RE_IN_OFFSET.finditer(w):
        if f.rel_start is None:
            if m.group(1):
                n, unit = int(m.group(1)), m.group(2).lower()
            else:
                word = re.sub(r"\s+", " ", m.group(3).lower())
                n, unit = {"יומיים": (2, "יום"), "שבועיים": (2, "שבוע"), "חודשיים": (2, "חודש"), "שבוע": (1, "שבוע"),
                           "חודש": (1, "חודש"), "a week": (1, "week"), "a month": (1, "month"),
                           "a fortnight": (2, "week"), "a couple of weeks": (2, "week")}[word]
            if unit.startswith(("יום", "ימים", "day")):
                delta = n
            elif unit.startswith(("שבוע", "week")):
                delta = 7 * n
            else:
                delta = 30 * n
            f.rel_start = today + timedelta(days=delta)
        w = _blank(w, m.start(), m.end())
    for regex, delta in ((_RE_DAY_AFTER, 2), (_RE_TOMORROW, 1), (_RE_TODAY, 0)):
        m = regex.search(w)
        if m:
            if f.rel_start is None:
                f.rel_start = today + timedelta(days=delta)
            w = _blank(w, m.start(), m.end())

    # month without a day ("בדצמבר", "in August")
    m = _RE_HE_MONTH_ONLY.search(w) or _RE_EN_MONTH_ONLY.search(w)
    if m:
        f.month_hint = HE_MONTHS.get(m.group(1)) or EN_MONTHS.get(m.group(1).lower())

    # durations
    m = _RE_ONE_NIGHT.search(w)
    if m:
        f.nights = 1
        w = _blank(w, m.start(), m.end())
    m = _RE_NIGHTS.search(w)
    if m:
        f.nights = int(m.group(1) or m.group(2))
        w = _blank(w, m.start(), m.end())
    m = _RE_TWO_WEEKS.search(w)
    if m:
        f.nights = f.nights or 14
        w = _blank(w, m.start(), m.end())
    m = _RE_WEEKS_N.search(w)
    if m:
        f.nights = f.nights or 7 * int(m.group(1))
        w = _blank(w, m.start(), m.end())
    m = _RE_ONE_WEEK.search(w)
    if m:
        f.nights = f.nights or 7
        w = _blank(w, m.start(), m.end())
    m = _RE_TWO_DAYS.search(w)
    if m:
        f.days = 2
        w = _blank(w, m.start(), m.end())
    m = _RE_DAYS.search(w)
    if m:
        f.days = int(m.group(1))
        w = _blank(w, m.start(), m.end())
    return f, w


def _weekday_date(w0: str, today: date) -> tuple[date | None, tuple[int, int] | None]:
    m = _RE_WEEKDAY.search(w0)
    if not m:
        return None, None
    target = HE_WEEKDAYS[m.group(1)] if m.group(1) else 5
    delta = (target - today.weekday()) % 7 or 7
    return today + timedelta(days=delta), (m.start(), m.end())


# ----------------------------------------------------------- travellers ----

_RE_DRIVER = re.compile(r"נהג(?:ת)?\s+(?:בן|בת|בגיל)\s+(\d{2})|driver(?:'s)?\s+(?:age\s*:?\s*|aged\s+|is\s+)?(\d{2})", re.IGNORECASE)
_RE_ADULTS = re.compile(r"(?<!\d)(\d{1,2})\s*(?:מבוגרים|מבוגרות|מבוגר|מבוגרת|adults?|grown[- ]?ups)", re.IGNORECASE)
_RE_ADULT_ONE = re.compile(rf"(?<![{HEB}])(?:מבוגר|מבוגרת)\s+1(?!\d)")
_RE_KIDS = re.compile(rf"(?<!\d)(\d{{1,2}})\s*(?:ילדים|ילדות|ילד|ילדה|kids?|children|child)(?![{HEB}])", re.IGNORECASE)
_RE_KID_SINGLE = re.compile(rf"(?<![{HEB}])(?:ו|ועם\s+|עם\s+)?(?:ילד|ילדה|הילד|הילדה|הבן|הבת)(?![{HEB}])|\b(?:a|our|my)\s+(?:child|kid|son|daughter)\b",
                            re.IGNORECASE)
_RE_KIDS_UNKNOWN = re.compile(rf"(?<![{HEB}])(?:ו|ה|וה|עם\s+ה?|ועם\s+ה?)?(?:ילדים|ילדות)(?![{HEB}])|\b(?:the\s+)?(?:kids|children)\b",
                              re.IGNORECASE)
_RE_INFANTS = re.compile(rf"(?<!\d)(\d)\s*(?:תינוקות|תינוק|תינוקת|infants?|babies|baby)(?![{HEB}])", re.IGNORECASE)
_RE_INFANT_SINGLE = re.compile(rf"(?<![{HEB}])(?:ו|ועם\s+|עם\s+|וה|ה)?(?:תינוק|תינוקת)(?![{HEB}])|\b(?:a|an|our|my)\s+(?:baby|infant)\b",
                               re.IGNORECASE)
_AGE_LIST = r"(\d{1,2}(?:\s*(?:,|ו-?|and|&|-)\s*\d{1,2})*)"
_RE_AGES = re.compile(rf"(?<![{HEB}])(?:בני|בנות|בגילאי|בגילים|בגילאים|גילאי|גילים|בגיל|בן|בת)\s*:?\s*{_AGE_LIST}"
                      rf"|\b(?:aged|ages?|age)\s*:?\s*{_AGE_LIST}", re.IGNORECASE)
_RE_AGES_WORDS = re.compile(rf"(?<![{HEB}])(?:בן|בת)\s+(שנתיים|שנה|חצי\s+שנה)(?![{HEB}])")
_RE_AGES_PAREN = re.compile(r"(?:ילדים|kids|children)\s*\(\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*\)", re.IGNORECASE)
_RE_COUPLE = re.compile(
    rf"(?<![{HEB}])(?:אני\s+ו(?:אשתי|בעלי|בת\s+הזוג|בן\s+הזוג|בת\s+זוגי|בן\s+זוגי|החבר|החברה|חברתי|חברי)|(?:אשתי|בעלי)\s+ואני|"
    rf"זוג(?![{HEB}])|לזוג(?![{HEB}])|לשניים|זוגית)"
    r"|\b(?:me and my (?:wife|husband|partner|girlfriend|boyfriend)|my (?:wife|husband|partner) and (?:i|me)|a couple|for two)\b",
    re.IGNORECASE,
)
_RE_SPOUSE = re.compile(rf"(?<![{HEB}])ו?(?:אשתי|בעלי|בת\s+הזוג|בן\s+הזוג|בת\s+זוגי|בן\s+זוגי)(?![{HEB}])|\bmy (?:wife|husband|partner)\b",
                        re.IGNORECASE)
_RE_SOLO = re.compile(rf"(?<![{HEB}])(?:לבד|אני\s+לבד|רק\s+אני|אדם\s+1|נוסע\s+1|נוסעת\s+1)(?![{HEB}])|\b(?:solo|just me|by myself|alone)\b",
                      re.IGNORECASE)
_RE_FAMILY_OF = re.compile(r"משפחה\s+של\s+(\d{1,2})|(\d{1,2})\s+נפשות|family\s+of\s+(\d{1,2})", re.IGNORECASE)
_RE_PEOPLE = re.compile(rf"(?<!\d)(\d{{1,2}})\s*(?:אנשים|נוסעים|נוסעות|people|persons|travell?ers|pax)(?![{HEB}])", re.IGNORECASE)


def _ages(s: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d{1,2}", s)]


def find_travellers(w: str, slots: Slots) -> str:
    m = _RE_DRIVER.search(w)
    if m:
        age = int(m.group(1) or m.group(2))
        if 18 <= age <= 99:
            slots.driver_age = age
        w = _blank(w, m.start(), m.end())

    adults = [int(m.group(1)) for m in _RE_ADULTS.finditer(w)]
    if adults:
        slots.adults = sum(adults)
    elif _RE_ADULT_ONE.search(w):
        slots.adults = 1

    ages: list[int] = []
    for m in _RE_AGES_PAREN.finditer(w):
        ages.extend(_ages(m.group(1)))
        w = _blank(w, m.start(), m.end())
    for m in _RE_AGES_WORDS.finditer(w):
        ages.append({"שנה": 1, "שנתיים": 2}.get(m.group(1), 0))
        w = _blank(w, m.start(), m.end())
    for m in _RE_AGES.finditer(w):
        ages.extend(_ages(m.group(1) or m.group(2)))
        w = _blank(w, m.start(), m.end())
    ages = [a for a in ages if 0 <= a <= 17]

    infants_count = sum(int(m.group(1)) for m in _RE_INFANTS.finditer(w))
    if not infants_count and _RE_INFANT_SINGLE.search(w):
        infants_count = 1
    if infants_count:
        slots.infants = infants_count

    counts = [int(m.group(1)) for m in _RE_KIDS.finditer(w)]
    kids = sum(counts)
    if not counts:
        singles = len(_RE_KID_SINGLE.findall(w))
        kids = max(singles, len([a for a in ages if a >= 2]) if not singles else singles)
    if kids or ages:
        slots.children_count = max(kids, len(ages)) if not infants_count else max(kids, len([a for a in ages if a >= 2]))
    elif _RE_KIDS_UNKNOWN.search(w):
        slots.children_unknown = True
    if ages:
        slots.children_ages = ages

    m = _RE_FAMILY_OF.search(w)
    if m:
        slots.family_size = int(m.group(1) or m.group(2) or m.group(3))
    if slots.adults is None:
        if _RE_COUPLE.search(w) or _RE_SPOUSE.search(w):
            slots.adults = 2
        elif _RE_SOLO.search(w):
            slots.adults = 1
        else:
            m = _RE_PEOPLE.search(w)
            if m and not (slots.children_count or slots.children_unknown or slots.infants):
                slots.adults = int(m.group(1))
            elif m:
                slots.family_size = int(m.group(1))
    return w


# --------------------------------------------------------- preferences ----

_FLAG_PATTERNS: list[tuple[str, Any, re.Pattern[str]]] = [
    ("cabin", "business", re.compile(r"מחלקת\s+עסקים|עסקים|ביזנס|\bbusiness(?:\s+class)?\b", re.IGNORECASE)),
    ("cabin", "first", re.compile(r"מחלקה\s+ראשונה|\bfirst\s+class\b", re.IGNORECASE)),
    ("cabin", "premium_economy", re.compile(r"פרימיום|\bpremium\s+economy\b", re.IGNORECASE)),
    ("cabin", "economy", re.compile(r"מחלקת\s+תיירים|אקונומי|\beconomy\b", re.IGNORECASE)),
    ("max_stops", 0, re.compile(rf"ישירה|ישירות|(?<![{HEB}])ישיר(?![{HEB}])|(?:בלי|ללא)\s+(?:עצירות|עצירה|קונקשן|חניות\s+ביניים)|"
                                r"\bdirect\b|\bnon-?stop\b", re.IGNORECASE)),
    ("max_stops", 1, re.compile(r"עד\s+עצירה\s+(?:אחת|1)|\b(?:max(?:imum)?|up\s+to|at\s+most)\s+(?:1|one)\s+stop\b", re.IGNORECASE)),
    ("board", "all_inclusive", re.compile(r"הכל\s+כלול|הכול\s+כלול|אול\s+אינקלוסיב|\ball[- ]inclusive\b", re.IGNORECASE)),
    ("board", "half_board", re.compile(r"חצי\s+פנסיון|\bhalf[- ]board\b", re.IGNORECASE)),
    ("board", "breakfast", re.compile(r"ארוחת\s+בוקר|ארוחות\s+בוקר|\bbreakfast\b|\bB&B\b", re.IGNORECASE)),
    ("free_cancellation", True, re.compile(r"ביטול\s+(?:חינם|ללא\s+עלות|בחינם)|\bfree\s+cancell?ation\b|\brefundable\b",
                                           re.IGNORECASE)),
    ("kosher", True, re.compile(rf"(?<![{HEB}])(?:כשר|כשרה|כשרות|אוכל\s+כשר)(?![{HEB}])|\bkosher\b", re.IGNORECASE)),
    ("accessible", True, re.compile(rf"(?<![{HEB}])(?:נגיש|נגישה|נגישים|נגישות)(?![{HEB}])|כיס(?:א|ה)\s+גלגלים|\bwheelchair\b|"
                                    r"\baccessib(?:le|ility)\b", re.IGNORECASE)),
    ("transmission", "automatic", re.compile(r"אוטומט|\bautomatic\b|\bauto\s+transmission\b", re.IGNORECASE)),
    ("transmission", "manual", re.compile(rf"(?<![{HEB}])(?:ידני|גיר\s+ידני|הילוכים)(?![{HEB}])|\bmanual\b|\bstick\s*shift\b",
                                          re.IGNORECASE)),
    ("car_class", "suv", re.compile(r"\bSUV\b|ג'יפ|גיפ|\bjeep\b", re.IGNORECASE)),
    ("car_class", "van", re.compile(rf"מיני\s*ואן|(?<![{HEB}])ואן(?![{HEB}])|\bmini-?van\b|\bvan\b", re.IGNORECASE)),
    ("car_class", "premium", re.compile(r"רכב\s+(?:יוקרה|מנהלים)|\bluxury\s+car\b|\bpremium\s+car\b", re.IGNORECASE)),
    ("car_class", "compact", re.compile(r"קומפקטי|\bcompact\b", re.IGNORECASE)),
    ("one_way", True, re.compile(r"כיוון\s+אחד|הלוך\s+בלבד|רק\s+הלוך|\bone[- ]way\b", re.IGNORECASE)),
    ("round_trip", True, re.compile(rf"הלוך\s*-?\s*(?:ו)?חזור|הלוך\s+ושוב|(?<![{HEB}])(?:ו)?(?:ב)?חזרה(?![{HEB}])|\bround[- ]trip\b|"
                                    r"\breturn\s+flight\b|\band\s+back\b", re.IGNORECASE)),
    ("departure_window", "morning", re.compile(rf"(?<![{HEB}])בבוקר(?![{HEB}])|\bmorning\b", re.IGNORECASE)),
    ("departure_window", "afternoon", re.compile(r"אחר\s+הצהריים|אחה\"צ|בצהריים|\bafternoon\b", re.IGNORECASE)),
    ("departure_window", "evening", re.compile(rf"(?<![{HEB}])בערב(?![{HEB}])|\bevening\b", re.IGNORECASE)),
    ("departure_window", "night", re.compile(r"טיסת\s+לילה|טיסה\s+לילית|\bred[- ]eye\b|\bnight\s+flight\b", re.IGNORECASE)),
    ("language", "he", re.compile(r"בעברית|דובר(?:י|ת)?\s+עברית|\bin\s+hebrew\b|\bhebrew[- ]speaking\b", re.IGNORECASE)),
    ("language", "en", re.compile(r"באנגלית|\bin\s+english\b", re.IGNORECASE)),
    ("near_airport", True, re.compile(r"בשדה|משדה|שדה\s+התעופה|נמל\s+התעופה|בנתב\"ג|\bairport\b", re.IGNORECASE)),
]
_RE_STARS = re.compile(r"(?<!\d)([1-5])\s*(?:כוכבים|כוכב|stars?|\*|★)", re.IGNORECASE)
_RE_SEATS = re.compile(rf"(?<!\d)([2-9])\s*(?:מקומות|מושבים|seats?|seater)(?![{HEB}])", re.IGNORECASE)
_RE_ROOMS = re.compile(rf"(?<!\d)([1-5])\s*(?:חדרים|חדר(?![{HEB}])|rooms?)", re.IGNORECASE)
_RE_FLEX = re.compile(r"(?:±|\+-|\+/-|פלוס\s+מינוס)\s*(\d)|(גמיש|גמישים|גמישה|\bflexible\b)", re.IGNORECASE)
_RE_BUDGET_WORD = re.compile(r"תקציב|עד|לכל\s+היותר|מקסימום|לא\s+יותר\s+מ|פחות\s+מ|\bbudget\b|\bunder\b|\bup\s+to\b|\bmax\b|"
                             r"\bmaximum\b|\bless\s+than\b|\bbelow\b", re.IGNORECASE)
_RE_BUDGET_PLAIN = re.compile(r"(?:תקציב(?:\s+של)?|budget(?:\s+of)?)\s*:?\s*(?:עד\s+|up\s+to\s+)?(\d{1,3}(?:,\d{3})+|\d{3,6})(?![\d.,])",
                              re.IGNORECASE)
_RE_PER_NIGHT = re.compile(r"^\s*(?:ל)?(?:לילה|ללילה|per\s+night|a\s+night|/\s*night)", re.IGNORECASE)
_RE_PER_PERSON = re.compile(r"^\s*(?:לאדם|לנוסע|לכל\s+אחד|per\s+person|pp|each)", re.IGNORECASE)


def find_preferences(t: str, slots: Slots) -> None:
    for name, value, pattern in _FLAG_PATTERNS:
        if getattr(slots, name) is None and pattern.search(t):
            setattr(slots, name, value)
    if slots.one_way:
        slots.round_trip = None
    m = _RE_STARS.search(t)
    if m:
        slots.min_stars = int(m.group(1))
    m = _RE_SEATS.search(t)
    if m:
        slots.min_seats = int(m.group(1))
    m = _RE_ROOMS.search(t)
    if m:
        slots.rooms = int(m.group(1))
    m = _RE_FLEX.search(t)
    if m:
        slots.flex_days = min(3, int(m.group(1))) if m.group(1) else 2
    interests = [k for k, rx in _INTEREST_RES.items() if rx.search(t)]
    if interests:
        slots.interests = interests


def find_budget(t: str, slots: Slots) -> str:
    """Money mention near a budget word (else the first one). Returns text with money blanked."""
    mentions = extract_money(t)
    chosen = None
    for m in mentions:
        if _RE_BUDGET_WORD.search(t[max(0, m.start - 25):m.start]):
            chosen = m
            break
    if chosen is None and mentions:
        chosen = mentions[0]
    if chosen is not None:
        slots.budget, slots.budget_currency = chosen.amount, chosen.currency
        after = t[chosen.end:chosen.end + 20]
        slots.budget_basis = "night" if _RE_PER_NIGHT.match(after) else "person" if _RE_PER_PERSON.match(after) else "total"
    else:
        m = _RE_BUDGET_PLAIN.search(t)
        if m:
            slots.budget = Decimal(m.group(1).replace(",", ""))
            slots.budget_currency = "ILS"
            slots.budget_basis = "total"
            t = _blank(t, m.start(), m.end())
    for m in mentions:
        t = _blank(t, m.start, m.end)
    return t


# --------------------------------------------------------------- slots ----


def extract_slots(text: str, today: date | None = None) -> Slots:
    today = today or date.today()
    t = normalize(text)
    slots = Slots()
    cats = detect_categories(t)
    if cats:
        slots.category = cats[0]
    find_preferences(t, slots)
    w0 = find_budget(t, slots)

    places = find_places(w0)
    _assign_places(places, slots)
    if slots.destination is None:
        slots.country_hint = find_country(w0)

    weekday, wd_span = _weekday_date(w0, today)
    if wd_span:
        w0 = _blank(w0, *wd_span)
    w = _replace_number_words(w0)
    w = find_travellers(w, slots)
    found, _ = find_dates(w, today)
    explicit = [(d, has_year) for _, d, has_year in sorted(found.dates, key=lambda x: x[0])]
    start = explicit[0][0] if explicit else (found.rel_start or weekday)
    end = None
    if len(explicit) >= 2:
        end, end_has_year = explicit[1]
        while not end_has_year and start and end < start:
            end = date(end.year + 1, end.month, end.day)
    elif not explicit and found.rel_end is not None:
        end = found.rel_end
    if found.nights is not None and start is not None and len(explicit) < 2:
        end = start + timedelta(days=found.nights)
    slots.start_date, slots.end_date = start, end
    slots.month_hint = found.month_hint if start is None else None
    slots.nights, slots.days = found.nights, found.days
    return slots


def _assign_places(places: list[PlaceHit], slots: Slots) -> None:
    if not places:
        return
    origins = [p for p in places if p.role == "origin"]
    dests = [p for p in places if p.role in ("destination", "in")]
    neutral = [p for p in places if p.role is None]
    origin = origins[0] if origins else None
    dest = dests[0] if dests else None
    if origin is None and dest is None:
        if len(neutral) >= 2:
            origin, dest = neutral[0], neutral[1]
        elif neutral:
            dest = neutral[0]
    elif dest is None:
        dest = next((p for p in neutral if p.city.code != origin.city.code), None)  # type: ignore[union-attr]
    elif origin is None:
        origin = next((p for p in neutral if p.city.code != dest.city.code), None)
    if origin is not None:
        slots.origin = origin.airport or origin.city.airports[0]
        slots.origin_explicit = True
    if dest is not None:
        slots.destination = dest.city.code
        slots.destination_airport = dest.airport


# -------------------------------------------------------------- building ----

QUESTIONS = {
    "category": "מה לחפש — טיסות, מלון, רכב או אטרקציות?",
    "flight.destination": "לאן טסים?",
    "hotel.destination": "באיזו עיר לחפש מלון?",
    "activity.destination": "באיזו עיר לחפש אטרקציות?",
    "car.pickup_location": "איפה לאסוף את הרכב (עיר או שדה תעופה)?",
    "origin": "מאיפה יוצאים?",
    "depart_date": "באיזה תאריך יוצאים?",
    "return_date": "מתי חוזרים?",
    "check_in": "מאיזה תאריך ולכמה לילות?",
    "check_out": "לכמה לילות?",
    "pickup_at": "מאיזה תאריך עד איזה תאריך צריך את הרכב?",
    "dropoff_at": "עד איזה תאריך צריך את הרכב?",
    "date_from": "באילו תאריכים תהיו שם?",
    "children_ages": "בני כמה הילדים?",
    "travelers": "כמה מבוגרים וכמה ילדים (ובני כמה)?",
}
ORDER = {
    "flight": ["destination", "origin", "depart_date", "return_date", "travelers", "children_ages"],
    "hotel": ["destination", "check_in", "check_out", "travelers", "children_ages"],
    "car": ["pickup_location", "pickup_at", "dropoff_at"],
    "activity": ["destination", "date_from", "travelers", "children_ages"],
}
FIELD_HE = {"depart_date": "תאריך היציאה", "return_date": "תאריך החזרה", "check_in": "תאריך הכניסה",
            "check_out": "תאריך היציאה מהמלון", "pickup_at": "מועד האיסוף", "dropoff_at": "מועד ההחזרה",
            "date_from": "תאריך ההתחלה", "date_to": "תאריך הסיום"}


def _question(category: str | None, missing: str, slots: Slots) -> str:
    if missing == "destination" and slots.country_hint:
        examples = [c.name_he for c in CITIES.values() if c.country_he == slots.country_hint][:3]
        return f"לאיזו עיר ב{slots.country_hint}? למשל: {', '.join(examples)}"
    month = HE_MONTH_NAMES.get(slots.month_hint or 0)
    if month and missing == "depart_date":
        return f"באיזה תאריך ב{month} יוצאים?"
    if month and missing == "check_in":
        return f"מאיזה תאריך ב{month} ולכמה לילות?"
    if month and missing in ("date_from", "pickup_at"):
        return f"באילו תאריכים ב{month}?"
    return QUESTIONS.get(f"{category}.{missing}") or QUESTIONS.get(missing) or QUESTIONS["category"]


def _children(slots: Slots, assumptions: list[str]) -> tuple[list[int], list[str]]:
    """Children ages + missing markers (unknown count / unknown ages)."""
    missing: list[str] = []
    ages = list(slots.children_ages or [])
    infants = slots.infants or 0
    kids = slots.children_count or 0
    if infants:
        known_infants = [a for a in ages if a < 2]
        add = max(0, infants - len(known_infants))
        if add:
            ages.extend([1] * add)
            assumptions.append("הנחתי שהתינוק/ות בני שנה")
    older_known = len([a for a in ages if a >= 2])
    if kids > older_known:
        missing.append("children_ages")
    if slots.children_unknown and not kids and not ages:
        missing.append("travelers")
    return ages, missing


def _party(slots: Slots, category: str, assumptions: list[str]) -> tuple[int, list[int], list[str]]:
    ages, missing = _children(slots, assumptions)
    adults = slots.adults
    if slots.family_size and adults is None:
        known_kids = max(slots.children_count or 0, len(ages))
        if known_kids:
            adults = max(1, slots.family_size - known_kids)
        elif slots.family_size <= 2:
            adults = slots.family_size
        else:
            missing.append("travelers")
    elif slots.family_size and adults is not None:
        kids_needed = slots.family_size - adults - len(ages)
        if kids_needed > 0 and (slots.children_count or 0) < slots.family_size - adults:
            missing.append("children_ages")
    if adults is None:
        adults = 2 if (ages or slots.children_count or slots.children_unknown or category != "flight") else 1
        if category != "car":
            assumptions.append(f"לא צוין מספר המבוגרים — הנחתי {adults}")
    return adults, ages, list(dict.fromkeys(missing))


def _rooms(adults: int, ages: list[int], rooms: int | None) -> list[dict[str, Any]]:
    n = max(rooms or 1, math.ceil(adults / 4), math.ceil(len(ages) / 4) if ages else 1)
    n = max(1, min(n, 5, adults))
    out = [{"adults": 0, "children_ages": []} for _ in range(n)]
    for i in range(adults):
        out[i % n]["adults"] += 1
    for i, age in enumerate(ages):
        out[i % n]["children_ages"].append(age)
    return out


def _max_price(slots: Slots, nights: int | None, persons: int) -> tuple[Decimal | None, str | None]:
    if slots.budget is None:
        return None, None
    if slots.budget_basis == "night":
        if not nights:
            return None, None
        return slots.budget * nights, slots.budget_currency
    if slots.budget_basis == "person":
        return slots.budget * max(1, persons), slots.budget_currency
    return slots.budget, slots.budget_currency


def build_params(slots: Slots, today: date) -> tuple[dict[str, Any] | None, list[str], list[str]]:
    """Return (params dict | None, missing fields, assumptions)."""
    category = slots.category
    assumptions: list[str] = []
    if category is None:
        if slots.origin_explicit and slots.destination:
            category = "flight"
        else:
            return None, ["category"], assumptions
    missing: list[str] = []
    start, end = slots.start_date, slots.end_date
    nights = slots.nights
    if nights is None and slots.days:
        nights = max(1, slots.days - 1)

    if category == "flight":
        origin = slots.origin
        dest_airport = slots.destination_airport or (CITIES[slots.destination].airports[0] if slots.destination else None)
        if dest_airport is None:
            missing.append("destination")
        if origin is None:
            if dest_airport and CITIES.get(slots.destination or "") and slots.destination == "TLV":
                missing.append("origin")
            else:
                origin = "TLV"
                assumptions.append("הנחתי יציאה מנתב״ג (TLV)")
        if start is None:
            missing.append("depart_date")
        ret = None if slots.one_way else end
        if ret is None and not slots.one_way and start is not None and nights:
            ret = start + timedelta(days=nights)
        if ret is None and slots.round_trip and not slots.one_way:
            missing.append("return_date")
        adults, ages, pax_missing = _party(slots, category, assumptions)
        missing.extend(pax_missing)
        if missing:
            return None, _ordered(category, missing), assumptions
        max_price, currency = _max_price(slots, nights, adults + len(ages))
        params: dict[str, Any] = {
            "category": "flight", "origin": origin, "destination": dest_airport, "depart_date": start.isoformat(),
            "return_date": ret.isoformat() if ret else None, "adults": adults, "children_ages": ages,
        }
        if slots.cabin:
            params["cabin"] = slots.cabin
        if slots.max_stops is not None:
            params["max_stops"] = slots.max_stops
        if slots.flex_days is not None:
            params["flex_days"] = slots.flex_days
        if slots.departure_window:
            params["preferred_departure_window"] = slots.departure_window
        _apply_price(params, max_price, currency)
        return params, [], assumptions

    if category == "hotel":
        if slots.destination is None:
            missing.append("destination")
        if start is None:
            missing.append("check_in")
        check_out = end or (start + timedelta(days=nights) if start and nights else None)
        if start is not None and check_out is None:
            missing.append("check_out")
        adults, ages, pax_missing = _party(slots, category, assumptions)
        missing.extend(pax_missing)
        if missing:
            return None, _ordered(category, missing), assumptions
        n = (check_out - start).days if check_out and start else None
        max_price, currency = _max_price(slots, n, adults + len(ages))
        params = {
            "category": "hotel", "destination": CITIES[slots.destination].name_en, "check_in": start.isoformat(),
            "check_out": check_out.isoformat(), "rooms": _rooms(adults, ages, slots.rooms),
        }
        for key, value in (("min_stars", slots.min_stars), ("board", slots.board),
                           ("free_cancellation_only", slots.free_cancellation), ("kosher_preference", slots.kosher),
                           ("accessibility_required", slots.accessible)):
            if value is not None:
                params[key] = value
        if slots.budget_basis == "night" and not n:
            assumptions.append("תקציב ללילה לא הוחל — חסר מספר לילות")
        _apply_price(params, max_price, currency)
        return params, [], assumptions

    if category == "car":
        place = slots.destination_airport or slots.destination
        if place is None and slots.origin_explicit and slots.origin:
            place = slots.origin
        if place is None:
            missing.append("pickup_location")
        if start is None:
            missing.append("pickup_at")
        rental_days = slots.days or slots.nights
        drop = end or (start + timedelta(days=rental_days) if start and rental_days else None)
        if start is not None and drop is None:
            missing.append("dropoff_at")
        if missing:
            return None, _ordered(category, missing), assumptions
        pickup_code = place if len(place) == 3 and get_airport(place) else CITIES[place].airports[0]
        pickup_at = datetime.combine(start, time(10, 0))
        dropoff_at = datetime.combine(drop, time(10, 0)) if drop > start else datetime.combine(start, time(20, 0))
        assumptions.append("הנחתי איסוף והחזרה בשעה 10:00 בשדה התעופה הראשי")
        params = {"category": "car", "pickup_location": pickup_code, "pickup_at": pickup_at.isoformat(),
                  "dropoff_at": dropoff_at.isoformat()}
        for key, value in (("transmission", slots.transmission), ("car_class", slots.car_class),
                           ("min_seats", slots.min_seats), ("driver_age", slots.driver_age)):
            if value is not None:
                params[key] = value
        _apply_price(params, *_max_price(slots, (drop - start).days, 1))
        return params, [], assumptions

    # activity
    if slots.destination is None:
        missing.append("destination")
    if start is None:
        missing.append("date_from")
    adults, ages, pax_missing = _party(slots, "activity", assumptions)
    missing.extend(pax_missing)
    if missing:
        return None, _ordered("activity", missing), assumptions
    date_to = end or (start + timedelta(days=min(nights, 30)) if nights else start)
    params = {"category": "activity", "destination": CITIES[slots.destination].name_en, "date_from": start.isoformat(),
              "date_to": date_to.isoformat(), "adults": adults, "children_ages": ages}
    if slots.interests:
        params["interests"] = slots.interests
    if slots.accessible:
        params["accessibility_required"] = True
    if slots.language:
        params["language"] = slots.language
    _apply_price(params, *_max_price(slots, None, adults + len(ages)))
    return params, [], assumptions


def _apply_price(params: dict[str, Any], max_price: Decimal | None, currency: str | None) -> None:
    if max_price is not None and currency:
        params["max_price"] = format(max_price, "f")
        params["currency"] = currency


def _ordered(category: str, missing: list[str]) -> list[str]:
    order = ORDER.get(category, [])
    uniq = list(dict.fromkeys(missing))
    return sorted(uniq, key=lambda f: order.index(f) if f in order else len(order))


def _humanize_error(message: str) -> str:
    for key, label in FIELD_HE.items():
        message = message.replace(f"{key}: ", f"{label}: ")
    return message


def resolve(slots: Slots, today: date | None = None) -> ParseResult:
    """Turn merged slots into validated params or one clarifying question."""
    today = today or date.today()
    params, missing, assumptions = build_params(slots, today)
    category = slots.category or (params or {}).get("category")
    if params is None:
        question = _question(category, missing[0], slots) if missing else None
        return ParseResult(category=category, params=None, missing_fields=missing, clarifying_question=question,
                           understood=slots.to_dict(), assumptions=assumptions, slots=slots)
    try:
        model = parse_search_params(params, params["category"])
    except AppError as exc:
        msg = _humanize_error(exc.message)
        return ParseResult(category=category, params=None, missing_fields=["invalid_params"],
                           clarifying_question=f"{msg} — אפשר לתקן את הפרטים?", understood=slots.to_dict(),
                           assumptions=assumptions, errors=[msg], slots=slots)
    return ParseResult(category=params["category"], params=model.model_dump(mode="json"), missing_fields=[],
                       clarifying_question=None, understood=slots.to_dict(), assumptions=assumptions, slots=slots,
                       model=model)


def parse_intent(text: str, today: date | None = None, base: Slots | None = None) -> ParseResult:
    today = today or date.today()
    slots = extract_slots(text, today)
    if base is not None:
        slots = base.merged_with(slots)
    return resolve(slots, today)


def parse_conversation(messages: list[str], today: date | None = None, base: Slots | None = None) -> ParseResult:
    """Slot-fill across several user messages (oldest first); newer mentions win."""
    today = today or date.today()
    merged = base or Slots()
    for msg in messages:
        merged = merged.merged_with(extract_slots(msg, today))
    return resolve(merged, today)
