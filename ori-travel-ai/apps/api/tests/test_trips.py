"""Trips + items: role matrix, validation, day grouping, from-offer for every category."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models.family import FamilyMember


def future(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


SEARCHES = {
    "flight": {"origin": "TLV", "destination": "ROM", "depart_date": future(30), "return_date": future(35), "adults": 2},
    "hotel": {"destination": "Rome", "check_in": future(30), "check_out": future(34)},
    "car": {"pickup_location": "FCO", "pickup_at": f"{future(30)}T10:00:00", "dropoff_at": f"{future(34)}T10:00:00"},
    "activity": {"destination": "Rome", "date_from": future(31), "date_to": future(33)},
}


def first_offer(client, category: str) -> dict:
    res = client.post(f"/api/search/{category}", json=SEARCHES[category])
    assert res.status_code == 200, res.text
    offers = res.json()["offers"]
    assert offers, f"no demo offers for {category}"
    return offers[0]


def make_trip(client, **over) -> dict:
    body = {"title": "חופשה ברומא", "destination": "רומא", "start_date": future(30), "end_date": future(35),
            "timezone": "Europe/Rome", "budget": {"amount": "10000.00", "currency": "ILS"}}
    body.update(over)
    res = client.post("/api/trips", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_requires_auth(client):
    assert client.get("/api/trips").status_code == 401
    assert client.post("/api/trips", json={"title": "x"}).status_code == 401


def test_role_matrix(auth_client):
    owner, adult, viewer = auth_client("owner"), auth_client("adult"), auth_client("viewer")
    t1 = make_trip(owner)
    t2 = make_trip(adult, title="טיול של אדם")
    # family-shared: everyone sees both
    for c in (owner, adult, viewer):
        assert {t["id"] for t in c.get("/api/trips").json()} == {t1["id"], t2["id"]}
        assert c.get(f"/api/trips/{t1['id']}").status_code == 200
        assert c.get(f"/api/trips/{t1['id']}/budget").status_code == 200
    # viewer is read-only
    assert viewer.post("/api/trips", json={"title": "x"}).status_code == 403
    assert viewer.patch(f"/api/trips/{t1['id']}", json={"title": "y"}).status_code == 403
    assert viewer.delete(f"/api/trips/{t1['id']}").status_code == 403
    assert viewer.post(f"/api/trips/{t1['id']}/items", json={"kind": "note", "title": "n"}).status_code == 403
    assert viewer.post(f"/api/trips/{t1['id']}/items/reorder", json={"item_ids": ["a"]}).status_code == 403
    # any editor may edit family trips
    assert adult.patch(f"/api/trips/{t1['id']}", json={"title": "עודכן"}).json()["title"] == "עודכן"
    assert adult.delete(f"/api/trips/{t1['id']}").status_code == 200
    assert owner.get(f"/api/trips/{t1['id']}").status_code == 404


def test_csrf_required(auth_client):
    c = auth_client("adult")
    token = c.headers.pop("X-CSRF-Token")
    assert c.post("/api/trips", json={"title": "x"}).status_code == 403
    c.headers["X-CSRF-Token"] = token


def test_trip_validation(auth_client, db):
    c = auth_client("adult")
    bad_dates = c.post("/api/trips", json={"title": "x", "start_date": future(10), "end_date": future(5)})
    assert bad_dates.status_code == 422 and bad_dates.json()["error"]["code"] == "VALIDATION_ERROR"
    assert c.post("/api/trips", json={"title": "x", "timezone": "Mars/Phobos"}).status_code == 422
    assert c.post("/api/trips", json={"title": "x", "timezone": "../etc/passwd"}).status_code == 422
    assert c.post("/api/trips", json={"title": "x", "traveler_ids": ["nope"]}).status_code == 422
    assert c.post("/api/trips", json={"title": "x", "budget": {"amount": "5", "currency": "XXX"}}).status_code == 422
    assert c.post("/api/trips", json={"title": "x", "budget": {"amount": "-5", "currency": "ILS"}}).status_code == 422
    assert c.post("/api/trips", json={"title": "   "}).status_code == 422
    assert c.get("/api/trips/missing").status_code == 404


def test_trip_detail_travelers_and_patch(auth_client, db):
    c = auth_client("adult")
    m1 = FamilyMember(display_name="אמא", age_group="adult")
    m2 = FamilyMember(display_name="דנה", age_group="child", is_minor=True)
    db.add_all([m1, m2])
    db.commit()
    trip = make_trip(c, traveler_ids=[m1.id, m2.id, m1.id])
    assert [t["display_name"] for t in trip["travelers"]] == ["אמא", "דנה"]
    assert trip["budget"] == {"amount": "10000.00", "currency": "ILS"}
    assert trip["day_count"] == 6 and trip["items"] == [] and trip["days"] == []
    upd = c.patch(f"/api/trips/{trip['id']}", json={"traveler_ids": [m2.id], "budget": None, "status": "booked"}).json()
    assert [t["id"] for t in upd["travelers"]] == [m2.id] and upd["budget"] is None and upd["status"] == "booked"
    # end before (existing) start is rejected on patch too
    assert c.patch(f"/api/trips/{trip['id']}", json={"end_date": future(1)}).status_code == 422
    assert c.patch(f"/api/trips/{trip['id']}", json={"title": None}).status_code == 422


def test_item_validation(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    url = f"/api/trips/{t['id']}/items"
    assert c.post(url, json={"kind": "bogus", "title": "x"}).status_code == 422
    # known cost needs amount + currency
    assert c.post(url, json={"kind": "note", "title": "x", "cost_status": "known"}).status_code == 422
    assert c.post(url, json={"kind": "note", "title": "x", "cost": {"amount": "5", "currency": "ILS"},
                              "cost_status": "known"}).status_code == 201
    bad = c.post(url, json={"kind": "activity", "title": "x", "start_at": "2026-12-01T10:00:00Z", "end_at": "2026-12-01T09:00:00Z"})
    assert bad.status_code == 422
    assert c.post(url, json={"kind": "activity", "title": "x", "end_at": "2026-12-01T09:00:00Z"}).status_code == 422
    assert c.post(url, json={"kind": "note", "title": "x", "timezone": "Nope/Nope"}).status_code == 422
    assert c.post(url, json={"kind": "note", "title": "x", "cost": {"amount": "-1", "currency": "ILS"}}).status_code == 422
    item = c.post(url, json={"kind": "note", "title": "y"}).json()
    # patch can't produce an invalid state
    assert c.patch(f"{url}/{item['id']}", json={"cost_status": "known"}).status_code == 422
    assert c.patch(f"{url}/{item['id']}", json={"cost": {"amount": "7.5", "currency": "EUR"}, "cost_status": "known"}).json()["cost"] == {
        "amount": "7.50", "currency": "EUR"}
    assert c.patch(f"{url}/nope", json={"title": "z"}).status_code == 404
    assert c.delete(f"{url}/{item['id']}").status_code == 200
    assert c.delete(f"{url}/{item['id']}").status_code == 404


def test_days_grouping_uses_local_timezone_and_unscheduled(auth_client):
    c = auth_client("adult")
    t = make_trip(c, timezone="Asia/Tokyo")
    url = f"/api/trips/{t['id']}/items"
    # 20:00Z is already the next day in Tokyo (UTC+9)
    a = c.post(url, json={"kind": "activity", "title": "ערב", "start_at": "2026-12-01T20:00:00Z"}).json()
    b = c.post(url, json={"kind": "activity", "title": "בוקר", "start_at": "2026-12-01T01:00:00Z"}).json()
    # naive time is read as local wall-clock of the trip timezone
    n = c.post(url, json={"kind": "activity", "title": "מקומי", "start_at": "2026-12-02T08:00:00"}).json()
    free = c.post(url, json={"kind": "note", "title": "רעיון"}).json()
    assert a["local_date"] == "2026-12-02" and b["local_date"] == "2026-12-01"
    assert n["start_at"].startswith("2026-12-01T23:00:00")
    detail = c.get(f"/api/trips/{t['id']}").json()
    days = {d["date"]: d["item_ids"] for d in detail["days"]}
    assert days["2026-12-01"] == [b["id"]] and set(days["2026-12-02"]) == {a["id"], n["id"]}
    assert detail["unscheduled_item_ids"] == [free["id"]]
    # item-level timezone wins over the trip's
    ny = c.post(url, json={"kind": "activity", "title": "NY", "start_at": "2026-12-01T03:00:00Z", "timezone": "America/New_York"}).json()
    assert ny["local_date"] == "2026-11-30"


def test_reorder(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    url = f"/api/trips/{t['id']}/items"
    ids = [c.post(url, json={"kind": "note", "title": f"n{i}"}).json()["id"] for i in range(3)]
    assert [i["sort_order"] for i in c.get(f"/api/trips/{t['id']}").json()["items"]] == [0, 1, 2]
    res = c.post(f"{url}/reorder", json={"item_ids": list(reversed(ids))})
    assert res.status_code == 200 and [i["id"] for i in res.json()["items"]] == list(reversed(ids))
    assert c.post(f"{url}/reorder", json={"item_ids": ids[:2]}).status_code == 422
    assert c.post(f"{url}/reorder", json={"item_ids": [ids[0], ids[0], ids[1]]}).status_code == 422


def test_from_offer_flight_one_item_per_slice(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    offer = first_offer(c, "flight")
    res = c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": offer["id"]})
    assert res.status_code == 201, res.text
    body = res.json()
    slices = offer["details"]["slices"]
    assert len(body["items"]) == len(slices) == 2 and body["item"]["id"] == body["items"][0]["id"]
    first, second = body["items"]
    assert first["kind"] == "flight" and first["offer_id"] == offer["id"]
    assert first["start_at"] is not None and first["end_at"] is not None and first["timezone"] == "Asia/Jerusalem"
    assert "TLV" in first["location"] or first["location"]
    # cost = offer total, once (second slice is excluded to avoid double counting)
    assert first["cost"] == offer["price"]["total"] and first["cost_status"] == "known"
    assert second["cost"] is None and second["cost_status"] == "excluded"
    snap = first["offer_snapshot"]
    assert snap["source"]["mode"] == "DEMO" and snap["source"]["fetched_at"] and snap["id"] == offer["id"]
    assert first["data_mode"] == "DEMO"
    budget = c.get(f"/api/trips/{t['id']}/budget").json()
    assert budget["totals"][0]["known"] == offer["price"]["total"]["amount"]
    assert c.get(f"/api/trips/{t['id']}").json()["has_demo_data"] is True


def test_from_offer_hotel_car_activity(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    url = f"/api/trips/{t['id']}/items/from-offer"

    hotel = first_offer(c, "hotel")
    h = c.post(url, json={"offer_id": hotel["id"]}).json()["item"]
    assert h["kind"] == "hotel" and h["title"] == hotel["details"]["hotel_name"]
    # check-in 15:00 / check-out 11:00 in the trip timezone (Rome: UTC+1 in winter, +2 in summer)
    assert h["start_at"][11:13] in ("13", "14") and h["end_at"][11:13] in ("09", "10")
    assert h["local_date"] == hotel["details"]["check_in"]
    assert h["cost"] == hotel["price"]["total"]
    if hotel["details"]["latitude"] is not None:
        assert h["latitude"] == pytest.approx(hotel["details"]["latitude"])

    car = first_offer(c, "car")
    ci = c.post(url, json={"offer_id": car["id"]}).json()["item"]
    assert ci["kind"] == "car" and ci["start_at"] and ci["end_at"] > ci["start_at"]
    assert car["details"]["pickup_location"] in ci["location"]

    act = first_offer(c, "activity")
    ai = c.post(url, json={"offer_id": act["id"]}).json()["item"]
    assert ai["kind"] == "activity" and ai["title"] == act["details"]["name"]
    if act["details"]["available_dates"]:
        assert ai["local_date"] == min(act["details"]["available_dates"])
    else:
        assert ai["start_at"] is None and ai["local_date"] is None
    assert c.get(f"/api/trips/{t['id']}").json()["item_count"] >= 3


def test_from_offer_without_trip_timezone_uses_utc_and_missing_offer(auth_client):
    c = auth_client("adult")
    t = make_trip(c, timezone=None)
    hotel = first_offer(c, "hotel")
    h = c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": hotel["id"]}).json()["item"]
    assert h["start_at"][11:16] == "15:00" and h["end_at"][11:16] == "11:00"
    assert c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": "nope"}).status_code == 404
    viewer = auth_client("viewer")
    assert viewer.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": hotel["id"]}).status_code == 403


def test_trip_summary_totals_never_mix_currencies(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    url = f"/api/trips/{t['id']}/items"
    c.post(url, json={"kind": "other", "title": "a", "cost": {"amount": "100", "currency": "ILS"}, "cost_status": "known"})
    c.post(url, json={"kind": "other", "title": "b", "cost": {"amount": "50.50", "currency": "EUR"}, "cost_status": "estimate"})
    summary = next(s for s in c.get("/api/trips").json() if s["id"] == t["id"])
    assert summary["item_count"] == 2
    totals = {x["currency"]: x for x in summary["totals"]}
    assert Decimal(totals["ILS"]["known"]) == 100 and Decimal(totals["EUR"]["estimated"]) == Decimal("50.50")
