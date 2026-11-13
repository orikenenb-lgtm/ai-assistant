"""Trip budget math: per-currency buckets, remaining only for a single currency, warnings."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from app.core.db import utcnow
from app.models.trips import TripItem
from tests.test_trips import first_offer, make_trip


def add(c, trip_id, kind="other", title="x", cost=None, status="estimate", **extra):
    body = {"kind": kind, "title": title, "cost_status": status, **extra}
    if cost:
        body["cost"] = {"amount": cost[0], "currency": cost[1]}
    res = c.post(f"/api/trips/{trip_id}/items", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def by_cur(budget):
    return {r["currency"]: r for r in budget["totals"]}


def test_single_currency_math_and_remaining(auth_client):
    c = auth_client("adult")
    t = make_trip(c, budget={"amount": "1000.00", "currency": "ILS"})
    add(c, t["id"], "flight", "a", ("300.10", "ILS"), "known")
    add(c, t["id"], "hotel", "b", ("200.20", "ILS"), "estimate")
    add(c, t["id"], "hotel", "c", ("999.00", "ILS"), "excluded")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    row = by_cur(b)["ILS"]
    assert (row["known"], row["estimated"], row["excluded"], row["counted"]) == ("300.10", "200.20", "999.00", "500.30")
    assert b["remaining"] == {"amount": "499.70", "currency": "ILS"} and b["remaining_reason"] == "ok"
    kinds = {k["kind"]: k for k in b["by_kind"]}
    assert kinds["hotel"]["item_count"] == 2 and kinds["hotel"]["totals"][0]["estimated"] == "200.20"
    assert kinds["flight"]["totals"][0]["known"] == "300.10"
    codes = {w["code"] for w in b["warnings"]}
    assert "ESTIMATED_COSTS" in codes and "MIXED_CURRENCIES" not in codes and "OVER_BUDGET" not in codes


def test_decimal_exactness(auth_client):
    c = auth_client("adult")
    t = make_trip(c, budget={"amount": "0.30", "currency": "USD"})
    for _ in range(3):
        add(c, t["id"], "other", "p", ("0.10", "USD"), "known")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert by_cur(b)["USD"]["known"] == "0.30" and b["remaining"]["amount"] == "0.00"


def test_mixed_currency_gives_null_remaining_and_warning(auth_client):
    c = auth_client("adult")
    t = make_trip(c, budget={"amount": "1000.00", "currency": "ILS"})
    add(c, t["id"], "flight", "a", ("100", "ILS"), "known")
    add(c, t["id"], "hotel", "b", ("100", "EUR"), "known")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["remaining"] is None and b["remaining_reason"] == "mixed_currencies"
    assert set(by_cur(b)) == {"ILS", "EUR"}  # never merged
    w = next(w for w in b["warnings"] if w["code"] == "MIXED_CURRENCIES")
    assert "מטבע" in w["message"]


def test_excluded_other_currency_does_not_block_remaining(auth_client):
    c = auth_client("adult")
    t = make_trip(c, budget={"amount": "500.00", "currency": "ILS"})
    add(c, t["id"], "flight", "a", ("100", "ILS"), "known")
    add(c, t["id"], "hotel", "b", ("100", "EUR"), "excluded")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["remaining"] == {"amount": "400.00", "currency": "ILS"}


def test_no_budget_over_budget_and_missing_costs(auth_client):
    c = auth_client("adult")
    t = make_trip(c, budget=None)
    add(c, t["id"], "note", "no cost")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["budget"] is None and b["remaining"] is None and b["remaining_reason"] == "no_budget"
    assert any(w["code"] == "ITEMS_WITHOUT_COST" for w in b["warnings"])
    c.patch(f"/api/trips/{t['id']}", json={"budget": {"amount": "50", "currency": "ILS"}})
    add(c, t["id"], "other", "big", ("80", "ILS"), "known")
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["remaining"]["amount"] == "-30.00" and b["over_budget"] is True
    assert any(w["code"] == "OVER_BUDGET" for w in b["warnings"])


def test_empty_trip_budget_equals_remaining(auth_client):
    c = auth_client("adult")
    t = make_trip(c, budget={"amount": "700", "currency": "ILS"})
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    assert b["totals"] == [] and b["remaining"]["amount"] == "700.00"


def test_expired_offer_snapshot_and_demo_warnings(auth_client, db):
    c = auth_client("adult")
    t = make_trip(c)
    offer = first_offer(c, "hotel")
    item = c.post(f"/api/trips/{t['id']}/items/from-offer", json={"offer_id": offer["id"]}).json()["item"]
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    codes = {w["code"] for w in b["warnings"]}
    assert "DEMO_DATA" in codes
    row = db.get(TripItem, item["id"])
    snap = dict(row.offer_snapshot)
    snap["source"] = {**snap["source"], "expires_at": (utcnow() - timedelta(hours=1)).isoformat()}
    row.offer_snapshot = snap
    db.commit()
    b = c.get(f"/api/trips/{t['id']}/budget").json()
    w = next(w for w in b["warnings"] if w["code"] == "OFFER_EXPIRED")
    assert w["item_ids"] == [item["id"]]
    assert Decimal(by_cur(b)[offer["price"]["total"]["currency"]]["known"]) == Decimal(offer["price"]["total"]["amount"])
    assert c.get(f"/api/trips/{t['id']}").json()["items"][0]["offer_expired"] is True
