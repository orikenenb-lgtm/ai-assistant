import json
from pathlib import Path

import httpx
import pytest

from app.agents.schema import AgentConfig
from app.calls import CallRecord
from app.config import Settings
from app.tools.base import ToolContext

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"


class FakeTwilio:
    def __init__(self):
        self.messages: list[dict] = []
        self.calls: list[dict] = []
        self.updates: list[tuple[str, str]] = []

    async def send_message(self, to, from_, body):
        self.messages.append({"to": to, "from": from_, "body": body})
        return f"SM{len(self.messages)}"

    async def create_call(self, to, from_, twiml, status_callback=None, time_limit_s=None):
        self.calls.append({"to": to, "from": from_, "twiml": twiml, "time_limit_s": time_limit_s})
        return f"CA{len(self.calls):032d}"

    async def update_call_twiml(self, call_sid, twiml):
        self.updates.append((call_sid, twiml))


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        public_base_url="https://engine.test",
        engine_api_key="test-key",
        twilio_account_sid="AC" + "0" * 32,
        twilio_auth_token="twilio-token",
        twilio_phone_number="+97233000000",
        anthropic_api_key="sk-test",
        elevenlabs_api_key="el-test",
        agents_dir=str(AGENTS_DIR),
        calls_dir=str(tmp_path / "calls"),
        morning_api_key_id="mid",
        morning_api_key_secret="msecret",
        morning_sandbox=True,
        blocked_numbers="052-1111111",
    )


def load_agent(agent_id: str) -> AgentConfig:
    return AgentConfig.model_validate(json.loads((AGENTS_DIR / f"{agent_id}.json").read_text("utf-8")))


@pytest.fixture
def make_ctx(settings):
    def factory(agent: AgentConfig, remote="+972532413215", twilio=None, http=None, test_mode=False):
        call = CallRecord(agent_id=agent.id, direction="inbound", remote_number=remote, twilio_call_sid="CA1")
        return ToolContext(
            agent=agent,
            call=call,
            settings=settings,
            http=http or httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500))),
            twilio=twilio,
            test_mode=test_mode,
        )

    return factory
