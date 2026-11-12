"""Grounding checks for model output (T6). Errs on the side of REMOVING.

1. **Booking claims** — the assistant can never book or pay, so any sentence
   claiming a booking/reservation/payment happened ("הזמנתי", "ההזמנה שלך אושרה",
   "הטיסה הוזמנה", "המלון שוריין", "Your flight is booked", "I've reserved",
   "you're all set", ...) is removed. Negated statements ("לא ביצעתי הזמנה",
   "I can't book") are kept.
2. **Money claims** — every numeric run (digits with ``. , ' ’`` / NBSP separators,
   optional multiplier אלף/אלפים/K/מיליון/M) that is attached to a currency marker
   (₪, ש"ח, שקל, $, דולר, dollars, €, יורו, £, ¥, ISO codes; before or after, ranges
   inherit) is read in BOTH the thousands and the decimal interpretation
   ("1.200" -> 1200 or 1.2). It is kept only if one interpretation matches,
   within 0.5% and in the same currency, an amount present in this turn's tool
   results (totals, per-night/person/day, components, deposits, fees) or stated
   by the user; otherwise it is replaced with ``[מחיר הוסר — לא אומת]``.
3. **Bare numbers** (2+ digits, or with a multiplier) in a sentence that talks
   about price or contains a currency marker are checked against every allowed
   amount in any currency; units, times, dates, ages, ratings, flight numbers
   and years in date context are skipped.
4. **Numbers written as words** next to a currency ("אלף ומאתיים שקל",
   "two thousand dollars", "מאות דולרים"), or containing מאה/אלף/hundred/thousand
   in a price sentence, cannot be verified and are always removed.

5. **Market-wide superlatives** — the product may only claim "cheapest among the
   offers found in this search". A superlative followed by a market scope
   ("הזול ביותר בשוק", "הכי זול שיש", "cheapest on the market", "lowest price
   anywhere") has the scope rewritten to "מבין ההצעות שנמצאו בחיפוש זה" /
   "among the offers found in this search" (only when this turn has search
   results; otherwise the sentence is removed). Absolute claims with no honest
   rewrite ("אין זול מזה", "לא תמצאו זול יותר", "best price guaranteed",
   "unbeatable") remove the sentence. Scoped ("הזול ביותר מבין התוצאות") and
   negated/hedged ("לא בהכרח הזול ביותר בשוק") phrases are kept.

Invisible format characters (bidi marks, zero-width spaces) are stripped from the
model text first so they cannot be used to split a number from its currency.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.core.money import SUPPORTED_CURRENCIES
from app.schemas.offers import CanonicalOffer

REMOVED_PRICE = "[מחיר הוסר — לא אומת]"
TOLERANCE = Decimal("0.005")
ANY_CURRENCY = "*"  # an allowed amount whose currency is unknown (a bare number the user typed)

Amount = tuple[Decimal, str]

HEB = "\u0590-\u05ff"
_HW = rf"(?<![{HEB}])"  # Hebrew word start
_HE = rf"(?![{HEB}])"  # Hebrew word end
_LW = r"(?<![A-Za-z])"  # Latin word start (unlike \b, also matches right after a digit: "99USD")
_LE = r"(?![A-Za-z])"  # Latin word end

# ------------------------------------------------------------ currencies ----

_ISO_OTHERS = sorted(c for c in SUPPORTED_CURRENCIES if c not in {"ILS", "USD", "EUR", "GBP", "JPY"})
_CURRENCY_GROUPS: tuple[tuple[str, str], ...] = (
    ("ILS", rf"₪|{_HW}ש\s?[\"״׳']{{1,2}}\s?ח|{_HW}שח{_HE}|{_HW}שקל(?:ים)?{_HE}(?:\s+חדשים)?|{_LW}(?:ILS|NIS){_LE}"
            rf"|{_LW}(?i:shekels?|sheqels?|nis){_LE}"),
    ("USD", rf"US\$|\$|{_HW}דולר(?:ים)?{_HE}|{_LW}USD{_LE}|{_LW}(?i:dollars?|bucks|usd){_LE}"),
    ("EUR", rf"€|{_HW}(?:יורו|אירו){_HE}|{_LW}EUR{_LE}|{_LW}(?i:euros?|eur){_LE}"),
    ("GBP", rf"£|{_HW}ליש\s?[\"״]\s?ט|{_HW}פאונד(?:ים)?{_HE}|{_HW}לירות\s+שטרלינג|{_LW}GBP{_LE}"
            rf"|{_LW}(?i:pounds?(?:\s+sterling)?|quid|gbp){_LE}"),
    ("JPY", rf"¥|{_HW}ין{_HE}|{_LW}JPY{_LE}|{_LW}(?i:yen){_LE}"),
    ("ISO", rf"{_LW}(?:" + "|".join(_ISO_OTHERS) + rf"){_LE}"),
)
_CURRENCY = "(?:" + "|".join(f"(?P<c_{name}>{pat})" for name, pat in _CURRENCY_GROUPS) + ")"
_ANY_CURRENCY_RE = re.compile(_CURRENCY)
_CUR_AFTER = re.compile(rf"\s*-?\s*(?:(?:{_HW}של|(?i:\bof\b))\s+)?(?P<cur>{_CURRENCY})")
_CUR_BEFORE = re.compile(rf"(?P<cur>{_CURRENCY})\s*-?\s*$")

# ---------------------------------------------------------- numeric runs ----

_SEPS = ".,'’\u00a0\u202f"
_RUN = re.compile(r"\d+(?:[.,'’\u00a0\u202f]\d+)*")
_MULT = re.compile(
    rf"\s*-?\s*(?:(?P<k>{_HW}(?:אלף|אלפים|אלפי){_HE}|(?i:\b(?:thousand|grand)\b)|[kK](?![A-Za-z]))"
    rf"|(?P<m>{_HW}(?:מיליון|מליון|מיליונים){_HE}|(?i:\b(?:millions?|mn)\b)|M(?![A-Za-z])))"
)
# Range connectors: always ("1,000-1,500 ₪", "1,000 עד 1,500 ₪") / only after "בין|between" ("בין 1,000 ל-1,500 ₪").
_RANGE_GAP = re.compile(r"\s*(?:-|–|—|עד|או|to|or)\s*", re.IGNORECASE)
_RANGE_GAP_BETWEEN = re.compile(r"\s*(?:ל-?|ול-?|ו-?|and)\s*", re.IGNORECASE)
_BETWEEN_BEFORE = re.compile(rf"(?:{_HW}בין(?:\s+ה-?)?|(?i:\bbetween\b))\s*$")


@dataclass(frozen=True)
class MoneyMention:
    start: int
    end: int
    amount: Decimal  # primary interpretation (used to read budgets the user typed)
    currency: str
    text: str
    candidates: tuple[Decimal, ...] = ()  # every interpretation (thousands / decimal), multiplier applied


@dataclass
class _Run:
    start: int
    end: int  # end of the digits
    num_end: int  # end incl. multiplier
    raw: str
    mult: int
    cur: str | None = None
    span_start: int = 0
    span_end: int = 0

    def values(self) -> list[Decimal]:
        return [v * self.mult for v in _interpretations(self.raw)]

    def primary(self) -> Decimal | None:
        value = _primary(self.raw)
        return None if value is None else value * self.mult


def _dec(s: str) -> Decimal | None:
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _digits(s: str) -> str:
    return "".join(ch for ch in s if ch not in _SEPS)


def _interpretations(raw: str) -> list[Decimal]:
    """All separators as thousands separators, and the last one as a decimal point."""
    out: list[Decimal] = []
    whole = _dec(_digits(raw))
    if whole is not None:
        out.append(whole)
    seps = [i for i, ch in enumerate(raw) if ch in _SEPS]
    if seps:
        last = seps[-1]
        dec = _dec(f"{_digits(raw[:last])}.{raw[last + 1:]}")
        if dec is not None and dec not in out:
            out.append(dec)
    return out


def _primary(raw: str) -> Decimal | None:
    """The most likely reading (for budgets the user typed)."""
    if re.fullmatch(r"\d{1,3}(?:([.,'’\u00a0\u202f])\d{3})(?:\1\d{3})*", raw):
        return _dec(_digits(raw))  # 1,200 / 1.200 / 1'200 / 12,345,678
    if re.fullmatch(r"\d{1,3}(?:,\d{3})*\.\d+|\d+\.\d+", raw):
        return _dec(raw.replace(",", ""))  # 1,234.50
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})*,\d+|\d+,\d{1,2}", raw):
        return _dec(raw.replace(".", "").replace(",", "."))  # 1.234,50
    return _dec(_digits(raw))


def _currency_name(m: re.Match[str]) -> str | None:
    for name, _ in _CURRENCY_GROUPS:
        value = m.group(f"c_{name}")
        if value:
            return value.strip().upper() if name == "ISO" else name
    return None


def _scan(text: str) -> list[_Run]:
    runs: list[_Run] = []
    consumed: list[tuple[int, int]] = []  # currency markers already attached as a suffix
    for m in _RUN.finditer(text):
        mult, num_end = 1, m.end()
        mm = _MULT.match(text, m.end())
        if mm:
            mult, num_end = (1000 if mm.group("k") else 1_000_000), mm.end()
        run = _Run(m.start(), m.end(), num_end, m.group(), mult, span_start=m.start(), span_end=num_end)
        cm = _CUR_AFTER.match(text, num_end)
        if cm:
            run.cur, run.span_end = _currency_name(cm), cm.end()
            consumed.append((cm.start("cur"), cm.end("cur")))
        runs.append(run)
    for run in runs:
        if run.cur is not None:
            continue
        pm = _CUR_BEFORE.search(text, 0, run.start)
        if pm and not any(pm.start("cur") < e and s < pm.end("cur") for s, e in consumed):
            run.cur, run.span_start = _currency_name(pm), pm.start("cur")
            consumed.append((pm.start("cur"), pm.end("cur")))
    # ranges: "1,000-1,500 ₪", "בין 1,000 ל-1,500 ₪", "$1,000-1,500", "1-2 אלף ₪"
    for a, b in zip(runs, runs[1:], strict=False):
        gap = text[a.span_end:b.span_start]
        is_range = bool(_RANGE_GAP.fullmatch(gap)) or bool(
            _RANGE_GAP_BETWEEN.fullmatch(gap) and _BETWEEN_BEFORE.search(text, 0, a.span_start))
        if not is_range:
            continue
        if a.cur is None and b.cur is not None:
            a.cur = b.cur
            if a.mult == 1 and b.mult != 1:
                a.mult = b.mult
        elif b.cur is None and a.cur is not None and a.span_start < a.start:  # prefix currency: "$1,000-1,500"
            b.cur = a.cur
    return runs


def extract_money(text: str) -> list[MoneyMention]:
    """Money mentions (numeric amount + currency) in Hebrew/English text."""
    out: list[MoneyMention] = []
    for run in _scan(text):
        if run.cur is None:
            continue
        primary = run.primary()
        if primary is None:
            continue
        out.append(MoneyMention(run.span_start, run.span_end, primary, run.cur, text[run.span_start:run.span_end],
                                tuple(run.values())))
    return out


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
    """Amounts the USER wrote (so the model may repeat them): money mentions in their
    primary reading, plus bare numbers of 3+ digits (e.g. "תקציב 3000") with unknown currency."""
    out: list[Amount] = []
    for run in _scan(_strip_invisible(text)):
        primary = run.primary()
        if primary is None:
            continue
        if run.cur is not None:
            out.append((primary, run.cur))
        elif len(_digits(run.raw)) >= 3 or run.mult != 1:
            out.append((primary, ANY_CURRENCY))
    return out


def _matches(value: Decimal, currency: str | None, allowed: Iterable[Amount]) -> bool:
    for amount, cur in allowed:
        if currency is not None and cur not in (currency, ANY_CURRENCY):
            continue
        if amount == 0:
            if value == 0:
                return True
            continue
        if abs(value - amount) <= abs(amount) * TOLERANCE:
            return True
    return False


def _matches_any(values: list[Decimal], currency: str | None, allowed: list[Amount]) -> bool:
    return any(_matches(v, currency, allowed) for v in values)


# --------------------------------------------------------- bare amounts ----

_HE_MONTHS = "ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר"
_EN_MONTHS = r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?" \
             r"|nov(?:ember)?|dec(?:ember)?"
_PRICE_WORDS = re.compile(
    rf"{_HW}(?:ה|ב|ו|ל|וה|וב)?(?:מחיר|מחירים|עלות|עלויות|תשלום|תקציב|הנחה|חיסכון){_HE}|{_HW}(?:עול(?:ה|ות|ים)|עלה|עלו|לשלם|"
    rf"משלמים|תשלמו|לתשלום|בסך|בלבד|זול(?:ה|ים|ות)?|יקר(?:ה|ים|ות)?|ללילה|לאדם|לזוג|לנוסע){_HE}|סה[\"״]כ|סך\s+הכל"
    r"|(?i:\b(?:price[sd]?|pricing|costs?|costing|total|fares?|fees?|pay|paid|paying|only|cheap(?:er|est)?|expensive|"
    r"budget|discount|save|saving|per\s+(?:night|person|day)|a\s+night)\b)"
)
_UNITS = (
    rf"{_HW}(?:לילות|לילה|ימים|יום|יומיים|שבועות|שבוע|חודשים|חודש|שנים|שנה|שעות|שעה|דקות|דקה|דק'|ק[\"״]מ|קילומטר(?:ים)?|"
    rf"מטר(?:ים)?|ק[\"״]ג|קילו|כוכבים|כוכב|מבוגרים|מבוגר|ילדים|ילד|תינוקות|נוסעים|נוסע|אנשים|מושבים|מקומות|חדרים|חדר|"
    rf"מיטות|מזוודות|מזוודה|תיקים|ביקורות|חוות\s+דעת|הצעות|הצעה|אפשרויות|תוצאות|ספקים|מלונות|טיסות|עצירות|עצירה|"
    rf"אחוזים|אחוז|מתוך|פעמים|נקודות|קומות|קומה|[בל]?-?(?:{_HE_MONTHS})){_HE}|%|/"
    r"|(?i:\b(?:nights?|days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?|km|kilomet(?:er|re)s?|miles?|met(?:er|re)s?|"
    rf"kg|lbs?|stars?|adults?|children|kids?|travell?ers|passengers|people|persons|seats?|rooms?|beds?|bags?|pieces|reviews|"
    rf"ratings|offers?|options?|results|providers|hotels|flights|stops?|percent|times|points|floors?|out\s+of|{_EN_MONTHS})\b)"
)
_UNIT_AFTER = re.compile(rf"(?:\s*(?:-|–|עד|to|or|או)\s*\d+(?:[.,]\d+)?)?\s*(?:{_UNITS})")
_CONTEXT_BEFORE = re.compile(
    rf"(?:{_HW}(?:דירוג|ציון|גיל|בגיל|בן|בת|בני|בנות|בשעה|שעה|טיסה|טיסת|מספר|חדר|שער|טרמינל|קומה|כביש|עמוד|מתוך|מקום|"
    rf"שנת|בשנת){_HE}|(?i:\b(?:rating|rated|score|aged?|ages|flight|number|no\.?|room|gate|terminal|floor|route|page|rank|"
    r"top|year|out\s+of)\b)|#)\s*(?:מספר\s*)?[:#-]?\s*$"
)
_MONTH_BEFORE = re.compile(rf"(?:{_HW}[בל]?-?(?:{_HE_MONTHS}){_HE}|(?i:\b(?:{_EN_MONTHS})\b\.?))\s*,?\s*$")
_DATE_MARKER_BEFORE = re.compile(rf"(?:{_HW}(?:ב|מ|עד|ל|ה|מה|עד\s+ה)-?|(?i:\b(?:on|from|until|till|to|between)\b)|-|–)\s*$")
_YEAR_MARKER_BEFORE = re.compile(rf"(?:{_HW}(?:שנת|בשנת|ב|מ|עד|ל|ה)-?|(?i:\b(?:year|in|of|since)\b)|-|–|,)\s*$")


def _price_sentence(sentence: str) -> bool:
    return bool(_PRICE_WORDS.search(sentence) or _ANY_CURRENCY_RE.search(sentence))


def _bare_price_candidate(text: str, run: _Run) -> bool:
    """Is a currency-less number in a price sentence plausibly a price? (units/dates/codes are not)."""
    if run.mult == 1 and len(_digits(run.raw)) < 2:
        return False
    before = text[max(0, run.start - 40):run.start]
    if before[-1:] in (":", "/") or re.match(r"[:/]\d", text[run.end:run.end + 2]):
        return False  # time 14:30, date 12/12, rating 8/10
    if re.search(r"[A-Za-z]$", before) or re.match(r"[A-Za-z]", text[run.num_end:run.num_end + 1]):
        return False  # LY315, A320, 2x
    if _UNIT_AFTER.match(text, run.num_end) or _MONTH_BEFORE.search(before) or _CONTEXT_BEFORE.search(before):
        return False
    m = re.fullmatch(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?", run.raw)
    if m and 1 <= int(m.group(1)) <= 31 and 1 <= int(m.group(2)) <= 12 and (m.group(3) or _DATE_MARKER_BEFORE.search(before)):
        return False  # 12.12.2026 / ב-12.12
    if re.search(r"\d{4}-(?:\d{1,2}-)?$", before) or re.match(r"-\d{1,2}-\d{1,2}", text[run.end:run.end + 6]):
        return False  # ISO date 2026-12-12
    raw_digits = _digits(run.raw)
    return not (raw_digits == run.raw and len(raw_digits) == 4 and 1900 <= int(raw_digits) <= 2100
                and _YEAR_MARKER_BEFORE.search(before))  # ב-2026


# -------------------------------------------------------- number words ----

_HE_NUM_WORDS = frozenset({
    "אחד", "אחת", "שניים", "שתיים", "שני", "שתי", "שלוש", "שלושה", "שלושת", "ארבע", "ארבעה", "ארבעת", "חמש", "חמישה",
    "חמשת", "שש", "שישה", "ששת", "שבע", "שבעה", "שבעת", "שמונה", "שמונת", "תשע", "תשעה", "תשעת", "עשר", "עשרה",
    "עשרת", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים", "מאה", "מאתיים", "מאות",
    "אלף", "אלפיים", "אלפים", "אלפי", "מיליון", "מליון", "מיליונים", "עשרות", "חצי", "רבע",
})
_HE_BIG = frozenset({"מאה", "מאתיים", "מאות", "אלף", "אלפיים", "אלפים", "אלפי", "מיליון", "מליון", "מיליונים"})
_EN_NUM_WORDS = frozenset({
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million",
    "millions", "dozen", "dozens", "half", "couple", "few", "several",
})
_EN_BIG = frozenset({"hundred", "hundreds", "thousand", "thousands", "million", "millions"})
_WORD = re.compile(rf"[{HEB}]+|[A-Za-z]+")


def _num_word(token: str) -> tuple[bool, bool]:
    low = token.lower()
    if low in _EN_NUM_WORDS:
        return True, low in _EN_BIG
    for k in (0, 1, 2):
        prefix, rest = token[:k], token[k:]
        if len(rest) >= 2 and all(ch in "ובהלכמש" for ch in prefix) and rest in _HE_NUM_WORDS:
            return True, rest in _HE_BIG
    return False, False


def _word_money_spans(text: str, price_sentence: bool, taken: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Runs of number words next to a currency (or containing מאה/אלף/hundred/... in a price sentence)."""
    tokens = [t for t in _WORD.finditer(text) if not any(t.start() < e and s < t.end() for s, e in taken)]
    spans: list[tuple[int, int]] = []
    i = 0
    while i < len(tokens):
        is_num, big = _num_word(tokens[i].group())
        if not is_num:
            i += 1
            continue
        j = i
        while j + 1 < len(tokens):
            gap = text[tokens[j].end():tokens[j + 1].start()]
            if gap.strip(" -") != "":
                break
            nxt_num, nxt_big = _num_word(tokens[j + 1].group())
            if nxt_num:
                j, big = j + 1, big or nxt_big
                continue
            if (tokens[j + 1].group().lower() in ("and", "a") and j + 2 < len(tokens)
                    and text[tokens[j + 1].end():tokens[j + 2].start()].strip(" -") == ""
                    and _num_word(tokens[j + 2].group())[0]):
                j, big = j + 2, big or _num_word(tokens[j + 2].group())[1]
                continue
            break
        start, end = tokens[i].start(), tokens[j].end()
        after = _CUR_AFTER.match(text, end)
        before = _CUR_BEFORE.search(text, 0, start)
        if after:
            spans.append((start, after.end()))
        elif before:
            spans.append((before.start("cur"), end))
        elif price_sentence and big:
            spans.append((start, end))
        i = j + 1
    return spans


# --------------------------------------------------------- booking claims ----

_NEGATION = re.compile(
    r"(?:\bלא\b|\bאינני\b|\bאיני\b|\bאינו\b|\bאין\b|\bעדיין\s+לא\b|\bnot\b|n't\b|\bnever\b|\bcannot\b|\bunable\b|"
    r"\bלא\s+ניתן\b)\s*$",
    re.IGNORECASE,
)
_HE_OWNER = r"(?:\s+(?:שלכם|שלך|שלכן|שלנו|שלו|שלה|שלהם))?"
_HE_ITEMS = (r"(?:ה)?(?:הזמנה|הזמנות|טיסה|טיסות|מלון|חדר|חדרים|רכב|כרטיס|כרטיסים|כרטיסי\s+הטיסה|אטרקציה|סיור|מקום|"
             r"מקומות|חופשה|לינה|השכרה|שריון|חבילה|חבילת\s+הנופש)")
_BOOKING_CLAIMS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        # Hebrew: first person / "we" / present tense
        r"(?:ה|ו)?(?:הזמנתי|שריינתי|שילמתי|רכשתי|קניתי)",
        r"(?<![\u0590-\u05ff])(?:הזמנו|שריינו|שילמנו|רכשנו|סגרנו)\s+(?:לכם|עבורכם|לך|עבורך|את)",
        r"(?<![\u0590-\u05ff])(?:אני\s+)?(?:מזמין|מזמינה|משריין|משריינת|משלם|משלמת|רוכש|רוכשת)\s+(?:לכם|עבורכם|לך|עבורך|עכשיו|כעת)",
        r"ביצעתי\s+(?:את\s+)?(?:ה)?(?:הזמנה|תשלום|רכישה|שריון)",
        r"סגרתי\s+(?:לכם|עבורכם|לך|עבורך|את\s+ה)",
        # Hebrew: passive / state ("ההזמנה שלך אושרה", "הטיסה הוזמנה בהצלחה", "המלון שוריין")
        rf"{_HE_ITEMS}{_HE_OWNER}\s+(?:כבר\s+)?(?:אושר(?:ה|ו)?|מאושר(?:ת|ים|ות)?|בוצע(?:ה|ו)?|הושלמ(?:ה|ו)|הושלם|נקלט(?:ה|ו)?|"
        r"נסגר(?:ה|ו)?|הוזמנ(?:ה|ו)|הוזמן|שוריינ(?:ה|ו)|שוריין|נרכש(?:ה|ו)?|נקנ(?:ה|תה|ו)|שמור(?:ה|ים|ות)?\s+(?:לכם|לך|עבורכם)|"
        r"מובטח(?:ת|ים|ות)?|מוזמנ(?:ת|ים|ות)|הונפק(?:ו|ה)?|יצא(?:ו)?\s+לפועל)",
        r"(?:הוזמנ(?:ה|ו)|הוזמן|שוריינ(?:ה|ו)|שוריין|נרכש(?:ה|ו)|בוצע(?:ה|ו)?)\s+(?:בהצלחה|עבורכם|לכם|עבורך|לך)",
        r"(?:ה)?תשלום\s+(?:אושר|בוצע|הושלם|עבר|התקבל)",
        r"(?:ה)?חיוב\s+(?:בוצע|אושר|עבר)",
        r"(?:ה)?כרטיסים\s+(?:הוזמנו|נרכשו|שמורים|הונפקו)",
        r"מספר\s+(?:ה)?(?:אישור|הזמנה)|קוד\s+(?:ה)?(?:הזמנה|אישור)|אסמכת(?:א|ה)\s*[:#]?\s*[A-Z0-9]|אישור\s+(?:ה)?הזמנה\s*[:#]",
        r"(?:אתם|את|אתה)\s+(?:מסודרים|מסודרת|מסודר)\b|(?:הכל|הכול)\s+(?:מוכן|סגור|מסודר)\s+(?:לטיסה|לנסיעה|לחופשה|לכם)",
        r"נשלח\s+(?:אליכם|לכם|אלייך|אליך)\s+(?:אישור|כרטיס|מייל\s+אישור)",
        # English
        r"\b(?:I|we)(?:'ve|\s+have|\s+just|\s+went\s+ahead\s+and)?\s+(?:just\s+|now\s+|successfully\s+|already\s+)?"
        r"(?:booked|reserved|purchased|paid(?:\s+for)?|secured|locked\s+in|bought)\b",
        r"\b(?:I|we)(?:'m|\s+am|'ll|\s+will|\s+are|'re)\s+(?:now\s+|going\s+to\s+)?(?:booking|reserving|purchasing|paying|"
        r"book|reserve|purchase|pay(?:\s+for)?|secure|lock\s+in)\b",
        r"\b(?:booked|reserved|purchased|paid\s+for|secured)\s+(?:it\s+|this\s+|them\s+|that\s+|everything\s+)?for\s+you\b",
        r"\b(?:your|the|this)\s+(?:flights?|hotels?|rooms?|cars?|rental|booking|reservations?|tickets?|trip|stay|tours?|"
        r"activit(?:y|ies)|seats?|package|order|payment)\s+(?:is|are|has\s+been|have\s+been|was|were|got)\s+"
        r"(?:now\s+|all\s+|officially\s+|successfully\s+)?(?:booked|reserved|confirmed|secured|paid(?:\s+for)?|purchased|"
        r"set|locked\s+in|held|complete[d]?|processed|issued|finalized)\b",
        r"\b(?:booking|reservation|order|payment|purchase)\s+(?:is\s+|has\s+been\s+|was\s+)?(?:now\s+)?"
        r"(?:confirmed|complete[d]?|processed|successful|done|finalized|approved)\b",
        r"\bconfirmed\s+(?:your|the)\s+(?:booking|reservation|order|flights?|hotels?|tickets?|room)\b",
        r"\b(?:confirmation|booking|reservation)\s+(?:number|code|reference|ref|email|id)\b|\bPNR\b",
        r"\btickets?\s+(?:are|is|have\s+been|has\s+been)\s+(?:booked|issued|purchased|confirmed)\b",
        r"\byou(?:'re|\s+are)\s+(?:now\s+)?(?:all\s+set|booked|confirmed|good\s+to\s+go)\b",
        r"\bsuccessfully\s+(?:booked|reserved|purchased|paid)\b",
    )
]


def _is_booking_claim(sentence: str) -> bool:
    for pattern in _BOOKING_CLAIMS:
        for m in pattern.finditer(sentence):
            if not _NEGATION.search(sentence[: m.start()][-30:]):
                return True
    return False


# ------------------------------------------------- market-wide claims ----

HONEST_SCOPE_HE = "מבין ההצעות שנמצאו בחיפוש זה"
HONEST_SCOPE_EN = "among the offers found in this search"
_SCOPE_WINDOW = 45

_SUPERLATIVE = re.compile(
    rf"{_HW}(?:ה|ש|וה)?(?:זול(?:ה|ים|ות)?|נמוכ(?:ה|ים|ות)|נמוך|משתלמ(?:ת|ים|ות)|משתלם)\s+ביותר{_HE}"
    rf"|{_HW}(?:ה|ו)?הכי\s+(?:זול(?:ה|ים|ות)?|נמוכ(?:ה|ים|ות)|נמוך|משתלמ(?:ת|ים|ות)|משתלם){_HE}"
    rf"|{_HW}(?:ה|ו)?(?:מחיר|עסקה|דיל)\s+(?:ה)?(?:טוב(?:ה)?\s+ביותר|הכי\s+טוב(?:ה)?){_HE}"
    r"|(?i:\b(?:cheapest|lowest(?:\s+(?:price|fare|rate)s?)?|least\s+expensive|best\s+(?:price|deal|value|rate|fare)s?)\b)"
)
# Market scope that follows a superlative (within the same clause).
_MARKET_SCOPE = re.compile(
    rf"{_HW}(?:בכל\s+השוק|בשוק(?:\s+כולו)?|בכל\s+העולם|בעולם|בכל\s+מקום(?:\s+אחר)?|בכל\s+האינטרנט|באינטרנט|ברשת|"
    rf"בכל\s+האתרים|מכל\s+האתרים|מכל\s+החברות|בכל\s+הארץ|בארץ|בישראל|בכל\s+העיר|בעיר|שיש(?:\s+בכלל)?|שקיימ(?:ת|ים|ות)|"
    rf"שקיים|שתמצאו|שתמצא|שתמצאי|שאפשר\s+למצוא|שניתן\s+למצוא|בכלל|אי\s+פעם|בכל\s+הזמנים|בהיסטוריה|עלי\s+אדמות){_HE}"
    rf"(?!\s+(?:כאן|פה|מבין|בין\s+ה|ב(?:תוצאות|רשימה|חיפוש)))"
    r"|(?i:\b(?:on\s+the\s+(?:market|internet|web|planet)|anywhere(?:\s+else)?|in\s+the\s+(?:world|market|country|city|industry)|"
    r"out\s+there|available\s+anywhere|you(?:'ll|\s+will|\s+can|\s+could)?\s+(?:ever\s+)?find|period|ever|of\s+all\s+time|"
    r"on\s+earth|in\s+town)\b(?!\s+(?:here|below|above|in\s+(?:these|the|this)\s+(?:results|search|list))))"
)
_CLAUSE_BREAK = re.compile(r"[.,;:!?—–()\[\]]")
# Explicit negation / hedge right before the superlative: an honest disclaimer, keep it.
_HEDGE_BEFORE = re.compile(
    rf"(?:{_HW}(?:לא|אין|אינו|אינה|איננו|אינם|בהכרח){_HE}|(?i:\b(?:not|necessarily|never)\b|n't\b))[^.!?]{{0,20}}$"
)
# Absolute market claims with no honest rewrite -> remove the sentence. (pattern, honour a preceding negation?)
_MARKET_ABSOLUTE: list[tuple[re.Pattern[str], bool]] = [
    (re.compile(p, re.IGNORECASE), neg)
    for p, neg in (
        (rf"{_HW}אין\s+(?:\S+\s+){{0,2}}?(?:זול|נמוך|משתלם|טוב)(?:ה|ים|ות)?\s*(?:יותר|מזה|ממנו|ממנה|מזו|מאלה)", False),
        (rf"{_HW}לא\s+(?:תמצאו|תמצא|תמצאי|תשיגו|תשיג|ניתן\s+למצוא|אפשר\s+למצוא|תמצאו\s+בשום\s+מקום)\s+(?:\S+\s+){{0,3}}?"
         r"(?:זול|נמוך|משתלם|טוב)(?:ה|ים|ות)?\s+(?:יותר|מזה)", False),
        (rf"{_HW}(?:ה|ו|וה|ב)?(?:מחיר|מחירים)\s+(?:\S+\s+){{0,3}}?(?:מובטח|מובטחת|מובטחים|בהתחייבות|בערבות){_HE}"
         rf"|{_HW}(?:מובטח|מובטחת)\s+(?:\S+\s+){{0,2}}?(?:ה|כ)?(?:זול|נמוך|מחיר)|ביותר\s+(?:מובטח|מובטחת){_HE}"
         rf"|{_HW}(?:הבטחת|ערבות|התחייבות\s+ל)"
         rf"\s*(?:ה)?(?:מחיר|זול){_HE}|{_HW}(?:שובר(?:י)?\s+(?:ה)?שוק|ללא\s+תחרות|אין\s+לו\s+מתחרים){_HE}", True),
        (r"\b(?:best|lowest|cheapest)\s+(?:price\s+)?guarantee[ds]?\b|\bguaranteed\s+(?:the\s+)?(?:best|lowest|cheapest)\b"
         r"|\bprice\s+(?:match|guarantee)\b|\bunbeatable\b|\bnothing\s+beats\b|\bbeats?\s+(?:any|all|every)\s+(?:other\s+)?"
         r"(?:price|deal|offer)s?\b", True),
        (r"\b(?:won't|will\s+not|can't|cannot|couldn't|could\s+not)\s+(?:find|get)\s+(?:\w+\s+){0,3}?"
         r"(?:cheaper|lower|better\s+(?:price|deal))\b|\b(?:can't|cannot)\s+beat\b|\bthere(?:'s|\s+is)\s+no(?:thing)?\s+cheaper\b"
         r"|\bnothing\s+(?:is\s+)?cheaper\b", False),
    )
]


def _is_absolute_market_claim(sentence: str) -> bool:
    for pattern, honour_negation in _MARKET_ABSOLUTE:
        for m in pattern.finditer(sentence):
            if not (honour_negation and _HEDGE_BEFORE.search(sentence[: m.start()][-30:])):
                return True
    return False


def _market_scope_spans(sentence: str) -> list[tuple[int, int, str]]:
    """(start, end, honest replacement) for market scopes that follow a non-negated superlative."""
    out: list[tuple[int, int, str]] = []
    for sup in _SUPERLATIVE.finditer(sentence):
        if _HEDGE_BEFORE.search(sentence[: sup.start()][-30:]):
            continue
        window = sentence[sup.end():sup.end() + _SCOPE_WINDOW]
        brk = _CLAUSE_BREAK.search(window)
        if brk:
            window = window[: brk.start()]
        scope = _MARKET_SCOPE.search(window)
        if scope:
            start, end = sup.end() + scope.start(), sup.end() + scope.end()
            honest = HONEST_SCOPE_EN if scope.group(0).isascii() else HONEST_SCOPE_HE
            if not any(start < e and s < end for s, e, _ in out):
                out.append((start, end, honest))
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
    market_claims_rewritten: int = 0
    market_claims_removed: int = 0


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")


def _strip_invisible(text: str) -> str:
    """Drop bidi/zero-width format characters (keep ZWJ for emoji)."""
    return "".join(ch for ch in text if ch == "\u200d" or unicodedata.category(ch) != "Cf")


def _clip(s: str, n: int = 300) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def ground_text(text: str, allowed: Iterable[Amount], *, scope_available: bool | None = None) -> GroundingResult:
    """Ground model text. ``scope_available``: this turn has search results, so a market-wide
    superlative can be rewritten to "among the offers found in this search" (default: ``bool(allowed)``)."""
    allowed_list = list(allowed)
    can_rewrite = bool(allowed_list) if scope_available is None else scope_available
    result = GroundingResult(text="")
    out_lines: list[str] = []
    for line in _strip_invisible(text or "").split("\n"):
        kept: list[str] = []
        for sentence in _SENTENCE_SPLIT.split(line):
            if not sentence.strip():
                kept.append(sentence)
                continue
            if _is_booking_claim(sentence):
                result.removed_claims.append(_clip(sentence))
                result.booking_claims_removed += 1
                continue
            scopes = _market_scope_spans(sentence)
            if _is_absolute_market_claim(sentence) or (scopes and not can_rewrite):
                result.removed_claims.append(_clip(sentence))
                result.market_claims_removed += 1
                continue
            if scopes:
                result.removed_claims.append(_clip(sentence))
                result.market_claims_rewritten += len(scopes)
                for start, end, honest in sorted(scopes, reverse=True):
                    sentence = sentence[:start] + honest + sentence[end:]
            kept.append(_ground_sentence(sentence, allowed_list, result))
        out_lines.append(" ".join(kept).rstrip())
    cleaned = "\n".join(out_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    result.text = cleaned
    result.ok = not result.removed_claims
    return result


def _merge(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for s, e in sorted(spans):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def _ground_sentence(sentence: str, allowed: list[Amount], result: GroundingResult) -> str:
    runs = _scan(sentence)
    price_sentence = _price_sentence(sentence)
    replacements: list[tuple[int, int]] = []
    for run in runs:
        if run.cur is not None:
            result.prices_checked += 1
            if not _matches_any(run.values(), run.cur, allowed):
                replacements.append((run.span_start, run.span_end))
        elif price_sentence and _bare_price_candidate(sentence, run):
            result.prices_checked += 1
            if not _matches_any(run.values(), None, allowed):
                replacements.append((run.start, run.num_end))
    for span in _word_money_spans(sentence, price_sentence, [(r.start, r.num_end) for r in runs]):
        result.prices_checked += 1
        replacements.append(span)
    if not replacements:
        return sentence
    merged = _merge(replacements)
    result.removed_claims.append(_clip(sentence))
    result.prices_removed += len(merged)
    out = sentence
    for start, end in reversed(merged):
        out = out[:start] + REMOVED_PRICE + out[end:]
    return out
