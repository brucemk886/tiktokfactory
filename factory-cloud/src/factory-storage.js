import { buildFactoryStorageReport } from "../../scripts/factory-storage-report.js";
import { errorJson, json } from "./http.js";
import { kvGet, kvSet } from "./kv.js";

const SAMPLE_KEY = "factory-storage-sample";
const SAMPLE_CACHE_MS = 60 * 60 * 1000;
const MANUAL_REFRESH_MIN_MS = 5 * 60 * 1000;

export async function handleSignalDeskIntegration(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/integrations/signal-desk/storage") {
    await requireSignalDeskCaller(request, env);
    const force = url.searchParams.get("refresh") === "1";
    return json(await getFactoryStorageReport(env, env.DB, { force }));
  }
  return errorJson("未知的中台对接接口。", 404);
}

export async function getFactoryStorageReport(env, db, options = {}) {
  const cached = await kvGet(db, SAMPLE_KEY, null);
  const age = cached?.sampledAt ? Date.now() - Number(cached.sampledAt) : Number.POSITIVE_INFINITY;
  if (cached && age < SAMPLE_CACHE_MS && (!options.force || age < MANUAL_REFRESH_MIN_MS)) {
    return cached;
  }
  return collectFactoryStorageSample(env, db);
}

export async function collectFactoryStorageSample(env, db, sampledAt = Date.now()) {
  const counts = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM official_accounts_latest"),
    db.prepare("SELECT COALESCE(SUM(video_count), 0) AS n FROM official_accounts_latest"),
    db.prepare("SELECT COUNT(*) AS n FROM official_videos_latest"),
    db.prepare("SELECT COUNT(*) AS n FROM official_account_assignments"),
    db.prepare("SELECT COUNT(*) AS n FROM factory_jobs"),
    db.prepare("SELECT COUNT(*) AS n FROM factory_novels"),
    db.prepare("SELECT COUNT(*) AS n FROM official_ops_reports"),
  ]);
  const numberAt = (index) => Number(counts[index]?.results?.[0]?.n || 0);
  const r2 = await scanArchiveBucket(env?.ARCHIVE);
  const report = buildFactoryStorageReport({
    sampledAt,
    d1Bytes: await readD1Bytes(db),
    accounts: numberAt(0),
    videos: numberAt(1),
    leftoverVideos: numberAt(2),
    assignments: numberAt(3),
    jobs: numberAt(4),
    novels: numberAt(5),
    reports: numberAt(6),
    r2Bytes: r2.bytes,
    r2Objects: r2.objects,
  });
  await kvSet(db, SAMPLE_KEY, report);
  return report;
}

async function requireSignalDeskCaller(request, env) {
  const settings = await kvGet(env.DB, "official-settings", {});
  const expected = [
    String(settings.apiKey || "").trim(),
    String(env.SIGNAL_DESK_BRIDGE_KEY || "").trim(),
  ].filter(Boolean);
  const header = String(request.headers.get("authorization") || "");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !expected.includes(token)) {
    throw Object.assign(new Error("桥接密钥无效。"), { statusCode: 401 });
  }
}

async function readD1Bytes(db) {
  try {
    const [pages, pageSize] = await db.batch([
      db.prepare("PRAGMA page_count"),
      db.prepare("PRAGMA page_size"),
    ]);
    const first = (result) => Number(Object.values(result.results?.[0] || {})[0] || 0);
    return first(pages) * first(pageSize);
  } catch {
    return 0;
  }
}

async function scanArchiveBucket(bucket) {
  if (!bucket) return { objects: 0, bytes: 0 };
  let cursor;
  let objects = 0;
  let bytes = 0;
  for (let page = 0; page < 20; page += 1) {
    const listed = await bucket.list({ prefix: "official-archive/videos/", limit: 1000, cursor });
    for (const object of listed.objects || []) {
      objects += 1;
      bytes += Number(object.size || 0);
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return { objects, bytes };
}
