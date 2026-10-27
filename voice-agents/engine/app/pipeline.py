"""Runs one live phone call: Twilio audio -> STT -> Claude (+tools) -> TTS -> Twilio."""

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import WebSocket
from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    EndWorkerFrame,
    FunctionCallResultProperties,
    LLMMessagesAppendFrame,
    TTSSpeakFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transcriptions.language import Language
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.workers.runner import WorkerRunner

from app.agents.prompt import CallContext, build_system_prompt, call_values, opening_line
from app.agents.schema import AgentConfig
from app.calls import CallRecord, CallRegistry, utc_now
from app.config import Settings
from app.tools.base import ToolContext
from app.tools.toolbox import Toolbox

# Tools that change something outside the call must finish even if the caller talks over them.
SIDE_EFFECT_TOOLS = {"send_sms", "send_whatsapp", "transfer_call", "issue_document"}
IDLE_PROMPT_AFTER_S = 8


class CallSerializer(TwilioFrameSerializer):
    """Twilio serializer that leaves a transferred call alone when our stream closes."""

    def __init__(self, record: CallRecord, **kwargs: Any):
        super().__init__(**kwargs)
        self._record = record

    async def serialize(self, frame):
        if isinstance(frame, (EndFrame, CancelFrame)) and self._record.transferred_to:
            return None
        return await super().serialize(frame)


@dataclass
class CallDeps:
    settings: Settings
    calls: CallRegistry
    http: httpx.AsyncClient
    twilio: Any = None


def tool_schemas(toolbox: Toolbox) -> list[FunctionSchema]:
    return [
        FunctionSchema(
            name=t.spec.name,
            description=t.spec.description,
            properties=t.spec.properties,
            required=t.spec.required,
        )
        for t in toolbox.tools.values()
    ]


async def run_call(
    websocket: WebSocket,
    agent: AgentConfig,
    record: CallRecord,
    stream_sid: str,
    deps: CallDeps,
) -> None:
    settings = deps.settings
    values = call_values(
        agent,
        record.variables,
        CallContext(direction=record.direction, caller_number=record.remote_number),
    )
    system_prompt = build_system_prompt(agent, values)
    first_line = opening_line(agent, values, record.direction)

    toolbox = await Toolbox.create(
        ToolContext(agent=agent, call=record, settings=settings, http=deps.http, twilio=deps.twilio)
    )

    serializer = CallSerializer(
        record,
        stream_sid=stream_sid,
        call_sid=record.twilio_call_sid,
        account_sid=settings.twilio_account_sid,
        auth_token=settings.twilio_auth_token,
    )
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
        ),
    )

    stt = ElevenLabsRealtimeSTTService(
        api_key=settings.elevenlabs_api_key,
        settings=ElevenLabsRealtimeSTTService.Settings(
            language=Language.HE,
            keyterms=[k for k in (agent.business_name, agent.name) if k] or None,
        ),
    )
    tts = ElevenLabsTTSService(
        api_key=settings.elevenlabs_api_key,
        settings=ElevenLabsTTSService.Settings(
            voice=agent.voice_id or settings.elevenlabs_default_voice_id,
            model=settings.elevenlabs_tts_model,
            language=Language.HE,
        ),
    )
    llm = AnthropicLLMService(
        api_key=settings.anthropic_api_key,
        settings=AnthropicLLMService.Settings(
            model=agent.llm_model or settings.anthropic_model,
            system_instruction=system_prompt,
        ),
    )

    context = LLMContext(tools=ToolsSchema(standard_tools=tool_schemas(toolbox)))
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
            user_idle_timeout=IDLE_PROMPT_AFTER_S,
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
        ),
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    async def handle_tool(params: FunctionCallParams) -> None:
        result = await toolbox.execute(params.function_name, dict(params.arguments or {}))
        if result.end_call or result.transferred:
            # The agent already said goodbye (or "transferring you"); don't let it talk again.
            await params.result_callback(result.data, properties=FunctionCallResultProperties(run_llm=False))
            await params.llm.push_frame(EndWorkerFrame(reason=record.end_reason))
        else:
            await params.result_callback(result.data)

    for name in toolbox.tools:
        llm.register_function(
            name,
            handle_tool,
            cancel_on_interruption=name not in SIDE_EFFECT_TOOLS,
            timeout_secs=30,
        )

    @user_aggregator.event_handler("on_user_turn_message_added")
    async def on_user_message(aggregator, message):
        record.add_transcript("caller", message.content or "")

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn(aggregator, message):
        record.add_transcript("agent", message.content or "")

    @user_aggregator.event_handler("on_user_turn_idle")
    async def on_idle(aggregator):
        await worker.queue_frames(
            [
                LLMMessagesAppendFrame(
                    messages=[
                        {
                            "role": "developer",
                            "content": "הצד השני שותק כבר כמה שניות. לשאול בקצרה אם הוא עדיין על הקו.",
                        }
                    ],
                    run_llm=True,
                )
            ]
        )

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        record.status = "in_progress"
        record.started_at = record.started_at or utc_now()
        logger.info(f"{record.id}: connected ({record.direction}, agent {agent.id})")
        if first_line:
            await worker.queue_frames([TTSSpeakFrame(first_line)])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(transport, client):
        logger.info(f"{record.id}: disconnected")
        record.end_reason = record.end_reason or "remote_hung_up"
        await runner.cancel()

    async def enforce_time_limits() -> None:
        limits = agent.limits
        await asyncio.sleep(limits.effective_wrap_up_s)
        await worker.queue_frames(
            [
                LLMMessagesAppendFrame(
                    messages=[
                        {
                            "role": "developer",
                            "content": "הזמן של השיחה כמעט נגמר. לסכם עכשיו את מה שסוכם, להיפרד ולסיים.",
                        }
                    ],
                    run_llm=False,
                )
            ]
        )
        await asyncio.sleep(max(limits.max_duration_s - limits.effective_wrap_up_s, 5))
        logger.info(f"{record.id}: max duration reached")
        record.end_reason = record.end_reason or "max_duration"
        await worker.queue_frames([EndWorkerFrame(reason="max_duration")])

    limiter = asyncio.create_task(enforce_time_limits())
    try:
        await runner.run()
    finally:
        limiter.cancel()
        await toolbox.close()
        deps.calls.finish(record, reason=record.end_reason or "ended")
        logger.info(f"{record.id}: finished ({record.end_reason})")
