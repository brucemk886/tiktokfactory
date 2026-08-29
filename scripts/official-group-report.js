import { accountMatchesGroup, accountMatchesProject, officialAccountKeys } from "./official-account-group-store.js";

export const LOW_VIEW = 200;
export const HIGH_VIEW = 1000;

export function shanghaiDateKey(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export function weekStartKey(timestamp = Date.now()) {
  return shanghaiDateKey(periodWindow("week", timestamp).startAt);
}

export function snapshotDateKey(period = "today", timestamp = Date.now()) {
  return periodWindow(period, timestamp).dateKey;
}

export function parseShanghaiDate(value) {
  const key = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  return Number.isFinite(Date.parse(`${key}T00:00:00+08:00`)) ? key : "";
}

export function rangeWindow(fromKey, toKey) {
  const start = parseShanghaiDate(fromKey);
  const end = parseShanghaiDate(toKey);
  if (!start || !end) {
    const error = new Error("请选择有效的开始和结束日期。");
    error.statusCode = 400;
    throw error;
  }
  const startAt = Date.parse(`${start}T00:00:00+08:00`);
  const endAt = Date.parse(`${end}T00:00:00+08:00`) + 86_400_000;
  if (endAt <= startAt) {
    const error = new Error("结束日期不能早于开始日期。");
    error.statusCode = 400;
    throw error;
  }
  if ((endAt - startAt) / 86_400_000 > 90) {
    const error = new Error("时间范围不能超过 90 天。");
    error.statusCode = 400;
    throw error;
  }
  return {
    startAt,
    endAt,
    dateKey: start === end ? start : `${start}~${end}`,
    fromKey: start,
    toKey: end,
    period: start === end ? "today" : "range",
  };
}

export function periodWindow(period = "today", now = Date.now()) {
  const dateKey = shanghaiDateKey(now);
  const dayStart = Date.parse(`${dateKey}T00:00:00+08:00`);
  if (period === "week") {
    const weekday = new Date(now).toLocaleDateString("en-US", { timeZone: "Asia/Shanghai", weekday: "short" });
    const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
    const startAt = dayStart - offset * 86_400_000;
    return {
      startAt,
      endAt: dayStart + 86_400_000,
      dateKey: shanghaiDateKey(startAt),
      fromKey: shanghaiDateKey(startAt),
      toKey: dateKey,
      period: "week",
    };
  }
  return { startAt: dayStart, endAt: dayStart + 86_400_000, dateKey, fromKey: dateKey, toKey: dateKey, period: "today" };
}

export function resolveReportWindow({ period = "today", now = Date.now(), fromKey = "", toKey = "" } = {}) {
  if (parseShanghaiDate(fromKey) && parseShanghaiDate(toKey)) {
    const window = rangeWindow(fromKey, toKey);
    if (period === "week" && window.fromKey !== window.toKey) return { ...window, period: "week" };
    return window;
  }
  return periodWindow(period, now);
}

export function computeGroupReport({
  group,
  project,
  videos = [],
  accounts = [],
  period = "today",
  now = Date.now(),
  fromKey = "",
  toKey = "",
  lowView = LOW_VIEW,
  highView = HIGH_VIEW,
} = {}) {
  const window = resolveReportWindow({ period, now, fromKey, toKey });
  const inWindow = videos.filter((video) => {
    const createdAt = toMillis(video.createdAt || video.createTime);
    return createdAt >= window.startAt && createdAt < window.endAt;
  }).map((video) => normalizeVideo(video));

  const zeroView = inWindow.filter((video) => video.views === 0);
  const lowViewVideos = inWindow.filter((video) => video.views > 0 && video.views < lowView);
  const highViewVideos = inWindow.filter((video) => video.views >= highView);
  const midViewVideos = inWindow.filter((video) => video.views >= lowView && video.views < highView);

  const accountStats = new Map();
  for (const account of accounts) {
    const keys = officialAccountKeys(account);
    const username = account.profile?.username || account.username || account.label || keys[0] || "";
    accountStats.set(keys[0] || username, {
      username,
      label: account.profile?.displayName || account.label || username,
      published: 0,
      zero: 0,
      low: 0,
      high: 0,
      views: 0,
    });
  }
  for (const video of inWindow) {
    const key = officialAccountKeys({
      schema: video.account,
      username: video.username,
      accountKey: video.accountKey,
    })[0] || video.username || video.account;
    if (!accountStats.has(key)) {
      accountStats.set(key, {
        username: video.username || key,
        label: video.username || key,
        published: 0,
        zero: 0,
        low: 0,
        high: 0,
        views: 0,
      });
    }
    const row = accountStats.get(key);
    row.published += 1;
    row.views += video.views;
    if (video.views === 0) row.zero += 1;
    else if (video.views < lowView) row.low += 1;
    if (video.views >= highView) row.high += 1;
  }

  const anomalyAccounts = [...accountStats.values()]
    .filter((item) => item.published > 0 && item.zero > 0)
    .sort((a, b) => b.zero - a.zero || b.published - a.published);

  const views = inWindow.reduce((sum, item) => sum + item.views, 0);
  return {
    enabled: true,
    group,
    project,
    period: window.period,
    dateKey: window.dateKey,
    fromKey: window.fromKey || window.dateKey,
    toKey: window.toKey || window.dateKey,
    computedAt: now,
    thresholds: { lowView, highView },
    summary: {
      published: inWindow.length,
      zeroView: zeroView.length,
      lowView: lowViewVideos.length,
      midView: midViewVideos.length,
      highView: highViewVideos.length,
      views,
      avgView: inWindow.length ? Math.round(views / inWindow.length) : 0,
      accountCount: [...accountStats.values()].filter((item) => item.published > 0).length,
      anomalyAccountCount: anomalyAccounts.length,
      publishTotal: 0,
      publishSuccess: 0,
      publishFailed: 0,
      riskAccountCount: 0,
    },
    buckets: {
      zeroView: sortVideos(zeroView),
      lowView: sortVideos(lowViewVideos),
      highView: sortVideos(highViewVideos, true),
    },
    anomalyAccounts,
  };
}

export function attachPublishOutcome(report, stats = {}) {
  const current = report?.summary || {};
  return {
    ...report,
    summary: {
      ...current,
      publishTotal: Number(stats.total || 0) || (Number(stats.success || 0) + Number(stats.failed || 0)),
      publishSuccess: Number(stats.success || 0),
      publishFailed: Number(stats.failed || 0),
      riskAccountCount: Number(stats.riskAccounts || 0),
    },
  };
}

export function connectionIdsFromArchiveRows(accountRows = []) {
  return [...new Set((Array.isArray(accountRows) ? accountRows : []).map((row) => {
    const key = String(row?.account_key || row?.accountKey || row?.schema || "").trim();
    const id = key.startsWith("tiktok:") ? key.slice("tiktok:".length) : key;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
  }).filter(Boolean))];
}

export function chunkList(items = [], size = 200) {
  const list = Array.isArray(items) ? items : [];
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

export function mergePublishStats(parts = []) {
  return (Array.isArray(parts) ? parts : []).reduce((total, part) => ({
    total: total.total + (Number(part?.total) || Number(part?.success || 0) + Number(part?.failed || 0)),
    success: total.success + Number(part?.success || 0),
    failed: total.failed + Number(part?.failed || 0),
    riskAccounts: total.riskAccounts + Number(part?.riskAccounts || 0),
    pendingIngest: total.pendingIngest + Number(part?.pendingIngest || 0),
  }), { total: 0, success: 0, failed: 0, riskAccounts: 0, pendingIngest: 0 });
}

export function videosForProject({ store, projectId, accountRows = [], videosByAccount = new Map(), groupIds = null }) {
  return collectVideos({
    accountRows,
    videosByAccount,
    match: (account) => {
      if (!accountMatchesProject(account, store, projectId)) return false;
      if (groupIds && !groupIds.some((groupId) => accountMatchesGroup(account, store, groupId))) return false;
      return true;
    },
  });
}

export function videosForGroup({ store, groupId, accountRows = [], videosByAccount = new Map() }) {
  return collectVideos({
    accountRows,
    videosByAccount,
    match: (account) => accountMatchesGroup(account, store, groupId),
  });
}

function collectVideos({ accountRows = [], videosByAccount = new Map(), match = () => false }) {
  const videos = [];
  const accounts = [];
  for (const row of accountRows) {
    const profile = parseJson(row.profile_json, {});
    const account = {
      schema: row.account_key,
      accountKey: row.account_key,
      label: row.label,
      username: profile.username,
      profile,
    };
    if (!match(account)) continue;
    accounts.push(account);
    const list = videosByAccount.get(row.account_key) || videosByAccount.get(String(row.account_key || "")) || [];
    for (const video of list) {
      videos.push({
        ...video,
        account: row.account_key,
        username: profile.username || String(row.label || "").replace(/^@/, ""),
      });
    }
  }
  return { accounts, videos };
}

export const OPS_VIDEO_PAGE_SIZE = 10;

export function paginateItems(items = [], page = 1, pageSize = OPS_VIDEO_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || OPS_VIDEO_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(list.length / size) || 1);
  const current = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const start = (current - 1) * size;
  return {
    items: list.slice(start, start + size),
    page: current,
    pageCount,
    total: list.length,
    pageSize: size,
  };
}

export function tiktokWatchUrl(video = {}) {
  const existing = String(video.shareLink || video.videoUrl || video.url || "").trim();
  if (/tiktok\.com\/@[\w.]+\/video\/\d{10,}/i.test(existing)) return existing;
  const id = String(video.id || video.videoId || "").trim();
  const username = String(video.username || "").replace(/^@/, "").trim();
  if (/^\d{10,}$/.test(id) && username) return `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${id}`;
  return "";
}

function normalizeVideo(video) {
  return {
    id: String(video.id || video.videoId || ""),
    account: String(video.account || video.accountKey || ""),
    username: String(video.username || "").replace(/^@/, ""),
    title: String(video.title || video.caption || "未命名视频"),
    views: Number(video.views || 0),
    likes: Number(video.likes || 0),
    comments: Number(video.comments || 0),
    createdAt: toMillis(video.createdAt || video.createTime),
    shareLink: String(video.shareLink || video.videoUrl || video.url || "").trim(),
  };
}

function sortVideos(list, highFirst = false) {
  return [...list].sort((a, b) => (highFirst ? b.views - a.views : a.views - b.views || b.createdAt - a.createdAt));
}

function toMillis(value) {
  const number = Number(value) || 0;
  if (number <= 0) return 0;
  return number < 1e12 ? number * 1000 : number;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
