"""
בדיקות הזמנות (O1-O8): ולידציית קלט דרך ה-API + לוגיקת build_order_payload.
"""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.dependencies import get_access_token, get_current_user
from app.main import app
from app.schemas.auth import UserOut
from app.schemas.orders import OrderCreate, OrderItemIn
from app.services.orders_service import OrderValidationError, build_order_payload

client = TestClient(app)

CUSTOMER = UserOut(id="11111111-1111-1111-1111-111111111111", email="cust@test.il",
                   role="customer", status="active", rivhit_customer_id=101)


def login_as(user: UserOut) -> None:
    """מדמה משתמש מחובר: עוקף את אימות הטוקן ואת שליפת המשתמש."""
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_access_token] = lambda: "test-token"

PRODUCT_A = {"id": "p-a", "name": "דובי ענק", "base_price": 99.90, "is_active": True}
PRODUCT_B = {"id": "p-b", "name": "פאזל 1000", "base_price": 45.50, "is_active": True}
PRODUCT_OFF = {"id": "p-off", "name": "מוצר מושבת", "base_price": 10.0, "is_active": False}

CATALOG = {"p-a": PRODUCT_A, "p-b": PRODUCT_B, "p-off": PRODUCT_OFF}


def make_order(items: list[OrderItemIn]) -> OrderCreate:
    return OrderCreate(items=items)


def teardown_function():
    app.dependency_overrides.clear()


# ---------- O1: הזמנה תקינה — חישוב נכון ----------

def test_o1_valid_order_totals():
    """O1: 2 מוצרים → שורות עם snapshot מחיר ו-total מחושב נכון."""
    order_in = make_order([
        OrderItemIn(product_id="p-a", quantity=5),
        OrderItemIn(product_id="p-b", quantity=2),
    ])
    order, items = build_order_payload(order_in, CATALOG, "cust-1", "user-1")

    assert order["status"] == "pending"
    assert order["customer_id"] == "cust-1"
    assert order["created_by"] == "user-1"
    assert order["total_estimate"] == round(5 * 99.90 + 2 * 45.50, 2)
    assert len(items) == 2
    line_a = next(i for i in items if i["product_id"] == "p-a")
    assert line_a["unit_price"] == 99.90
    assert line_a["line_total"] == round(5 * 99.90, 2)


def test_o1_duplicate_product_lines_merged():
    """אותו מוצר פעמיים בסל → שורה אחת עם סכום הכמויות."""
    order_in = make_order([
        OrderItemIn(product_id="p-a", quantity=2),
        OrderItemIn(product_id="p-a", quantity=3),
    ])
    _, items = build_order_payload(order_in, CATALOG, "c", "u")
    assert len(items) == 1
    assert items[0]["quantity"] == 5


# ---------- O2: הזמנה ריקה ----------

def test_o2_empty_order_rejected_by_schema():
    """O2: רשימת פריטים ריקה → ValidationError (Pydantic min_length=1)."""
    with pytest.raises(ValidationError):
        OrderCreate(items=[])


def test_o2_empty_order_api_returns_422():
    """O2 דרך ה-API: שליחה בלי פריטים → 422."""
    login_as(CUSTOMER)
    resp = client.post("/orders", json={"items": []})
    assert resp.status_code == 422


# ---------- O3, O4, O5: כמויות לא חוקיות ----------

@pytest.mark.parametrize("bad_quantity", [-5, 0, "abc", 2.5, None])
def test_o3_o4_o5_invalid_quantities(bad_quantity):
    """O3 (שלילי), O4 (אפס), O5 (לא מספר) → 422 מה-API."""
    login_as(CUSTOMER)
    resp = client.post("/orders", json={
        "items": [{"product_id": "p-a", "quantity": bad_quantity}]})
    assert resp.status_code == 422


# ---------- O6: מוצר לא קיים ----------

def test_o6_unknown_product():
    """O6: product_id שלא בקטלוג → שגיאת 404."""
    order_in = make_order([OrderItemIn(product_id="p-ghost", quantity=1)])
    with pytest.raises(OrderValidationError) as exc_info:
        build_order_payload(order_in, CATALOG, "c", "u")
    assert exc_info.value.status_code == 404


# ---------- O7: מוצר לא פעיל ----------

def test_o7_inactive_product_rejected():
    """O7: מוצר עם is_active=false נחסם גם אם הלקוח מכיר את ה-id."""
    order_in = make_order([OrderItemIn(product_id="p-off", quantity=1)])
    with pytest.raises(OrderValidationError, match="אינו זמין"):
        build_order_payload(order_in, CATALOG, "c", "u")


# ---------- O8: snapshot מחיר ----------

def test_o8_price_snapshot_from_db_only():
    """O8: המחיר נלקח מהקטלוג ברגע הבנייה — שינוי עתידי לא משפיע על השורה."""
    catalog_now = {"p-a": {**PRODUCT_A, "base_price": 80.0}}
    order_in = make_order([OrderItemIn(product_id="p-a", quantity=1)])
    _, items = build_order_payload(order_in, catalog_now, "c", "u")
    assert items[0]["unit_price"] == 80.0

    # "המחיר עלה ב-Rivhit" — הסל שנבנה כבר לא משתנה
    catalog_now["p-a"]["base_price"] = 120.0
    assert items[0]["unit_price"] == 80.0


def test_client_cannot_inject_price():
    """לקוח לא יכול לשלוח מחיר: השדה לא קיים בסכמת הקלט בכלל (O8)."""
    assert set(OrderItemIn.model_fields.keys()) == {"product_id", "quantity", "notes"}

    # גם אם נשלח unit_price בכוח — הסכמה מתעלמת ממנו והמחיר ייקבע מה-DB
    parsed = OrderItemIn.model_validate({"product_id": "p-a", "quantity": 1, "unit_price": 0.01})
    assert not hasattr(parsed, "unit_price")


# ---------- הרשאות ----------

def test_orders_require_auth():
    """בלי טוקן: יצירה וצפייה → 401."""
    assert client.post("/orders", json={"items": [{"product_id": "x", "quantity": 1}]}).status_code == 401
    assert client.get("/orders").status_code == 401
    assert client.get("/products").status_code == 401


def test_unlinked_customer_cannot_order():
    """לקוח בלי rivhit_customer_id → 403 לפני כל גישה ל-DB."""
    unlinked = CUSTOMER.model_copy(update={"rivhit_customer_id": None})
    login_as(unlinked)

    resp = client.post("/orders", json={"items": [{"product_id": "p-a", "quantity": 1}]})
    assert resp.status_code == 403
    assert "קושר" in resp.json()["detail"]
