import assert from "node:assert/strict";
import test from "node:test";
import {
  HEARTBEAT_STALE_MS,
  nextWatchAction,
  startupCommandPath,
  summarizeWatchdog,
  windowsTaskCommand
} from "./factory-watchdog.js";

test("watchdog starts the server only when 3010 is down", () => {
  assert.equal(nextWatchAction({ portOpen: true, childAlive: false }), "watch");
  assert.equal(nextWatchAction({ portOpen: false, childAlive: true }), "watch");
  assert.equal(nextWatchAction({ portOpen: false, childAlive: false }), "start");
  assert.equal(nextWatchAction({ portOpen: false, childAlive: false, stopping: true }), "idle");
});

test("watchdog summary expires after the heartbeat goes stale", () => {
  const now = 1_000_000;
  const live = summarizeWatchdog({ heartbeatAt: now - 10_000, restartCount: 2 }, now);
  assert.equal(live.running, true);
  assert.match(live.message, /自动拉起 2 次/);
  const dead = summarizeWatchdog({ heartbeatAt: now - HEARTBEAT_STALE_MS - 1 }, now);
  assert.equal(dead.running, false);
  assert.match(dead.message, /不会自动拉起/);
});

test("windows task command keeps the watchdog outside Cursor", () => {
  const command = windowsTaskCommand("D:\\cursor\\localfactory", "C:\\nodejs\\node.exe");
  assert.match(command, /factory-watchdog\.js/);
  assert.match(command, /node\.exe/);
  assert.match(startupCommandPath(), /Startup\\LocalFactoryWatchdog\.cmd$/);
});
