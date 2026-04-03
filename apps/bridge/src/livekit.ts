import { AccessToken } from "livekit-server-sdk";

import { config } from "./config";

export function buildRoomName(deviceId: string) {
  return `${config.LIVEKIT_ROOM_PREFIX}-${deviceId}`;
}

export async function createLiveKitToken(deviceId: string, participantName: string) {
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: deviceId,
    name: participantName
  });

  token.addGrant({
    roomJoin: true,
    room: buildRoomName(deviceId),
    canPublish: true,
    canSubscribe: true
  });

  return {
    url: config.LIVEKIT_URL,
    roomName: buildRoomName(deviceId),
    token: await token.toJwt()
  };
}
