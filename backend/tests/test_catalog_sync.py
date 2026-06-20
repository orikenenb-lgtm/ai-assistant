"""בדיקות לוגיקת סנכרון הקטלוג — עם repo מזויף ובלי רשת."""
from app.catalog import rivhit_readonly as ro
from app.catalog.sync import sync_catalog


class FakeRepo:
    def __init__(self):
        self.rows: list[dict] | None = None

    def upsert(self, rows: list[dict]) -> None:
        self.rows = rows


def test_sync_maps_and_upserts(monkeypatch):
    """מיפוי + upsert; פריט בלי מזהה מסונן."""
    monkeypatch.setattr(ro, "get_items", lambda: [
        {"item_id": 1, "item_name": "דובי", "sale_nis": 25.5, "quantity": 10},
        {"item_id": 2, "item_name": "כדור", "sale_nis": 9.9, "quantity": 0},
        {"item_name": "ללא מזהה"},
    ])
    repo = FakeRepo()
    result = sync_catalog(repo)
    assert result["synced"] == 2
    assert len(repo.rows) == 2
    assert repo.rows[0]["rivhit_item_id"] == "1"
    assert repo.rows[0]["name"] == "דובי"
    assert "last_synced_at" in repo.rows[0]


def test_sync_empty(monkeypatch):
    monkeypatch.setattr(ro, "get_items", lambda: [])
    repo = FakeRepo()
    assert sync_catalog(repo)["synced"] == 0
