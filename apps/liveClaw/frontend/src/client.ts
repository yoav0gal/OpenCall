async function waitForIceGathering(pc) {
  if (pc.iceGatheringState === "complete") {
    return;
  }

  await new Promise((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve(undefined);
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

export class LiveClawClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.sessionId = localStorage.getItem("liveclaw-session-id");
    this.pc = null;
    this.channel = null;
    this.localStream = null;
    this.videoTrack = null;
    this.videoSender = null;
  }

  async getConfig() {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("Could not load client config");
    }
    return response.json();
  }

  async connect(displayName) {
    const startResponse = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        session_id: this.sessionId || undefined,
      }),
    });

    if (!startResponse.ok) {
      throw new Error("Could not start session");
    }

    const session = await startResponse.json();
    this.sessionId = session.session_id;
    localStorage.setItem("liveclaw-session-id", this.sessionId);
    this.handlers.onSession?.(session);

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.handlers.onLocalStream?.(this.localStream);

    this.pc = new RTCPeerConnection({ iceServers: session.ice_servers });
    this.channel = this.pc.createDataChannel("liveclaw");

    this.channel.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "transcript") {
        this.handlers.onTranscript?.(payload);
      } else {
        this.handlers.onDiagnostic?.(payload);
      }
    });

    this.pc.addEventListener("connectionstatechange", () => {
      this.handlers.onState?.(this.pc.connectionState);
    });

    this.pc.addEventListener("track", (event) => {
      const [stream] = event.streams;
      this.handlers.onRemoteStream?.(stream);
    });

    for (const track of this.localStream.getAudioTracks()) {
      this.pc.addTrack(track, this.localStream);
    }

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc);

    const answerResponse = await fetch(session.offer_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: this.pc.localDescription.sdp,
        type: this.pc.localDescription.type,
        pc_id: this.pc.__liveclawPcId || undefined,
      }),
    });

    if (!answerResponse.ok) {
      throw new Error("Could not complete WebRTC signaling");
    }

    const answer = await answerResponse.json();
    this.pc.__liveclawPcId = answer.pc_id;
    await this.pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
    return session;
  }

  async disconnect() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
    this.videoTrack = null;
    this.videoSender = null;
    if (this.sessionId) {
      await fetch("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: this.sessionId }),
      }).catch(() => undefined);
    }
  }

  async sendText(text) {
    if (!this.sessionId) {
      throw new Error("No active session");
    }
    const response = await fetch("/api/session/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: this.sessionId, text }),
    });
    if (!response.ok) {
      throw new Error("Could not send message");
    }
  }

  toggleMic(enabled) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  async toggleCamera(enabled) {
    if (!this.pc || !this.localStream) {
      return;
    }

    if (enabled && !this.videoTrack) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.videoTrack = videoStream.getVideoTracks()[0] ?? null;
      if (this.videoTrack) {
        this.localStream.addTrack(this.videoTrack);
        this.videoSender = this.pc.addTrack(this.videoTrack, this.localStream);
        this.handlers.onLocalStream?.(this.localStream);
        await this.renegotiate();
      }
    }

    if (this.videoTrack) {
      this.videoTrack.enabled = enabled;
    }
    this.sendTrackStatus(enabled);
  }

  async renegotiate() {
    if (!this.pc || !this.sessionId) {
      return;
    }

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc);

    const response = await fetch(`/api/session/${this.sessionId}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: this.pc.localDescription.sdp,
        type: this.pc.localDescription.type,
        pc_id: this.pc.__liveclawPcId || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error("Could not renegotiate WebRTC session");
    }

    const answer = await response.json();
    this.pc.__liveclawPcId = answer.pc_id;
    await this.pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
  }

  sendTrackStatus(enabled) {
    if (!this.channel || this.channel.readyState !== "open") {
      return;
    }
    this.channel.send(
      JSON.stringify({
        type: "signalling",
        message: { type: "trackStatus", receiver_index: 1, enabled },
      })
    );
  }
}
