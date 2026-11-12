"""Saved offers: private per-user shortlist."""

from __future__ import annotations

from datetime import timedelta

from app.core.db import utcnow
from app.models.search import Offer
from tests.test_trips import first_offer, make_trip


def test_requires_auth(client):
    assert client.get("/api/saved-offers").status_code == 401
    assert client.post("/api/saved-offers", json={"offer_id": "x"}).status_code == 401


def test_crud_roles_and_duplicates(auth_client):
    viewer = auth_client("viewer")  # any role may keep a shortlist
    offer = first_offer(viewer, "flight")
    created = viewer.post("/api/saved-offers", json={"offer_id": offer["id"], "note": "נראה טוב"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["offer"]["id"] == offer["id"] and body["category"] == "flight"
    assert body["note"] == "נראה טוב" and body["is_expired"] is False
    assert body["offer"]["price"]["total"] == offer["price"]["total"]
    dup = viewer.post("/api/saved-offers", json={"offer_id": offer["id"]})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ALREADY_SAVED"
    assert viewer.post("/api/saved-offers", json={"offer_id": "missing"}).status_code == 404
    upd = viewer.patch(f"/api/saved-offers/{body['id']}", json={"note": "עודכן"})
    assert upd.status_code == 200 and upd.json()["note"] == "עודכן"
    assert viewer.patch(f"/api/saved-offers/{body['id']}", json={"note": None}).json()["note"] is None
    assert len(viewer.get("/api/saved-offers").json()) == 1
    assert viewer.delete(f"/api/saved-offers/{body['id']}").status_code == 200
    assert viewer.get("/api/saved-offers").json() == []
    assert viewer.delete(f"/api/saved-offers/{body['id']}").status_code == 404


def test_isolation_between_users(auth_client):
    a, b, owner = auth_client("adult"), auth_client("adult"), auth_client("owner")
    offer = first_offer(a, "hotel")
    sid = a.post("/api/saved-offers", json={"offer_id": offer["id"]}).json()["id"]
    assert b.get("/api/saved-offers").json() == [] and owner.get("/api/saved-offers").json() == []
    assert b.patch(f"/api/saved-offers/{sid}", json={"note": "x"}).status_code == 404
    assert b.delete(f"/api/saved-offers/{sid}").status_code == 404
    assert owner.delete(f"/api/saved-offers/{sid}").status_code == 404  # even the owner: shortlist is private
    assert len(a.get("/api/saved-offers").json()) == 1
    # another user can save the very same offer (uniqueness is per user + offer)
    assert b.post("/api/saved-offers", json={"offer_id": offer["id"]}).status_code == 201


def test_category_filter_expiry_and_trip_link(auth_client, db):
    c = auth_client("adult")
    flight, hotel = first_offer(c, "flight"), first_offer(c, "hotel")
    trip = make_trip(c)
    c.post("/api/saved-offers", json={"offer_id": flight["id"]})
    hid = c.post("/api/saved-offers", json={"offer_id": hotel["id"], "trip_id": trip["id"]}).json()["id"]
    assert {s["category"] for s in c.get("/api/saved-offers").json()} == {"flight", "hotel"}
    only = c.get("/api/saved-offers", params={"category": "hotel"}).json()
    assert [s["id"] for s in only] == [hid] and only[0]["trip_id"] == trip["id"]
    assert c.get("/api/saved-offers", params={"category": "bogus"}).status_code == 422
    assert c.post("/api/saved-offers", json={"offer_id": flight["id"], "trip_id": "nope"}).status_code in (409, 422)
    assert c.patch(f"/api/saved-offers/{hid}", json={"trip_id": "nope"}).status_code == 422
    assert c.patch(f"/api/saved-offers/{hid}", json={"trip_id": None}).json()["trip_id"] is None
    # is_expired derives from source.expires_at
    row = db.get(Offer, hotel["id"])
    data = dict(row.data)
    data["source"] = {**data["source"], "expires_at": (utcnow() - timedelta(minutes=1)).isoformat()}
    row.data = data
    db.commit()
    got = {s["offer_id"]: s for s in c.get("/api/saved-offers").json()}
    assert got[hotel["id"]]["is_expired"] is True and got[flight["id"]]["is_expired"] is False


def test_deleting_trip_unlinks_saved_offer(auth_client):
    c = auth_client("adult")
    offer = first_offer(c, "car")
    trip = make_trip(c)
    sid = c.post("/api/saved-offers", json={"offer_id": offer["id"], "trip_id": trip["id"]}).json()["id"]
    assert c.delete(f"/api/trips/{trip['id']}").status_code == 200
    assert next(s for s in c.get("/api/saved-offers").json() if s["id"] == sid)["trip_id"] is None
