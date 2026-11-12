"""Provider registry: adapter lookup, enable/disable and usability.

* ``all_adapters()`` / ``get_adapter(id)`` / ``adapters_for_category(cat)``.
* Enable/disable lives in ``ProviderConfiguration`` rows (default enabled; rows
  are created lazily by ``ensure_configs``).
* LIVE adapters are *usable* only when ``settings.live_providers_enabled`` AND
  their credentials are present; otherwise they are NOT_CONFIGURED and are
  never called (no network access).
* Test hooks: ``register_adapter``, ``unregister_adapter``, ``override_adapters``
  (context manager), ``reset_registry``.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.models.system import ProviderConfiguration
from app.modules.providers.base import ProviderAdapter
from app.schemas.common import Category

_lock = threading.RLock()
_adapters: dict[str, ProviderAdapter] | None = None


def _default_adapters() -> list[ProviderAdapter]:
    from app.modules.providers.demo import DEMO_ADAPTER_CLASSES
    from app.modules.providers.live import LIVE_ADAPTER_CLASSES

    return [cls() for cls in (*DEMO_ADAPTER_CLASSES, *LIVE_ADAPTER_CLASSES)]


def _registry() -> dict[str, ProviderAdapter]:
    global _adapters
    with _lock:
        if _adapters is None:
            _adapters = {a.provider_id: a for a in _default_adapters()}
        return _adapters


def all_adapters() -> list[ProviderAdapter]:
    with _lock:
        return list(_registry().values())


def find_adapter(provider_id: str) -> ProviderAdapter | None:
    with _lock:
        return _registry().get(provider_id)


def get_adapter(provider_id: str) -> ProviderAdapter:
    adapter = find_adapter(provider_id)
    if adapter is None:
        raise NotFoundError("הספק לא נמצא", code="PROVIDER_NOT_FOUND")
    return adapter


def adapters_for_category(category: Category) -> list[ProviderAdapter]:
    return [a for a in all_adapters() if a.supports(category)]


def provider_display_name(provider_id: str) -> str:
    adapter = find_adapter(provider_id)
    return adapter.capabilities().display_name if adapter else provider_id


def is_usable(adapter: ProviderAdapter) -> bool:
    """Configured and (for LIVE) explicitly opted in. Never makes network calls."""
    try:
        if adapter.capabilities().mode == "LIVE" and not get_settings().live_providers_enabled:
            return False
        return bool(adapter.is_configured())
    except Exception:  # a broken adapter is simply not usable
        return False


# ---------------------------------------------------------- test hooks ----


def register_adapter(adapter: ProviderAdapter) -> None:
    """Add or replace an adapter (tests / future plugins)."""
    if not adapter.provider_id:
        raise ValueError("adapter.provider_id is required")
    with _lock:
        _registry()[adapter.provider_id] = adapter


def unregister_adapter(provider_id: str) -> None:
    with _lock:
        _registry().pop(provider_id, None)


def reset_registry() -> None:
    """Restore the default adapter set (fresh instances)."""
    global _adapters
    with _lock:
        _adapters = None


@contextmanager
def override_adapters(*adapters: ProviderAdapter, replace_all: bool = False) -> Iterator[None]:
    """Temporarily register adapters (optionally replacing the whole registry)."""
    global _adapters
    with _lock:
        saved = dict(_registry())
        if replace_all:
            _adapters = {}
        for a in adapters:
            register_adapter(a)
    try:
        yield
    finally:
        with _lock:
            _adapters = saved


# ------------------------------------------------------- configuration ----


def config_map(db: Session) -> dict[str, ProviderConfiguration]:
    rows = db.scalars(select(ProviderConfiguration)).all()
    return {r.provider_id: r for r in rows}


def ensure_configs(db: Session) -> dict[str, ProviderConfiguration]:
    """Create missing configuration rows (default enabled). Caller commits.

    Call before staging other changes in the session: on a concurrent-insert
    conflict the session is rolled back and the rows are re-read.
    """
    existing = config_map(db)
    missing = [a.provider_id for a in all_adapters() if a.provider_id not in existing]
    if missing:
        for pid in missing:
            db.add(ProviderConfiguration(provider_id=pid, enabled=True, settings={}))
        try:
            db.flush()
        except IntegrityError:  # created concurrently by another request
            db.rollback()
        existing = config_map(db)
    return existing


def get_config(db: Session, provider_id: str) -> ProviderConfiguration:
    get_adapter(provider_id)
    return ensure_configs(db)[provider_id]


def is_enabled(db: Session, provider_id: str) -> bool:
    row = db.scalar(select(ProviderConfiguration).where(ProviderConfiguration.provider_id == provider_id))
    return True if row is None else bool(row.enabled)


def provider_settings(db: Session, provider_id: str) -> dict[str, Any]:
    row = db.scalar(select(ProviderConfiguration).where(ProviderConfiguration.provider_id == provider_id))
    return dict(row.settings or {}) if row is not None else {}
