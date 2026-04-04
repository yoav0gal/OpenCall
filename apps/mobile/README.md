# OpenCall Mobile

Minimal Expo app for pairing with an OpenCall bridge.

## What it does

- scans a CLI QR
- accepts a bridge URL
- checks bridge health over HTTP
- pairs with `POST /pair`
- opens a WebSocket and shows live connection state

## Run

Install dependencies, then start Expo from this directory.

```bash
npm install
npm run start
```

## Android Dev Build

Expo Go is no longer enough for the realtime audio direction of this app. Use an Android development build instead.

Local Android workflow:

```bash
bun run mobile:prebuild:android
bun run mobile:android:device
```

Notes:

1. The first install usually requires USB debugging over a cable.
2. After the dev build is installed, Metro still runs with `bun run mobile:start`.
3. The generated `android/` directory is intentionally ignored and can be recreated with prebuild.

## Pair with the local bridge

1. Start the bridge from the repo root with `bun run cli:start -- --tunnel`
2. Run Expo and open the app in Expo Go
3. On the Mac, run `bun run cli:pair`
4. In the app, tap `Scan CLI QR` and scan the terminal QR
