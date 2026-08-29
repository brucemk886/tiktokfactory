import { assembleOfficialNovelEffects, slimEffectsPage } from "../../scripts/novel-effect-core.js";
import { applyFeishuCatalogImport } from "../../scripts/feishu-novel-import.js";
import { audioItemsFromScripts, dropDraftScripts, removeDraftScriptsById, removeScriptsById, scriptHasAudio } from "../../scripts/novel-overview.js";
import {
  isImportedAudioFile,
  planImportedAudioAssignments,
  uploadedAudioOpeningTitle,
  uploadedAudioScriptText
} from "../../scripts/novel-audio-import.js";
import { copyNovelAudio, deleteNovelAudio, putNovelAudio } from "./novel-audio-archive.js";
import { attachPeerHitTimes, attachScaleRunMarks, collapseDuplicateAudioScripts, importedClipFingerprintsByNovel, importedPeerHitIdSet, importedSourceTokensByNovel, peerVideosForScript, planPeerHitNovelImports, scaleRunForScript, takeDuplicateAudioScripts } from "../../scripts/peer-hits.js";
import { attachNovelHitStats, buildAudioHitWeights, buildOwnHitSnapshot } from "../../scripts/novel-hit-scores.js";
import { listPeerHitRows } from "./peer-hits-store.js";
import {
  BATCH_AUDIO_MIN_SOURCE,
  batchOpeningStyleIds,
  openingVariantScriptPayloads,
  remainingAudioVersionCount,
  uniqueNovelIds
} from "../../scripts/novel-batch-audio.js";
import { publicOpeningStyles } from "../../scripts/novel-opening-styles.js";
import { fetchFeishuCatalogBooks, feishuStatus } from "./feishu-sheets.js";
import { errorJson, json, now, randomToken, readJson, safeId } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import { countNovels, deleteNovelRow, getNovelRow, insertNovels, listNovelMatchIndex, listNovelScripts, listNovelSummaries, listNovels, listNovelsMatchingPeerHits, listWorkingNovelSummaries, markNovelsWorking, migrateNovelsFromKv, syncWorkingNovels, updateNovelBookId, upsertNovel, writeScripts } from "./novel-store.js";
import { archiveAccountKeysForProject, uniqueProjectAccountCount } from "../../scripts/official-account-group-store.js";
import { loadGroupStore } from "./official.js";
import { getOfficialOperationSignals, listLatestArchiveAccounts, readArchiveMeta, refreshOfficialArchive } from "./official-archive-store.js";
import { hydrateOfficialPublishRecords } from "../../scripts/official-publish-records.js";
import { signalDesk } from "./signal-desk.js";

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
    return json(await novelOverview(db, url.searchParams.get("query") || "", env));
  }

  if (method === "GET" && pathname === "/api/novel-content/feishu/status") {
    return json(feishuStatus(env));
  }

  if (method === "POST" && pathname === "/api/novel-content/feishu/import") {
    return json(await importFeishuNovelFields(db, env, await readJson(request)));
  }

  if (method === "POST" && pathname === "/api/novel-content/novels") {
    const novel = await createNovel(db, await readJson(request));
    return json({ novel }, 201);
  }

  if (method === "POST" && pathname === "/api/novel-content/batch-audio-versions") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以批量保存文案。", 403);
    return json(await enqueueBatchAudioVersions(db, session.user, await readJson(request)));
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
  if (method === "DELETE" && novelMatch) {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以删除小说。", 403);
    return json(await deleteNovel(db, decodeURIComponent(novelMatch[1])));
  }

  const scriptMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/scripts$/);
  if (method === "POST" && scriptMatch) {
    const script = await createScript(db, decodeURIComponent(scriptMatch[1]), await readJson(request));
    return json({ script }, 201);
  }

  const scriptItemMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/scripts\/([^/]+)$/);
  if (method === "PATCH" && scriptItemMatch) {
    try {
      const script = await updateScript(db, decodeURIComponent(scriptItemMatch[1]), decodeURIComponent(scriptItemMatch[2]), await readJson(request));
      return json({ script, novel: await hydrateNovel(db, script.novelId) });
    } catch (error) {
      return errorJson(error.message || "保存文案失败。", error.statusCode || 400);
    }
  }
  if (method === "DELETE" && scriptItemMatch) {
    try {
      return json(await deleteScript(env, db, decodeURIComponent(scriptItemMatch[1]), decodeURIComponent(scriptItemMatch[2])));
    } catch (error) {
      return errorJson(error.message || "删除失败。", error.statusCode || 400);
    }
  }

  const pruneMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/prune-drafts$/);
  if (method === "POST" && pruneMatch) {
    const payload = await readJson(request);
    return json(await pruneDraftScripts(db, decodeURIComponent(pruneMatch[1]), payload));
  }

  const importAudioMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/import-audio$/);
  if (method === "POST" && importAudioMatch) {
    try {
      return json(await importNovelAudios(env, db, session, decodeURIComponent(importAudioMatch[1]), request));
    } catch (error) {
      return errorJson(error.message || "上传音频失败。", error.statusCode || 400);
    }
  }

  const mixMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/mix-audios$/);
  if (method === "PUT" && mixMatch) {
    const payload = await readJson(request);
    const novel = await setNovelMixAudios(db, decodeURIComponent(mixMatch[1]), payload.scriptIds);
    return json({ novel });
  }

  if (method === "GET" && pathname === "/api/novel-content/opening-styles") {
    return json({ styles: publicOpeningStyles(), version: 4 });
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
    const novelId = url.searchParams.get("novel") || "";
    const days = Math.max(1, Math.min(30, Math.floor(Number(url.searchParams.get("days") || 30))));
    if (source === "third_party") {
      const overview = await novelOverview(db, query, env);
      return json(slimEffectsPage({
        ...overview,
        dataStatus: {
          source,
          label: "GeeLark third-party data",
          status: "ready",
          rawVideoCount: Number(overview?.summary?.videoCount || 0),
          mappedVideoCount: Number(overview?.summary?.videoCount || 0),
          days,
        },
      }, { keepZeroView: true }));
    }
    try {
      let meta = await readArchiveMeta(db);
      const archiveAge = Date.now() - Number(meta.updatedAt || meta.archiveAt || 0);
      if (!meta.accountCount || archiveAge > 30 * 60 * 1000) {
        meta = await refreshOfficialArchive(env, db).catch(() => meta);
      }
      const [groupStore, accountRows] = await Promise.all([
        loadGroupStore(db),
        listLatestArchiveAccounts(db),
      ]);
      const storedRecords = await kvGet(db, "official-publish-records", []);
      const [signals, store, records] = await Promise.all([
        getOfficialOperationSignals(env, db, {
          days,
          videosPerAccount: 100,
          accountKeys: archiveAccountKeysForProject(groupStore, accountRows, "proj-novel"),
        }),
        readStore(db, { includeSource: false, workingOnly: true }),
        hydrateOfficialPublishRecords(storedRecords, (batchId) => (
          signalDesk(env, db, `/api/v1/publish/batches/${encodeURIComponent(batchId)}`)
        )).catch(() => storedRecords),
      ]);
      if (officialPublishRecordsNeedPersist(storedRecords, records)) {
        await kvSet(db, "official-publish-records", records).catch(() => {});
      }
      const assembled = assembleOfficialNovelEffects({
        store,
        audioItems: audioItemsFromScripts(store.scripts),
        signals,
        records,
        query,
        days,
        label: "线上官方归档",
        projectAccountCount: uniqueProjectAccountCount(groupStore, "proj-novel"),
      });
      await kvSet(db, "novel-hit-snapshot", buildOwnHitSnapshot(assembled)).catch(() => {});
      const { videoMappings, ...page } = assembled;
      return json(slimEffectsPage({
        ...page,
        dataStatus: {
          ...page.dataStatus,
          cacheUpdatedAt: meta.updatedAt,
          archiveDate: signals.archiveDate || meta.archiveDate,
        },
      }, { keepNovelId: novelId }));
    } catch (error) {
      return errorJson(error.message || "读取数据概览失败。", error.statusCode || 502);
    }
  }

  return null;
}

async function novelOverview(db, query, env) {
  const store = await readStore(db, { includeSource: false, workingOnly: true });
  const [catalogCount, peerHits, snapshot] = await Promise.all([
    countNovels(db),
    listPeerHitRows(db).catch(() => []),
    kvGet(db, "novel-hit-snapshot", {})
  ]);
  const split = takeDuplicateAudioScripts(store.scripts);
  let scripts = store.scripts;
  if (split.removed.length) {
    await writeScripts(db, split.kept);
    scripts = split.kept;
    for (const script of split.removed) {
      const audioId = String(script.audioId || script.audio?.id || "").trim();
      if (audioId && env) await deleteNovelAudio(env, audioId).catch(() => false);
    }
  }
  const normalized = String(query || "").trim().toLowerCase();
  const novels = attachNovelHitStats(store.novels
    .map((novel) => {
      const owned = collapseDuplicateAudioScripts(scripts.filter((script) => script.novelId === novel.id));
      return {
        ...novel,
        scripts: owned,
        audioCount: owned.filter(scriptHasAudio).length,
        performance: { videoCount: 0, totalViews: 0, averageViews: 0, maxViews: 0, comments: 0 }
      };
    })
    .filter((novel) => !normalized || [novel.id, novel.title, novel.platform, novel.bookId, novel.promotionCode, novel.promotionCopy, novel.category, novel.sellingPoint, novel.note]
      .some((value) => String(value || "").toLowerCase().includes(normalized))), {
    peerHits,
    ownByNovelId: snapshot?.ownByNovelId || {}
  });
  return {
    version: 1,
    summary: {
      novelCount: store.novels.length,
      catalogCount,
      scriptCount: scripts.length,
      audioCount: collapseDuplicateAudioScripts(scripts).filter((item) => item.audioId || item.audio?.id).length,
      videoCount: novels.reduce((sum, novel) => sum + Number(novel.performance?.videoCount || 0), 0),
      unassignedScriptCount: scripts.filter((item) => !item.novelId).length
    },
    catalog: catalogSummary(novels),
    novels,
    unassignedScripts: scripts.filter((item) => !item.novelId)
  };
}

export async function buildWorkerAudioHitWeights(db) {
  const [store, peerHits, snapshot] = await Promise.all([
    readStore(db, { includeSource: false, workingOnly: true }),
    listPeerHitRows(db).catch(() => []),
    kvGet(db, "novel-hit-snapshot", {})
  ]);
  return {
    updatedAt: new Date().toISOString(),
    snapshotAt: snapshot?.updatedAt || "",
    weights: buildAudioHitWeights({
      scripts: store.scripts,
      peerHits,
      ownByAudioName: snapshot?.ownByAudioName || {}
    })
  };
}

export async function importFeishuNovelFields(db, env) {
  const fetched = await fetchFeishuCatalogBooks(env);
  await migrateNovelsFromKv(db);
  const novels = await listNovelMatchIndex(db);
  const existingIds = new Set(novels.map((item) => item.id));
  const beforeBookIds = new Map(novels.map((item) => [item.id, String(item.bookId || "")]));
  const applied = applyFeishuCatalogImport(novels, fetched.books, {
    now: new Date().toISOString(),
    createId: () => safeId(`novel-${now()}-${randomToken(3)}`)
  });
  const createdNovels = applied.novels.filter((novel) => !existingIds.has(novel.id));
  const filledNovels = applied.novels.filter((novel) => existingIds.has(novel.id) && String(novel.bookId || "") !== (beforeBookIds.get(novel.id) || ""));
  if (createdNovels.length) await insertNovels(db, createdNovels);
  for (const novel of filledNovels) await updateNovelBookId(db, novel.id, novel.bookId, novel.updatedAt);
  return {
    sourceTitle: fetched.sourceTitle,
    sheets: fetched.sheets,
    rowCount: fetched.books.length,
    created: applied.created,
    skipped: applied.skipped,
    filledBookId: filledNovels.length,
    details: applied.details.slice(0, 80)
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
    bookId: String(payload.bookId || "").trim().slice(0, 240),
    promotionCode: String(payload.promotionCode || "").trim().slice(0, 240),
    promotionCopy: String(payload.promotionCopy || "").trim().slice(0, 5_000),
    category: String(payload.category || "").trim().slice(0, 120),
    featured: Boolean(payload.featured),
    sellingPoint: String(payload.sellingPoint || "").trim().slice(0, 2_000),
    note: String(payload.note || "").trim().slice(0, 2_000),
    sourceContent,
    status: "active",
    working: true,
    createdAt,
    updatedAt: createdAt
  };
  await upsertNovel(db, novel);
  return novel;
}

async function updateNovel(db, id, payload) {
  const novel = await findNovelById(db, id);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  if (payload.title !== undefined) novel.title = String(payload.title || "").trim().slice(0, 180) || novel.title;
  if (payload.platform !== undefined) {
    if (!PLATFORMS.includes(payload.platform)) throw Object.assign(new Error("请选择小说平台。"), { statusCode: 400 });
    novel.platform = payload.platform;
  }
  if (payload.bookId !== undefined) novel.bookId = String(payload.bookId || "").trim().slice(0, 240);
  if (payload.promotionCode !== undefined) novel.promotionCode = String(payload.promotionCode || "").trim().slice(0, 240);
  if (payload.promotionCopy !== undefined) novel.promotionCopy = String(payload.promotionCopy || "").trim().slice(0, 5_000);
  if (payload.category !== undefined) novel.category = String(payload.category || "").trim().slice(0, 120);
  if (payload.featured !== undefined) novel.featured = Boolean(payload.featured);
  if (payload.sellingPoint !== undefined) novel.sellingPoint = String(payload.sellingPoint || "").trim().slice(0, 2_000);
  if (payload.note !== undefined) novel.note = String(payload.note || "").trim().slice(0, 2_000);
  if (payload.sourceContent !== undefined) {
    const sourceContent = String(payload.sourceContent || "").trim().slice(0, 200_000);
    if (sourceContent.length < 20) throw Object.assign(new Error("小说内容至少需要 20 个字符。"), { statusCode: 400 });
    novel.sourceContent = sourceContent;
  }
  novel.updatedAt = new Date().toISOString();
  await upsertNovel(db, novel);
  return novel;
}

export function takeNovelFromStore(store, id) {
  const wanted = String(id || "").trim();
  const novel = (store.novels || []).find((item) => item.id === wanted || item.id === safeId(id));
  if (!novel) return null;
  return {
    novel,
    novels: store.novels.filter((item) => item.id !== novel.id),
    scripts: (store.scripts || []).filter((item) => item.novelId !== novel.id)
  };
}

async function deleteNovel(db, id) {
  const novel = await findNovelById(db, id);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const scripts = await listNovelScripts(db);
  const taken = takeNovelFromStore({ novels: [novel], scripts }, novel.id);
  await deleteNovelRow(db, taken.novel.id);
  if (taken.scripts.length !== scripts.length) await writeScripts(db, taken.scripts);
  return {
    ok: true,
    id: taken.novel.id,
    title: taken.novel.title,
    removedScriptCount: scripts.length - taken.scripts.length
  };
}

async function findNovelById(db, id) {
  await migrateNovelsFromKv(db);
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  return (await getNovelRow(db, wanted)) || (wanted === safeId(id) ? null : await getNovelRow(db, safeId(id)));
}

async function getNovel(db, id) {
  return findNovelById(db, id);
}

export async function hydrateNovel(db, id) {
  const novel = await findNovelById(db, id);
  if (!novel) return null;
  const [scripts, hits] = await Promise.all([listNovelScripts(db), listPeerHitRows(db)]);
  const markedHits = attachScaleRunMarks(attachPeerHitTimes(hits.filter((hit) => {
    return hit.factoryNovelId === novel.id || (novel.bookId && hit.novelId === novel.bookId);
  })));
  return {
    ...novel,
    scripts: collapseDuplicateAudioScripts(scripts.filter((item) => item.novelId === novel.id).map((script) => ({
      ...script,
      scaleRun: scaleRunForScript(script, markedHits),
      peerVideos: peerVideosForScript(script, markedHits)
    })))
  };
}

export async function persistOpeningVariantScripts(db, payload = {}, result = {}) {
  const novelId = String(payload.novelId || "").trim();
  if (!novelId) return [];
  const novel = await hydrateNovel(db, novelId);
  if (!novel) return [];
  const extras = { speakOpeningTitle: payload.speakOpeningTitle === true };
  const scripts = [];
  for (const item of openingVariantScriptPayloads(novel, result.variants, extras)) {
    scripts.push(await createScript(db, novel.id, item));
  }
  return scripts;
}

export async function enqueueBatchAudioVersions(db, user, body = {}) {
  const novelIds = uniqueNovelIds(body.novelIds);
  if (!novelIds.length) throw Object.assign(new Error("请先勾选要写文案的小说。"), { statusCode: 400 });
  const count = Number(body.count) || 3;
  const settings = await kvGet(db, "novel-seed-settings", {});
  const voiceId = String(body.voiceId || settings.voiceId || "").trim();
  const speechSpeed = body.speechSpeed ?? settings.speechSpeed;
  const { enqueueJob } = await import("./jobs.js");
  const items = [];
  for (const novelId of novelIds) {
    const novel = await hydrateNovel(db, novelId);
    if (!novel) {
      items.push({ novelId, skipped: true, reason: "没有找到该小说。" });
      continue;
    }
    if (String(novel.sourceContent || "").trim().length < BATCH_AUDIO_MIN_SOURCE) {
      items.push({ novelId, title: novel.title, skipped: true, reason: "免费章节太短，先补章节再出。" });
      continue;
    }
    const needed = remainingAudioVersionCount(novel.scripts, count);
    if (!needed) {
      items.push({ novelId, title: novel.title, skipped: true, reason: "已经有足够的保存文案。", needed: 0 });
      continue;
    }
    const styles = batchOpeningStyleIds(needed);
    const job = await enqueueJob(db, {
      type: "opening-variants",
      title: `${novel.title} · ${styles.length} 条开头文案`,
      payload: {
        novelId: novel.id,
        title: novel.title,
        language: "English",
        sourceText: novel.sourceContent || "",
        category: novel.category || "",
        platform: novel.platform || "",
        promotionCode: novel.promotionCode || "",
        sellingPoint: novel.sellingPoint || "",
        baseOpening: "",
        styles,
        model: body.model || "gpt-5.6-sol",
        reasoningEffort: body.reasoningEffort || "medium",
        autoKeep: true,
        autoVoice: false,
        voiceId,
        speechSpeed,
        speakOpeningTitle: body.speakOpeningTitle === true
      },
      createdBy: user?.username || ""
    });
    items.push({
      novelId: novel.id,
      title: novel.title,
      skipped: false,
      needed: styles.length,
      jobId: job.id
    });
  }
  const queued = items.filter((item) => !item.skipped).length;
  if (!queued) throw Object.assign(new Error(items[0]?.reason || "勾选的书都不用再写文案。"), { statusCode: 400 });
  return {
    accepted: true,
    queued: true,
    count: queued,
    skipped: items.length - queued,
    items,
    message: `已下发 ${queued} 本，工人会按每本书的免费章节选模板写钩子并保存到音频页，不配音。已有 3 条的已跳过。`
  };
}

async function importNovelAudios(env, db, session, novelId, request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((file) => file && typeof file.arrayBuffer === "function");
  if (!files.length) throw Object.assign(new Error("请选择要上传的 mp3。"), { statusCode: 400 });
  if (files.length > 8) throw Object.assign(new Error("一次最多上传 8 条音频。"), { statusCode: 400 });
  const invalid = files.find((file) => !isImportedAudioFile(file));
  if (invalid) throw Object.assign(new Error("只接受 mp3 音频。"), { statusCode: 400 });
  const novel = await findNovelById(db, novelId);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const store = { scripts: await listNovelScripts(db) };
  const pending = store.scripts.filter((script) => script.novelId === novel.id && !scriptHasAudio(script));
  const scriptIds = form.getAll("scriptIds").map((id) => String(id || "").trim()).filter(Boolean);
  const plan = planImportedAudioAssignments({ pendingScripts: pending, files, scriptIds });
  const createdAt = new Date().toISOString();
  const items = [];
  for (const step of plan) {
    const size = Number(step.file.size || 0);
    if (size > 20 * 1024 * 1024) throw Object.assign(new Error(`${step.file.name || "音频"} 超过 20MB。`), { statusCode: 413 });
    const bytes = await step.file.arrayBuffer();
    if (bytes.byteLength < 1024) throw Object.assign(new Error(`${step.file.name || "音频"} 文件太小。`), { statusCode: 400 });
    const audioId = safeId(`upload-${now()}-${randomToken(4)}`);
    await putNovelAudio(env, audioId, bytes, step.file.type || "audio/mpeg");
    const fileName = String(step.file.name || `${audioId}.mp3`).trim();
    const openingTitle = uploadedAudioOpeningTitle(fileName);
    const title = `${novel.title} ${openingTitle || "上传音频"}`.trim().slice(0, 240);
    let script = step.scriptId
      ? store.scripts.find((row) => row.id === step.scriptId && row.novelId === novel.id)
      : null;
    if (!script) {
      script = {
        id: safeId(`script-${now()}-${randomToken(3)}`),
        novelId: novel.id,
        parentScriptId: "",
        title,
        text: uploadedAudioScriptText(fileName),
        versionLabel: "上传音频",
        sourceType: "uploaded-audio",
        openingTitle,
        mixEnabled: true,
        kept: true,
        speakOpeningTitle: false,
        createdAt,
        updatedAt: createdAt
      };
      store.scripts.push(script);
    }
    script.audioId = audioId;
    script.audio = {
      id: audioId,
      title,
      fileName,
      targetAudioPath: "",
      duration: 0,
      size: bytes.byteLength,
      createdAt
    };
    script.kept = true;
    script.updatedAt = createdAt;
    items.push({
      novelId: novel.id,
      novelTitle: novel.title,
      platform: novel.platform || "",
      promotionCode: novel.promotionCode || "",
      promotionCopy: novel.promotionCopy || "",
      bookId: novel.bookId || "",
      scriptId: script.id,
      audioId,
      fileName,
      title,
      size: bytes.byteLength,
      createdAt
    });
  }
  await writeScripts(db, store.scripts);
  await markNovelsWorking(db, [novel.id]);
  const { enqueueJob } = await import("./jobs.js");
  const job = await enqueueJob(db, {
    type: "audio-import",
    title: `导入 ${items.length} 条上传音频`,
    payload: {
      novelId: novel.id,
      novelTitle: novel.title,
      platform: novel.platform || "",
      promotionCode: novel.promotionCode || "",
      promotionCopy: novel.promotionCopy || "",
      bookId: novel.bookId || "",
      targetAudioDir: String(form.get("targetAudioDir") || "__novel__").trim() || "__novel__",
      items
    },
    createdBy: session?.user?.username || ""
  });
  return {
    novel: await hydrateNovel(db, novel.id),
    jobId: job.id,
    count: items.length,
    items,
    message: `已上传 ${items.length} 条，可直接试听。工人会再写到本机音频目录。`
  };
}

export async function attachPeerAudiosToNovels(env, db, session, hits = []) {
  const selected = (Array.isArray(hits) ? hits : []).slice(0, 20);
  if (!selected.length) {
    const error = new Error("先勾选有音频的同行爆款。");
    error.statusCode = 400;
    throw error;
  }
  const novels = await listNovelsMatchingPeerHits(db, selected);
  const store = { scripts: await listNovelScripts(db) };
  const createdAt = new Date().toISOString();
  const skipped = [];
  const importedNovelIds = [];
  let imported = 0;
  for (const step of planPeerHitNovelImports(selected, novels, {
    importedPeerHitIds: importedPeerHitIdSet(store.scripts),
    importedSourceTokensByNovel: importedSourceTokensByNovel(store.scripts),
    importedClipFingerprintsByNovel: importedClipFingerprintsByNovel(store.scripts)
  })) {
    if (step.skipReason) {
      skipped.push(step.skipReason);
      continue;
    }
    const audioId = safeId(`upload-${now()}-${randomToken(4)}`);
    const copied = await copyNovelAudio(env, step.hit.audioId, audioId);
    const fileName = String(step.hit.audioName || `${audioId}.mp3`).trim();
    const openingTitle = uploadedAudioOpeningTitle(fileName) || "同行爆款";
    const title = `${step.novel.title} ${openingTitle}`.trim().slice(0, 240);
    store.scripts.push({
      id: safeId(`script-${now()}-${randomToken(3)}`),
      novelId: step.novel.id,
      parentScriptId: "",
      title,
      text: uploadedAudioScriptText(fileName),
      versionLabel: "同行爆款",
      sourceType: "peer-hit",
      peerHitId: step.hit.id,
      openingTitle,
      mixEnabled: true,
      kept: true,
      speakOpeningTitle: false,
      createdAt,
      updatedAt: createdAt,
      audioId,
      audio: {
        id: audioId,
        title,
        fileName,
        targetAudioPath: "",
        duration: 0,
        size: copied.size,
        createdAt
      }
    });
    imported += 1;
    importedNovelIds.push(step.novel.id);
  }
  if (imported) {
    await writeScripts(db, store.scripts);
    await markNovelsWorking(db, importedNovelIds);
  }
  const parts = [];
  if (imported) parts.push(`已导入 ${imported} 条到书单音频页`);
  if (skipped.length) parts.push(`跳过 ${skipped.length} 条`);
  return {
    imported,
    skipped: skipped.length,
    skippedMessages: skipped.slice(0, 8),
    jobs: [],
    jobId: "",
    message: parts.join("，") || "没有可导入的爆款音频。"
  };
}

async function createScript(db, novelId, payload = {}) {
  const novel = await findNovelById(db, novelId);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const store = { scripts: await listNovelScripts(db) };
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
    kept: payload.kept === true,
    speakOpeningTitle: payload.speakOpeningTitle === true,
    createdAt,
    updatedAt: createdAt
  };
  store.scripts.push(script);
  await writeScripts(db, store.scripts);
  await markNovelsWorking(db, [novel.id]);
  return script;
}

export async function deleteScript(env, db, novelId, scriptId) {
  const novel = await findNovelById(db, novelId);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const store = { scripts: await listNovelScripts(db) };
  const script = store.scripts.find((item) => item.id === String(scriptId || "").trim() && item.novelId === novel.id);
  if (!script) throw Object.assign(new Error("没有找到这条音频。"), { statusCode: 404 });
  const next = removeScriptsById(store.scripts, [script.id]);
  await writeScripts(db, next);
  const audioId = String(script.audioId || script.audio?.id || "").trim();
  if (audioId) await deleteNovelAudio(env, audioId).catch(() => false);
  return { ok: true, removed: true, novel: await hydrateNovel(db, novel.id) };
}

export async function updateScript(db, novelId, scriptId, payload = {}) {
  const novel = await findNovelById(db, novelId);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const store = { scripts: await listNovelScripts(db) };
  const script = store.scripts.find((item) => item.id === String(scriptId || "").trim() && item.novelId === novel.id);
  if (!script) throw Object.assign(new Error("没有找到这条文案。"), { statusCode: 404 });
  const text = payload.text == null ? script.text : String(payload.text || "").trim().slice(0, 20_000);
  if (text.length < 20) throw Object.assign(new Error("改写文案至少需要 20 个字符。"), { statusCode: 400 });
  script.text = text;
  if (payload.openingTitle != null) script.openingTitle = String(payload.openingTitle || "").trim().slice(0, 80);
  if (payload.speakOpeningTitle != null) script.speakOpeningTitle = payload.speakOpeningTitle === true;
  script.kept = true;
  script.updatedAt = new Date().toISOString();
  await writeScripts(db, store.scripts);
  return script;
}

export async function pruneDraftScripts(db, novelId, payload = {}) {
  const novel = await findNovelById(db, novelId);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const store = { scripts: await listNovelScripts(db) };
  const next = Array.isArray(payload.scriptIds) && payload.scriptIds.length
    ? removeDraftScriptsById(store.scripts, payload.scriptIds)
    : dropDraftScripts(store.scripts, {
      novelId: novel.id,
      keepIds: payload.keepIds,
      graceMs: payload.graceMs
    });
  const removedCount = store.scripts.length - next.length;
  if (removedCount) await writeScripts(db, next);
  return { ok: true, removedCount, novel: await hydrateNovel(db, novel.id) };
}

export async function removeDraftScripts(db, scriptIds = []) {
  const store = { scripts: await listNovelScripts(db) };
  const next = removeDraftScriptsById(store.scripts, scriptIds);
  const removedCount = store.scripts.length - next.length;
  if (removedCount) await writeScripts(db, next);
  return removedCount;
}

async function setNovelMixAudios(db, novelId, scriptIds) {
  const novel = await findNovelById(db, novelId);
  if (!novel) throw Object.assign(new Error("没有找到该小说。"), { statusCode: 404 });
  const store = { scripts: await listNovelScripts(db) };
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
  await writeScripts(db, store.scripts);
  return hydrateNovel(db, novel.id);
}

export async function resolveNovelTitle(db, { novelId = "", novelTitle = "" } = {}) {
  const title = String(novelTitle || "").trim();
  if (title) return title;
  const novel = await findNovelById(db, novelId);
  return String(novel?.title || "").trim();
}

export async function buildAudioGeneratePayload(db, body = {}) {
  const scripts = await listNovelScripts(db);
  const settings = await kvGet(db, "novel-seed-settings", {});
  const voiceId = String(body.voiceId || settings.voiceId || "").trim();
  const requested = Array.isArray(body.items) && body.items.length
    ? body.items
    : (Array.isArray(body.scriptIds) ? body.scriptIds.map((id) => ({ scriptId: id, novelId: body.novelId })) : [body]);
  const items = [];
  const novels = new Map();
  for (const raw of requested) {
    const scriptId = String(raw.scriptId || "").trim();
    const script = scripts.find((item) => item.id === scriptId);
    const text = String(raw.script || raw.text || script?.text || "").trim();
    if (text.length < 20) continue;
    const novelId = String(raw.novelId || script?.novelId || body.novelId || "").trim();
    if (novelId && !novels.has(novelId)) novels.set(novelId, await findNovelById(db, novelId));
    const novel = novels.get(novelId) || null;
    items.push({
      novelId: novel?.id || script?.novelId || novelId,
      novelTitle: String(raw.novelTitle || novel?.title || body.novelTitle || "").trim(),
      platform: String(raw.platform || novel?.platform || body.platform || "").trim(),
      promotionCode: String(raw.promotionCode || novel?.promotionCode || body.promotionCode || "").trim(),
      promotionCopy: String(raw.promotionCopy || novel?.promotionCopy || body.promotionCopy || "").trim(),
      bookId: String(raw.bookId || novel?.bookId || body.bookId || "").trim(),
      scriptId: script?.id || scriptId,
      audioId: raw.audioId || script?.audioId || script?.audio?.id || "",
      fileName: raw.fileName || script?.audio?.fileName || "",
      targetAudioPath: raw.targetAudioPath || script?.audio?.targetAudioPath || "",
      title: String(raw.title || `${novel?.title || ""} ${script?.versionLabel || "改写"}`).trim(),
      script: text,
      openingTitle: String(raw.openingTitle || script?.openingTitle || "").trim(),
      speakOpeningTitle: raw.speakOpeningTitle === true || script?.speakOpeningTitle === true || (body.speakOpeningTitle === true && raw.speakOpeningTitle !== false),
      voiceId: String(raw.voiceId || voiceId || "").trim(),
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
    platform: String(body.platform || items[0]?.platform || "").trim(),
    voiceId,
    speechSpeed: body.speechSpeed,
    items
  };
}

export async function attachAudioGenerateResults(db, items = []) {
  const store = { scripts: await listNovelScripts(db) };
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
  if (changed) await writeScripts(db, store.scripts);
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
  for (const novel of novels) await upsertNovel(db, novel);
  await writeScripts(db, scripts);
  await syncWorkingNovels(db, scripts.map((item) => item.novelId), { unmarkMissing: false });
  return { novelCount: novels.length, scriptCount: scripts.length, importedNovelCount: (incoming.novels || []).length, importedScriptCount: (incoming.scripts || []).length };
}

async function readStore(db, { includeSource = true, workingOnly = false } = {}) {
  await migrateNovelsFromKv(db);
  const store = await kvGet(db, "novel-content", null);
  const scripts = Array.isArray(store?.scripts) ? store.scripts : [];
  if (workingOnly) {
    await syncWorkingNovels(db, scripts.map((item) => item.novelId), { unmarkMissing: false });
    return { novels: await listWorkingNovelSummaries(db), scripts };
  }
  return {
    novels: includeSource ? await listNovels(db) : await listNovelSummaries(db),
    scripts
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
    hitCount: items.filter((item) => item.hit).length,
    audioCount: items.reduce((sum, item) => sum + (Number(item.audioCount) || 0), 0)
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

function officialPublishRecordsNeedPersist(before, after) {
  if (before === after) return false;
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return true;
  return after.some((item, index) => (
    String(item?.videoId || "") !== String(before[index]?.videoId || "")
    || String(item?.status || "") !== String(before[index]?.status || "")
    || String(item?.officialRemoteStatus || "") !== String(before[index]?.officialRemoteStatus || "")
  ));
}
