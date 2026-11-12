"""Overlap detection: every kind pair, 409 ITEM_OVERLAP + allow_overlap, from-offer, budget warning/per-traveler."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.models.family import FamilyMember
from app.modules.itineraries.overlaps import FORBIDDEN_PAIRS, find_overlaps, intervals_overlap, pair_forbidden
from tests.test_trips import first_offer, make_trip

KINDS = ["flight", "hotel", "car", "activity", "transfer", "note", "other"]


def dt(h, m=0, d=1):
    return datetime(2026, 12, d, h, m, tzinfo=UTC)


def obj(i, kind, s, e=None):
    return SimpleNamespace(id=i, kind=kind, title=f"t{i}", start_at=s, end_at=e)


def post(c, tid, kind, start, end=None, title=None, **extra):
    body = {"kind": kind, "title": title or kind, "start_at": start, **extra}
    if end:
        body["end_at"] = end
    return c.post(f"/api/trips/{tid}/items", json=body)


def test_interval_semantics():
    assert intervals_overlap((dt(9), dt(11)), (dt(10), dt(12)))
    assert not intervals_overlap((dt(9), dt(10)), (dt(10), dt(11)))  # touching ends do not overlap
    assert intervals_overlap((dt(9), dt(9)), (dt(9), dt(9)))  # same instant points
    assert not intervals_overlap((dt(9), dt(9)), (dt(9, 1), dt(9, 1)))
    assert intervals_overlap((dt(10), dt(10)), (dt(9), dt(11)))  # point inside interval
    assert intervals_overlap((dt(9), dt(11)), (dt(9), dt(9)))  # point at start is inside
    assert not intervals_overlap((dt(9), dt(11)), (dt(11), dt(11)))  # point at end is outside


@pytest.mark.parametrize("a", KINDS)
@pytest.mark.parametrize("b", KINDS)
def test_every_kind_pair(a, b):
    forbidden = {frozenset({"flight"}), frozenset({"activity", "flight"}), frozenset({"activity"}), frozenset({"hotel"})}
    assert FORBIDDEN_PAIRS == forbidden
    found = find_overlaps([obj("x", a, dt(9), dt(11)), obj("y", b, dt(10), dt(12))])
    assert bool(found) == pair_forbidden(a, b) == (frozenset({a, b}) in forbidden)
    if found:
        assert found[0].kind_pair == "-".join(sorted((a, b)))
        assert found[0].message and any("֐" <= ch <= "׿" for ch in found[0].message)


def test_rules_explicit():
    # car and hotel overlap anything; unscheduled ignored; point items
    assert not find_overlaps([obj("1", "car", dt(9), dt(20)), obj("2", "car", dt(10), dt(12))])
    assert not find_overlaps([obj("1", "hotel", dt(9), dt(20)), obj("2", "flight", dt(10), dt(12))])
    assert not find_overlaps([obj("1", "flight", None), obj("2", "flight", None)])
    assert find_overlaps([obj("1", "flight", dt(9), dt(11)), obj("2", "activity", dt(10))])  # point in interval
    assert not find_overlaps([obj("1", "activity", dt(9), dt(10)), obj("2", "activity", dt(10))])


def test_create_409_then_allow_overlap(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    a = post(c, t["id"], "flight", "2026-12-01T09:00:00Z", "2026-12-01T12:00:00Z", "טיסה א")
    assert a.status_code == 201 and a.json()["overlaps"] == []
    res = post(c, t["id"], "flight", "2026-12-01T11:00:00Z", "2026-12-01T14:00:00Z", "טיסה ב")
    assert res.status_code == 409
    err = res.json()["error"]
    assert err["code"] == "ITEM_OVERLAP" and err["details"][0]["kind_pair"] == "flight-flight"
    assert err["details"][0]["conflicts_with_item_id"] == a.json()["id"]
    assert err["details"][0]["conflicts_with_title"] == "טיסה א"
    assert c.get(f"/api/trips/{t['id']}").json()["item_count"] == 1  # nothing saved
    ok = post(c, t["id"], "flight", "2026-12-01T11:00:00Z", "2026-12-01T14:00:00Z", "טיסה ב", allow_overlap=True)
    assert ok.status_code == 201
    body = ok.json()
    assert len(body["overlaps"]) == 1 and body["overlaps"][0]["kind_pair"] == "flight-flight"
    detail = c.get(f"/api/trips/{t['id']}").json()
    assert len(detail["overlaps"]) == 1
    assert all(len(i["overlaps"]) == 1 for i in detail["items"])  # flagged on both items
    # non-forbidden pair is silently fine
    car = post(c, t["id"], "car", "2026-12-01T10:00:00Z", "2026-12-01T15:00:00Z")
    assert car.status_code == 201 and car.json()["overlaps"] == []


def test_update_409_and_untouched_edits(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    a = post(c, t["id"], "activity", "2026-12-01T09:00:00Z", "2026-12-01T11:00:00Z", "א").json()
    b = post(c, t["id"], "activity", "2026-12-01T12:00:00Z", "2026-12-01T13:00:00Z", "ב").json()
    url = f"/api/trips/{t['id']}/items/{b['id']}"
    res = c.patch(url, json={"start_at": "2026-12-01T10:00:00Z", "end_at": "2026-12-01T13:00:00Z"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "ITEM_OVERLAP"
    ok = c.patch(url, json={"start_at": "2026-12-01T10:00:00Z", "end_at": "2026-12-01T13:00:00Z", "allow_overlap": True})
    assert ok.status_code == 200 and ok.json()["overlaps"][0]["other_item_id"] in (a["id"], b["id"])
    # editing a note-ish field of an already-overlapping item does not re-prompt
    assert c.patch(url, json={"notes": "x"}).status_code == 200
    # changing only the title keeps the existing pair without re-prompt
    assert c.patch(url, json={"title": "ב2"}).status_code == 200
    # changing kind to a forbidden pair is caught
    car = post(c, t["id"], "car", "2026-12-01T09:30:00Z", "2026-12-01T10:30:00Z").json()
    assert c.patch(f"/api/trips/{t['id']}/items/{car['id']}", json={"kind": "activity"}).status_code == 409


def test_from_offer_overlap(auth_client):
    c = auth_client("adult")
    t = make_trip(c)
    offer = first_offer(c, "flight")
    url = f"/api/trips/{t['id']}/items/from-offer"
    first = c.post(url, json={"offer_id": offer["id"]})
    assert first.status_code == 201 and first.json()["overlaps"] == []
    again = c.post(url, json={"offer_id": offer["id"]})
    assert again.status_code == 409 and again.json()["error"]["code"] == "ITEM_OVERLAP"
    assert c.get(f"/api/trips/{t['id']}").json()["item_count"] == 2  # nothing partially saved
    forced = c.post(url, json={"offer_id": offer["id"], "allow_overlap": True})
    assert forced.status_code == 201 and len(forced.json()["overlaps"]) >= 1
    assert forced.json()["item"]["overlaps"]


def test_budget_overlaps_warning_counts_costs_and_per_traveler(auth_client, db):
    c = auth_client("adult")
    t = make_trip(c, budget={"amount": "1000.00", "currency": "ILS"})
    post(c, t["id"], "activity", "2026-12-01T09:00:00Z", "2026-12-01T11:00:00Z", cost={"amount": "100", "currency": "ILS"}, cost_status="known")
    post(c, t["id"], "activity", "2026-12-01T10:00:00Z", "2026-12-01T12:00:00Z", cost={"amount": "50", "currency": "ILS"},
         cost_status="known", allow_overlap=True)
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    w = next(w for w in b["warnings"] if w["code"] == "OVERLAPS")
    assert len(w["item_ids"]) == 2
    assert b["totals"][0]["counted"] == "150.00"  # overlapping items still counted
    assert b["per_traveler"] is None and b["per_traveler_reason"] == "no_travelers" and b["traveler_count"] == 0


def test_per_traveler_ok_and_mixed(auth_client, db):
    c = auth_client("adult")
    m1 = FamilyMember(display_name="אמא", age_group="adult")
    m2 = FamilyMember(display_name="דנה", age_group="child", is_minor=True)
    db.add_all([m1, m2])
    db.commit()
    ids = [m1.id, m2.id]
    t = make_trip(c, traveler_ids=ids)
    post(c, t["id"], "hotel", "2026-12-01T09:00:00Z", cost={"amount": "300", "currency": "ILS"}, cost_status="known")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["traveler_count"] == 2 and b["per_traveler_reason"] == "ok"
    assert b["per_traveler"] == {"amount": "150.00", "currency": "ILS"}
    post(c, t["id"], "car", "2026-12-02T09:00:00Z", cost={"amount": "10", "currency": "EUR"}, cost_status="known")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["per_traveler"] is None and b["per_traveler_reason"] == "mixed_currencies"
    empty = make_trip(c, traveler_ids=ids)
    b = c.get(f"/api/trips/{empty['id']}/budget").json()
    assert b["per_traveler"] is None and b["per_traveler_reason"] == "no_costs"
