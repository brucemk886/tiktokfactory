import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planPeerHitPublishedAtWrites } from "../../scripts/peer-hits.js";

const apply = process.argv.includes("--apply");
const wranglerJs = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

function d1(command) {
  const out = execFileSync(process.execPath, [
    wranglerJs, "d1", "execute", "factory-prod", "--remote", "--config", "wrangler.jsonc", "--json",
    "--command", command
  ], { cwd: root, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
  return JSON.parse(out)[0];
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const rows = d1("SELECT id, video_url, video_data_json FROM factory_peer_hits").results || [];
const hits = rows.map((row) => {
  let videoData = {};
  try {
    videoData = JSON.parse(row.video_data_json || "{}") || {};
  } catch {
    videoData = {};
  }
  return { id: row.id, videoUrl: row.video_url, videoData };
});
const writes = planPeerHitPublishedAtWrites(hits);
console.log(JSON.stringify({
  total: hits.length,
  write: writes.length,
  apply,
  sample: writes.slice(0, 5).map((item) => ({
    id: item.id,
    publishedAt: item.publishedAt,
    iso: item.publishedAt ? new Date(item.publishedAt).toISOString() : ""
  }))
}, null, 2));

if (!apply || !writes.length) process.exit(0);

const batchSize = 25;
for (let offset = 0; offset < writes.length; offset += batchSize) {
  const batch = writes.slice(offset, offset + batchSize);
  const sql = batch.map((item) => (
    `UPDATE factory_peer_hits SET video_data_json = ${sqlString(JSON.stringify(item.hit.videoData))} WHERE id = ${sqlString(item.id)};`
  )).join("\n");
  d1(sql);
  console.log(`wrote ${Math.min(offset + batch.length, writes.length)}/${writes.length}`);
}
