"""
בדיקות הצעת מחיר (Q1-Q5) — הכתיבה היחידה ל-Rivhit.
לוגיקה טהורה + מפסק הבטיחות. אפס תקשורת אמיתית.
"""
import pytest

from app.config import Settings
from app.schemas.orders import OrderItemOut
from app.services import rivhit_service
from app.services.quote_service import (
    QuoteValidationError,
    build_preview,
    build_quote_items,
    confirmation_token,
    validate_order_quotable,
)
from app.services.rivhit_service import RivhitClient, RivhitError

ORDER = {"id": "ord-1", "order_number": 17, "status": "pending", "rivhit_quote_id": None}
ITEMS = [
    {"id": "i1", "product_id": "p-a", "quantity": 5, "unit_price": 99.90, "line_total": 499.50},
    {"id": "i2", "product_id": "p-b", "quantity": 2, "unit_price": 45.50, "line_total": 91.00},
]
RIVHIT_IDS = {"p-a": 1001, "p-b": 1002}


# ---------- Q4: חסימת כפילות וסטטוסים לא מתאימים ----------

def test_q4_existing_quote_blocked():
    """Q4: להזמנה כבר יש rivhit_quote_id → 409, אין הצעה כפולה."""
    order = {**ORDER, "rivhit_quote_id": 555}
    with pytest.raises(QuoteValidationError) as exc:
        validate_order_quotable(order, ITEMS, 101)
    assert exc.value.status_code == 409
    assert "כפולה" in str(exc.value)


@pytest.mark.parametrize("bad_status", ["quoted", "confirmed", "shipped", "closed", "cancelled"])
def test_q4_wrong_status_blocked(bad_status):
    """Q4: הצעה אפשרית רק מ-pending/reviewed."""
    order = {**ORDER, "status": bad_status}
    with pytest.raises(QuoteValidationError):
        validate_order_quotable(order, ITEMS, 101)


def test_empty_order_not_quotable():
    """הזמנה בלי שורות — אין מה להציע."""
    with pytest.raises(QuoteValidationError, match="אין שורות"):
        validate_order_quotable(dict(ORDER), [], 101)


def test_customer_without_rivhit_id_blocked():
    """לקוח לא מסונכרן — אי אפשר לפתוח עליו מסמך."""
    with pytest.raises(QuoteValidationError, match="מזהה Rivhit"):
        validate_order_quotable(dict(ORDER), ITEMS, None)


# ---------- בניית שורות המסמך ----------

def test_build_quote_items_maps_rivhit_ids():
    """שורות ההזמנה ממופות ל-item_id של Rivhit עם מחיר ה-snapshot."""
    quote_items = build_quote_items(ITEMS, RIVHIT_IDS)
    assert quote_items == [
        {"item_id": 1001, "quantity": 5, "price_nis": 99.90},
        {"item_id": 1002, "quantity": 2, "price_nis": 45.50},
    ]


def test_build_quote_items_missing_product_mapping():
    """מוצר בלי rivhit_id (לא סונכרן) → שגיאה ברורה, לא מסמך חסר."""
    with pytest.raises(QuoteValidationError, match="סנכרון מוצרים"):
        build_quote_items(ITEMS, {"p-a": 1001})    # p-b חסר


# ---------- Q1 + Q3: ה-preview וה-token ----------

def test_q1_preview_totals_and_token():
    """Q1: ה-preview מציג בדיוק את מה שיישלח + total + token לאישור."""
    quote_items = build_quote_items(ITEMS, RIVHIT_IDS)
    item_models = [OrderItemOut(
        id=i["id"], product_id=i["product_id"], product_name="מוצר",
        quantity=i["quantity"], unit_price=i["unit_price"], line_total=i["line_total"],
    ) for i in ITEMS]
    preview = build_preview(ORDER, item_models, "חנות חיפה", quote_items)

    assert preview["order_number"] == 17
    assert preview["customer_name"] == "חנות חיפה"
    assert preview["total"] == round(5 * 99.90 + 2 * 45.50, 2)
    assert len(preview["lines"]) == 2
    assert preview["confirmation_token"] == confirmation_token("ord-1", quote_items)


def test_q3_token_changes_when_order_changes():
    """Q3: שינוי בהזמנה (כמות/מחיר/שורה) → token שונה → האישור הישן נפסל."""
    base = build_quote_items(ITEMS, RIVHIT_IDS)
    token_before = confirmation_token("ord-1", base)

    changed_quantity = [dict(base[0], quantity=6), base[1]]
    changed_price = [dict(base[0], price_nis=89.90), base[1]]
    removed_line = [base[0]]

    for variant in (changed_quantity, changed_price, removed_line):
        assert confirmation_token("ord-1", variant) != token_before

    # אותו תוכן בדיוק → אותו token (דטרמיניסטי)
    assert confirmation_token("ord-1", build_quote_items(ITEMS, RIVHIT_IDS)) == token_before


# ---------- מפסק הבטיחות: כתיבה כבויה ----------

def test_write_disabled_blocks_create_quote(monkeypatch):
    """RIVHIT_WRITE_ENABLED=false (ברירת המחדל) → create_quote נחסם עוד לפני רשת."""
    monkeypatch.setattr(rivhit_service, "get_settings", lambda: Settings(
        rivhit_api_token="token-test", rivhit_write_enabled=False, _env_file=None))
    network_calls = []
    monkeypatch.setattr(rivhit_service.requests, "post",
                        lambda *a, **k: network_calls.append(1))

    client = RivhitClient(api_token="token-test")
    with pytest.raises(RivhitError, match="מושבתת"):
        client.create_quote(101, [{"item_id": 1, "quantity": 1, "price_nis": 10.0}])
    assert network_calls == []      # אפס תעבורה — נחסם לפני


# ---------- Q2 + Q5: יצירה מוצלחת וכשל ----------

class FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data

    def json(self):
        return self._json


def test_q2_create_quote_returns_document_id(monkeypatch):
    """Q2: כתיבה מופעלת + Rivhit מחזיר מסמך → מקבלים את המזהה."""
    monkeypatch.setattr(rivhit_service, "get_settings", lambda: Settings(
        rivhit_api_token="token-test", rivhit_write_enabled=True, _env_file=None))
    sent = {}

    def fake_post(url, json, timeout):
        sent.update(json)
        return FakeResponse(200, {"error_code": 0, "data": {"document_number": 777}})

    monkeypatch.setattr(rivhit_service.requests, "post", fake_post)
    client = RivhitClient(api_token="token-test")
    quote_id = client.create_quote(101, [{"item_id": 1001, "quantity": 5, "price_nis": 99.9}],
                                   comments="הזמנה #17")

    assert quote_id == 777
    assert sent["customer_id"] == 101
    assert sent["items"][0]["item_id"] == 1001
    assert "api_token" in sent


def test_q5_rivhit_failure_raises_cleanly(monkeypatch):
    """Q5: Rivhit מחזיר שגיאה עסקית → RivhitError ברור, בלי מזהה חלקי."""
    monkeypatch.setattr(rivhit_service, "get_settings", lambda: Settings(
        rivhit_api_token="token-test", rivhit_write_enabled=True, _env_file=None))
    monkeypatch.setattr(rivhit_service.requests, "post", lambda url, json, timeout:
                        FakeResponse(200, {"error_code": 9, "client_message": "לקוח חסום"}))

    client = RivhitClient(api_token="token-test")
    with pytest.raises(RivhitError, match="לקוח חסום"):
        client.create_quote(101, [{"item_id": 1, "quantity": 1, "price_nis": 10.0}])


def test_missing_document_id_raises(monkeypatch):
    """Rivhit "הצליח" אבל בלי מזהה מסמך → שגיאה שדורשת בדיקה ידנית."""
    monkeypatch.setattr(rivhit_service, "get_settings", lambda: Settings(
        rivhit_api_token="token-test", rivhit_write_enabled=True, _env_file=None))
    monkeypatch.setattr(rivhit_service.requests, "post", lambda url, json, timeout:
                        FakeResponse(200, {"error_code": 0, "data": {}}))

    client = RivhitClient(api_token="token-test")
    with pytest.raises(RivhitError, match="ידנית"):
        client.create_quote(101, [{"item_id": 1, "quantity": 1, "price_nis": 10.0}])


def test_document_id_preferred_over_document_number(monkeypatch):
    """document_id (המזהה הטכני) מנצח את document_number (ערך תצוגה)."""
    monkeypatch.setattr(rivhit_service, "get_settings", lambda: Settings(
        rivhit_api_token="token-test", rivhit_write_enabled=True, _env_file=None))
    monkeypatch.setattr(rivhit_service.requests, "post", lambda url, json, timeout:
                        FakeResponse(200, {"error_code": 0, "data": {
                            "document_id": 555, "document_number": "INV-2026/001"}}))

    client = RivhitClient(api_token="token-test")
    assert client.create_quote(101, [{"item_id": 1, "quantity": 1, "price_nis": 10.0}]) == 555


def test_non_numeric_document_number_clear_error(monkeypatch):
    """מזהה מפורמט שאינו מספר → שגיאה שמזהירה לא ליצור שוב (המסמך כבר קיים!)."""
    monkeypatch.setattr(rivhit_service, "get_settings", lambda: Settings(
        rivhit_api_token="token-test", rivhit_write_enabled=True, _env_file=None))
    monkeypatch.setattr(rivhit_service.requests, "post", lambda url, json, timeout:
                        FakeResponse(200, {"error_code": 0, "data": {
                            "document_number": "INV-2026/001"}}))

    client = RivhitClient(api_token="token-test")
    with pytest.raises(RivhitError, match="אל תיצור שוב"):
        client.create_quote(101, [{"item_id": 1, "quantity": 1, "price_nis": 10.0}])


def test_q3_token_ignores_row_order():
    """Q3: אותן שורות בסדר שונה מה-DB → אותו token (אין 409 שווא)."""
    items = build_quote_items(ITEMS, RIVHIT_IDS)
    assert confirmation_token("ord-1", items) == \
           confirmation_token("ord-1", list(reversed(items)))
