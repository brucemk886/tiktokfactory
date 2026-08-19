import assert from "node:assert/strict";
import test from "node:test";
import { buildFactoryStorageReport } from "./factory-storage-report.js";

test("factory storage report names the factory D1 and R2 separately", () => {
  const report = buildFactoryStorageReport({
    d1Bytes: 8_000_000,
    accounts: 196,
    videos: 948,
    leftoverVideos: 12,
    assignments: 40,
    jobs: 3,
    novels: 20,
    reports: 8,
    r2Bytes: 1_200_000,
    r2Objects: 196,
  });
  assert.equal(report.d1.name, "factory-prod");
  assert.equal(report.buckets[0].name, "factory-archive");
  assert.equal(report.inventory.accounts, 196);
  assert.equal(report.d1.rows, 196 + 12 + 40 + 3 + 20 + 8);
});
