# OpenCall Bridge

Minimal Bun + TypeScript bridge for the first OpenCall prototype.

It currently provides:

- `GET /health`
- `GET /devices`
- `GET /pairing`
- `POST /pair`
- `POST /calls`
- `GET /calls/current`
- `POST /calls/current/accept`
- `POST /calls/current/end`
- `POST /livekit/token`
- `POST /gemini/token`
- `GET /gemini/status`
- `GET /realtime?sessionToken=...` websocket endpoint

## Install

```bash
bun install
```

## Environment

Copy the example file and fill in the Gemini key locally:

```bash
cp apps/bridge/.env.example apps/bridge/.env.local
```

The bridge reads `apps/bridge/.env.local` automatically when started with Bun.

## Run the bridge

```bash
bun run bridge:dev
```

The default server address is `http://localhost:8787`.

Bridge state is persisted under `apps/bridge/data/bridge-state.json` by default.
The CLI can override this with `OPENCALL_HOME` and `OPENCALL_DATA_DIR`.

## Run through the CLI

```bash
bun run cli:start
bun run cli:status
bun run cli:pair
bun run cli:logs
bun run cli:stop
```

## Run LiveKit locally

LiveKit official docs support running a local dev server with:

```bash
livekit-server --dev --bind 0.0.0.0
```

That uses:

- API key: `devkey`
- API secret: `secret`
- WebSocket URL: `ws://127.0.0.1:7880`

Install on macOS with:

```bash
brew update && brew install livekit
```

The bridge does not start LiveKit itself yet. It assumes a local LiveKit server
is already running.

## Notes

- Gemini Live stays server-side in the bridge. The mobile client should not hold
  the long-lived Gemini API key.
- `POST /gemini/token` now returns a short-lived Gemini Live ephemeral token for
  an already paired device session.
- WebSocket clients now require a valid `sessionToken` returned from `POST /pair`.
- CLI `status` reports both PID-file state and actual HTTP reachability.
