import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createPublishService } from "./publish-service.js";

const root = process.cwd();
const testRoot = path.join(root, "work", `publish-safety-test-${Date.now()}`);
const workDir = path.join(testRoot, "work");
const outputDir = path.join(testRoot, "outputs");
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const names = ["explicit-fail.mp4", "always-ok.mp4", "upload-fail.mp4"];
for (const name of names) fs.writeFileSync(path.join(outputDir, name), Buffer.alloc(2048, 1));
fs.writeFileSync(path.join(outputDir, "next-day.mp4"), Buffer.alloc(2048, 1));

const uploadAttempts = new Map();
const taskAttempts = new Map();
let taskAddCalls = 0;
let historyCalls = 0;
let historyFailuresRemaining = 2;
const mockClient = {
  isConfigured: () => true,
  historyRecords: async () => {
    historyCalls += 1;
    if (historyFailuresRemaining > 0) {
      historyFailuresRemaining -= 1;
      throw new Error("temporary history timeout");
    }
    return { items: [] };
  },
  uploadTemporaryFile: async (filePath) => {
    const name = path.basename(filePath);
    const attempt = (uploadAttempts.get(name) || 0) + 1;
    uploadAttempts.set(name, attempt);
    if (name === "upload-fail.mp4" && attempt === 1) throw new Error("temporary upload failure");
    return { resourceUrl: `mock://${name}` };
  },
  createTikTokVideoTasks: async ({ videoUrl }) => {
    const name = videoUrl.replace("mock://", "");
    const attempt = (taskAttempts.get(name) || 0) + 1;
    taskAttempts.set(name, attempt);
    taskAddCalls += 1;
    if (name === "explicit-fail.mp4" && attempt === 1) {
      const error = new Error("explicit API failure");
      error.geelarkResponseReceived = true;
      throw error;
    }
    return { taskIds: [`task-${name}-${attempt}`] };
  }
};

const service = createPublishService({
  root,
  workDir,
  outputDir,
  readConfig: () => ({}),
  clientFactory: () => mockClient,
  outputValidator: (dir, fileName) => path.join(dir, fileName),
  historyRetryDelays: [0, 0]
});

const payload = {
  videos: names.map((fileName) => ({ fileName })),
  envIds: ["account-a", "account-b", "account-c"],
  accounts: [],
  scheduleAt: 1893456000,
  intervalMinutes: 15,
  dailyPublishLimit: 20,
  batchPublishLimit: 20
};

const first = await service.publishBatch(payload, { retryDelayMs: 0, autoRetry: true, batchId: "test-first" });
assert.equal(first.summary.submitted, 3);
assert.equal(first.summary.failed, 0);
assert.equal(first.summary.needsCheck, 0);
assert.equal(first.summary.apiTaskAddAttempts, 5);
assert.equal(taskAddCalls, 4);
assert.ok(historyCalls >= 3, "history lookup should retry two transient failures before publishing");

const stateAfterRetry = JSON.parse(fs.readFileSync(path.join(workDir, "geelark-publish-safety.json"), "utf8"));
assert.equal(Object.values(stateAfterRetry.daily).reduce((sum, count) => sum + Number(count || 0), 0), 0, "attempts must not occupy daily completed-publication quota");
const completedRecords = JSON.parse(fs.readFileSync(path.join(workDir, "publish-records.json"), "utf8"));
assert.equal(completedRecords.filter((record) => record.status === "submitted").length, 3, "only successful submissions should count toward the daily quota");

const second = await service.publishBatch(payload, { retryDelayMs: 0, autoRetry: true, batchId: "test-repeat" });
assert.equal(second.summary.skipped, 3);
assert.equal(second.summary.apiTaskAddAttempts, 0);
assert.equal(taskAddCalls, 4);

const safetyOnlySchedule = 1893459600;
const safetyOnlyPlan = "safety-only";
const safetyOnlyKey = crypto.createHash("sha256").update(`${safetyOnlyPlan}|account-z|${safetyOnlySchedule}`).digest("hex");
const safetyPath = path.join(workDir, "geelark-publish-safety.json");
const safetyState = JSON.parse(fs.readFileSync(safetyPath, "utf8"));
safetyState.entries[safetyOnlyKey] = {
  status: "submitted",
  taskIds: ["task-ledger-only"],
  resourceUrl: "mock://safety-only.mp4",
  updatedAt: Date.now()
};
fs.writeFileSync(safetyPath, JSON.stringify(safetyState, null, 2), "utf8");

const safetyOnly = await service.publishBatch({
  videos: [{ fileName: "safety-only.mp4", planName: safetyOnlyPlan }],
  envIds: ["account-z"],
  accounts: [],
  scheduleAt: safetyOnlySchedule,
  intervalMinutes: 0,
  dailyPublishLimit: 20,
  batchPublishLimit: 20
}, { retryDelayMs: 0, autoRetry: false, batchId: "test-safety-ledger" });
assert.equal(safetyOnly.summary.skipped, 1);
assert.equal(safetyOnly.summary.apiTaskAddAttempts, 0);
assert.equal(taskAddCalls, 4);

const limitBlocked = await service.publishBatch({
  videos: [{ fileName: "limit-blocked.mp4" }],
  envIds: ["account-limit"],
  accounts: [],
  scheduleAt: 1893463200,
  intervalMinutes: 0,
  dailyPublishLimit: 3,
  batchPublishLimit: 20
}, { retryDelayMs: 0, autoRetry: true, batchId: "test-limit-block" });
assert.equal(limitBlocked.summary.failed, 1);
assert.equal(limitBlocked.summary.apiTaskAddAttempts, 0);
assert.equal(taskAddCalls, 4);

const nextDay = await service.publishBatch({
  videos: [{ fileName: "next-day.mp4" }],
  envIds: ["account-next-day"],
  accounts: [],
  scheduleAt: payload.scheduleAt + 24 * 60 * 60,
  intervalMinutes: 0,
  dailyPublishLimit: 3,
  batchPublishLimit: 20
}, { retryDelayMs: 0, autoRetry: false, batchId: "test-next-day" });
assert.equal(nextDay.summary.submitted, 1, "a different planned publication date must have an independent quota");
assert.equal(taskAddCalls, 5);

console.log("publish-service safety test passed");
