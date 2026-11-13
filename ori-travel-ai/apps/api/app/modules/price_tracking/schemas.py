from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, Category, Money
from app.schemas.offers import CanonicalOffer


class AlertCreate(ApiModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: Category
    search_params: dict
    target_price: Money | None = None
    check_interval_minutes: int = Field(..., ge=1, le=60 * 24 * 30)


class AlertUpdate(ApiModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    search_params: dict | None = None
    target_price: Money | None = None
    check_interval_minutes: int | None = Field(None, ge=1, le=60 * 24 * 30)
    is_active: bool | None = None


class AlertOut(ApiModel):
    id: str
    user_id: str
    owner_name: str | None = None
    name: str
    category: Category
    search_params: dict
    target_price: Money | None = None
    currency: str
    is_active: bool
    check_interval_minutes: int
    last_checked_at: datetime | None = None
    next_check_at: datetime | None = None
    last_best_price: Money | None = None
    last_best_mode: Literal["DEMO", "LIVE", "CACHED", "SANDBOX"] | None = None
    # NEVER / OK / FAILED / NO_RESULTS / EXPIRED
    last_status: str
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class SnapshotOut(ApiModel):
    id: str
    alert_id: str | None = None
    offer_id: str | None = None
    provider_id: str | None = None
    mode: Literal["DEMO", "LIVE", "CACHED", "SANDBOX"] | None = None
    price: Money | None = None
    status: str
    error_message: str | None = None
    captured_at: datetime


class CheckOut(ApiModel):
    status: str
    best_offer: CanonicalOffer | None = None
    # True only when this check crossed the target (price now <= target, previous best was above/none)
    triggered: bool
    # True whenever the best price is at or below the target
    target_reached: bool = False
    snapshot: SnapshotOut | None = None
    alert: AlertOut
