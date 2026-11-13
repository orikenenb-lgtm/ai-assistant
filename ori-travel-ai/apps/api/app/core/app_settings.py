"""Family-wide settings stored in the ``app_settings`` table.

Keys and defaults are declared here so every module reads the same values.
The settings HTTP API (app/modules/settings) validates writes.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from app.models.system import AppSetting

# Default ranking weights (percent). Must sum to 100.
DEFAULT_RANKING_WEIGHTS = {"cost": 40, "convenience": 25, "flexibility": 20, "quality": 15}

DEFAULTS: dict[str, dict[str, Any]] = {
    "ranking_weights": dict(DEFAULT_RANKING_WEIGHTS),
    # Price monitoring scheduler: opt-in (also requires ORI_SCHEDULER_ALLOWED=true)
    "scheduler": {"enabled": False},
    # Map tiles from OpenStreetMap are opt-in for privacy
    "map": {"enabled": False},
    # Preferred display currency (no automatic conversion without FX data)
    "display": {"currency": "ILS"},
    # Data retention for search history/offers/snapshots (days)
    "retention": {"search_days": 90, "audit_days": 365},
}


def get_setting(db: Session, key: str) -> dict[str, Any]:
    row = db.get(AppSetting, key)
    default = deepcopy(DEFAULTS.get(key, {}))
    if row is None:
        return default
    merged = default
    merged.update(row.value or {})
    return merged


def set_setting(db: Session, key: str, value: dict[str, Any], user_id: str | None) -> dict[str, Any]:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value, updated_by_id=user_id)
        db.add(row)
    else:
        row.value = value
        row.updated_by_id = user_id
    return get_setting_from_value(key, value)


def get_setting_from_value(key: str, value: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(DEFAULTS.get(key, {}))
    merged.update(value)
    return merged
