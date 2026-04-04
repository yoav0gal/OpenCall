import {
  createAudioPlayer,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { GoogleGenAI } from '@google/genai/dist/web/index.mjs';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from './components/AppButton';
import { EventLog } from './components/EventLog';
import { InfoRow } from './components/InfoRow';
import { SectionCard } from './components/SectionCard';
import { StatusPill } from './components/StatusPill';

type PairResponse = {
  sessionToken: string;
  bridgeId: string;
  deviceId: string;
};

type LogEntry = {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
};

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type PairingPayload = {
  bridgeId: string;
  bridgeName: string;
  bridgeBaseUrl: string;
  bridgeWsUrl: string;
  pairingToken: string;
  tokenExpiresAt?: string;
  fallbackBridgeBaseUrls?: string[];
};

type GeminiLiveTurnResponse = {
  ok?: boolean;
  error?: string;
  model: string;
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
};

type GeminiTokenResponse = {
  ok?: boolean;
  error?: string;
  token: string;
  model: string;
  expireTime: string;
  newSessionExpireTime: string;
};

type GeminiLiveSession = {
  close: () => void;
  sendRealtimeInput: (params: {
    audio?: Blob;
    audioStreamEnd?: boolean;
    text?: string;
  }) => void;
};

type BridgeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export default function App() {
  const [bridgeUrl, setBridgeUrl] = useState('http://localhost:8787');
  const [pairingToken, setPairingToken] = useState('');
  const [deviceName, setDeviceName] = useState('My Phone');
  const [bridgeId, setBridgeId] = useState('');
  const [status, setStatus] = useState<string>('idle');
  const [pairingStatus, setPairingStatus] = useState<string>('not paired');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [wsState, setWsState] = useState<ConnectionState>('idle');
  const [geminiState, setGeminiState] = useState<ConnectionState>('idle');
  const [geminiStatus, setGeminiStatus] = useState('disconnected');
  const [geminiPrompt, setGeminiPrompt] = useState('Say hello to OpenCall and summarize what you can help with.');
  const [geminiResponse, setGeminiResponse] = useState('');
  const [geminiInputTranscript, setGeminiInputTranscript] = useState('');
  const [geminiTokenPreview, setGeminiTokenPreview] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'processing' | 'playing'>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const socketRef = useRef<WebSocket | null>(null);
  const geminiSessionRef = useRef<GeminiLiveSession | null>(null);
  const audioPlayerRef = useRef(createAudioPlayer(null));
  const scanLockRef = useRef(false);
  const logIdRef = useRef(0);
  const pendingRemoteLogRef = useRef(false);
  const responseAudioChunksRef = useRef<Uint8Array[]>([]);
  const recorder = useAudioRecorder({
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    android: {
      extension: '.m4a',
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
    },
    ios: {
      extension: '.wav',
      outputFormat: IOSOutputFormat.LINEARPCM,
      sampleRate: 16000,
      audioQuality: 127,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/wav',
      bitsPerSecond: 256000,
    },
  });

  const sendServerLog = async (
    level: BridgeLogLevel,
    message: string,
    context?: Record<string, unknown>
  ) => {
    const targetBridgeUrl = bridgeUrl.trim().replace(/\/$/, '');

    if (!targetBridgeUrl) {
      return;
    }

    try {
      pendingRemoteLogRef.current = true;
      await fetch(`${targetBridgeUrl}/logs/client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionToken: sessionToken || undefined,
          level,
          source: 'mobile-app',
          message,
          context,
        }),
      });
    } catch (error) {
      const fallback: LogEntry = {
        id: `log-${Date.now()}-${logIdRef.current++}`,
        level: 'warn',
        message: `${new Date().toLocaleTimeString()} remote log failed: ${String(error)}`,
      };
      setLog((current) => [fallback, ...current].slice(0, 24));
    } finally {
      pendingRemoteLogRef.current = false;
    }
  };

  const appendLog = (
    line: string,
    options?: {
      level?: BridgeLogLevel;
      remote?: boolean;
      context?: Record<string, unknown>;
    }
  ) => {
    const level = options?.level ?? 'info';
    const entry: LogEntry = {
      id: `log-${Date.now()}-${logIdRef.current++}`,
      level,
      message: `${new Date().toLocaleTimeString()} ${line}`,
    };
    setLog((current) => [entry, ...current].slice(0, 24));

    if (options?.remote !== false && !pendingRemoteLogRef.current) {
      void sendServerLog(level, line, options?.context);
    }
  };

  const isPairingPayload = (value: unknown): value is PairingPayload => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const payload = value as Record<string, unknown>;

    return (
      typeof payload.bridgeId === 'string' &&
      typeof payload.bridgeName === 'string' &&
      typeof payload.bridgeBaseUrl === 'string' &&
      typeof payload.bridgeWsUrl === 'string' &&
      typeof payload.pairingToken === 'string' &&
      (payload.fallbackBridgeBaseUrls === undefined ||
        (Array.isArray(payload.fallbackBridgeBaseUrls) &&
          payload.fallbackBridgeBaseUrls.every((entry) => typeof entry === 'string')))
    );
  };

  const getCandidateBridgeUrls = (payload?: PairingPayload) => {
    const candidates = [
      payload?.bridgeBaseUrl ?? bridgeUrl,
      ...(payload?.fallbackBridgeBaseUrls ?? []),
    ].filter((value): value is string => Boolean(value));

    return [...new Set(candidates.map((value) => value.replace(/\/$/, '')))];
  };

  const checkHealth = async () => {
    setStatus('checking health');
    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/health`);
      const payload = await response.json();
      setBridgeId(payload.bridgeId ?? '');
      setStatus(`healthy: ${payload.ok ? 'ok' : 'unknown'}`);
      appendLog('bridge health check succeeded', {
        context: { bridgeId: payload.bridgeId, status: payload.status },
      });
    } catch (error) {
      setStatus(`health check failed`);
      appendLog(`health check failed: ${String(error)}`, { level: 'error' });
    }
  };

  const fetchPairing = async () => {
    setPairingStatus('fetching pairing');
    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/pairing`);
      const payload = (await response.json()) as PairingPayload;
      setBridgeId(payload.bridgeId);
      setBridgeUrl(payload.bridgeBaseUrl);
      setPairingToken(payload.pairingToken);
      setPairingStatus(`ready to pair with ${payload.bridgeName}`);
      appendLog('pairing payload fetched', {
        context: { bridgeId: payload.bridgeId, bridgeBaseUrl: payload.bridgeBaseUrl },
      });
    } catch (error) {
      setPairingStatus('pairing fetch failed');
      appendLog(`pairing fetch failed: ${String(error)}`, { level: 'error' });
    }
  };

  const resolvePairingPayload = async (scanData: string): Promise<PairingPayload> => {
    if (/^https?:\/\//i.test(scanData)) {
      const response = await fetch(scanData);

      if (!response.ok) {
        throw new Error(`pairing fetch failed with status ${response.status}`);
      }

      const payload = await response.json();

      if (!isPairingPayload(payload)) {
        throw new Error('pairing QR did not return a valid payload');
      }

      return payload;
    }

    const payload = JSON.parse(scanData) as unknown;

    if (!isPairingPayload(payload)) {
      throw new Error('pairing QR is not a valid OpenCall payload');
    }

    return payload;
  };

  const pair = async (nextPayload?: PairingPayload) => {
    const targetPairingToken = nextPayload?.pairingToken ?? pairingToken;
    const candidateBridgeUrls = getCandidateBridgeUrls(nextPayload);

    setPairingStatus('pairing...');
    let lastError: unknown = null;

    for (const targetBridgeUrl of candidateBridgeUrls) {
      appendLog(`attempting pair via ${targetBridgeUrl}`);

      try {
        const response = await fetch(`${targetBridgeUrl}/pair`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pairingToken: targetPairingToken,
            deviceName,
            devicePublicKey: `mobile-${Date.now()}`,
          }),
        });

        if (!response.ok) {
          throw new Error(`pair failed with status ${response.status}`);
        }

        const payload = (await response.json()) as PairResponse;
        setSessionToken(payload.sessionToken);
        setBridgeId(payload.bridgeId);
        setBridgeUrl(targetBridgeUrl);
        setPairingToken(targetPairingToken);
        setPairingStatus(`paired as ${payload.deviceId}`);
        appendLog(`pairing completed via ${targetBridgeUrl}`, {
          context: { deviceId: payload.deviceId, bridgeId: payload.bridgeId },
        });
        connectWebSocket(payload.sessionToken, targetBridgeUrl);
        return;
      } catch (error) {
        lastError = error;
        appendLog(`pair attempt failed via ${targetBridgeUrl}: ${String(error)}`, {
          level: 'warn',
        });
      }
    }

    setPairingStatus('pairing failed');
    appendLog(`pairing failed: ${String(lastError)}`, { level: 'error' });
    Alert.alert('Pairing failed', String(lastError));
  };

  const connectWebSocket = (token?: string, nextBridgeUrl?: string) => {
    const normalizedUrl = (nextBridgeUrl ?? bridgeUrl).replace(/^http/, 'ws').replace(/\/$/, '');
    const socketUrl = token
      ? `${normalizedUrl}/ws?sessionToken=${encodeURIComponent(token)}`
      : `${normalizedUrl}/ws`;

    socketRef.current?.close();
    setWsState('connecting');
    appendLog(`connecting websocket: ${socketUrl}`);

    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setWsState('open');
      appendLog('websocket open');
      socket.send(JSON.stringify({ type: 'hello', deviceName }));
    };

    socket.onmessage = (event) => {
      appendLog(`ws message: ${event.data}`);
    };

    socket.onerror = () => {
      setWsState('error');
      appendLog('websocket error', { level: 'error' });
    };

    socket.onclose = () => {
      setWsState('closed');
      appendLog('websocket closed');
    };
  };

  const base64ToBytes = (base64: string) => {
    const normalized = base64.replace(/\s/g, '');
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  };

  const concatBytes = (chunks: Uint8Array[]) => {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    return merged;
  };

  const extractWavPcmBytes = (bytes: Uint8Array) => {
    if (
      bytes.length < 44 ||
      String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE'
    ) {
      return bytes;
    }

    let offset = 12;

    while (offset + 8 <= bytes.length) {
      const chunkId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      const chunkSize =
        bytes[offset + 4] |
        (bytes[offset + 5] << 8) |
        (bytes[offset + 6] << 16) |
        (bytes[offset + 7] << 24);
      const dataOffset = offset + 8;

      if (chunkId === 'data') {
        return bytes.slice(dataOffset, dataOffset + chunkSize);
      }

      offset = dataOffset + chunkSize + (chunkSize % 2);
    }

    return bytes;
  };

  const createWavBytes = (pcmBytes: Uint8Array, sampleRate: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const byteRate = sampleRate * 2;

    const writeAscii = (position: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(position + index, value.charCodeAt(index));
      }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, pcmBytes.length, true);

    return concatBytes([new Uint8Array(header), pcmBytes]);
  };

  const playAudioFromBase64 = async (audioBase64: string, extension: string) => {
    const outputFile = new File(Paths.cache, `gemini-${Date.now()}.${extension}`);

    outputFile.create({ overwrite: true, intermediates: true });
    outputFile.write(base64ToBytes(audioBase64));

    audioPlayerRef.current.replace(outputFile.uri);
    audioPlayerRef.current.play();
    setVoiceState('playing');
    appendLog(`playing Gemini audio response (.${extension})`);
  };

  const playBufferedGeminiAudio = async () => {
    const chunks = responseAudioChunksRef.current;

    if (chunks.length === 0) {
      return;
    }

    responseAudioChunksRef.current = [];
    const pcmBytes = concatBytes(chunks);
    const wavBytes = createWavBytes(pcmBytes, 24000);
    const outputFile = new File(Paths.cache, `gemini-live-${Date.now()}.wav`);

    outputFile.create({ overwrite: true, intermediates: true });
    outputFile.write(wavBytes);

    audioPlayerRef.current.replace(outputFile.uri);
    audioPlayerRef.current.play();
    setVoiceState('playing');
    appendLog(`playing Gemini Live audio (${pcmBytes.length} bytes pcm)`);
  };

  const connectGeminiLive = async () => {
    if (!sessionToken) {
      Alert.alert('Pair first', 'Gemini Live requires a paired device session.');
      return;
    }

    if (geminiSessionRef.current) {
      setGeminiState('open');
      setGeminiStatus('live session already connected');
      return;
    }

    setGeminiState('connecting');
    setGeminiStatus('requesting ephemeral token');

    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/gemini/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionToken,
        }),
      });
      const payload = (await response.json()) as GeminiTokenResponse;

      if (!response.ok || !payload.token) {
        throw new Error(payload.error ?? `Gemini token request failed with status ${response.status}`);
      }

      const ai = new GoogleGenAI({
        apiKey: payload.token,
        apiVersion: 'v1alpha',
      });
      setGeminiTokenPreview(`${payload.token.slice(0, 16)}...`);
      responseAudioChunksRef.current = [];

      const liveSession = (await ai.live.connect({
        model: payload.model,
        callbacks: {
          onopen: () => {
            setGeminiState('open');
            setGeminiStatus(`live session open until ${new Date(payload.newSessionExpireTime).toLocaleTimeString()}`);
            appendLog('gemini live session connected directly');
          },
          onmessage: (message: {
            text?: string;
            data?: string;
            serverContent?: {
              inputTranscription?: { text?: string };
              outputTranscription?: { text?: string };
              turnComplete?: boolean;
            };
          }) => {
            const heard = message.serverContent?.inputTranscription?.text?.trim();
            const said = message.serverContent?.outputTranscription?.text?.trim() || message.text?.trim();

            if (heard) {
              setGeminiInputTranscript(heard);
            }

            if (said) {
              setGeminiResponse(said);
            }

            if (message.data) {
              responseAudioChunksRef.current.push(base64ToBytes(message.data));
            }

            if (message.serverContent?.turnComplete) {
              setGeminiStatus('turn complete');
              appendLog(`gemini completed turn: ${said ?? 'audio response'}`);
              void playBufferedGeminiAudio();
            }
          },
          onerror: (error: { message?: string }) => {
            setGeminiState('error');
            setGeminiStatus('live session error');
            appendLog(`gemini live error: ${error.message ?? 'unknown error'}`, { level: 'error' });
          },
          onclose: () => {
            geminiSessionRef.current = null;
            setGeminiState('closed');
            setGeminiStatus('live session closed');
            appendLog('gemini live session closed');
          },
        },
      })) as GeminiLiveSession;

      geminiSessionRef.current = liveSession;
    } catch (error) {
      setGeminiState('error');
      setGeminiStatus('connect failed');
      appendLog(`gemini live connect failed: ${String(error)}`, { level: 'error' });
      Alert.alert('Gemini Live connect failed', String(error));
    }
  };

  const disconnectGeminiLive = () => {
    geminiSessionRef.current?.close();
    geminiSessionRef.current = null;
    responseAudioChunksRef.current = [];
    setGeminiState('closed');
    setGeminiStatus('live session closed');
    appendLog('gemini live session disconnected');
  };

  const sendGeminiPrompt = async () => {
    const prompt = geminiPrompt.trim();

    if (!prompt) {
      Alert.alert('Prompt required', 'Enter a prompt to send to Gemini.');
      return;
    }

    if (!geminiSessionRef.current) {
      await connectGeminiLive();
    }

    const liveSession = geminiSessionRef.current;

    if (!liveSession) {
      return;
    }

    responseAudioChunksRef.current = [];
    setGeminiResponse('');
    setGeminiInputTranscript(prompt);
    setGeminiStatus('sending prompt to live session');
    appendLog(`gemini live prompt: ${prompt}`, {
      context: { promptLength: prompt.length },
    });

    liveSession.sendRealtimeInput({ text: prompt });
  };

  const ensureVoiceReady = async () => {
    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      throw new Error('Microphone permission was not granted');
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
  };

  const startVoiceTurn = async () => {
    if (!geminiSessionRef.current && Platform.OS !== 'android') {
      await connectGeminiLive();
    }

    if (!sessionToken) {
      Alert.alert('Pair first', 'Pair the app before sending voice to Gemini.');
      return;
    }

    try {
      await ensureVoiceReady();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setVoiceState('recording');
      setGeminiStatus('recording voice');
      appendLog('voice recording started');
    } catch (error) {
      setVoiceState('idle');
      appendLog(`voice start failed: ${String(error)}`, { level: 'error' });
      Alert.alert('Voice start failed', String(error));
    }
  };

  const stopVoiceTurn = async () => {
    if (!sessionToken) {
      return;
    }

    try {
      setVoiceState('processing');
      setGeminiStatus('uploading voice');
      await recorder.stop();

      if (!recorder.uri) {
        throw new Error('Recorder did not produce an audio file');
      }

      const recordedFile = new File(recorder.uri);

      if (Platform.OS !== 'android') {
        const liveSession = geminiSessionRef.current;

        if (!liveSession) {
          throw new Error('Gemini Live session is not connected');
        }

        const recordedBytes = await recordedFile.bytes();
        const pcmBytes = extractWavPcmBytes(recordedBytes);
        const pcmBuffer = pcmBytes.buffer.slice(
          pcmBytes.byteOffset,
          pcmBytes.byteOffset + pcmBytes.byteLength
        ) as ArrayBuffer;

        responseAudioChunksRef.current = [];
        setGeminiStatus('sending audio directly to live session');
        liveSession.sendRealtimeInput({
          audio: new Blob([pcmBuffer], { type: 'audio/pcm;rate=16000' }),
        });
        liveSession.sendRealtimeInput({ audioStreamEnd: true });
        appendLog(`voice sent directly to Gemini Live (${pcmBytes.length} bytes pcm)`);
        return;
      }

      const form = new FormData();
      form.append(
        'audio',
        {
          uri: recordedFile.uri,
          name: 'voice-turn.m4a',
          type: 'audio/mp4',
        } as never
      );

      const response = await fetch(
        `${bridgeUrl.replace(/\/$/, '')}/gemini/voice-turn?sessionToken=${encodeURIComponent(sessionToken)}`,
        {
          method: 'POST',
          body: form,
        }
      );

      const payload = (await response.json()) as GeminiLiveTurnResponse;

      if (!response.ok || !payload.audioBase64) {
        throw new Error(payload.error ?? `Gemini voice turn failed with status ${response.status}`);
      }

      setGeminiState('open');
      setGeminiStatus('voice response received from bridge relay');
      if (payload.transcript) {
        setGeminiResponse(payload.transcript);
        appendLog(`gemini heard and replied: ${payload.transcript}`);
      }

      await playAudioFromBase64(payload.audioBase64, 'wav');
    } catch (error) {
      setVoiceState('idle');
      setGeminiStatus('voice failed');
      appendLog(`voice stop failed: ${String(error)}`, { level: 'error' });
      Alert.alert('Voice send failed', String(error));
    }
  };

  const scanQr = async () => {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();

      if (!permission.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to scan the pairing QR.');
        return;
      }
    }

    scanLockRef.current = false;
    setScannerOpen(true);
  };

  const onBarcodeScanned = async ({ data }: BarcodeScanningResult) => {
    if (scanLockRef.current) {
      return;
    }

    scanLockRef.current = true;
    setScannerOpen(false);
    appendLog('pairing QR scanned');

    try {
      const payload = await resolvePairingPayload(data);
      setBridgeId(payload.bridgeId);
      setBridgeUrl(payload.bridgeBaseUrl);
      setPairingToken(payload.pairingToken);
      setPairingStatus(`scanned ${payload.bridgeName}, pairing...`);
      await pair(payload);
    } catch (error) {
      setPairingStatus('scan failed');
      appendLog(`scan failed: ${String(error)}`, { level: 'error' });
      Alert.alert('Scan failed', String(error));
      scanLockRef.current = false;
    }
  };

  useEffect(() => {
    appendLog('mobile app started', {
      context: { platform: Platform.OS },
    });

    return () => {
      socketRef.current?.close();
      geminiSessionRef.current?.close();
      audioPlayerRef.current.pause();
    };
  }, []);

  const statusTone = (value: ConnectionState | typeof voiceState) => {
    if (value === 'open' || value === 'playing') {
      return 'good';
    }

    if (value === 'connecting' || value === 'processing' || value === 'recording') {
      return 'warn';
    }

    if (value === 'error') {
      return 'bad';
    }

    return 'neutral';
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>OpenCall Control Deck</Text>
          <Text style={styles.title}>Gemini Live through your bridge, with real diagnostics.</Text>
          <Text style={styles.subtitle}>
            Pair once, send prompts or voice through the server, and keep a record of what failed.
          </Text>

          <View style={styles.pillRow}>
            <StatusPill label={`WS ${wsState}`} tone={statusTone(wsState)} />
            <StatusPill label={`Gemini ${geminiState}`} tone={statusTone(geminiState)} />
            <StatusPill label={`Voice ${voiceState}`} tone={statusTone(voiceState)} />
          </View>
        </View>

        <SectionCard title="Bridge Pairing">
          <AppButton label="Scan CLI QR" tone="primary" onPress={scanQr} fullWidth={false} />

          {scannerOpen ? (
            <View style={styles.scannerWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onBarcodeScanned}
              />
            </View>
          ) : null}

          <Text style={styles.label}>Bridge URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.20:3000"
            value={bridgeUrl}
            onChangeText={setBridgeUrl}
            style={styles.input}
          />

          <Text style={styles.label}>Pairing Token</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="enter token from bridge"
            value={pairingToken}
            onChangeText={setPairingToken}
            style={styles.input}
          />

          <Text style={styles.label}>Device Name</Text>
          <TextInput
            autoCapitalize="words"
            autoCorrect={false}
            value={deviceName}
            onChangeText={setDeviceName}
            style={styles.input}
          />

          <View style={styles.row}>
            <AppButton label="Check health" tone="neutral" onPress={checkHealth} />
            <AppButton label="Pair" tone="primary" onPress={() => void pair()} />
          </View>

          <AppButton label="Fetch pairing" tone="secondary" onPress={fetchPairing} fullWidth={false} />

          <AppButton
            label="Open WebSocket"
            tone="secondary"
            onPress={() => connectWebSocket(sessionToken)}
            fullWidth={false}
          />
        </SectionCard>

        <SectionCard
          title="Gemini Live"
          lead="Keep a direct Live session open on the phone. Text goes straight to Gemini Live, and voice uses the direct session where native PCM is available."
        >
          <View style={styles.row}>
            <AppButton
              label={geminiState === 'open' ? 'Reconnect Live' : 'Connect Live'}
              tone="primary"
              onPress={() => void connectGeminiLive()}
            />
            <AppButton label="Disconnect" tone="secondary" onPress={disconnectGeminiLive} />
          </View>

          <Text style={styles.label}>Prompt</Text>
          <TextInput
            autoCapitalize="sentences"
            autoCorrect
            value={geminiPrompt}
            onChangeText={setGeminiPrompt}
            style={[styles.input, styles.promptInput]}
            multiline
          />

          <View style={styles.row}>
            <AppButton label="Ask Gemini Live" tone="primary" onPress={() => void sendGeminiPrompt()} />
            <AppButton
              label={voiceState === 'recording' ? 'Stop Voice' : 'Start Voice'}
              tone={voiceState === 'recording' ? 'danger' : 'neutral'}
              onPress={() => void (voiceState === 'recording' ? stopVoiceTurn() : startVoiceTurn())}
            />
          </View>

          <InfoRow label="Gemini state" value={geminiState} />
          <InfoRow label="Status" value={geminiStatus} />
          <InfoRow label="Voice mode" value={voiceState} />
          <InfoRow label="Session token" value={geminiTokenPreview || 'none'} numberOfLines={1} />
          <InfoRow label="You said" value={geminiInputTranscript || 'Nothing captured yet.'} />
          <InfoRow label="Gemini replied" value={geminiResponse || 'No transcript yet.'} />
          <Text style={styles.responseHint}>
            Gemini answers in two ways here: the transcript is shown above, and returned audio is played through the app speaker. On Android, voice still uses the bridge relay because Expo does not expose raw mic PCM on native there.
          </Text>
        </SectionCard>

        <SectionCard title="Session State">
          <InfoRow label="Health" value={status} />
          <InfoRow label="Bridge" value={bridgeId || 'unknown'} />
          <InfoRow label="Pairing" value={pairingStatus} />
          <InfoRow label="WebSocket" value={wsState} />
          <InfoRow label="Session" value={sessionToken || 'none'} numberOfLines={1} />
        </SectionCard>

        <SectionCard
          title="Recent Events"
          lead="These entries are also posted back to the bridge so you can inspect failures from the server side."
        >
          <EventLog entries={log} />
        </SectionCard>

        {wsState === 'connecting' ? <ActivityIndicator /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#11212d',
  },
  container: {
    padding: 18,
    gap: 18,
  },
  hero: {
    backgroundColor: '#18374a',
    borderRadius: 28,
    padding: 22,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  eyebrow: {
    color: '#9ed8db',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#f5f7fa',
    letterSpacing: -0.9,
  },
  subtitle: {
    fontSize: 16,
    color: '#d6e6ea',
    lineHeight: 22,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#43525e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#c8c3b5',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fffdf8',
    color: '#15232d',
  },
  promptInput: {
    minHeight: 108,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  scannerWrap: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d6d8de',
    backgroundColor: '#0f172a',
  },
  camera: {
    height: 260,
  },
  responseHint: {
    fontSize: 13,
    color: '#5b6870',
    lineHeight: 19,
  },
});
