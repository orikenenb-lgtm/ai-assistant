from __future__ import annotations

from datetime import timedelta

from app.core.config import get_settings
from app.core.db import utcnow
from app.models import (
    AuditEvent,
    BookingIntent,
    Offer,
    PriceSnapshot,
    ProviderSearch,
    SavedOffer,
    SearchRequest,
    Trip,
    TripItem,
)


def test_get_settings_shape(auth_client):
    viewer = auth_client("viewer")
    s = viewer.get("/api/settings").json()
    assert s["ranking_weights"] == {"cost": 40, "convenience": 25, "flexibility": 20, "quality": 15}
    assert s["scheduler"] == {"enabled": False, "allowed_by_server": False}
    assert s["map"] == {"enabled": False}
    assert s["display"] == {"currency": "ILS"}
    assert s["retention"] == {"search_days": 90, "audit_days": 365}
    assert s["ai"] == {"provider": "none", "configured": False, "model": None, "paid_allowed": False}
    assert s["booking"] == {"live_execution": False}
    assert s["encryption_available"] is True and s["live_providers_enabled"] is False
    assert "key" not in str(s).lower().replace("encryption", "")


def test_ai_section_never_leaks_key(auth_client):
    c = auth_client("adult")
    st = get_settings()
    st.ai_provider = "anthropic"
    st.anthropic_api_key = "sk-ant-secret-value"
    st.ai_allow_paid = True
    body = c.get("/api/settings").json()
    assert body["ai"]["configured"] is True and body["ai"]["paid_allowed"] is True
    assert "sk-ant" not in str(body)
    st.anthropic_api_key = None
    assert c.get("/api/settings").json()["ai"]["configured"] is False
    st.ai_provider = "ollama"
    assert c.get("/api/settings").json()["ai"]["configured"] is True


def test_scheduler_allowed_by_server(auth_client):
    owner = auth_client("owner")
    get_settings().scheduler_allowed = True
    res = owner.put("/api/settings/scheduler", json={"enabled": True}).json()
    assert res["scheduler"] == {"enabled": True, "allowed_by_server": True}


def test_weights_validation_and_roles(auth_client, db):
    viewer = auth_client("viewer")
    adult = auth_client("adult")
    ok = {"cost": 10, "convenience": 20, "flexibility": 30, "quality": 40}
    assert viewer.put("/api/settings/ranking-weights", json=ok).status_code == 403
    assert adult.put("/api/settings/ranking-weights", json=ok).status_code == 200
    assert adult.get("/api/settings").json()["ranking_weights"] == ok
    for bad in (
        {**ok, "cost": 11},
        {**ok, "cost": -10, "quality": 60},
        {**ok, "cost": 10.5},
        {**ok, "cost": "10"},
        {"cost": 100, "convenience": 0, "flexibility": 0},
        {**ok, "extra": 1},
    ):
        assert adult.put("/api/settings/ranking-weights", json=bad).status_code == 422, bad
    edge = {"cost": 100, "convenience": 0, "flexibility": 0, "quality": 0}
    assert adult.put("/api/settings/ranking-weights", json=edge).status_code == 200
    assert db.query(AuditEvent).filter_by(action="settings.update").count() == 2


def test_owner_only_settings(auth_client):
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    owner = auth_client("owner")
    calls = [
        ("/api/settings/scheduler", {"enabled": True}),
        ("/api/settings/map", {"enabled": True}),
        ("/api/settings/retention", {"search_days": 30, "audit_days": 60}),
    ]
    for url, body in calls:
        assert adult.put(url, json=body).status_code == 403
        assert viewer.put(url, json=body).status_code == 403
        assert owner.put(url, json=body).status_code == 200
    assert adult.post("/api/settings/retention/run").status_code == 403
    assert viewer.post("/api/settings/retention/run").status_code == 403


def test_display_and_retention_validation(auth_client):
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    owner = auth_client("owner")
    assert viewer.put("/api/settings/display", json={"currency": "USD"}).status_code == 403
    assert adult.put("/api/settings/display", json={"currency": "usd"}).json()["display"] == {"currency": "USD"}
    assert adult.put("/api/settings/display", json={"currency": "XXX"}).status_code == 422
    for bad in ({"search_days": 6, "audit_days": 100}, {"search_days": 366, "audit_days": 100},
                {"search_days": 30, "audit_days": 29}, {"search_days": 30, "audit_days": 1826}, {"search_days": 30}):
        assert owner.put("/api/settings/retention", json=bad).status_code == 422, bad
    assert owner.put("/api/settings/map", json={"enabled": "yes"}).status_code == 422


def _offer(db, created, **kw):
    o = Offer(
        provider_id="demo", mode="DEMO", category="flight", supplier_offer_id="s", dedupe_key="d", title="t",
        total_amount_minor=100, currency="ILS", price_status="known", fetched_at=created, data={}, created_at=created, **kw,
    )
    db.add(o)
    db.flush()
    return o


def test_retention_run_keeps_referenced(auth_client, db):
    owner = auth_client("owner")
    old = utcnow() - timedelta(days=200)
    recent = utcnow() - timedelta(days=5)

    sr_old = SearchRequest(user_id=owner.user.id, category="flight", params={}, params_hash="h", created_at=old)
    sr_new = SearchRequest(user_id=owner.user.id, category="flight", params={}, params_hash="h2", created_at=recent)
    db.add_all([sr_old, sr_new])
    db.flush()
    db.add(ProviderSearch(search_request_id=sr_old.id, provider_id="demo", mode="DEMO", status="OK", started_at=old))

    o_plain = _offer(db, old, search_request_id=sr_old.id)
    o_saved = _offer(db, old, search_request_id=sr_old.id)
    o_trip = _offer(db, old)
    o_book = _offer(db, old)
    o_snap = _offer(db, old)
    o_recent = _offer(db, recent, search_request_id=sr_new.id)
    trip = Trip(title="t", created_by_id=owner.user.id)
    db.add(trip)
    db.flush()
    db.add_all([
        SavedOffer(user_id=owner.user.id, offer_id=o_saved.id),
        TripItem(trip_id=trip.id, kind="flight", title="x", offer_id=o_trip.id),
        PriceSnapshot(offer_id=o_snap.id, provider_id="demo", mode="DEMO"),
    ])
    _add_booking(db, owner.user.id, o_book.id)
    old_audit = AuditEvent(action="old.event", created_at=utcnow() - timedelta(days=500), details={})
    db.add(old_audit)
    db.commit()
    ids = {k: v.id for k, v in dict(plain=o_plain, saved=o_saved, trip=o_trip, book=o_book, snap=o_snap, recent=o_recent).items()}

    res = owner.post("/api/settings/retention/run")
    assert res.status_code == 200
    assert res.json() == {"search_requests_deleted": 1, "offers_deleted": 1, "audit_events_deleted": 1}
    db.expire_all()
    remaining = {o.id for o in db.query(Offer).all()}
    assert ids["plain"] not in remaining
    assert {ids["saved"], ids["trip"], ids["book"], ids["snap"], ids["recent"]} <= remaining
    assert db.query(SearchRequest).count() == 1
    assert db.query(ProviderSearch).count() == 0
    assert db.query(AuditEvent).filter_by(action="old.event").count() == 0
    assert db.query(AuditEvent).filter_by(action="settings.retention_run").count() == 1


def _add_booking(db, user_id, offer_id):
    cols = {c.name: c for c in BookingIntent.__table__.columns}
    values = {"created_by_id": user_id, "offer_id": offer_id}
    for name, col in cols.items():
        if name in values or col.primary_key or col.nullable or col.default is not None or col.server_default is not None:
            continue
        values[name] = _filler(col)
    db.add(BookingIntent(**values))


def _filler(col):
    t = str(col.type).upper()
    if "INT" in t:
        return 0
    if "JSON" in t:
        return {}
    if "DATETIME" in t or "TIMESTAMP" in t:
        return utcnow()
    return "x"
