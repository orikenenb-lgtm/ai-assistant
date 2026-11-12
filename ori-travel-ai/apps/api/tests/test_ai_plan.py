"""POST /api/ai/plan-trip: deterministic day-by-day plan grounded in activity search results."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.modules.ai import llm
from app.modules.ai.llm import FakeClient, LLMResult, get_llm_client
from app.modules.ai.planner import FREE_DAY_TITLE, MAX_PER_DAY, map_interests
from app.modules.providers import registry

TODAY = date.today()


def future(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.fixture(autouse=True)
def _clean():
    llm.reset_status_cache()
    registry.reset_registry()
    yield
    registry.reset_registry()


def plan(c, **kw):
    body = {"destination": "רומא", "start_date": future(30), "end_date": future(34), "interests": ["museum", "tour"],
            "adults": 2, "children_ages": [5]}
    body.update(kw)
    return c.post("/api/ai/plan-trip", json=body)


def activities(body):
    return [it for d in body["days"] for it in d["items"] if it["type"] == "activity"]


def test_plan_is_grounded_in_search_results_and_respects_rules(auth_client):
    c = auth_client("viewer")
    res = plan(c)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["destination"] == "רומא" and body["destination_code"] == "ROM"
    assert body["intro_mode"] == "template" and body["search_id"]
    assert len(body["days"]) == 5 and body["days"][0]["date"] == future(30)
    items = activities(body)
    assert items
    # every suggestion references a real offer from this search, with its card
    search_ids = {o["id"] for o in c.get(f"/api/search/{body['search_id']}").json()["offers"]}
    for it in items:
        assert it["offer_id"] in search_ids and it["card"]["id"] == it["offer_id"]
        assert it["card"]["source"]["mode"] == "DEMO"
        assert (it["card"]["details"]["min_age"] or 0) <= 5  # youngest child is 5
        assert it["card"]["details"]["family_friendly"] is not False
    # no repeats, <= 2 per day, arrival/departure days lighter
    ids = [it["offer_id"] for it in items]
    assert len(ids) == len(set(ids))
    for i, day in enumerate(body["days"]):
        acts = [it for it in day["items"] if it["type"] == "activity"]
        assert len(acts) <= (1 if i in (0, len(body["days"]) - 1) else MAX_PER_DAY)
        cats = [it["card"]["details"]["category"] for it in acts]
        assert len(cats) == len(set(cats))
        times = [it["start_time"] for it in acts if it["start_time"]]
        assert times == sorted(times)
    # interests rank first
    assert items[0]["card"]["details"]["category"] in ("museum", "tour")
    assert any("תחום העניין" in r for r in items[0]["reasons"])
    # no prices in the plan text itself
    assert "₪" not in body["intro"]


def test_long_trip_in_small_catalog_gets_free_days(auth_client):
    body = plan(auth_client("adult"), destination="Larnaca", start_date=future(20), end_date=future(40),
                interests=["water"], children_ages=[3]).json()
    assert len(body["days"]) == 21
    free = [d for d in body["days"] if d["items"][0]["type"] == "free"]
    assert free and free[0]["items"][0]["title"] == FREE_DAY_TITLE
    assert any("ימים חופשיים" in w for w in body["warnings"])


def test_model_intro_with_price_is_rejected_by_grounding(app, auth_client):
    app.dependency_overrides[get_llm_client] = lambda: FakeClient([LLMResult(text="טיול נהדר! הכניסה לוותיקן עולה 45 €.")])
    body = plan(auth_client("adult")).json()
    assert body["intro_mode"] == "template" and "45" not in body["intro"]
    assert body["grounding"]["ok"] is False and body["grounding"]["removed_claims"]


def test_clean_model_intro_is_used(app, auth_client):
    fake = FakeClient([LLMResult(text="חמישה ימים של מוזיאונים וסיורים ברומא, בקצב נוח למשפחה.")])
    app.dependency_overrides[get_llm_client] = lambda: fake
    body = plan(auth_client("adult")).json()
    assert body["intro_mode"] == "model" and body["intro"].startswith("חמישה ימים")
    assert fake.calls[0]["tools"] == [] and fake.calls[0]["tool_choice"] == "none"
    assert "<untrusted_supplier_data" in fake.calls[0]["messages"][0]["content"]


@pytest.mark.parametrize(
    "override",
    [
        {"start_date": future(10), "end_date": future(5)},
        {"start_date": future(10), "end_date": future(40)},
        {"adults": 0},
        {"children_ages": [18]},
        {"destination": "x"},
        {"start_date": "2020-01-01", "end_date": "2020-01-03"},
    ],
)
def test_plan_validation(auth_client, override):
    res = plan(auth_client("adult"), **override)
    assert res.status_code == 422, res.text


def test_interest_mapping_accepts_hebrew_and_reports_unknown():
    assert map_interests(["museum", "מוזיאונים", "אוכל", "beach", "טיפוס הרים"]) == (["museum", "food", "water"], ["טיפוס הרים"])
