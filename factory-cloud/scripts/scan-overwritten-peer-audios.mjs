import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shouldRestorePeerSourceAudio } from "../../scripts/peer-audio-restore.js";

const wranglerJs = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

function d1(command) {
  const out = execFileSync(process.execPath, [
    wranglerJs, "d1", "execute", "factory-prod", "--remote", "--config", "wrangler.jsonc", "--json",
    "--command", command
  ], { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  return JSON.parse(out)[0];
}

const store = JSON.parse(d1("SELECT value_json FROM factory_kv WHERE key = 'novel-content'").results?.[0]?.value_json || "{}");
const hits = d1("SELECT id, audio_id, audio_size, audio_name FROM factory_peer_hits").results || [];
const hitById = new Map(hits.map((row) => [String(row.id || ""), row]));
const scripts = (store.scripts || []).filter((script) => script.sourceType === "peer-hit");
const candidates = [];
let sameId = 0;
for (const script of scripts) {
  const hit = hitById.get(String(script.peerHitId || ""));
  const destId = String(script.audioId || script.audio?.id || "").trim();
  const sourceId = String(hit?.audio_id || "").trim();
  const destSize = Number(script.audio?.size || 0);
  const sourceSize = Number(hit?.audio_size || 0);
  const destDuration = Number(script.audio?.duration || 0);
  if (sourceId && destId && sourceId === destId) {
    if (destDuration > 0 && destDuration <= 15 && destSize && destSize < 200 * 1024) sameId += 1;
    continue;
  }
  if (!shouldRestorePeerSourceAudio({ destSize, sourceSize, destDuration })) continue;
  candidates.push({
    scriptId: script.id,
    novelId: script.novelId,
    destId,
    sourceId,
    destSize,
    sourceSize,
    destDuration: Math.round(destDuration * 10) / 10,
    title: script.openingTitle || script.versionLabel || ""
  });
}

const short = scripts.filter((script) => {
  const size = Number(script.audio?.size || 0);
  const duration = Number(script.audio?.duration || 0);
  return (duration > 0 && duration <= 20) || (size > 0 && size < 200 * 1024);
}).map((script) => {
  const hit = hitById.get(String(script.peerHitId || ""));
  return {
    scriptId: script.id,
    destId: String(script.audioId || script.audio?.id || ""),
    sourceId: String(hit?.audio_id || ""),
    destSize: Number(script.audio?.size || 0),
    sourceSize: Number(hit?.audio_size || 0),
    destDuration: Math.round(Number(script.audio?.duration || 0) * 10) / 10
  };
});

console.log(JSON.stringify({
  peerScripts: scripts.length,
  peerHitsWithAudio: hits.filter((row) => row.audio_id).length,
  candidates: candidates.length,
  sameIdShort: sameId,
  short: short.length,
  shortItems: short,
  sample: candidates.slice(0, 20)
}, null, 2));
