# OpenCall

> Status: This project was stopped mid-development and is not maintained. It is published as-is for reference, learning, and reuse. Expect incomplete flows, rough edges, and outdated dependencies.

OpenCall is a project to manage calls.

## Current foundation

The repo currently has:

- `apps/bridge` - Bun + TypeScript bridge server
- `apps/mobile` - Expo mobile prototype
- `apps/cli` - local CLI for running the bridge like a small machine service
- `apps/liveClaw` - standalone experimental FastAPI + Pipecat + Gemini Live browser app

## Bridge CLI

The local CLI supports:

- `opencall start`
- `opencall stop`
- `opencall status`
- `opencall pair`
- `opencall logs`

Run it from the repo:

```bash
bun install
bun run cli:start -- --tunnel
bun run cli:status
bun run cli:pair
bun run cli:logs
bun run cli:stop
```

For phone pairing with Expo Go:

1. Start the bridge with `bun run cli:start -- --tunnel`
2. Start the Expo app with `bun run mobile:start`
3. Open the app in Expo Go on your phone
4. Run `bun run cli:pair` on your Mac
5. Tap `Scan CLI QR` in the app and scan the terminal QR

`cli:start -- --tunnel` expects the Tailscale CLI to be installed and logged in on the Mac.
