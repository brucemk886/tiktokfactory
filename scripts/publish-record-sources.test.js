import test from "node:test";
import assert from "node:assert/strict";
import {
  collectOfficialBatchIdsFromRecords,
  filterPublishRecordsBySource,
  isOfficialTikTokPublishRecord
} from "./publish-record-sources.js";

test("official TikTok records are separated from GeeLark records", () => {
  const records = [
    { id: "geelark-1", provider: "geelark" },
    { id: "official-1", provider: "official" },
    { id: "official-legacy", source: "official-tiktok" }
  ];

  assert.equal(isOfficialTikTokPublishRecord(records[1]), true);
  assert.deepEqual(filterPublishRecordsBySource(records, "official").map((item) => item.id), ["official-1", "official-legacy"]);
  assert.deepEqual(filterPublishRecordsBySource(records, "geelark").map((item) => item.id), ["geelark-1"]);
});

test("official batch ids are deduplicated across legacy record fields", () => {
  assert.deepEqual(collectOfficialBatchIdsFromRecords([
    { batchId: "batch-1", taskIds: ["batch-1", "batch-2"] },
    { officialBatchIds: ["batch-2", "batch-3"] }
  ]), ["batch-1", "batch-2", "batch-3"]);
});
