# liveClaw

`liveClaw` is a standalone experimental browser app under `apps/liveClaw` that runs a
local FastAPI backend, Pipecat WebRTC transport, and Gemini Live session without going
through `apps/bridge`.

## Architecture

- FastAPI serves the browser UI and session APIs.
- Each browser session gets one in-memory Pipecat bot runtime.
- Gemini Live runs server-side only; the Google API key never reaches the browser.
- Session reuse is allowed for `LIVECLAW_SESSION_GRACE_SECONDS`, with context
  compression enabled and raw media excluded from persisted LLM context.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `GOOGLE_API_KEY`.
3. Run `uv sync`.

## Run

```bash
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

Open `http://127.0.0.1:8010`.

## Tests

```bash
uv run pytest
```

## Troubleshooting

- If camera or microphone access fails, verify the browser has permissions for
  `http://127.0.0.1:8010`.
- If startup fails immediately, `GOOGLE_API_KEY` is likely missing or blank.
- If reconnect does not reuse the same session, check whether the grace window expired.
- If audio/video transport stalls, disconnect and reconnect to force a fresh peer
  connection negotiation.
