import { loadReportContext } from "./psychology-report-data.js";
import { pagePublishRecords } from './publish-records-store.js';
import { publishAccountDirectory } from './psychology-account-access.js';
import {
  accountMatchesProject,
  assignAccounts,
  attachAccounts,
  createGroup,
  createProject,
  deleteGroup,
  deleteProject,
  ensureModuleProjects,
  findProjectForModule,
  normalizeStore,
  publicState,
  scopeOfficialAccess,
  updateGroup,
  updateProject,
  rememberAccountAliases,
  accountsFromArchiveRows,
  archiveAccountKeysForScope,
  connectionIdsForProjectScope,
  userAllowedGroupIds,
} from "../../scripts/official-account-group-store.js";
import { attachPublishOutcome, chunkList, connectionIdsFromArchiveRows, mergePublishStats, parseShanghaiDate, resolveReportWindow } from "../../scripts/official-group-report.js";
import { attachOfficialAccountNames, hydrateOfficialPublishRecords, publishRecordsSince, summarizeOfficialPublishRecords } from "../../scripts/official-publish-records.js";
import { listPublishRecords } from "./publish-records-store.js";
import { ensurePublishWebhook, readPublishWebhookState } from "./publish-webhook.js";
import { errorJson, json, readJson } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import {
  accountsFromLatestArchive,
  directoryAccountsFromRows,
  LATEST_ACCOUNTS_LIMIT,
  listAccountDirectory,
  listLatestArchiveAccounts,
  loadAccountAssignments,
  loadVideosForAccounts,
  refreshOfficialArchive,
  saveAccountAssignments,
} from "./official-archive-store.js";
import {
  computeLiveReport,
  listOpsDates,
  loadArchiveBundle,
  readOpsSnapshot,
} from "./ops-report-store.js";
import { signalDesk, signalDeskAllAccounts } from "./signal-desk.js";
import { handlePhotoPublishing } from "./photo-publishing.js";

export async function handleOfficial(request, env, url, session) {
  if (!session) return null;
  const method = request.method;
  const pathname = url.pathname;
  const db = env.DB;

  const photoResponse = await handlePhotoPublishing(request, env, url, session, assertOfficialPublishAccess);
  if (photoResponse) return photoResponse;

  if (pathname === "/api/private-tiktok/settings") {
    if (method === "GET") return json(await publicOfficialSettings(db, env));
    if (method === "POST") {
      if (!isAdmin(session)) return errorJson("仅管理员可以修改官方通道设置。", 403);
      const payload = await readJson(request);
      const current = await kvGet(db, "official-settings", {});
      // Spread the stored settings so webhook registration state survives a save.
      const next = {
        ...current,
        baseUrl: normalizeBase(payload.baseUrl || current.baseUrl || env.SIGNAL_DESK_BASE_URL || "https://tiktokaitool.com"),
        apiKey: String(payload.apiKey || "").trim() || current.apiKey || "",
        updatedAt: Date.now()
      };
      await kvSet(db, "official-settings", next);
      return json(await publicOfficialSettings(db, env));
    }
  }

  if (method === "POST" && pathname === "/api/private-tiktok/test") {
    try {
      const page = await signalDesk(env, db, "/api/integrations/local-factory/accounts?limit=1");
      return json({ connected: true, source: "official", accountCount: page.accounts?.length || 0 });
    } catch (error) {
      return errorJson(error.message || "官方通道连接失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/private-tiktok/accounts") {
    try {
      return json(await listAllAccounts(env, db, url.searchParams.get("refresh") === "1"));
    } catch (error) {
      return errorJson(error.message || "读取官方账号失败。", error.statusCode || 502);
    }
  }

  if (pathname.startsWith("/api/official-tiktok/projects") || pathname.startsWith("/api/official-tiktok/account-groups") || pathname.startsWith("/api/official-tiktok/groups/") || pathname === "/api/official-tiktok/ops-report" || pathname === "/api/official-tiktok/ops-report-history") {
    return handleAccountGroups(request, env, db, url, session);
  }

  if (method === "GET" && pathname === "/api/official-tiktok/publish-accounts") {
    try {
      const data = await signalDeskAllAccounts(env, db);
      const store = await loadGroupStore(db);
      const scoped = scopeOfficialAccess(data, store, session.user, url.searchParams.get("module") || "");
      return json({
        ...scoped,
        accounts: (scoped.accounts || []).filter((account) => !Array.isArray(account.scopes) || account.scopes.includes("video.publish")),
      });
    } catch (error) {
      return errorJson(error.message || "读取官方发布账号失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/official-analytics") {
    try {
      return json(await officialDashboard(env, db, url.searchParams, session.user));
    } catch (error) {
      return errorJson(error.message || "读取官方数据失败。", error.statusCode || 502);
    }
  }

  if (method === "POST" && pathname === "/api/official-analytics/sync") {
    try {
      const meta = await refreshOfficialArchive(env, db);
      return json({
        ok: true,
        ...meta,
        message: "已从主站补漏写入工厂缓存，不会删除已有账号。"
      });
    } catch (error) {
      return errorJson(error.message || "刷新官方归档缓存失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/official-analytics/video-detail") {
    const accountId = String(url.searchParams.get("account") || "").trim();
    const videoId = String(url.searchParams.get("video") || "").trim();
    if (!accountId || !videoId) return errorJson("缺少账号 ID 或视频 ID。", 400);
    try {
      const store = await loadGroupStore(db);
      const accounts = accountsFromLatestArchive(await listLatestArchiveAccounts(db));
      const allowed = scopedAnalyticsAccounts(accounts, store, session.user, url.searchParams.get("module") || "");
      if (!allowed.some((account) => account.schema === accountId)) return errorJson("无权查看该账号的视频数据。", 403);
      return json(await signalDesk(env, db, `/api/integrations/local-factory/videos/${encodeURIComponent(videoId)}?accountId=${encodeURIComponent(accountId)}`));
    } catch (error) {
      return errorJson(error.message || "读取 TikTok 视频详情失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/official-publish-records") {
    const range = url.searchParams.get("range") || "7d";
    const query = url.searchParams.get("query") || "";
    let connectionIds=[];
    if(query.trim()){
      const term=query.trim().replace(/^@/,'').toLowerCase();
      const directory=await publishAccountDirectory(env,{fresh:false}).catch(()=>({accounts:[]}));
      const archived=await listAccountDirectory(db).catch(()=>[]);
      connectionIds=[...new Set([...directory.accounts,...archived.map(r=>({id:String(r.account_key||'').replace(/^tiktok:/,''),username:r.label}))]
        .filter(a=>[a.username,a.displayName,a.profile?.username].some(v=>String(v||'').replace(/^@/,'').toLowerCase().includes(term)))
        .map(a=>String(a.connectionId||a.id)).filter(Boolean))];
    }
    const paged = await pagePublishRecords(db, {from:publishRecordsSince(range),query,connectionIds,page:url.searchParams.get('page'),pageSize:50});
    const stored=paged.records;
    const webhook = await readPublishWebhookState(db, env).catch(() => null);
    // With receipts flowing, hub batch hydration is only a fallback for the
    // handful of records that never got one; without receipts keep the old
    // per-request hydration.
    const hydrateLimit = webhook?.registered ? 2 : 8;
    let records = await hydrateOfficialPublishRecords(stored, (batchId) => (
      signalDesk(env, db, `/api/v1/publish/batches/${encodeURIComponent(batchId)}`)
    ), { skipResolved: true, limit: hydrateLimit }).catch(() => stored);
    if (records.some(record => !record.accountUsername && !record.username)) {
      // Historical upload failures have no remote batch to hydrate. A directory
      // failure must not hide their publishing records or change their state.
      const archived = await listAccountDirectory(db).catch(() => []);
      records = attachOfficialAccountNames(records, archived.map(row => ({
        accountKey: row.account_key, username: row.label?.startsWith('@') ? row.label.slice(1) : ''
      })));
      if (records.some(record => !record.accountUsername && !record.username)) {
        const directory = await signalDeskAllAccounts(env, db).catch(() => ({ accounts: [] }));
        records = attachOfficialAccountNames(records, directory.accounts);
      }
    }
    return json({ ...summarizeOfficialPublishRecords(records, { range: "all" }), pagination:paged.pagination, webhook });
  }

  if (method === "POST" && pathname === "/api/official-publish-records/sync") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以操作。", 403);
    try {
      const result = await ensurePublishWebhook(env, db, { force: url.searchParams.get("force") === "1", verify: true, requestUrl: request.url });
      return json({ ...result, message: result.changed ? "已向主站注册发布回执 webhook。" : "发布回执 webhook 已在线，主站会实时回写结果。" });
    } catch (error) {
      return errorJson(error.message || "注册发布回执失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/official-publish-records/webhook") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以查看。", 403);
    return json(await readPublishWebhookState(db, env));
  }

  return null;
}

export async function assertOfficialPublishAccess(env, user, payload = {}, options = {}) {
  const store = await loadGroupStore(env.DB);
  const data = await publishAccountDirectory(env, options);
  const scoped = scopeOfficialAccess(data, store, user, payload.module || "");
  const publishableAccounts = (scoped.accounts || []).filter((account) => !Array.isArray(account.scopes) || account.scopes.includes("video.publish"));
  const allowed = new Set(publishableAccounts.map((account) => account.connectionId || account.id).filter(Boolean));
  const requested = Array.from(new Set((Array.isArray(payload.connectionIds) ? payload.connectionIds : []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!requested.length) {
    const error = new Error("请先选择官方授权账号。");
    error.statusCode = 400;
    throw error;
  }
  const blocked = requested.filter((id) => !allowed.has(id));
  if (blocked.length) {
    const error = new Error("只能发布到已分配分组里的账号。");
    error.statusCode = 403;
    throw error;
  }
  return { ...scoped, accounts: publishableAccounts };
}

function isAdmin(session) {
  return session?.user?.role === "admin";
}

async function handleAccountGroups(request, env, db, url, session) {
  const method = request.method;
  const pathname = url.pathname;
  // Reads stay open to every signed-in user (operators need their scoped
  // groups); creating, renaming, deleting or reassigning is admin-only.
  if (method !== "GET" && !isAdmin(session)) return errorJson("仅管理员可以管理项目与分组。", 403);
  if (method === "GET" && pathname === "/api/official-tiktok/ops-report") {
    try {
      const start = performance.now();
      const { store, accountRows } = await loadReportContext(db);
      const timing = [`context;dur=${(performance.now() - start).toFixed(1)}`];
      const payload = await buildModuleReport(env, db, store, url.searchParams, session?.user, timing, accountRows);
      return json(payload, 200, { "Server-Timing": timing.join(", ") });
    } catch (error) {
      return errorJson(error.message || "读取报表失败。", error.statusCode || 400);
    }
  }
  const store = await loadGroupStore(db);

  try {
    if (method === "GET" && pathname === "/api/official-tiktok/account-groups") {
      return json(publicState(store));
    }
    if (method === "GET" && pathname === "/api/official-tiktok/projects") {
      return json(publicState(store));
    }
    if (method === "POST" && pathname === "/api/official-tiktok/projects") {
      const payload = await readJson(request);
      return json(await saveGroupStore(db, createProject(store, payload.name)), 201);
    }
    const projectMatch = pathname.match(/^\/api\/official-tiktok\/projects\/([^/]+)$/);
    if (method === "PATCH" && projectMatch) {
      return json(await saveGroupStore(db, updateProject(store, decodeURIComponent(projectMatch[1]), await readJson(request))));
    }
    if (method === "DELETE" && projectMatch) {
      return json(await saveGroupStore(db, deleteProject(store, decodeURIComponent(projectMatch[1]))));
    }
    if (method === "POST" && pathname === "/api/official-tiktok/account-groups") {
      const payload = await readJson(request);
      return json(await saveGroupStore(db, createGroup(store, payload.name, { projectId: payload.projectId })), 201);
    }
    if (method === "POST" && pathname === "/api/official-tiktok/account-groups/assign") {
      return json(await saveGroupStore(db, assignAccounts(store, await readJson(request))));
    }
    const groupMatch = pathname.match(/^\/api\/official-tiktok\/account-groups\/([^/]+)$/);
    if (method === "PATCH" && groupMatch) {
      return json(await saveGroupStore(db, updateGroup(store, decodeURIComponent(groupMatch[1]), await readJson(request))));
    }
    if (method === "DELETE" && groupMatch) {
      return json(await saveGroupStore(db, deleteGroup(store, decodeURIComponent(groupMatch[1]))));
    }
    const reportMatch = pathname.match(/^\/api\/official-tiktok\/groups\/([^/]+)\/report$/);
    if (method === "GET" && reportMatch) {
      return json(await buildGroupReport(env, db, store, decodeURIComponent(reportMatch[1]), url.searchParams.get("period") || "today"));
    }
    if (method === "GET" && pathname === "/api/official-tiktok/ops-report-history") {
      return json(await listModuleReportHistory(db, store, url.searchParams, session?.user));
    }
  } catch (error) {
    return errorJson(error.message || "分组操作失败。", error.statusCode || 400);
  }
  return null;
}

export function scopedAnalyticsAccounts(accounts, store, user, moduleKey = "") {
  const project = moduleKey ? findProjectForModule(store, moduleKey) : null;
  const allowedIds = userAllowedGroupIds(user);
  const scoped = moduleKey
    ? accounts.filter((account) => project && accountMatchesProject(account, store, project.id))
    : accounts;
  return (attachAccounts({ accounts: scoped }, store).accounts || [])
    .filter((account) => !allowedIds || allowedIds.has(account.groupId));
}

async function officialDashboard(env, db, searchParams, user) {
  const search = String(searchParams.get("search") || "").trim().toLowerCase();
  const accountFilter = String(searchParams.get("account") || "").trim();
  const moduleKey = String(searchParams.get("module") || "").trim();
  const accountRows = await listLatestArchiveAccounts(db);
  const accounts = accountsFromLatestArchive(accountRows);
  const store = await loadGroupStore(db);
  const project = moduleKey ? findProjectForModule(store, moduleKey) : null;
  const attached = scopedAnalyticsAccounts(accounts, store, user, moduleKey);
  if (accountFilter && !attached.some((account) => account.schema === accountFilter)) {
    throw Object.assign(new Error("无权查看该账号的视频数据。"), { statusCode: 403 });
  }
  const rows = attached.map(archiveAccountRow).filter((item) => {
    if (search && !`${item.label} ${item.schema} ${item.groupName}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const selectedAccount = accountFilter || rows[0]?.schema || "";
  const selectedVideos = selectedAccount
    ? (await loadVideosForAccounts(env, db, [selectedAccount], 20)).get(selectedAccount) || []
    : [];
  const videos = selectedVideos.map((video) => ({
    ...video,
    id: String(video.id || video.videoId || ""),
    account: selectedAccount,
    views: Number(video.views || video.playCount || 0),
    likes: Number(video.likes || video.diggCount || 0),
    comments: Number(video.comments || video.commentCount || 0),
    shares: Number(video.shares || video.shareCount || 0),
    reach: Number(video.reach || 0)
  }));
  const overview = rows.reduce((sum, item) => ({
    accounts: sum.accounts + 1,
    videos: sum.videos + item.videoCount,
    followers: sum.followers + item.followers,
    views: sum.views + item.views,
    likes: sum.likes + item.likes,
    comments: sum.comments + item.comments,
    shares: sum.shares + item.shares,
    reach: sum.reach + item.reach
  }), { accounts: 0, videos: 0, followers: 0, views: 0, likes: 0, comments: 0, shares: 0, reach: 0 });
  const latestDate = rows.map((item) => item.snapshotDate).filter(Boolean).sort().at(-1) || "";
  return {
    connected: true,
    archiveDir: "signal-desk",
    databasePath: "tiktokaitool.com",
    state: { running: false, lastRunDate: latestDate },
    dateKeys: latestDate ? [latestDate] : [],
    latestDate,
    overview,
    accounts: rows,
    selectedAccount,
    accountHistory: [],
    videos,
    selectedVideo: String(searchParams.get("video") || videos[0]?.id || ""),
    videoHistory: [],
    module: moduleKey || "",
    project: project ? publicState(store).projects.find((item) => item.id === project.id) || project : null
  };
}

function archiveAccountRow(account) {
  const profile = account.profile || {};
  return {
    schema: account.schema,
    label: account.label || (profile.username ? `@${profile.username}` : account.schema),
    profileImage: profile.profileImage || profile.avatarUrl || "",
    followers: Number(profile.followers || profile.followerCount || 0),
    following: Number(profile.following || 0),
    totalLikes: Number(profile.hearts || profile.likes || 0),
    videoCount: Number(account.videoCount || account.video_count || 0),
    views: Number(account.views || 0),
    likes: Number(account.likes || 0),
    comments: Number(account.comments || 0),
    shares: Number(account.shares || 0),
    reach: Number(account.reach || 0),
    syncedAt: Number(account.latestSyncAt || account.archiveFetchedAt || 0),
    snapshotDate: account.snapshotDate || "",
    profileUrl: profile.profileUrl || "",
    insights: profile.insights || {},
    groupId: account.groupId || "",
    groupName: account.groupName || "",
    projectId: account.projectId || "",
    projectName: account.projectName || ""
  };
}

export async function listAllAccounts(env, db, refresh = false) {
  if (refresh) {
    await refreshOfficialArchive(env, db);
  }
  const store = await loadGroupStore(db);
  const archivedAccounts = directoryAccountsFromRows(await listAccountDirectory(db));
  let liveAccounts = [];
  let liveError = null;
  // The analytics archive can legitimately lag behind newly authorized
  // accounts. Always merge the current Signal Desk directory so a normal page
  // reload does not shrink the account list that a manual refresh just showed.
  try {
    let cursor = "";
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({limit:"100", cursor});
      const data = await signalDesk(env, db, `/api/integrations/local-factory/accounts?${params}`);
      if (!Array.isArray(data.accounts)) throw Object.assign(new Error("账号目录响应无效。"), {statusCode:502});
      liveAccounts.push(...data.accounts);
      if (!data.hasMore) break;
      if (!data.nextCursor || data.nextCursor <= cursor || page === 99) throw Object.assign(new Error("账号目录分页未完成。"), {statusCode:502});
      cursor = data.nextCursor;
    }
  } catch (error) {
    liveError = error;
    console.warn("official-directory-fallback", JSON.stringify({status:Number(error.statusCode)||502,received:liveAccounts.length,archived:archivedAccounts.length}));
  }
  if (liveError && !archivedAccounts.length) throw liveError;
  const accounts = mergeOfficialAccountDirectory(archivedAccounts, liveAccounts);
  return attachAccounts({
    connected: true,
    source: liveError ? (liveAccounts.length ? "archive+partial-live" : "archive-fallback") : (refresh ? "archive-refresh+live" : "archive+live"),
    directoryComplete: !liveError,
    directoryWarning: liveError ? "实时授权目录读取失败，当前仅显示已有归档或部分结果，数量不代表中台授权总数。请稍后刷新。" : "",
    accounts
  }, store);
}

export function mergeOfficialAccountDirectory(archivedAccounts = [], liveAccounts = []) {
  const merged = [];
  const known = new Set();
  for (const account of [...archivedAccounts, ...liveAccounts]) {
    const keys = officialDirectoryKeys(account);
    if (keys.some((key) => known.has(key))) continue;
    merged.push(account);
    keys.forEach((key) => known.add(key));
  }
  return merged;
}

function officialDirectoryKeys(account = {}) {
  return Array.from(new Set([
    account.schema,
    account.accountKey,
    account.connectionId,
    account.id,
    account.username,
    account.profile?.username
  ].map((value) => String(value || "").trim().replace(/^@/, "")).filter(Boolean).flatMap((value) => (
    value.toLowerCase().startsWith("tiktok:") ? [value, value.slice(7)] : [value, `tiktok:${value}`]
  ))));
}

async function publicOfficialSettings(db, env) {
  const settings = await kvGet(db, "official-settings", {});
  const envKey = String(env.SIGNAL_DESK_BRIDGE_KEY || "").trim();
  return {
    configured: Boolean((settings.baseUrl || env.SIGNAL_DESK_BASE_URL) && (settings.apiKey || envKey)),
    baseUrl: settings.baseUrl || env.SIGNAL_DESK_BASE_URL || "https://tiktokaitool.com",
    hasApiKey: Boolean(settings.apiKey || envKey),
    // Which key signalDesk() actually sends: the page-entered one wins, the
    // Worker secret SIGNAL_DESK_BRIDGE_KEY is the fallback (what production uses).
    apiKeySource: settings.apiKey ? "settings" : (envKey ? "env" : "none"),
    updatedAt: Number(settings.updatedAt || 0),
    source: "official"
  };
}

export async function loadGroupStore(db) {
  const store = ensureModuleProjects(await kvGet(db, "official-account-groups", {}));
  const assignments = await loadAccountAssignments(db);
  if (Object.keys(assignments).length) store.assignments = assignments;
  else if (store.assignments && Object.keys(store.assignments).length) {
    await saveAccountAssignments(db, store.assignments);
  }
  const { results } = await db.prepare(`
    SELECT account_key, label
    FROM official_accounts_latest
    LIMIT ?
  `).bind(LATEST_ACCOUNTS_LIMIT).all();
  return rememberAccountAliases(store, accountsFromArchiveRows(results || []));
}

async function saveGroupStore(db, store) {
  const next = normalizeStore(store);
  await saveAccountAssignments(db, next.assignments);
  await kvSet(db, "official-account-groups", { ...next, assignments: {} });
  return publicState({ ...next, assignments: next.assignments });
}

export async function buildModuleReport(env, db, store, searchParams, user, timing = [], knownAccountRows = null) {
  const startedAt = performance.now();
  const view = searchParams.get("view") || "full";
  const moduleKey = String(searchParams.get("module") || "").trim();
  let groupId = String(searchParams.get("group") || "").trim();
  const dateKey = String(searchParams.get("date") || "").trim();
  const fromKey = parseShanghaiDate(searchParams.get("from")) || parseShanghaiDate(dateKey);
  const toKey = parseShanghaiDate(searchParams.get("to")) || fromKey;
  const now = Date.now();
  const selected = resolveReportWindow({
    period: searchParams.get("period") || "today",
    now,
    fromKey,
    toKey,
  });
  const period = selected.period;
  const queryFrom = selected.fromKey;
  const queryTo = selected.toKey;
  const context = reportContext(store, moduleKey, user);
  const { liveProject, groups, allowedIds, canSeeProjectTotal } = context;
  if (!liveProject.reportEnabled) {
    return {
      module: liveProject.moduleKey,
      project: liveProject,
      groups,
      canSeeProjectTotal,
      scopes: reportScopes(groups, canSeeProjectTotal),
      report: { enabled: false, period, project: liveProject },
    };
  }
  if (groupId && !groups.some((item) => item.id === groupId)) {
    const error = new Error(allowedIds && !allowedIds.has(groupId) ? "没有这个分组的权限。" : "没有找到这个分组。");
    error.statusCode = allowedIds && !allowedIds.has(groupId) ? 403 : 404;
    throw error;
  }
  if (!groupId && !canSeeProjectTotal) {
    groupId = groups[0]?.id || "";
  }
  const accountRows = knownAccountRows || await listLatestArchiveAccounts(db);
  const scope = {
    groupId,
    projectId: liveProject.id,
    groupIds: !groupId && allowedIds ? Array.from(allowedIds) : null,
  };
  const keys = archiveAccountKeysForScope(store, accountRows, scope);
  const wanted = new Set(keys);
  const scopedRows = accountRows.filter(row => wanted.has(row.account_key));
  timing.push(`scope;dur=${(performance.now() - startedAt).toFixed(1)}`);
  const base = {
    module: liveProject.moduleKey, project: liveProject, groups, canSeeProjectTotal,
    scopes: reportScopes(groups, canSeeProjectTotal), dates: [],
  };
  // Publish receipts only need authorized account IDs. Never read video packs here.
  const publish = async () => {
    const start = performance.now();
    const stats = await loadScopedPublishStats(env, db, {
      store, ...scope, bundle: { accountRows: scopedRows }, fromKey: queryFrom, toKey: queryTo,
    });
    timing.push(`publish;dur=${(performance.now() - start).toFixed(1)}`);
    return stats;
  };
  if (view === "publish") {
    const stats = await publish();
    return { ...base, publishStatus: stats.unavailable ? "unavailable" : "ready",
      report: { enabled: true, groupId, period, fromKey: queryFrom, toKey: queryTo,
        summary: attachPublishOutcome({}, stats).summary } };
  }
  // Full API callers retain the existing response; the UI can load the two parts independently.
  const publishPromise = view === "analytics" ? null : publish();
  const isLive = ["today", "yesterday", "7d", "30d", "week"].includes(period) || queryFrom !== queryTo;
  let report, source, persistedAt;
  if (isLive) {
    const start = performance.now();
    const bundle = await loadArchiveBundle(env, db, keys, accountRows, selected, timing);
    timing.push(`archive;dur=${(performance.now() - start).toFixed(1)}`);
    const computeStart = performance.now();
    report = computeLiveReport({ store, project: liveProject, ...scope, period, now,
      fromKey: queryFrom, toKey: queryTo, bundle });
    timing.push(`compute;dur=${(performance.now() - computeStart).toFixed(1)}`);
    source = "live";
  } else {
    const snapshot = await readOpsSnapshot(db, {
      moduleKey: liveProject.moduleKey, projectId: liveProject.id, groupId,
      period: "today", dateKey: queryFrom,
    });
    report = snapshot?.report || emptySnapshotReport(liveProject, period, queryFrom, groupId, groups, queryTo);
    source = snapshot ? "snapshot" : "missing";
    persistedAt = snapshot?.updated_at || 0;
  }
  if (publishPromise) report = attachPublishOutcome(report, await publishPromise);
  else report = { ...report, summary: { ...report.summary,
    publishTotal: null, publishSuccess: null, publishFailed: null, riskAccountCount: null } };
  return { ...base, source, ...(persistedAt === undefined ? {} : { persistedAt }), report,
    ...(view === "analytics" ? { publishStatus: "pending" } : {}) };
}

async function listModuleReportHistory(db, store, searchParams, user) {
  const moduleKey = String(searchParams.get("module") || "").trim();
  const period = searchParams.get("period") === "week" ? "week" : "today";
  let groupId = String(searchParams.get("group") || "").trim();
  const { liveProject, groups, allowedIds, canSeeProjectTotal } = reportContext(store, moduleKey, user);
  if (groupId && !groups.some((item) => item.id === groupId)) {
    const error = new Error(allowedIds && !allowedIds.has(groupId) ? "没有这个分组的权限。" : "没有找到这个分组。");
    error.statusCode = allowedIds && !allowedIds.has(groupId) ? 403 : 404;
    throw error;
  }
  if (!groupId && !canSeeProjectTotal) {
    groupId = groups[0]?.id || "";
  }
  return {
    module: liveProject.moduleKey,
    project: liveProject,
    groups,
    canSeeProjectTotal,
    scopes: reportScopes(groups, canSeeProjectTotal),
    period,
    groupId,
    dates: await listOpsDates(db, {
      moduleKey: liveProject.moduleKey,
      projectId: liveProject.id,
      groupId,
      period,
    }),
  };
}

function reportContext(store, moduleKey, user) {
  const project = findProjectForModule(store, moduleKey);
  if (!project) {
    const error = new Error("这个模块还没有对应项目。");
    error.statusCode = 404;
    throw error;
  }
  const state = publicState(store);
  const liveProject = state.projects.find((item) => item.id === project.id) || project;
  const allowedIds = userAllowedGroupIds(user);
  const projectGroups = state.groups.filter((item) => item.projectId === liveProject.id);
  const groups = projectGroups.filter((item) => !allowedIds || allowedIds.has(item.id));
  const canSeeProjectTotal = !allowedIds || (projectGroups.length > 0 && projectGroups.every((item) => allowedIds.has(item.id)));
  return { liveProject, groups, projectGroups, allowedIds, canSeeProjectTotal };
}

function reportScopes(groups, canSeeProjectTotal) {
  return [
    ...(canSeeProjectTotal ? [{ id: "", name: "全部项目" }] : []),
    ...groups.map((item) => ({ id: item.id, name: item.name })),
  ];
}

function emptySnapshotReport(project, period, dateKey, groupId, groups, toKey = "") {
  const group = groups.find((item) => item.id === groupId);
  return {
    enabled: true,
    missing: true,
    period,
    dateKey,
    fromKey: dateKey,
    toKey: toKey || dateKey,
    moduleKey: project.moduleKey,
    projectId: project.id,
    projectName: project.name || "",
    groupId,
    groupName: group?.name || (groupId ? groupId : "全部项目"),
    thresholds: { lowView: 200, highView: 1000 },
    summary: {
      published: 0,
      zeroView: 0,
      lowView: 0,
      midView: 0,
      highView: 0,
      views: 0,
      avgView: 0,
      accountCount: 0,
      anomalyAccountCount: 0,
      publishTotal: 0,
      publishSuccess: 0,
      publishFailed: 0,
      riskAccountCount: 0,
    },
    buckets: { zeroView: [], lowView: [], midView: [], highView: [] },
    anomalyAccounts: [],
  };
}

async function buildGroupReport(env, db, store, groupId, period) {
  const state = publicState(store);
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    const error = new Error("没有找到这个分组。");
    error.statusCode = 404;
    throw error;
  }
  const project = state.projects.find((item) => item.id === group.projectId) || null;
  if (!project?.reportEnabled) {
    return { enabled: false, group, project, period };
  }
  const accountRows = await listLatestArchiveAccounts(db);
  const bundle = await loadArchiveBundle(env, db, archiveAccountKeysForScope(store, accountRows, { groupId }));
  return computeLiveReport({
    store,
    project,
    groupId,
    period,
    bundle,
  });
}

async function loadScopedPublishStats(env, db, { store, projectId, groupId, groupIds, bundle, fromKey, toKey }) {
  const start = Date.parse(`${fromKey}T00:00:00+08:00`);
  const end = Date.parse(`${toKey}T00:00:00+08:00`) + 86_400_000;
  const connectionIds = [...new Set([
    ...connectionIdsFromArchiveRows(bundle?.accountRows),
    ...connectionIdsForProjectScope(store, { projectId, groupId, groupIds }),
  ])];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !connectionIds.length) {
    return { total: 0, success: 0, failed: 0, riskAccounts: 0 };
  }
  try {
    const chunks = chunkList(connectionIds, 80);
    const parts = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        const params = new URLSearchParams({ from: String(start), to: String(end), connectionIds: chunk.join(",") });
        parts.push(await signalDesk(env, db, `/api/v1/publish/stats?${params}`));
      }
    }));
    return mergePublishStats(parts);
  } catch (error) {
    console.warn(JSON.stringify({ event: "publish-stats-unavailable", error: String(error?.message || error) }));
    return { total: 0, success: 0, failed: 0, riskAccounts: 0, unavailable: true };
  }
}

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}
