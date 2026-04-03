# Project Overview

## What OpenCall Is

OpenCall is a system that lets a human and an AI agent call each other.

The initial mental model is:

- the user has an OpenCall app on their phone
- an AI agent runs on a machine
- the user pairs the phone with that machine
- the phone and machine can start a live voice session
- the AI agent uses the machine's local runtime and context while Gemini Live
  provides a fast voice interface

## Current Product Direction

The project is intentionally starting as a focused prototype, not a generic
framework.

The first concrete target is:

- one phone
- one machine
- one paired relationship
- one always-on bridge process on the machine
- direct connection where feasible
- local-network or Tailscale-friendly development first

## Important Non-Goals For Now

- no multi-user product design
- no web client
- no marketplace or agent plugin ecosystem
- no production auth system
- no guaranteed background incoming calls in the first spike
- no requirement to self-host all possible infrastructure on day one

## Why This Shape

The bridge process is the key architectural decision.

It exists so OpenClaw or any later agent runtime does not need to directly own:

- mobile-facing networking
- pairing lifecycle
- call signaling
- realtime media/session coordination
- Gemini Live connection management
- transcript persistence

That separation keeps the agent runtime focused on reasoning and actions.
