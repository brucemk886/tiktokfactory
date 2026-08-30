import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createAutoTaskManager,
  describeMissingOfficialPublishFiles,
  missingOfficialPublishFiles,
  taskStillNeedsOutputFiles
} from "./auto-task-manager.js";

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

assert.equal(taskStillNeedsOutputFiles({
  status: "done",
  publishFailed: true,
  generatedVideos: [{ fileName: "retry-me.mp4" }]
}), true);
assert.equal(taskStillNeedsOutputFiles({
  status: "done",
  publish: { provider: "official" },
  generatedVideos: [{ fileName: "retry-me.mp4" }],
  publishResults: [{ status: "failed" }]
}), true);
assert.equal(taskStillNeedsOutputFiles({
  status: "done",
  generatedVideos: [{ fileName: "published-old.mp4" }],
  publishResults: [{ status: "submitted" }]
}), false);

const collideRoot = path.join(root, "work", `auto-cleanup-collide-${Date.now()}`);
const collideWork = path.join(collideRoot, "work");
const collideOut = path.join(collideRoot, "outputs");
const collideTasks = path.join(collideWork, "scheduled-tasks");
fs.mkdirSync(collideTasks, { recursive: true });
fs.mkdirSync(collideOut, { recursive: true });
const collideName = "[music]same-name-reddit-1.mp4";
fs.writeFileSync(path.join(collideOut, collideName), Buffer.alloc(2048, 1));
const collideOld = Date.now() - 3 * 60 * 60 * 1000;
fs.writeFileSync(path.join(collideTasks, "official-failed.json"), JSON.stringify({
  id: "official-failed",
  status: "done",
  publishFailed: true,
  publish: { provider: "official" },
  completedAt: collideOld,
  generatedVideos: [{ fileName: collideName }],
  publishResults: [{ status: "failed", fileName: collideName, message: "ECONNRESET" }],
  createdAt: collideOld
}, null, 2));
fs.writeFileSync(path.join(collideWork, "publish-records.json"), JSON.stringify([{
  fileName: collideName,
  status: "submitted",
  updatedAt: collideOld,
  scheduleAt: Math.floor(collideOld / 1000)
}], null, 2));
const collideManager = createAutoTaskManager({
  root,
  workDir: collideWork,
  outputDir: collideOut,
  publishService: {},
  outputRetentionHours: 1
});
assert.equal(fs.existsSync(path.join(collideOut, collideName)), true);
assert.equal(collideManager.getStatus().cleanup.deletedFiles, 0);
fs.rmSync(collideRoot, { recursive: true, force: true });

const missingRoot = path.join(root, "work", `auto-missing-${Date.now()}`);
fs.mkdirSync(missingRoot, { recursive: true });
fs.writeFileSync(path.join(missingRoot, "kept.mp4"), Buffer.alloc(16, 1));
assert.deepEqual(missingOfficialPublishFiles({
  outputDir: missingRoot,
  videos: [{ fileName: "gone-a.mp4" }, { fileName: "kept.mp4" }, { fileName: "gone-b.mp4" }],
  savedAssets: { [path.resolve(missingRoot, "gone-a.mp4")]: { assetKey: "asset-1" } }
}), ["gone-b.mp4"]);
assert.match(describeMissingOfficialPublishFiles(["gone-b.mp4", "gone-c.mp4"]), /gone-b\.mp4、gone-c\.mp4/);
fs.rmSync(missingRoot, { recursive: true, force: true });

console.log("auto-task output cleanup test passed");
