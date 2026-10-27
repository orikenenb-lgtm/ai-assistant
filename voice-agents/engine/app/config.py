"""Engine settings, read from environment variables (or a local .env file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Public base URL of this server, e.g. https://engine.example.com.
    # Twilio needs it to reach the TwiML and WebSocket endpoints.
    public_base_url: str = ""

    # Key that protects the engine's own REST API (outbound calls, call logs).
    engine_api_key: str = ""

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    # Default caller ID for outbound calls (E.164, e.g. +97233...).
    twilio_phone_number: str = ""
    # Verify X-Twilio-Signature on webhooks. Only disable for local tunnels while debugging.
    twilio_validate_signature: bool = True

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-5-5"

    elevenlabs_api_key: str = ""
    elevenlabs_default_voice_id: str = ""
    elevenlabs_tts_model: str = "eleven_flash_v2_5"

    # Directory with agent definitions (*.json). Replaced by the database later.
    agents_dir: str = "agents"
    # Directory where finished calls (transcript + tool log) are written as JSON.
    calls_dir: str = "data/calls"

    # Green Invoice / Morning (https://www.greeninvoice.co.il) credentials.
    morning_api_key_id: str = ""
    morning_api_key_secret: str = ""
    morning_sandbox: bool = True

    # Numbers the engine refuses to dial (comma separated, any Israeli format).
    blocked_numbers: str = ""

    @property
    def blocked_number_set(self) -> set[str]:
        from app.telephony.phone import normalize_il_number

        numbers = set()
        for raw in self.blocked_numbers.split(","):
            if raw.strip():
                numbers.add(normalize_il_number(raw))
        return numbers


@lru_cache
def get_settings() -> Settings:
    return Settings()
