import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  HEARTBEAT_STALE_MS,
  nextWatchAction,
  registerTaskPowerShellScript,
  schtasksCreateCommandLine,
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

test("windows task command keeps the watchdog outside Cursor and without a console", () => {
  const command = windowsTaskCommand("D:\\cursor\\localfactory", "C:\\nodejs\\node.exe");
  assert.match(command, /^wscript\.exe "D:\\cursor\\localfactory\\scripts\\factory-watchdog-hidden\.vbs" "C:\\nodejs\\node\.exe" "D:\\cursor\\localfactory\\scripts\\factory-watchdog\.js"$/);
  assert.match(startupCommandPath(), /Startup\\LocalFactoryWatchdog\.cmd$/);
  const create = schtasksCreateCommandLine("D:\\cursor\\localfactory", "C:\\nodejs\\node.exe");
  assert.match(create, /^schtasks \/Create \/TN LocalFactoryWatchdog \/TR "wscript\.exe \\"D:\\cursor\\localfactory\\scripts\\factory-watchdog-hidden\.vbs\\" \\"C:\\nodejs\\node\.exe\\" \\"D:\\cursor\\localfactory\\scripts\\factory-watchdog\.js\\"" \/SC ONLOGON \/F$/);
});

test("windows task is registered through PowerShell with a hidden launcher", () => {
  const script = registerTaskPowerShellScript("D:\\cursor\\localfactory", "C:\\nodejs\\node.exe");
  assert.match(script, /New-ScheduledTaskAction -Execute 'wscript\.exe' -Argument '"D:\\cursor\\localfactory\\scripts\\factory-watchdog-hidden\.vbs" "C:\\nodejs\\node\.exe" "D:\\cursor\\localfactory\\scripts\\factory-watchdog\.js"' -WorkingDirectory 'D:\\cursor\\localfactory'/);
  assert.match(script, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(script, /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(script, /Register-ScheduledTask -TaskName 'LocalFactoryWatchdog'/);
});

test("watchdog launches the worker detached so closing its window cannot kill the worker", () => {
  const source = fs.readFileSync(new URL("./factory-watchdog.js", import.meta.url), "utf8");
  assert.match(source, /detached: true/);
  assert.match(source, /windowsVerbatimArguments: true/);
});
