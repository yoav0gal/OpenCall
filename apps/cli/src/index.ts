#!/usr/bin/env bun

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const opencallHome = process.env.OPENCALL_HOME || join(homedir(), ".opencall");
const runtimeDir = join(opencallHome, "runtime");
const pidPath = join(runtimeDir, "bridge.pid");
const logPath = join(runtimeDir, "bridge.log");
const envPath = join(runtimeDir, "bridge.env");
const repoRoot = resolve(import.meta.dir, "../../..");
const defaultPort = process.env.PORT || "8787";
const defaultPublicUrl = process.env.OPENCALL_PUBLIC_URL || `http://127.0.0.1:${defaultPort}`;
const defaultDataDir = process.env.OPENCALL_DATA_DIR || join(opencallHome, "data");

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

function writeEnvFile() {
  ensureRuntimeDir();
  const content = [
    `PORT=${defaultPort}`,
    `OPENCALL_PUBLIC_URL=${defaultPublicUrl}`,
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

async function getHealth() {
  return fetchJson<HealthPayload>(`${getBridgeUrl().replace(/\/$/, "")}/health`);
}

async function canReachBridge() {
  try {
    await getHealth();
    return true;
  } catch {
    return false;
  }
}

async function startBridge() {
  ensureRuntimeDir();
  writeEnvFile();

  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    console.log(`Bridge already running (pid ${pid})`);
    return;
  }

  if (await canReachBridge()) {
    console.log(`Bridge already responding at ${getBridgeUrl()}`);
    return;
  }

  const bridgeDir = join(repoRoot, "apps/bridge");
  const command = [
    "bash",
    "-lc",
    `nohup bash -lc 'cd ${bridgeDir} && export $(cat ${JSON.stringify(envPath)} | xargs) && exec bun run src/index.ts' >> ${JSON.stringify(logPath)} 2>&1 & echo $!`
  ];

  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "inherit"
  });

  const stdout = await new Response(proc.stdout).text();
  const spawnedPid = Number.parseInt(stdout.trim(), 10);

  if (!spawnedPid || Number.isNaN(spawnedPid)) {
    throw new Error(`Could not start bridge. ${stdout}`.trim());
  }

  writeFileSync(pidPath, `${spawnedPid}\n`, "utf8");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await canReachBridge()) {
      console.log(`Started OpenCall bridge (pid ${spawnedPid})`);
      console.log(`Log file: ${logPath}`);
      return;
    }

    await Bun.sleep(250);
  }

  throw new Error(`Bridge process started (pid ${spawnedPid}) but health check did not come up. Check ${logPath}`);
}

function stopBridge() {
  const pid = readPid();

  if (!pid || !isProcessAlive(pid)) {
    rmSync(pidPath, { force: true });
    console.log("Bridge is not running");
    return;
  }

  process.kill(pid, "SIGTERM");
  rmSync(pidPath, { force: true });
  console.log(`Stopped OpenCall bridge (pid ${pid})`);
}

async function statusBridge() {
  const pid = readPid();
  const pidRunning = pid ? isProcessAlive(pid) : false;

  console.log(`PID running: ${pidRunning ? "yes" : "no"}`);
  if (pid) {
    console.log(`PID: ${pid}`);
  }
  console.log(`Runtime dir: ${runtimeDir}`);
  console.log(`Bridge URL: ${getBridgeUrl()}`);
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
  const payload = await fetchJson(`${getBridgeUrl().replace(/\/$/, "")}/pairing`);
  console.log(JSON.stringify(payload, null, 2));
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
  opencall start
  opencall stop
  opencall status
  opencall pair
  opencall logs
`);
}

const command = process.argv[2] || "help";

switch (command) {
  case "start":
    await startBridge();
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
