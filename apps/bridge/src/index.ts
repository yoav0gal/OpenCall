import type { ServerWebSocket } from "bun";
import QRCode from "qrcode";
import { z } from "zod";

import { config } from "./config";
import { getGeminiStatus } from "./gemini";
import { createLiveKitToken } from "./livekit";
import {
  addPairedDevice,
  clearExpiredPairingSession,
  getPairingSession,
  listPairedDevices,
  setPairingSession
} from "./store";

const pairBodySchema = z.object({
  pairingToken: z.string().min(1),
  deviceName: z.string().min(1),
  devicePublicKey: z.string().min(1).optional()
});

const livekitTokenSchema = z.object({
  deviceId: z.string().min(1),
  participantName: z.string().min(1)
});

const clients = new Set<ServerWebSocket<unknown>>();
const bridgeId = `bridge_${crypto.randomUUID()}`;
const bridgePublicKey = crypto.randomUUID().replaceAll("-", "");

function createPairingPayload() {
  const pairingToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const publicUrl = config.OPENCALL_PUBLIC_URL.replace(/\/$/, "");

  const payload = {
    version: 1,
    bridgeId,
    bridgeName: config.OPENCALL_BRIDGE_NAME,
    bridgeBaseUrl: publicUrl,
    bridgeWsUrl: `${publicUrl.replace(/^http/, "ws")}/ws`,
    bridgePublicKey,
    pairingToken,
    tokenExpiresAt: expiresAt
  };

  setPairingSession({
    token: pairingToken,
    bridgeId,
    bridgeName: config.OPENCALL_BRIDGE_NAME,
    bridgeBaseUrl: payload.bridgeBaseUrl,
    bridgeWsUrl: payload.bridgeWsUrl,
    bridgePublicKey,
    expiresAt
  });

  return payload;
}

async function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": config.OPENCALL_ALLOWED_ORIGIN,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      ...(init?.headers ?? {})
    }
  });
}

function broadcast(message: unknown) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    client.send(payload);
  }
}

const server = Bun.serve({
  port: config.PORT,
  fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/ws" || url.pathname === "/realtime") {
      const success = serverInstance.upgrade(req);
      return success ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/health" && req.method === "GET") {
      clearExpiredPairingSession();

      return jsonResponse({
              ok: true,
              bridgeId,
              bridgeName: config.OPENCALL_BRIDGE_NAME,
              status: "ok",
              publicUrl: config.OPENCALL_PUBLIC_URL,
              livekitUrl: config.LIVEKIT_URL,
              pairedDevices: listPairedDevices(),
        websocketClients: clients.size
      });
    }

    if (url.pathname === "/pairing" && req.method === "GET") {
      clearExpiredPairingSession();

      const payload = createPairingPayload();
      return QRCode.toDataURL(JSON.stringify(payload)).then((qrCodeDataUrl) =>
        jsonResponse({
          ...payload,
          qrCodeDataUrl
        })
      );
    }

    if (url.pathname === "/pair" && req.method === "POST") {
      return req
        .json()
        .then((body) => pairBodySchema.parse(body))
        .then((body) => {
          clearExpiredPairingSession();
          const session = getPairingSession();

          if (!session || session.token !== body.pairingToken) {
            return jsonResponse(
              {
                ok: false,
                error: "Invalid or expired pairing token"
              },
              { status: 400 }
            );
          }

          const deviceId = `device_${crypto.randomUUID()}`;
          const pairedAt = new Date().toISOString();

          addPairedDevice({
            id: deviceId,
            deviceName: body.deviceName,
            publicKey: body.devicePublicKey ?? `device-pub-${crypto.randomUUID()}`,
            pairedAt
          });

          broadcast({
            type: "pairing.confirmed",
            deviceId,
            deviceName: body.deviceName,
            pairedAt
          });

          return jsonResponse({
            ok: true,
            bridgeId,
            deviceId,
            sessionToken: crypto.randomUUID(),
            pairedAt,
            wsUrl: `${config.OPENCALL_PUBLIC_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws`,
            livekit: {
              url: config.LIVEKIT_URL
            }
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Invalid request body"
            },
            { status: 400 }
          )
        );
    }

    if (url.pathname === "/livekit/token" && req.method === "POST") {
      return req
        .json()
        .then((body) => livekitTokenSchema.parse(body))
        .then((body) => createLiveKitToken(body.deviceId, body.participantName))
        .then((token) =>
          jsonResponse({
            ok: true,
            ...token
          })
        )
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not create LiveKit token"
            },
            { status: 400 }
          )
        );
    }

    if (url.pathname === "/gemini/status" && req.method === "GET") {
      return getGeminiStatus().then((status) => jsonResponse(status));
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(
        JSON.stringify({
          type: "ack",
          bridgeId,
          message: "connected"
        })
      );
    },
    message(ws, message) {
      try {
        const parsed = JSON.parse(String(message)) as { type?: string };

        if (parsed.type === "hello") {
          ws.send(
            JSON.stringify({
              type: "ack",
              bridgeId,
              clients: clients.size
            })
          );
          return;
        }
      } catch {
        // Ignore malformed JSON; the caller will just receive a generic error.
      }

      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unsupported websocket message"
        })
      );
    },
    close(ws) {
      clients.delete(ws);
    }
  }
});

console.log(`OpenCall bridge listening on ${server.url}`);
