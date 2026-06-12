"""בדיקות ה-endpoint של הסנכרון: הרשאות אדמין + dry-run כברירת מחדל."""
from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app
from app.routers.admin_sync import get_sync_service
from app.schemas.auth import UserOut
from app.services.sync_service import SyncResult

client = TestClient(app)

CUSTOMER = UserOut(id="11111111-1111-1111-1111-111111111111", email="cust@test.il",
                   role="customer", status="active")
ADMIN = UserOut(id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email="admin@test.il",
                role="admin", status="active")


class FakeSyncService:
    """שירות סנכרון מדומה — רק מתעד עם מה קראו לו."""

    def __init__(self):
        self.calls: list[tuple[str, bool]] = []

    def sync_products(self, dry_run: bool) -> SyncResult:
        self.calls.append(("products", dry_run))
        return SyncResult(sync_type="products", dry_run=dry_run, records_synced=5)

    def sync_customers(self, dry_run: bool) -> SyncResult:
        self.calls.append(("customers", dry_run))
        return SyncResult(sync_type="customers", dry_run=dry_run, records_synced=2)


def teardown_function():
    app.dependency_overrides.clear()


def test_customer_cannot_sync():
    """רק admin מסנכרן — customer מקבל 403 (אכיפת שכבה 2)."""
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER
    resp = client.post("/admin/sync", json={})
    assert resp.status_code == 403


def test_anonymous_cannot_sync():
    """בלי טוקן בכלל → 401."""
    resp = client.post("/admin/sync", json={})
    assert resp.status_code == 401


def test_admin_sync_defaults_to_dry_run():
    """ברירת המחדל היא dry_run=true — בטיחות לפני הכל."""
    fake = FakeSyncService()
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_sync_service] = lambda: fake

    resp = client.post("/admin/sync", json={})
    assert resp.status_code == 200
    assert fake.calls == [("products", True), ("customers", True)]
    assert all(item["dry_run"] for item in resp.json())


def test_admin_real_sync_specific_type():
    """sync_type=products עם dry_run=false → ריצה אמיתית של מוצרים בלבד."""
    fake = FakeSyncService()
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_sync_service] = lambda: fake

    resp = client.post("/admin/sync", json={"sync_type": "products", "dry_run": False})
    assert resp.status_code == 200
    assert fake.calls == [("products", False)]


def test_invalid_sync_type_rejected():
    """sync_type לא מוכר → 422 (ולידציית Pydantic), השירות לא מופעל."""
    fake = FakeSyncService()
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_sync_service] = lambda: fake
    resp = client.post("/admin/sync", json={"sync_type": "everything"})
    assert resp.status_code == 422
    assert fake.calls == []
