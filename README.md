# OpenCall

OpenCall is a project to manage calls.

## Current foundation

The repo currently has:

- `apps/bridge` - Bun + TypeScript bridge server
- `apps/mobile` - Expo mobile prototype
- `apps/cli` - local CLI for running the bridge like a small machine service

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
bun run cli:start
bun run cli:status
bun run cli:pair
bun run cli:logs
bun run cli:stop
```
