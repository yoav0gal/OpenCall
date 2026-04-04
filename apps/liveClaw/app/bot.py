from __future__ import annotations
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .config import AppConfig
from .observability import (
    append_diagnostic,
    log_context_compression,
    log_error,
    log_gemini_connected,
    log_gemini_resumed,
    log_transport_connected,
    log_transport_disconnected,
)
from .prompts import build_system_prompt
from .state import LiveClawSession, LiveClawSessionState


@dataclass
class BotRuntime:
    request_handler: Any
    runner: Any
    task: Any
    transport: Any
    context: Any
    config_snapshot: dict[str, Any]


def build_bot_config_snapshot(config: AppConfig) -> dict[str, Any]:
    return {
        "model": config.model,
        "voice": config.voice,
        "media_resolution": config.media_resolution,
        "thinking_budget": 0,
        "context_window_compression": {
            "enabled": True,
            "trigger_tokens": config.context_trigger_tokens,
        },
        "raw_media_in_context": False,
        "system_prompt": build_system_prompt(config),
    }


def resolve_media_resolution(value: str) -> Any:
    from pipecat.services.google.gemini_live.llm import GeminiMediaResolution

    normalized = value.strip().lower()
    mapping = {
        "unspecified": GeminiMediaResolution.UNSPECIFIED,
        "low": GeminiMediaResolution.LOW,
        "medium": GeminiMediaResolution.MEDIUM,
        "high": GeminiMediaResolution.HIGH,
    }
    try:
        return mapping[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported LIVECLAW_MEDIA_RESOLUTION: {value}") from exc


async def create_bot(
    session: LiveClawSession,
    config: AppConfig,
    logger: Any,
) -> BotRuntime:
    from pipecat.frames.frames import OutputTransportMessageFrame, TTSTextFrame, TranscriptionFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineTask
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
    from pipecat.services.google.gemini_live.llm import (
        ContextWindowCompressionParams,
        GeminiLiveLLMService,
        GeminiLiveLLMSettings,
    )
    from pipecat.transports.base_transport import TransportParams
    from pipecat.transports.smallwebrtc.connection import IceServer
    from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCRequestHandler
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
    from google.genai.types import ThinkingConfig

    class SessionEventProcessor(FrameProcessor):
        async def process_frame(self, frame: Any, direction: FrameDirection) -> None:
            await super().process_frame(frame, direction)
            if isinstance(frame, TranscriptionFrame):
                transcript = {
                    "role": "user",
                    "text": frame.text,
                    "timestamp": frame.timestamp,
                }
                session.transcripts.append(transcript)
                await self.push_frame(
                    OutputTransportMessageFrame(message={"type": "transcript", **transcript}),
                    FrameDirection.DOWNSTREAM,
                )
            elif isinstance(frame, TTSTextFrame):
                transcript = {
                    "role": "assistant",
                    "text": frame.text,
                    "timestamp": datetime.now(UTC).isoformat(),
                }
                session.transcripts.append(transcript)
                await self.push_frame(
                    OutputTransportMessageFrame(message={"type": "transcript", **transcript}),
                    FrameDirection.DOWNSTREAM,
                )
            await self.push_frame(frame, direction)

    request_handler = SmallWebRTCRequestHandler(
        ice_servers=[IceServer(urls=["stun:stun.l.google.com:19302"])]
    )

    context = LLMContext(messages=[{"role": "system", "content": build_system_prompt(config)}])
    context_aggregator = LLMContextAggregatorPair(context)

    llm = GeminiLiveLLMService(
        api_key=config.google_api_key,
        settings=GeminiLiveLLMSettings(
            model=config.model,
            voice=config.voice,
            media_resolution=resolve_media_resolution(config.media_resolution),
            thinking=ThinkingConfig(thinking_budget=0, include_thoughts=False),
            context_window_compression=ContextWindowCompressionParams(
                enabled=True,
                trigger_tokens=config.context_trigger_tokens,
            ).model_dump(),
        ),
    )
    log_context_compression(logger, session, config.context_trigger_tokens)

    transport_holder: dict[str, SmallWebRTCTransport] = {}

    async def build_task(connection: Any) -> None:
        transport = SmallWebRTCTransport(
            webrtc_connection=connection,
            params=TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                video_in_enabled=True,
                video_out_enabled=False,
            ),
        )
        transport_holder["transport"] = transport

        @transport.event_handler("on_client_connected")
        async def on_client_connected(_: Any, __: Any) -> None:
            session.state = LiveClawSessionState.CONNECTED
            session.last_seen_at = datetime.now(UTC)
            await transport.capture_participant_audio()
            await transport.capture_participant_video()
            append_diagnostic(session, "transport.capture.enabled", audio=True, video=True)
            log_transport_connected(logger, session)
            log_gemini_connected(logger, session)

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(_: Any, __: Any) -> None:
            session.state = LiveClawSessionState.RECONNECTING
            session.last_seen_at = datetime.now(UTC)
            log_transport_disconnected(logger, session)
            log_gemini_resumed(logger, session)

        pipeline = Pipeline(
            [
                transport.input(),
                context_aggregator.user(),
                llm,
                context_aggregator.assistant(),
                SessionEventProcessor(),
                transport.output(),
            ]
        )
        task = PipelineTask(pipeline)
        runner = PipelineRunner(handle_sigint=False, handle_sigterm=False)

        session.transport = transport
        session.runner = runner
        session.bot_task = task
        session.request_handler = request_handler
        session.metadata["context_policy"] = {
            "text_only_context": True,
            "raw_media_persisted": False,
            "compression_enabled": True,
            "trigger_tokens": config.context_trigger_tokens,
        }
        append_diagnostic(session, "gemini.pipeline.ready")

        try:
            await runner.run(task)
        except Exception as exc:
            session.last_error = str(exc)
            session.state = LiveClawSessionState.ERROR
            log_error(logger, session, str(exc))
            raise

    session.state = LiveClawSessionState.CONNECTING
    session.metadata["bootstrap_callback"] = build_task

    return BotRuntime(
        request_handler=request_handler,
        runner=None,
        task=None,
        transport=None,
        context=context,
        config_snapshot=build_bot_config_snapshot(config),
    )


async def stop_bot(session: LiveClawSession) -> None:
    if session.bot_task:
        await session.bot_task.cancel()
    if session.runner:
        await session.runner.cancel()
    if session.request_handler:
        await session.request_handler.close()
