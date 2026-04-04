from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .bot import create_bot, stop_bot
from .config import AppConfig, get_config
from .observability import log_session_closed, log_session_started, setup_logging
from .schemas import (
    ClientConfigResponse,
    EndSessionRequest,
    HealthResponse,
    StartSessionRequest,
    StartSessionResponse,
    TextMessageRequest,
)
from .session_manager import SessionManager
from .state import LiveClawSession, LiveClawSessionState

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
SRC_DIR = FRONTEND_DIR / "src"


def create_app(config: AppConfig | None = None) -> FastAPI:
    config = config or get_config()
    logger = setup_logging(config.log_level)
    session_manager = SessionManager(config)

    async def cleanup_session(session: LiveClawSession) -> None:
        await stop_bot(session)
        log_session_closed(logger, session)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await session_manager.start_sweeper(on_expire=cleanup_session)
        yield
        await session_manager.stop_sweeper()

    app = FastAPI(title="liveClaw", lifespan=lifespan)
    app.state.config = config
    app.state.logger = logger
    app.state.session_manager = session_manager

    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="liveclaw-assets")

    @app.get("/", include_in_schema=False)
    async def root() -> FileResponse:
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse()

    @app.get("/api/config", response_model=ClientConfigResponse)
    async def client_config() -> ClientConfigResponse:
        return ClientConfigResponse(
            host=config.host,
            port=config.port,
            model=config.model,
            voice=config.voice,
            reconnect_grace_seconds=config.session_grace_seconds,
            media_resolution=config.media_resolution,
        )

    @app.post("/api/session/start", response_model=StartSessionResponse)
    async def start_session(body: StartSessionRequest) -> StartSessionResponse:
        session, reused = await session_manager.create_session(
            display_name=body.display_name,
            session_id=body.session_id,
        )

        if not reused or session.request_handler is None:
            runtime = await create_bot(session, config, logger)
            session.request_handler = runtime.request_handler
            session.metadata["bot_config"] = runtime.config_snapshot

        log_session_started(logger, session)

        return StartSessionResponse(
            session_id=session.session_id,
            reused=reused,
            state=session.state.value,
            offer_url=f"/api/session/{session.session_id}/offer",
            ice_servers=[{"urls": ["stun:stun.l.google.com:19302"]}],
            diagnostics=session.diagnostics,
            transcripts=session.transcripts,
        )

    @app.post("/api/session/end")
    async def end_session(body: EndSessionRequest) -> dict[str, Any]:
        session = await session_manager.end_session(body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        await cleanup_session(session)
        return {"ok": True}

    @app.post("/api/session/message")
    async def send_message(body: TextMessageRequest) -> dict[str, Any]:
        session = await session_manager.touch_session(body.session_id)
        if not session or not session.bot_task:
            raise HTTPException(status_code=404, detail="Session not found")

        from pipecat.frames.frames import LLMMessagesAppendFrame

        text = body.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text is required")

        await session.bot_task.queue_frame(
            LLMMessagesAppendFrame(messages=[{"role": "user", "content": text}], run_llm=True)
        )
        return {"ok": True}

    @app.post("/api/session/{session_id}/offer")
    async def webrtc_offer(
        session_id: str,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        session = await session_manager.touch_session(session_id)
        if not session or not session.request_handler:
            raise HTTPException(status_code=404, detail="Session not found")

        from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCRequest

        payload = await request.json()
        offer = SmallWebRTCRequest.from_dict(payload)

        async def connection_callback(connection: Any) -> None:
            bootstrap = session.metadata.get("bootstrap_callback")
            if session.bot_task is None and bootstrap:
                background_tasks.add_task(bootstrap, connection)
            else:
                session.state = LiveClawSessionState.RECONNECTING

        answer = await session.request_handler.handle_web_request(
            request=offer,
            webrtc_connection_callback=connection_callback,
        )
        return answer or {"ok": False}

    @app.patch("/api/session/{session_id}/offer")
    async def webrtc_ice_candidate(session_id: str, request: Request) -> dict[str, Any]:
        session = await session_manager.touch_session(session_id)
        if not session or not session.request_handler:
            raise HTTPException(status_code=404, detail="Session not found")

        from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCPatchRequest

        payload = await request.json()
        await session.request_handler.handle_patch_request(SmallWebRTCPatchRequest(**payload))
        return {"ok": True}

    @app.get("/src/{path:path}", include_in_schema=False)
    async def frontend_src(path: str) -> FileResponse:
        file_path = SRC_DIR / path
        if not file_path.exists():
            raise HTTPException(status_code=404)
        return FileResponse(file_path, media_type="application/javascript")

    return app


app = create_app()
