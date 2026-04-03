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

const pairedDevices = new Map<string, PairedDevice>();

let currentPairingSession: PairingSession | null = null;

export function setPairingSession(session: PairingSession) {
  currentPairingSession = session;
}

export function getPairingSession() {
  return currentPairingSession;
}

export function clearExpiredPairingSession(now = Date.now()) {
  if (!currentPairingSession) {
    return;
  }

  if (Date.parse(currentPairingSession.expiresAt) <= now) {
    currentPairingSession = null;
  }
}

export function addPairedDevice(device: PairedDevice) {
  pairedDevices.set(device.id, device);
}

export function listPairedDevices() {
  return Array.from(pairedDevices.values());
}
