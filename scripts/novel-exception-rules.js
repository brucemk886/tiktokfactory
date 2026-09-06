export const NOVEL_EXCEPTION_KINDS = Object.freeze({
  productionFailed: "production_failed",
  awaitingReview: "awaiting_review",
  uploadHandoffFailed: "upload_handoff_failed",
  workerHeartbeatTimeout: "worker_heartbeat_timeout",
  officialPublishFailed: "official_publish_failed",
  publishNeedsReview: "publish_needs_review",
  resultSyncFailed: "result_sync_failed",
  accountAuthFailed: "account_auth_failed",
  otherProduction: "other_production",
});

export const V1_NOVEL_EXCEPTION_KINDS = Object.freeze(Object.values(NOVEL_EXCEPTION_KINDS));

export const DEFERRED_NOVEL_EXCEPTION_KINDS = Object.freeze([
  "stuck_no_progress",
  "content_mapping_missing",
]);

export const NOVEL_EXCEPTION_STAGES = Object.freeze({
  produce: "produce",
  upload: "upload",
  publish: "publish",
  sync: "sync",
  worker: "worker",
  account: "account",
});

export const WORKFLOW_STATES = Object.freeze(["open", "in_progress", "resolved", "ignored"]);
export const CONDITION_STATES = Object.freeze(["active", "recovered", "unknown"]);

export const DEFAULT_WORKER_ONLINE_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_RESULT_SYNC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const RESOLVED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_EXCEPTION_DETAILS_BYTES = 4 * 1024;
export const WORKER_EVENT_PAGE_LIMIT = 40;
export const WORKER_EVENT_MAX_BYTES = 96 * 1024;

const AUTH_ERROR_CODES = new Set([
  "unauthorized",
  "auth_failed",
  "token_expired",
  "scope_missing",
  "video.publish",
]);

const REMOTE_FAILURES = new Set(["failed", "rejected", "status_timeout"]);
const TRUSTED_HUB_HOSTS = new Set(["tiktokaitool.com", "www.tiktokaitool.com"]);
const TRUSTED_FACTORY_HOSTS = new Set(["factory.tiktokaitool.com", "localhost", "127.0.0.1"]);

export function isOfficialNovelTask(task = {}) {
  const provider = String(task.publish?.provider || task.provider || "").trim().toLowerCase();
  if (provider && provider !== "official") return false;
  const type = String(task.taskType || task.type || "").trim().toLowerCase();
  if (["schulte", "quiz", "psychology", "psychology-collage", "psychology-target-2", "podcast"].includes(type)) return false;
  if (task.module && !["novel", "novel-promotion", "reddit-mix", ""].includes(String(task.module))) return false;
  return provider === "official" || type === "reddit-mix" || type === "auto-task" || Boolean(task.generation);
}

export function isUserCancelStatus(status) {
  return ["canceled", "cancelled"].includes(String(status || "").trim().toLowerCase());
}

export function exceptionFingerprint({ kind, entityType, entityId, connectionId = "" } = {}) {
  const parts = [
    String(kind || "").trim(),
    String(entityType || "").trim(),
    String(entityId || "").trim(),
  ];
  if (kind === NOVEL_EXCEPTION_KINDS.accountAuthFailed) {
    parts.push(String(connectionId || "").trim());
  }
  return parts.filter(Boolean).join("|");
}

export function classifyOfficialNovelEvent(input = {}) {
  const errorCode = String(input.errorCode || "").trim();
  const sourceStatus = String(input.sourceStatus || input.status || "").trim().toLowerCase();
  const remoteStatus = String(input.officialRemoteStatus || input.remoteStatus || "").trim().toLowerCase();
  const observedAt = Number(input.observedAt) || Date.now();

  if (isUserCancelStatus(sourceStatus) || input.cancelled) {
    return { kind: "", conditionState: "recovered", skipCreate: true };
  }

  if (errorCode && AUTH_ERROR_CODES.has(errorCode)) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.accountAuthFailed,
      stage: NOVEL_EXCEPTION_STAGES.account,
      severity: "critical",
      title: "账号授权失效",
      entityType: "account",
      entityId: String(input.connectionId || "").trim(),
    });
  }

  if (remoteStatus === "needs_review" || sourceStatus === "needs_review") {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.publishNeedsReview,
      stage: NOVEL_EXCEPTION_STAGES.publish,
      severity: "critical",
      title: "发布状态需要中台核查",
      recommendedAction: "open_hub",
    });
  }

  if (REMOTE_FAILURES.has(remoteStatus) || (sourceStatus === "failed" && input.entityType === "publish_record")) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.officialPublishFailed,
      stage: NOVEL_EXCEPTION_STAGES.publish,
      severity: "critical",
      title: "官方发布失败",
      recommendedAction: "open_hub",
    });
  }

  if (input.kind === NOVEL_EXCEPTION_KINDS.resultSyncFailed || input.syncFailed) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.resultSyncFailed,
      stage: NOVEL_EXCEPTION_STAGES.sync,
      severity: "warning",
      title: "发布结果同步异常",
    });
  }

  if (sourceStatus === "submitted" && Number(input.scheduledAt) > 0 && observedAt - Number(input.scheduledAt) >= DEFAULT_RESULT_SYNC_GRACE_MS) {
    if (Number(input.scheduledAt) > observedAt) return { kind: "", skipCreate: true };
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.resultSyncFailed,
      stage: NOVEL_EXCEPTION_STAGES.sync,
      severity: "warning",
      title: "发布结果待核对",
      message: input.message || "到期后超过宽限仍无可靠终态，不代表 TikTok 已失败。",
    });
  }

  if (sourceStatus === "awaiting_review") {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.awaitingReview,
      stage: NOVEL_EXCEPTION_STAGES.produce,
      severity: "info",
      title: "等待人工确认发布",
    });
  }

  if (input.uploadFailed || (sourceStatus === "needs_attention" && /记录保存失败|交接|上传/.test(String(input.message || "")))) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.uploadHandoffFailed,
      stage: NOVEL_EXCEPTION_STAGES.upload,
      severity: "critical",
      title: "上传或交接失败",
    });
  }

  if (sourceStatus === "failed" || input.itemFailed || Number(input.failedVideoCount) > 0) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.productionFailed,
      stage: NOVEL_EXCEPTION_STAGES.produce,
      severity: "critical",
      title: input.itemFailed ? "单条成片失败" : "混剪或生成失败",
    });
  }

  if (sourceStatus === "needs_attention") {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.otherProduction,
      stage: NOVEL_EXCEPTION_STAGES.produce,
      severity: "warning",
      title: "需要人工处理",
    });
  }

  if (input.workerOffline) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.workerHeartbeatTimeout,
      stage: NOVEL_EXCEPTION_STAGES.worker,
      severity: "warning",
      title: "工人心跳超时",
      entityType: "worker",
      entityId: String(input.workerId || "").trim(),
      message: input.message || "超过 10 分钟没有成功心跳。领取任务可能仍在跑，不代表机器已死。",
    });
  }

  if (input.recovered) {
    return { ...eventDraft(input, { kind: input.kind || NOVEL_EXCEPTION_KINDS.otherProduction }), conditionState: "recovered" };
  }

  if (errorCode) {
    return eventDraft(input, {
      kind: NOVEL_EXCEPTION_KINDS.otherProduction,
      stage: NOVEL_EXCEPTION_STAGES.produce,
      severity: "warning",
      title: "其他生产异常",
    });
  }

  return { kind: "", skipCreate: true };
}

export function classifyPublishRecord(record = {}, now = Date.now()) {
  return classifyOfficialNovelEvent({
    sourceStatus: record.status,
    officialRemoteStatus: record.officialRemoteStatus,
    scheduledAt: record.scheduleAt || record.scheduledAt,
    observedAt: now,
    connectionId: record.connectionId,
    errorCode: record.errorCode,
    message: record.publishError || record.note || record.message,
    entityType: "publish_record",
    entityId: record.id || record.recordKey || record.remoteTaskId,
    localTaskId: record.taskId || record.localTaskId,
    remoteBatchId: record.batchId || (record.officialBatchIds || [])[0],
    remoteTaskId: record.remoteTaskId,
    publishRecordId: record.id,
    videoId: record.videoId,
    fileName: record.fileName,
  });
}

export function applyProjectionEvent(existing, event, now = Date.now()) {
  const incoming = normalizeEvent(event, now);
  if (!incoming.fingerprint) return { changed: false, row: existing || null };
  if (!existing) {
    if (incoming.conditionState === "recovered" || incoming.skipCreate) {
      return { changed: false, row: null };
    }
    return {
      changed: true,
      row: {
        ...incoming,
        id: incoming.id || randomExceptionId(now),
        firstSeenAt: incoming.observedAt,
        lastSeenAt: incoming.observedAt,
        lastCheckedAt: incoming.observedAt,
        occurrenceCount: 1,
        workflowState: "open",
        version: 1,
      },
    };
  }

  const sameEvent = incoming.eventId && incoming.eventId === existing.eventId;
  const sameRevision = incoming.sourceRevision && incoming.sourceRevision === existing.sourceRevision;
  if (sameEvent || (sameRevision && incoming.conditionState !== "recovered")) {
    return {
      changed: existing.lastCheckedAt !== incoming.observedAt,
      row: {
        ...existing,
        lastCheckedAt: incoming.observedAt,
        conditionState: incoming.conditionState === "unknown" ? "unknown" : existing.conditionState,
      },
    };
  }

  if (incoming.conditionState === "recovered") {
    if (existing.conditionState === "recovered" && existing.workflowState === "resolved") {
      return { changed: false, row: { ...existing, lastCheckedAt: incoming.observedAt } };
    }
    return {
      changed: true,
      row: {
        ...existing,
        conditionState: "recovered",
        workflowState: existing.workflowState === "ignored" ? "ignored" : "resolved",
        resolvedAt: existing.resolvedAt || incoming.observedAt,
        resolvedReason: existing.resolvedReason || "source_recovered",
        lastCheckedAt: incoming.observedAt,
        lastSeenAt: existing.lastSeenAt,
        version: Number(existing.version || 1) + 1,
      },
    };
  }

  if (incoming.conditionState === "unknown") {
    return {
      changed: existing.conditionState !== "unknown",
      row: { ...existing, conditionState: "unknown", lastCheckedAt: incoming.observedAt },
    };
  }

  const newAttempt = incoming.attemptId && incoming.attemptId !== existing.attemptId;
  const reopen = existing.conditionState === "recovered" || existing.workflowState === "resolved";
  return {
    changed: true,
    row: {
      ...existing,
      ...pickProjectionFields(incoming),
      conditionState: "active",
      workflowState: reopen || existing.workflowState === "resolved" ? "open" : existing.workflowState,
      lastSeenAt: incoming.observedAt,
      lastCheckedAt: incoming.observedAt,
      occurrenceCount: newAttempt || reopen ? Number(existing.occurrenceCount || 1) + 1 : Number(existing.occurrenceCount || 1),
      resolvedAt: reopen ? 0 : existing.resolvedAt,
      resolvedReason: reopen ? "" : existing.resolvedReason,
      version: Number(existing.version || 1) + 1,
    },
  };
}

export function applyWorkflowAction(existing, action = {}, now = Date.now()) {
  if (!existing) throw Object.assign(new Error("异常不存在。"), { statusCode: 404 });
  if (Number(action.version) !== Number(existing.version)) {
    throw Object.assign(new Error("异常已被其他人更新，请刷新后重试。"), { statusCode: 409, code: "VERSION_CONFLICT" });
  }
  const name = String(action.action || "").trim();
  const reason = String(action.reason || "").trim();
  const next = { ...existing, lastCheckedAt: now, version: Number(existing.version || 1) + 1 };
  if (name === "start") {
    if (existing.workflowState !== "open" && existing.workflowState !== "in_progress") {
      throw Object.assign(new Error("只有待处理异常可以开始处理。"), { statusCode: 400 });
    }
    next.workflowState = "in_progress";
  } else if (name === "ignore") {
    if (!reason) throw Object.assign(new Error("忽略必须填写原因。"), { statusCode: 400 });
    next.workflowState = "ignored";
    next.ignoreReason = reason;
    next.ignoredUntil = resolveIgnoreUntil(action.ignoreFor, now);
  } else if (name === "reopen" || name === "unignore") {
    next.workflowState = "open";
    next.ignoredUntil = 0;
  } else if (name === "resolve_manual") {
    if (!reason) throw Object.assign(new Error("人工结案必须填写原因。"), { statusCode: 400 });
    next.workflowState = "resolved";
    next.resolvedAt = now;
    next.resolvedReason = `manual:${reason}`;
    next.conditionState = existing.conditionState === "recovered" ? "recovered" : existing.conditionState;
  } else if (name === "review") {
    if (existing.conditionState === "recovered") {
      next.workflowState = "resolved";
      next.resolvedAt = now;
      next.resolvedReason = existing.resolvedReason || "review_confirmed_recovered";
    } else if (existing.conditionState === "unknown") {
      next.workflowState = existing.workflowState === "ignored" ? "ignored" : "open";
    } else {
      next.workflowState = "open";
    }
  } else {
    throw Object.assign(new Error("不支持的异常操作。"), { statusCode: 400 });
  }
  return next;
}

export function expireIgnoredWorkflow(row, now = Date.now()) {
  if (!row || row.workflowState !== "ignored") return row;
  if (Number(row.ignoredUntil) > 0 && Number(row.ignoredUntil) <= now && row.conditionState === "active") {
    return { ...row, workflowState: "open", ignoredUntil: 0, version: Number(row.version || 1) + 1 };
  }
  return row;
}

export function trustedFactoryTaskUrl(factoryBase, taskId) {
  const base = trustedOrigin(factoryBase, TRUSTED_FACTORY_HOSTS, "https://factory.tiktokaitool.com");
  return { href: `${base}/tasks`, copyId: String(taskId || "").trim(), locateSupported: false };
}

export function trustedHubReviewUrl(hubBase, batchId) {
  const base = trustedOrigin(hubBase, TRUSTED_HUB_HOSTS, "https://tiktokaitool.com");
  return { href: base, copyId: String(batchId || "").trim(), locateSupported: false };
}

export function recommendedActionFor(kind) {
  if (kind === NOVEL_EXCEPTION_KINDS.officialPublishFailed || kind === NOVEL_EXCEPTION_KINDS.publishNeedsReview) {
    return "open_hub";
  }
  if (kind === NOVEL_EXCEPTION_KINDS.workerHeartbeatTimeout) return "wait_heartbeat";
  return "open_task";
}

export function sanitizeExceptionDetails(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  for (const key of ["token", "apiKey", "authorization", "cookie", "signature", "signedUrl", "secret"]) {
    delete raw[key];
  }
  let text = JSON.stringify(raw);
  if (Buffer.byteLength(text, "utf8") > MAX_EXCEPTION_DETAILS_BYTES) {
    text = JSON.stringify({ truncated: true, keys: Object.keys(raw).slice(0, 12) });
  }
  return JSON.parse(text);
}

export function encodeListCursor(row) {
  if (!row) return "";
  return Buffer.from(JSON.stringify({
    severity: severityRank(row.severity),
    firstSeenAt: Number(row.firstSeenAt) || 0,
    id: String(row.id || ""),
  }), "utf8").toString("base64url");
}

export function decodeListCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function severityRank(value) {
  return { critical: 3, warning: 2, info: 1 }[String(value || "")] || 0;
}

function eventDraft(input, extra) {
  const observedAt = Number(input.observedAt) || Date.now();
  const entityType = extra.entityType || input.entityType || "task";
  const entityId = extra.entityId || input.entityId || input.localTaskId || input.cloudJobId || input.remoteTaskId || "";
  const kind = extra.kind;
  return {
    skipCreate: false,
    conditionState: "active",
    eventId: String(input.eventId || "").trim(),
    sourceRevision: String(input.sourceRevision || "").trim(),
    attemptId: String(input.attemptId || "").trim(),
    source: String(input.source || "factory").trim() || "factory",
    kind,
    stage: extra.stage,
    severity: extra.severity,
    title: extra.title,
    message: String(extra.message || input.message || "").slice(0, 400),
    sourceStatus: String(input.sourceStatus || input.status || "").slice(0, 80),
    entityType,
    entityId,
    novelId: String(input.novelId || "").trim(),
    scriptId: String(input.scriptId || "").trim(),
    audioId: String(input.audioId || "").trim(),
    connectionId: String(input.connectionId || "").trim(),
    workerId: String(input.workerId || "").trim(),
    localTaskId: String(input.localTaskId || "").trim(),
    cloudJobId: String(input.cloudJobId || "").trim(),
    remoteBatchId: String(input.remoteBatchId || "").trim(),
    remoteTaskId: String(input.remoteTaskId || "").trim(),
    publishRecordId: String(input.publishRecordId || "").trim(),
    videoId: String(input.videoId || "").trim(),
    fileName: String(input.fileName || "").trim(),
    recommendedAction: extra.recommendedAction || recommendedActionFor(kind),
    fingerprint: exceptionFingerprint({ kind, entityType, entityId, connectionId: input.connectionId }),
    details: sanitizeExceptionDetails(input.details || {}),
    observedAt,
  };
}

function normalizeEvent(event, now) {
  if (event?.skipCreate && event.conditionState !== "recovered") return { fingerprint: "", skipCreate: true };
  const draft = event?.kind ? event : classifyOfficialNovelEvent({ ...event, observedAt: now });
  if (!draft.kind && draft.conditionState !== "recovered") return { fingerprint: "", skipCreate: true };
  return {
    ...draft,
    fingerprint: draft.fingerprint || exceptionFingerprint(draft),
    observedAt: Number(draft.observedAt) || now,
    conditionState: draft.conditionState || "active",
  };
}

function pickProjectionFields(incoming) {
  return {
    source: incoming.source,
    entityType: incoming.entityType,
    entityId: incoming.entityId,
    sourceInstanceId: incoming.sourceInstanceId || incoming.eventId || "",
    sourceRevision: incoming.sourceRevision,
    eventId: incoming.eventId,
    attemptId: incoming.attemptId,
    kind: incoming.kind,
    stage: incoming.stage,
    severity: incoming.severity,
    title: incoming.title,
    message: incoming.message,
    sourceStatus: incoming.sourceStatus,
    novelId: incoming.novelId,
    scriptId: incoming.scriptId,
    audioId: incoming.audioId,
    connectionId: incoming.connectionId,
    workerId: incoming.workerId,
    localTaskId: incoming.localTaskId,
    cloudJobId: incoming.cloudJobId,
    remoteBatchId: incoming.remoteBatchId,
    remoteTaskId: incoming.remoteTaskId,
    publishRecordId: incoming.publishRecordId,
    videoId: incoming.videoId,
    details: incoming.details,
  };
}

function resolveIgnoreUntil(ignoreFor, now) {
  const value = String(ignoreFor || "").trim();
  if (value === "1h") return now + 60 * 60 * 1000;
  if (value === "24h") return now + 24 * 60 * 60 * 1000;
  return 0;
}

function trustedOrigin(value, hosts, fallback) {
  const raw = String(value || fallback).trim() || fallback;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return fallback;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return fallback;
    if (!hosts.has(url.hostname)) return fallback;
    return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function randomExceptionId(now) {
  return `nexc-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
