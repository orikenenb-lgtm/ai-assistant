"""
בדיקות לקוח Rivhit (S4, S5, S6) — מדמות את שרת Rivhit עם mock על requests.post.
אף בדיקה לא יוצרת תעבורת רשת אמיתית; ההמתנות (sleep) מדומות.
"""
import pytest
import requests

from app.services import rivhit_service
from app.services.rivhit_service import RivhitClient, RivhitError


class FakeResponse:
    def __init__(self, status_code: int = 200, json_data: dict | None = None,
                 invalid_json: bool = False):
        self.status_code = status_code
        self._json = json_data
        self._invalid = invalid_json

    def json(self):
        if self._invalid:
            raise ValueError("not json")
        return self._json


@pytest.fixture
def no_sleep(monkeypatch):
    """אוסף את זמני ההמתנה במקום לישון באמת — הבדיקות רצות מיידית."""
    delays: list[int] = []
    monkeypatch.setattr(rivhit_service.time, "sleep", lambda s: delays.append(s))
    return delays


@pytest.fixture
def client():
    return RivhitClient(api_token="token-test", base_url="https://rivhit.fake/api/v3")


# ---------- תקין ----------

def test_get_products_maps_fields(monkeypatch, client):
    """תשובת Item.List תקינה ממופה לסכמה הפנימית."""
    payload = {"error_code": 0, "client_message": "", "data": {"item_list": [{
        "item_id": 7, "item_name": "דובי ענק", "barcode": "729000111",
        "sale_nis": 99.9, "cost_nis": 40, "quantity": 12,
        "item_group_name": "בובות", "item_unit_name": "יח'",
    }]}}
    monkeypatch.setattr(rivhit_service.requests, "post",
                        lambda url, json, timeout: FakeResponse(200, payload))
    products = client.get_products()
    assert products == [{
        "rivhit_id": 7, "sku": "729000111", "name": "דובי ענק", "category": "בובות",
        "description": None, "base_price": 99.9, "cost_price": 40.0,
        "stock_quantity": 12, "unit": "יח'",
    }]


# ---------- S4: Rivhit נופל — retry ואז שגיאה מסודרת ----------

def test_s4_network_failure_retries_then_fails(monkeypatch, client, no_sleep):
    """S4: תקלת רשת מתמשכת → 5 ניסיונות (1+4 חוזרים) ואז RivhitError."""
    calls = {"count": 0}

    def fail(url, json, timeout):
        calls["count"] += 1
        raise requests.ConnectionError("הרשת נפלה")

    monkeypatch.setattr(rivhit_service.requests, "post", fail)
    with pytest.raises(RivhitError, match="לא זמין"):
        client.get_products()
    assert calls["count"] == 5
    assert no_sleep == [1, 2, 4, 8]     # exponential backoff מדויק


def test_s4_recovers_after_transient_failure(monkeypatch, client, no_sleep):
    """S4: תקלה חולפת → הניסיון השני מצליח, אין שגיאה."""
    payload = {"error_code": 0, "data": {"item_list": []}}
    responses = [requests.Timeout("timeout"), FakeResponse(200, payload)]

    def flaky(url, json, timeout):
        result = responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(rivhit_service.requests, "post", flaky)
    assert client.get_products() == []
    assert no_sleep == [1]


# ---------- S5: תשובה שגויה — לא שומרים, שגיאה ברורה ----------

def test_s5_non_json_response(monkeypatch, client, no_sleep):
    """S5: תשובה קטומה (לא JSON) → RivhitError מיידי, בלי retry מיותר."""
    monkeypatch.setattr(rivhit_service.requests, "post",
                        lambda url, json, timeout: FakeResponse(200, invalid_json=True))
    with pytest.raises(RivhitError, match="לא JSON"):
        client.get_products()


def test_s5_unknown_structure(monkeypatch, client):
    """S5: JSON בלי error_code → מבנה לא מוכר → שגיאה."""
    monkeypatch.setattr(rivhit_service.requests, "post",
                        lambda url, json, timeout: FakeResponse(200, {"foo": "bar"}))
    with pytest.raises(RivhitError, match="מבנה לא מוכר"):
        client.get_products()


def test_s5_business_error_code(monkeypatch, client):
    """S5: error_code != 0 (למשל טוקן שגוי) → שגיאה עם ההודעה של Rivhit."""
    payload = {"error_code": 3, "client_message": "טוקן לא תקין"}
    monkeypatch.setattr(rivhit_service.requests, "post",
                        lambda url, json, timeout: FakeResponse(200, payload))
    with pytest.raises(RivhitError, match="טוקן לא תקין"):
        client.get_products()


# ---------- S6: rate limit → backoff ----------

def test_s6_rate_limit_backoff(monkeypatch, client, no_sleep):
    """S6: שתי תשובות 429 ואז הצלחה → ממתינים 1s, 2s וממשיכים."""
    payload = {"error_code": 0, "data": {"item_list": []}}
    responses = [FakeResponse(429), FakeResponse(429), FakeResponse(200, payload)]
    monkeypatch.setattr(rivhit_service.requests, "post",
                        lambda url, json, timeout: responses.pop(0))
    assert client.get_products() == []
    assert no_sleep == [1, 2]


# ---------- 4xx קבוע — בלי retry ----------

def test_permanent_4xx_no_retry(monkeypatch, client, no_sleep):
    """401/403 מ-Rivhit — בעיה קבועה: נכשלים מיד בלי לנסות שוב."""
    calls = {"count": 0}

    def forbidden(url, json, timeout):
        calls["count"] += 1
        return FakeResponse(403)

    monkeypatch.setattr(rivhit_service.requests, "post", forbidden)
    with pytest.raises(RivhitError):
        client.get_products()
    assert calls["count"] == 1
    assert no_sleep == []


# ---------- טוקן חסר ----------

def test_missing_token_fails_fast(monkeypatch):
    """בלי RIVHIT_API_TOKEN — שגיאה ברורה מיד ביצירת הלקוח."""
    from app.config import Settings, get_settings
    monkeypatch.setattr(rivhit_service, "get_settings",
                        lambda: Settings(rivhit_api_token="", _env_file=None))
    with pytest.raises(RivhitError, match="RIVHIT_API_TOKEN"):
        RivhitClient()
