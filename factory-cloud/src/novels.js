import { assembleOfficialNovelEffects } from "../../scripts/novel-effect-core.js";
import { audioItemsFromScripts } from "../../scripts/novel-overview.js";
import { publicOpeningStyles } from "../../scripts/novel-opening-styles.js";
import { errorJson, json, now, randomToken, readJson, safeId } from "./http.js";
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
    const novel = await hydrateNovel(db, decodeURIComponent(novelMatch[1]));
    if (!novel) return errorJson("没有找到该小说。", 404);
    return json({ novel });
  }
  if (method === "PATCH" && novelMatch) {
    const novel = await updateNovel(db, decodeURIComponent(novelMatch[1]), await readJson(request));
    return json({ novel });
  }

  const scriptMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/scripts$/);
  if (method === "POST" && scriptMatch) {
    const script = await createScript(db, decodeURIComponent(scriptMatch[1]), await readJson(request));
    return json({ script }, 201);
  }

  const mixMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/mix-audios$/);
  if (method === "PUT" && mixMatch) {
    const payload = await readJson(request);
    const novel = await setNovelMixAudios(db, decodeURIComponent(mixMatch[1]), payload.scriptIds);
    return json({ novel });
  }

  if (method === "GET" && pathname === "/api/novel-content/opening-styles") {
    return json({ styles: publicOpeningStyles(), version: 3 });
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
      audioCount: store.scripts.filter((item) => item.audioId || item.audio?.id).length,
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
  return store.novels.find((item) => item.id === String(id || "").trim() || item.id === safeId(id)) || null;
}

export async function hydrateNovel(db, id) {
  const store = await readStore(db);
  const novel = store.novels.find((item) => item.id === String(id || "").trim() || item.id === safeId(id));
  if (!novel) return null;
  return {
    ...novel,
    scripts: store.scripts.filter((item) => item.novelId === novel.id)
  };
}

async function createScript(db, novelId, payload = {}) {
  const store = await readStore(db);
  const novel = store.novels.find((item) => item.id === String(novelId || "").trim() || item.id === safeId(novelId));
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const text = String(payload.text || "").trim().slice(0, 20_000);
  if (text.length < 20) throw Object.assign(new Error("改写文案至少需要 20 个字符。"), { statusCode: 400 });
  const createdAt = new Date().toISOString();
  const script = {
    id: safeId(`script-${now()}-${randomToken(3)}`),
    novelId: novel.id,
    parentScriptId: String(payload.parentScriptId || "").trim(),
    audioId: "",
    title: String(payload.title || `${novel.title} 改写`).trim().slice(0, 240),
    text,
    versionLabel: String(payload.versionLabel || "人工改写").trim().slice(0, 100),
    sourceType: String(payload.sourceType || "manual-rewrite").trim().slice(0, 80),
    openingTitle: String(payload.openingTitle || "").trim().slice(0, 80),
    mixEnabled: true,
    createdAt,
    updatedAt: createdAt
  };
  store.scripts.push(script);
  await kvSet(db, "novel-content", store);
  return script;
}

async function setNovelMixAudios(db, novelId, scriptIds) {
  const store = await readStore(db);
  const novel = store.novels.find((item) => item.id === String(novelId || "").trim() || item.id === safeId(novelId));
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const wanted = new Set((Array.isArray(scriptIds) ? scriptIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  const novelScripts = store.scripts.filter((item) => item.novelId === novel.id);
  if (!novelScripts.length) throw Object.assign(new Error("这本小说还没有可勾选的改写文案。"), { statusCode: 400 });
  const unknown = [...wanted].filter((id) => !novelScripts.some((item) => item.id === id));
  if (unknown.length) throw Object.assign(new Error("勾选的音频不属于这本小说。"), { statusCode: 400 });
  const timestamp = new Date().toISOString();
  for (const script of novelScripts) {
    script.mixEnabled = wanted.has(script.id);
    script.updatedAt = timestamp;
  }
  await kvSet(db, "novel-content", store);
  return hydrateNovel(db, novel.id);
}

export async function resolveNovelTitle(db, { novelId = "", novelTitle = "" } = {}) {
  const title = String(novelTitle || "").trim();
  if (title) return title;
  const store = await readStore(db);
  const novel = store.novels.find((item) => item.id === String(novelId || "").trim() || item.id === safeId(novelId));
  return String(novel?.title || "").trim();
}

export async function buildAudioGeneratePayload(db, body = {}) {
  const store = await readStore(db);
  const requested = Array.isArray(body.items) && body.items.length
    ? body.items
    : (Array.isArray(body.scriptIds) ? body.scriptIds.map((id) => ({ scriptId: id, novelId: body.novelId })) : [body]);
  const items = [];
  for (const raw of requested) {
    const scriptId = String(raw.scriptId || "").trim();
    const script = store.scripts.find((item) => item.id === scriptId);
    const text = String(raw.script || raw.text || script?.text || "").trim();
    if (text.length < 20) continue;
    const novelId = String(raw.novelId || script?.novelId || body.novelId || "").trim();
    const novel = store.novels.find((item) => item.id === novelId);
    items.push({
      novelId: novel?.id || script?.novelId || novelId,
      novelTitle: String(raw.novelTitle || novel?.title || body.novelTitle || "").trim(),
      scriptId: script?.id || scriptId,
      audioId: raw.audioId || script?.audioId || script?.audio?.id || "",
      fileName: raw.fileName || script?.audio?.fileName || "",
      targetAudioPath: raw.targetAudioPath || script?.audio?.targetAudioPath || "",
      title: String(raw.title || `${novel?.title || ""} ${script?.versionLabel || "改写"}`).trim(),
      script: text,
      openingTitle: String(raw.openingTitle || script?.openingTitle || "").trim(),
      voiceId: String(raw.voiceId || body.voiceId || "").trim(),
      speechSpeed: raw.speechSpeed ?? body.speechSpeed,
      sourceType: String(raw.sourceType || script?.sourceType || "manual-rewrite").trim()
    });
  }
  if (!items.length) {
    throw Object.assign(new Error("没有可下发的改写文案。请先保存文案，或勾选有正文的版本。"), { statusCode: 400 });
  }
  return {
    targetAudioDir: String(body.targetAudioDir || "").trim(),
    novelTitle: String(body.novelTitle || items[0]?.novelTitle || "").trim(),
    voiceId: String(body.voiceId || "").trim(),
    speechSpeed: body.speechSpeed,
    items
  };
}

export async function attachAudioGenerateResults(db, items = []) {
  const store = await readStore(db);
  let changed = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const script = store.scripts.find((row) => row.id === String(item.scriptId || "").trim());
    if (!script || !item.audioId) continue;
    script.audioId = item.audioId;
    script.audio = {
      id: item.audioId,
      title: item.title || script.title,
      fileName: item.fileName || "",
      targetAudioPath: item.targetAudioPath || "",
      duration: Number(item.duration) || 0,
      size: Number(item.size) || 0,
      createdAt: item.createdAt || new Date().toISOString()
    };
    script.updatedAt = new Date().toISOString();
    changed += 1;
  }
  if (changed) await kvSet(db, "novel-content", store);
  return changed;
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
