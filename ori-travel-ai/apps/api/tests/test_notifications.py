from __future__ import annotations

import pytest

from app.modules.notifications.service import notify, notify_roles


def test_notify_validates_link(db, make_user):
    u = make_user("adult")
    n = notify(db, u.id, "system", "שלום", link="/trips/1")
    assert n.link == "/trips/1"
    for bad in ("https://evil.test", "//evil.test", "trips", "/a b", "/a\\b"):
        with pytest.raises(ValueError):
            notify(db, u.id, "system", "x", link=bad)
    with pytest.raises(ValueError):
        notify_roles(db, ("owner",), "system", "x", link="//x")


def test_notify_roles_counts_active_only(db, make_user):
    make_user("owner")
    make_user("adult")
    inactive = make_user("adult")
    inactive.is_active = False
    make_user("viewer")
    db.commit()
    assert notify_roles(db, ("owner", "adult"), "system", "כותרת") == 2
    assert notify_roles(db, ("viewer",), "system", "כותרת") == 1


def test_isolation_and_read_flow(auth_client, db):
    a = auth_client("adult")
    b = auth_client("viewer")
    n1 = notify(db, a.user.id, "price_drop", "ירידת מחיר", body="b", link="/alerts")
    notify(db, a.user.id, "system", "שנייה")
    nb = notify(db, b.user.id, "system", "של ב")
    db.commit()

    assert a.get("/api/notifications/unread-count").json() == {"count": 2}
    assert b.get("/api/notifications/unread-count").json() == {"count": 1}
    page = a.get("/api/notifications").json()
    assert page["total"] == 2 and {i["id"] for i in page["items"]} != {nb.id}
    assert a.post(f"/api/notifications/{nb.id}/read").status_code == 404
    assert b.get("/api/notifications/unread-count").json()["count"] == 1

    res = a.post(f"/api/notifications/{n1.id}/read")
    assert res.status_code == 200 and res.json()["read_at"] is not None
    assert a.post(f"/api/notifications/{n1.id}/read").status_code == 200  # idempotent
    assert a.get("/api/notifications?unread_only=true").json()["total"] == 1
    assert a.post("/api/notifications/read-all").json() == {"updated": 1}
    assert a.get("/api/notifications/unread-count").json()["count"] == 0
    assert b.get("/api/notifications/unread-count").json()["count"] == 1


def test_pagination_and_auth(auth_client, client, db):
    a = auth_client("viewer")
    for i in range(5):
        notify(db, a.user.id, "system", f"t{i}")
    db.commit()
    res = a.get("/api/notifications?page=2&page_size=2").json()
    assert res["total"] == 5 and len(res["items"]) == 2 and res["page"] == 2
    assert a.get("/api/notifications?page_size=500").status_code == 422
    assert client.get("/api/notifications").status_code == 401
