"""Opt-in price monitoring scheduler.

* Starts a single daemon thread only when ``ORI_SCHEDULER_ALLOWED=true``.
* Every ``scheduler_tick_seconds`` the app setting ``scheduler.enabled`` is re-read; when it is
  false the tick does nothing.
* Each tick checks at most ``alert_max_checks_per_tick`` due alerts (oldest check first) using its
  own DB session. Exceptions are logged (redacted) and never kill the loop; ticks never overlap.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta

from sqlalchemy import select

from app.core import db as db_module
from app.core.app_settings import get_setting
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.redaction import redact_text
from app.models.alerts import Alert
from app.modules.price_tracking.service import check_alert

log = logging.getLogger("ori.scheduler")

_tick_lock = threading.Lock()
_thread: threading.Thread | None = None
_stop_event = threading.Event()
_state_lock = threading.Lock()


def _is_due(alert: Alert, now: datetime) -> bool:
    if alert.last_checked_at is None:
        return True
    return alert.last_checked_at + timedelta(minutes=alert.check_interval_minutes) <= now


def run_tick(now: datetime | None = None) -> int:
    """Run one scheduler tick; returns the number of alerts checked."""
    settings = get_settings()
    if not settings.scheduler_allowed:
        return 0
    if not _tick_lock.acquire(blocking=False):  # never overlap
        return 0
    checked = 0
    try:
        now = now or utcnow()
        session = db_module.get_sessionmaker()()
        try:
            if not get_setting(session, "scheduler").get("enabled"):
                return 0
            candidates = session.scalars(
                select(Alert)
                .where(Alert.is_active.is_(True))
                .order_by(Alert.last_checked_at.asc().nulls_first(), Alert.created_at.asc(), Alert.id)
            ).all()
            due = [a for a in candidates if _is_due(a, now)][: max(0, settings.alert_max_checks_per_tick)]
            for alert in due:
                try:
                    check_alert(session, alert, now=now)
                    checked += 1
                except Exception as exc:
                    session.rollback()
                    log.warning("scheduler: alert check crashed: %s", redact_text(f"{type(exc).__name__}: {exc}"))
        finally:
            session.close()
    except Exception as exc:
        log.warning("scheduler tick failed: %s", redact_text(f"{type(exc).__name__}: {exc}"))
    finally:
        _tick_lock.release()
    return checked


def _loop(stop: threading.Event, interval: float) -> None:
    log.info("price scheduler started (tick=%ss)", interval)
    while not stop.wait(interval):
        try:
            run_tick()
        except Exception as exc:  # pragma: no cover - run_tick already guards
            log.warning("scheduler loop error: %s", redact_text(f"{type(exc).__name__}: {exc}"))
    log.info("price scheduler stopped")


def maybe_start() -> None:
    """Start the background scheduler only when the server allows it (idempotent)."""
    global _thread
    settings = get_settings()
    if not settings.scheduler_allowed:
        return
    with _state_lock:
        if _thread is not None and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(
            target=_loop,
            args=(_stop_event, float(max(1, settings.scheduler_tick_seconds))),
            name="ori-price-scheduler",
            daemon=True,
        )
        _thread.start()


def stop() -> None:
    """Signal the scheduler to stop and wait briefly for it."""
    global _thread
    with _state_lock:
        thread, _thread = _thread, None
        _stop_event.set()
    if thread is not None and thread.is_alive():
        thread.join(timeout=10)
