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
  userAllowedGroupIds,
} from "../../scripts/official-account-group-store.js";
import { parseShanghaiDate, shanghaiDateKey, weekStartKey } from "../../scripts/official-group-report.js";
import { summarizeOfficialPublishRecords } from "../../scripts/official-publish-records.js";
import { errorJson, json, readJson } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import { refreshOfficialArchive } from "./official-archive-store.js";
import {
  computeLiveReport,
  listOpsDates,
  loadArchiveBundle,
  persistProjectOpsSnapshots,
  readOpsSnapshot,
} from "./ops-report-store.js";
import { signalDesk } from "./signal-desk.js";

export async function handleOfficial(request, env, url, session) {
  if (!session) return null;
  const method = request.method;
  const pathname = url.pathname;
  const db = env.DB;

  if (pathname === "/api/private-tiktok/settings") {
    if (method === "GET") return json(await publicOfficialSettings(db, env));
    if (method === "POST") {
      const payload = await readJson(request);
      const current = await kvGet(db, "official-settings", {});
      const next = {
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
      return json(await listAllAccounts(env, db));
    } catch (error) {
      return errorJson(error.message || "读取官方账号失败。", error.statusCode || 502);
    }
  }

  if (pathname.startsWith("/api/official-tiktok/projects") || pathname.startsWith("/api/official-tiktok/account-groups") || pathname.startsWith("/api/official-tiktok/groups/") || pathname === "/api/official-tiktok/ops-report" || pathname === "/api/official-tiktok/ops-report-history") {
    return handleAccountGroups(request, db, url, session);
  }

  if (method === "GET" && pathname === "/api/official-tiktok/publish-accounts") {
    try {
      const data = await signalDesk(env, db, "/api/v1/accounts");
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
        message: "已从主站归档写入工厂缓存。"
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
      return json(await signalDesk(env, db, `/api/integrations/local-factory/videos/${encodeURIComponent(videoId)}?accountId=${encodeURIComponent(accountId)}`));
    } catch (error) {
      return errorJson(error.message || "读取 TikTok 视频详情失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/official-publish-records") {
    return json(summarizeOfficialPublishRecords(await kvGet(db, "official-publish-records", []), {
      range: url.searchParams.get("range") || "7d",
      query: url.searchParams.get("query") || ""
    }));
  }

  if (method === "POST" && pathname === "/api/official-publish-records/sync") {
    return json({ ok: true, message: "发布结果由主站回写，工厂云已保存本地副本。" });
  }

  return null;
}

export async function assertOfficialPublishAccess(env, user, payload = {}) {
  const store = await loadGroupStore(env.DB);
  const data = await signalDesk(env, env.DB, "/api/v1/accounts");
  const scoped = scopeOfficialAccess(data, store, user, payload.module || "");
  const allowed = new Set((scoped.accounts || []).map((account) => account.connectionId || account.id).filter(Boolean));
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
  return scoped;
}

async function handleAccountGroups(request, db, url, session) {
  const method = request.method;
  const pathname = url.pathname;
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
      return json(await buildGroupReport(db, store, decodeURIComponent(reportMatch[1]), url.searchParams.get("period") || "today"));
    }
    if (method === "GET" && pathname === "/api/official-tiktok/ops-report") {
      return json(await buildModuleReport(db, store, url.searchParams, session?.user));
    }
    if (method === "GET" && pathname === "/api/official-tiktok/ops-report-history") {
      return json(await listModuleReportHistory(db, store, url.searchParams, session?.user));
    }
  } catch (error) {
    return errorJson(error.message || "分组操作失败。", error.statusCode || 400);
  }
  return null;
}

async function officialDashboard(env, db, searchParams, user) {
  const search = String(searchParams.get("search") || "").trim().toLowerCase();
  const accountFilter = String(searchParams.get("account") || "").trim();
  const moduleKey = String(searchParams.get("module") || "").trim();
  const accounts = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "20", videosPerAccount: "20" });
    if (cursor) params.set("cursor", cursor);
    const data = await signalDesk(env, db, `/api/integrations/local-factory/archive?${params}`);
    accounts.push(...(data.accounts || []));
    if (!data.hasMore || !data.nextCursor || data.nextCursor === cursor) break;
    cursor = data.nextCursor;
  }
  const store = await loadGroupStore(db);
  const project = moduleKey ? findProjectForModule(store, moduleKey) : null;
  const scoped = moduleKey
    ? accounts.filter((account) => project && accountMatchesProject(account, store, project.id))
    : accounts;
  const allowedIds = userAllowedGroupIds(user);
  const attached = attachAccounts({ accounts: scoped }, store).accounts || [];
  const rows = attached.map(archiveAccountRow).filter((item) => {
    if (allowedIds && !allowedIds.has(item.groupId)) return false;
    if (search && !`${item.label} ${item.schema} ${item.groupName}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const selectedAccount = accountFilter || rows[0]?.schema || "";
  const selected = scoped.find((item) => item.schema === selectedAccount) || scoped[0];
  const videos = (selected?.videos || []).map((video) => ({
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
  const videos = Array.isArray(account.videos) ? account.videos : [];
  return {
    schema: account.schema,
    label: account.label || (profile.username ? `@${profile.username}` : account.schema),
    profileImage: profile.profileImage || profile.avatarUrl || "",
    followers: Number(profile.followers || profile.followerCount || 0),
    following: Number(profile.following || 0),
    totalLikes: Number(profile.hearts || profile.likes || 0),
    videoCount: videos.length || Number(account.syncedVideoCount || 0),
    views: videos.reduce((sum, item) => sum + Number(item.views || item.playCount || 0), 0),
    likes: videos.reduce((sum, item) => sum + Number(item.likes || item.diggCount || 0), 0),
    comments: videos.reduce((sum, item) => sum + Number(item.comments || item.commentCount || 0), 0),
    shares: videos.reduce((sum, item) => sum + Number(item.shares || item.shareCount || 0), 0),
    reach: videos.reduce((sum, item) => sum + Number(item.reach || 0), 0),
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

async function listAllAccounts(env, db) {
  const accounts = [];
  let cursor = "";
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const data = await signalDesk(env, db, `/api/integrations/local-factory/accounts?${params}`);
    accounts.push(...(data.accounts || []));
    if (!data.hasMore || !data.nextCursor || data.nextCursor === cursor) break;
    cursor = data.nextCursor;
  }
  return attachAccounts({ connected: true, accounts }, await loadGroupStore(db));
}

async function publicOfficialSettings(db, env) {
  const settings = await kvGet(db, "official-settings", {});
  const envKey = String(env.SIGNAL_DESK_BRIDGE_KEY || "").trim();
  return {
    configured: Boolean((settings.baseUrl || env.SIGNAL_DESK_BASE_URL) && (settings.apiKey || envKey)),
    baseUrl: settings.baseUrl || env.SIGNAL_DESK_BASE_URL || "https://tiktokaitool.com",
    hasApiKey: Boolean(settings.apiKey || envKey),
    updatedAt: Number(settings.updatedAt || 0),
    source: "official"
  };
}

export async function loadGroupStore(db) {
  const store = ensureModuleProjects(await kvGet(db, "official-account-groups", {}));
  const { results } = await db.prepare("SELECT account_key, label, profile_json FROM official_accounts_latest").all();
  return rememberAccountAliases(store, accountsFromArchiveRows(results || []));
}

async function saveGroupStore(db, store) {
  const next = normalizeStore(store);
  await kvSet(db, "official-account-groups", next);
  return publicState(next);
}

async function buildModuleReport(db, store, searchParams, user) {
  const moduleKey = String(searchParams.get("module") || "").trim();
  let period = searchParams.get("period") === "week" ? "week" : searchParams.get("period") === "range" ? "range" : "today";
  let groupId = String(searchParams.get("group") || "").trim();
  const dateKey = String(searchParams.get("date") || "").trim();
  const fromKey = parseShanghaiDate(searchParams.get("from")) || parseShanghaiDate(dateKey);
  const toKey = parseShanghaiDate(searchParams.get("to")) || fromKey;
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
  const now = Date.now();
  const todayKey = shanghaiDateKey(now);
  const currentFrom = period === "week" ? weekStartKey(now) : todayKey;
  const currentTo = todayKey;
  const queryFrom = fromKey || currentFrom;
  const queryTo = toKey || currentTo;
  if (period !== "week" && queryFrom !== queryTo) period = "range";
  const bundle = await loadArchiveBundle(db);
  try {
    await persistProjectOpsSnapshots(db, store, liveProject, now, bundle);
  } catch (error) {
    console.error(JSON.stringify({ event: "ops-report-persist-failed", module: liveProject.moduleKey, error: String(error?.message || error) }));
  }
  const livePayload = () => ({
    module: liveProject.moduleKey,
    project: liveProject,
    groups,
    canSeeProjectTotal,
    scopes: reportScopes(groups, canSeeProjectTotal),
    source: "live",
    dates: [],
    report: computeLiveReport({
      store,
      project: liveProject,
      groupId,
      period: period === "week" ? "week" : "today",
      now,
      fromKey: queryFrom,
      toKey: queryTo,
      bundle,
      groupIds: !groupId && allowedIds ? Array.from(allowedIds) : null,
    }),
  });
  const isCurrentWindow = queryFrom === currentFrom && queryTo === currentTo && (period === "week" || period === "today" || queryFrom === queryTo);
  if (isCurrentWindow || queryFrom !== queryTo) {
    return livePayload();
  }
  const snapshot = await readOpsSnapshot(db, {
    moduleKey: liveProject.moduleKey,
    projectId: liveProject.id,
    groupId,
    period: "today",
    dateKey: queryFrom,
  });
  return {
    module: liveProject.moduleKey,
    project: liveProject,
    groups,
    canSeeProjectTotal,
    scopes: reportScopes(groups, canSeeProjectTotal),
    source: snapshot ? "snapshot" : "missing",
    persistedAt: snapshot?.updated_at || 0,
    dates: [],
    report: snapshot?.report || emptySnapshotReport(liveProject, period, queryFrom, groupId, groups, queryTo),
  };
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
    },
    buckets: { zeroView: [], lowView: [], highView: [] },
    anomalyAccounts: [],
  };
}

async function buildGroupReport(db, store, groupId, period) {
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
  const bundle = await loadArchiveBundle(db);
  return computeLiveReport({
    store,
    project,
    groupId,
    period,
    bundle,
  });
}

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}
