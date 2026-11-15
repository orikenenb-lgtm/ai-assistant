"""Builds the configured DraftEngine from any settings-like object (attributes read with getattr)."""

from __future__ import annotations

from typing import Any

from bridge_service.ai.anthropic_engine import DEFAULT_MODEL, AnthropicEngine
from bridge_service.ai.base import DraftEngine
from bridge_service.ai.noa_persona_engine import NoaPersonaEngine
from bridge_service.ai.stub import StubEngine

ENGINES = ("stub", "anthropic", "noa_persona")
DEFAULT_TIMEOUT_SECONDS = 20.0


def _secret(value: Any) -> str | None:
    """Accept plain strings or pydantic SecretStr without logging/echoing the value."""
    if value is None:
        return None
    getter = getattr(value, "get_secret_value", None)
    raw = getter() if callable(getter) else value
    raw = str(raw).strip()
    return raw or None


def _anthropic(settings: Any) -> AnthropicEngine:
    timeout = getattr(settings, "engine_timeout_seconds", None) or DEFAULT_TIMEOUT_SECONDS
    return AnthropicEngine(
        api_key=_secret(getattr(settings, "anthropic_api_key", None)),
        model=getattr(settings, "anthropic_model", None) or DEFAULT_MODEL,
        timeout=float(timeout),
        owner_display_name=getattr(settings, "owner_display_name", None),
    )


def create_engine(settings: Any) -> DraftEngine:
    kind = str(getattr(settings, "engine", None) or "stub").strip().lower()
    if kind == "stub":
        return StubEngine()
    if kind == "anthropic":
        return _anthropic(settings)
    if kind == "noa_persona":
        return NoaPersonaEngine(
            noa_engine_url=getattr(settings, "noa_engine_url", None),
            noa_engine_api_key=_secret(getattr(settings, "noa_engine_api_key", None)),
            noa_agent_id=getattr(settings, "noa_agent_id", None),
            generator=_anthropic(settings),
            # File mode (recommended): no NOA request and no NOA key at all.
            persona_file=getattr(settings, "persona_file", None) or None,
        )
    raise ValueError(f"unknown engine {kind!r}; expected one of {', '.join(ENGINES)}")
