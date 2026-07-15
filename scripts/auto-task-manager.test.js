import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAutoTaskManager } from "./auto-task-manager.js";

const root = process.cwd();
const testRoot = path.join(root, "work", `auto-cleanup-test-${Date.now()}`);
const workDir = path.join(testRoot, "work");
const outputDir = path.join(testRoot, "outputs");
const tasksDir = path.join(workDir, "scheduled-tasks");
fs.mkdirSync(tasksDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const publishedFile = "published-old.mp4";
const pendingFile = "pending-old.mp4";
const recordOnlyFile = "record-only-old.mp4";
const futureFile = "future-scheduled.mp4";
fs.writeFileSync(path.join(outputDir, publishedFile), Buffer.alloc(2048, 1));
fs.writeFileSync(path.join(outputDir, pendingFile), Buffer.alloc(2048, 1));
fs.writeFileSync(path.join(outputDir, recordOnlyFile), Buffer.alloc(2048, 1));
fs.writeFileSync(path.join(outputDir, futureFile), Buffer.alloc(2048, 1));

const oldTime = Date.now() - 2 * 60 * 60 * 1000;
fs.writeFileSync(path.join(tasksDir, "published.json"), JSON.stringify({
  id: "published",
  status: "done",
  completedAt: oldTime,
  generatedVideos: [{ fileName: publishedFile }],
  publishResults: [{ status: "submitted" }],
  createdAt: oldTime
}, null, 2));
fs.writeFileSync(path.join(tasksDir, "pending.json"), JSON.stringify({
  id: "pending",
  status: "needs_attention",
  completedAt: oldTime,
  generatedVideos: [{ fileName: pendingFile }],
  publishResults: [{ status: "failed" }],
  createdAt: oldTime
}, null, 2));
fs.writeFileSync(path.join(tasksDir, "future.json"), JSON.stringify({
  id: "future",
  status: "done",
  completedAt: oldTime,
  generatedVideos: [{ fileName: futureFile }],
  publishResults: [{ status: "submitted", scheduleAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60 }],
  createdAt: oldTime
}, null, 2));
fs.writeFileSync(path.join(workDir, "publish-records.json"), JSON.stringify([{
  fileName: recordOnlyFile,
  status: "submitted",
  updatedAt: oldTime,
  scheduleAt: Math.floor(oldTime / 1000)
}], null, 2));

const manager = createAutoTaskManager({ root, workDir, outputDir, publishService: {}, outputRetentionHours: 1 });
assert.equal(fs.existsSync(path.join(outputDir, publishedFile)), false);
assert.equal(fs.existsSync(path.join(outputDir, pendingFile)), true);
assert.equal(fs.existsSync(path.join(outputDir, recordOnlyFile)), false);
assert.equal(fs.existsSync(path.join(outputDir, futureFile)), true);
assert.equal(manager.getStatus().cleanup.deletedFiles, 2);

fs.rmSync(testRoot, { recursive: true, force: true });
console.log("auto-task output cleanup test passed");
