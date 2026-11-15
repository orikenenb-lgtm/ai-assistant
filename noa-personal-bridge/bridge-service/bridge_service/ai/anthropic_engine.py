"""Tool-free drafting with the Anthropic Messages API.

The request never carries `tools`, `tool_choice` or MCP servers: the model can only
return text. Only `text` content blocks are read; any other block type is ignored.
"""

from __future__ import annotations

import logging
from typing import Any

import anthropic

from bridge_service.ai.base import DraftInput, DraftOutput, EngineError, SafetyReport
from bridge_service.ai.output_guard import finalize
from bridge_service.ai.prompt import build_messages
from bridge_service.ai.safety import analyze_incoming

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-haiku-5-5"
DEFAULT_MAX_TOKENS = 300
# Models on which thinking cannot be switched off ({"type": "disabled"} is a 400). For them
# we omit `thinking`, ask for low effort and leave room for thinking tokens in max_tokens.
_THINKING_ALWAYS_ON = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable", "claude-mythos")
_ALWAYS_ON_MIN_MAX_TOKENS = 2048


def request_options(model: str, max_tokens: int) -> dict[str, Any]:
    """Model-dependent knobs. No sampling params: current models reject non-default temperature."""
    if model.startswith(_THINKING_ALWAYS_ON):
        return {
            "max_tokens": max(max_tokens, _ALWAYS_ON_MIN_MAX_TOKENS),
            "extra_body": {"output_config": {"effort": "low"}},
        }
    # Short reply, no reasoning needed: keep thinking off so max_tokens is all reply.
    return {"max_tokens": max_tokens, "thinking": {"type": "disabled"}}


def _map_error(exc: Exception) -> EngineError:
    # Messages never include request contents or credentials.
    if isinstance(exc, anthropic.APITimeoutError):
        return EngineError("anthropic: request timed out", retryable=True)
    if isinstance(exc, anthropic.APIConnectionError):
        return EngineError("anthropic: connection error", retryable=True)
    if isinstance(exc, anthropic.RateLimitError):
        return EngineError("anthropic: rate limited (429)", retryable=True)
    if isinstance(exc, anthropic.APIStatusError):
        status = exc.status_code
        retryable = status >= 500 or status in (408, 409)
        return EngineError(f"anthropic: API error (status {status})", retryable=retryable)
    return EngineError(f"anthropic: unexpected error ({type(exc).__name__})", retryable=True)


class AnthropicEngine:
    name = "anthropic"

    def __init__(
        self,
        api_key: str | None,
        model: str = DEFAULT_MODEL,
        *,
        timeout: float = 20.0,
        owner_display_name: str | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        max_retries: int = 1,
        base_url: str | None = None,
    ) -> None:
        self._api_key = api_key or None
        self.model = model or DEFAULT_MODEL
        self._timeout = timeout
        self._owner = owner_display_name
        self._max_tokens = max_tokens
        self._max_retries = max_retries
        self._base_url = base_url
        self._client: anthropic.AsyncAnthropic | None = None

    def _get_client(self) -> anthropic.AsyncAnthropic:
        if not self._api_key:
            # Never fall back to ambient env credentials; config is explicit.
            raise EngineError("anthropic: API key is not configured", retryable=False)
        if self._client is None:
            kwargs: dict[str, Any] = {
                "api_key": self._api_key,
                "max_retries": self._max_retries,
                "timeout": self._timeout,
            }
            if self._base_url:
                kwargs["base_url"] = self._base_url
            self._client = anthropic.AsyncAnthropic(**kwargs)
        return self._client

    async def generate(self, data: DraftInput, report: SafetyReport, persona: str | None = None) -> str:
        """One tool-free Messages call -> finalized draft text. Raises EngineError."""
        client = self._get_client()
        system, messages = build_messages(data, persona, self._owner, report)
        try:
            # NOTE: deliberately no `tools`, `tool_choice` or `mcp_servers` arguments.
            resp = await client.messages.create(
                model=self.model,
                system=system,
                messages=messages,  # type: ignore[arg-type]
                **request_options(self.model, self._max_tokens),
            )
        except EngineError:
            raise
        except Exception as exc:  # noqa: BLE001 - mapped to a sanitized EngineError
            err = _map_error(exc)
            log.warning("draft generation failed: %s", err)
            raise err from None
        text = ""
        if getattr(resp, "stop_reason", None) != "refusal":
            text = "".join(
                getattr(block, "text", "") or ""
                for block in (resp.content or [])
                if getattr(block, "type", None) == "text"
            )
        return finalize(text, data, report, persona=persona)

    async def draft(self, data: DraftInput) -> DraftOutput:
        report = analyze_incoming(data.messages, sender_display_name=data.sender_display_name)
        text = await self.generate(data, report, persona=None)
        return DraftOutput(draft_text=text, safety=report, engine=self.name)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
