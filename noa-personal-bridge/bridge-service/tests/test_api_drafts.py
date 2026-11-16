import asyncio
import time
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from bridge_service.main import create_app


def post_draft(client, device, payload, **header_kw):
    return client.post("/v1/drafts", json=payload, headers=device.headers(**header_kw))


# --- happy path ------------------------------------------------------------------------------


def test_draft_happy_path_exact_shape(client, device, engine, body):
    payload = body()
    resp = post_draft(client, device, payload)
    assert resp.status_code == 200
    assert resp.json() == {
        "request_id": payload["request_id"],
        "draft_text": "נשמע מעולה, נתראה ב־20:00",
        "safety": {"injection_suspected": False, "sensitive_request": False, "notes": []},
        "engine": "fake",
    }
    assert resp.headers["cache-control"] == "no-store"
    assert len(engine.calls) == 1
    call = engine.calls[0]
    assert call.conversation_ref == "a" * 64
    assert call.sender_display_name == "דנה"
    assert call.messages[0].text == "היי, מתי נפגשים?"
    assert call.messages[0].sent_at == 1763236800000
    assert call.locale == "he"


def test_draft_notes_are_returned_as_list(client, device, engine, body):
    engine.notes = ("ההודעה מבקשת קוד אימות — לא לשלוח",)
    resp = post_draft(client, device, body())
    assert resp.json()["safety"]["notes"] == ["ההודעה מבקשת קוד אימות — לא לשלוח"]


def test_draft_request_id_echoed_verbatim(client, device, body):
    rid = str(uuid.uuid4()).upper()
    resp = post_draft(client, device, body(request_id=rid))
    assert resp.status_code == 200
    assert resp.json()["request_id"] == rid


# --- auth -------------------------------------------------------------------------------------


def test_missing_token_401(client, body):
    resp = client.post(
        "/v1/drafts",
        json=body(),
        headers={"X-Bridge-Timestamp": str(int(time.time() * 1000)), "X-Bridge-Nonce": str(uuid.uuid4())},
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "unauthorized"


@pytest.mark.parametrize("auth", ["Bearer nope", "Basic abc", "Bearer ", "Bearer " + "x" * 300, "garbage"])
def test_invalid_token_401(client, device, body, auth):
    headers = device.headers()
    headers["Authorization"] = auth
    resp = client.post("/v1/drafts", json=body(), headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"] == "unauthorized"


def test_revoked_token_401(client, device, settings, body, engine):
    from bridge_service.storage.db import Database

    Database(settings.db_path).revoke_device(device.device_id)
    resp = post_draft(client, device, body())
    assert resp.status_code == 401
    assert engine.calls == []


def test_revoke_endpoint_then_401(client, device, body):
    resp = client.post("/v1/devices/revoke", headers=device.headers())
    assert resp.status_code == 204
    assert resp.content == b""
    assert post_draft(client, device, body()).status_code == 401
    assert client.post("/v1/devices/revoke", headers=device.headers()).status_code == 401


def test_revoke_requires_auth(client):
    assert client.post("/v1/devices/revoke").status_code == 401


def test_revoke_works_while_disabled(settings_factory, engine, pair, body):
    settings = settings_factory()
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
    disabled = settings.model_copy(update={"enabled": False})
    with TestClient(create_app(disabled, engine=engine)) as c:
        assert post_draft(c, dev, body()).status_code == 503
        assert c.post("/v1/devices/revoke", headers=dev.headers()).status_code == 204


def test_revoke_drops_cached_drafts(client, device, settings, pair, body, engine):
    payload = body()
    assert post_draft(client, device, payload).status_code == 200
    client.post("/v1/devices/revoke", headers=device.headers())
    assert client.app.state.bridge.idempotency.get((device.device_id, payload["request_id"])) is None


# --- replay -----------------------------------------------------------------------------------


def test_reused_nonce_409(client, device, body, engine):
    nonce = str(uuid.uuid4())
    assert post_draft(client, device, body(), nonce=nonce).status_code == 200
    resp = post_draft(client, device, body(), nonce=nonce)
    assert resp.status_code == 409
    assert resp.json()["error"] == "replay"
    assert len(engine.calls) == 1


def test_nonce_is_scoped_per_device(client, settings, pair, body):
    a, b = pair(client, settings), pair(client, settings)
    nonce = str(uuid.uuid4())
    assert post_draft(client, a, body(), nonce=nonce).status_code == 200
    assert post_draft(client, b, body(), nonce=nonce).status_code == 200


def test_old_timestamp_409(client, device, body, engine):
    old = int(time.time() * 1000) - 301_000
    resp = post_draft(client, device, body(), timestamp_ms=old)
    assert resp.status_code == 409
    assert resp.json()["error"] == "replay"
    assert engine.calls == []


def test_future_timestamp_409(client, device, body):
    future = int(time.time() * 1000) + 301_000
    assert post_draft(client, device, body(), timestamp_ms=future).status_code == 409


def test_timestamp_within_window_ok(client, device, body):
    near = int(time.time() * 1000) - 240_000
    assert post_draft(client, device, body(), timestamp_ms=near).status_code == 200


@pytest.mark.parametrize(
    "drop,value",
    [("X-Bridge-Nonce", None), ("X-Bridge-Timestamp", None), ("X-Bridge-Nonce", "not-a-uuid"), ("X-Bridge-Timestamp", "soon")],
)
def test_missing_or_malformed_replay_headers_409(client, device, body, drop, value):
    headers = device.headers()
    if value is None:
        headers.pop(drop)
    else:
        headers[drop] = value
    resp = client.post("/v1/drafts", json=body(), headers=headers)
    assert resp.status_code == 409


def test_bad_token_checked_before_replay(client, body):
    """An unauthenticated caller must not be able to burn a device's nonces."""
    resp = client.post(
        "/v1/drafts", json=body(), headers={"Authorization": "Bearer x", "X-Bridge-Nonce": "zz"}
    )
    assert resp.status_code == 401


# --- idempotency ------------------------------------------------------------------------------


def test_idempotent_same_request_id(client, device, body, engine):
    payload = body()
    first = post_draft(client, device, payload)
    engine.draft_text = "something else"
    second = post_draft(client, device, payload)  # new nonce, same request_id
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(engine.calls) == 1


def test_idempotency_is_per_device(client, settings, pair, body, engine):
    a, b = pair(client, settings), pair(client, settings)
    payload = body()
    post_draft(client, a, payload)
    post_draft(client, b, payload)
    assert len(engine.calls) == 2


def test_idempotency_expires(settings_factory, fake_engine_cls, pair, body):
    engine = fake_engine_cls()
    settings = settings_factory(idempotency_ttl_seconds=1)
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
        payload = body()
        post_draft(c, dev, payload)
        time.sleep(1.1)
        post_draft(c, dev, payload)
    assert len(engine.calls) == 2


def test_failed_engine_call_is_not_cached(client, device, body, engine, engine_error_cls):
    payload = body()
    engine.error = engine_error_cls("boom")
    assert post_draft(client, device, payload).status_code == 502
    engine.error = None
    assert post_draft(client, device, payload).status_code == 200
    assert len(engine.calls) == 2


async def test_concurrent_duplicates_call_engine_once(settings, fake_engine_cls, body):
    engine = fake_engine_cls(delay=0.2)
    app = create_app(settings, engine=engine)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        from bridge_service.security.pairing import generate_pairing_code, hash_pairing_code

        code = generate_pairing_code()
        app.state.bridge.db.add_pairing_code(hash_pairing_code(code, app.state.bridge.pairing_pepper), 600)
        paired = (await ac.post("/v1/pair", json={"pairing_code": code})).json()
        token = paired["device_token"]
        payload = body()

        def headers():
            return {
                "Authorization": f"Bearer {token}",
                "X-Bridge-Timestamp": str(int(time.time() * 1000)),
                "X-Bridge-Nonce": str(uuid.uuid4()),
            }

        responses = await asyncio.gather(
            *(ac.post("/v1/drafts", json=payload, headers=headers()) for _ in range(5))
        )
    assert [r.status_code for r in responses] == [200] * 5
    assert len({r.text for r in responses}) == 1
    assert len(engine.calls) == 1
    assert len(app.state.bridge.idempotency_locks) == 0


# --- limits -----------------------------------------------------------------------------------


def test_body_over_64kb_413(client, device, engine):
    big = b'{"x":"' + b"a" * (64 * 1024) + b'"}'
    headers = device.headers() | {"Content-Type": "application/json"}
    resp = client.post("/v1/drafts", content=big, headers=headers)
    assert resp.status_code == 413
    assert resp.json()["error"] == "too_large"
    assert engine.calls == []


def test_body_over_limit_without_content_length_413(client, device):
    def chunks():
        for _ in range(70):
            yield b"a" * 1024

    resp = client.post("/v1/drafts", content=chunks(), headers=device.headers())
    assert resp.status_code == 413


@pytest.mark.parametrize(
    "overrides",
    [
        {"messages": [{"text": "x", "sent_at": 1}] * 21},
        {"messages": [{"text": "x" * 2001, "sent_at": 1}]},
        {"messages": [{"text": "x" * 2000, "sent_at": 1}] * 5},  # 10000 > 8000 total
        {"sender_display_name": "x" * 81},
    ],
    ids=["21-messages", "text-2001", "total-10000", "sender-81"],
)
def test_size_limits_413(client, device, body, engine, overrides):
    resp = post_draft(client, device, body(**overrides))
    assert resp.status_code == 413
    assert resp.json()["error"] == "too_large"
    assert engine.calls == []


def test_exact_limits_accepted(client, device, body):
    msgs = [{"text": "x" * 2000, "sent_at": 1}] * 4  # 8000 total, each 2000
    assert post_draft(client, device, body(messages=msgs, sender_display_name="x" * 80)).status_code == 200
    assert post_draft(client, device, body(messages=[{"text": "x", "sent_at": 1}] * 20)).status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {"conversation_ref": "A" * 64},
        {"conversation_ref": "a" * 63},
        {"conversation_ref": "+972501234567"},
        {"request_id": "not-a-uuid"},
        {"request_id": "3b241101-e2bb-1255-8caf-4136c566a962"},  # v1, not v4
        {"messages": []},
        {"messages": [{"text": "", "sent_at": 1}]},
        {"messages": [{"text": "hi", "sent_at": "yesterday"}]},
        {"messages": [{"text": 5, "sent_at": 1}]},
        {"messages": "hi"},
        {"locale": "<script>"},
    ],
)
def test_schema_errors_422(client, device, body, engine, overrides):
    resp = post_draft(client, device, body(**overrides))
    assert resp.status_code == 422
    assert resp.json()["error"] == "invalid_request"
    assert set(resp.json()) == {"error", "message"}
    assert engine.calls == []


def test_422_does_not_echo_input(client, device, body, marker):
    payload = body(
        conversation_ref=marker,
        sender_display_name=marker,
        messages=[{"text": marker, "sent_at": marker}],
    )
    resp = post_draft(client, device, payload)
    assert resp.status_code == 422
    assert marker not in resp.text


def test_413_does_not_echo_input(client, device, body, marker):
    resp = post_draft(client, device, body(messages=[{"text": marker * 200, "sent_at": 1}]))
    assert resp.status_code == 413
    assert marker not in resp.text


def test_invalid_json_422(client, device):
    resp = client.post("/v1/drafts", content=b"{nope", headers=device.headers())
    assert resp.status_code == 422
    resp = client.post("/v1/drafts", content=b"[]", headers=device.headers())
    assert resp.status_code == 422


# --- rate limit -------------------------------------------------------------------------------


def test_rate_limit_per_minute_429(settings_factory, engine, pair, body):
    settings = settings_factory(rate_limit_per_minute=3)
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
        for _ in range(3):
            assert post_draft(c, dev, body()).status_code == 200
        resp = post_draft(c, dev, body())
    assert resp.status_code == 429
    assert resp.json()["error"] == "rate_limited"
    retry = int(resp.headers["retry-after"])
    assert 1 <= retry <= 60
    assert len(engine.calls) == 3


def test_rate_limit_per_day_429(settings_factory, engine, pair, body):
    settings = settings_factory(rate_limit_per_minute=10, rate_limit_per_day=2)
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
        post_draft(c, dev, body())
        post_draft(c, dev, body())
        resp = post_draft(c, dev, body())
    assert resp.status_code == 429
    assert int(resp.headers["retry-after"]) > 60


def test_cached_replays_do_not_consume_rate_limit(settings_factory, engine, pair, body):
    settings = settings_factory(rate_limit_per_minute=1)
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
        payload = body()
        for _ in range(3):
            assert post_draft(c, dev, payload).status_code == 200


def test_rate_limit_is_per_device(settings_factory, engine, pair, body):
    settings = settings_factory(rate_limit_per_minute=1)
    with TestClient(create_app(settings, engine=engine)) as c:
        a, b = pair(c, settings), pair(c, settings)
        assert post_draft(c, a, body()).status_code == 200
        assert post_draft(c, a, body()).status_code == 429
        assert post_draft(c, b, body()).status_code == 200


# --- engine failures --------------------------------------------------------------------------


def test_engine_timeout_502(settings_factory, fake_engine_cls, pair, body):
    engine = fake_engine_cls(delay=1.0)
    settings = settings_factory(engine_timeout_seconds=0.1)
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
        resp = post_draft(c, dev, body())
    assert resp.status_code == 502
    assert resp.json()["error"] == "engine_error"


def test_engine_error_502(client, device, body, engine, engine_error_cls):
    engine.error = engine_error_cls("upstream said no", retryable=True)
    resp = post_draft(client, device, body())
    assert resp.status_code == 502
    assert resp.json()["error"] == "engine_error"
    assert "upstream" not in resp.text


def test_engine_crash_502(client, device, body, engine):
    engine.error = RuntimeError("bug")
    assert post_draft(client, device, body()).status_code == 502


def test_engine_empty_draft_502(client, device, body, engine):
    engine.draft_text = "   "
    assert post_draft(client, device, body()).status_code == 502


# --- feature flag -----------------------------------------------------------------------------


def test_drafts_disabled_503(settings_factory, engine, body):
    with TestClient(create_app(settings_factory(enabled=False), engine=engine)) as c:
        resp = c.post("/v1/drafts", json=body())
    assert resp.status_code == 503
    assert resp.json() == {"error": "disabled", "message": resp.json()["message"]}
    assert engine.calls == []


def test_kill_switch_file_disables_drafts(settings_factory, engine, pair, body, tmp_path):
    kill = tmp_path / "KILL"
    settings = settings_factory(kill_switch_file=str(kill))
    with TestClient(create_app(settings, engine=engine)) as c:
        dev = pair(c, settings)
        assert post_draft(c, dev, body()).status_code == 200
        kill.write_text("")
        assert post_draft(c, dev, body()).status_code == 503
        kill.unlink()
        assert post_draft(c, dev, body()).status_code == 200
