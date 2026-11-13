"""Search HTTP API: auth, validation (Hebrew 422), serialization, re-rank, history isolation, rate limit."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.modules.providers import registry
from app.modules.providers.service import reset_health_cache

TODAY = date.today()


def future(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()


FLIGHT = {"origin": "TLV", "destination": "LCA", "depart_date": future(25), "return_date": future(29), "adults": 2,
          "children_ages": [5]}


def test_search_requires_auth(client):
    assert client.post("/api/search/flight", json=FLIGHT).status_code == 401
    assert client.get("/api/search/history").status_code == 401
    assert client.get("/api/offers/abc").status_code == 401
    assert client.get("/api/search/abc").status_code == 401


def test_viewer_can_search_and_money_is_serialized_as_strings(auth_client):
    c = auth_client("viewer")
    res = c.post("/api/search/flight", json=FLIGHT)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["category"] == "flight" and body["status"] == "completed"
    assert body["params"]["origin"] == "TLV"
    assert body["has_demo_results"] is True
    offer = body["offers"][0]
    assert isinstance(offer["price"]["total"]["amount"], str)
    Decimal(offer["price"]["total"]["amount"])
    assert all(isinstance(comp["amount"]["amount"], str) for comp in offer["price"]["components"])
    assert isinstance(offer["score"]["total"], str) and offer["score"]["rank"] == 1
    assert offer["source"]["mode"] == "DEMO" and offer["source"]["deep_link"] is None
    assert offer["details"]["slices"][0]["departing_at"].endswith(("+02:00", "+03:00"))
    detail = c.get(f"/api/offers/{offer['id']}")
    assert detail.status_code == 200 and detail.json()["price"] == offer["price"]
    assert c.get("/api/offers/does-not-exist").status_code == 404


@pytest.mark.parametrize(
    ("category", "body", "needle"),
    [
        ("flight", {"origin": "TLV", "destination": "ATH", "depart_date": "2020-01-01"}, "עבר"),
        ("flight", {"origin": "TLV", "destination": "ATH", "depart_date": future(20), "adults": 1,
                    "children_ages": [0, 1]}, "תינוק"),
        ("flight", {"origin": "TLV", "destination": "TLV", "depart_date": future(20)}, "שונים"),
        ("flight", {"origin": "TLV", "destination": "ATH", "depart_date": future(20), "return_date": future(10)}, "החזרה"),
        ("hotel", {"destination": "Rome", "check_in": future(20), "check_out": future(18)}, "אחרי"),
        ("car", {"pickup_location": "FCO", "pickup_at": f"{future(20)}T10:00:00", "dropoff_at": f"{future(20)}T10:30:00"},
         "שעה"),
        ("activity", {"destination": "Rome", "date_from": future(20), "date_to": future(10)}, "טווח"),
    ],
)
def test_validation_errors_are_hebrew_422(auth_client, category, body, needle):
    c = auth_client("adult")
    res = c.post(f"/api/search/{category}", json=body)
    assert res.status_code == 422, res.text
    err = res.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    assert needle in err["message"]
    assert err["details"]


def test_field_level_errors_are_translated(auth_client):
    c = auth_client("adult")
    res = c.post("/api/search/flight", json={"origin": "TL", "depart_date": "not-a-date", "adults": 0})
    assert res.status_code == 422
    details = {d["field"]: d["message"] for d in res.json()["error"]["details"]}
    assert details["destination"] == "שדה חובה"
    assert details["depart_date"].startswith("תאריך לא תקין")
    assert details["adults"] == "הערך קטן מהמינימום המותר"


def test_unknown_category_and_mismatch(auth_client):
    c = auth_client("adult")
    assert c.post("/api/search/boat", json={}).status_code == 404
    res = c.post("/api/search/hotel", json={**FLIGHT, "category": "flight"})
    assert res.status_code == 422


def test_rerank_via_weights_param(auth_client):
    c = auth_client("adult")
    search_id = c.post("/api/search/flight", json=FLIGHT).json()["search_id"]
    res = c.get(f"/api/search/{search_id}", params={"weights": "cost:100,convenience:0,flexibility:0,quality:0"})
    assert res.status_code == 200
    body = res.json()
    assert body["weights"] == {"cost": 100, "convenience": 0, "flexibility": 0, "quality": 0}
    amounts = [Decimal(o["price"]["total"]["amount"]) for o in body["offers"]]
    assert amounts == sorted(amounts)
    assert [o["score"]["rank"] for o in body["offers"]] == list(range(1, len(amounts) + 1))
    default = c.get(f"/api/search/{search_id}").json()
    assert default["weights"] == {"cost": 40, "convenience": 25, "flexibility": 20, "quality": 15}
    for bad in ("cost:50,convenience:25,flexibility:20,quality:15", "cost:abc", "speed:100", "cost:100"):
        r = c.get(f"/api/search/{search_id}", params={"weights": bad})
        assert r.status_code == 422, bad
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_search_visibility_and_history_isolation(auth_client):
    alice = auth_client("adult")
    bob = auth_client("viewer")
    owner = auth_client("owner")
    a1 = alice.post("/api/search/flight", json=FLIGHT).json()["search_id"]
    alice.post("/api/search/hotel", json={"destination": "אתונה", "check_in": future(25), "check_out": future(28)})
    b1 = bob.post("/api/search/activity", json={"destination": "ATH", "date_from": future(25), "date_to": future(27)})
    assert b1.status_code == 200
    ha = alice.get("/api/search/history").json()
    hb = bob.get("/api/search/history").json()
    assert ha["total"] == 2 and hb["total"] == 1
    assert {i["category"] for i in ha["items"]} == {"flight", "hotel"}
    assert hb["items"][0]["category"] == "activity" and hb["items"][0]["origin"] == "manual"
    assert ha["items"][0]["created_at"] >= ha["items"][1]["created_at"]
    assert alice.get("/api/search/history", params={"category": "hotel"}).json()["total"] == 1
    assert alice.get("/api/search/history", params={"page_size": 1}).json()["items"].__len__() == 1
    # Another member cannot read Alice's search; the owner can.
    assert bob.get(f"/api/search/{a1}").status_code == 404
    assert owner.get(f"/api/search/{a1}").status_code == 200
    assert owner.get("/api/search/history").json()["total"] == 0  # history is always "own searches"


def test_search_rate_limit_per_user(auth_client, monkeypatch):
    from app.core.config import get_settings

    # The budget is configurable (ORI_SEARCH_RATE_LIMIT, default 30); shrink it for the test.
    monkeypatch.setattr(get_settings(), "search_rate_limit", 2)
    c = auth_client("adult")
    assert c.post("/api/search/flight", json=FLIGHT).status_code == 200
    assert c.post("/api/search/flight", json=FLIGHT).status_code == 200
    res = c.post("/api/search/flight", json=FLIGHT)
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "RATE_LIMITED"
    # Another user is not affected
    assert auth_client("adult").post("/api/search/flight", json=FLIGHT).status_code == 200


def test_car_search_with_local_times(auth_client):
    c = auth_client("adult")
    pickup = datetime.combine(TODAY + timedelta(days=25), datetime.min.time()).replace(hour=11)
    res = c.post("/api/search/car", json={"pickup_location": "Tel Aviv", "pickup_at": pickup.isoformat(),
                                          "dropoff_at": (pickup + timedelta(days=3)).isoformat(), "driver_age": 22})
    assert res.status_code == 200
    offers = res.json()["offers"]
    assert offers
    assert all(o["details"]["pickup_at"].startswith(pickup.strftime("%Y-%m-%dT11:00:00")) for o in offers)
    assert all(o["details"]["transmission"] == "automatic" for o in offers)  # Israel: automatic fleet
    assert all(o["details"]["young_driver_fee_applies"] is True for o in offers)
