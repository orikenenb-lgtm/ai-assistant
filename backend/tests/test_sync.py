"""
בדיקות שירות הסנכרון (S1, S2, S3, S7 + dry-run) — עם repository בזיכרון
ולקוח Rivhit מזויף. בודקות את הלוגיקה: אפס כפילויות, עדכון בלבד, השבתה, לוגים.
"""
import pytest

from app.services.rivhit_service import RivhitError
from app.services.sync_service import SyncResult, SyncService


class FakeRivhit:
    """לקוח Rivhit מדומה — מחזיר נתונים מוכנים או זורק שגיאה."""

    def __init__(self, products: list[dict] | None = None,
                 customers: list[dict] | None = None,
                 error: RivhitError | None = None):
        self.products = products or []
        self.customers = customers or []
        self.error = error

    def get_products(self) -> list[dict]:
        if self.error:
            raise self.error
        return [dict(p) for p in self.products]

    def get_customers(self) -> list[dict]:
        if self.error:
            raise self.error
        return [dict(c) for c in self.customers]


class InMemoryRepo:
    """Repository בזיכרון — מדמה את הטבלאות עם אכיפת rivhit_id ייחודי."""

    def __init__(self):
        self.tables: dict[str, dict[int, dict]] = {"products": {}, "customers": {}}
        self.sync_logs: list[SyncResult] = []

    def list_rivhit_ids(self, table: str) -> set[int]:
        return set(self.tables[table].keys())

    def upsert(self, table: str, rows: list[dict]) -> None:
        for row in rows:
            existing = self.tables[table].get(row["rivhit_id"], {})
            self.tables[table][row["rivhit_id"]] = {**existing, **row}

    def deactivate_missing(self, table: str, present_ids: set[int]) -> int:
        count = 0
        for rid, row in self.tables[table].items():
            if rid not in present_ids and row.get("is_active", True):
                row["is_active"] = False
                count += 1
        return count

    def insert_sync_log(self, result: SyncResult) -> None:
        self.sync_logs.append(result)


def make_product(rid: int, name: str = "מוצר", price: float = 10.0) -> dict:
    return {"rivhit_id": rid, "name": name, "base_price": price, "sku": f"SKU-{rid}"}


# ---------- S1: סנכרון ראשון על DB ריק ----------

def test_s1_first_sync_creates_all():
    """S1: DB ריק → כל המוצרים נכנסים, אפס כפילויות."""
    repo = InMemoryRepo()
    rivhit = FakeRivhit(products=[make_product(1), make_product(2), make_product(3)])
    result = SyncService(rivhit, repo).sync_products(dry_run=False)

    assert result.status == "success"
    assert result.records_created == 3
    assert result.records_updated == 0
    assert len(repo.tables["products"]) == 3    # בדיוק 3 — אין כפילות


def test_s1_duplicate_ids_from_rivhit_are_merged():
    """S1: אם Rivhit עצמו מחזיר כפילות — מאוחדת לרשומה אחת."""
    repo = InMemoryRepo()
    rivhit = FakeRivhit(products=[make_product(1, "ישן"), make_product(1, "חדש")])
    result = SyncService(rivhit, repo).sync_products(dry_run=False)

    assert len(repo.tables["products"]) == 1
    assert repo.tables["products"][1]["name"] == "חדש"
    assert result.records_synced == 1


# ---------- S2: סנכרון חוזר — עדכון בלבד ----------

def test_s2_second_sync_updates_only():
    """S2: הרצה שנייה עם אותם מוצרים → 0 נוצרו, הכל עודכן, אין שורות כפולות."""
    repo = InMemoryRepo()
    service = SyncService(FakeRivhit(products=[make_product(1), make_product(2)]), repo)
    service.sync_products(dry_run=False)

    service2 = SyncService(
        FakeRivhit(products=[make_product(1, price=99.0), make_product(2)]), repo)
    result = service2.sync_products(dry_run=False)

    assert result.records_created == 0
    assert result.records_updated == 2
    assert len(repo.tables["products"]) == 2
    assert repo.tables["products"][1]["base_price"] == 99.0   # המחיר התעדכן


# ---------- S3: מוצר נמחק ב-Rivhit → is_active=false ----------

def test_s3_missing_product_deactivated():
    """S3: מוצר שלא חזר מ-Rivhit מסומן לא פעיל (לא נמחק!)."""
    repo = InMemoryRepo()
    SyncService(FakeRivhit(products=[make_product(1), make_product(2)]), repo) \
        .sync_products(dry_run=False)

    result = SyncService(FakeRivhit(products=[make_product(1)]), repo) \
        .sync_products(dry_run=False)

    assert result.records_deactivated == 1
    assert repo.tables["products"][2]["is_active"] is False
    assert repo.tables["products"][1]["is_active"] is True
    assert 2 in repo.tables["products"]         # עדיין קיים — לא נמחק


def test_s3_reappearing_product_reactivated():
    """מוצר שהושבת וחזר ב-Rivhit → חוזר להיות פעיל."""
    repo = InMemoryRepo()
    SyncService(FakeRivhit(products=[make_product(1)]), repo).sync_products(dry_run=False)
    SyncService(FakeRivhit(products=[]), repo).sync_products(dry_run=False)
    assert repo.tables["products"][1]["is_active"] is False

    SyncService(FakeRivhit(products=[make_product(1)]), repo).sync_products(dry_run=False)
    assert repo.tables["products"][1]["is_active"] is True


# ---------- S4: Rivhit נופל — לוג error, DB לא נגוע ----------

def test_s4_rivhit_error_logged_db_untouched():
    """S4: שגיאת Rivhit → status=error נרשם בלוג, הנתונים הקיימים לא נפגעים."""
    repo = InMemoryRepo()
    SyncService(FakeRivhit(products=[make_product(1)]), repo).sync_products(dry_run=False)

    result = SyncService(FakeRivhit(error=RivhitError("Rivhit לא זמין")), repo) \
        .sync_products(dry_run=False)

    assert result.status == "error"
    assert "לא זמין" in result.error_message
    assert repo.sync_logs[-1].status == "error"             # S7: גם כשלון מתועד
    assert repo.tables["products"][1]["is_active"] is True  # שום דבר לא הושבת


# ---------- S7: כל ריצה אמיתית נרשמת בלוג ----------

def test_s7_every_real_run_logged():
    """S7: אחרי כל sync אמיתי יש רשומה ב-sync_logs עם הסטטוס והמונים."""
    repo = InMemoryRepo()
    service = SyncService(FakeRivhit(products=[make_product(1)]), repo)
    service.sync_products(dry_run=False)
    service.sync_products(dry_run=False)

    assert len(repo.sync_logs) == 2
    assert repo.sync_logs[0].records_created == 1
    assert repo.sync_logs[1].records_updated == 1


# ---------- dry-run: אפס כתיבה ----------

def test_dry_run_writes_nothing():
    """Q1 (עקרון): dry-run מחזיר תצוגה מקדימה ולא נוגע ב-DB ולא בלוגים."""
    repo = InMemoryRepo()
    rivhit = FakeRivhit(products=[make_product(1), make_product(2)])
    result = SyncService(rivhit, repo).sync_products(dry_run=True)

    assert result.dry_run is True
    assert result.records_created == 2
    assert len(result.preview) == 2
    assert repo.tables["products"] == {}        # DB נשאר ריק
    assert repo.sync_logs == []                 # אפילו לוג לא נכתב


def test_dry_run_predicts_deactivation():
    """dry-run מנבא נכון גם כמה רשומות יושבתו — בלי להשבית בפועל."""
    repo = InMemoryRepo()
    SyncService(FakeRivhit(products=[make_product(1), make_product(2)]), repo) \
        .sync_products(dry_run=False)

    result = SyncService(FakeRivhit(products=[make_product(1)]), repo) \
        .sync_products(dry_run=True)

    assert result.records_deactivated == 1
    assert repo.tables["products"][2]["is_active"] is True  # לא הושבת בפועל


# ---------- סנכרון לקוחות — אותה לוגיקה ----------

def test_customers_sync():
    """סנכרון לקוחות עובד באותו מנגנון (S1 ללקוחות)."""
    repo = InMemoryRepo()
    rivhit = FakeRivhit(customers=[
        {"rivhit_id": 101, "name": "חנות צעצועים חיפה", "city": "חיפה"},
    ])
    result = SyncService(rivhit, repo).sync_customers(dry_run=False)

    assert result.sync_type == "customers"
    assert result.records_created == 1
    assert repo.tables["customers"][101]["name"] == "חנות צעצועים חיפה"
