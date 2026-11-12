"""LLM clients over mocked httpx transports (no network): cost authorization, request/response formats, status."""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import Settings, reset_settings_cache
from app.modules.ai import llm
from app.modules.ai.llm import (
    ANTHROPIC_VERSION,
    AnthropicClient,
    DisabledClient,
    LLMUnavailableError,
    OllamaClient,
    PaidAINotAuthorizedError,
    ToolSpec,
    get_client,
)

FAKE_KEY = "sk-ant-test-not-a-real-key-000"
TOOLS = [ToolSpec("search_flights", "Search flights", {"type": "object", "properties": {"origin": {"type": "string"}}})]


@pytest.fixture(autouse=True)
def _reset_status_cache():
    llm.reset_status_cache()
    yield
    llm.reset_status_cache()


def _settings(**kw) -> Settings:
    base = {"env": "test", "database_url": "sqlite://", "ai_provider": "none"}
    return Settings(**{**base, **kw})


class Recorder:
    def __init__(self, handler=None):
        self.requests: list[httpx.Request] = []
        self.handler = handler

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.handler is None:
            raise AssertionError("no network call expected")
        return self.handler(request)


# ---------------------------------------------------------------- factory ----


def test_get_client_selects_by_settings():
    assert isinstance(get_client(_settings()), DisabledClient)
    assert isinstance(get_client(_settings(ai_provider="ollama")), OllamaClient)
    assert isinstance(get_client(_settings(ai_provider="anthropic")), AnthropicClient)


def test_disabled_client_is_unavailable_and_never_completes():
    c = DisabledClient()
    st = c.status()
    assert st.provider == "none" and st.available is False and st.paid is False and st.model is None
    with pytest.raises(LLMUnavailableError):
        c.complete("s", [{"role": "user", "content": "x"}], [])


# -------------------------------------------------------------- anthropic ----


@pytest.mark.parametrize(("allow_paid", "key"), [(False, FAKE_KEY), (True, None), (False, None)])
def test_anthropic_refuses_without_explicit_paid_authorization_and_key(allow_paid, key):
    rec = Recorder()
    c = AnthropicClient(_settings(ai_provider="anthropic", ai_allow_paid=allow_paid, anthropic_api_key=key),
                        transport=httpx.MockTransport(rec))
    st = c.status()
    assert st.available is False and st.paid is True
    assert FAKE_KEY not in json.dumps(st.as_dict())
    with pytest.raises(PaidAINotAuthorizedError):
        c.complete("system", [{"role": "user", "content": "שלום"}], TOOLS)
    assert rec.requests == []  # nothing was sent


def test_anthropic_request_format_and_tool_use_parsing():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "stop_reason": "tool_use",
            "content": [
                {"type": "thinking", "thinking": "", "signature": "sig"},
                {"type": "text", "text": "בודק טיסות"},
                {"type": "tool_use", "id": "toolu_1", "name": "search_flights", "input": {"origin": "TLV"}},
            ],
        })

    rec = Recorder(handler)
    c = AnthropicClient(_settings(ai_provider="anthropic", ai_allow_paid=True, anthropic_api_key=FAKE_KEY),
                        transport=httpx.MockTransport(rec))
    assert c.status().available is True
    messages = [
        {"role": "assistant", "content": "leading assistant turns are dropped"},
        {"role": "user", "content": "טיסה לרומא"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "toolu_0", "name": "list_trips", "arguments": {}}]},
        {"role": "tool", "tool_call_id": "toolu_0", "name": "list_trips", "content": "[]", "is_error": False},
        {"role": "user", "content": "המשך"},
    ]
    result = c.complete("מערכת", messages, TOOLS)
    assert len(rec.requests) == 1
    req = rec.requests[0]
    assert str(req.url) == "https://api.anthropic.com/v1/messages"
    assert req.headers["x-api-key"] == FAKE_KEY
    assert req.headers["anthropic-version"] == ANTHROPIC_VERSION
    body = json.loads(req.content)
    assert body["model"] == "claude-sonnet-5-5" and body["system"] == "מערכת"
    assert "temperature" not in body
    assert body["tools"][0] == {"name": "search_flights", "description": "Search flights", "input_schema": TOOLS[0].parameters}
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant", "user", "user"]
    assert body["messages"][1]["content"][0] == {"type": "tool_use", "id": "toolu_0", "name": "list_trips", "input": {}}
    assert body["messages"][2]["content"][0]["type"] == "tool_result"
    assert result.stop_reason == "tool_use" and result.text == "בודק טיסות"
    assert result.tool_calls[0].name == "search_flights" and result.tool_calls[0].arguments == {"origin": "TLV"}
    # thinking blocks are replayed unchanged within the turn
    assert result.raw[0]["type"] == "thinking"


def test_anthropic_tool_choice_none_and_refusal_and_errors():
    responses = iter([
        httpx.Response(200, json={"stop_reason": "refusal", "content": []}),
        httpx.Response(401, json={"error": {"message": "bad key"}}),
        httpx.Response(429, json={}),
        httpx.Response(500, text="boom"),
    ])
    rec = Recorder(lambda r: next(responses))
    c = AnthropicClient(_settings(ai_provider="anthropic", ai_allow_paid=True, anthropic_api_key=FAKE_KEY),
                        transport=httpx.MockTransport(rec))
    res = c.complete("s", [{"role": "user", "content": "x"}], TOOLS, tool_choice="none")
    assert res.stop_reason == "refusal" and res.tool_calls == []
    assert json.loads(rec.requests[0].content)["tool_choice"] == {"type": "none"}
    for code in ("AI_AUTH_FAILED", "AI_RATE_LIMITED", "AI_PROVIDER_ERROR"):
        with pytest.raises(LLMUnavailableError) as exc:
            c.complete("s", [{"role": "user", "content": "x"}], TOOLS)
        assert exc.value.code == code and FAKE_KEY not in exc.value.message


# ----------------------------------------------------------------- ollama ----


def _refused(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


def test_ollama_unavailable_when_connection_refused():
    c = OllamaClient(_settings(ai_provider="ollama"), transport=httpx.MockTransport(_refused))
    st = c.status()
    assert st.provider == "ollama" and st.available is False and st.paid is False
    assert "Ollama" in st.message
    with pytest.raises(LLMUnavailableError) as exc:
        c.complete("s", [{"role": "user", "content": "x"}], TOOLS)
    assert "Ollama" in exc.value.message


def test_ollama_status_requires_model_and_is_cached():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": "llama3.1:latest"}]})

    c = OllamaClient(_settings(ai_provider="ollama", ollama_model="qwen2.5:7b-instruct"), transport=httpx.MockTransport(handler))
    st = c.status()
    assert st.available is False and "ollama pull qwen2.5:7b-instruct" in st.message
    c.status()
    assert calls["n"] == 1  # cached

    llm.reset_status_cache()
    ok = OllamaClient(_settings(ai_provider="ollama", ollama_model="llama3.1"), transport=httpx.MockTransport(handler))
    assert ok.status().available is True


def test_ollama_chat_request_and_tool_call_parsing():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert request.url.path == "/api/chat" and body["stream"] is False
        assert body["messages"][0] == {"role": "system", "content": "מערכת"}
        assert body["tools"][0]["function"]["name"] == "search_flights"
        assert body["messages"][-1] == {"role": "tool", "content": "{}", "tool_name": "list_trips"}
        return httpx.Response(200, json={"message": {
            "role": "assistant", "content": "<think>hidden</think>",
            "tool_calls": [{"function": {"name": "search_flights", "arguments": {"origin": "TLV"}}}]}, "done": True})

    c = OllamaClient(_settings(ai_provider="ollama"), transport=httpx.MockTransport(handler))
    res = c.complete("מערכת", [
        {"role": "user", "content": "x"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c0", "name": "list_trips", "arguments": {}}]},
        {"role": "tool", "tool_call_id": "c0", "name": "list_trips", "content": "{}"},
    ], TOOLS)
    assert res.stop_reason == "tool_use" and res.text == ""
    assert res.tool_calls[0].name == "search_flights" and res.tool_calls[0].arguments == {"origin": "TLV"}
    assert res.tool_calls[0].id.startswith("call_")


def test_ollama_tool_choice_none_omits_tools():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "תשובה"}, "done_reason": "stop"})

    c = OllamaClient(_settings(ai_provider="ollama"), transport=httpx.MockTransport(handler))
    assert c.complete("s", [{"role": "user", "content": "x"}], TOOLS, tool_choice="none").text == "תשובה"
    assert "tools" not in seen


def test_status_endpoint_reports_provider_without_secrets(auth_client, monkeypatch):
    monkeypatch.setenv("ORI_AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ORI_ANTHROPIC_API_KEY", FAKE_KEY)
    monkeypatch.setenv("ORI_AI_ALLOW_PAID", "false")
    reset_settings_cache()
    c = auth_client("viewer")
    res = c.get("/api/ai/status")
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"provider", "available", "model", "paid", "label", "message"}
    assert body["provider"] == "anthropic" and body["available"] is False and body["paid"] is True
    assert FAKE_KEY not in res.text and "sk-ant" not in res.text
    reset_settings_cache()
