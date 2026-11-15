"""Small text helpers shared by the AI layer (normalization, language detection).

Nothing here talks to the network or looks at anything but the text it is given.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

# Hebrew points/cantillation (niqqud, ta'amim) live in U+0591..U+05C7.
_HEBREW_MARKS = re.compile(r"[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]")
# Zero-width, bidi controls, soft hyphen, BOM, tatweel-like joiners used to split words.
_INVISIBLE = re.compile(r"[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]")
# Hebrew punctuation that can be wedged inside words: maqaf, geresh, gershayim, paseq, sof pasuq.
_HEBREW_PUNCT = str.maketrans({"־": "-", "׳": "'", "״": '"', "׀": " ", "׃": " "})
_FINALS = str.maketrans({"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"})
_WS = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")

_HEBREW_LETTER = re.compile(r"[\u05D0-\u05EA]")
_LATIN_LETTER = re.compile(r"[A-Za-z]")


def fold_finals(text: str) -> str:
    """Map Hebrew final letters to their regular forms (so patterns need only one spelling)."""
    return text.translate(_FINALS)


def normalize_for_matching(text: str) -> str:
    """Aggressive normalization used ONLY for detection, never for text shown to anyone.

    NFKC (folds full-width/compatibility forms), strip niqqud and invisible characters,
    lower-case, fold Hebrew final letters, collapse whitespace.
    """
    t = unicodedata.normalize("NFKC", text)
    t = t.translate(_HEBREW_PUNCT)
    t = _HEBREW_MARKS.sub("", t)
    t = _INVISIBLE.sub("", t)
    t = _CONTROL.sub(" ", t)
    t = t.casefold()
    t = fold_finals(t)
    return _WS.sub(" ", t).strip()


def compact(normalized: str) -> str:
    """Drop everything but letters/digits: defeats 'i g n o r e' / 'i.g.n.o.r.e' spacing tricks."""
    return re.sub(r"[\W_]+", "", normalized)


def strip_controls(text: str) -> str:
    """Remove control and invisible characters from untrusted text (keeps newlines/tabs)."""
    return _INVISIBLE.sub("", _CONTROL.sub("", text))


def detect_language(texts: Iterable[str]) -> str:
    """'he', 'en' or 'mixed' by letter counts. No letters at all (e.g. only emoji) -> 'he'."""
    he = en = 0
    for t in texts:
        he += len(_HEBREW_LETTER.findall(t))
        en += len(_LATIN_LETTER.findall(t))
    if en == 0 and he == 0:
        return "he"
    if he == 0:
        return "en"
    if en == 0:
        return "he"
    share = en / (he + en)
    if share >= 0.8:
        return "en"
    if share <= 0.2:
        return "he"
    return "mixed"
