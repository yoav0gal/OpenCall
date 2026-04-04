# `liveClaw` Implementation Spec To Materialize In Repo

## Summary

Current mode only allows planning, not repo mutations, so I cannot create files or implement yet. This plan is the exact file-level spec to drop into the repo and then build against when execution mode is enabled.

The implementation will add a new standalone app at `apps/liveClaw`:
- Python backend with FastAPI + Pipecat + Gemini Live
- Browser frontend with Pipecat client
- Local-only runtime
- Audio + text + camera
- WebRTC transport
- Session reuse and reconnect grace window
- Context compression enabled

## Files to create

### `apps/liveClaw/README.md`

Document:
- purpose of `liveClaw`
- architecture overview
- env setup
- `uv sync`
- `uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8010`
- open `http://127.0.0.1:8010`
- troubleshooting for camera/mic permissions, missing API key, reconnect behavior

### `apps/liveClaw/.env.example`

```env
GOOGLE_API_KEY=
LIVECLAW_HOST=127.0.0.1
LIVECLAW_PORT=8010
LIVECLAW_MODEL=models/gemini-3.1-flash-live-preview
LIVECLAW_VOICE=Charon
LIVECLAW_SESSION_GRACE_SECONDS=90
LIVECLAW_CONTEXT_TRIGGER_TOKENS=24000
LIVECLAW_MEDIA_RESOLUTION=medium
LIVECLAW_LOG_LEVEL=INFO
```

### `apps/liveClaw/pyproject.toml`

Define:
- project metadata
- Python `>=3.12`
- dependencies:
  - `fastapi`
  - `uvicorn[standard]`
  - `python-dotenv`
  - `pydantic`
  - `pydantic-settings`
  - `pipecat-ai[google,webrtc]`
  - `httpx`
- optional dev deps:
  - `pytest`
  - `pytest-asyncio`
  - `ruff`

### `apps/liveClaw/app/config.py`

Implement:
- `AppConfig` via `pydantic-settings`
- fail-fast validation for `GOOGLE_API_KEY`
- defaults from `.env.example`
- exported cached `get_config()`

### `apps/liveClaw/app/schemas.py`

Define request/response models:
- `HealthResponse`
- `ClientConfigResponse`
- `StartSessionRequest`
- `StartSessionResponse`
- `EndSessionRequest`
- `TextMessageRequest`

### `apps/liveClaw/app/prompts.py`

Define:
- single concise system instruction for `liveClaw`
- small helper to build prompt text from config if voice/model options need to be injected

### `apps/liveClaw/app/state.py`

Define:
- `LiveClawSessionState` enum or literal values:
  - `created`
  - `connecting`
  - `connected`
  - `reconnecting`
  - `closed`
  - `error`
- `LiveClawSession` dataclass:
  - `session_id`
  - `display_name`
  - `created_at`
  - `last_seen_at`
  - `state`
  - `reconnect_count`
  - `last_error`
  - `transport`
  - `bot_task`

### `apps/liveClaw/app/observability.py`

Implement:
- structured logger setup
- helper functions:
  - `log_session_started`
  - `log_transport_connected`
  - `log_transport_disconnected`
  - `log_gemini_connected`
  - `log_gemini_resumed`
  - `log_context_compression`
  - `log_session_closed`
  - `log_error`

### `apps/liveClaw/app/session_manager.py`

Implement:
- in-memory `SessionManager`
- methods:
  - `create_session(display_name)`
  - `get_session(session_id)`
  - `touch_session(session_id)`
  - `mark_reconnecting(session_id)`
  - `mark_connected(session_id)`
  - `record_error(session_id, error)`
  - `end_session(session_id)`
  - `sweep_expired_sessions()`
- use grace timeout from config
- background sweeper task started by FastAPI lifespan

### `apps/liveClaw/app/bot.py`

Implement the Pipecat runtime:
- construct `SmallWebRTCTransport`
- construct Gemini Live service
- configure:
  - server-side key only
  - model from config
  - voice from config
  - input/output transcription enabled
  - context compression enabled
  - trigger tokens from config
- pipeline:
  - transport input
  - user context aggregation
  - Gemini Live service
  - assistant context aggregation
  - transport output
- expose a factory like:
  - `create_bot(session, config)`
- expose transport/bootstrap helpers needed by `main.py`

Important decisions to hardcode:
- only transcribed turns enter context
- no raw media persistence
- no custom summarizer in v1
- one bot per browser session

### `apps/liveClaw/app/main.py`

Implement FastAPI app with:
- lifespan startup/shutdown
- mount `frontend/`
- routes:
  - `GET /`
  - `GET /health`
  - `GET /api/config`
  - `POST /api/session/start`
  - `POST /api/session/end`
  - `POST /api/session/message`
  - signaling route required by `SmallWebRTCTransport`
- on `session/start`:
  - create `LiveClawSession`
  - initialize bot transport/bootstrap
  - return session id and connection bootstrap payload
- on `session/end`:
  - stop bot
  - remove session
- on `session/message`:
  - inject text into that session pipeline

### `apps/liveClaw/frontend/index.html`

Single-page shell with:
- connect/disconnect buttons
- mic toggle
- camera toggle
- text input + send
- status chips
- transcript panel
- diagnostic log panel

### `apps/liveClaw/frontend/src/main.ts`

Bootstrap frontend app.

### `apps/liveClaw/frontend/src/app.ts`

UI orchestration:
- bind controls
- render connection states
- render logs and transcripts
- manage lifecycle

### `apps/liveClaw/frontend/src/client.ts`

Pipecat client wrapper:
- fetch `/api/config`
- call `/api/session/start`
- connect transport
- start mic/camera
- send typed text
- surface transport and transcript events
- call `/api/session/end` on disconnect

### `apps/liveClaw/frontend/src/ui.ts`

Pure rendering helpers:
- status chip update
- transcript append
- error rendering
- diagnostics list

### `apps/liveClaw/frontend/src/styles.css`

Deliberate visual direction:
- not generic dark dashboard
- use warm industrial palette
- high-contrast status chips
- compact console-style transcripts
- responsive mobile-width layout even though target is desktop browser

### `apps/liveClaw/tests/test_config.py`

Cases:
- missing `GOOGLE_API_KEY` fails
- defaults load correctly
- token threshold config parses

### `apps/liveClaw/tests/test_health.py`

Cases:
- `/health` returns `ok`
- `/api/config` omits secrets

### `apps/liveClaw/tests/test_start_session.py`

Cases:
- `POST /api/session/start` returns session id
- returned payload includes signaling/bootstrap fields
- session stored in manager

### `apps/liveClaw/tests/test_context_policy.py`

Cases:
- compression enabled on Gemini service config
- trigger token threshold matches env
- raw media is not added to model context path

## Root-level repo edits to make later

### `package.json`

Add scripts:
- `liveclaw:setup`
- `liveclaw:dev`
- `liveclaw:test`

Exact intent:
- `liveclaw:setup` runs `cd apps/liveClaw && uv sync`
- `liveclaw:dev` runs `cd apps/liveClaw && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8010`
- `liveclaw:test` runs `cd apps/liveClaw && uv run pytest`

### Root `README.md`

Append one short section listing `apps/liveClaw` as a standalone experimental sub-app.

## Behavioral requirements

### Session lifecycle

- create session on explicit connect
- preserve session for 90 seconds after disconnect
- reconnect within grace window resumes same session id
- after timeout, session is destroyed

### Context policy

- keep system prompt short
- aggregate only text/transcriptions
- enable Gemini compression
- never retain raw audio/video blobs in LLM context

### Failure handling

- browser sees states:
  - connecting
  - connected
  - reconnecting
  - failed
- backend logs fatal Gemini and transport errors
- session manager records last error for diagnostics

## Acceptance criteria

### Functional

- local browser can connect
- mic audio streams and yields spoken Gemini replies
- camera frames stream and Gemini can answer about visible content
- typed prompts work
- reconnect within grace window does not create a new session

### Non-functional

- Gemini key never reaches browser
- no dependency on `apps/bridge`
- no persistent storage required
- no LiveKit required

## Assumptions locked

- app name is `liveClaw`
- standalone app under `apps/liveClaw`
- first milestone is browser-only
- audio + text + camera are in scope
- transport is Pipecat WebRTC, not raw WebSocket
- implementation will use Python tooling with `uv`

## Execution note

When mutation mode is enabled, implementation should proceed in this order:
1. scaffold `apps/liveClaw` backend and config
2. wire session manager and health/config endpoints
3. wire Pipecat bot pipeline and signaling
4. build frontend controls and transcript UI
5. add tests
6. add root scripts and docs
