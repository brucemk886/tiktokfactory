import { errorJson, json, readJson } from "./http.js";
import { kvGet } from "./kv.js";
import {
  classifyOfficialNovelEvent,
  classifyPublishRecord,
  DEFAULT_WORKER_ONLINE_WINDOW_MS,
  recommendedActionFor,
  sanitizeExceptionDetails,
  trustedFactoryTaskUrl,
  trustedHubReviewUrl,
  WORKER_EVENT_MAX_BYTES,
  WORKER_EVENT_PAGE_LIMIT,
} from "../../scripts/novel-exception-rules.js";
import {
  expireIgnoredExceptions,
  getNovelException,
  listExceptionActions,
  listNovelExceptions,
  deleteUnresolvedNovelExceptions,
  patchNovelException,
  projectNovelException,
  pruneResolvedNovelExceptions,
  readExceptionMeta,
  summarizeNovelExceptions,
  writeExceptionMeta,
} from "./novel-exceptions-store.js";
const MODULE_ID = "novel-exceptions";

export async function handleNovelExceptions(request, env, url, session) {
  if (!session) return null;
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/novel-exceptions")) return null;
  if (!canUseNovelExceptions(session.user)) {
    return errorJson("仅管理员可以查看小说异常。", 403);
  }

  const method = request.method;
  if (method === "GET" && pathname === "/api/novel-exceptions") {
    const query = Object.fromEntries(url.searchParams.entries());
    const listed = await listNovelExceptions(env.DB, query);
    return json({
      items: listed.items.map((row) => publicException(row, env)),
      nextCursor: listed.nextCursor,
      sourceFreshness: await readSourceFreshness(env.DB),
    });
  }
  if (method === "GET" && pathname === "/api/novel-exceptions/summary") {
    const query = Object.fromEntries(url.searchParams.entries());
    return json({
      ...(await summarizeNovelExceptions(env.DB, query)),
      sourceFreshness: await readSourceFreshness(env.DB),
    });
  }
  if (method === "POST" && pathname === "/api/novel-exceptions/bulk-delete") {
    const body = await readJson(request);
    const result = await deleteUnresolvedNovelExceptions(
      env.DB,
      {
        kind: body.kind || url.searchParams.get("kind") || "",
        stage: body.stage || url.searchParams.get("stage") || "",
        reason: body.reason || "clear-unresolved",
      },
      session.user?.id || session.user?.username || ""
    );
    return json({
      ...result,
      sourceFreshness: await readSourceFreshness(env.DB),
    });
  }
  const detail = pathname.match(/^\/api\/novel-exceptions\/([^/]+)$/);
  if (method === "GET" && detail) {
    const row = await getNovelException(env.DB, decodeURIComponent(detail[1]));
    if (!row) return errorJson("异常不存在。", 404);
    const actions = await listExceptionActions(env.DB, row.id, {
      cursor: url.searchParams.get("actionCursor") || "",
    });
    return json({
      item: publicException(row, env),
      actions: actions.items,
      nextActionCursor: actions.nextCursor,
      sourceFreshness: await readSourceFreshness(env.DB),
    });
  }
  if (method === "PATCH" && detail) {
    const body = await readJson(request);
    try {
      const result = await patchNovelException(env.DB, decodeURIComponent(detail[1]), body, session.user?.id || session.user?.username || "");
      return json({ item: publicException(result.row, env), replayed: result.replayed });
    } catch (error) {
      return errorJson(error.message || "更新失败。", error.statusCode || 400);
    }
  }
  return errorJson("未知异常接口。", 404);
}

export async function ingestWorkerNovelExceptionEvents(db, body, workerId, env, now = Date.now()) {
  const events = Array.isArray(body?.events) ? body.events : [];
  if (events.length > WORKER_EVENT_PAGE_LIMIT) {
    throw Object.assign(new Error(`一次最多上报 ${WORKER_EVENT_PAGE_LIMIT} 条异常事件。`), { statusCode: 400 });
  }
  const bytes = Buffer.byteLength(JSON.stringify(events), "utf8");
  if (bytes > WORKER_EVENT_MAX_BYTES) {
    throw Object.assign(new Error("异常事件超过大小上限。"), { statusCode: 400 });
  }
  const accepted = [];
  for (const raw of events) {
    const event = sanitizeWorkerEvent(raw, workerId, now);
    if (!event) continue;
    const result = await projectNovelException(db, event, now);
    if (event.eventId) accepted.push(event.eventId);
    else if (result.row?.id) accepted.push(result.row.id);
  }
  await writeExceptionMeta(db, "freshness:local", { at: now, workerId, accepted: accepted.length }, now);
  return { ok: true, acceptedEventIds: accepted };
}

export async function projectPublishRecordException(db, record, now = Date.now()) {
  if (!record) return { changed: false };
  const classified = classifyPublishRecord(record, now);
  if (classified.skipCreate && classified.conditionState !== "recovered") {
    if (["published", "done"].includes(String(record.status || "")) && record.id) {
      return projectNovelException(db, {
        ...classified,
        kind: classified.kind || "official_publish_failed",
        fingerprint: classified.fingerprint || `official_publish_failed|publish_record|${record.id}`,
        conditionState: "recovered",
        eventId: `publish-recover:${record.id}:${record.revision || record.updatedAt || now}`,
        sourceRevision: String(record.revision || record.updatedAt || now),
        entityType: "publish_record",
        entityId: record.id,
      }, now);
    }
    return { changed: false };
  }
  const result = await projectNovelException(db, {
    ...classified,
    eventId: classified.eventId || `publish:${record.id}:${record.revision || record.updatedAt || now}`,
    sourceRevision: String(record.revision || record.updatedAt || now),
    source: "signal-desk",
  }, now);
  await writeExceptionMeta(db, "freshness:signal-desk", { at: now }, now).catch(() => {});
  return result;
}

export async function projectJobException(db, job, now = Date.now()) {
  if (!job || !isNovelFactoryJob(job)) return { changed: false };
  const failed = String(job.status || "") === "failed";
  const cancelled = String(job.status || "") === "cancelled" || String(job.status || "") === "canceled";
  const event = classifyOfficialNovelEvent({
    sourceStatus: cancelled ? "canceled" : (failed ? "failed" : job.status),
    message: job.error || job.message,
    localTaskId: job.payload?.taskId || job.payload?.localTaskId || "",
    cloudJobId: job.id,
    workerId: job.worker_id || job.workerId || "",
    novelId: job.payload?.novelId || "",
    audioId: job.payload?.audioId || "",
    observedAt: now,
    source: "factory",
    eventId: `job:${job.id}:${job.status}:${job.updated_at || now}`,
    sourceRevision: String(job.updated_at || now),
    attemptId: String(job.payload?.attemptId || job.id),
    entityType: "job",
    entityId: job.id,
    recovered: String(job.status || "") === "done",
  });
  if (event.skipCreate && event.conditionState !== "recovered" && String(job.status || "") !== "done") {
    return { changed: false };
  }
  const result = String(job.status || "") === "done"
    ? await projectNovelException(db, {
      ...event,
      kind: "production_failed",
      fingerprint: `production_failed|job|${job.id}`,
      entityType: "job",
      entityId: job.id,
      conditionState: "recovered",
    }, now)
    : await projectNovelException(db, event, now);
  await writeExceptionMeta(db, "freshness:factory", { at: now, jobId: job.id, status: job.status }, now).catch(() => {});
  return result;
}

export async function reconcileNovelExceptions(db, now = Date.now()) {
  const expired = await expireIgnoredExceptions(db, now);
  const pruned = await pruneResolvedNovelExceptions(db, now);
  const heartbeats = await reconcileWorkerHeartbeats(db, now);
  await writeExceptionMeta(db, "freshness:reconcile", { at: now, expired: expired.updated, pruned: pruned.deleted, heartbeats: heartbeats.updated }, now);
  return { expired: expired.updated, pruned: pruned.deleted, heartbeats: heartbeats.updated };
}

export async function reconcileWorkerHeartbeats(db, now = Date.now()) {
  const windowMs = DEFAULT_WORKER_ONLINE_WINDOW_MS;
  const { results: busy } = await db.prepare(`
    SELECT worker_id AS workerId, COUNT(*) AS n
    FROM factory_jobs
    WHERE status IN ('queued', 'running')
      AND type IN ('reddit-mix', 'auto-task', 'official-publish')
      AND IFNULL(worker_id, '') != ''
    GROUP BY worker_id
    LIMIT 200
  `).all().catch(() => ({ results: [] }));
  const workerMap = await kvGet(db, "factory-workers", {});
  const seen = new Map(
    Object.values(workerMap && typeof workerMap === "object" ? workerMap : {})
      .filter((item) => item && item.workerId)
      .map((item) => [String(item.workerId), Number(item.lastSeenAt) || 0])
  );
  let updated = 0;
  for (const row of busy || []) {
    const workerId = String(row.workerId || "").trim();
    if (!workerId) continue;
    const lastSeenAt = seen.get(workerId) || 0;
    const offline = lastSeenAt > 0 && now - lastSeenAt > windowMs;
    const event = classifyOfficialNovelEvent({
      workerOffline: offline,
      workerId,
      recovered: !offline,
      source: "factory",
      eventId: `worker-heartbeat:${workerId}:${offline ? lastSeenAt : "ok"}`,
      sourceRevision: String(lastSeenAt || now),
      details: { affectedJobs: Number(row.n) || 0, lastSeenAt },
      observedAt: now,
    });
    if (event.skipCreate && !offline) {
      const recovered = await projectNovelException(db, {
        kind: "worker_heartbeat_timeout",
        fingerprint: `worker_heartbeat_timeout|worker|${workerId}`,
        entityType: "worker",
        entityId: workerId,
        workerId,
        conditionState: "recovered",
        eventId: `worker-heartbeat:${workerId}:ok`,
        sourceRevision: String(lastSeenAt || now),
        observedAt: now,
      }, now);
      if (recovered.changed) updated += 1;
      continue;
    }
    const result = await projectNovelException(db, event, now);
    if (result.changed) updated += 1;
  }
  return { updated };
}

function canUseNovelExceptions(user) {
  if (!user || user.role !== "admin") return false;
  const modules = Array.isArray(user.sidebarModules) ? user.sidebarModules : [];
  return modules.includes(MODULE_ID);
}

function sanitizeWorkerEvent(raw, workerId, now) {
  if (!raw || typeof raw !== "object") return null;
  const eventId = String(raw.eventId || "").trim();
  if (!eventId) return null;
  const classified = classifyOfficialNovelEvent({
    ...raw,
    workerId: String(raw.workerId || workerId || "").slice(0, 80),
    source: "local",
    observedAt: Number(raw.observedAt) || now,
    details: sanitizeExceptionDetails(raw.details || {}),
  });
  if (classified.skipCreate && classified.conditionState !== "recovered") {
    if (raw.recovered && raw.kind) {
      return {
        ...classified,
        kind: raw.kind,
        fingerprint: classified.fingerprint || `${raw.kind}|${raw.entityType || "task"}|${raw.entityId || raw.localTaskId || ""}`,
        conditionState: "recovered",
        eventId,
        sourceRevision: String(raw.sourceRevision || "").slice(0, 80),
        attemptId: String(raw.attemptId || "").slice(0, 80),
      };
    }
    return null;
  }
  return {
    ...classified,
    eventId,
    sourceRevision: String(raw.sourceRevision || classified.sourceRevision || "").slice(0, 80),
    attemptId: String(raw.attemptId || "").slice(0, 80),
  };
}

function publicException(row, env) {
  const factoryBase = String(env?.FACTORY_PUBLIC_BASE_URL || "https://factory.tiktokaitool.com");
  const hubBase = String(env?.SIGNAL_DESK_BASE_URL || "https://tiktokaitool.com");
  const taskLink = trustedFactoryTaskUrl(factoryBase, row.localTaskId || row.cloudJobId);
  const hubLink = trustedHubReviewUrl(hubBase, row.remoteBatchId || row.remoteTaskId);
  return {
    ...row,
    novelName: row.details?.novelName || "",
    scriptName: row.details?.scriptName || "",
    audioName: row.details?.audioName || row.details?.fileName || row.details?.audioId || "",
    associated: Boolean(row.novelId || row.scriptId || row.audioId || row.details?.novelName),
    recommendedAction: recommendedActionFor(row.kind),
    taskLink,
    hubLink,
    durationMs: Math.max(0, (row.lastSeenAt || 0) - (row.firstSeenAt || 0)),
  };
}

async function readSourceFreshness(db) {
  return {
    local: await readExceptionMeta(db, "freshness:local", { at: 0 }),
    factory: await readExceptionMeta(db, "freshness:factory", { at: 0 }),
    signalDesk: await readExceptionMeta(db, "freshness:signal-desk", { at: 0 }),
    reconcile: await readExceptionMeta(db, "freshness:reconcile", { at: 0 }),
  };
}

function isNovelFactoryJob(job) {
  const type = String(job.type || "").trim();
  return ["reddit-mix", "auto-task", "official-publish"].includes(type);
}
