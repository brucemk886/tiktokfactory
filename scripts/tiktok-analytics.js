import fs from "node:fs";
import path from "node:path";

const API_URL = "https://tiktokapi.store/api/v1/user/posts";
const DEFAULT_DAILY_REQUEST_LIMIT = 100;
const MAX_HISTORY_PER_VIDEO = 45;

export function createTikTokAnalyticsService({ workDir, fetchImpl = fetch, now = () => Date.now(), defaultApiKeys = [], defaultApiKey = "" }) {
  const settingsPath = path.join(workDir, "tiktok-analytics-settings.json");
  const legacySettingsPath = path.join(workDir, "ensembledata-settings.json");
  const storePath = path.join(workDir, "tiktok-analytics.json");
  let running = false;
  let timer = null;
  let nextScheduledAt = 0;

  function readSettings() {
    const legacy = readJson(legacySettingsPath, {});
    const fallback = {
      ...defaultSettings(),
      enabled: legacy.enabled === true,
      runHour: legacy.runHour,
      runMinute: legacy.runMinute,
      groups: legacy.groups,
      apiKeys: normalizeApiKeys(defaultApiKeys.length ? defaultApiKeys : [defaultApiKey])
    };
    return readJson(settingsPath, fallback);
  }

  function getSettings({ includeApiKeys = false } = {}) {
    const settings = readSettings();
    const apiKeys = normalizeApiKeys(settings.apiKeys?.length ? settings.apiKeys : [settings.apiKey, ...defaultApiKeys, defaultApiKey]);
    return {
      enabled: settings.enabled === true,
      runHour: clampInt(settings.runHour, 0, 23, 2),
      runMinute: clampInt(settings.runMinute, 0, 59, 0),
      dailyRequestLimit: clampInt(settings.dailyRequestLimit, 1, 10000, DEFAULT_DAILY_REQUEST_LIMIT),
      groups: normalizeGroups(settings.groups),
      profileIds: normalizeGroups(settings.profileIds?.length ? settings.profileIds : ["default"]),
      provider: "TikTokAPI.store",
      apiKeys: includeApiKeys ? apiKeys : [],
      maskedApiKeys: apiKeys.map(maskToken),
      maskedApiKey: apiKeys[0] ? maskToken(apiKeys[0]) : "",
      keyCount: apiKeys.length,
      configured: apiKeys.length > 0,
      totalDailyLimit: apiKeys.length * clampInt(settings.dailyRequestLimit, 1, 10000, DEFAULT_DAILY_REQUEST_LIMIT),
      nextRunAt: nextScheduledAt
    };
  }

  function saveSettings(input = {}) {
    const current = getSettings({ includeApiKeys: true });
    const submittedKeys = Array.isArray(input.apiKeys)
      ? normalizeApiKeys(input.apiKeys)
      : normalizeApiKeys([input.apiKey]);
    const apiKeys = submittedKeys.length ? submittedKeys : current.apiKeys;
    const next = {
      enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
      runHour: clampInt(input.runHour, 0, 23, current.runHour),
      runMinute: clampInt(input.runMinute, 0, 59, current.runMinute),
      dailyRequestLimit: clampInt(input.dailyRequestLimit, 1, 10000, current.dailyRequestLimit),
      groups: input.groups === undefined ? current.groups : normalizeGroups(input.groups),
      profileIds: input.profileIds === undefined ? current.profileIds : normalizeGroups(input.profileIds),
      apiKeys
    };
    atomicWriteJson(settingsPath, next);
    scheduleNextRun();
    return getSettings();
  }

  async function fetchAccount(username) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) throw new Error("请输入有效的 TikTok 账号名称。");
    if (running) throw new Error("已有 TikTok 数据抓取任务正在执行。");

    running = true;
    try {
      const store = readStore(storePath);
      const startedAt = now();
      const result = await fetchOneAccount(normalizedUsername, store);
      store.lastRun = { startedAt, updatedAt: now(), finishedAt: now(), completed: 1, total: 1, failed: 0, status: "done" };
      atomicWriteJson(storePath, store);
      return result;
    } finally {
      running = false;
    }
  }

  async function fetchAccounts(usernames, { onProgress } = {}) {
    const accounts = Array.from(new Set((usernames || []).map(normalizeUsername).filter(Boolean)));
    if (!accounts.length) throw new Error("没有找到可抓取的 TikTok 账号。");
    if (running) throw new Error("已有 TikTok 数据抓取任务正在执行。");

    running = true;
    const store = readStore(storePath);
    const results = [];
    try {
      for (let index = 0; index < accounts.length; index++) {
        const username = accounts[index];
        try {
          const result = await fetchOneAccount(username, store);
          results.push({ username, ok: true, ...result });
        } catch (error) {
          results.push({ username, ok: false, error: error.message || "抓取失败" });
        }
        store.lastRun = {
          startedAt: store.lastRun?.startedAt || now(),
          updatedAt: now(),
          completed: index + 1,
          total: accounts.length,
          failed: results.filter((item) => !item.ok).length,
          errors: results.filter((item) => !item.ok).slice(-10).map((item) => ({ username: item.username, error: item.error }))
        };
        atomicWriteJson(storePath, store);
        onProgress?.({ current: index + 1, total: accounts.length, username, results });
        if (index < accounts.length - 1) await delay(350);
      }
      store.lastRun = {
        ...store.lastRun,
        finishedAt: now(),
        status: results.some((item) => !item.ok) ? "partial" : "done"
      };
      atomicWriteJson(storePath, store);
      return summarizeRun(results);
    } finally {
      running = false;
    }
  }

  async function fetchOneAccount(username, store, { attemptedKeyIndexes = [] } = {}) {
    const settings = getSettings({ includeApiKeys: true });
    if (!settings.apiKeys.length) throw new Error("尚未配置 TikTokAPI.store API Key。");
    const usage = ensureDailyUsage(store, localDateKey(now()), settings.apiKeys.length);
    const keyIndex = selectApiKeyIndex(usage, settings.apiKeys.length, settings.dailyRequestLimit, attemptedKeyIndexes);
    if (keyIndex < 0) throw new Error("今日 TikTokAPI.store 免费额度已用完。");

    let response;
    let body;
    try {
      const requestUrl = new URL(API_URL);
      requestUrl.searchParams.set("unique_id", username);
      requestUrl.searchParams.set("count", "20");
      response = await fetchWithTimeout(fetchImpl, requestUrl, 30000, {
        headers: { Authorization: `Bearer ${settings.apiKeys[keyIndex]}` }
      });
      body = await response.json();
    } catch (error) {
      throw new Error(`TikTokAPI.store 请求失败：${error.message || error}`);
    }

    if (!response.ok || isApiError(body)) {
      if (isTokenUnavailable(body, response.status)) {
        usage[keyIndex] = settings.dailyRequestLimit;
        return fetchOneAccount(username, store, { attemptedKeyIndexes: [...attemptedKeyIndexes, keyIndex] });
      }
      throw new Error(resolveApiError(body, response.status));
    }

    usage[keyIndex] = Number(usage[keyIndex] || 0) + 1;
    const fetchedAt = now();
    const posts = extractPosts(body)
      .map((post) => normalizeTikTokPost(post, username, fetchedAt))
      .filter((post) => post.id)
      .sort((a, b) => b.createTime - a.createTime);

    store.accounts[username] = {
      username,
      lastFetchedAt: fetchedAt,
      lastSuccessAt: fetchedAt,
      lastPostCount: posts.length,
      keyIndex
    };
    for (const post of posts) upsertPost(store, post, fetchedAt);

    return {
      postCount: posts.length,
      fetchedAt,
      keyIndex,
      remainingRequests: usage.reduce((sum, used) => sum + Math.max(0, settings.dailyRequestLimit - Number(used || 0)), 0),
      posts
    };
  }

  function getDashboard({ period = "7d", group = "", account = "", sort = "views", allowedAccounts = null } = {}, publishRecords = []) {
    const store = readStore(storePath);
    const recordMatches = matchPublishRecords(store.videos, publishRecords);
    const allowedAccountSet = Array.isArray(allowedAccounts)
      ? new Set(allowedAccounts.map(normalizeUsername).filter(Boolean))
      : null;
    const baseVideos = Object.values(store.videos)
      .map((entry) => {
        const history = entry.history || [];
        const previous = history.length > 1 ? history[history.length - 2] : null;
        return {
          ...entry.latest,
          history,
          viewsDelta: previous ? Math.max(0, entry.latest.views - previous.views) : 0,
          local: recordMatches.get(entry.latest.id) || null
        };
      })
      .filter((video) => !allowedAccountSet || allowedAccountSet.has(normalizeUsername(video.username)))
      .filter((video) => !group || video.local?.groupName === group)
      .filter((video) => !account || video.username.toLowerCase().includes(String(account).toLowerCase()));
    let videos = filterByPeriod(baseVideos, period, now());

    videos.sort(videoSorter(sort));
    const accounts = buildAccountSummary(videos, store.accounts);
    const audioRankings = buildAudioRankings(videos);
    const summary = summarizeVideos(videos, accounts);
    const groups = Array.from(new Set(publishRecords.map((item) => item.groupName).filter(Boolean))).sort();
    const todayVideos = filterByPeriod(baseVideos, "today", now()).sort(videoSorter("views"));
    const sevenDayVideos = filterByPeriod(baseVideos, "7d", now()).sort(videoSorter("views"));

    return {
      status: {
        running,
        lastRun: store.lastRun || null,
        dailyUsage: store.dailyUsage || {},
        settings: getSettings()
      },
      summary,
      periods: {
        today: summarizeVideos(filterByPeriod(baseVideos, "today", now())),
        yesterday: summarizeVideos(filterByPeriod(baseVideos, "yesterday", now())),
        sevenDays: summarizeVideos(filterByPeriod(baseVideos, "7d", now()))
      },
      accounts,
      audioRankings,
      videos: videos.slice(0, 500),
      todayVideos: todayVideos.slice(0, 500),
      sevenDayVideos: sevenDayVideos.slice(0, 30),
      filters: { groups }
    };
  }

  function getVideo(videoId, publishRecords = []) {
    const store = readStore(storePath);
    const entry = store.videos[String(videoId || "")];
    if (!entry?.latest) return null;
    const matches = matchPublishRecords(store.videos, publishRecords);
    return { ...entry.latest, history: entry.history || [], local: matches.get(entry.latest.id) || null };
  }

  function getMatchedVideos(publishRecords = []) {
    const store = readStore(storePath);
    const matches = matchPublishRecords(store.videos, publishRecords);
    return Object.values(store.videos).map((entry) => ({
      ...entry.latest,
      local: matches.get(entry.latest.id) || null
    }));
  }

  function getAudioDetail(audioName, { period = "7d", group = "", account = "", sort = "newest" } = {}, publishRecords = []) {
    const targetAudioName = String(audioName || "").trim();
    if (!targetAudioName) return null;
    const store = readStore(storePath);
    const recordMatches = matchPublishRecords(store.videos, publishRecords);
    const baseVideos = Object.values(store.videos)
      .map((entry) => {
        const history = entry.history || [];
        const previous = history.length > 1 ? history[history.length - 2] : null;
        return {
          ...entry.latest,
          history,
          viewsDelta: previous ? Math.max(0, entry.latest.views - previous.views) : 0,
          local: recordMatches.get(entry.latest.id) || null
        };
      })
      .filter((video) => !group || video.local?.groupName === group)
      .filter((video) => !account || video.username.toLowerCase().includes(String(account).toLowerCase()));
    const videos = filterByPeriod(baseVideos, period, now())
      .filter((video) => String(video.local?.audioName || "") === targetAudioName)
      .sort(videoSorter(sort));
    return {
      audioName: targetAudioName,
      summary: buildAudioRankings(videos)[0] || null,
      videos
    };
  }

  function getAccountDetail(username, { period = "7d", group = "", sort = "newest", allowedAccounts = null } = {}, publishRecords = []) {
    const targetUsername = normalizeUsername(username);
    if (!targetUsername) return null;
    const dashboard = getDashboard({ period, group, account: targetUsername, sort, allowedAccounts }, publishRecords);
    const videos = (dashboard.videos || [])
      .filter((video) => normalizeUsername(video.username) === targetUsername)
      .sort(videoSorter(sort));
    const summary = (dashboard.accounts || []).find((item) => normalizeUsername(item.username) === targetUsername)
      || buildAccountSummary(videos, {})[0]
      || null;
    return { username: targetUsername, summary, videos };
  }

  function repairStore() {
    const raw = readJson(storePath, {});
    const before = Object.keys(raw.videos || {}).length;
    const cleaned = readStore(storePath);
    const after = Object.keys(cleaned.videos).length;
    let backupPath = "";
    if (before !== after && fs.existsSync(storePath)) {
      backupPath = `${storePath}.pre-dedupe-${now()}.backup`;
      fs.copyFileSync(storePath, backupPath);
      atomicWriteJson(storePath, cleaned);
    }
    return { before, after, removed: before - after, backupPath };
  }

  function scheduleNextRun(getAccounts) {
    if (timer) clearTimeout(timer);
    timer = null;
    nextScheduledAt = 0;
    const settings = getSettings({ includeApiKeys: true });
    if (!settings.enabled || !settings.apiKeys.length || !settings.groups.length || typeof getAccounts !== "function") return null;
    const target = nextRunAt(now(), settings.runHour, settings.runMinute);
    nextScheduledAt = target;
    timer = setTimeout(async () => {
      try {
        await fetchAccounts(await getAccounts());
      } catch (error) {
        const store = readStore(storePath);
        store.lastRun = { startedAt: now(), finishedAt: now(), status: "failed", error: error.message || String(error) };
        atomicWriteJson(storePath, store);
      } finally {
        scheduleNextRun(getAccounts);
      }
    }, Math.min(target - now(), 2_147_000_000));
    timer.unref?.();
    return target;
  }

  return { getSettings, saveSettings, fetchAccount, fetchAccounts, getDashboard, getVideo, getMatchedVideos, getAudioDetail, getAccountDetail, repairStore, scheduleNextRun, isRunning: () => running };
}

export function normalizeTikTokPost(post, fallbackUsername = "", fetchedAt = Date.now()) {
  const stats = post?.statistics || post?.stats || post?.statsV2 || post || {};
  const author = post?.author || post?.authorInfo || {};
  const idCandidates = [post?.aweme_id, post?.awemeId, post?.video_id, post?.videoId, post?.item_id, post?.itemId, post?.id, post?.video?.id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const id = idCandidates.find(isNumericTikTokId) || idCandidates[0] || "";
  const username = normalizeUsername(author?.unique_id || author?.uniqueId || author?.username || fallbackUsername);
  const createTime = toUnixSeconds(post?.create_time ?? post?.createTime ?? post?.create_time_iso);
  const suppliedShareUrl = post?.share_url || post?.shareUrl || post?.share_info?.share_url || post?.shareInfo?.shareUrl || post?.web_url || post?.url || "";
  return {
    id,
    username,
    description: String(post?.desc || post?.description || post?.text || post?.title || ""),
    createTime,
    fetchedAt,
    views: metric(stats, ["play_count", "playCount", "views", "view_count"]),
    likes: metric(stats, ["digg_count", "diggCount", "likes", "like_count"]),
    comments: metric(stats, ["comment_count", "commentCount", "comments"]),
    shares: metric(stats, ["share_count", "shareCount", "shares"]),
    bookmarks: metric(stats, ["collect_count", "collectCount", "favorites", "save_count"]),
    duration: Number(post?.video?.duration || post?.duration || 0),
    coverUrl: String(post?.video?.cover?.url_list?.[0] || post?.video?.cover || post?.cover || post?.origin_cover || ""),
    shareUrl: normalizeTikTokShareUrl(suppliedShareUrl, username, id)
  };
}

export function matchPublishRecords(videos, publishRecords) {
  const result = new Map();
  const recordsByAccount = new Map();
  for (const record of publishRecords || []) {
    const username = normalizeUsername(record.accountName);
    if (!username || !Number(record.scheduleAt)) continue;
    if (!recordsByAccount.has(username)) recordsByAccount.set(username, []);
    recordsByAccount.get(username).push(record);
  }
  for (const records of recordsByAccount.values()) records.sort((a, b) => Number(b.scheduleAt) - Number(a.scheduleAt));

  const used = new Set();
  const list = Object.values(deduplicateVideoEntries(videos)).map((entry) => entry.latest || entry).sort((a, b) => b.createTime - a.createTime);
  for (const video of list) {
    const candidates = recordsByAccount.get(normalizeUsername(video.username)) || [];
    let best = null;
    let bestScore = Infinity;
    let bestDistance = Infinity;
    let bestCaptionScore = 0;
    for (const record of candidates) {
      if (used.has(record.id)) continue;
      const distance = Math.abs(Number(record.scheduleAt) - Number(video.createTime));
      if (distance > 30 * 60) continue;
      const captionScore = hashtagSimilarity(video.description, record.videoDesc);
      const score = distance - captionScore * 20 * 60;
      if (score < bestScore) {
        best = record;
        bestScore = score;
        bestDistance = distance;
        bestCaptionScore = captionScore;
      }
    }
    if (best) {
      used.add(best.id);
      result.set(video.id, {
        recordId: best.id,
        fileName: best.fileName || "",
        audioName: best.audioName || "",
        groupName: best.groupName || "",
        template: best.templateLabel || best.template || "",
        scheduleAt: Number(best.scheduleAt) || 0,
        matchDistanceSeconds: bestDistance,
        captionSimilarity: bestCaptionScore,
        matchConfidence: bestDistance <= 10 * 60 ? "high" : "medium"
      });
    }
  }
  return result;
}

function hashtagSimilarity(left, right) {
  const getTags = (value) => new Set((String(value || "").toLowerCase().match(/#[\p{L}\p{N}_.-]+/gu) || []));
  const a = getTags(left);
  const b = getTags(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((tag) => b.has(tag)).length;
  return overlap / Math.max(a.size, b.size);
}

export function deduplicateVideoEntries(videos = {}) {
  const groups = new Map();
  for (const [key, value] of Object.entries(videos || {})) {
    const entry = value?.latest ? value : { latest: value, history: [] };
    if (!entry.latest) continue;
    const latest = { ...entry.latest, id: String(entry.latest.id || key) };
    const fingerprint = videoFingerprint(latest);
    if (!groups.has(fingerprint)) groups.set(fingerprint, []);
    groups.get(fingerprint).push({ latest, history: Array.isArray(entry.history) ? entry.history : [] });
  }

  const result = {};
  for (const entries of groups.values()) {
    const merged = mergeVideoEntries(entries);
    if (merged.latest.id) result[merged.latest.id] = merged;
  }
  return result;
}

function videoFingerprint(video) {
  const id = String(video?.id || "");
  const username = normalizeUsername(video?.username);
  const createTime = Number(video?.createTime) || 0;
  if (!username || !createTime) return `id:${id}`;
  const description = String(video?.description || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${username}|${createTime}|${description}`;
}

function mergeVideoEntries(entries) {
  const ordered = [...entries].sort((left, right) => {
    const fetchedDifference = Number(left.latest?.fetchedAt || 0) - Number(right.latest?.fetchedAt || 0);
    return fetchedDifference || Number(left.latest?.views || 0) - Number(right.latest?.views || 0);
  });
  const freshest = ordered.at(-1)?.latest || {};
  const ids = Array.from(new Set(ordered.map((entry) => String(entry.latest?.id || "")).filter(Boolean)));
  const canonicalId = ids.find(isNumericTikTokId) || ids[0] || "";
  const validShareUrl = ordered
    .map((entry) => normalizeTikTokShareUrl(entry.latest?.shareUrl, entry.latest?.username, entry.latest?.id))
    .find(Boolean) || normalizeTikTokShareUrl("", freshest.username, canonicalId);
  const historyByTime = new Map();

  for (const entry of ordered) {
    const snapshots = [...entry.history, metricSnapshot(entry.latest)];
    for (const snapshot of snapshots) {
      const fetchedAt = Number(snapshot?.fetchedAt) || 0;
      if (!fetchedAt) continue;
      const current = historyByTime.get(fetchedAt);
      if (!current || Number(snapshot.views || 0) >= Number(current.views || 0)) {
        historyByTime.set(fetchedAt, {
          fetchedAt,
          views: Number(snapshot.views) || 0,
          likes: Number(snapshot.likes) || 0,
          comments: Number(snapshot.comments) || 0,
          shares: Number(snapshot.shares) || 0,
          bookmarks: Number(snapshot.bookmarks) || 0
        });
      }
    }
  }

  return {
    latest: {
      ...freshest,
      id: canonicalId,
      shareUrl: validShareUrl,
      sourceIds: ids
    },
    history: Array.from(historyByTime.values()).sort((a, b) => a.fetchedAt - b.fetchedAt).slice(-MAX_HISTORY_PER_VIDEO)
  };
}

function metricSnapshot(video) {
  return {
    fetchedAt: Number(video?.fetchedAt) || 0,
    views: Number(video?.views) || 0,
    likes: Number(video?.likes) || 0,
    comments: Number(video?.comments) || 0,
    shares: Number(video?.shares) || 0,
    bookmarks: Number(video?.bookmarks) || 0
  };
}

function isNumericTikTokId(value) {
  return /^\d{10,}$/.test(String(value || ""));
}

function normalizeTikTokShareUrl(value, username, id) {
  const supplied = String(value || "").trim();
  if (supplied) {
    const idMatch = supplied.match(/\/video\/([^/?#]+)/i);
    if (!idMatch || isNumericTikTokId(idMatch[1])) return supplied;
  }
  return username && isNumericTikTokId(id)
    ? `https://www.tiktok.com/@${normalizeUsername(username)}/video/${id}`
    : "";
}

function defaultSettings() {
  return { enabled: false, runHour: 2, runMinute: 0, dailyRequestLimit: DEFAULT_DAILY_REQUEST_LIMIT, groups: [], profileIds: ["default"], apiKeys: [] };
}

function readStore(filePath) {
  const value = readJson(filePath, {});
  return {
    version: 2,
    accounts: value.accounts && typeof value.accounts === "object" ? value.accounts : {},
    videos: deduplicateVideoEntries(value.videos && typeof value.videos === "object" ? value.videos : {}),
    dailyUsage: Number(value.version) >= 2 && value.dailyUsage && typeof value.dailyUsage === "object" ? value.dailyUsage : {},
    lastRun: value.lastRun || null
  };
}

function upsertPost(store, post, fetchedAt) {
  const current = store.videos[post.id] || { latest: null, history: [] };
  const snapshot = {
    fetchedAt,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    bookmarks: post.bookmarks
  };
  const history = Array.isArray(current.history) ? current.history : [];
  const last = history.at(-1);
  if (!last || last.fetchedAt !== fetchedAt) history.push(snapshot);
  store.videos[post.id] = { latest: post, history: history.slice(-MAX_HISTORY_PER_VIDEO) };
  store.videos = deduplicateVideoEntries(store.videos);
}

function ensureDailyUsage(store, dateKey, keyCount = 1) {
  store.dailyUsage ||= {};
  for (const key of Object.keys(store.dailyUsage)) {
    if (key !== dateKey) delete store.dailyUsage[key];
  }
  if (!Array.isArray(store.dailyUsage[dateKey])) store.dailyUsage[dateKey] = [];
  while (store.dailyUsage[dateKey].length < keyCount) store.dailyUsage[dateKey].push(0);
  return store.dailyUsage[dateKey];
}

function selectApiKeyIndex(usage, keyCount, limit, excluded = []) {
  const blocked = new Set(excluded);
  return Array.from({ length: keyCount }, (_, index) => index)
    .filter((index) => !blocked.has(index) && Number(usage[index] || 0) < limit)
    .sort((left, right) => Number(usage[left] || 0) - Number(usage[right] || 0))[0] ?? -1;
}

function extractPosts(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.data)) return body.data.data;
  if (Array.isArray(body?.data?.aweme_list)) return body.data.aweme_list;
  if (Array.isArray(body?.data?.videos)) return body.data.videos;
  if (Array.isArray(body?.aweme_list)) return body.aweme_list;
  if (Array.isArray(body?.posts)) return body.posts;
  return [];
}

function isApiError(body) {
  return Boolean(body?.error || body?.success === false || Number(body?.status_code || 0) !== 0 || Number(body?.code || 0) !== 0);
}

function resolveApiError(body, status) {
  const message = body?.error?.message || body?.error || body?.message || body?.detail || body?.status_msg;
  return `TikTokAPI.store 返回错误（${status}）：${typeof message === "string" ? message : JSON.stringify(message || body)}`;
}

function isTokenUnavailable(body, status) {
  const message = String(body?.error?.message || body?.error || body?.message || body?.detail || body?.status_msg || "").toLowerCase();
  return [401, 403, 429, 495].includes(Number(status)) ||
    message.includes("maximum requests limit") ||
    message.includes("quota") ||
    message.includes("invalid token") ||
    message.includes("unauthorized");
}

function buildAccountSummary(videos, accountState) {
  const map = new Map();
  for (const video of videos) {
    const item = map.get(video.username) || {
      username: video.username,
      videos: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      bookmarks: 0,
      maxViews: 0,
      minViews: Infinity,
      low100: 0,
      low200: 0,
      over500: 0,
      over1000: 0,
      viewList: [],
      groups: new Set()
    };
    const views = Number(video.views) || 0;
    item.videos += 1;
    item.views += views;
    item.likes += video.likes;
    item.comments += video.comments;
    item.shares += video.shares;
    item.bookmarks += video.bookmarks;
    item.maxViews = Math.max(item.maxViews, views);
    item.minViews = Math.min(item.minViews, views);
    if (views < 100) item.low100 += 1;
    if (views < 200) item.low200 += 1;
    if (views >= 500) item.over500 += 1;
    if (views >= 1000) item.over1000 += 1;
    item.viewList.push(views);
    if (video.local?.groupName) item.groups.add(video.local.groupName);
    item.lastFetchedAt = accountState?.[video.username]?.lastFetchedAt || 0;
    map.set(video.username, item);
  }
  return Array.from(map.values()).map((item) => ({
    username: item.username,
    videos: item.videos,
    views: item.views,
    likes: item.likes,
    comments: item.comments,
    shares: item.shares,
    bookmarks: item.bookmarks,
    groups: Array.from(item.groups).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    lastFetchedAt: item.lastFetchedAt,
    averageViews: item.videos ? Math.round(item.views / item.videos) : 0,
    medianViews: percentile(item.viewList, 0.5),
    maxViews: item.maxViews,
    minViews: item.minViews === Infinity ? 0 : item.minViews,
    low100Rate: item.videos ? item.low100 / item.videos * 100 : 0,
    low200Rate: item.videos ? item.low200 / item.videos * 100 : 0,
    over500Rate: item.videos ? item.over500 / item.videos * 100 : 0,
    over1000Rate: item.videos ? item.over1000 / item.videos * 100 : 0,
    engagement: item.views ? ((item.likes + item.comments + item.shares + item.bookmarks) / item.views) * 100 : 0
  })).sort((a, b) => b.views - a.views);
}

function buildAudioRankings(videos) {
  const map = new Map();
  for (const video of videos || []) {
    const audioName = String(video.local?.audioName || "").trim();
    if (!audioName) continue;
    const item = map.get(audioName) || {
      audioName,
      videos: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      bookmarks: 0,
      maxViews: 0,
      minViews: Infinity,
      low100: 0,
      low200: 0,
      over500: 0,
      over1000: 0,
      accounts: new Set(),
      groups: new Set(),
      viewList: []
    };
    const views = Number(video.views) || 0;
    item.videos += 1;
    item.views += views;
    item.likes += Number(video.likes) || 0;
    item.comments += Number(video.comments) || 0;
    item.shares += Number(video.shares) || 0;
    item.bookmarks += Number(video.bookmarks) || 0;
    item.maxViews = Math.max(item.maxViews, views);
    item.minViews = Math.min(item.minViews, views);
    if (views < 100) item.low100 += 1;
    if (views < 200) item.low200 += 1;
    if (views >= 500) item.over500 += 1;
    if (views >= 1000) item.over1000 += 1;
    if (video.username) item.accounts.add(video.username);
    if (video.local?.groupName) item.groups.add(video.local.groupName);
    item.viewList.push(views);
    map.set(audioName, item);
  }

  return Array.from(map.values())
    .map((item) => {
      const engagement = item.views > 0
        ? ((item.likes + item.comments + item.shares + item.bookmarks) / item.views) * 100
        : 0;
      return {
        audioName: item.audioName,
        videos: item.videos,
        accounts: item.accounts.size,
        groups: Array.from(item.groups).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).slice(0, 6),
        views: item.views,
        averageViews: item.videos ? Math.round(item.views / item.videos) : 0,
        medianViews: percentile(item.viewList, 0.5),
        maxViews: item.maxViews,
        minViews: item.minViews === Infinity ? 0 : item.minViews,
        low100Rate: item.videos ? item.low100 / item.videos * 100 : 0,
        low200Rate: item.videos ? item.low200 / item.videos * 100 : 0,
        over500Rate: item.videos ? item.over500 / item.videos * 100 : 0,
        over1000Rate: item.videos ? item.over1000 / item.videos * 100 : 0,
        engagement
      };
    })
    .sort((a, b) => b.averageViews - a.averageViews || b.maxViews - a.maxViews)
    .slice(0, 80);
}

function percentile(values, ratio) {
  const list = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const position = Math.min(list.length - 1, Math.max(0, (list.length - 1) * ratio));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return Math.round(list[lower] + (list[upper] - list[lower]) * fraction);
}

function summarizeVideos(videos, accounts = null) {
  const list = Array.isArray(videos) ? videos : [];
  const totals = list.reduce((result, video) => {
    result.views += Number(video.views) || 0;
    result.likes += Number(video.likes) || 0;
    result.comments += Number(video.comments) || 0;
    result.shares += Number(video.shares) || 0;
    result.bookmarks += Number(video.bookmarks) || 0;
    return result;
  }, { views: 0, likes: 0, comments: 0, shares: 0, bookmarks: 0 });
  const accountCount = accounts
    ? accounts.length
    : new Set(list.map((video) => video.username).filter(Boolean)).size;
  return {
    accountCount,
    videoCount: list.length,
    matchedCount: list.filter((video) => video.local).length,
    ...totals,
    averageViews: list.length ? Math.round(totals.views / list.length) : 0,
    engagement: totals.views > 0
      ? ((totals.likes + totals.comments + totals.shares + totals.bookmarks) / totals.views) * 100
      : 0
  };
}

function summarizeRun(results) {
  return {
    total: results.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    posts: results.reduce((sum, item) => sum + Number(item.postCount || 0), 0),
    results
  };
}

function videoSorter(sort) {
  if (sort === "likes") return (a, b) => b.likes - a.likes;
  if (sort === "engagement") return (a, b) => engagementOf(b) - engagementOf(a);
  if (sort === "newest") return (a, b) => b.createTime - a.createTime;
  return (a, b) => b.views - a.views;
}

function engagementOf(video) {
  return video.views ? (video.likes + video.comments + video.shares + video.bookmarks) / video.views : 0;
}

function filterByPeriod(videos, period, currentTime) {
  if (period === "all") return [...videos];
  const todayStart = new Date(currentTime);
  todayStart.setHours(0, 0, 0, 0);
  const today = todayStart.getTime();
  let start = today - 6 * 24 * 60 * 60 * 1000;
  let end = currentTime + 1;
  if (period === "today") start = today;
  if (period === "yesterday") {
    start = today - 24 * 60 * 60 * 1000;
    end = today;
  }
  if (period === "30d") start = today - 29 * 24 * 60 * 60 * 1000;
  return videos.filter((video) => {
    const createdAt = Number(video.createTime) * 1000;
    return createdAt >= start && createdAt < end;
  });
}

function nextRunAt(currentTime, hour, minute) {
  const date = new Date(currentTime);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= currentTime) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function normalizeGroups(groups) {
  return Array.from(new Set((groups || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeApiKeys(keys) {
  return Array.from(new Set((keys || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function maskToken(value) {
  const token = String(value || "");
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function metric(stats, keys) {
  for (const key of keys) {
    const value = Number(stats?.[key]);
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

function toUnixSeconds(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number > 1e12 ? Math.floor(number / 1000) : Math.floor(number);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function localDateKey(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(options.headers || {}) }
    });
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
