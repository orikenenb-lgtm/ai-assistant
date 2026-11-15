"""Runtime configuration (env prefix ``BRIDGE_``). Owned by the Backend team.

Field names used by ``bridge_service.ai.factory.create_engine(settings)`` are part of the
contract with the AI team and must not be renamed: engine, anthropic_api_key, anthropic_model,
noa_engine_url, noa_engine_api_key, noa_agent_id, persona_file, engine_timeout_seconds,
owner_display_name.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BRIDGE_",
        env_file=None,  # never read a .env implicitly; export variables explicitly
        extra="ignore",
        frozen=True,
    )

    # --- feature flag / kill switch -------------------------------------------------------
    enabled: bool = False
    """Master switch. False → /v1/pair and /v1/drafts answer 503 `disabled`."""
    kill_switch_file: str | None = None
    """If set and the file exists, the service behaves as disabled (no restart needed)."""

    # --- storage --------------------------------------------------------------------------
    db_path: str = "data/bridge.sqlite3"

    # --- AI engine (read by bridge_service.ai.factory) -----------------------------------
    engine: Literal["stub", "anthropic", "noa_persona"] = "stub"
    anthropic_api_key: str | None = Field(default=None, repr=False)
    anthropic_model: str = "claude-haiku-5-5"
    noa_engine_url: str | None = None
    noa_engine_api_key: str | None = Field(default=None, repr=False)
    noa_agent_id: str | None = None
    persona_file: str | None = None
    """noa_persona only: read the persona from this UTF-8 file (max 20 KB, re-read when it
    changes) instead of fetching it from NOA. In this mode the bridge makes NO request to NOA
    and needs no BRIDGE_NOA_ENGINE_API_KEY. Create it once with
    ``python -m bridge_service.admin export-persona --out <file>``. Recommended default."""
    engine_timeout_seconds: float = Field(default=25.0, gt=0, le=120)
    owner_display_name: str | None = None
    max_concurrent_drafts: int = Field(default=8, ge=1, le=256)

    # --- abuse limits ---------------------------------------------------------------------
    rate_limit_per_minute: int = Field(default=30, ge=1)
    rate_limit_per_day: int = Field(default=300, ge=1)
    pairing_attempts_per_hour: int = Field(default=10, ge=1)
    """Per client IP (successful attempts count too)."""
    pairing_failures_per_hour_global: int = Field(default=20, ge=1)
    """Across ALL IPs: once this many pairing attempts failed in the last hour, every pairing
    attempt (even with a valid code) gets 429 until the oldest of them is an hour old."""
    pairing_pepper: str | None = Field(default=None, repr=False, min_length=16)
    """Secret key for HMAC-SHA256 of pairing codes. If unset, a random one is generated on first
    start and kept in ``pepper.key`` next to the database (0600), never inside the database."""
    pairing_code_ttl_minutes: int = Field(default=10, ge=1, le=60)
    replay_window_seconds: int = Field(default=300, ge=10, le=3600)
    nonce_quota_per_device: int = Field(default=200, ge=10)
    """Max live (unexpired) nonces per device; beyond → 429 for that device only."""
    auth_failures_per_10_minutes: int = Field(default=60, ge=1)
    """Per client IP: after this many failed authentications in 10 minutes → 429, without a DB lookup."""
    idempotency_ttl_seconds: int = Field(default=600, ge=1, le=3600)
    max_body_bytes: int = Field(default=64 * 1024, ge=1024, le=1024 * 1024)
    memory_max_entries: int = Field(default=50_000, ge=100)
    """Upper bound for each in-memory store (nonces, idempotency cache, rate-limit keys)."""

    # --- HTTP ------------------------------------------------------------------------------
    trust_proxy_headers: bool = False
    """True ONLY when the service is reachable solely through a reverse proxy you control that
    OVERWRITES (not appends to a client-supplied) X-Forwarded-For, and the service itself listens
    on loopback. Client IP = last X-Forwarded-For hop. Otherwise a forged header defeats every
    per-IP limit (pairing attempts, failed authentication)."""
    debug_docs: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=8787, ge=1, le=65535)
    access_log: bool = False
    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
