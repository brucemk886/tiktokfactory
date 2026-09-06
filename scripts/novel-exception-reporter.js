import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  classifyOfficialNovelEvent,
  classifyPublishRecord,
  isOfficialNovelTask,
  isUserCancelStatus,
  WORKER_EVENT_PAGE_LIMIT,
} from "./novel-exception-rules.js";
import { isOfficialTikTokPublishRecord } from "./publish-record-sources.js";

const DATABASE_NAME = "novel-exceptions.sqlite";

export function novelExceptionQueuePath(workDir) {
  return path.join(String(workDir || ""), DATABASE_NAME);
}

export function openNovelExceptionQueue(workDir) {
  const filePath = novelExceptionQueuePath(workDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 4000;
    CREATE TABLE IF NOT EXISTS novel_exception_outbox (
      event_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      acked_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_nexc_outbox_pending ON novel_exception_outbox (acked_at, created_at);
  `);
  return database;
}

export function enqueueNovelExceptionEvent(workDir, event) {
  if (!event?.eventId) return { queued: false };
  const database = openNovelExceptionQueue(workDir);
  try {
    database.prepare(`
      INSERT INTO novel_exception_outbox (event_id, payload_json, created_at, acked_at)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(event_id) DO NOTHING
    `).run(event.eventId, JSON.stringify(event), Number(event.observedAt) || Date.now());
    return { queued: true, eventId: event.eventId };
  } finally {
    database.close();
  }
}

export function listPendingNovelExceptionEvents(workDir, limit = WORKER_EVENT_PAGE_LIMIT) {
  const database = openNovelExceptionQueue(workDir);
  try {
    return database.prepare(`
      SELECT event_id, payload_json FROM novel_exception_outbox
      WHERE acked_at = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(WORKER_EVENT_PAGE_LIMIT, Number(limit) || WORKER_EVENT_PAGE_LIMIT)))
      .map((row) => {
        try { return JSON.parse(row.payload_json); } catch { return { eventId: row.event_id }; }
      });
  } finally {
    database.close();
  }
}

export function ackNovelExceptionEvents(workDir, eventIds, now = Date.now()) {
  const ids = (Array.isArray(eventIds) ? eventIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return { acked: 0 };
  const database = openNovelExceptionQueue(workDir);
  try {
    const statement = database.prepare(`UPDATE novel_exception_outbox SET acked_at = ? WHERE event_id = ?`);
    let acked = 0;
    database.exec("BEGIN");
    try {
      for (const id of ids) {
        const result = statement.run(now, id);
        acked += Number(result.changes) || 0;
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { acked };
  } finally {
    database.close();
  }
}

export function reportOfficialNovelTask(workDir, task, extras = {}) {
  if (!task || !isOfficialNovelTask(task)) return { events: 0 };
  if (isUserCancelStatus(task.status)) {
    const recovered = {
      eventId: `task-cancel:${task.id}`,
      recovered: true,
      kind: "production_failed",
      entityType: "task",
      entityId: task.id,
      localTaskId: task.id,
      sourceStatus: "canceled",
      sourceRevision: String(task.updatedAt || Date.now()),
      observedAt: Date.now(),
      source: "local",
    };
    enqueueNovelExceptionEvent(workDir, recovered);
    return { events: 1 };
  }

  const events = [];
  const classified = classifyOfficialNovelEvent({
    sourceStatus: task.status,
    message: task.error || task.message,
    localTaskId: task.id,
    cloudJobId: task.generationJobId || task.cloudJobId || "",
    workerId: extras.workerId || "",
    novelId: task.generation?.novelId || task.novelId || "",
    audioId: task.generation?.audioId || "",
    connectionId: firstConnectionId(task),
    failedVideoCount: task.failedVideoCount,
    uploadFailed: Boolean(task.publishRecordError),
    observedAt: Date.now(),
    source: "local",
    eventId: `task:${task.id}:${task.status}:${task.updatedAt || 0}`,
    sourceRevision: String(task.updatedAt || Date.now()),
    attemptId: String(task.generationJobId || task.id),
    entityType: "task",
    entityId: task.id,
    details: {
      novelName: task.generation?.novelName || task.name || "",
      audioName: task.generation?.audioDir || task.generation?.audioName || "",
      fileName: "",
    },
  });
  if (!classified.skipCreate) events.push(classified);

  const results = Array.isArray(task.publishResults) ? task.publishResults : [];
  for (const item of results) {
    if (!["failed", "needs_check"].includes(String(item.status || ""))) continue;
    const entityId = String(item.remoteTaskId || item.fileName || "").trim() || `${task.id}:result`;
    events.push(classifyOfficialNovelEvent({
      itemFailed: true,
      sourceStatus: item.status,
      message: item.error || item.message || item.note,
      localTaskId: task.id,
      remoteTaskId: item.remoteTaskId,
      remoteBatchId: item.batchId,
      fileName: item.fileName,
      connectionId: item.connectionId || firstConnectionId(task),
      entityType: "output",
      entityId,
      eventId: `output:${task.id}:${entityId}:${item.status}`,
      sourceRevision: String(task.updatedAt || Date.now()),
      attemptId: String(task.generationJobId || task.id),
      observedAt: Date.now(),
      source: "local",
      details: { fileName: item.fileName || "", audioName: item.fileName || "" },
    }));
  }

  const warnings = Array.isArray(task.generationWarnings) ? task.generationWarnings : [];
  warnings.forEach((warning, index) => {
    const text = String(warning || "").trim();
    if (!text) return;
    events.push(classifyOfficialNovelEvent({
      itemFailed: true,
      sourceStatus: "failed",
      message: text,
      localTaskId: task.id,
      entityType: "output",
      entityId: `${task.id}:warn:${index + 1}`,
      eventId: `warn:${task.id}:${index + 1}:${hashText(text)}`,
      sourceRevision: String(task.updatedAt || Date.now()),
      attemptId: String(task.generationJobId || task.id),
      observedAt: Date.now(),
      source: "local",
      details: { warningIndex: index + 1 },
    }));
  });

  let count = 0;
  for (const event of events) {
    if (event.skipCreate) continue;
    enqueueNovelExceptionEvent(workDir, event);
    count += 1;
  }
  return { events: count };
}

export function reportOfficialPublishRecord(workDir, record) {
  if (!record || !isOfficialTikTokPublishRecord(record)) return { events: 0 };
  const classified = classifyPublishRecord(record);
  const eventId = classified.eventId || `publish:${record.id}:${record.status}:${record.updatedAt || record.revision || 0}`;
  if (classified.skipCreate && classified.conditionState !== "recovered") {
    if (["published", "done"].includes(String(record.status || ""))) {
      enqueueNovelExceptionEvent(workDir, {
        eventId: `publish-recover:${record.id}:${record.updatedAt || record.revision || 0}`,
        recovered: true,
        kind: "official_publish_failed",
        entityType: "publish_record",
        entityId: record.id,
        sourceRevision: String(record.updatedAt || record.revision || Date.now()),
        observedAt: Date.now(),
        source: "local",
      });
      return { events: 1 };
    }
    return { events: 0 };
  }
  enqueueNovelExceptionEvent(workDir, {
    ...classified,
    eventId,
    sourceRevision: String(record.updatedAt || record.revision || Date.now()),
    source: "local",
  });
  return { events: 1 };
}

export function backfillUnresolvedNovelTasks(workDir, tasks = []) {
  let reported = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || isUserCancelStatus(task.status)) continue;
    if (!["failed", "needs_attention", "awaiting_review"].includes(String(task.status || ""))) continue;
    reported += reportOfficialNovelTask(workDir, task).events;
  }
  return { reported };
}

export async function flushNovelExceptionQueue(workDir, requestPage) {
  const events = listPendingNovelExceptionEvents(workDir);
  if (!events.length) return { sent: 0, acked: 0 };
  const response = await requestPage({ events });
  const accepted = Array.isArray(response?.acceptedEventIds) ? response.acceptedEventIds : [];
  if (!accepted.length) return { sent: events.length, acked: 0 };
  return { sent: events.length, ...ackNovelExceptionEvents(workDir, accepted) };
}

function firstConnectionId(task) {
  const accounts = task.publish?.officialAccountIds || task.publish?.accountIds || [];
  return String(accounts[0] || task.connectionId || "").trim();
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}
