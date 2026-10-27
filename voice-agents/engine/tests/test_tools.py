import json

import httpx
import pytest
from mcp.server.mcpserver import MCPServer

from app.agents.schema import AgentConfig, MorningDocumentTool
from app.tools.base import ToolError
from app.tools.builtin.morning import MorningClient, MorningDocument
from app.tools.toolbox import Toolbox
from tests.conftest import FakeTwilio


def agent_with(tools: list[dict]) -> AgentConfig:
    return AgentConfig.model_validate(
        {"id": "tools-agent", "name": "ט", "context": "c", "goal": "g", "tools": tools}
    )


ITEMS = [
    {"description": "בובה", "quantity": 10, "unit_price": 35.5},
    {"description": "כדור", "quantity": 2, "unit_price": 20},
]


async def test_unknown_tool_and_crash_become_results(make_ctx, monkeypatch):
    box = await Toolbox.create(make_ctx(agent_with([])))
    result = await box.execute("nope", {})
    assert not result.ok and result.data == {"error": "אין כלי כזה"}

    async def crash(args, ctx):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(box.tools["end_call"], "run", crash)
    result = await box.execute("end_call", {"password": "x"})
    assert not result.ok and "secret" not in json.dumps(result.data)
    assert box.ctx.call.tool_calls[-1].arguments == {"password": "***"}


async def test_end_call(make_ctx):
    box = await Toolbox.create(make_ctx(agent_with([])))
    result = await box.execute("end_call", {"reason": "done"})
    assert result.end_call and box.ctx.call.end_reason == "done"


async def test_sms_only_to_caller(make_ctx):
    twilio = FakeTwilio()
    box = await Toolbox.create(make_ctx(agent_with([{"type": "send_sms"}]), twilio=twilio))
    assert "to" not in box.tools["send_sms"].spec.properties
    result = await box.execute("send_sms", {"message": "הכתובת: הרצל 1", "to": "050-9999999"})
    assert result.ok and twilio.messages == [
        {"to": "+972532413215", "from": "+97233000000", "body": "הכתובת: הרצל 1"}
    ]


async def test_sms_to_hidden_caller_fails_cleanly(make_ctx):
    box = await Toolbox.create(
        make_ctx(agent_with([{"type": "send_sms"}]), remote="unknown", twilio=FakeTwilio())
    )
    result = await box.execute("send_sms", {"message": "x"})
    assert not result.ok and "חסוי" in result.data["error"]


async def test_whatsapp_prefixes(make_ctx):
    twilio = FakeTwilio()
    tools = [{"type": "send_whatsapp", "from_number": "+14155238886"}]
    box = await Toolbox.create(make_ctx(agent_with(tools), twilio=twilio))
    assert (await box.execute("send_whatsapp", {"message": "קישור"})).ok
    assert twilio.messages[0]["to"] == "whatsapp:+972532413215"
    assert twilio.messages[0]["from"] == "whatsapp:+14155238886"


async def test_transfer(make_ctx):
    twilio = FakeTwilio()
    box = await Toolbox.create(
        make_ctx(agent_with([{"type": "transfer_call", "to_number": "050-1234567"}]), twilio=twilio)
    )
    result = await box.execute("transfer_call", {})
    assert result.transferred and box.ctx.call.transferred_to == "+972501234567"
    assert twilio.updates[0][0] == "CA1" and "+972501234567</Dial>" in twilio.updates[0][1]


async def test_transfer_with_placeholder_number_fails_cleanly(make_ctx):
    box = await Toolbox.create(
        make_ctx(agent_with([{"type": "transfer_call", "to_number": "[למלא: נייד]"}]), twilio=FakeTwilio())
    )
    result = await box.execute("transfer_call", {})
    assert not result.ok and not result.transferred


# --- Morning ---------------------------------------------------------------


def morning_tool(**kw) -> MorningDocument:
    return MorningDocument(MorningDocumentTool(**kw))


def test_morning_requires_confirmation_and_limits():
    tool = morning_tool(max_total_ils=400)
    base = {"document_type": "price_quote", "client_name": "חנות דני", "items": ITEMS}
    with pytest.raises(ToolError, match="אישור"):
        tool.build_payload({**base, "caller_confirmed": False})
    with pytest.raises(ToolError, match="גבוה"):
        tool.build_payload({**base, "caller_confirmed": True, "items": ITEMS * 2})
    with pytest.raises(ToolError, match="הרשאה"):
        tool.build_payload({**base, "caller_confirmed": True, "document_type": "tax_invoice"})
    with pytest.raises(ToolError):
        tool.build_payload(
            {
                **base,
                "caller_confirmed": True,
                "items": [{"description": "x", "quantity": -1, "unit_price": 5}],
            }
        )
    payload, total = tool.build_payload({**base, "caller_confirmed": True, "client_email": "a@b.co"})
    assert total == 395.0
    assert payload["type"] == 10 and payload["client"]["emails"] == ["a@b.co"]
    assert all(i["vatType"] == 1 and i["currency"] == "ILS" for i in payload["income"])


async def test_morning_issues_document_against_api(make_ctx):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/account/token"):
            assert json.loads(request.content) == {"id": "mid", "secret": "msecret"}
            return httpx.Response(200, json={"token": "jwt", "expires": 9999999999})
        assert request.headers["authorization"] == "Bearer jwt"
        return httpx.Response(200, json={"id": "d1", "number": 1007, "url": {"he": "https://doc.test/1007"}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    agent = agent_with([{"type": "morning_document"}])
    box = await Toolbox.create(make_ctx(agent, http=http))
    args = {
        "document_type": "price_quote",
        "client_name": "חנות דני",
        "items": ITEMS,
        "caller_confirmed": True,
    }
    result = await box.execute("issue_document", args)
    assert result.ok, result.data
    assert result.data == {
        "status": "issued",
        "document_type": "הצעת מחיר",
        "number": 1007,
        "total_ils": 395.0,
        "link": "https://doc.test/1007",
    }
    assert str(seen[0].url).startswith("https://sandbox.d.greeninvoice.co.il/api/v1/")
    # The token is reused for the next document.
    await box.execute("issue_document", args)
    assert sum(r.url.path.endswith("/account/token") for r in seen) == 1


async def test_morning_api_error_is_reported(make_ctx):
    http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: (
                httpx.Response(200, json={"token": "t", "expires": 9999999999})
                if r.url.path.endswith("/token")
                else httpx.Response(400, json={"errorMessage": "לקוח חסר"})
            )
        )
    )
    box = await Toolbox.create(make_ctx(agent_with([{"type": "morning_document"}]), http=http))
    args = {"document_type": "price_quote", "client_name": "x", "items": ITEMS, "caller_confirmed": True}
    result = await box.execute("issue_document", args)
    assert not result.ok and "לקוח חסר" in result.data["error"]


async def test_morning_never_real_in_text_tests(make_ctx, settings):
    settings.morning_sandbox = False
    box = await Toolbox.create(make_ctx(agent_with([{"type": "morning_document"}]), test_mode=True))
    args = {"document_type": "price_quote", "client_name": "x", "items": ITEMS, "caller_confirmed": True}
    result = await box.execute("issue_document", args)
    assert result.ok and result.data["status"] == "simulated"


def test_morning_client_needs_credentials():
    with pytest.raises(ToolError):
        MorningClient("", "", True, httpx.AsyncClient())


# --- Webhook ---------------------------------------------------------------


async def test_webhook_post(make_ctx, monkeypatch):
    monkeypatch.setenv("CRM_TOKEN", "s3cret")
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"stock": 4})

    tools = [
        {
            "type": "webhook",
            "name": "check_stock",
            "description": "מלאי",
            "url": "https://crm.test/stock",
            "params": [{"name": "sku", "required": True}],
            "headers": {"Authorization": "Bearer ${CRM_TOKEN}"},
        }
    ]
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    box = await Toolbox.create(make_ctx(agent_with(tools), http=http))
    assert box.tools["check_stock"].spec.required == ["sku"]
    result = await box.execute("check_stock", {"sku": "A1", "injected": "x"})
    assert result.ok and result.data == {"stock": 4}
    assert captured["auth"] == "Bearer s3cret"
    assert captured["body"]["arguments"] == {"sku": "A1"}
    assert captured["body"]["call"]["agent_id"] == "tools-agent"


async def test_webhook_missing_env_and_http_errors(make_ctx):
    tools = [
        {
            "type": "webhook",
            "name": "w",
            "description": "d",
            "url": "https://x.test",
            "headers": {"A": "${NOT_SET_ANYWHERE}"},
        }
    ]
    box = await Toolbox.create(make_ctx(agent_with(tools)))
    result = await box.execute("w", {})
    assert not result.ok and "NOT_SET_ANYWHERE" in result.data["error"]

    tools[0]["headers"] = {}
    box = await Toolbox.create(make_ctx(agent_with(tools)))  # default mock returns 500
    result = await box.execute("w", {})
    assert not result.ok and "500" in result.data["error"]


# --- MCP -------------------------------------------------------------------


def stock_server() -> MCPServer:
    server = MCPServer("stock")

    @server.tool()
    def check_stock(sku: str) -> dict:
        """כמה יחידות יש במלאי"""
        return {"sku": sku, "stock": 12}

    @server.tool()
    def delete_everything() -> str:
        """מסוכן"""
        return "deleted"

    @server.tool()
    def broken() -> str:
        """נכשל"""
        raise ValueError("nope")

    return server


async def test_mcp_tools_are_exposed_and_filtered(make_ctx):
    tools = [
        {"type": "mcp", "name": "erp", "url": "https://erp.test/mcp", "allow": ["check_stock", "broken"]}
    ]
    box = await Toolbox.create(make_ctx(agent_with(tools)), mcp_overrides={"erp": stock_server()})
    assert set(box.tools) == {"end_call", "erp__check_stock", "erp__broken"}
    assert box.tools["erp__check_stock"].spec.required == ["sku"]
    result = await box.execute("erp__check_stock", {"sku": "A1"})
    assert result.ok and '"stock": 12' in result.data
    failed = await box.execute("erp__broken", {})
    assert not failed.ok and "שגיאה" in failed.data["error"]
    await box.close()


async def test_dead_mcp_server_does_not_break_the_call(make_ctx):
    tools = [{"type": "mcp", "name": "erp", "url": "https://127.0.0.1:9/mcp"}]
    box = await Toolbox.create(make_ctx(agent_with(tools)))
    assert set(box.tools) == {"end_call"}
