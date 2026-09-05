import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withImmediateTransaction } from "./official-history-db.js";
import { createPublishRecordStore } from "./publish-record-store.js";
import { importOfficialPublishRecords } from "./publish-record-migrate.js";
import { officialPublishJsonPath } from "./publish-record-runtime.js";
import { syncOfficialPublishRecordsRound } from "./publish-record-sync.js";

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

test("scale bench: 90000 official records and 1000x30 snapshots stay isolated", async (context) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-scale-"));
  context.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const started = Date.now();
  const rssBefore = process.memoryUsage().rss;
  const records = Array.from({ length: 90_000 }, (_, index) => ({
    id: `scale-${index}`,
    provider: "official",
    source: "official-tiktok",
    status: "submitted",
    connectionId: `acc-${index % 1000}`,
    fileName: `scale-${index}.mp4`,
    createdAt: 1_700_000_000_000 + index,
    scheduleAt: 1_700_000_000 + index,
    dedupeKey: `scale-${index}`,
  }));
  fs.writeFileSync(officialPublishJsonPath(workDir), JSON.stringify(records));
  const imported = importOfficialPublishRecords({ workDir, batchId: "scale-90k", batchSize: 500 });
  const importMs = Date.now() - started;
  assert.equal(imported.imported, 90_000);
  const store = createPublishRecordStore({ workDir });
  const patchSamples = [];
  for (let index = 0; index < 40; index += 1) {
    const begin = Date.now();
    store.patchRecords([{ id: `scale-${index}`, status: "published", videoId: `v-${index}` }]);
    patchSamples.push(Date.now() - begin);
  }
  const pageSamples = [];
  let cursor = "";
  let listed = 0;
  do {
    const begin = Date.now();
    const page = store.listRecords({ limit: 200, cursor });
    pageSamples.push(Date.now() - begin);
    listed += page.records.length;
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(listed, 90_000);
  withImmediateTransaction(store.database, () => {
    for (let account = 0; account < 1000; account += 1) {
      for (let day = 1; day <= 30; day += 1) {
        store.persistRecordSnapshots({
          accounts: [{
            account_key: `tiktok:acc-${account}`,
            snapshot_date: `2026-07-${String(day).padStart(2, "0")}`,
            synced_at: 1_700_000_000_000 + day,
            followers: 10,
            profile: { username: `acc-${account}` },
          }],
          videos: [],
        });
      }
    }
  });
  assert.equal(store.database.prepare("SELECT COUNT(*) AS n FROM account_daily_snapshots").get().n, 30_000);
  let pages = 0;
  await syncOfficialPublishRecordsRound({
    store,
    workerId: "bench",
    destinationKey: "factory:bench",
    maxPages: 1000,
    maxMs: 120_000,
    requestPage: async (body) => {
      pages += 1;
      return {
        protocolVersion: 2,
        sourceStoreId: body.sourceStoreId,
        ackedThroughSeq: body.throughSeq,
        acceptedEventCount: body.events.length,
      };
    },
    retryDelays: [],
  });
  const dbBytes = fs.statSync(store.databasePath).size;
  const rssAfter = process.memoryUsage().rss;
  const summary = {
    machine: `${os.platform()} ${os.release()} ${os.arch()}`,
    node: process.version,
    importMs,
    dbBytes,
    patchP50: percentile(patchSamples, 0.5),
    patchP95: percentile(patchSamples, 0.95),
    pageP50: percentile(pageSamples, 0.5),
    pageP95: percentile(pageSamples, 0.95),
    rssBefore,
    rssAfter,
    syncPages: pages,
    plans: store.explainPlans(),
  };
  console.log("publish-store scale bench", summary);
  assert.ok(importMs < 180_000);
  assert.ok(pages >= 450);
  store.close();
});
