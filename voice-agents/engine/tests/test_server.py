import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.server import create_app
from app.telephony.signature import compute_signature
from tests.conftest import FakeTwilio

AUTH = {"Authorization": "Bearer test-key"}
ASSISTANT_VARS = {"on_behalf_of": "אורי", "task_topic": "קביעת תור", "task_goal": "תור ביום חמישי"}


@pytest.fixture
def client(settings):
    app = create_app(settings)
    app.state.engine.twilio = FakeTwilio()
    with TestClient(app) as c:
        yield c


def engine(client):
    return client.app.state.engine


def signed_post(client, path: str, form: dict, token="twilio-token"):
    sig = compute_signature(token, "https://engine.test" + path, form)
    return client.post(path, data=form, headers={"X-Twilio-Signature": sig})


def test_health(client):
    assert client.get("/health").json() == {"ok": True}


def test_api_requires_key(client):
    assert client.get("/agents").status_code == 401
    assert client.get("/agents", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/agents", headers=AUTH).status_code == 200


def test_api_closed_when_no_key_configured(settings):
    settings.engine_api_key = ""
    with TestClient(create_app(settings)) as c:
        assert c.get("/agents", headers={"Authorization": "Bearer "}).status_code == 401


def test_outbound_call(client):
    body = {
        "agent_id": "personal-assistant",
        "to": "053-2413215",
        "variables": ASSISTANT_VARS,
        "idempotency_key": "k1",
    }
    resp = client.post("/calls", json=body, headers=AUTH)
    assert resp.status_code == 200, resp.text
    call = resp.json()
    assert call["remote_number"] == "+972532413215" and call["direction"] == "outbound"
    placed = engine(client).twilio.calls
    assert len(placed) == 1 and placed[0]["from"] == "+97233000000" and placed[0]["time_limit_s"] == 330
    stream = ET.fromstring(placed[0]["twiml"]).find("Connect/Stream")
    assert stream.get("url") == "wss://engine.test/twilio/stream"
    assert stream.find("Parameter").get("value") == call["id"]

    again = client.post("/calls", json=body, headers=AUTH)
    assert again.json()["id"] == call["id"] and len(placed) == 1
    assert (
        client.get(f"/calls/{call['id']}", headers=AUTH).json()["twilio_call_sid"] == call["twilio_call_sid"]
    )


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"agent_id": "personal-assistant", "to": "+1 415 555 0100", "variables": ASSISTANT_VARS}, 422),
        ({"agent_id": "personal-assistant", "to": "052-1111111", "variables": ASSISTANT_VARS}, 403),
        ({"agent_id": "personal-assistant", "to": "053-2413215", "variables": {}}, 422),
        ({"agent_id": "kerem-toys-orders", "to": "053-2413215"}, 422),
        ({"agent_id": "missing", "to": "053-2413215"}, 404),
    ],
)
def test_outbound_call_rejections(client, body, status):
    assert client.post("/calls", json=body, headers=AUTH).status_code == status
    assert engine(client).twilio.calls == []


def test_inbound_requires_valid_signature(client):
    form = {"CallSid": "CA9", "From": "+972532413215", "To": "+97233000000"}
    resp = client.post(
        "/twilio/voice?agent=personal-assistant", data=form, headers={"X-Twilio-Signature": "bad"}
    )
    assert resp.status_code == 403


def test_inbound_call_returns_stream_twiml(client):
    form = {"CallSid": "CA9", "From": "+972532413215", "To": "+97233000000"}
    resp = signed_post(client, "/twilio/voice?agent=personal-assistant", form)
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/xml")
    call_id = ET.fromstring(resp.text).find("Connect/Stream/Parameter").get("value")
    record = engine(client).calls.get(call_id)
    assert record.direction == "inbound" and record.twilio_call_sid == "CA9"


def test_inbound_unfinished_agent_says_sorry(client):
    resp = signed_post(
        client, "/twilio/voice?agent=kerem-toys-orders", {"CallSid": "CA8", "From": "+972532413215"}
    )
    root = ET.fromstring(resp.text)
    assert root.find("Say") is not None and root.find("Connect") is None


def test_status_callback_marks_no_answer(client):
    body = {"agent_id": "personal-assistant", "to": "053-2413215", "variables": ASSISTANT_VARS}
    call = client.post("/calls", json=body, headers=AUTH).json()
    resp = signed_post(
        client, "/twilio/status", {"CallSid": call["twilio_call_sid"], "CallStatus": "no-answer"}
    )
    assert resp.status_code == 204
    saved = client.get(f"/calls/{call['id']}", headers=AUTH).json()
    assert saved["status"] == "no_answer" and saved["ended_at"]


def twilio_start(call_id: str, call_sid: str) -> list[dict]:
    return [
        {"event": "connected", "protocol": "Call", "version": "1.0.0"},
        {
            "event": "start",
            "start": {"streamSid": "MZ1", "callSid": call_sid, "customParameters": {"call_id": call_id}},
            "streamSid": "MZ1",
        },
    ]


@pytest.mark.parametrize("case", ["unknown_call", "wrong_call_sid"])
def test_media_stream_rejects_foreign_streams(client, case):
    body = {"agent_id": "personal-assistant", "to": "053-2413215", "variables": ASSISTANT_VARS}
    call = client.post("/calls", json=body, headers=AUTH).json()
    call_id, sid = (
        ("call_deadbeefdeadbeef", call["twilio_call_sid"])
        if case == "unknown_call"
        else (call["id"], "CA_other")
    )
    with client.websocket_connect("/twilio/stream") as ws:
        for msg in twilio_start(call_id, sid):
            ws.send_json(msg)
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_text()
    assert e.value.code == 1008


def test_media_stream_runs_the_call(client, monkeypatch):
    body = {"agent_id": "personal-assistant", "to": "053-2413215", "variables": ASSISTANT_VARS}
    call = client.post("/calls", json=body, headers=AUTH).json()
    ran = SimpleNamespace(args=None)

    async def fake_run_call(websocket, agent, record, stream_sid, deps):
        ran.args = (agent.id, record.id, stream_sid)
        deps.calls.finish(record, reason="test")

    monkeypatch.setattr("app.server.run_call", fake_run_call)
    with client.websocket_connect("/twilio/stream") as ws:
        for msg in twilio_start(call["id"], call["twilio_call_sid"]):
            ws.send_json(msg)
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()
    assert ran.args == ("personal-assistant", call["id"], "MZ1")
    assert client.get(f"/calls/{call['id']}", headers=AUTH).json()["end_reason"] == "test"


def test_prompt_preview(client):
    resp = client.post("/agents/personal-assistant/prompt", json={"variables": ASSISTANT_VARS}, headers=AUTH)
    assert resp.status_code == 200 and "אורי" in resp.json()["system_prompt"]
    assert client.post("/agents/personal-assistant/prompt", json={}, headers=AUTH).status_code == 422
