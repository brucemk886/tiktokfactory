import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);

test("archive ingest upserts batches and only deletes named accounts", async () => {
  const [store, storage, index, official, novels] = await Promise.all([
    readFile(new URL("official-archive-store.js", root), "utf8"),
    readFile(new URL("factory-storage.js", root), "utf8"),
    readFile(new URL("index.js", root), "utf8"),
    readFile(new URL("official.js", root), "utf8"),
    readFile(new URL("novels.js", root), "utf8"),
  ]);
  assert.match(store, /export async function upsertOfficialAccounts/);
  assert.match(store, /export async function deleteOfficialAccounts/);
  assert.match(store, /export async function applyOfficialArchivePush/);
  assert.match(store, /refreshArchiveMeta/);
  assert.match(store, /COALESCE\(SUM\(video_count\), 0\)/);
  assert.doesNotMatch(store, /filter\(\(key\) => !keep\.has\(key\)\)/);
  assert.doesNotMatch(store, /prepare\("DELETE FROM official_videos_latest"\)/);
  assert.doesNotMatch(index, /refreshOfficialArchive/);
  assert.doesNotMatch(index, /official-archive-prefetch/);
  assert.match(storage, /\/api\/integrations\/signal-desk\/archive-accounts/);
  assert.match(storage, /applyOfficialArchivePush/);
  assert.match(official, /不会删除已有账号/);
  assert.match(official, /listAccountDirectory/);
  assert.doesNotMatch(official, /for \(let page = 0; page < 50;/);
  assert.doesNotMatch(official, /json_extract\(profile_json/);
  assert.doesNotMatch(store, /backfillAccountMetricsFromD1/);
  assert.match(store, /SELECT account_key, label, synced_at, video_count, views/);
  assert.doesNotMatch(store, /json_extract\(profile_json/);
  assert.match(official, /\/api\/v1\/publish\/stats/);
  assert.match(official, /attachPublishOutcome/);
  assert.match(novels, /hydrateOfficialPublishRecords/);
  assert.match(novels, /archiveAge > 30 \* 60 \* 1000/);
});

test("directory rows keep list fields without shipping full profile json", async () => {
  const { directoryAccountsFromRows } = await import("./official-archive-store.js");
  const [account] = directoryAccountsFromRows([{
    account_key: "acc-1",
    label: "@demo",
    username: "demo",
    displayName: "Demo",
    video_count: 12,
    synced_at: 100,
    views: 50
  }]);
  assert.equal(account.schema, "acc-1");
  assert.equal(account.profile.username, "demo");
  assert.equal(account.syncedVideoCount, 12);
});
