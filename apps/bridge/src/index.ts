import type { ServerWebSocket } from "bun";
import QRCode from "qrcode";

import { config } from "./config";
import { createGeminiLiveToken, getGeminiStatus, runGeminiLiveTextTurn, runGeminiVoiceTurn } from "./gemini";
import { buildRoomName, createLiveKitToken } from "./livekit";
import {
  clientLogBodySchema,
  createCallBodySchema,
  geminiLiveTurnBodySchema,
  geminiTokenBodySchema,
  geminiVoiceTurnQuerySchema,
  livekitTokenSchema,
  pairBodySchema,
  updateCallBodySchema
} from "./protocol";
import {
  addPairedDevice,
  addClientLogEntry,
  archiveActiveCall,
  clearExpiredPairingSession,
  getActiveCall,
  getBridgeIdentity,
  getPairedDeviceBySessionToken,
  getPairingSession,
  getStorePath,
  listClientLogEntries,
  listPairedDevices,
  listRecentCalls,
  markDeviceSeen,
  setActiveCall,
  setPairingSession,
  updateActiveCallStatus
} from "./store";

type ClientData = {
  sessionToken: string | null;
  deviceId: string | null;
};

const clients = new Set<ServerWebSocket<ClientData>>();
const bridgeIdentity = getBridgeIdentity();
const bridgeId = bridgeIdentity.bridgeId;
const bridgePublicKey = bridgeIdentity.bridgePublicKey;
const publicBasePath = (() => {
  const pathname = new URL(config.OPENCALL_PUBLIC_URL).pathname.replace(/\/$/, "");
  return pathname === "/" ? "" : pathname;
})();

function getRoutePath(pathname: string) {
  if (!publicBasePath) {
    return pathname;
  }

  if (pathname === publicBasePath) {
    return "/";
  }

  if (pathname.startsWith(`${publicBasePath}/`)) {
    return pathname.slice(publicBasePath.length) || "/";
  }

  return pathname;
}

function createPairingPayload() {
  const pairingToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const publicUrl = config.OPENCALL_PUBLIC_URL.replace(/\/$/, "");

  const payload = {
    version: 1,
    bridgeId,
    bridgeName: config.OPENCALL_BRIDGE_NAME,
    bridgeBaseUrl: publicUrl,
    bridgeWsUrl: `${publicUrl.replace(/^http/, "ws")}/realtime`,
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

function websocketUrl() {
  return `${config.OPENCALL_PUBLIC_URL.replace(/^http/, "ws").replace(/\/$/, "")}/realtime`;
}

function logServerEvent(event: string, details?: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...details
    })
  );
}

function unauthorizedResponse() {
  return jsonResponse(
    {
      ok: false,
      error: "Invalid session token"
    },
    { status: 401 }
  );
}

const server = Bun.serve<ClientData>({
  port: config.PORT,
  fetch(req, serverInstance) {
    const url = new URL(req.url);
    const routePath = getRoutePath(url.pathname);

    if (req.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    if (routePath === "/ws" || routePath === "/realtime") {
      const sessionToken = url.searchParams.get("sessionToken");
      const device = sessionToken ? getPairedDeviceBySessionToken(sessionToken) : null;

      const success = serverInstance.upgrade(req, {
        data: {
          sessionToken,
          deviceId: device?.id ?? null
        }
      });

      return success ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (routePath === "/health" && req.method === "GET") {
      return Promise.resolve(clearExpiredPairingSession()).then(() =>
        jsonResponse({
          ok: true,
          bridgeId,
          bridgeName: config.OPENCALL_BRIDGE_NAME,
          status: "ok",
          publicUrl: config.OPENCALL_PUBLIC_URL,
          livekitUrl: config.LIVEKIT_URL,
          pairedDevices: listPairedDevices(),
          websocketClients: clients.size,
          activeCall: getActiveCall(),
          recentCalls: listRecentCalls(),
          recentClientLogs: listClientLogEntries(),
          storePath: getStorePath()
        })
      );
    }

    if (routePath === "/logs/client" && req.method === "GET") {
      return jsonResponse({
        ok: true,
        logs: listClientLogEntries()
      });
    }

    if (routePath === "/logs/client" && req.method === "POST") {
      return req
        .json()
        .then((body) => clientLogBodySchema.parse(body))
        .then(async (body) => {
          const device = body.sessionToken ? getPairedDeviceBySessionToken(body.sessionToken) : null;
          const entry = {
            id: `clientlog_${crypto.randomUUID()}`,
            level: body.level,
            source: body.source,
            message: body.message,
            createdAt: new Date().toISOString(),
            bridgeId,
            deviceId: device?.id ?? null,
            deviceName: device?.deviceName ?? null,
            sessionToken: body.sessionToken ?? null,
            context: body.context
          } as const;

          await addClientLogEntry(entry);
          logServerEvent("client.log", {
            level: entry.level,
            source: entry.source,
            deviceId: entry.deviceId,
            message: entry.message
          });

          return jsonResponse({
            ok: true,
            entry
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not store client log"
            },
            { status: 400 }
          )
        );
    }

    if (routePath === "/devices" && req.method === "GET") {
      return jsonResponse({
        ok: true,
        devices: listPairedDevices()
      });
    }

    if (routePath === "/pairing" && req.method === "GET") {
      return Promise.resolve(clearExpiredPairingSession()).then(() => {
        const payload = createPairingPayload();
        return QRCode.toDataURL(JSON.stringify(payload)).then((qrCodeDataUrl) =>
          jsonResponse({
            ...payload,
            qrCodeDataUrl
          })
        );
      });
    }

    if (routePath === "/pair" && req.method === "POST") {
      return req
        .json()
        .then((body) => pairBodySchema.parse(body))
        .then((body) => {
          return Promise.resolve(clearExpiredPairingSession()).then(async () => {
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
            const sessionToken = crypto.randomUUID();

            await addPairedDevice({
              id: deviceId,
              deviceName: body.deviceName,
              publicKey: body.devicePublicKey ?? `device-pub-${crypto.randomUUID()}`,
              pairedAt,
              lastSeenAt: pairedAt,
              sessionToken
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
              sessionToken,
              pairedAt,
              wsUrl: websocketUrl(),
              livekit: {
                url: config.LIVEKIT_URL
              }
            });
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

    if (routePath === "/livekit/token" && req.method === "POST") {
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

    if (routePath === "/calls" && req.method === "POST") {
      return req
        .json()
        .then((body) => createCallBodySchema.parse(body))
        .then(async (body) => {
          const device = getPairedDeviceBySessionToken(body.sessionToken);

          if (!device) {
            return unauthorizedResponse();
          }

          if (getActiveCall()) {
            return jsonResponse(
              {
                ok: false,
                error: "A call is already active or ringing"
              },
              { status: 409 }
            );
          }

          const call = {
            id: `call_${crypto.randomUUID()}`,
            deviceId: device.id,
            roomName: buildRoomName(device.id),
            status: "ringing" as const,
            createdAt: new Date().toISOString(),
            answeredAt: null,
            endedAt: null
          };

          await setActiveCall(call);
          broadcast({
            type: "call.invite",
            callId: call.id,
            deviceId: call.deviceId,
            roomName: call.roomName,
            createdAt: call.createdAt
          });

          return jsonResponse({
            ok: true,
            call
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not create call"
            },
            { status: 400 }
          )
        );
    }

    if (routePath === "/calls/current" && req.method === "GET") {
      return jsonResponse({
        ok: true,
        call: getActiveCall()
      });
    }

    if (routePath === "/calls/current/accept" && req.method === "POST") {
      return req
        .json()
        .then((body) => updateCallBodySchema.parse(body))
        .then(async (body) => {
          const device = getPairedDeviceBySessionToken(body.sessionToken);

          if (!device) {
            return unauthorizedResponse();
          }

          const call = getActiveCall();
          if (!call || call.deviceId !== device.id) {
            return jsonResponse(
              {
                ok: false,
                error: "No active call for this device"
              },
              { status: 404 }
            );
          }

          const updated = await updateActiveCallStatus("active", {
            answeredAt: new Date().toISOString()
          });

          broadcast({
            type: "call.accepted",
            callId: updated?.id
          });

          return jsonResponse({
            ok: true,
            call: updated
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not accept call"
            },
            { status: 400 }
          )
        );
    }

    if (routePath === "/calls/current/end" && req.method === "POST") {
      return req
        .json()
        .then((body) => updateCallBodySchema.parse(body))
        .then(async (body) => {
          const device = getPairedDeviceBySessionToken(body.sessionToken);

          if (!device) {
            return unauthorizedResponse();
          }

          const call = getActiveCall();
          if (!call || call.deviceId !== device.id) {
            return jsonResponse(
              {
                ok: false,
                error: "No active call for this device"
              },
              { status: 404 }
            );
          }

          await updateActiveCallStatus("ended", {
            endedAt: new Date().toISOString()
          });
          const archived = await archiveActiveCall();

          broadcast({
            type: "call.ended",
            callId: archived?.id
          });

          return jsonResponse({
            ok: true,
            call: archived
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not end call"
            },
            { status: 400 }
          )
        );
    }

    if (routePath === "/gemini/status" && req.method === "GET") {
      return getGeminiStatus().then((status) => jsonResponse(status));
    }

    if (routePath === "/gemini/token" && req.method === "POST") {
      return req
        .json()
        .then((body) => geminiTokenBodySchema.parse(body))
        .then(async (body) => {
          const device = getPairedDeviceBySessionToken(body.sessionToken);

          if (!device) {
            return unauthorizedResponse();
          }

          const token = await createGeminiLiveToken();

          return jsonResponse({
            ok: true,
            deviceId: device.id,
            ...token
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not create Gemini token"
            },
            { status: 400 }
          )
        );
    }

    if (routePath === "/gemini/voice-turn" && req.method === "POST") {
      const parsedQuery = geminiVoiceTurnQuerySchema.safeParse({
        sessionToken: url.searchParams.get("sessionToken")
      });

      if (!parsedQuery.success) {
        return unauthorizedResponse();
      }

      const device = getPairedDeviceBySessionToken(parsedQuery.data.sessionToken);

      if (!device) {
        return unauthorizedResponse();
      }

      return req
        .formData()
        .then(async (form) => {
          const audio = form.get("audio");

          if (!(audio instanceof File)) {
            return jsonResponse(
              {
                ok: false,
                error: "Missing audio upload"
              },
              { status: 400 }
            );
          }

          const result = await runGeminiVoiceTurn(
            new Uint8Array(await audio.arrayBuffer()),
            audio.type || undefined,
            audio.name || undefined
          );

          logServerEvent("gemini.voice_turn.completed", {
            deviceId: device.id,
            transcript: result.transcript
          });

          return jsonResponse({
            ok: true,
            deviceId: device.id,
            ...result
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not process Gemini voice turn"
            },
            { status: 400 }
          )
        );
    }

    if (routePath === "/gemini/live-turn" && req.method === "POST") {
      return req
        .json()
        .then((body) => geminiLiveTurnBodySchema.parse(body))
        .then(async (body) => {
          const device = getPairedDeviceBySessionToken(body.sessionToken);

          if (!device) {
            return unauthorizedResponse();
          }

          const result = await runGeminiLiveTextTurn(body.prompt);
          logServerEvent("gemini.live_turn.completed", {
            deviceId: device.id,
            prompt: body.prompt,
            transcript: result.transcript
          });

          return jsonResponse({
            ok: true,
            deviceId: device.id,
            ...result
          });
        })
        .catch((error) =>
          jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Could not process Gemini Live turn"
            },
            { status: 400 }
          )
        );
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws: ServerWebSocket<ClientData>) {
      if (!ws.data?.sessionToken || !ws.data?.deviceId) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Missing or invalid session token"
          })
        );
        ws.close(4001, "Unauthorized");
        return;
      }

      clients.add(ws);
      void markDeviceSeen(ws.data.deviceId);
      logServerEvent("ws.open", {
        deviceId: ws.data.deviceId,
        clients: clients.size + 1
      });
      ws.send(
        JSON.stringify({
          type: "ack",
          bridgeId,
          deviceId: ws.data.deviceId,
          message: "connected"
        })
      );
    },
    message(ws: ServerWebSocket<ClientData>, message) {
      try {
        const parsed = JSON.parse(String(message)) as { type?: string };

        if (parsed.type === "hello") {
          if (ws.data?.deviceId) {
            void markDeviceSeen(ws.data.deviceId);
          }
          logServerEvent("ws.hello", {
            deviceId: ws.data?.deviceId,
            clients: clients.size
          });
          ws.send(
            JSON.stringify({
              type: "ack",
              bridgeId,
              deviceId: ws.data.deviceId,
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
    close(ws: ServerWebSocket<ClientData>) {
      clients.delete(ws);
      logServerEvent("ws.close", {
        deviceId: ws.data?.deviceId,
        clients: clients.size
      });
    }
  }
});

console.log(`OpenCall bridge listening on ${server.url}`);
