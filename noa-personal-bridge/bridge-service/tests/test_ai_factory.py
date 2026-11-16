"""create_engine reads any settings-like object."""

from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from bridge_service.ai.anthropic_engine import AnthropicEngine
from bridge_service.ai.factory import create_engine
from bridge_service.ai.noa_persona_engine import NoaPersonaEngine
from bridge_service.ai.stub import StubEngine

pytestmark = pytest.mark.asyncio


async def test_stub_default_for_bare_object():
    e = create_engine(object())
    assert isinstance(e, StubEngine) and e.name == "stub"
    await e.aclose()


async def test_stub_explicit():
    assert isinstance(create_engine(SimpleNamespace(engine="stub")), StubEngine)


async def test_anthropic_defaults():
    e = create_engine(SimpleNamespace(engine="anthropic", anthropic_api_key="test-not-a-real-key"))
    assert isinstance(e, AnthropicEngine) and e.name == "anthropic"
    assert e.model == "claude-haiku-5-5"
    await e.aclose()


async def test_anthropic_custom_and_secretstr():
    e = create_engine(
        SimpleNamespace(
            engine="ANTHROPIC",
            anthropic_api_key=SecretStr("test-not-a-real-key"),
            anthropic_model="claude-sonnet-5",
            engine_timeout_seconds=7,
            owner_display_name="דנה",
        )
    )
    assert isinstance(e, AnthropicEngine)
    assert e.model == "claude-sonnet-5"
    assert e._timeout == 7.0 and e._owner == "דנה"
    assert e._api_key == "test-not-a-real-key"


async def test_noa_persona():
    e = create_engine(
        SimpleNamespace(
            engine="noa_persona",
            anthropic_api_key="test-not-a-real-key",
            noa_engine_url="https://noa.example",
            noa_engine_api_key=SecretStr("noa-test-key"),
            noa_agent_id="noa",
        )
    )
    assert isinstance(e, NoaPersonaEngine) and e.name == "noa_persona"
    assert isinstance(e._generator, AnthropicEngine)
    await e.aclose()


async def test_unknown_engine():
    with pytest.raises(ValueError):
        create_engine(SimpleNamespace(engine="chat"))
    with pytest.raises(ValueError):
        create_engine(SimpleNamespace(engine="noa_chat"))
