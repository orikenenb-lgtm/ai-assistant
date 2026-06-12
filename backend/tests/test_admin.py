"""בדיקות דשבורד אדמין: מעברי סטטוס, הרשאות, ולידציית קלט."""
import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_access_token, get_current_user
from app.main import app
from app.schemas.admin import OrderUpdateRequest
from app.schemas.auth import UserOut
from app.services.admin_service import (
    StatusTransitionError,
    build_order_update,
)

client = TestClient(app)

CUSTOMER = UserOut(id="11111111-1111-1111-1111-111111111111", email="cust@test.il",
                   role="customer", status="active", rivhit_customer_id=101)
ADMIN = UserOut(id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email="admin@test.il",
                role="admin", status="active")


def teardown_function():
    app.dependency_overrides.clear()


# ---------- לוגיקת מעברי סטטוס ----------

def test_valid_transition_sets_timestamp():
    """pending → quoted: הסטטוס מתעדכן ו-quoted_at נקבע אוטומטית."""
    fields = build_order_update("pending", OrderUpdateRequest(status="quoted"))
    assert fields["status"] == "quoted"
    assert "quoted_at" in fields


def test_full_lifecycle_transitions():
    """כל שרשרת החיים: pending→reviewed→quoted→confirmed→shipped→closed."""
    chain = ["pending", "reviewed", "quoted", "confirmed", "shipped", "closed"]
    for current, nxt in zip(chain, chain[1:]):
        fields = build_order_update(current, OrderUpdateRequest(status=nxt))
        assert fields["status"] == nxt


@pytest.mark.parametrize("current,target", [
    ("closed", "pending"),      # אי אפשר להחיות הזמנה סגורה
    ("cancelled", "confirmed"), # מבוטלת נשארת מבוטלת
    ("pending", "shipped"),     # אין דילוג על שלבים
    ("shipped", "pending"),
])
def test_invalid_transitions_blocked(current, target):
    """מעברים לא הגיוניים נחסמים עם שגיאה ברורה."""
    with pytest.raises(StatusTransitionError):
        build_order_update(current, OrderUpdateRequest(status=target))


def test_same_status_is_noop():
    """אותו סטטוס שוב — לא שגיאה, פשוט אין שינוי סטטוס."""
    fields = build_order_update("pending", OrderUpdateRequest(status="pending"))
    assert "status" not in fields


def test_notes_update_without_status():
    """עדכון הערות בלבד — בלי לגעת בסטטוס."""
    fields = build_order_update("quoted", OrderUpdateRequest(admin_notes="ללקוח יש הנחה"))
    assert fields == {"admin_notes": "ללקוח יש הנחה"}


def test_cancel_from_any_active_status():
    """ביטול אפשרי מכל סטטוס פעיל (עד confirmed)."""
    for current in ["pending", "reviewed", "quoted", "confirmed"]:
        fields = build_order_update(current, OrderUpdateRequest(status="cancelled"))
        assert fields["status"] == "cancelled"


# ---------- הרשאות (A3 על כל ה-endpoints החדשים) ----------

ADMIN_ENDPOINTS = [
    ("GET", "/admin/stats"),
    ("GET", "/admin/orders"),
    ("GET", "/admin/orders/00000000-0000-0000-0000-000000000000"),
    ("PATCH", "/admin/orders/00000000-0000-0000-0000-000000000000"),
    ("GET", "/admin/customers"),
    ("POST", "/admin/customers/invite"),
    ("GET", "/admin/users"),
    ("PATCH", "/admin/users/00000000-0000-0000-0000-000000000000"),
]


@pytest.mark.parametrize("method,path", ADMIN_ENDPOINTS)
def test_customer_blocked_from_all_admin_endpoints(method, path):
    """A3: לקוח מנסה כל endpoint אדמין → 403 תמיד."""
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER
    app.dependency_overrides[get_access_token] = lambda: "test-token"
    resp = client.request(method, path, json={})
    assert resp.status_code == 403, f"{method} {path} החזיר {resp.status_code}"


@pytest.mark.parametrize("method,path", ADMIN_ENDPOINTS)
def test_anonymous_blocked_from_all_admin_endpoints(method, path):
    """בלי טוקן → 401 על כל endpoint אדמין."""
    resp = client.request(method, path, json={})
    assert resp.status_code == 401, f"{method} {path} החזיר {resp.status_code}"


# ---------- ולידציית קלט ----------

def test_invalid_status_value_rejected():
    """סטטוס לא מוכר ב-PATCH → 422 עוד לפני שנוגעים ב-DB."""
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_access_token] = lambda: "test-token"
    resp = client.patch("/admin/orders/00000000-0000-0000-0000-000000000000",
                        json={"status": "סטטוס-מומצא"})
    assert resp.status_code == 422


def test_invite_requires_valid_email():
    """הזמנת לקוח עם אימייל שגוי → 422."""
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_access_token] = lambda: "test-token"
    resp = client.post("/admin/customers/invite",
                       json={"email": "לא-אימייל", "rivhit_customer_id": 101})
    assert resp.status_code == 422


def test_negative_final_total_rejected():
    """סכום סופי שלילי → 422."""
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_access_token] = lambda: "test-token"
    resp = client.patch("/admin/orders/00000000-0000-0000-0000-000000000000",
                        json={"final_total": -50})
    assert resp.status_code == 422
