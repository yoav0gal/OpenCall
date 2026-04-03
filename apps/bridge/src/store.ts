import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type PairedDevice = {
  id: string;
  deviceName: string;
  publicKey: string;
  pairedAt: string;
};

export type PairingSession = {
  token: string;
  bridgeId: string;
  bridgeName: string;
  bridgeBaseUrl: string;
  bridgeWsUrl: string;
  bridgePublicKey: string;
  expiresAt: string;
};

type BridgeIdentity = {
  bridgeId: string;
  bridgePublicKey: string;
  createdAt: string;
};

type StoreFile = {
  identity: BridgeIdentity;
  pairingSession: PairingSession | null;
  pairedDevices: PairedDevice[];
};

const opencallHome = process.env.OPENCALL_HOME || join(homedir(), ".opencall");
const storePath = process.env.OPENCALL_STORE_PATH || join(opencallHome, "bridge-store.json");

function ensureStoreDir() {
  mkdirSync(dirname(storePath), { recursive: true });
}

function createInitialStore(): StoreFile {
  return {
    identity: {
      bridgeId: `bridge_${crypto.randomUUID()}`,
      bridgePublicKey: crypto.randomUUID().replaceAll("-", ""),
      createdAt: new Date().toISOString()
    },
    pairingSession: null,
    pairedDevices: []
  };
}

function readStore(): StoreFile {
  ensureStoreDir();

  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;

    if (!parsed.identity?.bridgeId || !parsed.identity?.bridgePublicKey) {
      throw new Error("Store identity missing");
    }

    return {
      identity: parsed.identity,
      pairingSession: parsed.pairingSession ?? null,
      pairedDevices: parsed.pairedDevices ?? []
    };
  } catch {
    const initialStore = createInitialStore();
    writeStore(initialStore);
    return initialStore;
  }
}

function writeStore(store: StoreFile) {
  ensureStoreDir();
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function getStorePath() {
  return storePath;
}

export function getBridgeIdentity(): BridgeIdentity {
  return readStore().identity;
}

export function setPairingSession(session: PairingSession) {
  const store = readStore();
  store.pairingSession = session;
  writeStore(store);
}

export function getPairingSession() {
  return readStore().pairingSession;
}

export function clearExpiredPairingSession(now = Date.now()) {
  const store = readStore();

  if (!store.pairingSession) {
    return;
  }

  if (Date.parse(store.pairingSession.expiresAt) <= now) {
    store.pairingSession = null;
    writeStore(store);
  }
}

export function addPairedDevice(device: PairedDevice) {
  const store = readStore();
  store.pairedDevices = [
    ...store.pairedDevices.filter((existing) => existing.id !== device.id),
    device
  ];
  writeStore(store);
}

export function listPairedDevices() {
  return readStore().pairedDevices;
}
