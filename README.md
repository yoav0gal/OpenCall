# OpenCall

OpenCall is a project to manage calls.

## Current foundation

The repo currently has:

- `apps/bridge` — Bun + TypeScript bridge server
- `apps/mobile` — Expo mobile prototype
- `apps/cli` — local CLI for running the bridge like a small machine service

## Bridge CLI

The first local CLI foundation supports:

- `opencall start`
- `opencall stop`
- `opencall status`
- `opencall pair`
- `opencall logs`

For now it manages a local bridge process, writes runtime state under
`~/.opencall/`, and talks to the bridge over HTTP.

### Run it from the repo

```bash
bun install
bun run cli:start
bun run cli:status
bun run cli:pair
bun run cli:stop
```
