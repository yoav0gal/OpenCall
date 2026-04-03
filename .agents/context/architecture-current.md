# Current Architecture Notes

## Current Assumptions

- The mobile client will be built with Expo.
- Gemini Live will be used early for low-latency voice.
- OpenClaw is expected to remain the "brain" later.
- A machine-local bridge process will run continuously.
- The first spike should prefer direct phone-to-machine connectivity over a
  custom cloud control plane.

## Current System Shape

### Mobile App

Responsibilities:

- scan a pairing QR code
- store bridge identity and endpoint
- connect to the bridge
- start and join a call
- show basic call state

### Bridge Process

Runs on the same machine as the future agent runtime.

Responsibilities:

- generate pairing QR codes
- store paired device records
- expose HTTP and WebSocket endpoints
- manage call lifecycle
- terminate or proxy the voice session
- own Gemini Live integration
- later forward structured turns into OpenClaw

### OpenClaw Integration

OpenClaw is not the first implementation target, but the bridge should be
designed with a narrow local adapter seam for:

- getting current context
- handling a voice turn
- recording a call summary

## Networking Reality

Important engineering constraint:

- direct pairing is easy
- direct internet-grade reachability is harder

A direct phone-to-machine prototype is realistic on:

- same LAN
- Tailscale
- controlled local development setup

It may require more infrastructure later for:

- NAT traversal
- internet-wide reliability
- background incoming calls on mobile

## Realtime Direction

For the earliest spike, prefer simpler direct realtime audio over introducing a
full self-hosted LiveKit deployment immediately.

Planned sequence:

1. direct signaling and direct call setup
2. direct audio call
3. Gemini Live in the bridge
4. OpenClaw context bridge
5. stronger networking and mobile call semantics later
