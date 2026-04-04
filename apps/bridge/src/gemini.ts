import { Blob } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import { GoogleGenAI, Modality } from "@google/genai";

import { config } from "./config";

const execFileAsync = promisify(execFile);

function getClient() {
  if (!config.GEMINI_API_KEY) {
    return null;
  }

  return new GoogleGenAI({
    apiKey: config.GEMINI_API_KEY,
    apiVersion: "v1alpha"
  });
}

function buildTokenConfig() {
  const now = new Date();
  const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + 60 * 1000).toISOString();
  const liveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {}
  };

  return {
    expireTime,
    newSessionExpireTime,
    liveConnectConfig,
    request: {
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: config.GEMINI_MODEL,
          config: liveConnectConfig
        }
      }
    }
  };
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
    const tokenConfig = buildTokenConfig();
    const token = await client.authTokens.create(tokenConfig.request);

    return {
      configured: true,
      model: config.GEMINI_MODEL,
      ephemeralTokenCreated: Boolean(token.name),
      liveConnectConfig: tokenConfig.liveConnectConfig
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

export async function createGeminiLiveToken() {
  const client = getClient();

  if (!client) {
    throw new Error("Gemini API key is not configured");
  }

  const tokenConfig = buildTokenConfig();
  const token = await client.authTokens.create(tokenConfig.request);

  if (!token.name) {
    throw new Error("Gemini did not return an ephemeral token");
  }

  return {
    token: token.name,
    model: config.GEMINI_MODEL,
    expireTime: tokenConfig.expireTime,
    newSessionExpireTime: tokenConfig.newSessionExpireTime,
    liveConnectConfig: tokenConfig.liveConnectConfig
  };
}

function createWavBytes(pcmBytes: Uint8Array, sampleRate: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * 2;

  const writeAscii = (position: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(position + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes.length, true);

  return Buffer.concat([Buffer.from(header), Buffer.from(pcmBytes)]);
}

function decodeBase64(base64: string) {
  return Buffer.from(base64.replace(/\s/g, ""), "base64");
}

function mimeToExtension(mimeType?: string, fileName?: string) {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";
  const normalizedFileName = fileName?.toLowerCase() ?? "";

  if (normalizedFileName.endsWith(".m4a")) {
    return ".m4a";
  }

  if (normalizedFileName.endsWith(".mp3")) {
    return ".mp3";
  }

  if (normalizedFileName.endsWith(".wav")) {
    return ".wav";
  }

  if (normalizedFileName.endsWith(".webm")) {
    return ".webm";
  }

  if (normalizedMimeType.includes("mp4") || normalizedMimeType.includes("m4a")) {
    return ".m4a";
  }

  if (normalizedMimeType.includes("mpeg")) {
    return ".mp3";
  }

  if (normalizedMimeType.includes("wav")) {
    return ".wav";
  }

  if (normalizedMimeType.includes("webm")) {
    return ".webm";
  }

  return ".m4a";
}

async function transcodeToPcm(inputBytes: Uint8Array, mimeType?: string, fileName?: string) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is not available for this bridge platform");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "opencall-gemini-"));
  const inputPath = join(tempDir, `input${mimeToExtension(mimeType, fileName)}`);
  const outputPath = join(tempDir, "output.pcm");

  try {
    await writeFile(inputPath, inputBytes);
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "1",
      "-ar",
      "16000",
      outputPath
    ]);

    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runGeminiVoiceTurn(inputBytes: Uint8Array, inputMimeType?: string, fileName?: string) {
  const client = getClient();

  if (!client) {
    throw new Error("Gemini API key is not configured");
  }

  const pcmBytes = await transcodeToPcm(inputBytes, inputMimeType, fileName);

  return new Promise<{
    transcript: string;
    audioBase64: string;
    audioMimeType: string;
    model: string;
  }>(async (resolve, reject) => {
    const outputChunks: Buffer[] = [];
    let transcript = "";
    let settled = false;

    const finish = (result: { transcript: string; audioBase64: string; audioMimeType: string; model: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    try {
      const session = await client.live.connect({
        model: config.GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen() {},
          onmessage(message) {
            const nextTranscript = message.serverContent?.outputTranscription?.text?.trim();
            if (nextTranscript) {
              transcript = nextTranscript;
            }

            const data = message.data;
            if (data) {
              outputChunks.push(decodeBase64(data));
            }

            if (message.serverContent?.turnComplete) {
              session.close();
              const audioBytes = createWavBytes(Buffer.concat(outputChunks), 24000);
              finish({
                transcript,
                audioBase64: audioBytes.toString("base64"),
                audioMimeType: "audio/wav",
                model: config.GEMINI_MODEL
              });
            }
          },
          onerror(event) {
            fail(new Error(event.message));
          },
          onclose(event) {
            if (!settled && event.code !== 1000) {
              fail(new Error(event.reason || `Gemini Live closed with code ${event.code}`));
            }
          }
        }
      });

      session.sendRealtimeInput({
        audio: new Blob([pcmBytes], { type: "audio/pcm;rate=16000" }) as never
      });
      session.sendRealtimeInput({ audioStreamEnd: true });
    } catch (error) {
      fail(error);
    }
  });
}

export async function runGeminiLiveTextTurn(prompt: string) {
  const client = getClient();

  if (!client) {
    throw new Error("Gemini API key is not configured");
  }

  return new Promise<{
    transcript: string;
    audioBase64: string;
    audioMimeType: string;
    model: string;
  }>(async (resolve, reject) => {
    const outputChunks: Buffer[] = [];
    let transcript = "";
    let settled = false;

    const finish = (result: { transcript: string; audioBase64: string; audioMimeType: string; model: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    try {
      const session = await client.live.connect({
        model: config.GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen() {},
          onmessage(message) {
            const outputText =
              message.serverContent?.outputTranscription?.text?.trim() || message.text?.trim() || "";

            if (outputText) {
              transcript = outputText;
            }

            if (message.data) {
              outputChunks.push(decodeBase64(message.data));
            }

            if (message.serverContent?.turnComplete) {
              session.close();
              const audioBytes = createWavBytes(Buffer.concat(outputChunks), 24000);
              finish({
                transcript,
                audioBase64: audioBytes.toString("base64"),
                audioMimeType: "audio/wav",
                model: config.GEMINI_MODEL
              });
            }
          },
          onerror(event) {
            fail(new Error(event.message));
          },
          onclose(event) {
            if (!settled && event.code !== 1000) {
              fail(new Error(event.reason || `Gemini Live closed with code ${event.code}`));
            }
          }
        }
      });

      session.sendRealtimeInput({
        text: prompt
      } as never);
    } catch (error) {
      fail(error);
    }
  });
}
