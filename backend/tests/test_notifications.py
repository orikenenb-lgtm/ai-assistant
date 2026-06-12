"""בדיקות התראות (N1, N2, N3) — עם mock על שכבת ה-HTTP, בלי רשת אמיתית."""
import requests

from app.config import Settings
from app.services import notification_service
from app.services.notification_service import (
    NotifyResult,
    build_new_order_message,
    notify_new_order,
    send_email,
    send_telegram,
)


def _settings_with_channels(**overrides) -> Settings:
    base = dict(
        resend_api_key="re_test_key",
        admin_notification_email="aba@test.il",
        telegram_bot_token="123:abc",
        telegram_chat_id="42",
        _env_file=None,
    )
    base.update(overrides)
    return Settings(**base)


class FakeResponse:
    def __init__(self, status_code=200, text="ok"):
        self.status_code = status_code
        self.text = text


# ---------- N3: תוכן ההודעה ----------

def test_n3_message_contains_all_details():
    """N3: ההודעה כוללת שם לקוח, מספר הזמנה וסכום — בשני הערוצים."""
    subject, html, telegram_text = build_new_order_message(
        "חנות צעצועים חיפה", 123, 1234.5, 7)

    for content in (subject + html, telegram_text):
        assert "חנות צעצועים חיפה" in content
        assert "123" in content
    assert "1,234.50" in html
    assert "1,234.50" in telegram_text
    assert "7" in telegram_text


# ---------- N1: שני הערוצים נשלחים ----------

def test_n1_both_channels_sent(monkeypatch):
    """N1: הזמנה חדשה → גם אימייל וגם טלגרם יוצאים עם התוכן הנכון."""
    monkeypatch.setattr(notification_service, "get_settings", _settings_with_channels)
    calls: list[tuple] = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return FakeResponse(200)

    monkeypatch.setattr(notification_service.requests, "post", fake_post)
    result = notify_new_order("אלעד", 5, 500.0, 3)

    assert result == NotifyResult(email_sent=True, telegram_sent=True)
    assert len(calls) == 2
    assert "resend.com" in calls[0][0]
    assert "telegram.org" in calls[1][0]
    assert calls[1][1]["json"]["chat_id"] == "42"
    assert "אלעד" in calls[1][1]["json"]["text"]


# ---------- N2: כשל בערוץ אחד לא מפיל את השני ----------

def test_n2_email_failure_telegram_still_sent(monkeypatch):
    """N2: Resend נופל (exception) → הטלגרם עדיין נשלח."""
    monkeypatch.setattr(notification_service, "get_settings", _settings_with_channels)

    def fake_post(url, **kwargs):
        if "resend.com" in url:
            raise requests.ConnectionError("שרת המייל נפל")
        return FakeResponse(200)

    monkeypatch.setattr(notification_service.requests, "post", fake_post)
    result = notify_new_order("אלעד", 6, 100.0, 1)
    assert result.email_sent is False
    assert result.telegram_sent is True     # הערוץ השני שרד


def test_n2_telegram_failure_email_still_sent(monkeypatch):
    """N2 הפוך: טלגרם נופל → האימייל עדיין נשלח."""
    monkeypatch.setattr(notification_service, "get_settings", _settings_with_channels)

    def fake_post(url, **kwargs):
        if "telegram.org" in url:
            return FakeResponse(500, "Internal error")
        return FakeResponse(200)

    monkeypatch.setattr(notification_service.requests, "post", fake_post)
    result = notify_new_order("אלעד", 7, 100.0, 1)
    assert result.email_sent is True
    assert result.telegram_sent is False


# ---------- ערוצים לא מוגדרים — דילוג שקט, בלי קריסה ----------

def test_missing_config_skips_quietly(monkeypatch):
    """בלי מפתחות (dev) — שום ערוץ לא נשלח ושום דבר לא קורס."""
    monkeypatch.setattr(notification_service, "get_settings",
                        lambda: Settings(_env_file=None))
    called = []
    monkeypatch.setattr(notification_service.requests, "post",
                        lambda *a, **k: called.append(1) or FakeResponse(200))

    result = notify_new_order("אלעד", 8, 50.0, 1)
    assert result == NotifyResult(email_sent=False, telegram_sent=False)
    assert called == []     # אפס קריאות רשת


# ---------- send_email / send_telegram לא זורקים לעולם ----------

def test_send_functions_never_raise(monkeypatch):
    """גם על exception קשה — הפונקציות מחזירות False ולא מפילות את ההזמנה."""
    monkeypatch.setattr(notification_service, "get_settings", _settings_with_channels)

    def explode(*args, **kwargs):
        raise requests.Timeout("timeout!")

    monkeypatch.setattr(notification_service.requests, "post", explode)
    assert send_email("a@b.c", "נושא", "<p>תוכן</p>") is False
    assert send_telegram("הודעה") is False
