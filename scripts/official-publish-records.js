export function mergeOfficialPublishRecords(existing, incoming) {
  const byId = new Map();
  for (const record of Array.isArray(existing) ? existing : []) {
    if (!isMatchableOfficialRecord(record)) continue;
    const id = String(record.id || record.dedupeKey || "");
    if (id) byId.set(id, record);
  }
  for (const record of Array.isArray(incoming) ? incoming : []) {
    if (!isMatchableOfficialRecord(record)) continue;
    const id = String(record.id || record.dedupeKey || "");
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...record });
  }
  return Array.from(byId.values()).slice(0, 3000);
}

export function isMatchableOfficialRecord(record) {
  if (!record || typeof record !== "object") return false;
  return Boolean(
    record.videoId
    || record.tiktokVideoId
    || record.audioLibraryId
    || record.audioId
    || record.sourceAudioId
    || record.audioName
    || record.scriptId
    || record.novelId
  );
}
