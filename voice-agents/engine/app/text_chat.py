"""Talk to an agent in text, with the same prompt and tools a phone call gets.

Used to test an agent before it goes live, without spending call minutes.
Tools really run, so point side-effect tools (SMS, documents) at sandboxes when testing.
"""

import json
from typing import Any

from anthropic import AsyncAnthropic

from app.agents.prompt import CallContext, build_system_prompt, call_values, opening_line
from app.agents.schema import AgentConfig
from app.tools.toolbox import Toolbox

MAX_TOOL_ROUNDS = 6


def anthropic_tools(toolbox: Toolbox) -> list[dict[str, Any]]:
    return [
        {
            "name": t.spec.name,
            "description": t.spec.description,
            "input_schema": {
                "type": "object",
                "properties": t.spec.properties,
                "required": t.spec.required,
            },
        }
        for t in toolbox.tools.values()
    ]


async def chat_turn(
    client: AsyncAnthropic,
    model: str,
    agent: AgentConfig,
    toolbox: Toolbox,
    history: list[dict[str, str]],
    direction: str = "outbound",
) -> dict[str, Any]:
    """history: [{'role': 'user'|'assistant', 'content': str}, ...] ending with the caller's line.

    Returns the agent's reply, the tools it used and whether it ended the call.
    """
    values = call_values(agent, toolbox.ctx.call.variables, CallContext(direction=direction))
    system = build_system_prompt(agent, values)
    first = opening_line(agent, values, direction)
    messages: list[dict[str, Any]] = []
    if first:
        # The opening line is spoken before the caller says anything.
        messages.append({"role": "user", "content": "(השיחה התחברה)"})
        messages.append({"role": "assistant", "content": first})
    messages += [{"role": m["role"], "content": m["content"]} for m in history]

    used: list[dict[str, Any]] = []
    reply_parts: list[str] = []
    ended = False
    for _ in range(MAX_TOOL_ROUNDS):
        response = await client.messages.create(
            model=model,
            max_tokens=600,
            system=system,
            tools=anthropic_tools(toolbox),
            messages=messages,
        )
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        reply_parts += [b.text for b in response.content if b.type == "text" and b.text.strip()]
        if not tool_uses:
            break
        messages.append({"role": "assistant", "content": [b.model_dump() for b in response.content]})
        results = []
        for block in tool_uses:
            result = await toolbox.execute(block.name, dict(block.input or {}))
            used.append(
                {"name": block.name, "arguments": block.input, "ok": result.ok, "result": result.data}
            )
            ended = ended or result.end_call or result.transferred
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result.data, ensure_ascii=False, default=str),
                    "is_error": not result.ok,
                }
            )
        messages.append({"role": "user", "content": results})
        if ended:
            break
    return {"reply": " ".join(reply_parts).strip(), "tools": used, "ended": ended}
