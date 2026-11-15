"""Last line of defence on the model's text before it becomes a draft.

The owner still reviews every draft, but the guard makes sure what they see is a
clean single reply and never carries secrets, unknown links or prompt fragments.

Prompt fragments are caught two ways: fixed markers, and an overlap check (security review L-9):
any run of 8 consecutive words, or 40 consecutive characters, shared with the NOA persona or with
our own system-prompt template means the draft is replaced by the fallback.
"""

from __future__ import annotations

import re
from functools import lru_cache

from bridge_service.ai._text import detect_language, normalize_for_matching
from bridge_service.ai.base import DraftInput, SafetyReport

FALLBACK_HE = "היי, ראיתי את ההודעה שלך ואחזור אליך בהקדם 🙏"
FALLBACK_EN = "Hi, I saw your message and will get back to you soon 🙏"
MAX_DRAFT_CHARS = 700

_QUOTE_PAIRS = (('"', '"'), ("'", "'"), ("“", "”"), ("„", "“"), ("«", "»"), ("״", "״"), ("‘", "’"), ("`", "`"))
_PREFIX = re.compile(
    r"^\s*(?:\*\*|__)?\s*(?:טיוטת\s+תשובה|טיוטה|תשובה\s+מוצעת|תשובה|הצעה|נועה|noa|draft\s+reply|draft|reply|response|answer)"
    r"\s*(?:\*\*|__)?\s*[:：\-–—]\s*(?:\*\*|__)?\s*",
    re.IGNORECASE,
)
_FENCE = re.compile(r"^```[\w-]*\s*|\s*```$")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+", re.MULTILINE)
_EMPH = re.compile(r"(\*\*|__)(.+?)\1|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", re.DOTALL)
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"'«»]+", re.IGNORECASE)
_URL_TRAIL = ".,!?;:)]}'\"״׳…"

_LEAK_MARKERS = (
    "incoming_messages",
    "incoming messages>",
    "noa_persona",
    "noa persona>",
    "system prompt",
    "systemprompt",
    "הוראות המערכת",
    "הנחיות המערכת",
    "כללים שאסור להפר",
    "# אבטחה",
    "נתונים מצד שלישי לא מאומת",
)
_SECRETS = (
    re.compile(r"\bsk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"\bAKIA[0-9A-Z]{12,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{16,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{8,}"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),  # JWT
    re.compile(r"(?<![A-Za-z0-9+/=_\-])[A-Za-z0-9+/=_\-]{32,}(?![A-Za-z0-9+/=_\-])"),  # long base64 / hex
    re.compile(r"(?<!\d)(?:\d[ \-]?){13,19}(?!\d)"),  # card-number shaped
)
_SHORT_CODE = re.compile(r"(?<!\d)\d{4,8}(?!\d)")

OVERLAP_WORDS = 8
OVERLAP_CHARS = 40
_WORD = re.compile(r"\w+")


def _words(text: str) -> list[str]:
    return _WORD.findall(normalize_for_matching(text))


@lru_cache(maxsize=16)
def _shingles(source: str) -> tuple[frozenset[tuple[str, ...]], frozenset[str]]:
    """(8-word runs, 40-char runs) of `source`, on normalized words joined by single spaces."""
    words = _words(source)
    word_runs = frozenset(tuple(words[i : i + OVERLAP_WORDS]) for i in range(len(words) - OVERLAP_WORDS + 1))
    joined = " ".join(words)
    char_runs = frozenset(joined[i : i + OVERLAP_CHARS] for i in range(len(joined) - OVERLAP_CHARS + 1))
    return word_runs, char_runs


def _overlaps(text: str, source: str) -> bool:
    word_runs, char_runs = _shingles(source)
    if not word_runs and not char_runs:
        return False
    words = _words(text)
    if any(tuple(words[i : i + OVERLAP_WORDS]) in word_runs for i in range(len(words) - OVERLAP_WORDS + 1)):
        return True
    joined = " ".join(words)
    return any(joined[i : i + OVERLAP_CHARS] in char_runs for i in range(len(joined) - OVERLAP_CHARS + 1))


@lru_cache(maxsize=1)
def prompt_template_text() -> str:
    """The static text of our own system prompt + user wrapper (all optional sections included)."""
    # Imported lazily: prompt.py is a sibling module and must stay importable on its own.
    from bridge_service.ai.base import DraftInput
    from bridge_service.ai.prompt import build_messages

    probe = DraftInput(request_id="", conversation_ref="", sender_display_name=None, messages=())
    system, messages = build_messages(
        probe, "-", None, SafetyReport(injection_suspected=True, sensitive_request=True)
    )
    return system + "\n" + "\n".join(str(m["content"]) for m in messages)


def leaks_persona_or_template(text: str, persona: str | None = None) -> bool:
    """True if `text` shares an 8-word / 40-char run with the persona or our prompt template."""
    if persona and persona.strip() and _overlaps(text, persona):
        return True
    return _overlaps(text, prompt_template_text())


def fallback_for(data: DraftInput) -> str:
    return FALLBACK_EN if detect_language(m.text for m in data.messages) == "en" else FALLBACK_HE


def _strip_wrapping(text: str) -> str:
    prev = None
    t = text.strip()
    while t != prev:
        prev = t
        t = _FENCE.sub("", t).strip()
        t = _PREFIX.sub("", t).strip()
        for a, b in _QUOTE_PAIRS:
            if len(t) >= 2 and t.startswith(a) and t.endswith(b) and a not in t[1:-1].replace(b, ""):
                t = t[1:-1].strip()
                break
    return t


def _strip_markdown(text: str) -> str:
    t = _HEADING.sub("", text)
    t = _EMPH.sub(lambda m: m.group(2) if m.group(2) is not None else m.group(3), t)
    return _INLINE_CODE.sub(r"\1", t)


def _collapse_ws(text: str) -> str:
    lines = [re.sub(r"[ \t\u00A0\u2000-\u200A\u3000]+", " ", ln).strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if not ln and (not out or not out[-1]):
            continue
        out.append(ln)
    return "\n".join(out).strip()


def _clean_url(u: str) -> str:
    return u.rstrip(_URL_TRAIL)


def _allowed_urls(data: DraftInput) -> set[str]:
    allowed: set[str] = set()
    for m in data.messages:
        for u in _URL.findall(m.text or ""):
            allowed.add(_clean_url(u).lower())
    return allowed


def _remove_unknown_urls(text: str, allowed: set[str]) -> tuple[str, str]:
    """Returns (text_with_unknown_urls_removed, text_without_any_urls) — the latter for secret scanning."""

    def keep_or_drop(m: re.Match[str]) -> str:
        raw = m.group(0)
        url = _clean_url(raw)
        trail = raw[len(url):]
        return (url if url.lower() in allowed else "") + trail

    kept = _URL.sub(keep_or_drop, text)
    no_urls = _URL.sub(" ", text)
    return kept, no_urls


def _cap(text: str, limit: int = MAX_DRAFT_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    best = max(cut.rfind(c) for c in (".", "!", "?", "…", "\n"))
    if best >= limit // 3:
        return cut[: best + 1].strip()
    space = cut.rfind(" ")
    if space >= limit // 3:
        return cut[:space].rstrip(" ,;:-") + "…"
    return cut[: limit - 1] + "…"


def leaks_prompt(text: str) -> bool:
    n = normalize_for_matching(text)
    return any(normalize_for_matching(marker) in n for marker in _LEAK_MARKERS)


def contains_secret(text: str, report: SafetyReport) -> bool:
    if any(p.search(text) for p in _SECRETS):
        return True
    return bool(report.sensitive_request and _SHORT_CODE.search(text))


def finalize(text: str, data: DraftInput, report: SafetyReport, persona: str | None = None) -> str:
    """Clean the model output into one safe draft, or return the safe fallback.

    `persona` is the NOA persona that was given to the model (if any): a draft quoting a long run
    of it, or of our own system-prompt template, is replaced by the fallback.
    """
    fallback = fallback_for(data)
    if not text or not text.strip():
        return fallback
    t = _strip_wrapping(text)
    t = _strip_markdown(t)
    t = _strip_wrapping(t)
    if leaks_prompt(t) or leaks_persona_or_template(t, persona):
        return fallback
    t, scan = _remove_unknown_urls(t, _allowed_urls(data))
    if contains_secret(scan, report):
        return fallback
    t = re.sub(r"\(\s*\)", "", t)  # "(link)" leftovers
    t = _collapse_ws(t)
    t = re.sub(r"\s+([.,!?…:;])", r"\1", t)
    t = _cap(t)
    return t if t.strip() else fallback
