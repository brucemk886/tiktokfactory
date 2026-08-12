export function isOfficialTikTokPublishRecord(record) {
  const provider = String(record?.provider || "").trim().toLowerCase();
  const source = String(record?.source || "").trim().toLowerCase();
  return provider === "official" || source === "official-tiktok";
}

export function filterPublishRecordsBySource(records, source) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((record) => source === "official"
    ? isOfficialTikTokPublishRecord(record)
    : !isOfficialTikTokPublishRecord(record));
}

export function collectOfficialBatchIdsFromRecords(records) {
  const ids = (Array.isArray(records) ? records : []).flatMap((record) => [
    ...(Array.isArray(record?.officialBatchIds) ? record.officialBatchIds : []),
    ...(Array.isArray(record?.taskIds) ? record.taskIds : []),
    record?.batchId
  ]);
  return Array.from(new Set(ids.map((value) => String(value || "").trim()).filter(Boolean)));
}
