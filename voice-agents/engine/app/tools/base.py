"""What a tool is, independent of the voice framework that calls it."""

from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.agents.schema import AgentConfig
from app.calls import CallRecord
from app.config import Settings


@dataclass
class ToolSpec:
    name: str
    description: str
    # JSON-schema properties of the arguments.
    properties: dict[str, Any] = field(default_factory=dict)
    required: list[str] = field(default_factory=list)


@dataclass
class ToolResult:
    data: Any
    ok: bool = True
    # The engine ends the call after the agent has spoken.
    end_call: bool = False
    # The call left the engine (transferred); don't hang it up when the stream closes.
    transferred: bool = False


@dataclass
class ToolContext:
    agent: AgentConfig
    call: CallRecord
    settings: Settings
    http: httpx.AsyncClient
    twilio: Any = None  # app.telephony.twilio_api.TwilioApi, when configured
    # Text test of an agent: tools with real-world effects are simulated.
    test_mode: bool = False


class Tool(Protocol):
    spec: ToolSpec

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult: ...


class ToolError(Exception):
    """An expected failure the agent should hear about in plain words."""
