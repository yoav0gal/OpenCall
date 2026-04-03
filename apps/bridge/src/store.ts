import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { config } from "./config";

const bridgeIdentitySchema = z.object({
  bridgeId: z.string(),
  bridgePublicKey: z.string(),
  createdAt: z.string()
});

const pairedDeviceSchema = z.object({
  id: z.string(),
  deviceName: z.string(),
  publicKey: z.string(),
  pairedAt: z.string(),
  lastSeenAt: z.string().nullable().default(null),
  sessionToken: z.string()
});

const pairingSessionSchema = z.object({
  token: z.string(),
  bridgeId: z.string(),
  bridgeName: z.string(),
  bridgeBaseUrl: z.string(),
  bridgeWsUrl: z.string(),
  bridgePublicKey: z.string(),
  expiresAt: z.string()
});

const callRecordSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  roomName: z.string(),
  status: z.enum(["ringing", "active", "ended"]),
  createdAt: z.string(),
  answeredAt: z.string().nullable().default(null),
  endedAt: z.string().nullable().default(null)
});

const persistedStateSchema = z.object({
  identity: bridgeIdentitySchema.default({
    bridgeId: `bridge_${crypto.randomUUID()}`,
    bridgePublicKey: crypto.randomUUID().replaceAll("-", ""),
    createdAt: new Date().toISOString()
  }),
  pairedDevices: z.array(pairedDeviceSchema).default([]),
  currentPairingSession: pairingSessionSchema.nullable().default(null),
  activeCall: callRecordSchema.nullable().default(null),
  recentCalls: z.array(callRecordSchema).default([])
});

export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type PairingSession = z.infer<typeof pairingSessionSchema>;
export type CallRecord = z.infer<typeof callRecordSchema>;
export type BridgeIdentity = z.infer<typeof bridgeIdentitySchema>;

type PersistedState = z.infer<typeof persistedStateSchema>;

const stateFilePath = join(config.OPENCALL_DATA_DIR, "bridge-state.json");

mkdirSync(dirname(stateFilePath), { recursive: true });

function loadState() {
  try {
    return persistedStateSchema.parse(JSON.parse(readFileSync(stateFilePath, "utf8")));
  } catch {
    return persistedStateSchema.parse({});
  }
}

let state: PersistedState = loadState();

async function persistState() {
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2), "utf8");
}

export async function setPairingSession(session: PairingSession) {
  state.currentPairingSession = session;
  await persistState();
}

export function getPairingSession() {
  return state.currentPairingSession;
}

export async function clearExpiredPairingSession(now = Date.now()) {
  if (!state.currentPairingSession) {
    return;
  }

  if (Date.parse(state.currentPairingSession.expiresAt) <= now) {
    state.currentPairingSession = null;
    await persistState();
  }
}

export async function addPairedDevice(device: PairedDevice) {
  const existingIndex = state.pairedDevices.findIndex((entry) => entry.id === device.id);

  if (existingIndex >= 0) {
    state.pairedDevices[existingIndex] = device;
  } else {
    state.pairedDevices.push(device);
  }

  await persistState();
}

export function listPairedDevices() {
  return state.pairedDevices;
}

export function getPairedDeviceBySessionToken(sessionToken: string) {
  return state.pairedDevices.find((device) => device.sessionToken === sessionToken) ?? null;
}

export async function markDeviceSeen(deviceId: string, lastSeenAt = new Date().toISOString()) {
  const device = state.pairedDevices.find((entry) => entry.id === deviceId);

  if (!device) {
    return;
  }

  device.lastSeenAt = lastSeenAt;
  await persistState();
}

export async function setActiveCall(call: CallRecord | null) {
  state.activeCall = call;
  await persistState();
}

export function getActiveCall() {
  return state.activeCall;
}

export async function updateActiveCallStatus(
  status: CallRecord["status"],
  timestamps?: Partial<Pick<CallRecord, "answeredAt" | "endedAt">>
) {
  if (!state.activeCall) {
    return null;
  }

  state.activeCall.status = status;
  state.activeCall.answeredAt = timestamps?.answeredAt ?? state.activeCall.answeredAt;
  state.activeCall.endedAt = timestamps?.endedAt ?? state.activeCall.endedAt;

  await persistState();
  return state.activeCall;
}

export async function archiveActiveCall() {
  if (!state.activeCall) {
    return null;
  }

  const archived = state.activeCall;
  state.recentCalls = [archived, ...state.recentCalls].slice(0, 25);
  state.activeCall = null;
  await persistState();
  return archived;
}

export function listRecentCalls() {
  return state.recentCalls;
}

export function getBridgeIdentity() {
  return state.identity;
}

export function getStorePath() {
  return stateFilePath;
}
