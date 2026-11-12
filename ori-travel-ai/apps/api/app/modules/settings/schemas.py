from __future__ import annotations

from pydantic import ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator

from app.core.money import SUPPORTED_CURRENCIES
from app.schemas.common import ApiModel


class _Strict(ApiModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class RankingWeights(_Strict):
    cost: StrictInt = Field(..., ge=0, le=100)
    convenience: StrictInt = Field(..., ge=0, le=100)
    flexibility: StrictInt = Field(..., ge=0, le=100)
    quality: StrictInt = Field(..., ge=0, le=100)

    @model_validator(mode="after")
    def _sum(self):
        if self.cost + self.convenience + self.flexibility + self.quality != 100:
            raise ValueError("סכום המשקלות חייב להיות בדיוק 100")
        return self


class EnabledToggle(_Strict):
    enabled: StrictBool


class DisplaySettings(_Strict):
    currency: str

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in SUPPORTED_CURRENCIES:
            raise ValueError("מטבע לא נתמך")
        return v


class RetentionSettings(_Strict):
    search_days: StrictInt = Field(..., ge=7, le=365)
    audit_days: StrictInt = Field(..., ge=30, le=1825)


class SchedulerOut(ApiModel):
    enabled: bool
    allowed_by_server: bool


class AiOut(ApiModel):
    provider: str
    configured: bool
    model: str | None = None
    paid_allowed: bool


class BookingOut(ApiModel):
    live_execution: bool = False


class SettingsOut(ApiModel):
    ranking_weights: dict[str, int]
    scheduler: SchedulerOut
    map: dict[str, bool]
    display: dict[str, str]
    retention: dict[str, int]
    ai: AiOut
    booking: BookingOut
    encryption_available: bool
    live_providers_enabled: bool


class RetentionRunOut(ApiModel):
    search_requests_deleted: int
    offers_deleted: int
    audit_events_deleted: int
