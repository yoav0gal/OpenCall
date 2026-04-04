#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import qrcode from "qrcode-terminal";

const opencallHome = process.env.OPENCALL_HOME || join(homedir(), ".opencall");
const runtimeDir = join(opencallHome, "runtime");
const pidPath = join(runtimeDir, "bridge.pid");
const logPath = join(runtimeDir, "bridge.log");
const envPath = join(runtimeDir, "bridge.env");
const repoRoot = resolve(import.meta.dir, "../../..");
const defaultPort = process.env.PORT || "8787";
const localBridgeUrl = `http://127.0.0.1:${defaultPort}`;
const defaultPublicUrl = process.env.OPENCALL_PUBLIC_URL || `http://127.0.0.1:${defaultPort}`;
const defaultDataDir = process.env.OPENCALL_DATA_DIR || join(opencallHome, "data");
const publicBasePath = "/opencall";

type HealthPayload = {
  ok?: boolean;
  bridgeId?: string;
  bridgeName?: string;
  status?: string;
  publicUrl?: string;
  pairedDevices?: Array<{ id: string; deviceName: string; pairedAt: string }>;
  websocketClients?: number;
  storePath?: string;
};

type TailscaleStatus = {
  BackendState?: string;
  AuthURL?: string;
  Health?: string[];
  Self?: {
    DNSName?: string;
    Online?: boolean;
  };
};

function ensureRuntimeDir() {
  mkdirSync(runtimeDir, { recursive: true });
}

function readEnvFile() {
  try {
    const raw = readFileSync(envPath, "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separatorIndex = line.indexOf("=");
          return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
        })
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function getBridgeUrl() {
  const envFile = readEnvFile();
  return envFile.OPENCALL_PUBLIC_URL || defaultPublicUrl;
}

function getLocalBridgeUrl() {
  return localBridgeUrl;
}

function getLanBridgeUrl() {
  const interfaces = networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      return `http://${address.address}:${defaultPort}`;
    }
  }

  return null;
}

function writeEnvFile(publicUrl = defaultPublicUrl) {
  ensureRuntimeDir();
  const content = [
    `PORT=${defaultPort}`,
    `OPENCALL_PUBLIC_URL=${publicUrl}`,
    `OPENCALL_HOME=${opencallHome}`,
    `OPENCALL_DATA_DIR=${defaultDataDir}`
  ].join("\n");
  writeFileSync(envPath, `${content}\n`, "utf8");
}

function readPid() {
  try {
    return Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function getHealth(baseUrl = getLocalBridgeUrl()) {
  return fetchJson<HealthPayload>(`${baseUrl.replace(/\/$/, "")}/health`);
}

async function canReachBridge() {
  try {
    await getHealth();
    return true;
  } catch {
    return false;
  }
}

function parseArgs(args: string[]) {
  return {
    tunnel: args.includes("--tunnel")
  };
}

function runCommand(command: string, args: string[]) {
  return spawnSync(command, args, {
    encoding: "utf8"
  });
}

function ensureCommandExists(command: string) {
  const result = runCommand("bash", ["-lc", `command -v ${command}`]);
  return result.status === 0;
}

function openUrl(url: string) {
  runCommand("open", [url]);
}

function getTailscaleStatus() {
  const result = runCommand("tailscale", ["status", "--json"]);

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Could not read Tailscale status");
  }

  return JSON.parse(result.stdout) as TailscaleStatus;
}

function isUsableTailscaleStatus(status: TailscaleStatus | null | undefined) {
  return status?.BackendState === "Running" && status.Self?.Online === true;
}

function getTailscaleDnsName() {
  const status = getTailscaleStatus();
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "");

  if (!dnsName) {
    throw new Error("Tailscale is connected but this node does not have a DNS name yet");
  }

  return dnsName;
}

async function ensureTailscaleReady() {
  if (!ensureCommandExists("tailscale")) {
    throw new Error("Tailscale CLI is not installed. Install Tailscale on this Mac first.");
  }

  let status: TailscaleStatus;

  try {
    status = getTailscaleStatus();
  } catch {
    throw new Error("System Tailscale daemon is not reachable. Start Tailscale.app and log in, then rerun the command.");
  }

  if (status.BackendState === "NeedsLogin") {
    if (status.AuthURL) {
      openUrl(status.AuthURL);
      throw new Error(`Tailscale login required. A browser was opened to ${status.AuthURL}. After login completes, rerun the command.`);
    }

    const loginResult = runCommand("tailscale", ["up", "--qr=false"]);
    const updatedStatus = getTailscaleStatus();

    if (updatedStatus.BackendState === "NeedsLogin" && updatedStatus.AuthURL) {
      openUrl(updatedStatus.AuthURL);
      throw new Error(`Tailscale login required. A browser was opened to ${updatedStatus.AuthURL}. After login completes, rerun the command.`);
    }

    if (loginResult.status !== 0) {
      throw new Error(loginResult.stderr.trim() || loginResult.stdout.trim() || "Could not log in to Tailscale");
    }

    status = updatedStatus;
  }

  if (!isUsableTailscaleStatus(status)) {
    const healthText = status.Health?.join(" ") || "Tailscale is not online.";
    throw new Error(`${healthText} Verify Tailscale connectivity, then rerun the command.`);
  }

  return { status };
}

async function enableTailscaleTunnel() {
  await ensureTailscaleReady();
  const result = runCommand("tailscale", [
    "funnel",
    "--bg",
    "--yes",
    "--set-path",
    publicBasePath,
    `http://127.0.0.1:${defaultPort}`
  ]);

  if (result.status !== 0) {
    const errorText = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(errorText || "Could not enable Tailscale Funnel");
  }

  const dnsName = getTailscaleDnsName();
  return `https://${dnsName}${publicBasePath}`;
}

async function launchBridgeProcess() {
  ensureRuntimeDir();

  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    console.log(`Bridge already running (pid ${pid})`);
    return false;
  }

  if (await canReachBridge()) {
    console.log(`Bridge already responding at ${getLocalBridgeUrl()}`);
    return false;
  }

  const bridgeDir = join(repoRoot, "apps/bridge");
  const env = {
    ...process.env,
    ...readEnvFile()
  };
  const logFd = openSync(logPath, "a");
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: bridgeDir,
    env,
    stdout: logFd,
    stderr: logFd,
    detached: true
  });
  const spawnedPid = proc.pid;

  if (!spawnedPid || Number.isNaN(spawnedPid)) {
    throw new Error("Could not start bridge.");
  }

  writeFileSync(pidPath, `${spawnedPid}\n`, "utf8");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await canReachBridge()) {
      return true;
    }

    await Bun.sleep(250);
  }

  throw new Error(`Bridge process started (pid ${spawnedPid}) but health check did not come up. Check ${logPath}`);
}

async function startBridge(options: { tunnel: boolean }) {
  writeEnvFile(defaultPublicUrl);
  const started = await launchBridgeProcess();

  if (options.tunnel) {
    const publicUrl = await enableTailscaleTunnel();
    const currentUrl = getBridgeUrl();

    if (currentUrl !== publicUrl) {
      stopBridge({ silent: true });
      writeEnvFile(publicUrl);
      await launchBridgeProcess();
    }
  }

  console.log(`Local bridge URL: ${getLocalBridgeUrl()}`);
  console.log(`Public bridge URL: ${getBridgeUrl()}`);
  console.log(`Log file: ${logPath}`);

  if (options.tunnel) {
    console.log("Tailscale Funnel: enabled");
  }

  if (!started && !options.tunnel) {
    console.log("Bridge was already running");
  }
}

function stopBridge(options?: { silent?: boolean }) {
  const pid = readPid();

  if (!pid || !isProcessAlive(pid)) {
    rmSync(pidPath, { force: true });
    if (!options?.silent) {
      console.log("Bridge is not running");
    }
    return;
  }

  process.kill(pid, "SIGTERM");
  rmSync(pidPath, { force: true });
  if (!options?.silent) {
    console.log(`Stopped OpenCall bridge (pid ${pid})`);
  }
}

async function statusBridge() {
  const pid = readPid();
  const pidRunning = pid ? isProcessAlive(pid) : false;

  console.log(`PID running: ${pidRunning ? "yes" : "no"}`);
  if (pid) {
    console.log(`PID: ${pid}`);
  }
  console.log(`Runtime dir: ${runtimeDir}`);
  console.log(`Local URL: ${getLocalBridgeUrl()}`);
  console.log(`Public URL: ${getBridgeUrl()}`);
  console.log(`Log file: ${logPath}`);

  try {
    const health = await getHealth();
    console.log("Bridge reachable: yes");
    console.log(`Bridge ID: ${health.bridgeId ?? "unknown"}`);
    console.log(`Bridge name: ${health.bridgeName ?? "unknown"}`);
    console.log(`Status: ${health.status ?? "unknown"}`);
    console.log(`Paired devices: ${health.pairedDevices?.length ?? 0}`);
    console.log(`WebSocket clients: ${health.websocketClients ?? 0}`);
    if (health.storePath) {
      console.log(`Store path: ${health.storePath}`);
    }
  } catch (error) {
    console.log("Bridge reachable: no");
    console.log(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function pairBridge() {
  const publicUrl = getBridgeUrl().replace(/\/$/, "");
  const pairingUrl = `${publicUrl}/pairing`;
  const payload = await fetchJson<{
    version?: number;
    bridgeId: string;
    bridgeName: string;
    bridgeBaseUrl: string;
    bridgeWsUrl: string;
    bridgePublicKey?: string;
    pairingToken: string;
    tokenExpiresAt: string;
    qrCodeDataUrl?: string;
  }>(`${getLocalBridgeUrl().replace(/\/$/, "")}/pairing`);
  const lanBridgeUrl = getLanBridgeUrl();
  const preferredBridgeUrl = payload.bridgeBaseUrl;
  const fallbackBridgeBaseUrls = [lanBridgeUrl].filter((url): url is string => Boolean(url) && url !== preferredBridgeUrl);
  const qrPayload = {
    version: payload.version ?? 1,
    bridgeId: payload.bridgeId,
    bridgeName: payload.bridgeName,
    bridgeBaseUrl: preferredBridgeUrl,
    bridgeWsUrl: preferredBridgeUrl.replace(/^http/, "ws"),
    bridgePublicKey: payload.bridgePublicKey,
    pairingToken: payload.pairingToken,
    tokenExpiresAt: payload.tokenExpiresAt,
    fallbackBridgeBaseUrls
  };

  console.log(`Bridge: ${payload.bridgeName}`);
  console.log(`Bridge ID: ${payload.bridgeId}`);
  console.log(`Public URL: ${publicUrl}`);
  console.log(`Pairing URL: ${pairingUrl}`);
  console.log(`Token expires at: ${payload.tokenExpiresAt}`);
  console.log("");
  console.log("Scan this QR from the OpenCall app:");
  qrcode.generate(JSON.stringify(qrPayload), { small: true });
}

function logsBridge() {
  try {
    const raw = readFileSync(logPath, "utf8");
    console.log(raw.split(/\r?\n/).slice(-40).join("\n"));
  } catch {
    console.log("No bridge logs yet");
  }
}

function printHelp() {
  console.log(`OpenCall CLI

Usage:
  opencall start [--tunnel]
  opencall stop
  opencall status
  opencall pair
  opencall logs
`);
}

const [command = "help", ...args] = process.argv.slice(2);
const options = parseArgs(args);

try {
  switch (command) {
    case "start":
      await startBridge(options);
      break;
    case "stop":
      stopBridge();
      break;
    case "status":
      await statusBridge();
      break;
    case "pair":
      await pairBridge();
      break;
    case "logs":
      logsBridge();
      break;
    default:
      printHelp();
      process.exitCode = command === "help" ? 0 : 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
