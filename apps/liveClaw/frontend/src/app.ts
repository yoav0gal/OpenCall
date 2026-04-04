import { LiveClawClient } from "./client.ts";
import {
  appendDiagnostic,
  appendTranscript,
  renderError,
  setChipText,
  setControlsState,
} from "./ui.ts";

export function bootstrapApp() {
  const remoteAudio = document.getElementById("remote-audio");
  const localVideo = document.getElementById("local-video");
  const displayName = document.getElementById("display-name");
  const textInput = document.getElementById("text-input");
  const connectButton = document.getElementById("connect-btn");
  const disconnectButton = document.getElementById("disconnect-btn");
  const micButton = document.getElementById("mic-btn");
  const cameraButton = document.getElementById("camera-btn");
  const sendButton = document.getElementById("send-btn");

  let micEnabled = true;
  let cameraEnabled = false;
  let remoteStreamId = null;

  const client = new LiveClawClient({
    onSession(session) {
      setChipText("session-chip", `session: ${session.session_id}`);
      for (const diagnostic of session.diagnostics || []) {
        appendDiagnostic(diagnostic);
      }
      for (const transcript of session.transcripts || []) {
        appendTranscript(transcript);
      }
      setChipText(
        "connection-chip",
        session.reused ? "reconnecting" : "connecting",
        "chip-warn"
      );
    },
    onState(state) {
      const variant = state === "connected" ? "chip-ok" : state === "failed" ? "chip-danger" : "chip-warn";
      setChipText("transport-chip", `transport: ${state}`, variant);
      if (state === "connected") {
        setChipText("connection-chip", "connected", "chip-ok");
      } else if (state === "failed") {
        setChipText("connection-chip", "failed", "chip-danger");
      }
    },
    onLocalStream(stream) {
      localVideo.srcObject = stream;
    },
    onRemoteStream(stream) {
      if (!stream) {
        return;
      }
      if (remoteStreamId === stream.id && remoteAudio.srcObject === stream) {
        return;
      }
      remoteStreamId = stream.id;
      remoteAudio.srcObject = stream;
      const playPromise = remoteAudio.play?.();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (error?.name === "AbortError") {
            appendDiagnostic({ event: "audio.playback.retry", detail: "stream replaced during play()" });
            return;
          }
          appendDiagnostic({ event: "audio.playback.error", detail: String(error) });
        });
      }
    },
    onTranscript(entry) {
      appendTranscript(entry);
    },
    onDiagnostic(entry) {
      appendDiagnostic(entry);
    },
  });

  connectButton.addEventListener("click", async () => {
    try {
      await client.connect(displayName.value);
      micEnabled = true;
      cameraEnabled = false;
      micButton.textContent = "Mute mic";
      cameraButton.textContent = "Enable camera";
      setControlsState(true);
    } catch (error) {
      renderError(error);
    }
  });

  disconnectButton.addEventListener("click", async () => {
    await client.disconnect();
    setControlsState(false);
    setChipText("connection-chip", "idle");
    setChipText("transport-chip", "transport: idle", "chip-muted");
  });

  micButton.addEventListener("click", () => {
    micEnabled = !micEnabled;
    client.toggleMic(micEnabled);
    micButton.textContent = micEnabled ? "Mute mic" : "Unmute mic";
  });

  cameraButton.addEventListener("click", async () => {
    cameraEnabled = !cameraEnabled;
    try {
      await client.toggleCamera(cameraEnabled);
      cameraButton.textContent = cameraEnabled ? "Hide camera" : "Enable camera";
    } catch (error) {
      cameraEnabled = !cameraEnabled;
      renderError(error);
    }
  });

  sendButton.addEventListener("click", async () => {
    const text = textInput.value.trim();
    if (!text) return;
    try {
      await client.sendText(text);
      appendTranscript({ role: "user", text, timestamp: new Date().toISOString() });
      textInput.value = "";
    } catch (error) {
      renderError(error);
    }
  });

  setControlsState(false);
}
