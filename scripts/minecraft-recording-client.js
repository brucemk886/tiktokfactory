import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const minecraftBridgeDirectory = (workDir) => path.join(workDir, "minecraft-recording");
export const recordingRequestId = (key) => crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 32);
function atomicJson(file, value) { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); }
export function isFatalMinecraftRecordingError(error) {
  return (String(error?.code || "").startsWith("MINECRAFT_") && error.code !== "MINECRAFT_ITEM_FAILED") || /ENOSPC|No space left|not enough space|磁盘空间不足/i.test(String(error?.message || ""));
}
export function minecraftRecordingFailure(state) {
  const message = state?.error || "模拟器录制失败。";
  const error = new Error(message);
  error.code = state?.status === "cancelled" ? "MINECRAFT_CANCELLED"
    : state?.status === "interrupted" || state?.fatal || /磁盘|空间不足|空间仅剩|视频盘|FFmpeg|录制组件|未检测到|没有检测到|游戏.*退出|Minecraft.*退出|已有其他录制|心跳.*(切换|丢失|未更新|超过)/.test(message)
      ? "MINECRAFT_SYSTEM_ERROR" : "MINECRAFT_ITEM_FAILED";
  return error;
}
export function validateRecordingResult(result, seconds) {
  try {
  if (result?.status !== "done" || !Array.isArray(result.clips) || !result.clips.length) throw new Error("模拟器没有返回通过质检的录制片段。");
  let total = 0;
  for (const clip of result.clips) {
    if (clip.accepted !== true || !path.isAbsolute(String(clip.filePath || "")) || !fs.existsSync(clip.filePath) || fs.statSync(clip.filePath).size < 1024 || !(Number(clip.duration) > 0)) throw new Error("录制结果缺失、未通过质检或文件已被移动。");
    total += Number(clip.duration);
  }
  if (total + 0.05 < seconds) throw new Error("录制画面总时长短于音频。");
  return result.clips.map((clip) => ({ file: clip.filePath, id: `simulator:${clip.id}`, duration: Number(clip.duration), fileName: path.basename(clip.filePath) }));
  } catch (error) { error.code = "MINECRAFT_ITEM_FAILED"; throw error; }
}
export function launchMinecraftSimulator({ root, config, directory }) {
  const settings = config.minecraftSimulator || {};
  if (settings.autoStart === false) return;
  const simulatorRoot = path.resolve(settings.root || path.join(root, "..", "minecraft"));
  const executable = settings.executable || path.join(simulatorRoot, "node_modules", "electron", "dist", "electron.exe");
  if (!fs.existsSync(executable)) throw new Error("未找到模拟器，请在本机 config.json 的 minecraftSimulator 配置 root 或 executable。");
  if (!settings.executable && !fs.existsSync(path.join(simulatorRoot, "dist", "index.html"))) throw new Error("模拟器尚未构建，请先在模拟器目录执行 npm run build。");
  if (process.platform === "win32") {
    const check = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$p = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and ($_.ExecutablePath -eq $env:FACTORY_SIM_EXE -or (($_.Name -eq 'electron.exe' -or $_.Name -like 'ParkourSim*') -and $_.CommandLine -like ('*' + $env:FACTORY_SIM_ROOT + '*'))) }; if ($p) { exit 3 }"], { env: { ...process.env, FACTORY_SIM_EXE: executable, FACTORY_SIM_ROOT: simulatorRoot }, windowsHide: true, timeout: 15000, stdio: "ignore" });
    if (check.status === 3) throw new Error("模拟器已打开但未连接工厂。请在当前录制结束后重新打开更新后的模拟器；不会启动第二个实例抢占游戏。");
    if (check.status !== 0) throw new Error("无法确认模拟器是否已运行，请手动打开更新后的模拟器后重试。");
  }
  const env = { ...process.env, PARKOUR_TEST_DIST: "1", LOCAL_FACTORY_BRIDGE_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, settings.executable ? [] : [simulatorRoot], { cwd: simulatorRoot, env, windowsHide: true, detached: true, stdio: "ignore" });
  child.on("error", () => {}); child.unref();
  return child;
}
export async function recordMinecraftFootage({ root, workDir, config = {}, key, seconds, isCancelled = () => false, onProgress = () => {}, pollMs = 1000, timeoutMs, startupTimeoutMs = 90000, launch = launchMinecraftSimulator }) {
  if (!(seconds > 0 && seconds <= 3600)) throw new Error("录制目标时长必须在 0–3600 秒之间。");
  const directory = minecraftBridgeDirectory(workDir); fs.mkdirSync(directory, { recursive: true });
  const requestsDir = path.join(directory, "requests"); fs.mkdirSync(requestsDir, { recursive: true });
  const id = recordingRequestId(key);
  const requestFile = path.join(requestsDir, `${id}.request.json`), resultFile = path.join(directory, `${id}.result.json`), cancelFile = path.join(directory, `${id}.cancel`);
  if (isCancelled()) {
    fs.writeFileSync(cancelFile, "cancel");
    const error = new Error("任务已取消，未启动新的录制。"); error.code = "MINECRAFT_CANCELLED"; throw error;
  }
  const existing = read(resultFile);
  if (existing?.status === "done") return validateRecordingResult(existing, seconds);
  if (["failed", "cancelled", "interrupted"].includes(existing?.status)) throw minecraftRecordingFailure(existing);
  if (fs.existsSync(cancelFile)) throw new Error("这次录制已经取消，请从原任务重试。");
  const health = read(path.join(directory, "health.json"));
  if (!health || Date.now() - Number(health.updatedAt) > 15000) {
    const lockFile = path.join(directory, "launch.json"), prior = read(lockFile);
    if (prior && Date.now() - Number(prior.at) > 60000) { try { fs.unlinkSync(lockFile); } catch {} }
    let lock;
    try { lock = fs.openSync(lockFile, "wx"); } catch (e) { if (e.code !== "EEXIST") throw e; }
    if (lock !== undefined) {
      fs.writeFileSync(lock, JSON.stringify({ at: Date.now() })); fs.closeSync(lock);
      try { launch({ root, config, directory }); } catch (error) { fs.unlinkSync(lockFile); throw error; }
    }
  }
  if (!fs.existsSync(requestFile)) atomicJson(requestFile, { version: 1, id, seconds: Math.ceil(seconds), createdAt: Date.now(), ownerPid: process.pid });
  const deadline = Date.now() + (timeoutMs ?? Math.max(45 * 60_000, seconds * 6000 + 10 * 60_000));
  let last = "", lastLive = Date.now();
  try {
    while (Date.now() < deadline) {
      if (isCancelled()) { const e = new Error("任务已取消，已请求模拟器停止本次录制。"); e.code = "MINECRAFT_CANCELLED"; throw e; }
      const state = read(resultFile);
      if (state?.status === "done") return validateRecordingResult(state, seconds);
      if (["failed", "cancelled", "interrupted"].includes(state?.status)) throw minecraftRecordingFailure(state);
      const live = read(path.join(directory, "health.json"));
      const connected = live && Date.now() - Number(live.updatedAt) < 15000;
      if (connected) lastLive = Date.now();
      if (Date.now() - lastLive > startupTimeoutMs) throw new Error("模拟器未连接或已退出，请更新/启动模拟器并确认 Fabric 单人世界可用。");
      const text = connected ? state?.message || "等待模拟器空闲后自动录制（不会打断其他录制）" : "等待我的世界模拟器连接";
      if (text !== last) { last = text; onProgress(text); }
      await pause(pollMs);
    }
    throw new Error("自动录制等待超时，未使用旧素材替代。");
  } catch (error) { fs.writeFileSync(cancelFile, "cancel"); error.code ||= "MINECRAFT_SYSTEM_ERROR"; throw error; }
}
