"""API schemas for the providers module."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from app.modules.providers.base import ProviderCapabilities, ProviderHealth, ProviderHealthStatus
from app.schemas.common import ApiModel, Category, DataMode, DecimalStr


class ProviderStatusOut(ApiModel):
    provider_id: str
    display_name: str
    mode: DataMode
    categories: list[Category]
    status: ProviderHealthStatus
    enabled: bool
    configured: bool
    capabilities: ProviderCapabilities
    last_health: ProviderHealth | None = None
    requires_credentials: list[str] = Field(default_factory=list)  # env var NAMES only, never values
    setup_doc: str | None = None
    setup_instructions: str
    settings: dict[str, Any] = Field(default_factory=dict)  # non-secret settings
    notes: str | None = None


class ProviderConfigIn(ApiModel):
    enabled: bool
    settings: dict[str, Any] | None = None


class ProviderLastError(ApiModel):
    code: str | None = None
    message: str | None = None
    at: datetime


class ProviderDiagnosticsOut(ApiModel):
    provider_id: str
    display_name: str
    mode: DataMode
    status: ProviderHealthStatus
    runs: int  # attempted runs (OK / FAILED / TIMEOUT)
    ok_runs: int
    failed_runs: int
    timeout_runs: int
    cached_runs: int
    skipped_runs: int  # NOT_CONFIGURED / DISABLED / UNSUPPORTED
    success_rate: DecimalStr | None = None  # percent, 0-100
    avg_latency_ms: int | None = None
    last_error: ProviderLastError | None = None
    last_run_at: datetime | None = None
    last_run_status: str | None = None


class AirportOut(ApiModel):
    """One airport of the offline geo dataset (V6 contract §3)."""

    code: str  # IATA airport code
    city_code: str  # IATA city / metropolitan code
    name_he: str
    name_en: str
    city_he: str
    city_en: str
    country_code: str  # ISO 3166-1 alpha-2
    lat: float
    lon: float
    timezone: str  # IANA


class DiagnosticsOut(ApiModel):
    window_days: int
    generated_at: datetime
    providers: list[ProviderDiagnosticsOut]
