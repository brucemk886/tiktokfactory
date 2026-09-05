import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  number,
  officialHistoryDatabasePath,
  openOfficialHistoryDatabase,
  parseJson,
  withImmediateTransaction,
} from "./official-history-db.js";
import { createPublishRecordStore, slimOfficialRecord } from "./publish-record-store.js";
import {
  officialPublishJsonPath,
  officialPublishStoreEnabled,
  readJsonPublishRecords,
  writeOfficialPublishStoreState,
} from "./publish-record-runtime.js";
import { isOfficialTikTokPublishRecord } from "./publish-record-sources.js";
import { normalizeOfficialPublishRecord, officialRecordKey } from "./official-publish-records.js";

const DEFAULT_BATCH_SIZE = 200;

export function classifyPublishRecord(record) {
  if (!record || typeof record !== "object") return "invalid";
  if (isOfficialTikTokPublishRecord(record)) return "official";
  const provider = String(record.provider || "").trim().toLowerCase();
  const source = String(record.source || "").trim().toLowerCase();
  if (provider === "geelark" || source === "geelark" || record.envId || record.geelarkProfileId || record.accountSerialNo) {
    return "geelark";
  }
  if (provider || source) return "unknown";
  return "unknown";
}

export function classifyPublishRecords(records) {
  const official = [];
  const geelark = [];
  const unknown = [];
  const invalid = [];
  for (const record of Array.isArray(records) ? records : []) {
    const kind = classifyPublishRecord(record);
    if (kind === "official") official.push(record);
    else if (kind === "geelark") geelark.push(record);
    else if (kind === "invalid") invalid.push(record);
    else unknown.push(record);
  }
  return { official, geelark, unknown, invalid };
}

export function readPublishRecordsJsonStrict(filePath) {
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error(`Source publish-records JSON does not exist: ${filePath}`), { code: "SOURCE_MISSING" });
  }
  const text = fs.readFileSync(filePath, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error(`Source publish-records JSON is damaged: ${error.message || error}`), {
      code: "PUBLISH_RECORDS_JSON_DAMAGED",
    });
  }
  if (!Array.isArray(value)) {
    throw Object.assign(new Error("Source publish-records JSON is not an array."), { code: "PUBLISH_RECORDS_JSON_DAMAGED" });
  }
  return { records: value, digest: sha256(text), bytes: Buffer.byteLength(text, "utf8") };
}

export function dryRunOfficialPublishMigration({ workDir, sourcePath = "" } = {}) {
  const filePath = sourcePath || officialPublishJsonPath(workDir);
  const source = readPublishRecordsJsonStrict(filePath);
  const classified = classifyPublishRecords(source.records);
  const officialIds = new Map();
  const missingIds = [];
  const invalidDates = [];
  const snapshotDates = new Set();
  const accountKeys = new Set();
  let estimatedAccountSnapshots = 0;
  let estimatedVideoSnapshots = 0;
  for (const record of classified.official) {
    const id = officialRecordKey(normalizeOfficialPublishRecord(record) || record);
    if (!id) {
      missingIds.push(redactRecord(record));
      continue;
    }
    officialIds.set(id, (officialIds.get(id) || 0) + 1);
    const accountSnapshots = Array.isArray(record.officialAccountSnapshots) ? record.officialAccountSnapshots : [];
    const videoSnapshots = Array.isArray(record.officialVideoSnapshots) ? record.officialVideoSnapshots : [];
    for (const snapshot of accountSnapshots) {
      const dateKey = String(snapshot?.snapshotDate || "").trim();
      if (!dateKey) invalidDates.push({ id, kind: "account" });
      else {
        snapshotDates.add(`account:${record.connectionId || ""}:${dateKey}`);
        estimatedAccountSnapshots += 1;
      }
    }
    for (const snapshot of videoSnapshots) {
      const dateKey = String(snapshot?.snapshotDate || "").trim();
      if (!dateKey) invalidDates.push({ id, kind: "video" });
      else {
        snapshotDates.add(`video:${snapshot.id || record.videoId || ""}:${record.connectionId || ""}:${dateKey}`);
        estimatedVideoSnapshots += 1;
      }
    }
    if (record.connectionId) accountKeys.add(String(record.connectionId));
  }
  const duplicateIds = [...officialIds.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
  const statusCounts = {};
  for (const record of classified.official) {
    const status = String(record.status || "unknown");
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return {
    sourcePath: filePath,
    sourceDigest: source.digest,
    sourceBytes: source.bytes,
    total: source.records.length,
    official: classified.official.length,
    geelark: classified.geelark.length,
    unknown: classified.unknown.length,
    invalid: classified.invalid.length,
    uniqueOfficialIds: officialIds.size,
    duplicateIds,
    missingIds,
    invalidDates,
    statusCounts,
    accountCount: accountKeys.size,
    estimatedEmbeddedAccountSnapshots: estimatedAccountSnapshots,
    estimatedEmbeddedVideoSnapshots: estimatedVideoSnapshots,
    estimatedDedupedSnapshots: snapshotDates.size,
    unknownPreview: classified.unknown.slice(0, 20).map(redactRecord),
  };
}

export function importOfficialPublishRecords({
  workDir,
  sourcePath = "",
  batchSize = DEFAULT_BATCH_SIZE,
  batchId = "",
  skipOutbox = false,
} = {}) {
  const filePath = sourcePath || officialPublishJsonPath(workDir);
  const source = readPublishRecordsJsonStrict(filePath);
  const classified = classifyPublishRecords(source.records);
  const store = createPublishRecordStore({ workDir });
  const database = store.database;
  const importId = batchId || `import-${Date.now()}`;
  const startedAt = Date.now();
  const before = database.prepare("SELECT imported_count, exception_count, status FROM publishing_migrations WHERE id = ?").get(importId);
  if (before?.status === "imported" || before?.status === "completed-with-exceptions") {
    return {
      importId,
      alreadyCompleted: true,
      imported: Number(before.imported_count) || 0,
      exceptions: Number(before.exception_count) || 0,
    };
  }
  writeMigration(database, {
    id: importId,
    batchId: importId,
    status: "running",
    sourcePath: filePath,
    sourceDigest: source.digest,
    officialCount: classified.official.length,
    geelarkCount: classified.geelark.length,
    unknownCount: classified.unknown.length + classified.invalid.length,
    importedCount: 0,
    exceptionCount: 0,
    createdAt: startedAt,
  });
  for (const record of [...classified.unknown, ...classified.invalid]) {
    isolateException(database, importId, "unknown_or_invalid_source", record);
  }
  let imported = 0;
  let exceptions = classified.unknown.length + classified.invalid.length;
  for (let index = 0; index < classified.official.length; index += batchSize) {
    const slice = classified.official.slice(index, index + batchSize);
    withImmediateTransaction(database, () => {
      for (const record of slice) {
        try {
          store.upsertRecordInTransaction(record, { skipOutbox, operation: "import" });
          imported += 1;
        } catch (error) {
          isolateException(database, importId, error.code || error.message || "import_failed", record);
          exceptions += 1;
        }
      }
      writeMigration(database, {
        id: importId,
        batchId: importId,
        status: "running",
        sourcePath: filePath,
        sourceDigest: source.digest,
        officialCount: classified.official.length,
        geelarkCount: classified.geelark.length,
        unknownCount: classified.unknown.length + classified.invalid.length,
        importedCount: imported,
        exceptionCount: exceptions,
        createdAt: startedAt,
      });
    });
  }
  const afterJson = readPublishRecordsJsonStrict(filePath);
  if (afterJson.digest !== source.digest) {
    writeMigration(database, {
      id: importId,
      batchId: importId,
      status: "source-changed",
      sourcePath: filePath,
      sourceDigest: source.digest,
      officialCount: classified.official.length,
      geelarkCount: classified.geelark.length,
      unknownCount: classified.unknown.length + classified.invalid.length,
      importedCount: imported,
      exceptionCount: exceptions,
      error: "Source JSON changed during import.",
      createdAt: startedAt,
    });
    throw Object.assign(new Error("Source publish-records.json changed during import."), { code: "SOURCE_CHANGED" });
  }
  writeMigration(database, {
    id: importId,
    batchId: importId,
    status: exceptions ? "completed-with-exceptions" : "imported",
    sourcePath: filePath,
    sourceDigest: source.digest,
    officialCount: classified.official.length,
    geelarkCount: classified.geelark.length,
    unknownCount: classified.unknown.length + classified.invalid.length,
    importedCount: imported,
    exceptionCount: exceptions,
    createdAt: startedAt,
  });
  store.close();
  return {
    importId,
    imported,
    exceptions,
    official: classified.official.length,
    geelark: classified.geelark.length,
    unknown: classified.unknown.length + classified.invalid.length,
    sourceDigest: source.digest,
    lossless: exceptions === 0 && imported === classified.official.length,
    storeEnabled: officialPublishStoreEnabled(workDir),
  };
}

export function verifyOfficialPublishMigration({ workDir, sourcePath = "", importId = "" } = {}) {
  const filePath = sourcePath || officialPublishJsonPath(workDir);
  const source = readPublishRecordsJsonStrict(filePath);
  const classified = classifyPublishRecords(source.records);
  const store = createPublishRecordStore({ workDir });
  const missing = [];
  const mismatched = [];
  for (const record of classified.official) {
    const normalized = normalizeOfficialPublishRecord(record);
    const key = officialRecordKey(normalized || record);
    if (!key) {
      missing.push({ reason: "missing_id", preview: redactRecord(record) });
      continue;
    }
    const stored = store.getRecord(key);
    if (!stored) {
      missing.push({ id: key });
      continue;
    }
    const expected = slimOfficialRecord(normalized);
    if (String(stored.status || "") !== String(expected.status || "")) mismatched.push({ id: key, field: "status" });
    if (String(stored.connectionId || "") !== String(expected.connectionId || "")) mismatched.push({ id: key, field: "connectionId" });
    if (String(stored.videoId || "") !== String(expected.videoId || "")) mismatched.push({ id: key, field: "videoId" });
    if (String(stored.batchId || "") !== String(expected.batchId || "")) mismatched.push({ id: key, field: "batchId" });
    if (Number(stored.scheduleAt || 0) !== Number(expected.scheduleAt || 0)) mismatched.push({ id: key, field: "scheduleAt" });
    if (String(stored.dedupeKey || "") !== String(expected.dedupeKey || "")) mismatched.push({ id: key, field: "dedupeKey" });
    if (stored.officialVideoSnapshots || stored.officialAccountSnapshots) mismatched.push({ id: key, field: "embedded_snapshots" });
  }
  const afterSource = readPublishRecordsJsonStrict(filePath);
  const geelarkUnchanged = afterSource.digest === source.digest;
  const exceptions = store.database.prepare(
    "SELECT COUNT(*) AS n FROM publishing_migration_exceptions WHERE ? = '' OR batch_id = ?"
  ).get(importId, importId);
  const storedCount = store.database.prepare("SELECT COUNT(*) AS n FROM publishing_records WHERE provider = 'official'").get();
  store.close();
  return {
    officialSource: classified.official.length,
    storedOfficial: Number(storedCount?.n) || 0,
    missing,
    mismatched,
    exceptionCount: Number(exceptions?.n) || 0,
    geelarkUnchanged,
    lossless: !missing.length && !mismatched.length && Number(exceptions?.n || 0) === 0,
  };
}

export function exportOfficialRecordsForRollback({ workDir, outputPath, includeSnapshots = true } = {}) {
  const store = createPublishRecordStore({ workDir });
  const official = store.listRecords({ attachLatest: includeSnapshots, attachHistory: includeSnapshots }).records;
  const geelark = classifyPublishRecords(readJsonPublishRecords(workDir, { allowEmptyOnError: false })).geelark;
  const merged = [...official, ...geelark];
  const target = outputPath || path.join(String(workDir), `publish-records.rollback.${Date.now()}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(merged, null, 2), "utf8");
  store.close();
  return { outputPath: target, official: official.length, geelark: geelark.length };
}

export function backupSqliteConsistent(workDir, outputPath) {
  const options = workDir && typeof workDir === "object" ? workDir : { workDir, outputPath };
  const dir = options.workDir;
  const databasePath = officialHistoryDatabasePath(dir);
  const database = openOfficialHistoryDatabase(databasePath);
  const target = options.outputPath || outputPath || path.join(String(dir), "official-tiktok-history", `official-history.backup.${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  database.exec(`VACUUM INTO ${sqlLiteral(target)}`);
  return { outputPath: target, sourcePath: databasePath };
}

export function enableOfficialPublishStore(workDir, { importId = "", force = false } = {}) {
  const verified = verifyOfficialPublishMigration({ workDir, importId });
  if (!verified.lossless && !force) {
    throw Object.assign(new Error("Refusing to enable SQLite store before a lossless migration."), {
      code: "MIGRATION_NOT_LOSSLESS",
      verified,
    });
  }
  writeOfficialPublishStoreState(workDir, {
    enabled: true,
    enabledAt: Date.now(),
    importId,
    verified,
  });
  return { enabled: true, verified };
}

function writeMigration(database, value) {
  database.prepare(`
    INSERT INTO publishing_migrations (
      id, version, batch_id, status, source_path, source_digest, official_count, geelark_count,
      unknown_count, imported_count, exception_count, checksum, error, created_at, updated_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      source_digest = excluded.source_digest,
      official_count = excluded.official_count,
      geelark_count = excluded.geelark_count,
      unknown_count = excluded.unknown_count,
      imported_count = excluded.imported_count,
      exception_count = excluded.exception_count,
      checksum = excluded.checksum,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    value.id,
    value.batchId,
    value.status,
    value.sourcePath || "",
    value.sourceDigest || "",
    number(value.officialCount),
    number(value.geelarkCount),
    number(value.unknownCount),
    number(value.importedCount),
    number(value.exceptionCount),
    value.sourceDigest || "",
    value.error || "",
    number(value.createdAt) || Date.now(),
    Date.now(),
  );
}

function isolateException(database, batchId, reason, record) {
  database.prepare(`
    INSERT INTO publishing_migration_exceptions (batch_id, reason, public_id, record_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    batchId,
    String(reason || "unknown"),
    officialRecordKey(record) || "",
    JSON.stringify(record || {}),
    Date.now(),
  );
}

function redactRecord(record) {
  return {
    id: officialRecordKey(record) || "",
    provider: record?.provider || "",
    source: record?.source || "",
    status: record?.status || "",
    hasConnectionId: Boolean(record?.connectionId),
    hasVideoId: Boolean(record?.videoId),
    snapshotDates: (record?.officialAccountSnapshots || []).map((item) => item?.snapshotDate).filter(Boolean).length,
  };
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = { command: "", workDir: "", sourcePath: "", outputPath: "", importId: "", force: false };
  const rest = [...argv];
  options.command = String(rest.shift() || "");
  while (rest.length) {
    const flag = rest.shift();
    if (flag === "--work-dir") options.workDir = rest.shift();
    else if (flag === "--source") options.sourcePath = rest.shift();
    else if (flag === "--out") options.outputPath = rest.shift();
    else if (flag === "--import-id") options.importId = rest.shift();
    else if (flag === "--force") options.force = true;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.workDir) throw new Error("Missing --work-dir");
  if (options.command === "dry-run") return printJson(dryRunOfficialPublishMigration(options));
  if (options.command === "import") return printJson(importOfficialPublishRecords(options));
  if (options.command === "verify") return printJson(verifyOfficialPublishMigration(options));
  if (options.command === "export-rollback") return printJson(exportOfficialRecordsForRollback(options));
  if (options.command === "backup-sqlite") return printJson(backupSqliteConsistent(options));
  if (options.command === "enable") return printJson(enableOfficialPublishStore(options.workDir, options));
  throw new Error("Usage: node scripts/publish-record-migrate.js <dry-run|import|verify|export-rollback|backup-sqlite|enable> --work-dir <dir>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
