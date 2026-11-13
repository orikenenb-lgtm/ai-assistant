"""LLM provider abstraction for the AI assistant.

The app works fully WITHOUT a model: ``DisabledClient`` (provider ``none``) is
the default and every AI endpoint has a deterministic fallback.

Implementations (all speak plain ``httpx``; no SDK dependency):

* ``DisabledClient``  — provider ``none``; never available.
* ``OllamaClient``    — local ``POST {ollama_base_url}/api/chat`` (``stream: false``,
  native ``tools``). The base URL comes from env only (no user-supplied URLs, T7).
* ``AnthropicClient`` — Claude Messages API. **Refuses to run unless
  ``ORI_AI_ALLOW_PAID=true`` AND an API key is configured** (explicit cost
  authorization, T10). The key is only ever placed in the request header.
* ``FakeClient``      — scriptable client for tests (never selected by settings).

Neutral message format used by the orchestrator (converted per provider):

* ``{"role": "user", "content": str}``
* ``{"role": "assistant", "content": str, "tool_calls": [{"id","name","arguments"}], "raw": Any}``
  (``raw`` = provider-native assistant content, replayed unchanged inside a turn)
* ``{"role": "tool", "tool_call_id": str, "name": str, "content": str, "is_error": bool}``
"""

from __future__ import annotations

import copy
import json
import logging
import re
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

import httpx

from app.core.config import Settings, get_settings
from app.core.redaction import redact_text

log = logging.getLogger("ori.ai")

# ---- Anthropic Messages API (raw HTTP) ----
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2026-10-21"
ANTHROPIC_MAX_TOKENS = 8192
# Server-side refusal fallback (opt-in beta) for models that support it.
ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_FALLBACK_CAPABLE_MODELS = frozenset(
    {"claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}
)
# Older models that reject ``output_config.effort``.
_NO_EFFORT_PREFIXES = ("claude-3", "claude-haiku-4", "claude-sonnet-4-5", "claude-sonnet-4-0", "claude-opus-4-0",
                       "claude-opus-4-1", "claude-sonnet-4-2")

STATUS_CACHE_SECONDS = 60.0
OLLAMA_PROBE_TIMEOUT_SECONDS = 2.0

MSG_DISABLED = "לא הוגדר מודל AI. העוזר פועל במצב בסיסי: זיהוי בקשות לפי כללים, חיפוש בספקים וסיכום מנתוני השרת."
MSG_OLLAMA_DOWN = "Ollama אינו זמין בכתובת שהוגדרה. ודאו ש-Ollama פועל (ollama serve). בינתיים העוזר פועל במצב בסיסי."
MSG_OLLAMA_TIMEOUT = "Ollama לא הגיב בזמן. בינתיים העוזר פועל במצב בסיסי."
MSG_OLLAMA_ERROR = "Ollama החזיר שגיאה. בינתיים העוזר פועל במצב בסיסי."
MSG_OLLAMA_OK = "מודל מקומי פועל — ללא עלות וללא שליחת מידע לענן."
MSG_PAID_NOT_ALLOWED = (
    "ספק AI בענן (בתשלום) מוגדר, אך השימוש לא אושר: נדרשים ORI_AI_ALLOW_PAID=true ומפתח API. "
    "העוזר פועל במצב בסיסי ללא עלות."
)
MSG_PAID_OK = "שימוש במודל ענן בתשלום אושר במפורש (ORI_AI_ALLOW_PAID=true). כל שיחה כרוכה בעלות."
MSG_REMOTE_TIMEOUT = "מודל ה-AI לא הגיב בזמן. בינתיים העוזר פועל במצב בסיסי."
MSG_REMOTE_AUTH = "ספק ה-AI דחה את פרטי הגישה. בינתיים העוזר פועל במצב בסיסי."
MSG_REMOTE_RATE = "ספק ה-AI הגביל את קצב הבקשות. בינתיים העוזר פועל במצב בסיסי."
MSG_REMOTE_ERROR = "ספק ה-AI החזיר שגיאה. בינתיים העוזר פועל במצב בסיסי."
MSG_REMOTE_NETWORK = "לא ניתן להתחבר לספק ה-AI. בינתיים העוזר פועל במצב בסיסי."


# --------------------------------------------------------------- types ----


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON schema (object)


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: Any  # dict when the model produced a JSON object; anything else is rejected server-side

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "arguments": self.arguments}


@dataclass
class LLMResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    # end_turn | tool_use | max_tokens | refusal | stop_sequence | ...
    stop_reason: str = "end_turn"
    # Provider-native assistant content, replayed unchanged within the same turn.
    raw: Any = None


@dataclass(frozen=True)
class AIStatus:
    provider: str
    available: bool
    model: str | None
    paid: bool
    label: str  # Hebrew
    message: str  # Hebrew

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class LLMUnavailableError(Exception):
    """The model cannot be used right now. ``message`` is Hebrew and user-safe."""

    def __init__(self, message: str, code: str = "AI_UNAVAILABLE"):
        super().__init__(message)
        self.message = message
        self.code = code


class PaidAINotAuthorizedError(LLMUnavailableError):
    def __init__(self) -> None:
        super().__init__(MSG_PAID_NOT_ALLOWED, code="AI_PAID_NOT_AUTHORIZED")


class LLMClient(Protocol):
    provider: str
    model: str | None
    paid: bool

    def status(self) -> AIStatus: ...

    def complete(self, system: str, messages: list[dict[str, Any]], tools: list[ToolSpec], *,
                 tool_choice: str = "auto") -> LLMResult: ...


# --------------------------------------------------------- status cache ----

_status_lock = threading.Lock()
_status_cache: dict[tuple[str, ...], tuple[float, AIStatus]] = {}


def reset_status_cache() -> None:
    with _status_lock:
        _status_cache.clear()


def _cached_status(key: tuple[str, ...], compute: Callable[[], AIStatus]) -> AIStatus:
    now = time.monotonic()
    with _status_lock:
        hit = _status_cache.get(key)
        if hit and now - hit[0] < STATUS_CACHE_SECONDS:
            return hit[1]
    value = compute()
    with _status_lock:
        _status_cache[key] = (time.monotonic(), value)
    return value


def _store_status(key: tuple[str, ...], value: AIStatus) -> None:
    with _status_lock:
        _status_cache[key] = (time.monotonic(), value)


def _short_id() -> str:
    return f"call_{uuid.uuid4().hex[:16]}"


def _parse_arguments(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


# ------------------------------------------------------------- disabled ----


class DisabledClient:
    provider = "none"
    model: str | None = None
    paid = False

    def status(self) -> AIStatus:
        return AIStatus(provider="none", available=False, model=None, paid=False,
                        label="מצב בסיסי (ללא מודל AI)", message=MSG_DISABLED)

    def complete(self, system: str, messages: list[dict[str, Any]], tools: list[ToolSpec], *,
                 tool_choice: str = "auto") -> LLMResult:
        raise LLMUnavailableError(MSG_DISABLED, code="AI_DISABLED")


# --------------------------------------------------------------- ollama ----


class OllamaClient:
    provider = "ollama"
    paid = False

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model: str | None = settings.ollama_model
        self.timeout = float(settings.ai_timeout_seconds)
        self._transport = transport

    def _client(self, timeout: float) -> httpx.Client:
        return httpx.Client(timeout=timeout, transport=self._transport, follow_redirects=False)

    @property
    def _cache_key(self) -> tuple[str, ...]:
        return ("ollama", self.base_url, self.model or "")

    def _label(self) -> str:
        return f"מודל מקומי (Ollama · {self.model})"

    def _probe(self) -> AIStatus:
        try:
            with self._client(OLLAMA_PROBE_TIMEOUT_SECONDS) as client:
                res = client.get(f"{self.base_url}/api/tags")
        except httpx.HTTPError:
            return AIStatus("ollama", False, self.model, False, self._label(), MSG_OLLAMA_DOWN)
        if res.status_code != 200:
            return AIStatus("ollama", False, self.model, False, self._label(), MSG_OLLAMA_ERROR)
        try:
            models = res.json().get("models") or []
            names = {str(m.get("name") or m.get("model") or "") for m in models if isinstance(m, dict)}
        except (ValueError, AttributeError):
            names = set()
        wanted = self.model or ""
        if wanted not in names and f"{wanted}:latest" not in names and wanted.removesuffix(":latest") not in names:
            msg = f"המודל {wanted} אינו מותקן ב-Ollama. התקינו אותו עם: ollama pull {wanted}. בינתיים העוזר פועל במצב בסיסי."
            return AIStatus("ollama", False, self.model, False, self._label(), msg)
        return AIStatus("ollama", True, self.model, False, self._label(), MSG_OLLAMA_OK)

    def status(self) -> AIStatus:
        return _cached_status(self._cache_key, self._probe)

    def _mark_down(self, message: str) -> None:
        _store_status(self._cache_key, AIStatus("ollama", False, self.model, False, self._label(), message))

    @staticmethod
    def to_provider_messages(system: str, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for m in messages:
            role = m.get("role")
            if role == "user":
                out.append({"role": "user", "content": str(m.get("content") or "")})
            elif role == "assistant":
                item: dict[str, Any] = {"role": "assistant", "content": str(m.get("content") or "")}
                calls = m.get("tool_calls") or []
                if calls:
                    item["tool_calls"] = [
                        {"function": {"name": c["name"], "arguments": c["arguments"] if isinstance(c["arguments"], dict) else {}}}
                        for c in calls
                    ]
                out.append(item)
            elif role == "tool":
                out.append({"role": "tool", "content": str(m.get("content") or ""), "tool_name": m.get("name") or ""})
        return out

    def complete(self, system: str, messages: list[dict[str, Any]], tools: list[ToolSpec], *,
                 tool_choice: str = "auto") -> LLMResult:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": self.to_provider_messages(system, messages),
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if tools and tool_choice != "none":
            body["tools"] = [
                {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
                for t in tools
            ]
        try:
            with self._client(self.timeout) as client:
                res = client.post(f"{self.base_url}/api/chat", json=body)
        except httpx.TimeoutException:
            self._mark_down(MSG_OLLAMA_TIMEOUT)
            raise LLMUnavailableError(MSG_OLLAMA_TIMEOUT, code="AI_TIMEOUT") from None
        except httpx.HTTPError:
            self._mark_down(MSG_OLLAMA_DOWN)
            raise LLMUnavailableError(MSG_OLLAMA_DOWN) from None
        if res.status_code != 200:
            log.warning("ollama chat failed status=%s", res.status_code)
            raise LLMUnavailableError(MSG_OLLAMA_ERROR, code="AI_PROVIDER_ERROR")
        try:
            data = res.json()
        except ValueError:
            raise LLMUnavailableError(MSG_OLLAMA_ERROR, code="AI_PROVIDER_ERROR") from None
        msg = data.get("message") or {}
        text = _THINK_RE.sub("", str(msg.get("content") or "")).strip()
        calls: list[ToolCall] = []
        for tc in msg.get("tool_calls") or []:
            if not isinstance(tc, dict):
                continue
            fn = tc.get("function") or {}
            calls.append(ToolCall(id=str(tc.get("id") or _short_id())[:64], name=str(fn.get("name") or "")[:64],
                                  arguments=_parse_arguments(fn.get("arguments"))))
        if calls:
            stop = "tool_use"
        elif data.get("done_reason") == "length":
            stop = "max_tokens"
        else:
            stop = "end_turn"
        return LLMResult(text=text, tool_calls=calls, stop_reason=stop, raw=None)


# ------------------------------------------------------------ anthropic ----


def _supports_effort(model: str) -> bool:
    return not model.startswith(_NO_EFFORT_PREFIXES)


def _replayable_content(content: list[Any]) -> list[Any]:
    """Assistant content to echo back inside the same turn.

    Thinking blocks are passed back unchanged. After a server-side fallback, the
    model-internal blocks that precede the last ``fallback`` block are omitted
    (text and everything after the boundary echo normally).
    """
    blocks = [b for b in content if isinstance(b, dict)]
    last_fallback = max((i for i, b in enumerate(blocks) if b.get("type") == "fallback"), default=-1)
    if last_fallback < 0:
        return blocks
    keep_types = {"text", "fallback"}
    return [b for i, b in enumerate(blocks) if i >= last_fallback or b.get("type") in keep_types]


class AnthropicClient:
    provider = "anthropic"
    paid = True

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None):
        self.model: str | None = settings.anthropic_model
        self._api_key = settings.anthropic_api_key or None
        self._allow_paid = bool(settings.ai_allow_paid)
        self.timeout = float(settings.ai_timeout_seconds)
        self._transport = transport

    @property
    def authorized(self) -> bool:
        return self._allow_paid and bool(self._api_key)

    def status(self) -> AIStatus:
        if not self.authorized:
            return AIStatus("anthropic", False, self.model, True, "Claude בענן — לא מאושר", MSG_PAID_NOT_ALLOWED)
        return AIStatus("anthropic", True, self.model, True, f"Claude בענן ({self.model}) — בתשלום", MSG_PAID_OK)

    @staticmethod
    def to_provider_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        results: list[dict[str, Any]] = []

        def flush() -> None:
            if results:
                out.append({"role": "user", "content": list(results)})
                results.clear()

        for m in messages:
            role = m.get("role")
            if role == "tool":
                block: dict[str, Any] = {"type": "tool_result", "tool_use_id": m["tool_call_id"],
                                         "content": str(m.get("content") or "")}
                if m.get("is_error"):
                    block["is_error"] = True
                results.append(block)
                continue
            flush()
            if role == "user":
                text = str(m.get("content") or "").strip()
                if text:
                    out.append({"role": "user", "content": text})
            elif role == "assistant":
                if m.get("raw"):
                    out.append({"role": "assistant", "content": m["raw"]})
                    continue
                blocks: list[dict[str, Any]] = []
                text = str(m.get("content") or "").strip()
                if text:
                    blocks.append({"type": "text", "text": text})
                for c in m.get("tool_calls") or []:
                    blocks.append({"type": "tool_use", "id": c["id"], "name": c["name"],
                                   "input": c["arguments"] if isinstance(c["arguments"], dict) else {}})
                if blocks:
                    out.append({"role": "assistant", "content": blocks})
        flush()
        # The Messages API requires the conversation to start with a user turn.
        while out and out[0]["role"] != "user":
            out.pop(0)
        return out

    def build_request(self, system: str, messages: list[dict[str, Any]], tools: list[ToolSpec],
                      tool_choice: str = "auto") -> tuple[dict[str, str], dict[str, Any]]:
        model = self.model or ""
        body: dict[str, Any] = {
            "model": model,
            "max_tokens": ANTHROPIC_MAX_TOKENS,
            "system": system,
            "messages": self.to_provider_messages(messages),
        }
        if tools:
            body["tools"] = [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools]
            if tool_choice == "none":
                body["tool_choice"] = {"type": "none"}
        if _supports_effort(model):
            # Short conversational turns with simple tool use.
            body["output_config"] = {"effort": "low"}
        headers = {
            "x-api-key": self._api_key or "",
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        # The server-side fallback model is billed too, so it needs its own explicit opt-in.
        if model in _FALLBACK_CAPABLE_MODELS and get_settings().ai_anthropic_server_fallback:
            headers["anthropic-beta"] = ANTHROPIC_FALLBACK_BETA
            body["fallbacks"] = "default"
        return headers, body

    def complete(self, system: str, messages: list[dict[str, Any]], tools: list[ToolSpec], *,
                 tool_choice: str = "auto") -> LLMResult:
        # Explicit cost authorization: never send anything without it.
        if not self.authorized:
            raise PaidAINotAuthorizedError()
        headers, body = self.build_request(system, messages, tools, tool_choice)
        try:
            with httpx.Client(timeout=self.timeout, transport=self._transport, follow_redirects=False) as client:
                res = client.post(ANTHROPIC_API_URL, headers=headers, json=body)
        except httpx.TimeoutException:
            raise LLMUnavailableError(MSG_REMOTE_TIMEOUT, code="AI_TIMEOUT") from None
        except httpx.HTTPError:
            raise LLMUnavailableError(MSG_REMOTE_NETWORK) from None
        if res.status_code in (401, 403):
            raise LLMUnavailableError(MSG_REMOTE_AUTH, code="AI_AUTH_FAILED")
        if res.status_code == 429:
            raise LLMUnavailableError(MSG_REMOTE_RATE, code="AI_RATE_LIMITED")
        if res.status_code != 200:
            log.warning("anthropic messages failed status=%s request_id=%s", res.status_code,
                        redact_text(res.headers.get("request-id", "")))
            raise LLMUnavailableError(MSG_REMOTE_ERROR, code="AI_PROVIDER_ERROR")
        try:
            data = res.json()
        except ValueError:
            raise LLMUnavailableError(MSG_REMOTE_ERROR, code="AI_PROVIDER_ERROR") from None
        stop = str(data.get("stop_reason") or "end_turn")
        if stop == "refusal":
            return LLMResult(text="", tool_calls=[], stop_reason="refusal", raw=None)
        content = data.get("content") or []
        texts: list[str] = []
        calls: list[ToolCall] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                t = str(block.get("text") or "").strip()
                if t:
                    texts.append(t)
            elif block.get("type") == "tool_use":
                calls.append(ToolCall(id=str(block.get("id") or _short_id())[:64], name=str(block.get("name") or "")[:64],
                                      arguments=block.get("input")))
        if stop == "max_tokens":
            calls = []  # a truncated tool_use input is never executed
        return LLMResult(text="\n".join(texts), tool_calls=calls, stop_reason=stop, raw=_replayable_content(content))


# ----------------------------------------------------------------- fake ----

FakeStep = LLMResult | Callable[[str, list[dict[str, Any]], list[ToolSpec]], LLMResult]


class FakeClient:
    """Scriptable client for tests. Records every call (deep-copied)."""

    provider = "fake"
    paid = False

    def __init__(self, steps: list[FakeStep] | None = None, *, default: FakeStep | None = None,
                 available: bool = True, model: str = "fake-model", error: LLMUnavailableError | None = None):
        self.steps = list(steps or [])
        self.default = default
        self.available = available
        self.model: str | None = model
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def status(self) -> AIStatus:
        msg = "מודל בדיקה" if self.available else "מודל הבדיקה אינו זמין"
        return AIStatus("fake", self.available, self.model, False, "מודל בדיקה", msg)

    def complete(self, system: str, messages: list[dict[str, Any]], tools: list[ToolSpec], *,
                 tool_choice: str = "auto") -> LLMResult:
        self.calls.append({"system": system, "messages": copy.deepcopy(messages), "tools": [t.name for t in tools],
                           "tool_choice": tool_choice})
        if self.error is not None:
            raise self.error
        step: FakeStep | None = self.steps.pop(0) if self.steps else self.default
        if step is None:
            return LLMResult(text="", stop_reason="end_turn")
        if callable(step):
            return step(system, messages, tools)
        return copy.deepcopy(step)


# ------------------------------------------------------------- factory ----


def get_client(settings: Settings | None = None) -> LLMClient:
    s = settings or get_settings()
    if s.ai_provider == "ollama":
        return OllamaClient(s)
    if s.ai_provider == "anthropic":
        return AnthropicClient(s)
    return DisabledClient()


def get_llm_client() -> LLMClient:
    """FastAPI dependency (tests override it with a ``FakeClient``)."""
    return get_client()
