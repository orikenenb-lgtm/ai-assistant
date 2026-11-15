"""Offline, deterministic engine for local development and tests. No network, no model."""

from __future__ import annotations

import re

from bridge_service.ai._text import detect_language, fold_finals, normalize_for_matching
from bridge_service.ai.base import DraftInput, DraftOutput
from bridge_service.ai.output_guard import finalize
from bridge_service.ai.safety import analyze_incoming

REPLIES = {
    "he": {
        "deflect": "היי, ראיתי את ההודעה. אחזור אליך בהמשך 🙏",
        "greeting": "היי! מה שלומך? 😊",
        "question": "שאלה טובה, אבדוק ואחזור אליך בהקדם",
        "thanks": "בכיף! 🙏",
        "default": "קיבלתי, אחזור אליך בהקדם 👍",
    },
    "en": {
        "deflect": "Hi, I saw your message. I'll get back to you later 🙏",
        "greeting": "Hi! How are you? 😊",
        "question": "Good question, I'll check and get back to you soon",
        "thanks": "You're welcome! 🙏",
        "default": "Got it, I'll get back to you soon 👍",
    },
}

_THANKS = re.compile(fold_finals(r"(?<!\w)(?:ו?תודה|תודות|תנקס|\bthanks?\b|\bthank\s+you\b|\bthx\b|\bty\b)|🙏"))
_GREETING = re.compile(fold_finals(
    r"(?<!\w)(?:היי|הי|שלום|אהלן|הלו|בוקר\s+טוב|ערב\s+טוב|לילה\s+טוב|מה\s+נשמע|מה\s+קורה|מה\s+שלומך|מה\s+המצב)(?!\w)"
    r"|\b(?:hi|hey|hello|yo|good\s+(?:morning|evening|afternoon))\b|👋"
))


def classify(data: DraftInput) -> str:
    """'greeting' | 'question' | 'thanks' | 'default', looking mostly at the latest message."""
    texts = [m.text or "" for m in sorted(data.messages, key=lambda m: m.sent_at)]
    last = normalize_for_matching(texts[-1]) if texts else ""
    if "?" in last or "؟" in last:
        return "question"
    if _THANKS.search(last):
        return "thanks"
    if any(_GREETING.search(normalize_for_matching(t)) for t in texts):
        return "greeting"
    return "default"


class StubEngine:
    name = "stub"

    async def draft(self, data: DraftInput) -> DraftOutput:
        report = analyze_incoming(data.messages)
        lang = "en" if detect_language(m.text for m in data.messages) == "en" else "he"
        if report.injection_suspected or report.sensitive_request:
            kind = "deflect"
        else:
            kind = classify(data)
        text = finalize(REPLIES[lang][kind], data, report)
        return DraftOutput(draft_text=text, safety=report, engine=self.name)

    async def aclose(self) -> None:
        return None
