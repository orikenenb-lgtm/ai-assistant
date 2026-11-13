"""Price alerts: validation, roles, manual check, notifications, cooldown, failures, expiry."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core.db import utcnow
from app.core.ratelimit import limiter
from app.models.alerts import Alert, Notification
from app.models.search import PriceSnapshot
from app.modules.price_tracking import service as pt_service


def future(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


FLIGHT = {"origin": "TLV", "destination": "ROM", "depart_date": future(30), "return_date": future(35), "adults": 1}


def make_alert(c, **over) -> dict:
    body = {"name": "טיסה לרומא", "category": "flight", "search_params": dict(FLIGHT),
            "target_price": {"amount": "100000.00", "currency": "ILS"}, "check_interval_minutes": 360}
    body.update(over)
    res = c.post("/api/alerts", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def notifications(db, user_id, kind=None):
    db.expire_all()
    q = select(Notification).where(Notification.user_id == user_id)
    if kind:
        q = q.where(Notification.kind == kind)
    return list(db.scalars(q))


def test_requires_auth(client):
    assert client.get("/api/alerts").status_code == 401
    assert client.post("/api/alerts/x/check").status_code == 401


def test_create_validation(auth_client):
    c = auth_client("adult")
    base = {"name": "x", "category": "flight", "search_params": dict(FLIGHT), "check_interval_minutes": 360}
    bad_params = c.post("/api/alerts", json={**base, "search_params": {**FLIGHT, "destination": "TLV"}})
    assert bad_params.status_code == 422 and bad_params.json()["error"]["code"] == "VALIDATION_ERROR"
    assert c.post("/api/alerts", json={**base, "search_params": {"origin": "TLV"}}).status_code == 422
    past = c.post("/api/alerts", json={**base, "search_params": {**FLIGHT, "depart_date": "2020-01-01", "return_date": None}})
    assert past.status_code == 422
    low = c.post("/api/alerts", json={**base, "check_interval_minutes": 5})
    assert low.status_code == 422 and "360" in low.json()["error"]["message"]
    mismatch = c.post("/api/alerts", json={**base, "target_price": {"amount": "50", "currency": "USD"}})
    assert mismatch.status_code == 422  # search currency defaults to ILS
    ok_usd = c.post("/api/alerts", json={**base, "search_params": {**FLIGHT, "currency": "USD"},
                                          "target_price": {"amount": "50", "currency": "USD"}})
    assert ok_usd.status_code == 201 and ok_usd.json()["currency"] == "USD"
    assert c.post("/api/alerts", json={**base, "target_price": {"amount": "0", "currency": "ILS"}}).status_code == 422
    assert c.post("/api/alerts", json={**base, "category": "boat"}).status_code == 422
    assert c.post("/api/alerts", json={**base, "name": ""}).status_code == 422


def test_role_matrix_and_isolation(auth_client):
    owner, adult, other, viewer = auth_client("owner"), auth_client("adult"), auth_client("adult"), auth_client("viewer")
    assert viewer.post("/api/alerts", json={"name": "x", "category": "flight", "search_params": FLIGHT,
                                             "check_interval_minutes": 360}).status_code == 403
    assert viewer.get("/api/alerts").json() == []
    mine = make_alert(adult)
    assert mine["user_id"] == adult.user.id and mine["owner_name"] == adult.user.display_name
    assert mine["last_status"] == "NEVER" and mine["next_check_at"] is None
    assert other.get("/api/alerts").json() == []
    assert other.patch(f"/api/alerts/{mine['id']}", json={"name": "hack"}).status_code == 404
    assert other.delete(f"/api/alerts/{mine['id']}").status_code == 404
    assert other.post(f"/api/alerts/{mine['id']}/check").status_code == 404
    assert other.get(f"/api/alerts/{mine['id']}/snapshots").status_code == 404
    assert viewer.patch(f"/api/alerts/{mine['id']}", json={"name": "x"}).status_code == 403
    listed = owner.get("/api/alerts").json()
    assert [a["id"] for a in listed] == [mine["id"]] and listed[0]["owner_name"] == adult.user.display_name
    assert owner.patch(f"/api/alerts/{mine['id']}", json={"name": "שם חדש", "is_active": False}).json()["name"] == "שם חדש"
    assert owner.delete(f"/api/alerts/{mine['id']}").status_code == 200
    assert adult.get("/api/alerts").json() == []


def test_patch_validation(auth_client):
    c = auth_client("adult")
    a = make_alert(c)
    url = f"/api/alerts/{a['id']}"
    assert c.patch(url, json={"check_interval_minutes": 10}).status_code == 422
    assert c.patch(url, json={"target_price": {"amount": "5", "currency": "EUR"}}).status_code == 422
    assert c.patch(url, json={"target_price": None}).json()["target_price"] is None
    assert c.patch(url, json={"name": None}).status_code == 422
    assert c.patch(url, json={"search_params": {**FLIGHT, "origin": "TLV", "destination": "TLV"}}).status_code == 422
    changed = c.patch(url, json={"search_params": {**FLIGHT, "destination": "ATH"}, "check_interval_minutes": 720}).json()
    assert changed["search_params"]["destination"] == "ATH" and changed["check_interval_minutes"] == 720


def test_manual_check_triggers_notification_and_cooldown(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c, target_price={"amount": "100000.00", "currency": "ILS"})
    res = c.post(f"/api/alerts/{a['id']}/check")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "OK" and body["triggered"] is True and body["target_reached"] is True
    best = body["best_offer"]
    assert best["source"]["mode"] == "DEMO" and best["price"]["total"]["currency"] == "ILS"
    snap = body["snapshot"]
    assert snap["status"] == "OK" and snap["mode"] == "DEMO" and snap["price"] == best["price"]["total"]
    assert snap["offer_id"] == best["id"]
    assert body["alert"]["last_status"] == "OK" and body["alert"]["last_best_price"] == best["price"]["total"]
    assert body["alert"]["last_best_mode"] == "DEMO" and body["alert"]["next_check_at"]
    notes = notifications(db, c.user.id, "price_drop")
    assert len(notes) == 1 and "נתוני הדגמה" in notes[0].body and notes[0].link == "/alerts"
    # cheapest of all returned offers in that currency
    search = c.post("/api/search/flight", json=FLIGHT).json()
    cheapest = min(o["price"]["total"]["amount"] for o in search["offers"] if o["price"]["total"]["currency"] == "ILS")
    assert float(best["price"]["total"]["amount"]) == pytest.approx(float(cheapest))
    # 5 minute cooldown per alert
    again = c.post(f"/api/alerts/{a['id']}/check")
    assert again.status_code == 429 and again.json()["error"]["code"] == "RATE_LIMITED"
    # after the cooldown the price is still below target but did not cross it again: no second notification
    limiter.reset()
    second = c.post(f"/api/alerts/{a['id']}/check").json()
    assert second["status"] == "OK" and second["triggered"] is False and second["target_reached"] is True
    assert len(notifications(db, c.user.id, "price_drop")) == 1
    snaps = c.get(f"/api/alerts/{a['id']}/snapshots").json()
    assert len(snaps) == 2 and all(s["status"] == "OK" for s in snaps)
    # another alert has its own cooldown
    b = make_alert(c, name="שנייה")
    assert c.post(f"/api/alerts/{b['id']}/check").status_code == 200


def test_target_below_price_does_not_trigger_then_triggers_on_crossing(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c, target_price={"amount": "1.00", "currency": "ILS"})
    first = c.post(f"/api/alerts/{a['id']}/check").json()
    assert first["status"] == "OK" and first["triggered"] is False and first["target_reached"] is False
    assert notifications(db, c.user.id, "price_drop") == []
    # target raised above the price while the previous best was above it: the next check crosses the target
    c.patch(f"/api/alerts/{a['id']}", json={"target_price": {"amount": "5000", "currency": "ILS"}})
    row = db.get(Alert, a["id"])
    row.last_best_amount_minor = 900_000_00  # previous best 900000.00 ILS, above the target
    db.commit()
    limiter.reset()
    second = c.post(f"/api/alerts/{a['id']}/check").json()
    assert second["status"] == "OK" and float(second["best_offer"]["price"]["total"]["amount"]) <= 5000
    assert second["triggered"] is True
    assert len(notifications(db, c.user.id, "price_drop")) == 1


def test_no_target_never_triggers(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c, target_price=None)
    res = c.post(f"/api/alerts/{a['id']}/check").json()
    assert res["status"] == "OK" and res["triggered"] is False and res["target_reached"] is False
    assert notifications(db, c.user.id) == []


def test_owner_checking_member_alert_notifies_the_alert_owner(auth_client, db):
    owner, adult = auth_client("owner"), auth_client("adult")
    a = make_alert(adult)
    assert owner.post(f"/api/alerts/{a['id']}/check").json()["triggered"] is True
    assert len(notifications(db, adult.user.id, "price_drop")) == 1
    assert notifications(db, owner.user.id, "price_drop") == []


def test_no_results(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c, search_params={**FLIGHT, "max_price": "0.01"})
    res = c.post(f"/api/alerts/{a['id']}/check").json()
    assert res["status"] == "NO_RESULTS" and res["best_offer"] is None and res["triggered"] is False
    assert res["snapshot"]["status"] == "NO_RESULTS" and res["snapshot"]["price"] is None and res["snapshot"]["mode"] is None
    assert res["alert"]["last_status"] == "NO_RESULTS"
    assert notifications(db, c.user.id) == []


def test_failure_is_user_safe_and_notifies_on_third_consecutive_failure(auth_client, db, monkeypatch):
    c = auth_client("adult")
    a = make_alert(c)

    def boom(*args, **kwargs):
        raise RuntimeError("secret-token=abc123 Traceback provider exploded")

    monkeypatch.setattr(pt_service, "run_search", boom)
    alert = db.get(Alert, a["id"])
    for i in range(1, 5):
        result = pt_service.check_alert(db, alert)
        assert result.status == "FAILED"
        assert "abc123" not in (alert.last_error or "") and "RuntimeError" not in (alert.last_error or "")
        assert alert.last_error and any("֐" <= ch <= "׿" for ch in alert.last_error)
        assert len(notifications(db, c.user.id, "alert_failed")) == (1 if i >= 3 else 0)
    snaps = list(db.scalars(select(PriceSnapshot).where(PriceSnapshot.alert_id == a["id"])))
    assert len(snaps) == 4 and all(s.status == "FAILED" and "abc123" not in (s.error_message or "") for s in snaps)
    # recovery resets the streak: a later failure streak notifies again only at its own third failure
    monkeypatch.undo()
    assert pt_service.check_alert(db, alert).status == "OK"
    assert alert.last_error is None


def test_expired_alert_is_deactivated(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c)
    row = db.get(Alert, a["id"])
    row.search_params = {**row.search_params, "depart_date": future(-3), "return_date": future(-1)}
    db.commit()
    res = c.post(f"/api/alerts/{a['id']}/check")
    assert res.status_code == 200 and res.json()["status"] == "EXPIRED"
    out = res.json()["alert"]
    assert out["is_active"] is False and out["last_status"] == "EXPIRED" and "עברו" in out["last_error"]
    assert res.json()["snapshot"] is None
    assert len(notifications(db, c.user.id, "system")) == 1
    limiter.reset()
    again = c.post(f"/api/alerts/{a['id']}/check")
    assert again.status_code == 409 and again.json()["error"]["code"] == "ALERT_INACTIVE"
    # cannot be re-enabled while the dates are in the past
    assert c.patch(f"/api/alerts/{a['id']}", json={"is_active": True}).status_code == 422


def test_deleting_alert_removes_snapshots(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c)
    c.post(f"/api/alerts/{a['id']}/check")
    assert c.delete(f"/api/alerts/{a['id']}").status_code == 200
    db.expire_all()
    assert list(db.scalars(select(PriceSnapshot).where(PriceSnapshot.alert_id == a["id"]))) == []


def test_alert_limit_per_user(auth_client):
    c = auth_client("adult")
    for i in range(pt_service.MAX_ALERTS_PER_USER):
        make_alert(c, name=f"a{i}")
    res = c.post("/api/alerts", json={"name": "extra", "category": "flight", "search_params": FLIGHT, "check_interval_minutes": 360})
    assert res.status_code == 409 and res.json()["error"]["code"] == "ALERT_LIMIT"


def test_last_checked_updates(auth_client, db):
    c = auth_client("adult")
    a = make_alert(c)
    c.post(f"/api/alerts/{a['id']}/check")
    db.expire_all()
    row = db.get(Alert, a["id"])
    assert row.last_checked_at is not None and utcnow() - row.last_checked_at < timedelta(minutes=1)
