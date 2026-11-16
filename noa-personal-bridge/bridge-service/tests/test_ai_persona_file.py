"""Security review H-1: persona FILE mode (no NOA request, no NOA key) + `admin export-persona`."""

from __future__ import annotations

import asyncio
import json
import os
import stat
from types import SimpleNamespace

import httpx
import pytest
import respx

from bridge_service import admin
from bridge_service.ai.anthropic_engine import AnthropicEngine
from bridge_service.ai.base import DraftInput, InboundMessage
from bridge_service.ai.factory import create_engine
from bridge_service.ai.noa_persona_engine import (
    MAX_PERSONA_FILE_BYTES,
    ForbiddenNoaEndpoint,
    NoaPersonaEngine,
)
from bridge_service.config import Settings

API = "https://api.anthropic.com/v1/messages"
NOA = "https://noa.example"
PROMPT_URL = f"{NOA}/agents/noa/prompt"
NOA_KEY = "noa-test-key-not-real"
PERSONA = "את נועה, נציגה חמה ומקצועית של המשרד. מדברת בגובה העיניים."
PERSONA_B = "את נועה בגרסה חדשה: קצרה, עניינית ומחייכת."


def data(*texts: str) -> DraftInput:
    return DraftInput(
        request_id="r",
        conversation_ref="c" * 64,
        sender_display_name="דני",
        messages=tuple(InboundMessage(text=t, sent_at=1_700_000_000_000 + i) for i, t in enumerate(texts)),
    )


def ok_message(t: str = "היי! אחזור אליך 😊") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-haiku-5-5",
            "content": [{"type": "text", "text": t}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
    )


def file_engine(path, url: str | None = NOA, key: str | None = NOA_KEY, agent: str | None = "noa"):
    return NoaPersonaEngine(
        url, key, agent, AnthropicEngine("test-key-not-real", max_retries=0), persona_file=str(path)
    )


def system_of(route: respx.Route) -> str:
    return json.loads(route.calls.last.request.content)["system"]


def mock_all(router: respx.MockRouter):
    """NOA routes (must never be hit in file mode) + the model API."""
    noa_prompt = router.post(PROMPT_URL).mock(return_value=httpx.Response(200, json={"system_prompt": "FETCHED"}))
    noa_any = router.route(host="noa.example").mock(return_value=httpx.Response(500))
    llm = router.post(API).mock(return_value=ok_message())
    return noa_prompt, noa_any, llm


def assert_only_model_calls(router: respx.MockRouter) -> None:
    assert router.calls, "the model should have been called"
    for call in router.calls:
        assert call.request.url.host == "api.anthropic.com", call.request.url


# ------------------------------------------------------------------------------ file mode


@pytest.mark.asyncio
async def test_file_mode_makes_zero_noa_requests_even_with_url_and_key(tmp_path):
    path = tmp_path / "persona.txt"
    path.write_text(PERSONA, encoding="utf-8")
    with respx.mock(assert_all_called=False) as router:
        noa_prompt, noa_any, llm = mock_all(router)
        e = file_engine(path)
        assert e.file_mode
        out1 = await e.draft(data("היי"))
        out2 = await e.draft(data("מה נשמע?"))
        await e.aclose()
        assert noa_prompt.call_count == 0 and noa_any.call_count == 0
        assert llm.call_count == 2
        assert_only_model_calls(router)
        assert out1.engine == out2.engine == "noa_persona"
        system = system_of(llm)
        assert "<noa_persona>" in system and PERSONA in system and "FETCHED" not in system


@pytest.mark.asyncio
async def test_file_mode_never_holds_the_key_or_a_client(tmp_path):
    path = tmp_path / "persona.txt"
    path.write_text(PERSONA, encoding="utf-8")
    e = file_engine(path)
    assert e._key == "" and e._expected_url is None
    with pytest.raises(ForbiddenNoaEndpoint):
        e._client()
    assert e._http is None
    await e.aclose()


@pytest.mark.asyncio
async def test_file_mode_works_without_noa_key_or_url(tmp_path):
    path = tmp_path / "persona.txt"
    path.write_text(PERSONA, encoding="utf-8")
    with respx.mock(assert_all_called=False) as router:
        _, _, llm = mock_all(router)
        e = file_engine(path, url=None, key=None, agent=None)
        out = await e.draft(data("היי"))
        await e.aclose()
        assert out.engine == "noa_persona"
        assert PERSONA in system_of(llm)
        assert_only_model_calls(router)


@pytest.mark.asyncio
async def test_file_mode_reloads_when_mtime_changes(tmp_path):
    path = tmp_path / "persona.txt"
    path.write_text(PERSONA, encoding="utf-8")
    with respx.mock(assert_all_called=False) as router:
        _, _, llm = mock_all(router)
        e = file_engine(path)
        await e.draft(data("היי"))
        assert PERSONA in system_of(llm)
        await e.draft(data("היי"))  # unchanged file → same persona
        assert PERSONA in system_of(llm)

        path.write_text(PERSONA_B, encoding="utf-8")
        st = os.stat(path)
        os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
        await e.draft(data("היי"))
        system = system_of(llm)
        assert PERSONA_B in system and PERSONA not in system
        await e.aclose()
        assert_only_model_calls(router)


def test_file_mode_does_not_reread_an_unchanged_file(tmp_path, monkeypatch):
    from bridge_service.ai import noa_persona_engine as mod

    path = tmp_path / "persona.txt"
    path.write_text(PERSONA, encoding="utf-8")
    pf = mod.PersonaFile(path)
    reads = []
    real_read = pf._read
    monkeypatch.setattr(pf, "_read", lambda size: reads.append(size) or real_read(size))
    assert pf.get() == PERSONA and pf.get() == PERSONA and pf.get() == PERSONA
    assert len(reads) == 1


@pytest.mark.asyncio
async def test_file_mode_size_cap(tmp_path):
    path = tmp_path / "persona.txt"
    path.write_bytes(b"a" * (MAX_PERSONA_FILE_BYTES + 1))
    with respx.mock(assert_all_called=False) as router:
        _, _, llm = mock_all(router)
        e = file_engine(path)
        out = await e.draft(data("היי"))
        assert out.engine == "noa_persona:fallback"
        assert "<noa_persona>" not in system_of(llm)

        path.write_bytes(("נועה " * 4000).encode("utf-8")[:MAX_PERSONA_FILE_BYTES - 1] + b".")  # under cap
        os.utime(path, ns=(0, os.stat(path).st_mtime_ns + 1_000_000_000))
        out = await e.draft(data("היי"))
        assert out.engine == "noa_persona"
        await e.aclose()
        assert_only_model_calls(router)


@pytest.mark.asyncio
async def test_file_mode_strips_placeholder_lines(tmp_path):
    path = tmp_path / "persona.txt"
    path.write_text(
        "את נועה.\n[למלא: שם העסק]\nשעות פעילות: [למלא שעות]\nמדברת חם וקצר.\n", encoding="utf-8"
    )
    with respx.mock(assert_all_called=False) as router:
        _, _, llm = mock_all(router)
        e = file_engine(path)
        await e.draft(data("היי"))
        await e.aclose()
        system = system_of(llm)
        assert "את נועה.\nמדברת חם וקצר." in system
        assert "[למלא" not in system and "שעות פעילות" not in system


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [None, b"\xff\xfe\x00bad utf8 \xc3", b"[\xd7\x9c\xd7\x9e\xd7\x9c\xd7\x90 x]\n  \n"])
async def test_file_mode_missing_bad_or_empty_file_falls_back_without_network(tmp_path, content):
    path = tmp_path / "persona.txt"
    if content is not None:
        path.write_bytes(content)
    with respx.mock(assert_all_called=False) as router:
        noa_prompt, noa_any, llm = mock_all(router)
        e = file_engine(path)
        out = await e.draft(data("היי"))
        await e.aclose()
        assert out.engine == "noa_persona:fallback"
        assert noa_prompt.call_count == 0 and noa_any.call_count == 0
        assert "<noa_persona>" not in system_of(llm)


@pytest.mark.asyncio
async def test_factory_and_settings_select_file_mode(tmp_path, monkeypatch):
    path = tmp_path / "persona.txt"
    path.write_text(PERSONA, encoding="utf-8")
    monkeypatch.setenv("BRIDGE_PERSONA_FILE", str(path))
    s = Settings(engine="noa_persona", anthropic_api_key="test-not-a-real-key", db_path=str(tmp_path / "x.db"))
    assert s.persona_file == str(path)
    e = create_engine(s)
    assert isinstance(e, NoaPersonaEngine) and e.file_mode
    await e.aclose()

    e = create_engine(SimpleNamespace(engine="noa_persona", anthropic_api_key="k", noa_engine_url=NOA,
                                      noa_engine_api_key="noa-key", noa_agent_id="noa"))
    assert not e.file_mode  # live-fetch mode remains available
    await e.aclose()


# ------------------------------------------------------------------------------ export-persona


def export_settings(tmp_path, **kw) -> Settings:
    base = dict(db_path=str(tmp_path / "b.db"), noa_engine_url=NOA, noa_engine_api_key=NOA_KEY, noa_agent_id="noa")
    base.update(kw)
    return Settings(**base)


def test_export_persona_fetches_once_and_writes_private_file(tmp_path, capsys):
    out = tmp_path / "conf" / "persona.txt"
    raw = "את נועה.\n[למלא: מחירון]\n" + PERSONA
    with respx.mock(assert_all_called=False) as router:
        prompt = router.post(PROMPT_URL).mock(return_value=httpx.Response(200, json={"system_prompt": raw}))
        other = router.route().mock(return_value=httpx.Response(500))
        rc = admin.main(["export-persona", "--out", str(out)], settings=export_settings(tmp_path))
        assert rc == 0
        assert prompt.call_count == 1 and other.call_count == 0
        req = prompt.calls.last.request
        assert req.method == "POST" and req.headers["authorization"] == f"Bearer {NOA_KEY}"
        assert json.loads(req.content) == {"variables": {}, "direction": "inbound"}
    text = out.read_text(encoding="utf-8")
    assert text.strip() == "את נועה.\n" + PERSONA
    assert stat.S_IMODE(os.stat(out).st_mode) == 0o600
    printed = capsys.readouterr()
    assert PERSONA not in printed.out + printed.err  # never print content
    assert NOA_KEY not in printed.out + printed.err
    assert "BRIDGE_PERSONA_FILE" in printed.err


def test_exported_file_then_drafts_without_any_noa_request(tmp_path):
    out = tmp_path / "persona.txt"
    with respx.mock(assert_all_called=False) as router:
        router.post(PROMPT_URL).mock(return_value=httpx.Response(200, json={"system_prompt": PERSONA}))
        assert admin.main(["export-persona", "--out", str(out)], settings=export_settings(tmp_path)) == 0

    async def run():
        e = create_engine(SimpleNamespace(engine="noa_persona", anthropic_api_key="k", persona_file=str(out)))
        try:
            return await e.draft(data("היי"))
        finally:
            await e.aclose()

    with respx.mock(assert_all_called=False) as router:
        noa_prompt, noa_any, llm = mock_all(router)
        result = asyncio.run(run())
        assert result.engine == "noa_persona"
        assert noa_prompt.call_count == 0 and noa_any.call_count == 0
        assert PERSONA in system_of(llm)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(307, headers={"location": f"{NOA}/agents/noa/chat"}),
        httpx.Response(401, json={"detail": "bad key"}),
        httpx.Response(200, json={"nothing": "here"}),
        httpx.Response(200, text="not json"),
    ],
)
def test_export_persona_failure_writes_nothing_and_never_follows_redirects(tmp_path, response, capsys):
    out = tmp_path / "persona.txt"
    with respx.mock(assert_all_called=False) as router:
        prompt = router.post(PROMPT_URL).mock(return_value=response)
        chat = router.route(path__regex=r".*/chat.*").mock(return_value=httpx.Response(200))
        assert admin.main(["export-persona", "--out", str(out)], settings=export_settings(tmp_path)) == 1
        assert prompt.call_count == 1 and chat.call_count == 0
    assert not out.exists()
    assert "error" in capsys.readouterr().err


@pytest.mark.parametrize(
    "overrides",
    [
        {"noa_engine_api_key": None},
        {"noa_engine_url": None},
        {"noa_agent_id": None},
        {"noa_engine_url": "http://noa.example"},  # plain http only for localhost
        {"noa_agent_id": "../calls"},
    ],
)
def test_export_persona_rejects_bad_config_without_network(tmp_path, overrides):
    out = tmp_path / "persona.txt"
    with respx.mock(assert_all_called=False) as router:
        any_route = router.route().mock(return_value=httpx.Response(200, json={"system_prompt": "x"}))
        rc = admin.main(["export-persona", "--out", str(out)], settings=export_settings(tmp_path, **overrides))
        assert rc == 2 and any_route.call_count == 0
    assert not out.exists()
