# OpenCall Bridge

Minimal Bun + TypeScript bridge for the first OpenCall prototype.

It currently provides:

- `GET /health`
- `GET /pairing`
- `POST /pair`
- `POST /livekit/token`
- `GET /gemini/status`
- `GET /ws` websocket endpoint

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
- The current Gemini endpoint only validates whether the key is configured and
  can create ephemeral tokens later if needed.
