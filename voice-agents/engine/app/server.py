"""HTTP + WebSocket entry points of the voice engine."""

import hmac
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from anthropic import AsyncAnthropic
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from loguru import logger
from pipecat.runner.utils import parse_telephony_websocket
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketState

from app.agents.prompt import CallContext, MissingVariables, build_system_prompt, call_values
from app.agents.store import AgentNotFound, FileAgentStore
from app.calls import CallRecord, CallRegistry
from app.config import Settings, get_settings
from app.pipeline import CallDeps, run_call
from app.telephony.phone import InvalidPhoneNumber, normalize_il_number
from app.telephony.signature import is_valid_signature
from app.telephony.twilio_api import TwilioApi, TwilioError, say_and_hangup_twiml, stream_twiml
from app.text_chat import chat_turn
from app.tools.base import ToolContext
from app.tools.toolbox import Toolbox

TWILIO_STATUS_MAP = {
    "queued": "created",
    "initiated": "created",
    "ringing": "ringing",
    "in-progress": "in_progress",
    "completed": "ended",
    "busy": "no_answer",
    "no-answer": "no_answer",
    "failed": "failed",
    "canceled": "failed",
}


class AppState:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.agents = FileAgentStore(settings.agents_dir)
        self.calls = CallRegistry(settings.calls_dir)
        self.http = httpx.AsyncClient(timeout=15)
        self.twilio = (
            TwilioApi(settings.twilio_account_sid, settings.twilio_auth_token, self.http)
            if settings.twilio_account_sid and settings.twilio_auth_token
            else None
        )
        self.idempotency: dict[str, str] = {}
        self.anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key or "unset")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await app.state.engine.http.aclose()

    app = FastAPI(title="Voice Agents Engine", lifespan=lifespan)
    app.state.engine = AppState(settings)

    def state(request: Request) -> AppState:
        return request.app.state.engine

    def require_api_key(request: Request) -> None:
        expected = settings.engine_api_key
        given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if not expected or not hmac.compare_digest(given, expected):
            raise HTTPException(status_code=401, detail="invalid api key")

    async def require_twilio_signature(request: Request) -> dict[str, str]:
        form = {k: str(v) for k, v in (await request.form()).items()}
        if settings.twilio_validate_signature:
            url = settings.public_base_url.rstrip("/") + request.url.path
            if request.url.query:
                url += "?" + request.url.query
            signature = request.headers.get("x-twilio-signature", "")
            if not is_valid_signature(settings.twilio_auth_token, url, form, signature):
                logger.warning(f"Rejected Twilio webhook with bad signature: {request.url.path}")
                raise HTTPException(status_code=403, detail="invalid signature")
        return form

    def require_finished(agent) -> None:
        placeholders = agent.unfilled_placeholders()
        if placeholders:
            raise HTTPException(422, {"error": "agent has unfilled fields", "fields": placeholders})

    def ws_url() -> str:
        base = settings.public_base_url.rstrip("/")
        return base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/twilio/stream"

    @app.get("/health")
    async def health():
        return {"ok": True}

    # --- Twilio webhooks ------------------------------------------------------

    @app.post("/twilio/voice")
    async def inbound_call(
        agent: str,
        request: Request,
        form: dict = Depends(require_twilio_signature),
        st: AppState = Depends(state),
    ):
        """Twilio calls this when someone dials a number connected to `?agent=<id>`."""
        try:
            agent_cfg = st.agents.get(agent)
        except AgentNotFound:
            agent_cfg = None
        if agent_cfg is None or agent_cfg.unfilled_placeholders():
            logger.error(f"Inbound call for unknown or unfinished agent {agent!r}")
            return Response(say_and_hangup_twiml("מצטערים, המספר לא זמין כרגע."), media_type="text/xml")
        try:
            caller = normalize_il_number(form.get("From", ""))
        except InvalidPhoneNumber:
            caller = form.get("From") or "unknown"
        record = st.calls.add(
            CallRecord(
                agent_id=agent_cfg.id,
                direction="inbound",
                remote_number=caller,
                twilio_call_sid=form.get("CallSid"),
            )
        )
        return Response(stream_twiml(ws_url(), {"call_id": record.id}), media_type="text/xml")

    @app.post("/twilio/status")
    async def call_status(form: dict = Depends(require_twilio_signature), st: AppState = Depends(state)):
        record = st.calls.find_by_sid(form.get("CallSid", ""))
        status = TWILIO_STATUS_MAP.get(form.get("CallStatus", ""))
        if record and status:
            if status in ("no_answer", "failed"):
                st.calls.finish(record, status=status, reason=form.get("CallStatus"))
            elif status == "ended":
                # A connected call is closed by its pipeline; this catches calls whose
                # audio stream never reached us.
                if record.status != "in_progress":
                    st.calls.finish(record, status="failed", reason="stream_never_connected")
            elif record.status != "in_progress":
                record.status = status
        return Response(status_code=204)

    @app.websocket("/twilio/stream")
    async def media_stream(websocket: WebSocket):
        st: AppState = websocket.app.state.engine
        await websocket.accept()
        try:
            transport_type, call_data = await parse_telephony_websocket(websocket)
        except (WebSocketDisconnect, ValueError):
            # ValueError: the socket closed before Twilio's handshake messages arrived.
            return
        call_id = (call_data.get("body") or {}).get("call_id", "")
        record = st.calls.get(call_id) if transport_type == "twilio" else None
        # The stream must belong to a live call we created, and to the same Twilio call.
        if (
            record is None
            or record.ended_at
            or record.status == "in_progress"
            or (record.twilio_call_sid and record.twilio_call_sid != call_data.get("call_id"))
        ):
            logger.warning(f"Rejected media stream for call {call_id!r}")
            await websocket.close(code=1008)
            return
        record.twilio_call_sid = record.twilio_call_sid or call_data.get("call_id")
        agent = st.agents.get(record.agent_id)
        deps = CallDeps(settings=st.settings, calls=st.calls, http=st.http, twilio=st.twilio)
        try:
            await run_call(websocket, agent, record, call_data["stream_id"], deps)
        except Exception:
            logger.exception(f"{record.id}: call crashed")
            st.calls.finish(record, status="failed", reason="engine_error")
        finally:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()

    # --- Engine API (dashboard / Claude / other systems) -----------------------

    class OutboundCallRequest(BaseModel):
        agent_id: str
        to: str
        variables: dict[str, str] = Field(default_factory=dict)
        idempotency_key: str | None = Field(default=None, max_length=200)

    @app.post("/calls", dependencies=[Depends(require_api_key)])
    async def create_outbound_call(body: OutboundCallRequest, st: AppState = Depends(state)):
        if body.idempotency_key and body.idempotency_key in st.idempotency:
            existing = st.calls.get(st.idempotency[body.idempotency_key])
            if existing:
                return existing.to_dict()
        if st.twilio is None or not settings.twilio_phone_number or not settings.public_base_url:
            raise HTTPException(503, "telephony is not configured")
        try:
            agent = st.agents.get(body.agent_id)
        except AgentNotFound:
            raise HTTPException(404, "agent not found") from None
        require_finished(agent)
        try:
            to = normalize_il_number(body.to)
        except InvalidPhoneNumber:
            raise HTTPException(422, "to must be an Israeli phone number") from None
        if to in settings.blocked_number_set:
            raise HTTPException(403, "this number is blocked")
        try:
            call_values(agent, body.variables, CallContext(direction="outbound"))
        except MissingVariables as e:
            raise HTTPException(422, str(e)) from None

        record = st.calls.add(
            CallRecord(agent_id=agent.id, direction="outbound", remote_number=to, variables=body.variables)
        )
        try:
            record.twilio_call_sid = await st.twilio.create_call(
                to=to,
                from_=settings.twilio_phone_number,
                twiml=stream_twiml(ws_url(), {"call_id": record.id}),
                status_callback=settings.public_base_url.rstrip("/") + "/twilio/status",
                time_limit_s=agent.limits.max_duration_s + 30,
            )
        except TwilioError as e:
            st.calls.finish(record, status="failed", reason=str(e))
            raise HTTPException(502, "could not place the call") from e
        if body.idempotency_key:
            st.idempotency[body.idempotency_key] = record.id
        return record.to_dict()

    @app.get("/calls/{call_id}", dependencies=[Depends(require_api_key)])
    async def get_call(call_id: str, st: AppState = Depends(state)):
        record = st.calls.get(call_id)
        if record is None:
            raise HTTPException(404, "call not found")
        return record.to_dict()

    @app.get("/agents", dependencies=[Depends(require_api_key)])
    async def list_agents(st: AppState = Depends(state)):
        return [
            {"id": a.id, "name": a.name, "business_name": a.business_name, "tools": [t.type for t in a.tools]}
            for a in st.agents.list()
        ]

    class PromptPreviewRequest(BaseModel):
        variables: dict[str, str] = Field(default_factory=dict)
        direction: str = "outbound"

    @app.post("/agents/{agent_id}/prompt", dependencies=[Depends(require_api_key)])
    async def preview_prompt(agent_id: str, body: PromptPreviewRequest, st: AppState = Depends(state)):
        """The exact system prompt a call would get. For the dashboard and for debugging."""
        try:
            agent = st.agents.get(agent_id)
        except AgentNotFound:
            raise HTTPException(404, "agent not found") from None
        try:
            values = call_values(agent, body.variables, CallContext(direction=body.direction))
        except MissingVariables as e:
            raise HTTPException(422, str(e)) from None
        return {"system_prompt": build_system_prompt(agent, values)}

    class ChatMessage(BaseModel):
        role: Literal["user", "assistant"]
        content: str = Field(max_length=2000)

    class ChatRequest(BaseModel):
        messages: list[ChatMessage] = Field(min_length=1, max_length=60)
        variables: dict[str, str] = Field(default_factory=dict)
        direction: Literal["inbound", "outbound"] = "outbound"

    @app.post("/agents/{agent_id}/chat", dependencies=[Depends(require_api_key)])
    async def chat(agent_id: str, body: ChatRequest, st: AppState = Depends(state)):
        """Test an agent in text: send the conversation so far, get her next reply."""
        try:
            agent = st.agents.get(agent_id)
        except AgentNotFound:
            raise HTTPException(404, "agent not found") from None
        require_finished(agent)
        if not settings.anthropic_api_key:
            raise HTTPException(503, "ANTHROPIC_API_KEY is not set")
        record = CallRecord(
            agent_id=agent.id, direction=body.direction, remote_number="test", variables=body.variables
        )
        toolbox = await Toolbox.create(
            ToolContext(
                agent=agent, call=record, settings=settings, http=st.http, twilio=None, test_mode=True
            )
        )
        try:
            return await chat_turn(
                st.anthropic,
                agent.llm_model or settings.anthropic_model,
                agent,
                toolbox,
                [m.model_dump() for m in body.messages],
                direction=body.direction,
            )
        except MissingVariables as e:
            raise HTTPException(422, str(e)) from None
        finally:
            await toolbox.close()

    return app
