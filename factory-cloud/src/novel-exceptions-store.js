import {
  applyProjectionEvent,
  applyWorkflowAction,
  decodeListCursor,
  encodeListCursor,
  expireIgnoredWorkflow,
  RESOLVED_RETENTION_MS,
  sanitizeExceptionDetails,
  severityRank,
} from "../../scripts/novel-exception-rules.js";

const TABLE = "factory_novel_exceptions";
const ACTIONS = "factory_novel_exception_actions";
const META = "factory_novel_exception_meta";
const LIST_LIMIT = 20;
const ACTION_PAGE = 20;

export async function projectNovelException(db, event, now = Date.now()) {
  const incoming = event && typeof event === "object" ? event : {};
  const fingerprint = String(incoming.fingerprint || "").trim();
  const existing = fingerprint ? await getExceptionByFingerprint(db, fingerprint) : null;
  const result = applyProjectionEvent(existing, incoming, now);
  if (!result.changed || !result.row) return { changed: false, row: result.row };
  await upsertExceptionRow(db, result.row);
  return { changed: true, row: result.row };
}

export async function listNovelExceptions(db, query = {}) {
  const limit = Math.max(1, Math.min(50, Number(query.limit) || LIST_LIMIT));
  const workflow = String(query.workflowState || query.workflow || "").trim();
  const unresolved = query.unresolved !== false && !workflow;
  const filters = [];
  const binds = [];
  if (workflow) {
    filters.push("workflow_state = ?");
    binds.push(workflow);
  } else if (unresolved) {
    filters.push("workflow_state IN ('open', 'in_progress', 'ignored')");
    // deleted is hidden from the default list so old backfill can be cleared.
  }
  addEquals(filters, binds, "kind", query.kind);
  addEquals(filters, binds, "stage", query.stage);
  addEquals(filters, binds, "novel_id", query.novelId);
  addEquals(filters, binds, "connection_id", query.connectionId);
  addEquals(filters, binds, "worker_id", query.workerId);
  if (query.since) {
    filters.push("first_seen_at >= ?");
    binds.push(Number(query.since) || 0);
  }
  const cursor = decodeListCursor(query.cursor);
  if (cursor) {
    filters.push(`(
      CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END < ?
      OR (
        CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END = ?
        AND (first_seen_at > ? OR (first_seen_at = ? AND id > ?))
      )
    )`);
    binds.push(cursor.severity, cursor.severity, cursor.firstSeenAt, cursor.firstSeenAt, cursor.id);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const sql = `
    SELECT * FROM ${TABLE}
    ${where}
    ORDER BY
      CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END DESC,
      first_seen_at ASC,
      id ASC
    LIMIT ?
  `;
  const { results } = await db.prepare(sql).bind(...binds, limit + 1).all();
  const rows = (results || []).map(rowFromDb);
  const extra = rows.length > limit;
  const items = extra ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: extra ? encodeListCursor(items[items.length - 1]) : "",
  };
}

export async function summarizeNovelExceptions(db, query = {}) {
  const filters = [];
  const binds = [];
  addEquals(filters, binds, "kind", query.kind);
  addEquals(filters, binds, "stage", query.stage);
  addEquals(filters, binds, "novel_id", query.novelId);
  addEquals(filters, binds, "connection_id", query.connectionId);
  addEquals(filters, binds, "worker_id", query.workerId);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { results } = await db.prepare(`
    SELECT workflow_state, severity, COUNT(*) AS n
    FROM ${TABLE}
    ${where}
    GROUP BY workflow_state, severity
  `).bind(...binds).all();
  const summary = { open: 0, inProgress: 0, ignored: 0, resolved: 0, deleted: 0, critical: 0, warning: 0, info: 0 };
  for (const row of results || []) {
    const count = Number(row.n) || 0;
    if (row.workflow_state === "open") summary.open += count;
    if (row.workflow_state === "in_progress") summary.inProgress += count;
    if (row.workflow_state === "ignored") summary.ignored += count;
    if (row.workflow_state === "resolved") summary.resolved += count;
    if (row.workflow_state === "deleted") summary.deleted += count;
    const visible = row.workflow_state !== "resolved" && row.workflow_state !== "deleted";
    if (visible && row.severity === "critical") summary.critical += count;
    if (visible && row.severity === "warning") summary.warning += count;
    if (visible && row.severity === "info") summary.info += count;
  }
  return summary;
}

export async function getNovelException(db, id) {
  const row = await db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).bind(String(id || "")).first();
  return row ? rowFromDb(row) : null;
}

export async function getExceptionByFingerprint(db, fingerprint) {
  const row = await db.prepare(`SELECT * FROM ${TABLE} WHERE fingerprint = ?`).bind(String(fingerprint || "")).first();
  return row ? rowFromDb(row) : null;
}

export async function listExceptionActions(db, exceptionId, { cursor = "", limit = ACTION_PAGE } = {}) {
  const cap = Math.max(1, Math.min(50, Number(limit) || ACTION_PAGE));
  const after = Number(cursor) || 0;
  const { results } = await db.prepare(`
    SELECT * FROM ${ACTIONS}
    WHERE exception_id = ? AND created_at > ?
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(String(exceptionId || ""), after, cap + 1).all();
  const rows = (results || []).map(actionFromDb);
  const extra = rows.length > cap;
  const items = extra ? rows.slice(0, cap) : rows;
  return { items, nextCursor: extra ? String(items[items.length - 1].createdAt) : "" };
}

export async function patchNovelException(db, id, action, actorId, now = Date.now()) {
  const existing = await getNovelException(db, id);
  const requestId = String(action.requestId || "").trim();
  if (requestId) {
    const replay = await db.prepare(
      `SELECT id FROM ${ACTIONS} WHERE exception_id = ? AND request_id = ?`
    ).bind(String(id || ""), requestId).first();
    if (replay) return { replayed: true, row: existing };
  }
  const next = applyWorkflowAction(existing, action, now);
  await upsertExceptionRow(db, next);
  await db.prepare(`
    INSERT INTO ${ACTIONS} (id, exception_id, request_id, actor_id, action, reason, from_workflow, to_workflow, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `nact-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    next.id,
    requestId,
    String(actorId || ""),
    String(action.action || ""),
    String(action.reason || "").slice(0, 300),
    existing.workflowState,
    next.workflowState,
    now,
  ).run();
  return { replayed: false, row: next };
}

export async function deleteUnresolvedNovelExceptions(db, query = {}, actorId = "", now = Date.now()) {
  const listed = await listNovelExceptions(db, { ...query, unresolved: true, limit: 50, cursor: "" });
  let deleted = 0;
  let scanned = listed.items.length;
  let cursor = listed.nextCursor;
  const firstPage = listed.items;
  const pages = [firstPage];
  while (cursor && pages.length < 20) {
    const next = await listNovelExceptions(db, { ...query, unresolved: true, limit: 50, cursor });
    pages.push(next.items);
    scanned += next.items.length;
    cursor = next.nextCursor;
  }
  for (const items of pages) {
    for (const row of items) {
      if (row.workflowState === "deleted") continue;
      const result = await patchNovelException(db, row.id, {
        action: "delete",
        reason: query.reason || "clear-unresolved",
        version: row.version,
        requestId: `bulk-delete-${row.id}-${now}`,
      }, actorId, now);
      if (!result.replayed && result.row?.workflowState === "deleted") deleted += 1;
    }
  }
  return { deleted, scanned, truncated: Boolean(cursor) };
}

export async function expireIgnoredExceptions(db, now = Date.now()) {
  const { results } = await db.prepare(`
    SELECT * FROM ${TABLE}
    WHERE workflow_state = 'ignored' AND ignored_until > 0 AND ignored_until <= ? AND condition_state = 'active'
    LIMIT 200
  `).bind(now).all();
  let updated = 0;
  for (const raw of results || []) {
    const next = expireIgnoredWorkflow(rowFromDb(raw), now);
    if (next.workflowState !== raw.workflow_state) {
      await upsertExceptionRow(db, next);
      updated += 1;
    }
  }
  return { updated };
}

export async function pruneResolvedNovelExceptions(db, now = Date.now()) {
  const cutoff = now - RESOLVED_RETENTION_MS;
  const result = await db.prepare(`
    DELETE FROM ${TABLE}
    WHERE workflow_state = 'resolved' AND condition_state = 'recovered' AND resolved_at > 0 AND resolved_at < ?
  `).bind(cutoff).run();
  return { deleted: Number(result?.meta?.changes) || 0 };
}

export async function readExceptionMeta(db, key, fallback = {}) {
  const row = await db.prepare(`SELECT value_json FROM ${META} WHERE key = ?`).bind(String(key || "")).first();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json || "{}");
  } catch {
    return fallback;
  }
}

export async function writeExceptionMeta(db, key, value, now = Date.now()) {
  await db.prepare(`
    INSERT INTO ${META} (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).bind(String(key || ""), JSON.stringify(value || {}), now).run();
}

async function upsertExceptionRow(db, row) {
  const details = JSON.stringify(sanitizeExceptionDetails(row.details || {}));
  await db.prepare(`
    INSERT INTO ${TABLE} (
      id, fingerprint, source, entity_type, entity_id, source_instance_id, source_revision, event_id, attempt_id,
      kind, stage, severity, title, message, source_status, novel_id, script_id, audio_id, connection_id, worker_id,
      local_task_id, cloud_job_id, remote_batch_id, remote_task_id, publish_record_id, video_id,
      condition_state, workflow_state, first_seen_at, last_seen_at, last_checked_at, occurrence_count,
      resolved_at, ignored_until, ignore_reason, resolved_reason, version, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      source = excluded.source,
      entity_type = excluded.entity_type,
      entity_id = excluded.entity_id,
      source_instance_id = excluded.source_instance_id,
      source_revision = excluded.source_revision,
      event_id = excluded.event_id,
      attempt_id = excluded.attempt_id,
      kind = excluded.kind,
      stage = excluded.stage,
      severity = excluded.severity,
      title = excluded.title,
      message = excluded.message,
      source_status = excluded.source_status,
      novel_id = excluded.novel_id,
      script_id = excluded.script_id,
      audio_id = excluded.audio_id,
      connection_id = excluded.connection_id,
      worker_id = excluded.worker_id,
      local_task_id = excluded.local_task_id,
      cloud_job_id = excluded.cloud_job_id,
      remote_batch_id = excluded.remote_batch_id,
      remote_task_id = excluded.remote_task_id,
      publish_record_id = excluded.publish_record_id,
      video_id = excluded.video_id,
      condition_state = excluded.condition_state,
      workflow_state = excluded.workflow_state,
      last_seen_at = excluded.last_seen_at,
      last_checked_at = excluded.last_checked_at,
      occurrence_count = excluded.occurrence_count,
      resolved_at = excluded.resolved_at,
      ignored_until = excluded.ignored_until,
      ignore_reason = excluded.ignore_reason,
      resolved_reason = excluded.resolved_reason,
      version = excluded.version,
      details_json = excluded.details_json
  `).bind(
    row.id,
    row.fingerprint,
    row.source || "",
    row.entityType || "",
    row.entityId || "",
    row.sourceInstanceId || row.eventId || "",
    row.sourceRevision || "",
    row.eventId || "",
    row.attemptId || "",
    row.kind,
    row.stage || "",
    row.severity || "warning",
    row.title || "",
    row.message || "",
    row.sourceStatus || "",
    row.novelId || "",
    row.scriptId || "",
    row.audioId || "",
    row.connectionId || "",
    row.workerId || "",
    row.localTaskId || "",
    row.cloudJobId || "",
    row.remoteBatchId || "",
    row.remoteTaskId || "",
    row.publishRecordId || "",
    row.videoId || "",
    row.conditionState || "active",
    row.workflowState || "open",
    Number(row.firstSeenAt) || Date.now(),
    Number(row.lastSeenAt) || Date.now(),
    Number(row.lastCheckedAt) || Date.now(),
    Number(row.occurrenceCount) || 1,
    Number(row.resolvedAt) || 0,
    Number(row.ignoredUntil) || 0,
    row.ignoreReason || "",
    row.resolvedReason || "",
    Number(row.version) || 1,
    details,
  ).run();
}

function addEquals(filters, binds, column, value) {
  if (!value) return;
  filters.push(`${column} = ?`);
  binds.push(String(value));
}

function rowFromDb(row) {
  let details = {};
  try { details = JSON.parse(row.details_json || "{}"); } catch { details = {}; }
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    source: row.source,
    entityType: row.entity_type,
    entityId: row.entity_id,
    sourceInstanceId: row.source_instance_id,
    sourceRevision: row.source_revision,
    eventId: row.event_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    stage: row.stage,
    severity: row.severity,
    title: row.title,
    message: row.message,
    sourceStatus: row.source_status,
    novelId: row.novel_id,
    scriptId: row.script_id,
    audioId: row.audio_id,
    connectionId: row.connection_id,
    workerId: row.worker_id,
    localTaskId: row.local_task_id,
    cloudJobId: row.cloud_job_id,
    remoteBatchId: row.remote_batch_id,
    remoteTaskId: row.remote_task_id,
    publishRecordId: row.publish_record_id,
    videoId: row.video_id,
    conditionState: row.condition_state,
    workflowState: row.workflow_state,
    firstSeenAt: Number(row.first_seen_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0,
    lastCheckedAt: Number(row.last_checked_at) || 0,
    occurrenceCount: Number(row.occurrence_count) || 1,
    resolvedAt: Number(row.resolved_at) || 0,
    ignoredUntil: Number(row.ignored_until) || 0,
    ignoreReason: row.ignore_reason || "",
    resolvedReason: row.resolved_reason || "",
    version: Number(row.version) || 1,
    details,
    severityRank: severityRank(row.severity),
  };
}

function actionFromDb(row) {
  return {
    id: row.id,
    exceptionId: row.exception_id,
    requestId: row.request_id,
    actorId: row.actor_id,
    action: row.action,
    reason: row.reason,
    fromWorkflow: row.from_workflow,
    toWorkflow: row.to_workflow,
    createdAt: Number(row.created_at) || 0,
  };
}
