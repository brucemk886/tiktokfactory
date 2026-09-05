import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withImmediateTransaction } from "./official-history-db.js";
import test from "node:test";
import { createPublishRecordStore } from "./publish-record-store.js";
import {
  buildPublishRecordSyncRequest,
  isValidPublishRecordSyncAck,
  syncOfficialPublishRecordsRound,
} from "./publish-record-sync.js";

function officialRecord(id, extra = {}) {
  return {
    id,
    provider: "official",
    source: "official-tiktok",
    status: extra.status || "submitted",
    connectionId: "acc-1",
    createdAt: extra.createdAt || 1_600_000_000_000,
    updatedAt: extra.updatedAt || Date.now(),
    scheduleAt: 1_600_000_000,
    ...extra,
  };
}

async function memoryCloud() {
  const applied = new Map();
  let failPages = new Set();
  let dropAckOnce = false;
  let calls = 0;
  return {
    applied,
    failPages,
    get calls() { return calls; },
    dropNextAck() { dropAckOnce = true; },
    async requestPage(body) {
      calls += 1;
      if (failPages.has(calls)) {
        throw Object.assign(new Error("HTTP 500"), { status: 500, retryable: true });
      }
      for (const event of body.events) {
        const previous = applied.get(event.record.id);
        if (!previous || event.recordRevision >= previous.revision) {
          applied.set(event.record.id, { revision: event.recordRevision, record: event.record, seq: event.seq });
        }
      }
      const ack = {
        protocolVersion: 2,
        sourceStoreId: body.sourceStoreId,
        ackedThroughSeq: body.throughSeq,
        acceptedEventCount: body.events.length,
      };
      if (dropAckOnce) {
        dropAckOnce = false;
        throw Object.assign(new Error("response lost"), { status: 502, retryable: true });
      }
      return ack;
    },
  };
}

test("v2 ACK validation rejects ok:true and mismatched pages", () => {
  const request = buildPublishRecordSyncRequest({
    sourceStoreId: "src-a",
    workerId: "w1",
    afterSeq: 0,
    events: [{ seq: 1, recordRevision: 1, record: { id: "r1" } }],
  });
  assert.equal(isValidPublishRecordSyncAck(request, { ok: true }), false);
  assert.equal(isValidPublishRecordSyncAck(request, {
    protocolVersion: 2,
    sourceStoreId: "src-b",
    ackedThroughSeq: 1,
    acceptedEventCount: 1,
  }), false);
  assert.equal(isValidPublishRecordSyncAck(request, {
    protocolVersion: 2,
    sourceStoreId: "src-a",
    ackedThroughSeq: 1,
    acceptedEventCount: 1,
  }), true);
});

test("5000 records page at 200 and later updates including old createdAt", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-sync-"));
  const store = createPublishRecordStore({ workDir });
  withImmediateTransaction(store.database, () => {
    for (let index = 0; index < 5000; index += 1) {
      store.upsertRecordInTransaction(officialRecord(`r-${index}`, { createdAt: 1_500_000_000_000 + index }));
    }
  });
  const cloud = await memoryCloud();
  const first = await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: cloud.requestPage,
    maxPages: 30,
    maxMs: 60_000,
    retryDelays: [],
  });
  assert.equal(first.pages, 25);
  assert.equal(cloud.applied.size, 5000);
  store.upsertRecords([officialRecord("r-1", { createdAt: 1_500_000_000_001, status: "published", videoId: "v1", updatedAt: Date.now() })]);
  const second = await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: cloud.requestPage,
    maxPages: 5,
    retryDelays: [],
  });
  assert.equal(second.pages, 1);
  assert.equal(cloud.applied.get("r-1").record.status, "published");
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("failed third page resumes only unacked events", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-sync-fail-"));
  const store = createPublishRecordStore({ workDir });
  for (let index = 0; index < 601; index += 1) store.upsertRecords([officialRecord(`r-${index}`)]);
  const cloud = await memoryCloud();
  cloud.failPages.add(3);
  await assert.rejects(() => syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: cloud.requestPage,
    pageLimit: 200,
    maxPages: 10,
    retryDelays: [],
  }));
  assert.equal(store.getSyncState("factory:a").ackedSeq, 400);
  const resumed = await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: cloud.requestPage,
    pageLimit: 200,
    maxPages: 10,
    retryDelays: [],
  });
  assert.ok(resumed.ackedSeq >= 601);
  assert.equal(cloud.applied.size, 601);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("lost ACK replay does not create a second local watermark skip", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-sync-ack-"));
  const store = createPublishRecordStore({ workDir });
  store.upsertRecords([officialRecord("r1"), officialRecord("r2")]);
  const cloud = await memoryCloud();
  cloud.dropNextAck();
  await assert.rejects(() => syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: async (body) => {
      try {
        return await cloud.requestPage(body);
      } catch (error) {
        throw error;
      }
    },
    retryDelays: [],
  }));
  assert.equal(store.getSyncState("factory:a").ackedSeq, 0);
  assert.equal(cloud.applied.size, 2);
  await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: cloud.requestPage,
    retryDelays: [],
  });
  assert.equal(store.getSyncState("factory:a").ackedSeq, 2);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("lease blocks overlapping rounds and destinations stay isolated", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-sync-lease-"));
  const store = createPublishRecordStore({ workDir });
  store.upsertRecords([officialRecord("r1")]);
  const lease = store.acquireSyncLease("factory:a", { ownerToken: "other", ttlMs: 60_000 });
  assert.equal(lease.acquired, true);
  const blocked = await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: async () => ({ protocolVersion: 2, sourceStoreId: store.sourceStoreId(), ackedThroughSeq: 1, acceptedEventCount: 1 }),
  });
  assert.equal(blocked.skipped, true);
  store.releaseSyncLease("factory:a", "other");
  await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:b",
    requestPage: async (body) => ({
      protocolVersion: 2,
      sourceStoreId: body.sourceStoreId,
      ackedThroughSeq: body.throughSeq,
      acceptedEventCount: body.events.length,
    }),
  });
  assert.equal(store.getSyncState("factory:a").ackedSeq, 0);
  assert.equal(store.getSyncState("factory:b").ackedSeq, 1);
  store.pruneAckedOutbox();
  assert.equal(store.maxOutboxSeq(), 1);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("seq above the round upper bound waits for the next round", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-sync-upper-"));
  const store = createPublishRecordStore({ workDir });
  store.upsertRecords([officialRecord("r1"), officialRecord("r2")]);
  let capturedUpper = 0;
  await syncOfficialPublishRecordsRound({
    store,
    workerId: "w1",
    destinationKey: "factory:a",
    requestPage: async (body) => {
      capturedUpper = body.throughSeq;
      store.upsertRecords([officialRecord("r3")]);
      return {
        protocolVersion: 2,
        sourceStoreId: body.sourceStoreId,
        ackedThroughSeq: body.throughSeq,
        acceptedEventCount: body.events.length,
      };
    },
    retryDelays: [],
  });
  assert.ok(capturedUpper < store.maxOutboxSeq());
  assert.equal(store.getSyncState("factory:a").ackedSeq, capturedUpper);
  store.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});
