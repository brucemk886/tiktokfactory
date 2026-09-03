import fs from "node:fs";

// A secondary worker reads the primary's libraries over SMB, but task payloads
// (and the cloud's saved settings) carry the primary's absolute paths such as
// F:\音频目录\0708. config.pathAliases maps those prefixes to what this machine
// can reach, e.g. { "F:/音频目录": "//PRIMARY/factory-audio" }. A path is only
// rewritten when it does not exist locally, so the primary itself is unaffected.

const PAYLOAD_PATH_KEYS = ["videoDir", "audioDir", "backgroundMusicDir", "overlayDir", "targetAudioDir"];

function normalize(value) {
  return String(value || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

function toWindows(value) {
  const text = String(value || "");
  const unc = /^[\\/]{2}/.test(text) ? "\\\\" : "";
  return unc + text.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
}

export function normalizePathAliases(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([from, to]) => ({ from: normalize(from), to: toWindows(to) }))
    .filter((item) => item.from && item.to)
    // Longest prefix first so "F:/音频目录/子目录" wins over "F:/音频目录".
    .sort((left, right) => right.from.length - left.from.length);
}

export function remapPath(value, aliases, { exists = fs.existsSync } = {}) {
  const text = String(value || "").trim();
  if (!text) return text;
  const list = Array.isArray(aliases) ? aliases : normalizePathAliases(aliases);
  if (!list.length) return text;
  if (exists(text)) return text;
  const normalized = normalize(text);
  const lower = normalized.toLowerCase();
  for (const alias of list) {
    const from = alias.from.toLowerCase();
    if (lower === from) return alias.to;
    if (lower.startsWith(`${from}/`)) {
      return `${alias.to}\\${toWindows(normalized.slice(alias.from.length + 1))}`;
    }
  }
  return text;
}

export function remapPayloadPaths(payload, aliases, options = {}) {
  const list = Array.isArray(aliases) ? aliases : normalizePathAliases(aliases);
  if (!list.length || !payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  for (const key of PAYLOAD_PATH_KEYS) {
    if (typeof out[key] === "string" && out[key]) out[key] = remapPath(out[key], list, options);
  }
  if (Array.isArray(out.audioDirs)) out.audioDirs = out.audioDirs.map((dir) => remapPath(dir, list, options));
  if (out.dedup && typeof out.dedup === "object" && typeof out.dedup.overlayDir === "string" && out.dedup.overlayDir) {
    out.dedup = { ...out.dedup, overlayDir: remapPath(out.dedup.overlayDir, list, options) };
  }
  if (Array.isArray(out.audioItems)) {
    out.audioItems = out.audioItems.map((item) => {
      if (!item || typeof item !== "object") return item;
      const next = { ...item };
      for (const key of ["path", "file", "targetAudioPath"]) {
        if (typeof next[key] === "string" && next[key]) next[key] = remapPath(next[key], list, options);
      }
      return next;
    });
  }
  return out;
}
