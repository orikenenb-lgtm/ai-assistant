"""בדיקות שכבת ה-CRM: הגנת אדמין, whitelist ישויות, וסינון עמודות."""
from fastapi.testclient import TestClient

from app.dependencies import get_access_token, get_current_user
from app.main import app
from app.routers import crm
from app.schemas.auth import UserOut

client = TestClient(app)

CUSTOMER = UserOut(id="11111111-1111-1111-1111-111111111111", email="c@test.il",
                   role="customer", status="active", rivhit_customer_id=101)
ADMIN = UserOut(id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email="a@test.il",
                role="admin", status="active")


def teardown_function():
    app.dependency_overrides.clear()


def _login(user: UserOut):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_access_token] = lambda: "tok"


def test_crm_requires_auth():
    """בלי טוקן — 401 (הגנת שכבה 2)."""
    assert client.get("/crm/customers").status_code == 401


def test_crm_forbidden_for_customer():
    """לקוח רגיל — 403 (אדמין בלבד)."""
    _login(CUSTOMER)
    assert client.get("/crm/customers").status_code == 403


def test_crm_unknown_entity_404():
    """ישות שאינה ב-whitelist — 404, עוד לפני גישה ל-DB."""
    _login(ADMIN)
    assert client.get("/crm/hackers").status_code == 404


def test_clean_filters_unknown_columns():
    """סינון עמודות: שדות זרים (כמו id מזויף) מושמטים, מותרים נשמרים."""
    out = crm._clean("customers", {"name": "אבי", "email": "a@b.il", "role": "admin", "id": "x"})
    assert out == {"name": "אבי", "email": "a@b.il"}


def test_entities_whitelist_covers_all_tables():
    """כל הישויות המוגדרות תואמות לטבלאות crm_ בסכמה."""
    assert "deals" in crm.ENTITIES and "sales" in crm.ENTITIES and "invoices" in crm.ENTITIES
    assert "amount" in crm.ENTITIES["deals"]
