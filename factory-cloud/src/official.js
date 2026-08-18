import { errorJson, json, readJson } from "./http.js";
import { kvGet, kvSet } from "./kv.js";
import { refreshOfficialArchive } from "./official-archive-store.js";
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

  if (pathname.startsWith("/api/official-tiktok/account-groups")) {
    return handleAccountGroups(request, db, url);
  }

  if (method === "GET" && pathname === "/api/official-tiktok/publish-accounts") {
    try {
      const data = await signalDesk(env, db, "/api/v1/accounts");
      const groups = await kvGet(db, "official-account-groups", { groups: [], assignments: {} });
      const accounts = (data.accounts || []).map((account) => attachGroup(account, groups));
      return json({
        ...data,
        accounts,
        groups: groups.groups || [],
        ungroupedCount: accounts.filter((item) => !item.groupId).length
      });
    } catch (error) {
      return errorJson(error.message || "读取官方发布账号失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && pathname === "/api/official-analytics") {
    try {
      return json(await officialDashboard(env, db, url.searchParams));
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
    const records = await kvGet(db, "official-publish-records", []);
    const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
    const filtered = (Array.isArray(records) ? records : []).filter((item) => {
      if (!query) return true;
      return JSON.stringify(item).toLowerCase().includes(query);
    });
    return json({
      records: filtered,
      summary: { recordCount: filtered.length, taskCount: filtered.length, accountCount: new Set(filtered.map((item) => item.account || item.connectionId).filter(Boolean)).size }
    });
  }

  if (method === "POST" && pathname === "/api/official-publish-records/sync") {
    return json({ ok: true, message: "发布结果由主站回写，工厂云已保存本地副本。" });
  }

  return null;
}

async function handleAccountGroups(request, db, url) {
  const method = request.method;
  const pathname = url.pathname;
  const store = await kvGet(db, "official-account-groups", { groups: [], assignments: {} });

  if (method === "GET" && pathname === "/api/official-tiktok/account-groups") {
    return json(store);
  }
  if (method === "POST" && pathname === "/api/official-tiktok/account-groups") {
    const payload = await readJson(request);
    const name = String(payload.name || "").trim().slice(0, 60);
    if (!name) return errorJson("请填写分组名称。", 400);
    store.groups.push({ id: `group-${Date.now()}`, name });
    await kvSet(db, "official-account-groups", store);
    return json(store);
  }
  if (method === "POST" && pathname === "/api/official-tiktok/account-groups/assign") {
    const payload = await readJson(request);
    const groupId = String(payload.groupId || "");
    for (const account of payload.accounts || []) {
      const key = String(account.connectionId || account.id || account.schema || "").trim();
      if (!key) continue;
      if (groupId) store.assignments[key] = groupId;
      else delete store.assignments[key];
    }
    await kvSet(db, "official-account-groups", store);
    return json(store);
  }
  const match = pathname.match(/^\/api\/official-tiktok\/account-groups\/([^/]+)$/);
  if (method === "DELETE" && match) {
    const id = decodeURIComponent(match[1]);
    store.groups = (store.groups || []).filter((item) => item.id !== id);
    for (const [key, value] of Object.entries(store.assignments || {})) {
      if (value === id) delete store.assignments[key];
    }
    await kvSet(db, "official-account-groups", store);
    return json(store);
  }
  return null;
}

async function officialDashboard(env, db, searchParams) {
  const search = String(searchParams.get("search") || "").trim().toLowerCase();
  const accountFilter = String(searchParams.get("account") || "").trim();
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
  const rows = accounts.map(archiveAccountRow).filter((item) => {
    if (search && !`${item.label} ${item.schema}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const selectedAccount = accountFilter || rows[0]?.schema || "";
  const selected = accounts.find((item) => item.schema === selectedAccount) || accounts[0];
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
    videoHistory: []
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
    insights: profile.insights || {}
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
  return { connected: true, accounts };
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

function attachGroup(account, store) {
  const keys = [account.connectionId, account.id, account.schema, account.username].map((item) => String(item || "").trim()).filter(Boolean);
  const groupId = keys.map((key) => store.assignments?.[key]).find(Boolean) || "";
  const group = (store.groups || []).find((item) => item.id === groupId);
  return { ...account, groupId, groupName: group?.name || "" };
}

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}
