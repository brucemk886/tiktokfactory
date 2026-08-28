import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAutoTaskManager } from "./auto-task-manager.js";
import {
  DEFAULT_POLL_MS,
  DEFAULT_SYNC_MS,
  loadSettings,
  localJobCancelled
} from "./factory-cloud-worker.js";

test("factory worker requeues its own interrupted jobs on hello", () => {
  const source = fs.readFileSync(new URL("./factory-cloud-worker.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/worker\/hello/);
  assert.match(source, /工人重启，已把/);
});

test("factory worker claims once a minute and does not poll cloud cancel", () => {
  assert.equal(DEFAULT_POLL_MS, 60_000);
  assert.equal(DEFAULT_SYNC_MS, 300_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-worker-"));
  const settings = loadSettings(dir);
  assert.equal(settings.pollMs, 60_000);
  assert.equal(settings.syncMs, 300_000);
  assert.equal(settings.reconcileMs, undefined);
  assert.equal(settings.progressMinMs, undefined);
});

test("factory worker reads claim interval from the settings file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-worker-"));
  fs.writeFileSync(path.join(dir, "factory-cloud-worker.json"), JSON.stringify({
    pollMs: 90_000,
    syncMs: 120_000
  }));
  const settings = loadSettings(dir);
  assert.equal(settings.pollMs, 90_000);
  assert.equal(settings.syncMs, 120_000);
});

test("local stop is detected from the job file or mirrored task", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-worker-"));
  const jobsDir = path.join(dir, "jobs");
  const tasksDir = path.join(dir, "scheduled-tasks");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  const context = { jobsDir, workDir: dir };
  const job = { id: "job-1", payload: { taskId: "task-1" } };
  assert.equal(localJobCancelled(context, job, "job-1"), false);
  fs.writeFileSync(path.join(jobsDir, "job-1.json"), JSON.stringify({ jobId: "job-1", status: "canceled" }));
  assert.equal(localJobCancelled(context, job, "job-1"), true);
  fs.writeFileSync(path.join(jobsDir, "job-2.json"), JSON.stringify({ jobId: "job-2", status: "running" }));
  fs.writeFileSync(path.join(tasksDir, "task-2.json"), JSON.stringify({ id: "task-2", status: "canceled" }));
  assert.equal(localJobCancelled(context, { id: "job-2", payload: { taskId: "task-2" } }, "job-2"), true);
});

test("cancelTask writes the generation job file so the local worker can stop", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cancel-"));
  const workDir = path.join(dir, "work");
  const outputDir = path.join(dir, "outputs");
  const tasksDir = path.join(workDir, "scheduled-tasks");
  const jobsDir = path.join(workDir, "jobs");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "cloud-task.json"), JSON.stringify({
    id: "cloud-task",
    source: "factory-cloud",
    status: "running",
    generationJobId: "job-9",
    createdAt: Date.now()
  }));
  const manager = createAutoTaskManager({ root: process.cwd(), workDir, outputDir, publishService: {} });
  const stopped = manager.cancelTask("cloud-task");
  assert.equal(stopped.status, "canceled");
  const job = JSON.parse(fs.readFileSync(path.join(jobsDir, "job-9.json"), "utf8"));
  assert.equal(job.status, "canceled");
});
