import { assertOfficialPublishAccess } from "./official.js";
import { errorJson, json, now, randomToken, readJson, safeId } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import { attachAudioGenerateResults, buildAudioGeneratePayload, mergeImportedNovelStore, persistOpeningVariantScripts } from "./novels.js";
import { refreshOfficialArchive } from "./official-archive-store.js";
import { mergeOfficialPublishRecords } from "../../scripts/official-publish-records.js";

const FFMPEG_START_ROUTES = [
  { method: "POST", pattern: /^\/api\/generate\/start$/, type: "generate", title: "生成视频" },
  { method: "POST", pattern: /^\/api\/reddit-mix\/start$/, type: "reddit-mix", title: "Reddit 混剪" },
  { method: "POST", pattern: /^\/api\/schulte\/start$/, type: "schulte", title: "舒尔特出片" },
  { method: "POST", pattern: /^\/api\/asset-groups\/preprocess\/start$/, type: "asset-preprocess", title: "素材预处理" },
  { method: "POST", pattern: /^\/api\/folder-classify\/start$/, type: "folder-classify", title: "文件夹分类" },
  { method: "POST", pattern: /^\/api\/images\/unsplash\/start$/, type: "unsplash", title: "Unsplash 拉图" },
  { method: "POST", pattern: /^\/api\/asset-usage\/reindex\/start$/, type: "asset-reindex", title: "素材使用率重扫" },
  { method: "POST", pattern: /^\/api\/official-tiktok\/publish$/, type: "official-publish", title: "官方发布上传" },
  { method: "POST", pattern: /^\/api\/geelark\/publish$/, type: "geelark-publish", title: "GeeLark 发布" }
];

const PROGRESS_ROUTES = [
  { pattern: /^\/api\/generate\/progress\/([^/]+)$/, type: "generate" },
  { pattern: /^\/api\/reddit-mix\/progress\/([^/]+)$/, type: "reddit-mix" },
  { pattern: /^\/api\/schulte\/progress\/([^/]+)$/, type: "schulte" },
  { pattern: /^\/api\/asset-groups\/preprocess\/progress\/([^/]+)$/, type: "asset-preprocess" },
  { pattern: /^\/api\/folder-classify\/progress\/([^/]+)$/, type: "folder-classify" },
  { pattern: /^\/api\/images\/unsplash\/progress\/([^/]+)$/, type: "unsplash" },
  { pattern: /^\/api\/asset-usage\/reindex\/progress\/([^/]+)$/, type: "asset-reindex" }
];

const CANCEL_ROUTES = [
  { pattern: /^\/api\/generate\/cancel\/([^/]+)$/ },
  { pattern: /^\/api\/reddit-mix\/cancel\/([^/]+)$/ },
  { pattern: /^\/api\/asset-groups\/preprocess\/cancel\/([^/]+)$/ },
  { pattern: /^\/api\/folder-classify\/cancel\/([^/]+)$/ },
  { pattern: /^\/api\/images\/unsplash\/cancel\/([^/]+)$/ }
];

export async function handleJobs(request, env, url, session) {
  const method = request.method;
  const pathname = url.pathname;

  if (pathname.startsWith("/api/worker/")) {
    return handleWorkerApi(request, env, url);
  }

  if (!session) return null;

  if (method === "GET" && pathname === "/api/factory/recent-videos") {
    return json({ videos: await listRecentVideos(env.DB, session.user) });
  }

  for (const route of FFMPEG_START_ROUTES) {
    if (method === route.method && route.pattern.test(pathname)) {
      const payload = await readJson(request);
      if (route.type === "official-publish") {
        try {
          await assertOfficialPublishAccess(env, session.user, payload);
        } catch (error) {
          return errorJson(error.message || "没有这些账号的发布权限。", error.statusCode || 403);
        }
      }
      const job = await enqueueJob(env.DB, {
        type: route.type,
        title: route.title,
        payload,
        createdBy: session.user.username
      });
      return json({
        jobId: job.id,
        accepted: true,
        queued: true,
        message: "已下发给工人机，本机或其他服务器会拉单执行 ffmpeg。"
      });
    }
  }

  if (method === "GET") {
    for (const route of PROGRESS_ROUTES) {
      const match = pathname.match(route.pattern);
      if (match) return json(await jobProgress(env.DB, decodeURIComponent(match[1])));
    }
  }

  if (method === "POST") {
    for (const route of CANCEL_ROUTES) {
      const match = pathname.match(route.pattern);
      if (match) {
        await cancelJob(env.DB, decodeURIComponent(match[1]));
        return json({ ok: true });
      }
    }
  }

  return null;
}

export async function getJob(db, jobId) {
  return db.prepare("SELECT * FROM factory_jobs WHERE id = ?").bind(safeId(jobId)).first();
}

export async function findLatestOpeningVariantsJob(db, { novelId, createdBy, maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const targetNovelId = String(novelId || "").trim();
  const username = String(createdBy || "").trim();
  if (!targetNovelId || !username) return null;
  const { results } = await db.prepare(`
    SELECT * FROM factory_jobs
    WHERE type = 'opening-variants' AND created_by = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(username, now() - Math.max(60_000, Number(maxAgeMs) || 0)).all();
  return (results || []).find((row) => {
    const payload = parseJson(row.payload_json, {});
    return String(payload.novelId || "") === targetNovelId;
  }) || null;
}

export async function listRecentJobs(db, limit = 80) {
  const { results } = await db.prepare("SELECT * FROM factory_jobs ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return results || [];
}

async function listRecentVideos(db, user) {
  const rows = await listRecentJobs(db, 40);
  const mine = user?.role === "admin" ? rows : rows.filter((row) => row.created_by === user?.username);
  const videos = [];
  for (const row of mine) {
    let result = {};
    try { result = JSON.parse(row.result_json || "{}"); } catch { result = {}; }
    const items = Array.isArray(result.results) ? result.results : (Array.isArray(result.generatedVideos) ? result.generatedVideos : []);
    for (const item of items) {
      const fileName = String(item.fileName || item.name || "").trim();
      if (!fileName) continue;
      videos.push({
        fileName,
        title: item.title || row.title || fileName,
        jobId: row.id,
        createdAt: Number(row.created_at || 0),
        createdBy: row.created_by || "",
      });
    }
  }
  return videos.slice(0, 60);
}

export async function enqueueJob(db, { type, title, payload, createdBy }) {
  const id = safeId(`${type}-${Date.now()}-${randomToken(4)}`);
  const stamp = now();
  await db.prepare(`
    INSERT INTO factory_jobs (
      id, type, status, title, percent, message, payload_json, result_json, error,
      created_by, worker_id, claimed_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'queued', ?, 1, ?, ?, '{}', '', ?, '', 0, 0, ?, ?)
  `).bind(id, type, title || type, "已加入工人队列，等待本机或其他服务器拉取。", JSON.stringify(payload || {}), createdBy || "", stamp, stamp).run();
  return { id, type, status: "queued" };
}

async function jobProgress(db, jobId) {
  const job = await db.prepare("SELECT * FROM factory_jobs WHERE id = ?").bind(safeId(jobId)).first();
  if (!job) return { jobId, status: "missing", percent: 0, message: "任务不存在。" };
  return publicJob(job);
}

export function isCancelledJob(job) {
  return ["cancelled", "canceled"].includes(String(job?.status || "").toLowerCase());
}

export function completeJobNextStatus({ existingStatus, cancelled, failed } = {}) {
  if (isCancelledJob({ status: existingStatus }) || cancelled) return "cancelled";
  return failed ? "failed" : "done";
}

export function shouldWriteOfficialPublishRecords({ existingStatus, cancelled, records } = {}) {
  return !isCancelledJob({ status: existingStatus }) && !cancelled && Array.isArray(records) && records.length > 0;
}

export async function cancelJob(db, jobId) {
  const stamp = now();
  await db.prepare(`
    UPDATE factory_jobs SET status = 'cancelled', message = '已取消', updated_at = ?, completed_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `).bind(stamp, stamp, safeId(jobId)).run();
}

async function handleWorkerApi(request, env, url) {
  const expected = String(env.WORKER_TOKEN || "").trim();
  if (!expected) return errorJson("工人密钥未配置。", 501);
  const supplied = bearer(request);
  if (supplied !== expected) return errorJson("工人密钥不正确。", 401);

  const method = request.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/worker/tasks/sync") {
    const body = await readJson(request);
    const patches = Array.isArray(body.tasks) ? body.tasks : (body.taskId || body.id ? [body] : []);
    if (!patches.length) return json({ ok: true, updated: 0 });
    const tasks = await kvGet(env.DB, "auto-tasks", []);
    let updated = 0;
    for (const patch of patches) {
      const taskId = String(patch.taskId || patch.id || "").trim();
      const index = tasks.findIndex((item) => item.id === taskId);
      if (index < 0 || isDeletedTask(tasks[index])) continue;
      const incoming = Array.isArray(patch.generatedVideos) ? patch.generatedVideos : [];
      const generatedVideos = mergeGeneratedVideos(tasks[index].generatedVideos, incoming);
      const expectedVideoCount = expectedTaskVideoCount({
        ...tasks[index],
        expectedVideoCount: patch.expectedVideoCount || tasks[index].expectedVideoCount
      }, { progressTotal: patch.progressTotal }, generatedVideos);
      tasks[index] = {
        ...tasks[index],
        expectedVideoCount,
        generatedVideos,
        failedVideoCount: Number(patch.failedVideoCount || tasks[index].failedVideoCount || 0),
        progress: {
          current: Math.max(Number(tasks[index].progress?.current) || 0, generatedVideos.length),
          total: expectedVideoCount,
          percent: Number(patch.percent || tasks[index].progress?.percent || 0)
        },
        updatedAt: now()
      };
      updated += 1;
    }
    if (updated) await kvSet(env.DB, "auto-tasks", compactAutoTasks(tasks));
    return json({ ok: true, updated });
  }

  if (method === "POST" && pathname === "/api/worker/sync") {
    const body = await readJson(request);
    const stamp = now();
    if (Array.isArray(body.assetGroups)) await kvSet(env.DB, "asset-groups", body.assetGroups);
    if (Array.isArray(body.audioGroups)) await kvSet(env.DB, "audio-groups", body.audioGroups);
    if (body.usage) await kvSet(env.DB, "asset-usage", body.usage);
    if (body.redditMixSettings) await kvSet(env.DB, "reddit-mix-settings", body.redditMixSettings);
    let novelImport = null;
    if (body.novelContent && typeof body.novelContent === "object") {
      novelImport = await mergeImportedNovelStore(env.DB, body.novelContent);
    }
    if (Array.isArray(body.officialPublishRecords)) {
      const existing = await kvGet(env.DB, "official-publish-records", []);
      await kvSet(env.DB, "official-publish-records", mergeOfficialPublishRecords(existing, body.officialPublishRecords));
    }
    let archive = null;
    if (body.refreshOfficialArchive) {
      archive = await refreshOfficialArchive(env, env.DB);
    }
    await kvSet(env.DB, "factory-worker-status", {
      running: true,
      cloud: false,
      workerId: String(body.workerId || "worker").slice(0, 80),
      retentionHours: Number(body.retentionHours || 48),
      lastSeenAt: stamp,
      message: "本机工人在线，混剪任务会在 Local Factory 执行。"
    });
    return json({ ok: true, novelImport, archive });
  }

  if (method === "POST" && pathname === "/api/worker/claim") {
    const payload = await readJson(request).catch(() => ({}));
    const workerId = String(payload.workerId || request.headers.get("x-factory-worker") || "worker").slice(0, 80);
    const job = await env.DB.prepare(`
      SELECT * FROM factory_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1
    `).first();
    if (!job) return json({ job: null });
    const stamp = now();
    const changed = await env.DB.prepare(`
      UPDATE factory_jobs
      SET status = 'running', worker_id = ?, claimed_at = ?, updated_at = ?, message = '工人机已接单'
      WHERE id = ? AND status = 'queued'
    `).bind(workerId, stamp, stamp, job.id).run();
    if (!changed.meta?.changes) return json({ job: null });
    await syncAutoTaskFromJob(env.DB, { ...job, status: "running", message: "工人机已接单", percent: 2 });
    return json({ job: workerJob({ ...job, status: "running" }) });
  }

  const jobMatch = pathname.match(/^\/api\/worker\/jobs\/([^/]+)$/);
  if (method === "GET" && jobMatch) {
    const job = await getJob(env.DB, decodeURIComponent(jobMatch[1]));
    if (!job) return errorJson("任务不存在。", 404);
    return json({ job: workerJob(job), cancelled: isCancelledJob(job) });
  }

  const progressMatch = pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/progress$/);
  if (method === "POST" && progressMatch) {
    const jobId = safeId(decodeURIComponent(progressMatch[1]));
    const current = await getJob(env.DB, jobId);
    if (!current) return errorJson("任务不存在。", 404);
    if (isCancelledJob(current)) return json({ ok: true, cancelled: true });
    const body = await readJson(request);
    const stamp = now();
    await env.DB.prepare(`
      UPDATE factory_jobs SET percent = ?, message = ?, result_json = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(
      Math.max(0, Math.min(100, Number(body.percent) || 0)),
      String(body.message || "").slice(0, 500),
      JSON.stringify(slimJobResult(body.result)),
      stamp,
      jobId
    ).run();
    const job = await getJob(env.DB, jobId);
    if (isCancelledJob(job)) return json({ ok: true, cancelled: true });
    if (job) await syncAutoTaskFromJob(env.DB, job).catch((error) => {
      console.error("syncAutoTaskFromJob", error?.message || error);
    });
    return json({ ok: true, cancelled: false });
  }

  const completeMatch = pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/complete$/);
  if (method === "POST" && completeMatch) {
    const jobId = safeId(decodeURIComponent(completeMatch[1]));
    const current = await getJob(env.DB, jobId);
    if (!current) return errorJson("任务不存在。", 404);
    const body = await readJson(request);
    const stamp = now();
    const rawResult = body.result && typeof body.result === "object" ? body.result : {};
    const cancelled = Boolean(body.cancelled) || isCancelledJob(current);
    const nextStatus = completeJobNextStatus({
      existingStatus: current.status,
      cancelled,
      failed: Boolean(body.error)
    });
    await env.DB.prepare(`
      UPDATE factory_jobs
      SET status = ?, percent = ?, message = ?, result_json = ?, error = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      nextStatus,
      nextStatus === "cancelled" ? Number(current.percent || body.percent || 0) : (Boolean(body.error) ? Number(body.percent || 0) : 100),
      String(nextStatus === "cancelled" ? (body.message || current.message || "已取消") : (body.message || (body.error ? body.error : "完成"))).slice(0, 500),
      JSON.stringify(persistableJobResult(rawResult)),
      nextStatus === "cancelled" ? "" : String(body.error || ""),
      stamp,
      stamp,
      jobId
    ).run();
    const job = await getJob(env.DB, jobId);
    if (job) {
      await syncAutoTaskFromJob(env.DB, job).catch((error) => {
        console.error("syncAutoTaskFromJob", error?.message || error);
      });
    }
    const result = persistableJobResult(rawResult);
    const incoming = Array.isArray(rawResult.officialPublishRecords) ? rawResult.officialPublishRecords : [];
    if (shouldWriteOfficialPublishRecords({ existingStatus: nextStatus, cancelled, records: incoming })) {
      try {
        const existing = await kvGet(env.DB, "official-publish-records", []);
        await kvSet(env.DB, "official-publish-records", mergeOfficialPublishRecords(existing, incoming).slice(0, 1200));
      } catch (error) {
        console.error("official-publish-records", error?.message || error);
      }
    }
    if (job?.type === "audio-generate") {
      if (nextStatus !== "cancelled" && Array.isArray(result.items) && result.items.length) {
        await attachAudioGenerateResults(env.DB, result.items);
      }
    }
    if (job?.type === "opening-variants" && nextStatus === "done") {
      await autoKeepAndVoiceOpeningJob(env.DB, job, result).catch((error) => {
        console.error("autoKeepAndVoiceOpeningJob", error?.message || error);
      });
    }
    return json({ ok: true, cancelled: nextStatus === "cancelled" });
  }

  if (method === "GET" && pathname === "/api/worker/jobs") {
    const { results } = await env.DB.prepare("SELECT * FROM factory_jobs ORDER BY created_at DESC LIMIT 50").all();
    return json({ jobs: (results || []).map(publicJob) });
  }

  return errorJson("未知工人接口。", 404);
}

export function publicJob(job) {
  return {
    jobId: job.id,
    id: job.id,
    type: job.type,
    status: job.status,
    percent: Number(job.percent || 0),
    message: job.message || "",
    error: job.error || "",
    result: parseJson(job.result_json, {}),
    createdAt: Number(job.created_at || 0),
    updatedAt: Number(job.updated_at || 0)
  };
}

function workerJob(job) {
  return {
    ...publicJob(job),
    payload: parseJson(job.payload_json, {})
  };
}

function bearer(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return String(request.headers.get("x-factory-worker-token") || "").trim();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function isDeletedTask(task) {
  return Boolean(task) && (Number(task.deleted) === 1 || task.status === "deleted");
}

export function mergeGeneratedVideos(existing, incoming) {
  const current = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const next = Array.isArray(incoming) ? incoming.filter(Boolean) : [];
  if (!next.length) return current;
  if (!current.length || next.length >= current.length) return next;
  const seen = new Set(current.map((video) => String(video.fileName || video.outputPath || "").trim()).filter(Boolean));
  const extras = next.filter((video) => {
    const key = String(video.fileName || video.outputPath || "").trim();
    return key && !seen.has(key);
  });
  return extras.length ? current.concat(extras) : current;
}

export function expectedTaskVideoCount(task = {}, result = {}, videos = []) {
  return Math.max(
    Number(task.expectedVideoCount) || 0,
    Number(task.generation?.totalVideos) || 0,
    Number(result.progressTotal) || 0,
    Number(task.progress?.total) || 0,
    Array.isArray(videos) ? videos.length : 0
  );
}

export function applyJobToTask(task, job) {
  if (!task || !job) return task;
  if (isDeletedTask(task)) {
    return { ...task, deleted: 1, status: "deleted" };
  }
  const result = parseJson(job.result_json, {});
  const sameJob = !task.generationJobId || String(task.generationJobId) === String(job.id || "");
  const cancelled = isCancelledJob(job) || (sameJob && String(task.status || "") === "canceled");
  const publishOnly = Boolean(result.publishOnly) || job.type === "official-publish";
  const incomingVideos = Array.isArray(result.results) ? result.results : [];
  const generatedVideos = mergeGeneratedVideos(task.generatedVideos, incomingVideos);
  const publishResults = cancelled
    ? (Array.isArray(task.publishResults) ? task.publishResults : [])
    : (Array.isArray(result.publishResults) ? result.publishResults : (task.publishResults || []));
  const expectedVideoCount = expectedTaskVideoCount(task, result, generatedVideos);
  const generatedCount = Math.max(Number(result.progressCurrent) || 0, generatedVideos.length);
  const publishFailed = Boolean(result.publishFailed);
  const generationFailed = (job.status === "failed" || Boolean(job.error)) && !generatedVideos.length && !publishOnly;
  const done = job.status === "done" && !publishFailed;
  const publishing = Boolean(result.publishProgress) && !done && !cancelled && !generationFailed;
  const status = cancelled
    ? "canceled"
    : generationFailed
      ? "failed"
      : publishFailed
        ? "needs_attention"
        : done
          ? "done"
          : "running";
  const phase = cancelled
    ? "canceled"
    : generationFailed
      ? "failed"
      : publishing
        ? "publishing"
        : publishFailed
          ? "needs_attention"
          : done
            ? (publishResults.length ? "done" : "generated")
            : publishOnly
              ? "publishing"
              : "generating";
  return {
    ...task,
    generationJobId: job.id,
    expectedVideoCount,
    status,
    phase,
    message: job.message || task.message || "",
    error: generationFailed ? (job.error || "") : "",
    publishError: result.publishError || (publishFailed ? job.error : "") || "",
    progress: {
      current: generatedCount,
      total: expectedVideoCount,
      percent: Number(job.percent || 0)
    },
    publishProgress: result.publishProgress || task.publishProgress || null,
    generatedVideos,
    publishResults,
    publishSummary: result.publishSummary || task.publishSummary || null,
    generationWarnings: Array.isArray(result.warnings) ? result.warnings : (task.generationWarnings || []),
    updatedAt: Number(job.updated_at || task.updatedAt || 0),
    generationCompletedAt: generatedVideos.length || done || publishFailed
      ? Number(job.completed_at || task.generationCompletedAt || Date.now())
      : task.generationCompletedAt || null
  };
}

async function syncAutoTaskFromJob(db, job) {
  const payload = parseJson(job.payload_json, {});
  const taskId = String(payload.taskId || "").trim();
  if (!taskId) return;
  const tasks = await kvGet(db, "auto-tasks", []);
  const index = tasks.findIndex((item) => item.id === taskId);
  if (index < 0 || isDeletedTask(tasks[index])) return;
  tasks[index] = applyJobToTask(tasks[index], job);
  await kvSet(db, "auto-tasks", compactAutoTasks(tasks));
}

function slimJobResult(value) {
  const result = value && typeof value === "object" ? value : {};
  const videos = Array.isArray(result.results) ? result.results : [];
  return {
    publishOnly: Boolean(result.publishOnly),
    progressCurrent: Number(result.progressCurrent || videos.length || 0),
    progressTotal: Number(result.progressTotal || 0),
    publishProgress: result.publishProgress || null,
    publishFailed: Boolean(result.publishFailed),
    publishError: String(result.publishError || "").slice(0, 400),
    results: videos.slice(0, 80).map((video) => ({
      fileName: String(video?.fileName || ""),
      outputPath: String(video?.outputPath || video?.path || "")
    }))
  };
}

async function autoKeepAndVoiceOpeningJob(db, job, result) {
  const payload = parseJson(job.payload_json, {});
  if (!payload.autoKeep || payload.autoKeptDone) return;
  const scripts = await persistOpeningVariantScripts(db, payload, result);
  if (!scripts.length) return;
  let audioJobId = "";
  if (payload.autoVoice) {
    const audioPayload = await buildAudioGeneratePayload(db, {
      novelId: payload.novelId,
      novelTitle: payload.title,
      voiceId: payload.voiceId,
      speechSpeed: payload.speechSpeed,
      speakOpeningTitle: payload.speakOpeningTitle === true,
      items: scripts.map((script) => ({
        novelId: script.novelId,
        novelTitle: payload.title,
        scriptId: script.id,
        title: script.title,
        script: script.text,
        openingTitle: script.openingTitle,
        speakOpeningTitle: script.speakOpeningTitle === true,
        voiceId: payload.voiceId,
        speechSpeed: payload.speechSpeed,
        sourceType: script.sourceType
      }))
    });
    const audioJob = await enqueueJob(db, {
      type: "audio-generate",
      title: `${payload.title || "小说"} · 配音 ${audioPayload.items.length} 条`,
      payload: audioPayload,
      createdBy: job.created_by || ""
    });
    audioJobId = audioJob.id;
  }
  const existing = parseJson(job.result_json, {});
  const nextPayload = { ...payload, autoKeptDone: true };
  await db.prepare("UPDATE factory_jobs SET payload_json = ?, result_json = ?, updated_at = ? WHERE id = ?")
    .bind(
      JSON.stringify(nextPayload),
      JSON.stringify({
        ...existing,
        autoKeptScriptIds: scripts.map((script) => script.id),
        audioJobId
      }),
      now(),
      job.id
    )
    .run();
}

export function persistableJobResult(value) {
  const result = value && typeof value === "object" ? value : {};
  const slim = slimJobResult(result);
  if (Array.isArray(result.items)) slim.items = result.items;
  if (Array.isArray(result.publishResults)) slim.publishResults = result.publishResults.slice(0, 80);
  if (result.publishSummary) slim.publishSummary = result.publishSummary;
  if (Array.isArray(result.warnings)) slim.warnings = result.warnings.slice(0, 12);
  if (Array.isArray(result.variants)) {
    slim.variants = result.variants.slice(0, 10).map((variant, index) => compactOpeningVariant(variant, index)).filter((variant) => variant.script);
    slim.model = String(result.model || "").slice(0, 120);
    slim.reasoningEffort = String(result.reasoningEffort || "").slice(0, 40);
  }
  if (Array.isArray(result.autoKeptScriptIds)) {
    slim.autoKeptScriptIds = result.autoKeptScriptIds.map((id) => String(id || "").trim()).filter(Boolean).slice(0, 10);
  }
  if (result.audioJobId) slim.audioJobId = String(result.audioJobId).slice(0, 120);
  if (Array.isArray(result.titles)) {
    slim.titles = result.titles.slice(0, 10).map((item) => ({
      id: String(item?.id || "").slice(0, 120),
      openingTitle: String(item?.openingTitle || "").slice(0, 120),
      openingTitleZh: String(item?.openingTitleZh || "").slice(0, 120)
    })).filter((item) => item.id && item.openingTitle);
    slim.model = String(result.model || slim.model || "").slice(0, 120);
    slim.reasoningEffort = String(result.reasoningEffort || slim.reasoningEffort || "").slice(0, 40);
  }
  slim.failedVideoCount = Number(result.failedVideoCount || 0);
  return slim;
}

function compactOpeningVariant(value, index) {
  const variant = value && typeof value === "object" ? value : {};
  return {
    id: String(variant.id || `variant-${index + 1}`).slice(0, 120),
    style: String(variant.style || "").slice(0, 80),
    styleLabel: String(variant.styleLabel || "").slice(0, 80),
    title: String(variant.title || "").slice(0, 240),
    openingTitle: String(variant.openingTitle || "").slice(0, 120),
    script: String(variant.script || "").slice(0, 20000),
    titleZh: String(variant.titleZh || "").slice(0, 240),
    openingTitleZh: String(variant.openingTitleZh || "").slice(0, 120),
    scriptZh: String(variant.scriptZh || "").slice(0, 20000)
  };
}

export async function pruneFactoryJobs(db, keepDays = 30) {
  const cutoff = Date.now() - Math.max(1, Number(keepDays) || 30) * 86_400_000;
  await db.prepare(`
    DELETE FROM factory_jobs
    WHERE status IN ('done', 'failed', 'cancelled') AND updated_at < ?
  `).bind(cutoff).run();
}

function compactAutoTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).slice(0, 200).map((task) => ({
    ...task,
    generatedVideos: (Array.isArray(task.generatedVideos) ? task.generatedVideos : []).slice(0, 80).map((video) => ({
      fileName: String(video?.fileName || ""),
      outputPath: String(video?.outputPath || video?.path || ""),
      duration: video?.duration
    })),
    publishResults: (Array.isArray(task.publishResults) ? task.publishResults : []).slice(0, 80),
    officialPublishRecords: undefined
  }));
}
