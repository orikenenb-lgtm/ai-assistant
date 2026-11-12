"""Provider status, health checks, configuration and diagnostics.

Also exposes helpers for other modules (booking, B4):
``revalidate_offer(db, offer)`` and ``booking_options_for(offer)`` route to the
offer's adapter, passing owner-configured non-secret settings to DEMO adapters.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from datetime import timedelta
from decimal import Decimal
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.db import utcnow
from app.models.search import ProviderSearch
from app.models.system import ProviderConfiguration
from app.modules.providers import registry
from app.modules.providers.base import (
    BookingOptions,
    ProviderAdapter,
    ProviderError,
    ProviderHealth,
    ProviderHealthStatus,
    RevalidationResult,
)
from app.modules.providers.errors import UnprocessableError
from app.modules.providers.normalization import clean_text
from app.modules.providers.schemas import (
    DiagnosticsOut,
    ProviderDiagnosticsOut,
    ProviderLastError,
    ProviderStatusOut,
)
from app.schemas.offers import CanonicalOffer

log = logging.getLogger("ori.providers")

_health_lock = threading.Lock()
_health_cache: dict[str, ProviderHealth] = {}

ATTEMPTED = ("OK", "FAILED", "TIMEOUT")
SKIPPED = ("NOT_CONFIGURED", "DISABLED", "UNSUPPORTED")
_SECRET_HINTS = ("token", "secret", "password", "passwd", "apikey", "api_key", "key", "credential", "auth", "cookie")
_SETTING_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


# ----------------------------------------------------------------- health ----


def last_health(provider_id: str) -> ProviderHealth | None:
    with _health_lock:
        return _health_cache.get(provider_id)


def reset_health_cache() -> None:
    with _health_lock:
        _health_cache.clear()


def _store_health(h: ProviderHealth) -> ProviderHealth:
    with _health_lock:
        _health_cache[h.provider_id] = h
    return h


def health_check(db: Session, provider_id: str) -> ProviderHealth:
    adapter = registry.get_adapter(provider_id)
    configs = registry.ensure_configs(db)
    cfg = configs.get(provider_id)
    now = utcnow()
    if cfg is not None and not cfg.enabled:
        return _store_health(ProviderHealth(provider_id=provider_id, status="DISABLED", checked_at=now,
                                            message="הספק הושבת בהגדרות"))
    if not registry.is_usable(adapter):
        # Never touch the network for providers that are not connected.
        return _store_health(ProviderHealth(provider_id=provider_id, status="NOT_CONFIGURED", checked_at=now,
                                            message="לא מחובר — חסרים פרטי גישה או שהפעלת ספקים חיים כבויה"))
    start = time.perf_counter()
    try:
        h = adapter.health()
        latency = h.latency_ms if h.latency_ms is not None else int((time.perf_counter() - start) * 1000)
        h = h.model_copy(update={"message": clean_text(h.message) or "", "latency_ms": latency})
    except ProviderError as exc:
        h = ProviderHealth(provider_id=provider_id, status="FAILED", checked_at=utcnow(),
                           message=clean_text(exc.message) or "בדיקת התקינות נכשלה",
                           latency_ms=int((time.perf_counter() - start) * 1000))
    except Exception as exc:  # noqa: BLE001 - never leak details
        log.warning("health check failed provider=%s error=%s", provider_id, type(exc).__name__)
        h = ProviderHealth(provider_id=provider_id, status="FAILED", checked_at=utcnow(),
                           message="בדיקת התקינות נכשלה", latency_ms=int((time.perf_counter() - start) * 1000))
    return _store_health(h)


# ----------------------------------------------------------------- status ----


def last_run_statuses(db: Session) -> dict[str, str]:
    """Most recent attempted run status per provider."""
    out: dict[str, str] = {}
    rows = db.execute(
        select(ProviderSearch.provider_id, ProviderSearch.status)
        .where(ProviderSearch.status.in_(ATTEMPTED))
        .order_by(ProviderSearch.started_at.desc())
        .limit(500)
    ).all()
    for pid, status in rows:
        out.setdefault(pid, status)
    return out


def compute_status(adapter: ProviderAdapter, cfg: ProviderConfiguration | None, last_run: str | None) -> ProviderHealthStatus:
    if cfg is not None and not cfg.enabled:
        return "DISABLED"
    if not registry.is_usable(adapter):
        return "NOT_CONFIGURED"
    if getattr(adapter, "implemented", True) is False:
        return "DEGRADED"  # LIVE placeholder: configured, but no real API calls implemented yet
    h = last_health(adapter.provider_id)
    if h is not None and h.status in ("OK", "DEGRADED", "FAILED"):
        if last_run in ("FAILED", "TIMEOUT") and h.status == "OK":
            return "DEGRADED"
        return h.status
    if last_run in ("FAILED", "TIMEOUT"):
        return "DEGRADED"
    return "OK"


def _setup(adapter: ProviderAdapter) -> tuple[str | None, str]:
    caps = adapter.capabilities()
    if caps.mode == "DEMO":
        return None, "ספק הדגמה מובנה — אינו דורש הגדרה. כל התוצאות מסומנות כנתוני הדגמה."
    names = " ו-".join(caps.requires_credentials) or "פרטי גישה"
    return caps.official_docs_url, (
        f"כדי לחבר: הגדירו {names} וגם ORI_LIVE_PROVIDERS_ENABLED=true בקובץ apps/api/.env "
        "(לעולם לא בממשק או במסד הנתונים) והפעילו מחדש את השרת. ייתכן שנדרש הסכם שותפים עם הספק."
    )


def status_for(db: Session, adapter: ProviderAdapter, cfg: ProviderConfiguration | None,
               last_run: str | None = None) -> ProviderStatusOut:
    caps = adapter.capabilities()
    doc, instructions = _setup(adapter)
    return ProviderStatusOut(
        provider_id=caps.provider_id,
        display_name=caps.display_name,
        mode=caps.mode,
        categories=caps.categories,
        status=compute_status(adapter, cfg, last_run),
        enabled=True if cfg is None else bool(cfg.enabled),
        configured=registry.is_usable(adapter),
        capabilities=caps,
        last_health=last_health(adapter.provider_id),
        requires_credentials=list(caps.requires_credentials),
        setup_doc=doc,
        setup_instructions=instructions,
        settings=dict(cfg.settings or {}) if cfg is not None else {},
        notes=caps.notes,
    )


def list_statuses(db: Session) -> list[ProviderStatusOut]:
    configs = registry.ensure_configs(db)
    db.commit()
    last = last_run_statuses(db)
    return [status_for(db, a, configs.get(a.provider_id), last.get(a.provider_id)) for a in registry.all_adapters()]


# ----------------------------------------------------------- configuration ----


def validate_provider_settings(adapter: ProviderAdapter, settings: dict[str, Any]) -> dict[str, Any]:
    """Accept only declared, non-secret, scalar settings."""
    if not isinstance(settings, dict) or len(settings) > 20:
        raise UnprocessableError("הגדרות הספק אינן תקינות")
    allowed: dict[str, tuple] = getattr(adapter, "allowed_settings", {}) or {}
    clean: dict[str, Any] = {}
    for key, value in settings.items():
        k = str(key)
        if any(h in k.lower() for h in _SECRET_HINTS):
            raise UnprocessableError(
                "אין לשמור סודות (מפתחות/אסימונים/סיסמאות) בהגדרות הספק — יש להגדירם במשתני סביבה בלבד",
                code="SECRET_NOT_ALLOWED",
            )
        if not _SETTING_KEY_RE.match(k):
            raise UnprocessableError(f"שם הגדרה לא תקין: {clean_text(k, 40)}")
        spec = allowed.get(k)
        if spec is None:
            raise UnprocessableError(f"ההגדרה '{k}' אינה נתמכת עבור ספק זה")
        if value is None:
            continue
        kind = spec[0]
        if kind == "int":
            if isinstance(value, bool) or not isinstance(value, int) or not spec[1] <= value <= spec[2]:
                raise UnprocessableError(f"ההגדרה '{k}' חייבת להיות מספר שלם בין {spec[1]} ל-{spec[2]}")
        elif kind == "bool":
            if not isinstance(value, bool):
                raise UnprocessableError(f"ההגדרה '{k}' חייבת להיות true/false")
        elif kind == "enum":
            if value not in spec[1]:
                raise UnprocessableError(f"ערך לא נתמך עבור '{k}'")
        elif kind == "pattern":
            if not isinstance(value, str) or not re.match(spec[1], value):
                raise UnprocessableError(f"ערך לא תקין עבור '{k}'")
        clean[k] = value
    return clean


def update_config(db: Session, provider_id: str, *, enabled: bool, settings: dict[str, Any] | None,
                  user_id: str, request: Request | None = None) -> ProviderStatusOut:
    adapter = registry.get_adapter(provider_id)
    cfg = registry.get_config(db, provider_id)
    before = {"enabled": cfg.enabled, "settings_keys": sorted((cfg.settings or {}).keys())}
    cfg.enabled = bool(enabled)
    if settings is not None:
        cfg.settings = validate_provider_settings(adapter, settings)
    cfg.updated_by_id = user_id
    record_audit(
        db,
        "provider.update",
        actor_user_id=user_id,
        entity_type="provider",
        entity_id=provider_id,
        details={"before": before, "after": {"enabled": cfg.enabled, "settings": dict(cfg.settings or {})}},
        request=request,
    )
    db.commit()
    with _health_lock:
        _health_cache.pop(provider_id, None)
    return status_for(db, adapter, cfg, last_run_statuses(db).get(provider_id))


# ------------------------------------------------------------- diagnostics ----


def diagnostics(db: Session, days: int = 30) -> DiagnosticsOut:
    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(
            ProviderSearch.provider_id,
            ProviderSearch.status,
            ProviderSearch.duration_ms,
            ProviderSearch.started_at,
            ProviderSearch.error_code,
            ProviderSearch.error_message,
        )
        .where(ProviderSearch.started_at >= since)
        .order_by(ProviderSearch.started_at.desc())
    ).all()
    configs = registry.ensure_configs(db)
    db.commit()
    by_provider: dict[str, list] = {}
    for r in rows:
        by_provider.setdefault(r.provider_id, []).append(r)
    out: list[ProviderDiagnosticsOut] = []
    for adapter in registry.all_adapters():
        pid = adapter.provider_id
        runs = by_provider.get(pid, [])
        attempted = [r for r in runs if r.status in ATTEMPTED]
        ok = [r for r in attempted if r.status == "OK"]
        latencies = [r.duration_ms for r in ok if r.duration_ms is not None]
        last_err = next((r for r in attempted if r.status in ("FAILED", "TIMEOUT")), None)
        last_run = attempted[0] if attempted else None
        caps = adapter.capabilities()
        out.append(
            ProviderDiagnosticsOut(
                provider_id=pid,
                display_name=caps.display_name,
                mode=caps.mode,
                status=compute_status(adapter, configs.get(pid), last_run.status if last_run else None),
                runs=len(attempted),
                ok_runs=len(ok),
                failed_runs=sum(1 for r in attempted if r.status == "FAILED"),
                timeout_runs=sum(1 for r in attempted if r.status == "TIMEOUT"),
                cached_runs=sum(1 for r in runs if r.status == "CACHED"),
                skipped_runs=sum(1 for r in runs if r.status in SKIPPED),
                success_rate=(Decimal(len(ok) * 100) / Decimal(len(attempted))).quantize(Decimal("0.1"))
                if attempted else None,
                avg_latency_ms=int(sum(latencies) / len(latencies)) if latencies else None,
                last_error=ProviderLastError(code=last_err.error_code, message=last_err.error_message,
                                             at=last_err.started_at) if last_err else None,
                last_run_at=last_run.started_at if last_run else None,
                last_run_status=last_run.status if last_run else None,
            )
        )
    return DiagnosticsOut(window_days=days, generated_at=utcnow(), providers=out)


# ------------------------------------------------- helpers for other modules ----


def revalidate_offer(db: Session, offer: CanonicalOffer) -> RevalidationResult:
    """Re-check an offer with its provider (DEMO adapters receive owner-set settings)."""
    adapter = registry.get_adapter(offer.source.provider_id)
    if not registry.is_usable(adapter):
        return RevalidationResult(status="error", offer_id=offer.id, checked_at=utcnow(),
                                  message="הספק אינו מחובר — לא ניתן לאמת את ההצעה")
    try:
        if adapter.capabilities().mode == "DEMO":
            return adapter.revalidate(offer, settings=registry.provider_settings(db, adapter.provider_id))  # type: ignore[call-arg]
        return adapter.revalidate(offer)
    except ProviderError as exc:
        return RevalidationResult(status="error", offer_id=offer.id, checked_at=utcnow(),
                                  message=clean_text(exc.message) or "אימות ההצעה נכשל")


def booking_options_for(offer: CanonicalOffer) -> BookingOptions:
    adapter = registry.get_adapter(offer.source.provider_id)
    options = adapter.booking_options(offer)
    if options.hosted_checkout_url and not adapter.is_allowed_deep_link(options.hosted_checkout_url):
        options = options.model_copy(update={"hosted_checkout_url": None})
    return options.model_copy(update={"live_api_booking": False})
