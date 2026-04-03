import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type PairResponse = {
  sessionToken: string;
  bridgeId: string;
  deviceId: string;
};

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type PairingPayload = {
  bridgeId: string;
  bridgeName: string;
  bridgeBaseUrl: string;
  bridgeWsUrl: string;
  pairingToken: string;
};

export default function App() {
  const [bridgeUrl, setBridgeUrl] = useState('http://localhost:8787');
  const [pairingToken, setPairingToken] = useState('');
  const [deviceName, setDeviceName] = useState('My Phone');
  const [bridgeId, setBridgeId] = useState('');
  const [status, setStatus] = useState<string>('idle');
  const [pairingStatus, setPairingStatus] = useState<string>('not paired');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [wsState, setWsState] = useState<ConnectionState>('idle');
  const [log, setLog] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  const appendLog = (line: string) => {
    setLog((current) => [`${new Date().toLocaleTimeString()} ${line}`, ...current].slice(0, 12));
  };

  const checkHealth = async () => {
    setStatus('checking health');
    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/health`);
      const payload = await response.json();
      setBridgeId(payload.bridgeId ?? '');
      setStatus(`healthy: ${payload.ok ? 'ok' : 'unknown'}`);
      appendLog('bridge health check succeeded');
    } catch (error) {
      setStatus(`health check failed`);
      appendLog(`health check failed: ${String(error)}`);
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
      appendLog('pairing payload fetched');
    } catch (error) {
      setPairingStatus('pairing fetch failed');
      appendLog(`pairing fetch failed: ${String(error)}`);
    }
  };

  const pair = async () => {
    setPairingStatus('pairing...');
    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingToken,
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
      setPairingStatus(`paired as ${payload.deviceId}`);
      appendLog('pairing completed');
      connectWebSocket(payload.sessionToken);
    } catch (error) {
      setPairingStatus('pairing failed');
      appendLog(`pairing failed: ${String(error)}`);
      Alert.alert('Pairing failed', String(error));
    }
  };

  const connectWebSocket = (token?: string) => {
    const normalizedUrl = bridgeUrl.replace(/^http/, 'ws').replace(/\/$/, '');
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
      appendLog('websocket error');
    };

    socket.onclose = () => {
      setWsState('closed');
      appendLog('websocket closed');
    };
  };

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>OpenCall</Text>
        <Text style={styles.subtitle}>Phone to bridge pairing</Text>

        <View style={styles.card}>
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
            <Pressable style={styles.button} onPress={checkHealth}>
              <Text style={styles.buttonText}>Check health</Text>
            </Pressable>
            <Pressable style={styles.buttonPrimary} onPress={pair}>
              <Text style={styles.buttonText}>Pair</Text>
            </Pressable>
          </View>

          <Pressable style={styles.buttonSecondary} onPress={fetchPairing}>
            <Text style={styles.buttonText}>Fetch pairing</Text>
          </Pressable>

          <Pressable
            style={styles.buttonSecondary}
            onPress={() => connectWebSocket(sessionToken)}
          >
            <Text style={styles.buttonText}>Open WebSocket</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>State</Text>
          <Text style={styles.value}>Health: {status}</Text>
          <Text style={styles.value}>Bridge: {bridgeId || 'unknown'}</Text>
          <Text style={styles.value}>Pairing: {pairingStatus}</Text>
          <Text style={styles.value}>WebSocket: {wsState}</Text>
          <Text style={styles.value} numberOfLines={1}>
            Session: {sessionToken || 'none'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Log</Text>
          {log.length === 0 ? (
            <Text style={styles.muted}>No events yet.</Text>
          ) : (
            log.map((line) => (
              <Text key={line} style={styles.logLine}>
                {line}
              </Text>
            ))
          )}
        </View>

        {wsState === 'connecting' ? <ActivityIndicator /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2efe8',
  },
  container: {
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 40,
    fontWeight: '800',
    color: '#101820',
    letterSpacing: -1.2,
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    marginTop: -8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d6d8de',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
    color: '#0f172a',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: '#0f766e',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#64748b',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  value: {
    fontSize: 15,
    color: '#1f2937',
  },
  muted: {
    color: '#6b7280',
  },
  logLine: {
    fontSize: 13,
    color: '#334155',
    marginBottom: 4,
  },
});
