"""Price-monitoring scheduler: both opt-in flags, per-tick cap, due selection, resilience."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core import app_settings
from app.core.config import reset_settings_cache
from app.core.db import utcnow
from app.models.alerts import Alert
from app.modules.price_tracking import scheduler
from tests.test_alerts import make_alert


@pytest.fixture(autouse=True)
def _clean_scheduler():
    yield
    scheduler.stop()


def configure(monkeypatch, db, *, allowed: bool, enabled: bool, cap: int = 5, tick: int = 3600):
    monkeypatch.setenv("ORI_SCHEDULER_ALLOWED", "true" if allowed else "false")
    monkeypatch.setenv("ORI_ALERT_MAX_CHECKS_PER_TICK", str(cap))
    monkeypatch.setenv("ORI_SCHEDULER_TICK_SECONDS", str(tick))
    reset_settings_cache()
    app_settings.set_setting(db, "scheduler", {"enabled": enabled}, None)
    db.commit()


def make_due_alerts(client, db, n: int) -> list[str]:
    ids = []
    for i in range(n):
        ids.append(make_alert(client, name=f"alert {i}")["id"])
    for i, aid in enumerate(ids):
        row = db.get(Alert, aid)
        row.last_checked_at = utcnow() - timedelta(days=2, minutes=n - i)  # oldest first = index 0
    db.commit()
    return ids


def test_server_flag_off_does_nothing(auth_client, db, monkeypatch):
    c = auth_client("adult")
    make_due_alerts(c, db, 2)
    configure(monkeypatch, db, allowed=False, enabled=True)
    assert scheduler.run_tick() == 0
    scheduler.maybe_start()
    assert scheduler._thread is None


def test_app_setting_off_does_nothing(auth_client, db, monkeypatch):
    c = auth_client("adult")
    make_due_alerts(c, db, 2)
    configure(monkeypatch, db, allowed=True, enabled=False)
    assert scheduler.run_tick() == 0
    db.expire_all()
    assert all(a.last_status == "NEVER" or a.last_checked_at < utcnow() - timedelta(days=1) for a in db.query(Alert))


def test_tick_respects_cap_and_oldest_first(auth_client, db, monkeypatch):
    c = auth_client("adult")
    ids = make_due_alerts(c, db, 4)
    configure(monkeypatch, db, allowed=True, enabled=True, cap=2)
    assert scheduler.run_tick() == 2
    db.expire_all()
    checked = {a.id for a in db.query(Alert) if a.last_checked_at > utcnow() - timedelta(minutes=1)}
    assert checked == set(ids[:2])  # the two oldest
    assert scheduler.run_tick() == 2
    db.expire_all()
    assert all(db.get(Alert, i).last_checked_at > utcnow() - timedelta(minutes=1) for i in ids)
    assert scheduler.run_tick() == 0  # nothing due any more


def test_only_active_and_due_alerts_are_checked(auth_client, db, monkeypatch):
    c = auth_client("adult")
    ids = make_due_alerts(c, db, 3)
    inactive, fresh, never = db.get(Alert, ids[0]), db.get(Alert, ids[1]), db.get(Alert, ids[2])
    inactive.is_active = False
    fresh.last_checked_at = utcnow() - timedelta(minutes=10)  # interval is 360 minutes
    never.last_checked_at = None
    db.commit()
    configure(monkeypatch, db, allowed=True, enabled=True)
    assert scheduler.run_tick() == 1
    db.expire_all()
    assert db.get(Alert, ids[2]).last_status == "OK"
    assert db.get(Alert, ids[0]).last_status == "NEVER" and db.get(Alert, ids[1]).last_status == "NEVER"


def test_tick_notifies_and_records_snapshot(auth_client, db, monkeypatch):
    from app.models.alerts import Notification
    from app.models.search import PriceSnapshot

    c = auth_client("adult")
    ids = make_due_alerts(c, db, 1)
    configure(monkeypatch, db, allowed=True, enabled=True)
    assert scheduler.run_tick() == 1
    db.expire_all()
    assert db.query(PriceSnapshot).filter_by(alert_id=ids[0]).count() == 1
    assert db.query(Notification).filter_by(user_id=c.user.id, kind="price_drop").count() == 1


def test_one_failing_alert_does_not_stop_the_tick(auth_client, db, monkeypatch):
    c = auth_client("adult")
    make_due_alerts(c, db, 3)
    configure(monkeypatch, db, allowed=True, enabled=True)
    calls = {"n": 0}
    real = scheduler.check_alert

    def flaky(session, alert, now=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("secret-token=zzz")
        return real(session, alert, now=now)

    monkeypatch.setattr(scheduler, "check_alert", flaky)
    assert scheduler.run_tick() == 2 and calls["n"] == 3


def test_ticks_do_not_overlap(auth_client, db, monkeypatch):
    c = auth_client("adult")
    make_due_alerts(c, db, 1)
    configure(monkeypatch, db, allowed=True, enabled=True)
    assert scheduler._tick_lock.acquire(blocking=False)
    try:
        assert scheduler.run_tick() == 0
    finally:
        scheduler._tick_lock.release()
    assert scheduler.run_tick() == 1


def test_thread_lifecycle(db, monkeypatch):
    configure(monkeypatch, db, allowed=True, enabled=False, tick=3600)
    scheduler.maybe_start()
    t = scheduler._thread
    assert t is not None and t.is_alive() and t.daemon
    scheduler.maybe_start()  # idempotent
    assert scheduler._thread is t
    scheduler.stop()
    assert not t.is_alive() and scheduler._thread is None
    scheduler.stop()  # safe to call twice
