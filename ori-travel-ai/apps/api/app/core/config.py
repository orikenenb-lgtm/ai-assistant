"""Application configuration.

All settings come from environment variables (or a local ``.env`` file).
Secrets are NEVER hard-coded; ``.env.example`` documents every variable
without real values.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]  # apps/api
PROJECT_ROOT = API_ROOT.parents[1]  # ori-travel-ai


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(API_ROOT / ".env"),
        env_file_encoding="utf-8",
        env_prefix="ORI_",
        extra="ignore",
    )

    # ---- general ----
    env: Literal["development", "test", "production"] = "development"
    app_name: str = "Ori Travel AI"
    database_url: str = f"sqlite:///{(API_ROOT / 'data' / 'ori_travel.db').as_posix()}"
    # Comma separated list of exact origins. Never "*".
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Serve the built web app (apps/web/dist) from FastAPI when present.
    serve_web: bool = True
    web_dist_dir: str = str(PROJECT_ROOT / "apps" / "web" / "dist")

    # ---- sessions / auth ----
    session_cookie_name: str = "ori_session"
    csrf_cookie_name: str = "ori_csrf"
    session_ttl_hours: int = 24 * 7
    session_idle_timeout_hours: int = 24 * 2
    # Secure cookies require HTTPS. Local http://localhost development uses False.
    cookie_secure: bool = False
    login_max_failures: int = 5
    login_lockout_minutes: int = 15
    invitation_ttl_hours: int = 72

    # ---- encryption of sensitive traveler data ----
    # Fernet key (urlsafe base64, 32 bytes). Generate with: python -m app.cli gen-key
    data_key: str | None = None

    # ---- providers ----
    provider_timeout_seconds: float = 12.0
    provider_max_concurrency: int = 4
    search_cache_ttl_minutes: int = 15
    # Live provider credentials (all optional; absent => NOT CONNECTED)
    duffel_access_token: str | None = None
    amadeus_client_id: str | None = None
    amadeus_client_secret: str | None = None
    amadeus_env: Literal["test", "production"] = "test"
    booking_demand_api_key: str | None = None
    booking_demand_affiliate_id: str | None = None
    expedia_rapid_api_key: str | None = None
    expedia_rapid_shared_secret: str | None = None
    viator_api_key: str | None = None
    # Live providers are additionally gated by an explicit opt-in flag so that
    # a pasted key never silently starts spending quota.
    live_providers_enabled: bool = False
    # Official FX reference rates (ECB) for display-only conversions. Opt-in.
    fx_live_enabled: bool = False
    fx_timeout_seconds: float = 8.0

    # ---- AI ----
    ai_provider: Literal["none", "ollama", "anthropic"] = "none"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5-5"
    # Paid cloud LLM calls require this explicit cost authorization flag.
    ai_allow_paid: bool = False
    ai_max_tool_calls_per_turn: int = 4
    ai_timeout_seconds: float = 60.0

    # ---- price monitoring ----
    # The scheduler must be enabled BOTH here and in the in-app settings.
    scheduler_allowed: bool = False
    scheduler_tick_seconds: int = 300
    alert_min_interval_minutes: int = 360
    alert_max_checks_per_tick: int = 5

    # ---- booking safety ----
    # Real booking execution is hard-disabled in V1. This flag exists only so the
    # code path is explicit; the booking service refuses LIVE execution regardless
    # unless a separately authorized live executor is implemented.
    booking_live_execution: bool = False
    approval_ttl_minutes: int = 30

    # ---- demo ----
    allow_demo_seed: bool = True

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard(cls, v: str) -> str:
        if "*" in v:
            raise ValueError("Wildcard CORS origins are not allowed")
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_test(self) -> bool:
        return self.env == "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()


# Fields that must never be logged or returned by any API.
SECRET_SETTING_FIELDS = frozenset(
    {
        "data_key",
        "duffel_access_token",
        "amadeus_client_id",
        "amadeus_client_secret",
        "booking_demand_api_key",
        "booking_demand_affiliate_id",
        "expedia_rapid_api_key",
        "expedia_rapid_shared_secret",
        "viator_api_key",
        "anthropic_api_key",
    }
)

