import fs from "node:fs";

export function resolveLocalAudioUploadPath(library, item = {}) {
  const audioId = String(item.audioId || item.id || "").trim();
  const candidates = [];
  if (audioId && typeof library?.resolveAudioPath === "function") {
    candidates.push(library.resolveAudioPath(audioId));
  }
  candidates.push(item.targetAudioPath);
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    try {
      if (fs.existsSync(value) && fs.statSync(value).isFile()) return value;
    } catch {
      // skip unreadable paths
    }
  }
  return "";
}
