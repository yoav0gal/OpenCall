import { z } from "zod";

export const pairBodySchema = z.object({
  pairingToken: z.string().min(1),
  deviceName: z.string().min(1),
  devicePublicKey: z.string().min(1).optional()
});

export const livekitTokenSchema = z.object({
  deviceId: z.string().min(1),
  participantName: z.string().min(1)
});

export const createCallBodySchema = z.object({
  sessionToken: z.string().min(1)
});

export const updateCallBodySchema = z.object({
  sessionToken: z.string().min(1)
});
