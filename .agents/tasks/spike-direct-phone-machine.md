# Spike: Direct Phone-to-Machine Prototype

## Goal

Prove that a phone can pair directly with a machine-local OpenCall bridge and
start a live voice session.

## Success Criteria

- a bridge process runs continuously on a machine
- it generates a QR code payload for pairing
- the Expo app scans and stores the pairing information
- the app can connect back to the bridge
- the app can start a call
- a live audio path is established
- Gemini Live runs inside the bridge

## Scope For This Spike

In scope:

- one phone
- one machine
- one paired relationship
- direct bridge connection
- foreground call flow
- transcript/debug output

Out of scope:

- production auth
- full NAT-hardening
- push notifications
- background ringing
- multi-user design
- generic agent framework extraction

## Suggested Build Order

1. shared protocol package
2. bridge HTTP/WS skeleton
3. pairing token and QR payload generation
4. Expo QR scanning flow
5. paired device persistence
6. direct call signaling
7. live audio path
8. Gemini Live session manager
9. mock OpenClaw adapter

## Open Questions

- Should the first audio path use raw WebRTC directly or a simpler temporary
  transport just to validate pairing and call state?
- What is the cleanest reachable endpoint setup for local development:
  LAN IP, Tailscale hostname, or localhost tunneling?
- How much of the Gemini Live behavior should be hidden behind an interface from
  day one?
