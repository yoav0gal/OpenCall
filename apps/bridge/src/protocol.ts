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

export const geminiTokenBodySchema = z.object({
  sessionToken: z.string().min(1)
});

export const geminiVoiceTurnQuerySchema = z.object({
  sessionToken: z.string().min(1)
});

export const geminiLiveTurnBodySchema = z.object({
  sessionToken: z.string().min(1),
  prompt: z.string().min(1)
});

export const clientLogBodySchema = z.object({
  sessionToken: z.string().min(1).optional(),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  source: z.string().min(1),
  message: z.string().min(1),
  context: z.unknown().optional()
});
