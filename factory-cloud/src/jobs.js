import { assertOfficialPublishAccess } from "./official.js";
import { errorJson, json, now, randomToken, readJson, safeId } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import { mergeImportedNovelStore } from "./novels.js";
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

  if (method === "POST" && pathname === "/api/worker/sync") {
    const body = await readJson(request);
    const stamp = now();
    if (Array.isArray(body.assetGroups)) await kvSet(env.DB, "asset-groups", body.assetGroups);
    if (body.usage) await kvSet(env.DB, "asset-usage", body.usage);
    if (body.redditMixSettings) await kvSet(env.DB, "reddit-mix-settings", body.redditMixSettings);
    let novelImport = null;
    if (body.novelContent && typeof body.novelContent === "object") {
      novelImport = await mergeImportedNovelStore(env.DB, body.novelContent);
    }
    if (Array.isArray(body.officialPublishRecords)) {
      await kvSet(env.DB, "official-publish-records", body.officialPublishRecords);
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

  const progressMatch = pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/progress$/);
  if (method === "POST" && progressMatch) {
    const body = await readJson(request);
    const stamp = now();
    await env.DB.prepare(`
      UPDATE factory_jobs SET percent = ?, message = ?, status = ?, result_json = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      Math.max(0, Math.min(100, Number(body.percent) || 0)),
      String(body.message || "").slice(0, 500),
      "running",
      JSON.stringify(body.result || {}),
      stamp,
      safeId(decodeURIComponent(progressMatch[1]))
    ).run();
    const job = await getJob(env.DB, decodeURIComponent(progressMatch[1]));
    if (job) await syncAutoTaskFromJob(env.DB, job);
    return json({ ok: true });
  }

  const completeMatch = pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/complete$/);
  if (method === "POST" && completeMatch) {
    const body = await readJson(request);
    const stamp = now();
    const failed = Boolean(body.error);
    await env.DB.prepare(`
      UPDATE factory_jobs
      SET status = ?, percent = ?, message = ?, result_json = ?, error = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      failed ? "failed" : "done",
      failed ? Number(body.percent || 0) : 100,
      String(body.message || (failed ? body.error : "完成")).slice(0, 500),
      JSON.stringify(body.result || {}),
      String(body.error || ""),
      stamp,
      stamp,
      safeId(decodeURIComponent(completeMatch[1]))
    ).run();
    const job = await getJob(env.DB, decodeURIComponent(completeMatch[1]));
    if (job) await syncAutoTaskFromJob(env.DB, job);
    const result = parseJson(job?.result_json, {});
    const incoming = Array.isArray(result.officialPublishRecords) ? result.officialPublishRecords : [];
    if (incoming.length) {
      const existing = await kvGet(env.DB, "official-publish-records", []);
      await kvSet(env.DB, "official-publish-records", mergeOfficialPublishRecords(existing, incoming));
    }
    return json({ ok: true });
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

export function applyJobToTask(task, job) {
  if (!task || !job) return task;
  const result = parseJson(job.result_json, {});
  const cancelled = job.status === "cancelled";
  const publishOnly = Boolean(result.publishOnly) || job.type === "official-publish";
  const generatedVideos = !publishOnly && Array.isArray(result.results)
    ? result.results
    : (task.generatedVideos || []);
  const publishResults = Array.isArray(result.publishResults) ? result.publishResults : (task.publishResults || []);
  const generatedCount = Number(result.progressCurrent || generatedVideos.length || 0);
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
    status,
    phase,
    message: job.message || task.message || "",
    error: generationFailed ? (job.error || "") : "",
    publishError: result.publishError || (publishFailed ? job.error : "") || "",
    progress: {
      current: generatedCount,
      total: Number(result.progressTotal || task.progress?.total || 0),
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
  if (index < 0) return;
  tasks[index] = applyJobToTask(tasks[index], job);
  await kvSet(db, "auto-tasks", tasks);
}
