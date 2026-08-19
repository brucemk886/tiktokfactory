import { archiveAccountKeysForScope, publicState } from "../../scripts/official-account-group-store.js";
import {
  listLatestArchiveAccounts,
  loadVideosForAccounts,
} from "./official-archive-store.js";
import {
  computeGroupReport,
  shanghaiDateKey,
  snapshotDateKey,
  videosForGroup,
  videosForProject,
} from "../../scripts/official-group-report.js";

const PROJECT_GROUP_ID = "";
const PROJECT_GROUP_NAME = "全部项目";

export async function loadArchiveBundle(env, db, accountKeys = null) {
  const accountRows = await listLatestArchiveAccounts(db);
  const keys = Array.isArray(accountKeys)
    ? accountKeys
    : accountRows.map((row) => row.account_key);
  const videosByAccount = await loadVideosForAccounts(env, db, keys, 80);
  return {
    accountRows: Array.isArray(accountKeys)
      ? accountRows.filter((row) => keys.includes(row.account_key))
      : accountRows,
    videosByAccount,
  };
}

export async function persistOpsSnapshots(env, db, store, now = Date.now(), bundle = null) {
  const state = publicState(store);
  const projects = state.projects.filter((item) => item.reportEnabled && item.moduleKey);
  if (!projects.length) return { count: 0 };
  const accountRows = bundle ? bundle.accountRows : await listLatestArchiveAccounts(db);
  const keys = [...new Set(projects.flatMap((project) => archiveAccountKeysForScope(store, accountRows, { projectId: project.id })))];
  const archive = bundle || await loadArchiveBundle(env, db, keys);
  let count = 0;
  for (const project of projects) {
    count += (await persistProjectOpsSnapshots(env, db, store, project, now, archive)).length;
  }
  return { count };
}

export async function persistProjectOpsSnapshots(env, db, store, project, now = Date.now(), bundle = null, scope = {}) {
  if (!project?.id || !project.reportEnabled || !project.moduleKey) return [];
  const archive = bundle || await loadArchiveBundle(env, db, archiveAccountKeysForScope(store, await listLatestArchiveAccounts(db), {
    groupId: scope.groupId || "",
    projectId: project.id,
    groupIds: scope.groupIds || null,
  }));
  const rows = [];
  for (const timestamp of snapshotTimestamps(now)) {
    rows.push(...buildProjectSnapshotRows(store, project, archive, timestamp, scope));
  }
  await upsertSnapshots(db, rows);
  return rows;
}

export function computeLiveReport({ store, project, groupId = "", period = "today", now = Date.now(), fromKey = "", toKey = "", bundle, groupIds = null }) {
  const scopeId = String(groupId || "");
  const scoped = scopeId
    ? videosForGroup({ store, groupId: scopeId, ...bundle })
    : videosForProject({
      store,
      projectId: project.id,
      ...bundle,
      groupIds: groupIds ? Array.from(groupIds) : null,
    });
  const group = scopeId
    ? (publicState(store).groups.find((item) => item.id === scopeId) || { id: scopeId, name: scopeId })
    : { id: PROJECT_GROUP_ID, name: PROJECT_GROUP_NAME };
  const report = computeGroupReport({
    group: scopeId ? group : project,
    project,
    accounts: scoped.accounts,
    videos: scoped.videos,
    period,
    now,
    fromKey,
    toKey,
  });
  return decorateReport(report, {
    moduleKey: project.moduleKey,
    project,
    group,
    period,
    now,
  });
}

export async function readOpsSnapshot(db, { moduleKey, projectId, groupId = "", period, dateKey }) {
  const row = await db.prepare(`
    SELECT id, module_key, project_id, project_name, group_id, group_name, period, date_key, report_json, created_at, updated_at
    FROM official_ops_reports
    WHERE module_key = ? AND project_id = ? AND group_id = ? AND period = ? AND date_key = ?
  `).bind(moduleKey, projectId, String(groupId || ""), period, dateKey).first();
  if (!row) return null;
  return {
    ...row,
    report: parseJson(row.report_json, null),
  };
}

export async function listOpsDates(db, { moduleKey, projectId, groupId = "", period }) {
  const { results } = await db.prepare(`
    SELECT date_key AS dateKey, group_id AS groupId, group_name AS groupName, updated_at AS updatedAt
    FROM official_ops_reports
    WHERE module_key = ? AND project_id = ? AND group_id = ? AND period = ?
    ORDER BY date_key DESC
    LIMIT 90
  `).bind(moduleKey, projectId, String(groupId || ""), period).all();
  return results || [];
}

function snapshotTimestamps(now) {
  const timestamps = [];
  const todayStart = Date.parse(`${shanghaiDateKey(now)}T00:00:00+08:00`);
  if (Number.isFinite(todayStart)) timestamps.push(todayStart - 1);
  timestamps.push(now);
  return timestamps;
}

function buildProjectSnapshotRows(store, project, bundle, now, scope = {}) {
  const state = publicState(store);
  const groups = state.groups.filter((item) => {
    if (item.projectId !== project.id) return false;
    if (scope.groupId) return item.id === scope.groupId;
    if (Array.isArray(scope.groupIds)) return scope.groupIds.includes(item.id);
    return true;
  });
  const rows = [];
  for (const period of ["today", "week"]) {
    if (!scope.groupId && !scope.groupIds) {
      rows.push(snapshotRow({
        moduleKey: project.moduleKey,
        project,
        group: { id: PROJECT_GROUP_ID, name: PROJECT_GROUP_NAME },
        period,
        report: computeLiveReport({ store, project, groupId: "", period, now, bundle }),
        now,
      }));
    }
    for (const group of groups) {
      rows.push(snapshotRow({
        moduleKey: project.moduleKey,
        project,
        group,
        period,
        report: computeLiveReport({ store, project, groupId: group.id, period, now, bundle }),
        now,
      }));
    }
  }
  return rows;
}

function snapshotRow({ moduleKey, project, group, period, report, now }) {
  const dateKey = snapshotDateKey(period, now);
  const groupId = String(group.id || "");
  return {
    id: [moduleKey, project.id, groupId || "_project", period, dateKey].join(":"),
    module_key: moduleKey,
    project_id: project.id,
    project_name: project.name || "",
    group_id: groupId,
    group_name: group.name || PROJECT_GROUP_NAME,
    period,
    date_key: dateKey,
    report_json: JSON.stringify({
      ...report,
      dateKey,
      moduleKey,
      projectId: project.id,
      projectName: project.name || "",
      groupId,
      groupName: group.name || PROJECT_GROUP_NAME,
    }),
    created_at: now,
    updated_at: now,
  };
}

function decorateReport(report, { moduleKey, project, group, period, now }) {
  return {
    ...report,
    dateKey: report.dateKey || snapshotDateKey(period, now),
    fromKey: report.fromKey || snapshotDateKey(period === "week" ? "week" : "today", now),
    toKey: report.toKey || shanghaiDateKey(now),
    moduleKey,
    projectId: project.id,
    projectName: project.name || "",
    groupId: String(group.id || ""),
    groupName: group.name || PROJECT_GROUP_NAME,
  };
}

export async function pruneOfficialOpsReports(db, keepDays = 90) {
  const cutoff = shanghaiDateKey(Date.now() - Math.max(1, keepDays) * 86_400_000);
  await db.prepare("DELETE FROM official_ops_reports WHERE date_key < ?").bind(cutoff).run();
}

async function upsertSnapshots(db, rows) {
  if (!rows.length) return;
  await db.batch(rows.map((row) => db.prepare(`
    INSERT INTO official_ops_reports (
      id, module_key, project_id, project_name, group_id, group_name, period, date_key, report_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_name = excluded.project_name,
      group_name = excluded.group_name,
      report_json = excluded.report_json,
      updated_at = excluded.updated_at
  `).bind(
    row.id,
    row.module_key,
    row.project_id,
    row.project_name,
    row.group_id,
    row.group_name,
    row.period,
    row.date_key,
    row.report_json,
    row.created_at,
    row.updated_at,
  )));
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
