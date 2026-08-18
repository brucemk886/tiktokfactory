import { assembleOfficialNovelEffects } from "../../scripts/novel-effect-core.js";
import { audioItemsFromScripts } from "../../scripts/novel-overview.js";
import { errorJson, json, now, readJson, safeId } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import { getOfficialOperationSignals, readArchiveMeta, refreshOfficialArchive } from "./official-archive-store.js";

const PLATFORMS = ["GoodNovel", "MotoNovel", "NovelMaster"];
const DEFAULT_STRATEGY = {
  diagnosis: {
    sampleMinViews: 0, sampleMinHours: 0, earlyWindowSeconds: 3, earlyDropPoints: 30,
    comparisonDeltaPoints: 15, setupDropPoints: 20, middleWatchRatioThreshold: 35,
    compressMinPercent: 20, compressMaxPercent: 30
  },
  rewrite: {
    enabled: true, maxVariants: 2, preserveCharacters: true, preserveFacts: true,
    preserveEnding: true, localRewriteFirst: true, openingConflictWithinSeconds: 3,
    allowInventedPlot: false, evidenceRequired: true
  },
  audio: { enabled: true, provider: "elevenlabs", generateAfterRewrite: true, outputDirectory: "", keepOriginal: true },
  evaluation: { checkpointsHours: [24, 72, 168], baselineDays: 30, confidenceMinTests: 3, autoPromoteEnabled: true, autoDemoteEnabled: true },
  model: { primary: "sol", fallback: "deepseek-v4-flash", externalProviderEnabled: false, externalProviderBaseUrl: "", externalProviderModel: "" }
};

export async function handleNovels(request, env, url, session) {
  if (!session) return null;
  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/novel-content") {
    return json(await novelOverview(db, url.searchParams.get("query") || ""));
  }

  if (method === "POST" && pathname === "/api/novel-content/novels") {
    const novel = await createNovel(db, await readJson(request));
    return json({ novel }, 201);
  }

  const novelMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)$/);
  if (method === "GET" && novelMatch) {
    const novel = await getNovel(db, decodeURIComponent(novelMatch[1]));
    if (!novel) return errorJson("没有找到该小说。", 404);
    return json({ novel });
  }
  if (method === "PATCH" && novelMatch) {
    const novel = await updateNovel(db, decodeURIComponent(novelMatch[1]), await readJson(request));
    return json({ novel });
  }

  if (method === "GET" && pathname === "/api/novel-content/opening-styles") {
    return json({ styles: [] });
  }

  if (method === "GET" && pathname === "/api/novel-content/seed-settings") {
    return json({ settings: await kvGet(db, "novel-seed-settings", { autoSeedOnCreate: false }) });
  }
  if (method === "PUT" && pathname === "/api/novel-content/seed-settings") {
    return json({ settings: await kvSet(db, "novel-seed-settings", await readJson(request)) });
  }

  if (method === "GET" && pathname === "/api/novel-strategy") {
    return json(await getStrategy(db));
  }
  if (method === "PUT" && pathname === "/api/novel-strategy/draft") {
    const payload = await readJson(request);
    const state = await getStrategy(db);
    state.draft = deepMerge(state.draft, payload.policy || payload);
    state.draftUpdatedAt = new Date().toISOString();
    return json(await kvSet(db, "novel-strategy", state));
  }
  if (method === "POST" && pathname === "/api/novel-strategy/activate") {
    const payload = await readJson(request);
    const state = await getStrategy(db);
    const activatedAt = new Date().toISOString();
    const version = {
      id: `strategy_${activatedAt.replace(/\D/g, "")}_${crypto.randomUUID().slice(0, 8)}`,
      label: String(payload.label || `策略 ${state.versions.length + 1}`).slice(0, 80),
      note: String(payload.note || "").slice(0, 500),
      activatedAt,
      policy: state.draft
    };
    state.versions.unshift(version);
    state.activeVersionId = version.id;
    return json(await kvSet(db, "novel-strategy", state));
  }
  if (method === "POST" && pathname === "/api/novel-strategy/rollback") {
    const payload = await readJson(request);
    const state = await getStrategy(db);
    const version = state.versions.find((item) => item.id === String(payload.versionId || ""));
    if (!version) return errorJson("strategy version not found", 404);
    state.activeVersionId = version.id;
    state.draft = version.policy;
    state.draftUpdatedAt = new Date().toISOString();
    return json(await kvSet(db, "novel-strategy", state));
  }

  if (method === "GET" && pathname === "/api/novel-effects") {
    const source = url.searchParams.get("source") || "official_api";
    const query = url.searchParams.get("query") || "";
    const days = Math.max(1, Math.min(30, Math.floor(Number(url.searchParams.get("days") || 30))));
    if (source === "third_party") {
      const overview = await novelOverview(db, query);
      return json({
        ...overview,
        dataStatus: {
          source,
          label: "GeeLark third-party data",
          status: "ready",
          rawVideoCount: Number(overview?.summary?.videoCount || 0),
          mappedVideoCount: Number(overview?.summary?.videoCount || 0),
          days,
        },
      });
    }
    try {
      let meta = await readArchiveMeta(db);
      if (!meta.accountCount) {
        meta = await refreshOfficialArchive(env, db);
      }
      const signals = await getOfficialOperationSignals(db, { days, videosPerAccount: 100 });
      const store = await readStore(db);
      const records = await kvGet(db, "official-publish-records", []);
      const { videoMappings, ...page } = assembleOfficialNovelEffects({
        store,
        audioItems: audioItemsFromScripts(store.scripts),
        signals,
        records,
        query,
        days,
        label: "线上官方归档",
      });
      return json({
        ...page,
        dataStatus: {
          ...page.dataStatus,
          cacheUpdatedAt: meta.updatedAt,
          archiveDate: signals.archiveDate || meta.archiveDate,
        },
      });
    } catch (error) {
      return errorJson(error.message || "读取数据概览失败。", error.statusCode || 502);
    }
  }

  return null;
}

async function novelOverview(db, query) {
  const store = await readStore(db);
  const normalized = String(query || "").trim().toLowerCase();
  const novels = store.novels
    .map((novel) => ({
      ...novel,
      scripts: store.scripts.filter((script) => script.novelId === novel.id),
      performance: { videoCount: 0, totalViews: 0, averageViews: 0, maxViews: 0, comments: 0 }
    }))
    .filter((novel) => !normalized || [novel.id, novel.title, novel.platform, novel.promotionCode, novel.promotionCopy, novel.category, novel.sourceContent]
      .some((value) => String(value || "").toLowerCase().includes(normalized)));
  return {
    version: 1,
    summary: {
      novelCount: store.novels.length,
      scriptCount: store.scripts.length,
      audioCount: 0,
      videoCount: 0,
      unassignedScriptCount: store.scripts.filter((item) => !item.novelId).length
    },
    catalog: catalogSummary(novels),
    novels,
    unassignedScripts: store.scripts.filter((item) => !item.novelId)
  };
}

async function createNovel(db, payload) {
  const title = String(payload.title || "").trim().slice(0, 180);
  const sourceContent = String(payload.sourceContent || "").trim().slice(0, 200_000);
  if (!title) throw Object.assign(new Error("请填写小说名称。"), { statusCode: 400 });
  if (sourceContent.length < 20) throw Object.assign(new Error("小说内容至少需要 20 个字符。"), { statusCode: 400 });
  if (!PLATFORMS.includes(payload.platform)) throw Object.assign(new Error("请选择小说平台。"), { statusCode: 400 });
  const createdAt = new Date().toISOString();
  const novel = {
    id: safeId(`novel-${now()}`),
    title,
    platform: payload.platform,
    promotionCode: String(payload.promotionCode || "").trim().slice(0, 240),
    promotionCopy: String(payload.promotionCopy || "").trim().slice(0, 5_000),
    category: String(payload.category || "").trim().slice(0, 120),
    featured: Boolean(payload.featured),
    sourceContent,
    status: "active",
    createdAt,
    updatedAt: createdAt
  };
  const store = await readStore(db);
  store.novels.push(novel);
  await kvSet(db, "novel-content", store);
  return novel;
}

async function updateNovel(db, id, payload) {
  const store = await readStore(db);
  const novel = store.novels.find((item) => item.id === safeId(id));
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  if (payload.title !== undefined) novel.title = String(payload.title || "").trim().slice(0, 180) || novel.title;
  if (payload.platform !== undefined) {
    if (!PLATFORMS.includes(payload.platform)) throw Object.assign(new Error("请选择小说平台。"), { statusCode: 400 });
    novel.platform = payload.platform;
  }
  if (payload.promotionCode !== undefined) novel.promotionCode = String(payload.promotionCode || "").trim().slice(0, 240);
  if (payload.promotionCopy !== undefined) novel.promotionCopy = String(payload.promotionCopy || "").trim().slice(0, 5_000);
  if (payload.category !== undefined) novel.category = String(payload.category || "").trim().slice(0, 120);
  if (payload.featured !== undefined) novel.featured = Boolean(payload.featured);
  if (payload.sourceContent !== undefined) {
    const sourceContent = String(payload.sourceContent || "").trim().slice(0, 200_000);
    if (sourceContent.length < 20) throw Object.assign(new Error("小说内容至少需要 20 个字符。"), { statusCode: 400 });
    novel.sourceContent = sourceContent;
  }
  novel.updatedAt = new Date().toISOString();
  await kvSet(db, "novel-content", store);
  return novel;
}

async function getNovel(db, id) {
  const store = await readStore(db);
  return store.novels.find((item) => item.id === safeId(id)) || null;
}

export async function mergeImportedNovelStore(db, incoming = {}) {
  const current = await readStore(db);
  const novels = [...current.novels];
  const scripts = [...current.scripts];
  const novelIndex = new Map(novels.map((item, index) => [item.id, index]));
  const scriptIndex = new Map(scripts.map((item, index) => [item.id, index]));
  for (const novel of incoming.novels || []) {
    if (!novel?.id) continue;
    if (novelIndex.has(novel.id)) novels[novelIndex.get(novel.id)] = { ...novels[novelIndex.get(novel.id)], ...novel };
    else {
      novelIndex.set(novel.id, novels.length);
      novels.push(novel);
    }
  }
  for (const script of incoming.scripts || []) {
    if (!script?.id) continue;
    if (scriptIndex.has(script.id)) scripts[scriptIndex.get(script.id)] = { ...scripts[scriptIndex.get(script.id)], ...script };
    else {
      scriptIndex.set(script.id, scripts.length);
      scripts.push(script);
    }
  }
  await kvSet(db, "novel-content", { novels, scripts });
  return { novelCount: novels.length, scriptCount: scripts.length, importedNovelCount: (incoming.novels || []).length, importedScriptCount: (incoming.scripts || []).length };
}

async function readStore(db) {
  const store = await kvGet(db, "novel-content", { novels: [], scripts: [] });
  return {
    novels: Array.isArray(store.novels) ? store.novels : [],
    scripts: Array.isArray(store.scripts) ? store.scripts : []
  };
}

async function getStrategy(db) {
  const state = await kvGet(db, "novel-strategy", null);
  if (state && typeof state === "object") {
    return {
      schemaVersion: 1,
      activeVersionId: state.activeVersionId || null,
      draft: deepMerge(DEFAULT_STRATEGY, state.draft || {}),
      draftUpdatedAt: state.draftUpdatedAt || new Date().toISOString(),
      versions: Array.isArray(state.versions) ? state.versions : []
    };
  }
  return {
    schemaVersion: 1,
    activeVersionId: null,
    draft: structuredClone(DEFAULT_STRATEGY),
    draftUpdatedAt: new Date().toISOString(),
    versions: []
  };
}

function catalogSummary(novels) {
  const rows = Array.isArray(novels) ? novels : [];
  const group = (platform, items) => ({
    platform,
    novelCount: items.length,
    featuredCount: items.filter((item) => item.featured).length,
    hitCount: items.filter((item) => item.hit).length
  });
  return {
    platforms: PLATFORMS.map((platform) => group(platform, rows.filter((item) => item.platform === platform))),
    totals: group("all", rows)
  };
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) result[key] = deepMerge(base[key] || {}, value);
    else result[key] = value;
  }
  return result;
}
