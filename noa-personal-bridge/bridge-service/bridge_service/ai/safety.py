"""Heuristic safety analysis of incoming (UNTRUSTED) WhatsApp messages.

This is a *signal*, not the security boundary. The real boundaries are structural:
engines have no tools, the model only ever returns text, and a human approves every
draft. The report is used to (a) steer the model towards a neutral, non-complying reply,
(b) tighten the output guard, and (c) show the owner a short Hebrew warning.

Matching runs on a normalized copy of the text (NFKC, niqqud and zero-width characters
removed, case-folded, Hebrew final letters folded, whitespace collapsed), plus a
"compact" copy with all separators removed for a few long, distinctive phrases so
letter-spacing tricks ("i g n o r e", "ה.ו.ר.א.ו.ת") do not slip through.

Every rule also runs on two extra detection-only variants (security review M-3), so a match on any
of them counts: a "skeleton" with Cyrillic/Greek look-alikes mapped to Latin ("іgnore аll" with
Cyrillic і/а), and leetspeak-folded copies ("1gn0re 4ll pr3v10us"). Base64 blobs (≥ 40 chars)
are decoded and analyzed too; a decoded injection, or any long (≥ 120 chars) blob, adds the
"encoded content" note. The sender display name is analyzed like a message.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Sequence
from dataclasses import dataclass

from bridge_service.ai._text import compact, fold_finals, fold_homoglyphs, fold_leet, normalize_for_matching
from bridge_service.ai.base import InboundMessage, SafetyReport

NOTE_INJECTION = "ההודעה מנסה לתת הוראות למערכת — טופלה כטקסט בלבד"
NOTE_COMMAND = "ההודעה מבקשת להריץ פקודות — לא בוצע דבר, טופלה כטקסט בלבד"
NOTE_EXFIL = "ההודעה מבקשת שיחות או הודעות אחרות — לא לשתף מידע כזה"
NOTE_CREDENTIALS = "ההודעה מבקשת מידע רגיש (קוד/סיסמה) — לא לשלוח מידע כזה"
NOTE_FINANCIAL_ID = "ההודעה מבקשת פרטים אישיים או פיננסיים (אשראי/ת״ז/בנק) — לא לשלוח מידע כזה"
NOTE_MONEY = "ההודעה עוסקת בכסף או בתשלום — לא להתחייב ולא להעביר כסף בלי לבדוק"
NOTE_LOCATION = "ההודעה מבקשת כתובת או מיקום — לשקול היטב לפני ששולחים"
NOTE_ENCODED = "תוכן מקודד — טופל כטקסט בלבד"

# Category names (internal; the contract SafetyReport carries only the two booleans + notes).
INJECTION = "injection"
COMMAND = "command"
EXFIL = "exfil"
CREDENTIALS = "credentials"
FINANCIAL_ID = "financial_id"
MONEY = "money"
LOCATION = "location"
ENCODED = "encoded"

_INJECTION_CATEGORIES = frozenset({INJECTION, COMMAND, EXFIL, ENCODED})
_NOTES = {
    INJECTION: NOTE_INJECTION,
    COMMAND: NOTE_COMMAND,
    EXFIL: NOTE_EXFIL,
    CREDENTIALS: NOTE_CREDENTIALS,
    FINANCIAL_ID: NOTE_FINANCIAL_ID,
    MONEY: NOTE_MONEY,
    LOCATION: NOTE_LOCATION,
    ENCODED: NOTE_ENCODED,
}
# Order in which notes are shown to the owner.
_ORDER = (INJECTION, COMMAND, EXFIL, ENCODED, CREDENTIALS, FINANCIAL_ID, MONEY, LOCATION)

# Hebrew helpers. Patterns are written with normal Hebrew spelling and passed through
# fold_finals() at compile time, matching the normalized text.
_B = r"(?<!\w)"  # start-of-word for Hebrew and Latin alike
_E = r"(?!\w)"  # end-of-word
_PFX = r"[ובכלמשה]{0,3}"  # attached Hebrew prefixes (ו/ה/ש/ב/כ/ל/מ)
_GAP = r"(?:\s+\S+){0,4}?\s+"  # up to four words in between


@dataclass(frozen=True)
class _Rule:
    category: str
    pattern: re.Pattern[str]
    on_compact: bool = False


def _rx(category: str, pattern: str, *, on_compact: bool = False) -> _Rule:
    return _Rule(category, re.compile(fold_finals(pattern), re.IGNORECASE | re.MULTILINE), on_compact)


_SEND_VERBS_ALT = r"ת?שלח|לשלוח|ת?עביר|להעביר|תני|תתני|תן|תתן|תגיד|תגידי|ת?כתב|כתבי|ת?ייצא|ייצאי|ת?עתיק|העתיקי"
_SEND_VERBS = r"(?:" + _SEND_VERBS_ALT + r")"
_CHATS = r"(?:שיחות|הודעות|צ'?אטים|היסטוריה|היסטוריית|אנשי\s+ה?קשר|תכתובות|גיבוי)"

_RULES: tuple[_Rule, ...] = (
    # ---------------- prompt injection: Hebrew ----------------
    _rx(INJECTION, _B + r"ו?(?:ת?תעלמ|התעלמ|להתעלמ|ת?שכח|לשכוח|שכחי|ת?בטל|לבטל|בטלי|ת?עקוף|לעקוף|עקפי)\w*"
        + _GAP + _PFX + r"(?:הוראות|הוראה|הנחיות|כללים|כללי|חוקים|הגבלות|פרומפט|תכנות)"),
    _rx(INJECTION, r"הוראות\s+חדשות\s*:"),
    _rx(INJECTION, _B + r"ו?(?:את|אתה)\s+עכשיו\s+(?:\S+\s+)?" + _PFX
        + r"(?:בוט|מערכת|עוזר|עוזרת|סוכן|סוכנת|מודל|בינה|ai|gpt|צ'?אט|במצב|מצב|משחק|משחקת|חופשי|חופשיה|"
          r"לא\s+מוגבל|לא\s+מוגבלת|ללא\s+הגבלות|dan|מתכנת|מתכנתת|אדמין|מנהל|מנהלת|גרסה|האקר|האקרית)"),
    _rx(INJECTION, _B + r"מעכשיו\s+(?:את|אתה)\s+(?:\S+\s+)?"
        + r"(?:בוט|מערכת|עוזר|עוזרת|מודל|תעני|תענה|תעשי|תעשה|תבצעי|תבצע|תצייתי|תציית|חייבת|חייב|תתעלמי|תתעלם|במצב)"),
    _rx(INJECTION, _B + r"(?:הוראות|הנחיות|פרומפט|הגדרות)\s+ה?מערכת"),
    _rx(INJECTION, _B + r"ה?פרומפט\s+(?:שלך|שלכם|המקורי|הסודי|של\s+ה?מערכת)"),
    _rx(INJECTION, _B + r"(?:ת?חשפ|חשפי|תחשוף|ת?גלי|תגלה|ת?ראי|תראה|ת?דפיסי|תדפיס|ת?כתבי|תכתוב|ת?עתיקי|תעתיק)\w*\s+"
        + r"(?:לי\s+)?(?:את\s+)?ה?(?:הוראות|הנחיות|פרומפט)\s+(?:שלך|שלכם|שקיבלת|המקוריות|הסודיות|ה?מערכת|של\s+ה?מערכת)"),
    _rx(INJECTION, r"מצב\s+(?:מפתח|מפתחים|מפתחות|פיתוח|אדמין|דיבאג)"),
    _rx(INJECTION, r"ג'?יילברייק|פריצת\s+כלא"),
    # ---------------- prompt injection: English ----------------
    _rx(INJECTION, r"\b(?:ignore|disregard|forget|override|bypass|skip)\s+"
        r"(?:(?:all|any|every|the|your|my|of|previous|prior|above|earlier|preceding|former|existing|these|those|"
        r"system|original|initial)\s+){0,4}"
        r"(?:instructions?|rules|prompts?|directions|guidelines|directives|programming|constraints|guardrails)\b"),
    _rx(INJECTION, r"\byou\s+are\s+now\b"),
    _rx(INJECTION, r"\bfrom\s+now\s+on\s*,?\s+you\s+(?:are|will|must|shall)\b"),
    _rx(INJECTION, r"\bpretend\s+(?:that\s+)?(?:you\s+are|you're|to\s+be)\b"),
    _rx(INJECTION, r"\bnew\s+instructions\s*:"),
    _rx(INJECTION, r"\bsystem\s*prompt\b"),
    _rx(INJECTION, r"\b(?:reveal|print|show|repeat|output|display|dump|tell\s+me)\s+(?:me\s+)?(?:your|the)\s+"
        r"(?:(?:initial|original|hidden|secret|full|system)\s+)*(?:instructions|prompt|rules)\b"),
    _rx(INJECTION, r"\bdeveloper\s+mode\b|\bdev\s+mode\b|\bgod\s+mode\b|\bdan\s+mode\b|\bdo\s+anything\s+now\b"),
    _rx(INJECTION, r"\bjail\s*-?\s*break"),
    # Fake tags / role markers that try to look like our prompt structure.
    _rx(INJECTION, r"<\s*/?\s*(?:system|incoming_messages|noa_persona|message|instructions?|assistant|user)\b"),
    _rx(INJECTION, r"\[/?inst\]|<\|im_(?:start|end)\|>|^\s*#{2,}\s*(?:system|instructions?)\b"),
    _rx(INJECTION, r"^\s*(?:system|assistant)\s*:"),
    # Compact forms (spacing/punctuation evasion). Long distinctive phrases only.
    _rx(INJECTION, r"(?:ignore|disregard)(?:all|any|the|your|previous|prior|above|earlier|system)*(?:instructions|rules|prompt)",
        on_compact=True),
    _rx(INJECTION, r"systemprompt|developermode|jailbreak", on_compact=True),
    _rx(INJECTION, r"ת?תעלמ\w{0,8}הוראות|הוראותה?מערכת", on_compact=True),
    # ---------------- command execution ----------------
    _rx(COMMAND, _B + r"ו?(?:ת?פעיל|הפעל|להפעיל|ת?ריץ|הרץ|להריץ|ת?בצע|בצע|לבצע|ת?קליד|הקלד|להקליד)\w*\s+"
        + r"(?:\S+\s+){0,2}?" + _PFX + r"(?:פקודה|פקודות|פקודת|סקריפט|טרמינל|shell|bash|script|command)"),
    _rx(COMMAND, _B + r"(?:פקודת|פקודות)\s+(?:מערכת|shell|bash|טרמינל|לינוקס|linux)"),
    _rx(COMMAND, r"\brun\s+(?:this\s+|the\s+following\s+|that\s+|a\s+|my\s+|these\s+)?(?:commands?|scripts?|shell)\b"),
    _rx(COMMAND, r"\bexecute\b"),
    _rx(COMMAND, r"\bcurl\s+\S|\bwget\s+\S|\bsudo\b|\bbash\s+-c\b|\bchmod\s+[+0-7]|\bpowershell\b|\bos\.system\b"),
    _rx(COMMAND, r"\brm\s+-[a-z]*(?:rf|fr)[a-z]*\b|\brm\s+-r\s+-f\b"),
    _rx(COMMAND, r"\|\s*(?:sh|bash|zsh)\b|\$\(\s*\w+|\beval\s*\(|`\s*(?:rm|curl|wget|cat|ls)\b"),
    _rx(COMMAND, r"rmrf", on_compact=True),
    # ---------------- data exfiltration ----------------
    _rx(EXFIL, _B + r"ו?(?:" + _SEND_VERBS_ALT + r"|ת?ראי|תראה|הראי|forward)\w*(?:\s+\S+){0,3}?\s+כל\s+(?:\S+\s+)?ה?" + _CHATS),
    _rx(EXFIL, _B + r"ו?(?:ת?שלח|לשלוח|ת?עביר|להעביר|ת?ייצא|ייצאי)\w*\s+(?:לי|אלי|לנו)\s+(?:את\s+)?ה?" + _CHATS),
    _rx(EXFIL, _B + r"(?:שיחות|הודעות|צ'?אטים|תכתובות)\s+(?:של|עם)\s+(?:אנשים\s+)?(?:אחרים|אחרות)"),
    _rx(EXFIL, r"\bsend\s+me\s+(?:(?:all|every)\s+(?:of\s+)?(?:your\s+|the\s+|his\s+|her\s+|their\s+|my\s+)?|your\s+)"
        r"(?:chats?|messages|conversations|chat\s+history|history|contacts)\b"),
    _rx(EXFIL, r"\b(?:forward|export|share|dump|leak)\s+(?:me\s+)?(?:all\s+)?(?:of\s+)?(?:your|the|his|her|their)\s+"
        r"(?:chats|messages|conversations|chat\s+history|contacts)\b"),
    # "send me the password/code" is an exfiltration-style instruction *and* a sensitive request.
    _rx(INJECTION, _B + r"ו?" + _SEND_VERBS + r"\w*\s+(?:לי\s+|אלי\s+)?(?:את\s+)?ה?(?:סיסמה|סיסמא|סיסמאות|קוד\s+ה?אימות|קוד\s+ה?סודי)"),
    _rx(INJECTION, r"\b(?:send|give|tell|text|forward)\s+me\s+(?:your\s+|the\s+)?(?:password|passcode|verification\s+code|otp|one[-\s]?time\s+code)\b"),
    # ---------------- sensitive: credentials / codes ----------------
    _rx(CREDENTIALS, _B + _PFX + r"(?:סיסמה|סיסמא|סיסמאות|סיסמת)" + _E),
    _rx(CREDENTIALS, r"\bpass(?:word|code|phrase)s?\b|\bpin\s*(?:code|number)\b|קוד\s+(?:ה?)pin\b"),
    _rx(CREDENTIALS, _B + _PFX + r"קוד\s+(?:ה?אימות|ה?סודי|ה?גישה|ה?חד[\s-]?פעמי|ה?כניסה|ה?זיהוי)"),
    _rx(CREDENTIALS, _B + _PFX + r"קוד\s+ש(?:קיבלת|הגיע|נשלח|קיבלתי)"),
    _rx(CREDENTIALS, _B + r"שלחתי\s+לך\s+(?:\S+\s+)?קוד"),
    _rx(CREDENTIALS, r"\botp\b|\b2fa\b|\b(?:verification|security|auth(?:entication)?|login|one[-\s]?time|sms|access)\s+code\b"),
    _rx(CREDENTIALS, r"\bcode\s+(?:that\s+)?(?:you\s+)?(?:just\s+)?(?:got|received)\b|\bsent\s+you\s+a\s+code\b"),
    # ---------------- sensitive: card / ID / bank ----------------
    _rx(FINANCIAL_ID, _B + _PFX + r"(?:כרטיס\s+ה?אשראי|מספר\s+ה?כרטיס|תוקף\s+ה?כרטיס|פרטי\s+ה?(?:אשראי|כרטיס|חשבון|בנק))"),
    _rx(FINANCIAL_ID, r"\bcredit\s*card\b|\bdebit\s*card\b|\bcard\s+(?:number|details)\b|\bcvv\b|\bcvc\b|\bcvv2\b"),
    _rx(FINANCIAL_ID, r"3\s*ה?ספרות\s+(?:ב|מ)גב|שלוש\s+ה?ספרות"),
    _rx(FINANCIAL_ID, _B + _PFX + r"(?:תעודת\s+ה?זהות|מספר\s+ה?זהות|ת[\"'.]\s?ז\.?|דרכון)" + _E),
    _rx(FINANCIAL_ID, r"\bid\s+number\b|\bssn\b|\bsocial\s+security\b|\bpassport\b"),
    _rx(FINANCIAL_ID, _B + _PFX + r"(?:חשבון\s+ה?בנק|מספר\s+ה?חשבון|חשבון\s+בנקאי)"),
    _rx(FINANCIAL_ID, r"\biban\b|\bswift\b|\bbank\s+(?:account|details)\b|\brouting\s+number\b|\baccount\s+number\b"),
    # ---------------- sensitive: money / payments ----------------
    _rx(MONEY, _B + r"ו?(?:ה?העברה|העברת|להעביר|ת?עביר|תעבירי|העבר)\w*(?:\s+\S+){0,3}?\s+" + _PFX
        + r"(?:כסף|כספים|ביט|bit|paybox|פייבוקס|בנקאית|לחשבון|שקל|שקלים|ש\"ח|₪|\d{2,})"),
    _rx(MONEY, _B + r"(?:העברה|העברת)\s+(?:בנקאית|כספים|כסף)"),
    _rx(MONEY, _B + _PFX + r"(?:תשלום|תשלומים|לשלם|תשלם|תשלמי|תשלמו|שלמי|שילמת|לתשלום)" + _E),
    _rx(MONEY, _B + _PFX + r"(?:כסף|כספים)" + _E),
    _rx(MONEY, _B + _PFX + r"(?:ביט|פייבוקס|פיי\s?בוקס)" + _E),
    _rx(MONEY, r"\bpaybox\b|\bpaypal\b|\bvenmo\b|\bwire\s+transfer\b|\bmoney\b|\bpayment\b|\bpay\s+(?:me|you|for|the|it)\b"),
    _rx(MONEY, r"\b(?:via|by|on|in|through|with|over)\s+bit\b|\bbit\s+(?:me|transfer|payment|app)\b"),
    _rx(MONEY, _B + r"[ובל]bit\b|\bbit\s*(?:או|/)\s*(?:paybox|פייבוקס)"),
    _rx(MONEY, r"\btransfer\s+(?:me\s+)?(?:some\s+)?(?:\$|₪|€|\d|the\s+money|money|funds|cash)"),
    # ---------------- sensitive: address / location ----------------
    _rx(LOCATION, _B + _PFX + r"כתובת\s+(?:ה?מגורים|ה?בית|שלך|שלכם|שלה|שלו|ה?מדויקת|מגורים)"),
    _rx(LOCATION, _B + r"איפה\s+(?:את|אתה|אתם)\s+(?:גר|גרה|גרים)" + _E),
    _rx(LOCATION, _B + r"(?:ת?שלח|שלחי|לשלוח|ת?שתפ|שתפי|לשתף)\w*\s+(?:לי\s+)?(?:\S+\s+)?" + _PFX + r"מיקום"),
    _rx(LOCATION, _B + _PFX + r"מיקום\s+(?:חי|שלך|שלכם|נוכחי|מדויק)"),
    _rx(LOCATION, r"\bhome\s+address\b|\byour\s+address\b|\bwhere\s+do\s+you\s+live\b"),
    _rx(LOCATION, r"\b(?:live|current|exact|your|my)\s+location\b|\b(?:send|share|drop|pin)\s+(?:me\s+)?(?:your\s+|the\s+|a\s+)?location\b"),
)


# --- base64 payloads -----------------------------------------------------------------------
_B64_BLOB = re.compile(r"(?<![A-Za-z0-9+/=_\-])[A-Za-z0-9+/_\-]{40,}={0,2}(?![A-Za-z0-9+/=_\-])")
B64_MIN_DECODE_CHARS = 40
B64_LONG_BLOB_CHARS = 120
_MAX_B64_BLOBS = 8
_MAX_DECODE_DEPTH = 2


def _b64_decode_text(blob: str) -> str | None:
    """Decode a base64 / base64url blob to text if it is mostly printable, else None."""
    core = blob.rstrip("=")
    if len(core) % 4 == 1:
        return None
    padded = core + "=" * (-len(core) % 4)
    try:
        if "-" in core or "_" in core:
            raw = base64.urlsafe_b64decode(padded)
        else:
            raw = base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError):
        return None
    text = raw.decode("utf-8", errors="replace")
    if not text:
        return None
    printable = sum(1 for ch in text if ch.isprintable() or ch in "\n\r\t")
    return text if printable / len(text) >= 0.9 else None


def _looks_encoded(blob: str) -> bool:
    """A long run of base64 alphabet that is not just a repeated word ("hahaha…", "zzzz…")."""
    core = blob.rstrip("=")
    classes = sum(bool(re.search(p, core)) for p in (r"[A-Z]", r"[a-z]", r"[0-9]"))
    return classes >= 2 and len(set(core)) >= 16


def _encoded_categories(text: str, depth: int) -> set[str]:
    found: set[str] = set()
    for i, m in enumerate(_B64_BLOB.finditer(text)):
        if i >= _MAX_B64_BLOBS:
            break
        blob = m.group(0)
        if len(blob) >= B64_LONG_BLOB_CHARS and _looks_encoded(blob):
            found.add(ENCODED)
        if len(blob) < B64_MIN_DECODE_CHARS or depth >= _MAX_DECODE_DEPTH:
            continue
        decoded = _b64_decode_text(blob)
        if decoded is None:
            continue
        inner = categorize(decoded, _depth=depth + 1)
        if inner & _INJECTION_CATEGORIES:
            found |= inner | {ENCODED}
    return found


def _variants(norm: str) -> list[str]:
    """Normalized text plus its detection-only skeleton / leetspeak variants (deduplicated)."""
    out = [norm]
    skel = fold_homoglyphs(norm)
    for v in (skel, *fold_leet(skel)):
        if v not in out:
            out.append(v)
    return out


def categorize(text: str, *, _depth: int = 0) -> set[str]:
    """Return the set of risk categories detected in one piece of text."""
    norm = normalize_for_matching(text)
    if not norm:
        return set()
    variants = [(v, compact(v)) for v in _variants(norm)]
    found: set[str] = set()
    for rule in _RULES:
        if rule.category in found:
            continue
        for v, comp in variants:
            if rule.pattern.search(comp if rule.on_compact else v):
                found.add(rule.category)
                break
    if EXFIL in found or INJECTION in found:
        # "send me the password" style requests are also sensitive.
        if any(_CRED_HINT.search(v) for v, _ in variants):
            found.add(CREDENTIALS)
    # Base64 is case-sensitive: scan the original text, not the case-folded copy.
    found |= _encoded_categories(text, _depth)
    return found


_CRED_HINT = re.compile(fold_finals(r"סיסמ|קוד|password|passcode|otp|code"), re.IGNORECASE)


def analyze_incoming(
    messages: Sequence[InboundMessage], *, sender_display_name: str | None = None
) -> SafetyReport:
    """Analyze a burst of incoming messages (and the untrusted sender name). Pure, no I/O."""
    found: set[str] = set()
    for m in messages:
        found |= categorize(m.text or "")
    # Also catch an instruction split across consecutive messages ("ignore all" / "instructions").
    if len(messages) > 1:
        found |= categorize(" ".join(m.text or "" for m in messages))
    # The display name is chosen by the sender and reaches the model too (M-3).
    if sender_display_name:
        found |= categorize(sender_display_name)
    injection = bool(found & _INJECTION_CATEGORIES)
    sensitive = bool(found & {CREDENTIALS, FINANCIAL_ID, MONEY, LOCATION})
    notes = tuple(_NOTES[c] for c in _ORDER if c in found)
    return SafetyReport(injection_suspected=injection, sensitive_request=sensitive, notes=notes)
