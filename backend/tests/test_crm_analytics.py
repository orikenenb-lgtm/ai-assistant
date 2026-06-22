"""בדיקות אגרגציה ל-CRM analytics/insights — עם client מזויף, בלי Supabase.
מאמת שהחישובים נכונים ושאין קריסה/חלוקה-באפס על נתונים ריקים."""
from app.routers import crm


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class _FakeClient:
    def __init__(self, data):
        self._data = data

    def table(self, name):
        return _FakeQuery(self._data.get(name, []))


def _patch(monkeypatch, data):
    monkeypatch.setattr(crm, "_client", lambda: _FakeClient(data))


def test_analytics_summary_aggregates(monkeypatch):
    _patch(monkeypatch, {
        "crm_sales": [
            {"deal_id": "d1", "amount": 100, "profit": 40, "cost": 60, "sold_at": "2026-06-01T00:00:00+00:00", "channel": "phone"},
            {"deal_id": "d2", "amount": 50, "profit": 20, "cost": 30, "sold_at": "2026-06-02T00:00:00+00:00", "channel": "whatsapp"},
        ],
        "crm_deals": [
            {"id": "d1", "category_id": "c1", "customer_id": "cu1", "channel": "phone", "reason": "מבצע"},
            {"id": "d2", "category_id": "c1", "customer_id": "cu1", "channel": "whatsapp", "reason": "חוזר"},
        ],
        "crm_categories": [{"id": "c1", "name": "בובות"}],
        "crm_customers": [{"id": "cu1", "name": "חנות א"}],
    })
    out = crm.analytics_summary(_=None, frm=None, to=None, category=None, channel=None, reason=None)
    assert out["kpis"]["total_sales"] == 150
    assert out["kpis"]["deals"] == 2
    assert out["kpis"]["profit"] == 60
    assert out["kpis"]["avg_deal"] == 75
    assert {b["label"] for b in out["by_channel"]} == {"phone", "whatsapp"}
    assert out["by_category"][0]["label"] == "בובות"


def test_analytics_empty_no_crash(monkeypatch):
    """נתונים ריקים → אפסים, בלי חלוקה באפס."""
    _patch(monkeypatch, {})
    out = crm.analytics_summary(_=None, frm=None, to=None, category=None, channel=None, reason=None)
    assert out["kpis"]["total_sales"] == 0 and out["kpis"]["avg_deal"] == 0


def test_insights_empty_no_crash(monkeypatch):
    """לידים/נציגים/גבייה ריקים → לא מתרסק, אחוזים 0."""
    _patch(monkeypatch, {})
    assert crm.insights_leads(_=None, frm=None, to=None)["kpis"]["conversion"] == 0.0
    assert crm.insights_reps(_=None)["leaderboard"] == []
    assert crm.insights_collections(_=None)["kpis"]["collection_rate"] == 0.0


def test_insights_collections_aging(monkeypatch):
    """דלי גיל בגבייה + שיעור גבייה מחושבים נכון."""
    _patch(monkeypatch, {
        "crm_invoices": [
            {"customer_id": "cu1", "amount": 1000, "paid_amount": 400, "due_date": "2020-01-01", "paid_at": None, "created_at": "2020-01-01"},
        ],
        "crm_customers": [{"id": "cu1", "name": "חנות א"}],
    })
    out = crm.insights_collections(_=None)
    assert out["kpis"]["billed"] == 1000 and out["kpis"]["collected"] == 400
    assert out["kpis"]["outstanding"] == 600
    assert len(out["overdue"]) == 1 and out["overdue"][0]["amount"] == 600
