"""Any HTTPS endpoint of the business, exposed to the agent as a tool."""

import json
import os
import re
from typing import Any

import httpx

from app.agents.schema import WebhookTool
from app.tools.base import ToolContext, ToolError, ToolResult, ToolSpec

MAX_RESULT_CHARS = 4000
_ENV = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")


def expand_env(value: str) -> str:
    """'Bearer ${CRM_TOKEN}' -> 'Bearer <value of CRM_TOKEN>'. Secrets stay out of agent files."""

    def sub(m: re.Match) -> str:
        if m.group(1) not in os.environ:
            raise ToolError(f"משתנה סביבה {m.group(1)} לא מוגדר")
        return os.environ[m.group(1)]

    return _ENV.sub(sub, value)


def truncate_result(data: Any) -> Any:
    text = json.dumps(data, ensure_ascii=False)
    if len(text) <= MAX_RESULT_CHARS:
        return data
    return {"truncated": True, "text": text[:MAX_RESULT_CHARS]}


class Webhook:
    def __init__(self, config: WebhookTool):
        self.config = config
        self.spec = ToolSpec(
            name=config.name,
            description=config.description,
            properties={p.name: {"type": p.type, "description": p.description} for p in config.params},
            required=[p.name for p in config.params if p.required],
        )

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        allowed = {p.name for p in self.config.params}
        payload = {k: v for k, v in args.items() if k in allowed}
        meta = {
            "call_id": ctx.call.id,
            "agent_id": ctx.agent.id,
            "remote_number": ctx.call.remote_number,
            "direction": ctx.call.direction,
            # Lets the business endpoint skip real side effects during text tests.
            "test": ctx.test_mode,
        }
        headers = {k: expand_env(v) for k, v in self.config.headers.items()}
        url = str(self.config.url)
        try:
            if self.config.method == "GET":
                resp = await ctx.http.get(
                    url, params={**payload, **meta}, headers=headers, timeout=self.config.timeout_s
                )
            else:
                resp = await ctx.http.post(
                    url,
                    json={"arguments": payload, "call": meta},
                    headers=headers,
                    timeout=self.config.timeout_s,
                )
        except httpx.TimeoutException as e:
            raise ToolError("המערכת לא ענתה בזמן") from e
        except httpx.HTTPError as e:
            raise ToolError("לא הצלחתי להתחבר למערכת") from e
        if resp.status_code >= 400:
            raise ToolError(f"המערכת החזירה שגיאה ({resp.status_code})")
        try:
            data = resp.json()
        except ValueError:
            data = {"text": resp.text}
        return ToolResult(truncate_result(data))
