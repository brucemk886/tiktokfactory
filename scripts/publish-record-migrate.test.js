import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  backupSqliteConsistent,
  classifyPublishRecords,
  dryRunOfficialPublishMigration,
  importOfficialPublishRecords,
  readPublishRecordsJsonStrict,
  verifyOfficialPublishMigration,
} from "./publish-record-migrate.js";
import { closeOfficialHistoryDatabase, officialHistoryDatabasePath } from "./official-history-db.js";
import { officialPublishJsonPath } from "./publish-record-runtime.js";
import { createPublishRecordStore } from "./publish-record-store.js";

function writeMixed(workDir, officialCount, extra = []) {
  const official = Array.from({ length: officialCount }, (_, index) => ({
    id: `official-${index}`,
    provider: "official",
    source: "official-tiktok",
    status: index % 2 ? "published" : "submitted",
    connectionId: `acc-${index % 5}`,
    videoId: index % 2 ? `v-${index}` : "",
    fileName: `cut-${index}.mp4`,
    createdAt: 1_700_000_000_000 + index,
    scheduleAt: 1_700_000_000 + index,
    dedupeKey: `official-${index}`,
    batchId: `batch-${Math.floor(index / 10)}`,
    mystery: "kept",
  }));
  const geelark = [
    { id: "gee-1", provider: "geelark", source: "geelark", envId: "phone-1", status: "done", fileName: "g.mp4" },
  ];
  const records = [...official, ...geelark, ...extra];
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(officialPublishJsonPath(workDir), JSON.stringify(records), "utf8");
  return { official, geelark, records };
}

test("classifier keeps GeeLark out of the official import set", () => {
  const classified = classifyPublishRecords([
    { id: "o1", provider: "official" },
    { id: "g1", provider: "geelark", envId: "e1" },
    { id: "u1", title: "mystery" },
  ]);
  assert.deepEqual(classified.official.map((item) => item.id), ["o1"]);
  assert.deepEqual(classified.geelark.map((item) => item.id), ["g1"]);
  assert.deepEqual(classified.unknown.map((item) => item.id), ["u1"]);
});

test("dry-run and import leave the mixed JSON untouched", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-migrate-"));
  const { records } = writeMixed(workDir, 8, [{ title: "unknown-row" }]);
  const before = fs.readFileSync(officialPublishJsonPath(workDir), "utf8");
  const dry = dryRunOfficialPublishMigration({ workDir });
  assert.equal(dry.official, 8);
  assert.equal(dry.geelark, 1);
  assert.equal(dry.unknown, 1);
  const imported = importOfficialPublishRecords({ workDir, batchId: "batch-1" });
  assert.equal(imported.imported, 8);
  assert.equal(imported.exceptions, 1);
  assert.equal(imported.lossless, false);
  assert.equal(fs.readFileSync(officialPublishJsonPath(workDir), "utf8"), before);
  const again = importOfficialPublishRecords({ workDir, batchId: "batch-1" });
  assert.equal(again.alreadyCompleted, true);
  const store = createPublishRecordStore({ workDir });
  assert.equal(store.listRecords().records.length, 8);
  assert.equal(store.getRecord("official-0").mystery, "kept");
  store.close();
  assert.deepEqual(JSON.parse(before).map((item) => item.id), records.map((item) => item.id));
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("damaged JSON fails instead of importing an empty set", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-bad-"));
  fs.writeFileSync(officialPublishJsonPath(workDir), "{not-json", "utf8");
  assert.throws(() => readPublishRecordsJsonStrict(officialPublishJsonPath(workDir)), /damaged/);
  assert.throws(() => importOfficialPublishRecords({ workDir }), /damaged/);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("import 0 and 488 official records and verify lossless when no unknowns", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-empty-"));
  fs.writeFileSync(officialPublishJsonPath(emptyDir), "[]", "utf8");
  const empty = importOfficialPublishRecords({ workDir: emptyDir, batchId: "empty" });
  assert.equal(empty.imported, 0);
  assert.equal(empty.lossless, true);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-488-"));
  writeMixed(workDir, 488);
  const imported = importOfficialPublishRecords({ workDir, batchId: "n488" });
  assert.equal(imported.imported, 488);
  const verified = verifyOfficialPublishMigration({ workDir, importId: "n488" });
  assert.equal(verified.storedOfficial, 488);
  assert.equal(verified.geelarkUnchanged, true);
  assert.equal(verified.lossless, true);
  fs.rmSync(emptyDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("backup-sqlite CLI options object writes beside the real work dir", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-backup-"));
  writeMixed(workDir, 1);
  importOfficialPublishRecords({ workDir, batchId: "backup-cli" });
  const first = backupSqliteConsistent({ workDir });
  assert.match(first.outputPath, /official-history\.backup\.\d+\.sqlite$/);
  assert.ok(first.outputPath.startsWith(workDir));
  assert.ok(fs.existsSync(first.outputPath));
  const named = path.join(workDir, "official-tiktok-history", "named-backup.sqlite");
  const second = backupSqliteConsistent({ workDir, outputPath: named });
  assert.equal(second.outputPath, named);
  assert.ok(fs.existsSync(named));
  closeOfficialHistoryDatabase(officialHistoryDatabasePath(workDir));
  fs.rmSync(workDir, { recursive: true, force: true });
});
