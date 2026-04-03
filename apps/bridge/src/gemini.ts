import { GoogleGenAI, Modality } from "@google/genai";

import { config } from "./config";

function getClient() {
  if (!config.GEMINI_API_KEY) {
    return null;
  }

  return new GoogleGenAI({
    apiKey: config.GEMINI_API_KEY,
    apiVersion: "v1alpha"
  });
}

export async function getGeminiStatus() {
  const client = getClient();

  if (!client) {
    return {
      configured: false,
      model: config.GEMINI_MODEL
    };
  }

  try {
    const now = new Date();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: config.GEMINI_MODEL,
          config: {
            responseModalities: [Modality.AUDIO]
          }
        }
      }
    });

    return {
      configured: true,
      model: config.GEMINI_MODEL,
      ephemeralTokenCreated: Boolean(token.name)
    };
  } catch (error) {
    return {
      configured: true,
      model: config.GEMINI_MODEL,
      ephemeralTokenCreated: false,
      error: error instanceof Error ? error.message : "Unknown Gemini error"
    };
  }
}
