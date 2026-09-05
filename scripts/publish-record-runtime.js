import fs from "node:fs";
import path from "node:path";
import { createPublishRecordStore } from "./publish-record-store.js";
import { filterPublishRecordsBySource, isOfficialTikTokPublishRecord } from "./publish-record-sources.js";

const STORE_STATE_NAME = "official-publish-store.json";
const stores = new Map();

export function officialPublishStoreStatePath(workDir) {
  return path.join(String(workDir || ""), STORE_STATE_NAME);
}

export function officialPublishJsonPath(workDir) {
  return path.join(String(workDir || ""), "publish-records.json");
}

export function officialPublishStoreEnabled(workDir) {
  if (String(process.env.OFFICIAL_PUBLISH_STORE || "").trim().toLowerCase() === "sqlite") return true;
  try {
    const state = JSON.parse(fs.readFileSync(officialPublishStoreStatePath(workDir), "utf8"));
    return state?.enabled === true;
  } catch {
    return false;
  }
}

export function writeOfficialPublishStoreState(workDir, state) {
  const filePath = officialPublishStoreStatePath(workDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    enabled: false,
    ...state,
    updatedAt: Date.now(),
  }, null, 2), "utf8");
}

export function getPublishRecordStore(workDir) {
  const key = path.resolve(String(workDir || ""));
  if (!stores.has(key)) stores.set(key, createPublishRecordStore({ workDir: key }));
  return stores.get(key);
}

export function closePublishRecordStore(workDir) {
  const key = path.resolve(String(workDir || ""));
  const store = stores.get(key);
  if (!store) return;
  store.close();
  stores.delete(key);
}

export function readJsonPublishRecords(workDir, { allowEmptyOnError = true } = {}) {
  const filePath = officialPublishJsonPath(workDir);
  if (!fs.existsSync(filePath)) return [];
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (allowEmptyOnError) return [];
    throw error;
  }
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) {
      if (allowEmptyOnError) return [];
      throw new Error("publish-records.json is not an array.");
    }
    return value;
  } catch (error) {
    if (allowEmptyOnError) return [];
    throw Object.assign(new Error(`publish-records.json is damaged: ${error.message || error}`), { code: "PUBLISH_RECORDS_JSON_DAMAGED" });
  }
}

export function writeJsonPublishRecords(workDir, records) {
  const filePath = officialPublishJsonPath(workDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

export function writeGeelarkPublishRecords(workDir, records) {
  const geelark = (Array.isArray(records) ? records : []).filter((record) => !isOfficialTikTokPublishRecord(record));
  writeJsonPublishRecords(workDir, geelark);
}

export function readAllPublishRecords(workDir) {
  const jsonRecords = readJsonPublishRecords(workDir);
  if (!officialPublishStoreEnabled(workDir)) return jsonRecords;
  const geelark = filterPublishRecordsBySource(jsonRecords, "geelark");
  const official = getPublishRecordStore(workDir).listRecords({ attachLatest: true }).records;
  return [...official, ...geelark];
}

export function readOfficialRuntimeRecords(workDir, options = {}) {
  if (officialPublishStoreEnabled(workDir)) {
    return getPublishRecordStore(workDir).listRecords({ attachLatest: options.attachLatest === true, attachHistory: options.attachHistory === true }).records;
  }
  return filterPublishRecordsBySource(readJsonPublishRecords(workDir), "official");
}

export function upsertOfficialRuntimeRecords(workDir, records) {
  const incoming = Array.isArray(records) ? records : [];
  if (!incoming.length) return [];
  if (officialPublishStoreEnabled(workDir)) {
    return getPublishRecordStore(workDir).upsertRecords(incoming);
  }
  const current = readJsonPublishRecords(workDir);
  const incomingIds = new Set(incoming.map((record) => String(record?.id || "")));
  const previousById = new Map(current.map((record) => [String(record?.id || ""), record]));
  const mergedIncoming = incoming.map((record) => ({
    ...previousById.get(String(record.id || "")),
    ...record,
    createdAt: Number(previousById.get(String(record.id || ""))?.createdAt) || record.createdAt,
  }));
  writeJsonPublishRecords(workDir, [...mergedIncoming, ...current.filter((record) => !incomingIds.has(String(record?.id || "")))]);
  return mergedIncoming;
}

export function patchOfficialRuntimeRecords(workDir, patches) {
  const incoming = Array.isArray(patches) ? patches : [];
  if (!incoming.length) return [];
  if (officialPublishStoreEnabled(workDir)) {
    return getPublishRecordStore(workDir).patchRecords(incoming);
  }
  const current = readJsonPublishRecords(workDir);
  const byId = new Map(incoming.map((item) => [String(item.id || ""), item]));
  writeJsonPublishRecords(workDir, current.map((record) => {
    const patch = byId.get(String(record.id || ""));
    return patch ? { ...record, ...patch } : record;
  }));
  return incoming;
}

export function writeOfficialRuntimeRecords(workDir, records) {
  const incoming = Array.isArray(records) ? records : [];
  if (officialPublishStoreEnabled(workDir)) {
    const official = incoming.filter((record) => isOfficialTikTokPublishRecord(record));
    const geelark = incoming.filter((record) => !isOfficialTikTokPublishRecord(record));
    if (official.length) getPublishRecordStore(workDir).upsertRecords(official);
    if (geelark.length) {
      const existingGeelark = filterPublishRecordsBySource(readJsonPublishRecords(workDir), "geelark");
      const incomingIds = new Set(geelark.map((record) => String(record?.id || "")));
      writeJsonPublishRecords(workDir, [
        ...geelark,
        ...existingGeelark.filter((record) => !incomingIds.has(String(record?.id || ""))),
      ]);
    }
    return incoming;
  }
  writeJsonPublishRecords(workDir, incoming);
  return incoming;
}

export function listRecordsForOutputCleanup(workDir) {
  if (!officialPublishStoreEnabled(workDir)) return readJsonPublishRecords(workDir);
  const geelark = filterPublishRecordsBySource(readJsonPublishRecords(workDir), "geelark");
  const official = getPublishRecordStore(workDir).listFileRetentionRecords();
  return [...official, ...geelark];
}
