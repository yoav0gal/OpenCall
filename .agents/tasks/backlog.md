# Backlog

## Current Priority Order

### 1. Repository bootstrap

Create the first monorepo or workspace skeleton:

- `apps/mobile`
- `apps/bridge-openclaw`
- `packages/protocol`
- `docs/`

### 2. Protocol definitions

Define shared schemas for:

- QR pairing payload
- paired device record
- bridge status response
- call lifecycle events
- websocket event messages

### 3. Bridge skeleton

Build an always-on bridge service that can:

- load config
- start an HTTP server
- start a WebSocket server
- generate a pairing token
- render or output QR data
- persist paired device records locally

### 4. Mobile pairing flow

Expo app should:

- scan QR
- parse payload
- complete pairing with the bridge
- persist bridge connection info
- show paired state

### 5. Direct call prototype

Implement the first end-to-end call flow:

- user taps call in the app
- bridge accepts
- both sides enter a live session

### 6. Gemini Live bridge

Add bridge-side voice intelligence integration:

- start Gemini Live session
- relay user voice/transcript
- stream Gemini output back
- log transcript

### 7. OpenClaw adapter seam

Create a minimal integration contract:

- `getCurrentContext`
- `handleVoiceTurn`
- `recordCallSummary`

Use a mock implementation until the real OpenClaw integration path is known.

## Nice-To-Have Later

- multi-agent pairing
- inbound call flow from the machine to the phone
- push notifications
- background incoming call UX
- TURN/STUN strategy
- LiveKit evaluation or migration
