import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);

test("archive ingest upserts batches and only deletes named accounts", async () => {
  const [store, storage, index, official] = await Promise.all([
    readFile(new URL("official-archive-store.js", root), "utf8"),
    readFile(new URL("factory-storage.js", root), "utf8"),
    readFile(new URL("index.js", root), "utf8"),
    readFile(new URL("official.js", root), "utf8"),
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
});
