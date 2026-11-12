"""The test suite must not load the developer's apps/api/.env (real tokens, local live switches)."""

from app.core.config import Settings, get_settings


def test_settings_do_not_read_local_env_file() -> None:
    assert Settings.model_config.get("env_file") is None


def test_live_switches_and_secrets_are_off_in_tests() -> None:
    s = get_settings()
    assert s.live_providers_enabled is False
    assert s.fx_live_enabled is False
    assert s.ai_provider == "none"
    assert not s.duffel_access_token
    assert not s.viator_api_key
