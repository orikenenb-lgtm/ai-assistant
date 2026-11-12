"""Grounding checks for model output.

1. **Booking claims** — the assistant can never book or pay, so any sentence
   claiming it did ("הזמנתי", "booked for you", "booking confirmed", ...) is
   removed (negated forms such as "לא הזמנתי" are kept).
2. **Money claims** — every money mention in the final text (₪/ש"ח/ILS, $/USD,
   €/EUR, £/GBP, other ISO codes; Hebrew & English formats with thousands
   separators; ranges) must match, within 0.5% and in the same currency, an
   amount present in this turn's tool results (totals, per-night/person/day,
   price components, deposits, fees) or stated by the user. Unverified amounts
   are replaced with ``[מחיר הוסר — לא אומת]``. Bare numbers in a sentence that
   talks about price (no currency) are checked against every allowed amount.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.core.money import SUPPORTED_CURRENCIES
from app.schemas.offers import CanonicalOffer

REMOVED_PRICE = "[מחיר הוסר — לא אומת]"
TOLERANCE = Decimal("0.005")

Amount = tuple[Decimal, str]

# ------------------------------------------------------------ currencies ----

_SHEKEL = r"(?:₪|ש\s?[\"״׳']{1,2}\s?ח|שח(?![֐-׿])|שקל(?:ים)?|ILS|NIS)"
_DOLLAR = r"(?:US\$|\$|דולר(?:ים)?|USD)"
_EURO = r"(?:€|יורו|אירו|EUR)"
_POUND = r"(?:£|ליש\s?[\"״]\s?ט|פאונד|לירות\s+שטרלינג|GBP)"
_YEN = r"(?:¥|JPY|ין(?![֐-׿]))"
_ISO = r"(?:" + "|".join(sorted(c for c in SUPPORTED_CURRENCIES if c not in {"ILS", "USD", "EUR", "GBP", "JPY"})) + r")"

_CURRENCY_GROUPS = (("ILS", _SHEKEL), ("USD", _DOLLAR), ("EUR", _EURO), ("GBP", _POUND), ("JPY", _YEN), ("ISO", _ISO))
CURRENCY_RE = "(?:" + "|".join(f"(?P<c_{name}>{pat})" for name, pat in _CURRENCY_GROUPS) + ")"

_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?"
_PREFIX_CURRENCY = re.compile(
    "(?:" + "|".join(f"(?P<p_{name}>{pat})" for name, pat in _CURRENCY_GROUPS) + r")\s?(?P<amount>" + _NUM + r")(?![\d,.]*\d)"
)
_SUFFIX_CURRENCY = re.compile(
    r"(?<![\d.,])(?:(?P<first>" + _NUM + r")\s*(?:-|–|עד|to|ל-?)\s*)?(?P<amount>" + _NUM + r")\s?"
    "(?:" + "|".join(f"(?P<s_{name}>{pat})" for name, pat in _CURRENCY_GROUPS) + r")(?![A-Za-z])"
)


@dataclass(frozen=True)
class MoneyMention:
    start: int
    end: int
    amount: Decimal
    currency: str
    text: str


def _currency_from(match: re.Match[str], prefix: str) -> str | None:
    for name, _ in _CURRENCY_GROUPS:
        value = match.group(f"{prefix}_{name}")
        if value:
            return value.strip().upper() if name == "ISO" else name
    return None


def _to_decimal(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", ""))
    except InvalidOperation:
        return None


def extract_money(text: str) -> list[MoneyMention]:
    """Find money mentions (amount + currency) in Hebrew/English text."""
    found: list[MoneyMention] = []
    taken: list[tuple[int, int]] = []

    def overlaps(a: int, b: int) -> bool:
        return any(a < e and s < b for s, e in taken)

    # Suffix form first ("1,200 ₪" is the common Hebrew order), so "1,200 ₪ 2 מבוגרים"
    # is never read as "₪ 2".
    for m in _SUFFIX_CURRENCY.finditer(text):
        cur = _currency_from(m, "s")
        amount = _to_decimal(m.group("amount"))
        if cur is None or amount is None:
            continue
        if m.group("first"):
            first = _to_decimal(m.group("first"))
            if first is not None:
                found.append(MoneyMention(m.start("first"), m.end("first"), first, cur, m.group("first")))
        found.append(MoneyMention(m.start("amount"), m.end(), amount, cur, text[m.start("amount"):m.end()]))
        taken.append((m.start(), m.end()))
    for m in _PREFIX_CURRENCY.finditer(text):
        amount = _to_decimal(m.group("amount"))
        cur = _currency_from(m, "p")
        if amount is None or cur is None or overlaps(m.start(), m.end()):
            continue
        found.append(MoneyMention(m.start(), m.end(), amount, cur, m.group(0)))
        taken.append((m.start(), m.end()))
    found.sort(key=lambda x: x.start)
    return found


# ------------------------------------------------------- allowed amounts ----


def amounts_from_offer(offer: CanonicalOffer) -> list[Amount]:
    p = offer.price
    out: list[Amount] = [(p.total.amount, p.total.currency)]
    for extra in (p.per_night, p.per_person, p.per_day):
        if extra is not None:
            out.append((extra.amount, extra.currency))
    for comp in p.components:
        out.append((comp.amount.amount, comp.amount.currency))
    c = offer.cancellation
    if c.change_fee is not None:
        out.append((c.change_fee.amount, c.change_fee.currency))
    deposit = getattr(offer.details, "deposit", None)
    if deposit is not None:
        out.append((deposit.amount, deposit.currency))
    return out


def amounts_from_offers(offers: Iterable[CanonicalOffer]) -> list[Amount]:
    out: list[Amount] = []
    for o in offers:
        out.extend(amounts_from_offer(o))
    return out


def amounts_from_text(text: str) -> list[Amount]:
    return [(m.amount, m.currency) for m in extract_money(text)]


def _matches(value: Decimal, currency: str | None, allowed: Iterable[Amount]) -> bool:
    for amount, cur in allowed:
        if currency is not None and cur != currency:
            continue
        if amount == 0:
            if value == 0:
                return True
            continue
        if abs(value - amount) <= abs(amount) * TOLERANCE:
            return True
    return False


# --------------------------------------------------------- booking claims ----

_NEGATION = re.compile(r"(?:\bלא\b|\bאינני\b|\bאיני\b|\bאין\b|\bnot\b|n't\b|\bnever\b|\bcannot\b|\bunable\b|\bלא\s+ניתן\b)\s*$",
                       re.IGNORECASE)
_BOOKING_CLAIMS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"הזמנתי",
        r"(?<![֐-׿])הזמנו\s+(?:לכם|עבורכם|את)",
        r"שריינתי",
        r"שילמתי",
        r"ביצעתי\s+(?:את\s+)?(?:ה)?(?:הזמנה|תשלום|רכישה)",
        r"רכשתי",
        r"סגרתי\s+(?:לכם|עבורכם|את\s+ה)",
        r"(?:ה)?הזמנה(?:\s+שלכם)?\s+(?:אושרה|מאושרת|בוצעה|הושלמה|נקלטה)",
        r"(?:ה)?תשלום\s+(?:אושר|בוצע|הושלם|עבר)",
        r"(?:ה)?חיוב\s+(?:בוצע|אושר)",
        r"(?:ה)?כרטיסים\s+(?:הוזמנו|נרכשו|שמורים)",
        r"מספר\s+(?:ה)?אישור",
        r"אישור\s+(?:ה)?הזמנה\s*[:#]",
        r"\bI(?:'ve|\s+have)?\s+(?:just\s+)?(?:booked|reserved|purchased|paid)\b",
        r"\b(?:booked|reserved)\s+(?:it\s+|this\s+|them\s+)?for\s+you\b",
        r"\b(?:booking|reservation|order|payment|purchase)\s+(?:is\s+|has\s+been\s+|was\s+)?(?:confirmed|complete[d]?|processed)\b",
        r"\bconfirmed\s+(?:your|the)\s+(?:booking|reservation|order|flight|hotel|tickets?)\b",
        r"\bconfirmation\s+(?:number|code)\b",
        r"\btickets?\s+(?:are|is|have\s+been|has\s+been)\s+(?:booked|issued|purchased)\b",
    )
]


def _is_booking_claim(sentence: str) -> bool:
    for pattern in _BOOKING_CLAIMS:
        for m in pattern.finditer(sentence):
            if not _NEGATION.search(sentence[: m.start()][-25:]):
                return True
    return False


# --------------------------------------------------------- bare amounts ----

_PRICE_WORDS = re.compile(r"מחיר|עול(?:ה|ות|ים)|עלות|תשלום|לתשלום|בסך|סה[\"״]כ|price|cost|costs|total|per\s+night|ללילה|לאדם",
                          re.IGNORECASE)
_BARE_NUMBER = re.compile(r"(?<![A-Za-z\d.,:/])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{3,}(?:\.\d{1,2})?)(?![\d.,:/]*\d)(?![A-Za-z])")
_UNIT_AFTER = re.compile(r"\s*(?:%|ק[\"״]מ|km|קילומטר|דקות|דק'|minutes|שעות|hours|לילות|nights|ימים|days|מטר|m\b|כוכבים|stars|"
                         r"מבוגרים|ילדים|adults|children|reviews|ביקורות|חוות\s+דעת|נוסעים|מושבים|seats)", re.IGNORECASE)


def _bare_amount_spans(sentence: str, money_spans: list[tuple[int, int]]) -> list[tuple[int, int, Decimal]]:
    if not _PRICE_WORDS.search(sentence):
        return []
    out: list[tuple[int, int, Decimal]] = []
    for m in _BARE_NUMBER.finditer(sentence):
        if any(m.start() < e and s < m.end() for s, e in money_spans):
            continue
        if _UNIT_AFTER.match(sentence, m.end()):
            continue
        raw = m.group(1)
        value = _to_decimal(raw)
        if value is None:
            continue
        if "," not in raw and "." not in raw and 1900 <= value <= 2100:
            continue  # a year
        out.append((m.start(), m.end(), value))
    return out


# ------------------------------------------------------------- grounding ----


@dataclass
class GroundingResult:
    text: str
    ok: bool = True
    removed_claims: list[str] = field(default_factory=list)
    booking_claims_removed: int = 0
    prices_removed: int = 0
    prices_checked: int = 0


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")


def _clip(s: str, n: int = 300) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def ground_text(text: str, allowed: Iterable[Amount]) -> GroundingResult:
    allowed_list = list(allowed)
    result = GroundingResult(text="")
    out_lines: list[str] = []
    for line in (text or "").split("\n"):
        kept: list[str] = []
        for sentence in _SENTENCE_SPLIT.split(line):
            if not sentence.strip():
                kept.append(sentence)
                continue
            if _is_booking_claim(sentence):
                result.removed_claims.append(_clip(sentence))
                result.booking_claims_removed += 1
                continue
            kept.append(_ground_sentence(sentence, allowed_list, result))
        out_lines.append(" ".join(s for s in kept if s is not None).rstrip())
    cleaned = "\n".join(out_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    result.text = cleaned
    result.ok = not result.removed_claims
    return result


def _ground_sentence(sentence: str, allowed: list[Amount], result: GroundingResult) -> str:
    mentions = extract_money(sentence)
    replacements: list[tuple[int, int]] = []
    for m in mentions:
        result.prices_checked += 1
        if not _matches(m.amount, m.currency, allowed):
            replacements.append((m.start, m.end))
    spans = [(m.start, m.end) for m in mentions]
    for start, end, value in _bare_amount_spans(sentence, spans):
        result.prices_checked += 1
        if not _matches(value, None, allowed):
            replacements.append((start, end))
    if not replacements:
        return sentence
    result.removed_claims.append(_clip(sentence))
    result.prices_removed += len(replacements)
    out = sentence
    for start, end in sorted(replacements, reverse=True):
        out = out[:start] + REMOVED_PRICE + out[end:]
    return out
