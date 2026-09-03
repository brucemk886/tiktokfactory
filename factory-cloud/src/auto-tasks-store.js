import { kvGet, kvSet } from "./kv.js";

const TABLE = "factory_auto_tasks";
const KV_KEY = "auto-tasks";
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;
const VIDEO_LIST_CAP = 80;

async function hasAutoTaskTable(db) {
  try {
    await db.prepare(`SELECT 1 FROM ${TABLE} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

function taskFromRow(row) {
  try {
    const task = JSON.parse(row?.value_json || "{}");
    return task && typeof task === "object" && task.id ? task : null;
  } catch {
    return null;
  }
}

function isDeleted(task) {
  return Boolean(task) && (Number(task.deleted) === 1 || task.status === "deleted");
}

// Keep one row bounded: the UI only needs file names for generated videos and
// the worker re-sends full result lists on completion anyway.
export function compactAutoTask(task) {
  return {
    ...task,
    generatedVideos: (Array.isArray(task.generatedVideos) ? task.generatedVideos : []).slice(0, VIDEO_LIST_CAP).map((video) => ({
      fileName: String(video?.fileName || ""),
      outputPath: String(video?.outputPath || video?.path || ""),
      duration: video?.duration
    })),
    publishResults: (Array.isArray(task.publishResults) ? task.publishResults : []).slice(0, VIDEO_LIST_CAP),
    officialPublishRecords: undefined
  };
}

export async function migrateAutoTasksFromKv(db) {
  if (!await hasAutoTaskTable(db)) return 0;
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).first();
  if (Number(count?.n || 0) > 0) return 0;
  const stored = await kvGet(db, KV_KEY, []);
  const tasks = (Array.isArray(stored) ? stored : []).filter((task) => task && typeof task === "object" && task.id);
  if (!tasks.length) return 0;
  for (let index = 0; index < tasks.length; index += 40) {
    await db.batch(tasks.slice(index, index + 40).map((task) => upsertStatement(db, task)));
  }
  await kvSet(db, KV_KEY, []);
  return tasks.length;
}

function upsertStatement(db, task) {
  const compact = compactAutoTask(task);
  const createdAt = Number(task.createdAt) || Number(task.updatedAt) || Date.now();
  const updatedAt = Number(task.updatedAt) || createdAt;
  return db.prepare(`
    INSERT INTO ${TABLE} (id, status, deleted, created_at, updated_at, value_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      deleted = excluded.deleted,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      value_json = excluded.value_json
  `).bind(
    String(task.id),
    String(task.status || ""),
    isDeleted(task) ? 1 : 0,
    createdAt,
    updatedAt,
    JSON.stringify(compact)
  );
}

export async function listAutoTasks(db, { limit = DEFAULT_LIST_LIMIT, includeDeleted = false } = {}) {
  await migrateAutoTasksFromKv(db);
  const cap = Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
  if (!await hasAutoTaskTable(db)) {
    const stored = await kvGet(db, KV_KEY, []);
    return (Array.isArray(stored) ? stored : []).filter((task) => includeDeleted || !isDeleted(task)).slice(0, cap);
  }
  const { results } = await db.prepare(
    `SELECT value_json FROM ${TABLE} ${includeDeleted ? "" : "WHERE deleted = 0"} ORDER BY created_at DESC LIMIT ?`
  ).bind(cap).all();
  return (results || []).map(taskFromRow).filter(Boolean);
}

export async function getAutoTask(db, id) {
  const taskId = String(id || "").trim();
  if (!taskId) return null;
  await migrateAutoTasksFromKv(db);
  if (!await hasAutoTaskTable(db)) {
    const stored = await kvGet(db, KV_KEY, []);
    return (Array.isArray(stored) ? stored : []).find((task) => task?.id === taskId) || null;
  }
  const row = await db.prepare(`SELECT value_json FROM ${TABLE} WHERE id = ?`).bind(taskId).first();
  return row ? taskFromRow(row) : null;
}

export async function saveAutoTask(db, task) {
  if (!task || typeof task !== "object" || !task.id) return null;
  await migrateAutoTasksFromKv(db);
  if (!await hasAutoTaskTable(db)) {
    const stored = await kvGet(db, KV_KEY, []);
    const tasks = Array.isArray(stored) ? stored : [];
    const index = tasks.findIndex((item) => item?.id === task.id);
    if (index < 0) tasks.unshift(task); else tasks[index] = task;
    await kvSet(db, KV_KEY, tasks.slice(0, 500));
    return task;
  }
  await upsertStatement(db, task).run();
  return task;
}

export async function saveAutoTasks(db, tasks = []) {
  const list = (Array.isArray(tasks) ? tasks : []).filter((task) => task && typeof task === "object" && task.id);
  if (!list.length) return 0;
  await migrateAutoTasksFromKv(db);
  if (!await hasAutoTaskTable(db)) {
    for (const task of list) await saveAutoTask(db, task);
    return list.length;
  }
  for (let index = 0; index < list.length; index += 40) {
    await db.batch(list.slice(index, index + 40).map((task) => upsertStatement(db, task)));
  }
  return list.length;
}

export const AUTO_TASK_TERMINAL_STATUSES = ["done", "failed", "canceled", "cancelled"];

// Soft-deleted tasks and long-finished history are dropped nightly so the
// table stays proportional to recent activity rather than lifetime volume.
export async function pruneAutoTasks(db, { deletedKeepDays = 30, finishedKeepDays = 90, now = Date.now() } = {}) {
  if (!await hasAutoTaskTable(db)) return { deleted: 0, finished: 0 };
  const deletedCutoff = now - Math.max(1, Number(deletedKeepDays) || 30) * 86_400_000;
  const finishedCutoff = now - Math.max(1, Number(finishedKeepDays) || 90) * 86_400_000;
  const placeholders = AUTO_TASK_TERMINAL_STATUSES.map(() => "?").join(", ");
  const [deleted, finished] = await db.batch([
    db.prepare("DELETE FROM factory_auto_tasks WHERE deleted = 1 AND updated_at < ?").bind(deletedCutoff),
    db.prepare(`DELETE FROM factory_auto_tasks WHERE status IN (${placeholders}) AND updated_at < ?`).bind(...AUTO_TASK_TERMINAL_STATUSES, finishedCutoff)
  ]);
  return {
    deleted: Number(deleted?.meta?.changes || 0),
    finished: Number(finished?.meta?.changes || 0)
  };
}
