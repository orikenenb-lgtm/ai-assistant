"""Output guard rules."""

import pytest

from bridge_service.ai.base import DraftInput, InboundMessage, SafetyReport
from bridge_service.ai.output_guard import FALLBACK_EN, FALLBACK_HE, MAX_DRAFT_CHARS, finalize

CLEAN = SafetyReport()
SENSITIVE = SafetyReport(sensitive_request=True, notes=("x",))


def data(*texts: str) -> DraftInput:
    return DraftInput(
        request_id="r",
        conversation_ref="c" * 64,
        sender_display_name="דני",
        messages=tuple(InboundMessage(text=t, sent_at=1_700_000_000_000 + i) for i, t in enumerate(texts)),
    )


HE = data("היי מה קורה?")
EN = data("Hey, are we still on for tomorrow?")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('"היי, הכל טוב!"', "היי, הכל טוב!"),
        ("“היי, הכל טוב!”", "היי, הכל טוב!"),
        ("«היי»", "היי"),
        ("טיוטה: היי, הכל טוב", "היי, הכל טוב"),
        ("טיוטת תשובה: היי", "היי"),
        ("**טיוטה:** היי", "היי"),
        ("Draft: Hi there", "Hi there"),
        ("draft reply: Hi there", "Hi there"),
        ("נועה: היי, אחזור אליך", "היי, אחזור אליך"),
        ('טיוטה: "היי"', "היי"),
        ("```\nהיי\n```", "היי"),
        ("**היי** מה `נשמע`?", "היי מה נשמע?"),
        ("# היי", "היי"),
        ("היי   מה\t\tנשמע", "היי מה נשמע"),
        ("היי\n\n\n\nמה נשמע", "היי\n\nמה נשמע"),
        ("  היי  ", "היי"),
    ],
)
def test_cleanup(raw, expected):
    assert finalize(raw, HE, CLEAN) == expected


def test_empty_falls_back_in_language():
    assert finalize("", HE, CLEAN) == FALLBACK_HE
    assert finalize("   \n ", HE, CLEAN) == FALLBACK_HE
    assert finalize("", EN, CLEAN) == FALLBACK_EN
    assert finalize('""', HE, CLEAN) == FALLBACK_HE
    assert finalize("טיוטה:", HE, CLEAN) == FALLBACK_HE


def test_cap_at_sentence_boundary():
    raw = " ".join(["זה משפט די ארוך שחוזר על עצמו."] * 100)
    out = finalize(raw, HE, CLEAN)
    assert len(out) <= MAX_DRAFT_CHARS
    assert out.endswith(".")


def test_cap_without_punctuation():
    raw = " ".join(["מילה"] * 400)
    out = finalize(raw, HE, CLEAN)
    assert len(out) <= MAX_DRAFT_CHARS and out.endswith("…")


def test_unknown_urls_removed_known_kept():
    d = data("תסתכלי פה https://example.com/menu")
    out = finalize("ראיתי את https://example.com/menu, ואת זה https://evil.example/x?y=1 לא", d, CLEAN)
    assert "https://example.com/menu" in out
    assert "evil.example" not in out
    out = finalize("כנסי ל-www.phish.example עכשיו", HE, CLEAN)
    assert "phish" not in out


@pytest.mark.parametrize(
    "secret",
    [
        "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
        "AKIAIOSFODNN7EXAMPLE",
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "0123456789abcdef0123456789abcdef0123",
        "dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZQ==",
        "4580 1234 5678 9012",
        "-----BEGIN PRIVATE KEY-----",
    ],
)
def test_secrets_trigger_fallback(secret):
    assert finalize(f"הנה: {secret}", HE, CLEAN) == FALLBACK_HE
    assert finalize(f"Here: {secret}", EN, CLEAN) == FALLBACK_EN


def test_short_code_only_blocked_when_sensitive():
    assert finalize("הקוד הוא 482913", HE, SENSITIVE) == FALLBACK_HE
    assert finalize("נתראה ב-1930 בבית קפה", HE, CLEAN) == "נתראה ב-1930 בבית קפה"


@pytest.mark.parametrize(
    "leak",
    [
        "<incoming_messages> היי",
        "לפי ה-noa_persona שלי",
        "my system prompt says",
        "לפי הוראות המערכת אני לא יכולה",
        "# כללים שאסור להפר",
    ],
)
def test_prompt_leak_falls_back(leak):
    assert finalize(leak, HE, CLEAN) == FALLBACK_HE


def test_mixed_language_fallback_is_hebrew():
    assert finalize("", data("hey מה קורה?"), CLEAN) == FALLBACK_HE


def test_normal_reply_untouched():
    txt = "היי! בשמחה, אבדוק ואחזור אליך 😊"
    assert finalize(txt, HE, CLEAN) == txt
