import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeOfficialHistoryDatabase, openOfficialHistoryDatabase, officialHistoryDatabasePath } from "./official-history-db.js";
import { createPublishRecordStore } from "./publish-record-store.js";

function tempWork() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "publish-store-"));
}

function officialRecord(id, extra = {}) {
  return {
    id,
    provider: "official",
    source: "official-tiktok",
    status: "submitted",
    connectionId: extra.connectionId || "acc-1",
    fileName: extra.fileName || `${id}.mp4`,
    createdAt: extra.createdAt || 1_700_000_000_000,
    updatedAt: extra.updatedAt || extra.createdAt || 1_700_000_000_000,
    scheduleAt: extra.scheduleAt || 1_700_000_000,
    customFlag: extra.customFlag || "keep-me",
    ...extra,
  };
}

test("official records store slim JSON and reuse account snapshots", () => {
  const workDir = tempWork();
  const store = createPublishRecordStore({ workDir });
  const accountHistory = Array.from({ length: 30 }, (_, index) => ({
    snapshotDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    syncedAt: 1_700_000_000_000 + index,
    followers: 100 + index,
    username: "creator",
  }));
  for (let index = 0; index < 100; index += 1) {
    store.upsertRecords([officialRecord(`video-${index}`, {
      videoId: `v-${index}`,
      officialAccountSnapshots: accountHistory,
      officialVideo: { id: `v-${index}`, views: 10 + index, snapshotDate: "2026-07-30", syncedAt: 1_700_100_000_000 },
    })]);
  }
  const row = store.database.prepare("SELECT record_json FROM publishing_records WHERE record_key = 'video-0'").get();
  const stored = JSON.parse(row.record_json);
  assert.equal(stored.officialAccountSnapshots, undefined);
  assert.equal(stored.officialVideoSnapshots, undefined);
  assert.equal(stored.customFlag, "keep-me");
  assert.equal(store.database.prepare("SELECT COUNT(*) AS n FROM account_daily_snapshots").get().n, 30);
  assert.equal(store.database.prepare("SELECT COUNT(*) AS n FROM publishing_records").get().n, 100);
  const detail = store.getRecordDetail("video-0");
  assert.equal(detail.officialAccountSnapshots.length, 30);
  assert.equal(detail.officialVideo.views, 10);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("snapshot-only refresh does not create an outbox event", () => {
  const workDir = tempWork();
  const store = createPublishRecordStore({ workDir });
  store.upsertRecords([officialRecord("r1", { status: "published", videoId: "v1" })]);
  assert.equal(store.maxOutboxSeq(), 1);
  store.upsertRecords([officialRecord("r1", {
    status: "published",
    videoId: "v1",
    officialVideo: { id: "v1", views: 50, snapshotDate: "2026-08-01", syncedAt: 1_700_200_000_000 },
  })]);
  assert.equal(store.maxOutboxSeq(), 1);
  assert.equal(store.getRecordDetail("r1").officialVideo.views, 50);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("list, due, file and query helpers stay indexed", () => {
  const workDir = tempWork();
  const store = createPublishRecordStore({ workDir });
  const now = Date.parse("2026-08-12T10:00:00+08:00");
  store.upsertRecords([
    officialRecord("old", { createdAt: now - 3 * 86400000, scheduleAt: Math.floor((now - 3 * 86400000) / 1000), status: "published", videoId: "v-old", fileName: "old.mp4" }),
    officialRecord("due", { createdAt: now - 86400000, scheduleAt: Math.floor((now - 86400000) / 1000), status: "submitted", fileName: "due.mp4" }),
    officialRecord("future", { createdAt: now, scheduleAt: Math.floor((now + 86400000) / 1000), status: "submitted", fileName: "future.mp4" }),
  ]);
  const page = store.listRecords({ limit: 2 });
  assert.equal(page.records.length, 2);
  assert.ok(page.nextCursor);
  const next = store.listRecords({ limit: 2, cursor: page.nextCursor });
  assert.equal(next.records.length, 1);
  assert.deepEqual(store.findByFileName("due.mp4").map((item) => item.id), ["due"]);
  const due = store.listDueOfficialRecords(now);
  assert.deepEqual(due.map((item) => item.id).sort(), ["due", "old"]);
  store.upsertRecords([officialRecord("old", {
    status: "published",
    videoId: "v-old",
    officialVideo: { id: "v-old", views: 8, snapshotDate: "2026-08-12", syncedAt: now },
  })]);
  assert.deepEqual(store.listDueOfficialRecords(now).map((item) => item.id), ["due"]);
  const plans = store.explainPlans();
  assert.ok(plans.listPage.some((detail) => /publishing_records|USING INDEX|SEARCH/i.test(detail)));
  assert.ok(plans.outbox.some((detail) => /publishing_outbox|USING INDEX|SEARCH/i.test(detail)));
  assert.match(JSON.stringify(plans.listPage), /idx_publishing_records_page|USING INDEX/i);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("record and outbox roll back together", () => {
  const workDir = tempWork();
  const store = createPublishRecordStore({ workDir });
  store.upsertRecords([officialRecord("ok")]);
  assert.throws(() => store.upsertRecords([officialRecord("fail-me", {
    officialVideoSnapshots: [{ views: 1 }],
  })]));
  assert.equal(store.getRecord("fail-me"), null);
  assert.equal(store.maxOutboxSeq(), 1);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("two connections can update different records", () => {
  const workDir = tempWork();
  const dbPath = officialHistoryDatabasePath(workDir);
  const leftDb = openOfficialHistoryDatabase(dbPath, { shared: false });
  const rightDb = openOfficialHistoryDatabase(dbPath, { shared: false });
  const left = createPublishRecordStore({ workDir, database: leftDb });
  const right = createPublishRecordStore({ workDir, database: rightDb });
  left.upsertRecords([officialRecord("left")]);
  right.upsertRecords([officialRecord("right")]);
  assert.ok(left.getRecord("left"));
  assert.ok(right.getRecord("right"));
  assert.ok(left.getRecord("right"));
  leftDb.close();
  rightDb.close();
  closeOfficialHistoryDatabase(dbPath);
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* windows sqlite files can linger briefly */ }
});

test("copied database gets a new source identity", () => {
  const workDir = tempWork();
  const store = createPublishRecordStore({ workDir });
  const first = store.sourceStoreId();
  store.ackOutboxPage("factory:a", 9);
  const reset = store.resetIdentity("copied");
  assert.notEqual(reset.sourceStoreId, first);
  assert.equal(store.getSyncState("factory:a").ackedSeq, 0);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});
