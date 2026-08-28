import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

export const DEFAULT_PORT = 3010;
export const CHECK_MS = 10_000;
export const RESTART_DELAY_MS = 5_000;
export const HEARTBEAT_STALE_MS = 45_000;
export const WINDOWS_TASK_NAME = "LocalFactoryWatchdog";

export function watchdogStatePath(workDir) {
  return path.join(workDir, "factory-watchdog.json");
}

export function watchdogLockPath(workDir) {
  return path.join(workDir, "factory-watchdog.lock");
}

export function nextWatchAction({ portOpen = false, childAlive = false, stopping = false } = {}) {
  if (stopping) return "idle";
  if (portOpen || childAlive) return "watch";
  return "start";
}

export function summarizeWatchdog(state = {}, now = Date.now()) {
  const heartbeatAt = Number(state.heartbeatAt || 0);
  const running = heartbeatAt > 0 && now - heartbeatAt < HEARTBEAT_STALE_MS;
  const restartCount = Number(state.restartCount || 0);
  let message = "守护未运行。本机工人挂了不会自动拉起。";
  if (running && restartCount > 0) message = `守护在跑，曾自动拉起 ${restartCount} 次。`;
  else if (running) message = "守护在跑，工人掉线会自动拉起。";
  return {
    running,
    pid: Number(state.pid || 0),
    serverPid: Number(state.serverPid || 0),
    restartCount,
    lastRestartAt: Number(state.lastRestartAt || 0),
    lastExitCode: state.lastExitCode ?? null,
    lastError: String(state.lastError || ""),
    message
  };
}

export function readWatchdogSummary(workDir, now = Date.now()) {
  try {
    return summarizeWatchdog(JSON.parse(fs.readFileSync(watchdogStatePath(workDir), "utf8")), now);
  } catch {
    return summarizeWatchdog({}, now);
  }
}

export function isPidAlive(pid) {
  const id = Number(pid || 0);
  if (!id) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch {
    return false;
  }
}

export function probePort(port = DEFAULT_PORT, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendLog(workDir, line) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.appendFileSync(path.join(workDir, "factory-watchdog.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
}

export function windowsTaskCommand(root = process.cwd(), nodePath = process.execPath) {
  return `"${nodePath}" "${path.join(root, "scripts", "factory-watchdog.js")}"`;
}

export function startupCommandPath() {
  const appData = String(process.env.APPDATA || "").trim();
  if (!appData) return "";
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "LocalFactoryWatchdog.cmd");
}

export function ensureWindowsAutostart(root = process.cwd()) {
  if (process.platform !== "win32") return { ok: false, reason: "not-windows" };
  const query = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME], { encoding: "utf8", windowsHide: true });
  if (query.status === 0) return { ok: true, reason: "exists" };
  const created = spawnSync("schtasks", [
    "/Create",
    "/TN", WINDOWS_TASK_NAME,
    "/TR", windowsTaskCommand(root),
    "/SC", "ONLOGON",
    "/F"
  ], { encoding: "utf8", windowsHide: true });
  if (created.status === 0) return { ok: true, reason: "created" };
  const cmdPath = startupCommandPath();
  if (!cmdPath) return { ok: false, reason: String(created.stderr || created.stdout || "create-failed").trim() };
  fs.mkdirSync(path.dirname(cmdPath), { recursive: true });
  fs.writeFileSync(cmdPath, `@echo off\r\nstart "LocalFactoryWatchdog" /min ${windowsTaskCommand(root)}\r\n`, "utf8");
  return { ok: true, reason: "startup-folder" };
}

function acquireLock(workDir) {
  const lockPath = watchdogLockPath(workDir);
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (isPidAlive(existing.pid) && Number(existing.pid) !== process.pid) {
      return { ok: false, pid: existing.pid };
    }
  } catch {
    // stale or missing lock
  }
  writeJson(lockPath, { pid: process.pid, startedAt: Date.now() });
  return { ok: true, pid: process.pid };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(root);
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const { workDir } = resolveStorageDirs(root, readConfig(root));
  const installOnly = process.argv.includes("--install");
  const task = ensureWindowsAutostart(root);
  if (installOnly) {
    if (!task.ok) {
      console.error(`无法注册开机守护：${task.reason}`);
      process.exit(1);
    }
    const messages = {
      exists: "开机守护已存在。",
      created: "已注册开机守护：登录 Windows 后自动看管 3010。",
      "startup-folder": "已写入开机启动项：登录 Windows 后自动看管 3010。"
    };
    console.log(messages[task.reason] || "开机守护已就绪。");
    return;
  }

  const lock = acquireLock(workDir);
  if (!lock.ok) {
    console.log(`守护已在运行 pid=${lock.pid}`);
    return;
  }

  let child = null;
  let stopping = false;
  let restartCount = 0;
  let lastRestartAt = 0;
  let lastExitCode = null;
  let lastError = "";
  let serverPid = 0;

  const persist = (extra = {}) => {
    writeJson(watchdogStatePath(workDir), {
      pid: process.pid,
      serverPid,
      heartbeatAt: Date.now(),
      restartCount,
      lastRestartAt,
      lastExitCode,
      lastError,
      port,
      ...extra
    });
  };

  const startServer = () => {
    child = spawn(process.execPath, [path.join(root, "scripts", "server.js")], {
      cwd: root,
      stdio: "ignore",
      windowsHide: true
    });
    serverPid = child.pid || 0;
    if (lastRestartAt) restartCount += 1;
    lastRestartAt = Date.now();
    lastError = "";
    appendLog(workDir, `start server pid=${serverPid} restart=${restartCount}`);
    persist();
    child.on("exit", (code, signal) => {
      lastExitCode = code;
      lastError = signal ? `signal ${signal}` : `exit ${code}`;
      appendLog(workDir, `server exit pid=${serverPid} ${lastError}`);
      child = null;
      serverPid = 0;
      persist();
    });
  };

  const tick = async () => {
    const portOpen = await probePort(port);
    const childAlive = Boolean(child && child.exitCode == null);
    const action = nextWatchAction({ portOpen, childAlive, stopping });
    if (action === "start") {
      if (lastRestartAt && Date.now() - lastRestartAt < RESTART_DELAY_MS) {
        persist();
        return;
      }
      startServer();
      return;
    }
    if (portOpen && !childAlive) serverPid = 0;
    persist();
  };

  const stop = () => {
    stopping = true;
    persist({ stopping: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  appendLog(workDir, `watchdog start pid=${process.pid} task=${task.reason}`);
  persist();
  await tick();
  setInterval(() => {
    tick().catch((error) => {
      lastError = error.message || String(error);
      appendLog(workDir, `tick error ${lastError}`);
      persist();
    });
  }, CHECK_MS);
  console.log(`本机工人守护已启动，监听 http://127.0.0.1:${port}`);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisFile = path.resolve(fileURLToPath(import.meta.url));
if (invoked && invoked.toLowerCase() === thisFile.toLowerCase()) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
