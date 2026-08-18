import { accountMatchesGroup, accountMatchesProject, officialAccountKeys } from "./official-account-group-store.js";

export const LOW_VIEW = 200;
export const HIGH_VIEW = 1000;

export function shanghaiDateKey(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export function periodWindow(period = "today", now = Date.now()) {
  const dateKey = shanghaiDateKey(now);
  const dayStart = Date.parse(`${dateKey}T00:00:00+08:00`);
  if (period === "week") {
    const weekday = new Date(now).toLocaleDateString("en-US", { timeZone: "Asia/Shanghai", weekday: "short" });
    const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
    return { startAt: dayStart - offset * 86_400_000, endAt: dayStart + 86_400_000, dateKey, period: "week" };
  }
  return { startAt: dayStart, endAt: dayStart + 86_400_000, dateKey, period: "today" };
}

export function computeGroupReport({
  group,
  project,
  videos = [],
  accounts = [],
  period = "today",
  now = Date.now(),
  lowView = LOW_VIEW,
  highView = HIGH_VIEW,
} = {}) {
  const window = periodWindow(period, now);
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

  return {
    enabled: true,
    group,
    project,
    period: window.period,
    dateKey: window.dateKey,
    computedAt: now,
    thresholds: { lowView, highView },
    summary: {
      published: inWindow.length,
      zeroView: zeroView.length,
      lowView: lowViewVideos.length,
      midView: midViewVideos.length,
      highView: highViewVideos.length,
      views: inWindow.reduce((sum, item) => sum + item.views, 0),
      accountCount: [...accountStats.values()].filter((item) => item.published > 0).length,
      anomalyAccountCount: anomalyAccounts.length,
    },
    buckets: {
      zeroView: sortVideos(zeroView),
      lowView: sortVideos(lowViewVideos),
      highView: sortVideos(highViewVideos, true),
    },
    anomalyAccounts,
  };
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
  };
}

function sortVideos(list, highFirst = false) {
  return [...list].sort((a, b) => (highFirst ? b.views - a.views : a.views - b.views || b.createdAt - a.createdAt)).slice(0, 80);
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
