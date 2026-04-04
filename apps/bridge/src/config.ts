import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().default(8787),
  OPENCALL_BRIDGE_NAME: z.string().default("OpenCall Bridge"),
  OPENCALL_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  OPENCALL_ALLOWED_ORIGIN: z.string().default("*"),
  OPENCALL_HOME: z.string().default("."),
  OPENCALL_DATA_DIR: z.string().default("./data"),
  LIVEKIT_URL: z.string().default("ws://127.0.0.1:7880"),
  LIVEKIT_API_KEY: z.string().default("devkey"),
  LIVEKIT_API_SECRET: z.string().default("secret"),
  LIVEKIT_ROOM_PREFIX: z.string().default("opencall"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-live-preview")
});

export type AppConfig = z.infer<typeof configSchema>;

export const config = configSchema.parse(process.env);
