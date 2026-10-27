"""Builds the set of tools one call may use and runs them safely."""

from typing import Any

from loguru import logger

from app.agents.schema import (
    EndCallTool,
    McpServerTool,
    MorningDocumentTool,
    SendSmsTool,
    SendWhatsappTool,
    TransferCallTool,
    WebhookTool,
)
from app.tools.base import Tool, ToolContext, ToolError, ToolResult
from app.tools.builtin.mcp import McpServer
from app.tools.builtin.morning import MorningDocument
from app.tools.builtin.telephony import EndCall, SendSms, SendWhatsapp, TransferCall
from app.tools.builtin.webhook import Webhook


class Toolbox:
    def __init__(self, ctx: ToolContext):
        self.ctx = ctx
        self.tools: dict[str, Tool] = {}
        self._mcp_servers: list[McpServer] = []

    @classmethod
    async def create(cls, ctx: ToolContext, mcp_overrides: dict[str, Any] | None = None) -> "Toolbox":
        box = cls(ctx)
        for config in ctx.agent.tools:
            if isinstance(config, EndCallTool):
                box._add(EndCall())
            elif isinstance(config, SendSmsTool):
                box._add(SendSms(config))
            elif isinstance(config, SendWhatsappTool):
                box._add(SendWhatsapp(config))
            elif isinstance(config, TransferCallTool):
                box._add(TransferCall(config))
            elif isinstance(config, WebhookTool):
                box._add(Webhook(config))
            elif isinstance(config, MorningDocumentTool):
                box._add(MorningDocument(config))
            elif isinstance(config, McpServerTool):
                server = McpServer(config, server=(mcp_overrides or {}).get(config.name))
                try:
                    for tool in await server.connect():
                        box._add(tool)
                    box._mcp_servers.append(server)
                except Exception as e:  # noqa: BLE001 - a dead integration must not kill the call
                    logger.error(f"MCP server {config.name} unavailable, continuing without it: {e}")
                    await server.close()
        return box

    def _add(self, tool: Tool) -> None:
        if tool.spec.name in self.tools:
            raise ValueError(f"Two tools named {tool.spec.name!r} in agent {self.ctx.agent.id}")
        self.tools[tool.spec.name] = tool

    async def execute(self, name: str, args: dict[str, Any]) -> ToolResult:
        """Run a tool. Never raises: failures become a result the agent can talk about."""
        tool = self.tools.get(name)
        if tool is None:
            result = ToolResult({"error": "אין כלי כזה"}, ok=False)
        else:
            try:
                result = await tool.run(args, self.ctx)
            except ToolError as e:
                result = ToolResult({"error": str(e)}, ok=False)
            except Exception:  # noqa: BLE001
                logger.exception(f"Tool {name} crashed")
                result = ToolResult({"error": "תקלה טכנית בביצוע הפעולה"}, ok=False)
        self.ctx.call.add_tool_call(name, _redact(args), result.ok, result.data)
        return result

    async def close(self) -> None:
        for server in self._mcp_servers:
            try:
                await server.close()
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Closing MCP server failed: {e}")
        self._mcp_servers.clear()


_SENSITIVE = ("password", "secret", "token", "card", "cvv", "id_number")


def _redact(args: dict[str, Any]) -> dict[str, Any]:
    return {k: ("***" if any(s in k.lower() for s in _SENSITIVE) else v) for k, v in args.items()}
