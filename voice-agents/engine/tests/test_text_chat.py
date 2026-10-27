from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.server import create_app


def block(**kw):
    ns = SimpleNamespace(**kw)
    ns.model_dump = lambda: kw
    return ns


class FakeMessages:
    """Replays scripted Claude responses and records what was sent."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    async def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(content=self.responses.pop(0))


def test_chat_runs_tools_and_ends(settings):
    fake = FakeMessages(
        [
            [
                block(type="text", text="מעולה, סיכמנו. יום טוב!"),
                block(type="tool_use", id="tu_1", name="end_call", input={"reason": "done"}),
            ]
        ]
    )
    app = create_app(settings)
    app.state.engine.anthropic = SimpleNamespace(messages=fake)
    with TestClient(app) as client:
        resp = client.post(
            "/agents/personal-assistant/chat",
            json={
                "variables": {"on_behalf_of": "אורי", "task_topic": "תור", "task_goal": "תור ביום חמישי"},
                "messages": [{"role": "user", "content": "כן, קבענו לחמישי בארבע"}],
            },
            headers={"Authorization": "Bearer test-key"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["reply"] == "מעולה, סיכמנו. יום טוב!"
    assert data["ended"] is True and data["tools"][0]["name"] == "end_call"
    sent = fake.requests[0]
    assert "אורי" in sent["system"] and sent["model"] == settings.anthropic_model
    assert sent["messages"][1]["content"].startswith("שלום, מדברת העוזרת הדיגיטלית של אורי")
    assert {t["name"] for t in sent["tools"]} == {"end_call"}


def test_chat_feeds_tool_results_back(settings):
    fake = FakeMessages(
        [
            [block(type="tool_use", id="tu_1", name="nope", input={})],
            [block(type="text", text="לא הצלחתי, מישהו יחזור אליכם.")],
        ]
    )
    app = create_app(settings)
    app.state.engine.anthropic = SimpleNamespace(messages=fake)
    with TestClient(app) as client:
        resp = client.post(
            "/agents/personal-assistant/chat",
            json={
                "variables": {"on_behalf_of": "אורי", "task_topic": "תור", "task_goal": "תור"},
                "messages": [{"role": "user", "content": "הלו"}],
            },
            headers={"Authorization": "Bearer test-key"},
        )
    data = resp.json()
    assert data["reply"] == "לא הצלחתי, מישהו יחזור אליכם." and data["ended"] is False
    tool_result = fake.requests[1]["messages"][-1]["content"][0]
    assert tool_result["type"] == "tool_result" and tool_result["is_error"] is True
