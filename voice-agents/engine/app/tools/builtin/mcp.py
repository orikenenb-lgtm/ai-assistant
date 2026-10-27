"""Connects an agent to every tool of a remote MCP server."""

import re
from contextlib import AsyncExitStack
from typing import Any

import httpx2
from loguru import logger
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.agents.schema import McpServerTool
from app.tools.base import ToolContext, ToolError, ToolResult, ToolSpec
from app.tools.builtin.webhook import expand_env, truncate_result

_NAME_OK = re.compile(r"[^a-zA-Z0-9_-]")


def _field(obj: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        if hasattr(obj, name):
            return getattr(obj, name)
    return default


class McpTool:
    """One tool of an MCP server, called through the server's shared session."""

    def __init__(self, server: "McpServer", remote_name: str, spec: ToolSpec):
        self.server = server
        self.remote_name = remote_name
        self.spec = spec

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        return await self.server.call(self.remote_name, args)


class McpServer:
    """Holds one MCP session open for the length of a call."""

    def __init__(self, config: McpServerTool, server: Any = None):
        self.config = config
        # Tests pass an in-process server; production connects by URL.
        self._server = server
        self._stack = AsyncExitStack()
        self._client: Client | None = None

    async def connect(self) -> list[McpTool]:
        if self._server is not None:
            target = self._server
        else:
            headers = {k: expand_env(v) for k, v in self.config.headers.items()}
            http = httpx2.AsyncClient(headers=headers, timeout=httpx2.Timeout(15, read=60))
            await self._stack.enter_async_context(http)
            target = streamable_http_client(str(self.config.url), http_client=http)
        self._client = await self._stack.enter_async_context(Client(target))
        listed = await self._client.list_tools()
        tools = []
        for t in _field(listed, "tools", default=[]):
            if self.config.allow is not None and t.name not in self.config.allow:
                continue
            schema = _field(t, "input_schema", "inputSchema", default={}) or {}
            local_name = _NAME_OK.sub("_", f"{self.config.name}__{t.name}")[:64]
            spec = ToolSpec(
                name=local_name,
                description=(t.description or t.name)[:1000],
                properties=schema.get("properties", {}),
                required=list(schema.get("required", [])),
            )
            tools.append(McpTool(self, t.name, spec))
        logger.info(f"MCP {self.config.name}: {len(tools)} tools")
        return tools

    async def call(self, name: str, args: dict[str, Any]) -> ToolResult:
        if self._client is None:
            raise ToolError("החיבור למערכת החיצונית לא פעיל")
        try:
            result = await self._client.call_tool(name, args)
        except Exception as e:  # noqa: BLE001 - any transport failure means the same to the agent
            logger.warning(f"MCP {self.config.name}.{name} failed: {e}")
            raise ToolError("המערכת החיצונית לא הגיבה") from e
        texts = [c.text for c in _field(result, "content", default=[]) if hasattr(c, "text")]
        structured = _field(result, "structured_content", "structuredContent")
        data = structured if structured is not None else "\n".join(texts)
        if _field(result, "is_error", "isError", default=False):
            raise ToolError(f"המערכת החיצונית החזירה שגיאה: {str(data)[:300]}")
        return ToolResult(truncate_result(data))

    async def close(self) -> None:
        await self._stack.aclose()
        self._client = None
