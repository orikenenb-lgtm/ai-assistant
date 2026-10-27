from datetime import datetime

import pytest
from pydantic import ValidationError

from app.agents.prompt import (
    MISSING,
    CallContext,
    MissingVariables,
    build_system_prompt,
    call_values,
    opening_line,
    render,
)
from app.agents.schema import AgentConfig, EndCallTool
from app.agents.store import AgentNotFound, FileAgentStore
from tests.conftest import AGENTS_DIR, load_agent

ASSISTANT_VARS = {"on_behalf_of": "אורי", "task_topic": "קביעת תור", "task_goal": "תור ביום חמישי"}


def minimal(**kw) -> AgentConfig:
    return AgentConfig.model_validate({"id": "t-agent", "name": "ט", "context": "ctx", "goal": "g", **kw})


def test_example_agents_load():
    store = FileAgentStore(AGENTS_DIR)
    ids = {a.id for a in store.list()}
    assert {"personal-assistant", "kerem-toys-orders"} <= ids


def test_store_rejects_path_tricks():
    store = FileAgentStore(AGENTS_DIR)
    for bad in ["../secrets", "a/b", ".hidden", "", "nope"]:
        with pytest.raises(AgentNotFound):
            store.get(bad)


def test_end_call_always_present():
    assert isinstance(minimal(tools=[]).tools[0], EndCallTool)


def test_webhook_must_be_https():
    with pytest.raises(ValidationError):
        minimal(tools=[{"type": "webhook", "name": "x", "description": "d", "url": "http://a.test"}])


def test_placeholders_detected_in_kerem_example():
    kerem = load_agent("kerem-toys-orders")
    found = kerem.unfilled_placeholders()
    assert len(found) == 5 and all(p.startswith("[למלא") for p in found)
    assert load_agent("personal-assistant").unfilled_placeholders() == []


def test_render_fills_and_marks_missing():
    assert render("שלום {{ name }}, {{x}}", {"name": "דנה"}) == f"שלום דנה, {MISSING}"


def test_required_variables_enforced():
    agent = load_agent("personal-assistant")
    with pytest.raises(MissingVariables) as e:
        call_values(agent, {"on_behalf_of": "אורי"}, CallContext(direction="outbound"))
    assert set(e.value.names) == {"task_topic", "task_goal"}


def test_prompt_contents():
    agent = load_agent("personal-assistant")
    started = datetime.fromisoformat("2026-10-29T14:30:00+02:00")  # a Thursday
    values = call_values(agent, ASSISTANT_VARS, CallContext("outbound", "+972532413215", started))
    prompt = build_system_prompt(agent, values)
    assert "אורי" in prompt and "{{" not in prompt
    assert "יום חמישי, 29/10/2026 14:30" in prompt
    assert "לחשוף את התקציב" in prompt
    assert "לשון נקבה" in prompt
    assert "שיחה יוצאת" in prompt
    assert opening_line(agent, values, "outbound").startswith("שלום, מדברת העוזרת הדיגיטלית של אורי")


def test_male_agent_prompt():
    agent = minimal(agent_gender="male")
    values = call_values(agent, {}, CallContext(direction="inbound"))
    assert "לשון זכר" in build_system_prompt(agent, values)


def test_opening_line_falls_back_between_directions():
    agent = minimal(opening_line="היי {{x}}")
    values = call_values(agent, {"x": "1"}, CallContext(direction="outbound"))
    assert opening_line(agent, values, "outbound") == "היי 1"
