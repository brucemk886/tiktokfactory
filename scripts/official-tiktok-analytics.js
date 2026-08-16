import fs from "node:fs";
import path from "node:path";
import { summarizeOperationSignals } from "./private-tiktok-signals.js";

const DEFAULT_BASE_URL = "https://tiktokaitool.com";
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_PUBLISH_FILE_BYTES = 95 * 1024 * 1024;
const NETWORK_RETRY_DELAYS_MS = [2_000, 5_000];
const PUBLISH_RETRY_DELAYS_MS = [3_000, 8_000, 20_000];
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);

export function createOfficialTikTokAnalyticsService({
  workDir,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = delay,
  networkRetryDelays = NETWORK_RETRY_DELAYS_MS,
  publishRetryDelays = PUBLISH_RETRY_DELAYS_MS,
} = {}) {
  if (!workDir) throw new Error("Official TikTok analytics service requires a work directory.");
  const settingsPath = path.join(workDir, "official-tiktok-analytics-settings.json");
  fs.mkdirSync(workDir, { recursive: true });

  function getPublicSettings() {
    const settings = readSettings();
    const configured = Boolean(settings.baseUrl && settings.apiKey);
    return {
      configured,
      baseUrl: settings.baseUrl || DEFAULT_BASE_URL,
      hasApiKey: Boolean(settings.apiKey),
      updatedAt: Number(settings.updatedAt || 0),
      source: "official",
    };
  }

  function saveSettings(payload = {}) {
    const current = readSettings();
    const next = {
      baseUrl: normalizeBaseUrl(payload.baseUrl ?? current.baseUrl ?? DEFAULT_BASE_URL),
      apiKey: clean(payload.apiKey) || current.apiKey || "",
      updatedAt: now(),
    };
    if (!next.baseUrl) throw statusError(400, "Please enter the TikTok AI Tool URL.");
    writeJson(settingsPath, next);
    return getPublicSettings();
  }

  async function testConnection() {
    const result = await listAccountPage({ limit: 1 });
    return { connected: true, source: "official", accountCount: result.accounts?.length || 0 };
  }

  async function listAccountPage({ cursor = "", limit = 100 } = {}) {
    const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)))) });
    if (clean(cursor)) params.set("cursor", clean(cursor));
    return requestJson(`/api/integrations/local-factory/accounts?${params}`);
  }

  async function listAccounts({ maxAccounts = 10_000 } = {}) {
    const accounts = [];
    let cursor = "";
    const maximum = Math.max(1, Math.min(10_000, Math.floor(Number(maxAccounts) || 10_000)));
    while (accounts.length < maximum) {
      const page = await listAccountPage({ cursor, limit: Math.min(100, maximum - accounts.length) });
      accounts.push(...(page.accounts || []));
      if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return { connected: true, accounts, hasMore: accounts.length >= maximum, nextCursor: cursor };
  }

  async function listArchivePage({ cursor = "", limit = 20, videosPerAccount = 100 } = {}) {
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(20, Math.floor(Number(limit) || 20)))),
      videosPerAccount: String(Math.max(1, Math.min(100, Math.floor(Number(videosPerAccount) || 100)))),
    });
    if (clean(cursor)) params.set("cursor", clean(cursor));
    return requestJson(`/api/integrations/local-factory/archive?${params}`, {
      retryNetworkErrors: true,
      operationLabel: "同步 TikTok 官方数据归档",
      timeoutMs: 60_000,
    });
  }

  async function listPublishAccounts() {
    return requestJson("/api/v1/accounts");
  }

  async function uploadPublishAsset({ filePath, fileName = "video.mp4", contentType = "video/mp4", onRetry } = {}) {
    const resolvedPath = path.resolve(clean(filePath));
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PUBLISH_FILE_BYTES) {
      throw statusError(413, "The official TikTok publishing file must be between 1 byte and 95 MB.");
    }
    const type = clean(contentType) || "video/mp4";
    const signed = await requestSignedUpload({
      fileName: clean(fileName) || path.basename(resolvedPath),
      contentType: type,
      fileSize: stat.size,
    });
    if (signed?.uploadUrl && signed.assetKey) {
      await putDirectAsset({
        uploadUrl: signed.uploadUrl,
        headers: signed.headers || { "Content-Type": type },
        filePath: resolvedPath,
        fileSize: stat.size,
        onRetry,
      });
      return {
        assetKey: signed.assetKey,
        fileName: signed.fileName || path.basename(resolvedPath),
        contentType: signed.contentType || type,
        fileSize: Number(signed.fileSize || stat.size),
      };
    }
    return requestJson("/api/v1/publish/assets", {
      method: "POST",
      headers: {
        "Content-Type": type,
        "Content-Length": String(stat.size),
        "X-File-Name": encodeURIComponent(clean(fileName) || path.basename(resolvedPath)),
      },
      bodyFactory: () => fs.createReadStream(resolvedPath),
      duplex: "half",
      timeoutMs: UPLOAD_TIMEOUT_MS,
      operationLabel: "上传 TikTok 发布素材",
      retryNetworkErrors: true,
      retryDelays: publishRetryDelays,
      onRetry,
    });
  }

  async function requestSignedUpload({ fileName, contentType, fileSize }) {
    try {
      return await requestJson("/api/v1/publish/assets/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, contentType, fileSize }),
        timeoutMs: REQUEST_TIMEOUT_MS,
        operationLabel: "申请 TikTok 直传地址",
        retryNetworkErrors: true,
        retryDelays: networkRetryDelays,
      });
    } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 404 || status === 501) return null;
      throw error;
    }
  }

  async function putDirectAsset({ uploadUrl, headers = {}, filePath, fileSize, onRetry }) {
    const retryDelays = publishRetryDelays;
    const operationLabel = "直传 TikTok 发布素材到 R2";
    const size = Number(fileSize) > 0 ? Number(fileSize) : fs.statSync(filePath).size;
    const putHeaders = {
      ...headers,
      "Content-Length": String(size),
    };
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      try {
        const response = await fetchImpl(uploadUrl, {
          method: "PUT",
          headers: putHeaders,
          body: fs.readFileSync(filePath),
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw statusError(response.status, text.slice(0, 200) || `R2 直传返回 HTTP ${response.status}`);
        }
        return;
      } catch (error) {
        if (!shouldRetryBridgeError(error, true) || attempt >= retryDelays.length) {
          throw describeBridgeError(error, operationLabel, attempt + 1);
        }
        if (typeof onRetry === "function") {
          onRetry({
            attempt: attempt + 1,
            attempts: retryDelays.length + 1,
            delayMs: retryDelays[attempt],
            status: Number(error?.status || error?.statusCode) || 0,
            operationLabel,
            message: error?.message || "",
          });
        }
        await sleep(retryDelays[attempt]);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function createPublishBatch(payload = {}) {
    const { onRetry, ...batchPayload } = payload;
    return requestJson("/api/v1/publish/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchPayload),
      timeoutMs: UPLOAD_TIMEOUT_MS,
      operationLabel: "创建 TikTok 发布批次",
      retryNetworkErrors: true,
      retryDelays: publishRetryDelays,
      onRetry,
    });
  }

  async function getPublishBatch(batchId) {
    const id = clean(batchId);
    if (!id) throw statusError(400, "TikTok publish batch ID is required.");
    return requestJson(`/api/v1/publish/batches/${encodeURIComponent(id)}`);
  }

  async function listVideos({ schema, query = "", limit = 20, includePrivate = false, includeHistory = false, snapshotDays = 30 } = {}) {
    const params = new URLSearchParams({
      accountId: clean(schema),
      query: clean(query),
      limit: String(Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)))),
    });
    if (includePrivate) params.set("includePrivate", "1");
    if (includeHistory) {
      params.set("includeHistory", "1");
      params.set("snapshotDays", String(Math.max(1, Math.min(400, Math.floor(Number(snapshotDays) || 30)))));
    }
    return requestJson(`/api/integrations/local-factory/videos?${params}`);
  }

  async function getVideo({ accountId, videoId } = {}) {
    const schema = clean(accountId);
    const id = clean(videoId);
    if (!schema || !id) throw statusError(400, "TikTok account ID and video ID are required.");
    const params = new URLSearchParams({ accountId: schema });
    return requestJson(`/api/integrations/local-factory/videos/${encodeURIComponent(id)}?${params}`);
  }

  async function getOperationSignals({ accountNames = [], days = 10, videosPerAccount = 30, publishedAfter = 0 } = {}) {
    if (!getPublicSettings().configured) {
      return unavailableResult("Official TikTok analytics is not configured.");
    }

    try {
      const requested = new Set((accountNames || []).map(normalizeAccountName).filter(Boolean));
      const accountResult = await listAccounts();
      const matchedAccounts = (accountResult.accounts || []).filter((account) => {
        const username = normalizeAccountName(account.profile?.username);
        return !requested.size || requested.has(username);
      });
      const safeDays = Math.max(1, Math.min(30, Math.floor(Number(days) || 10)));
      const cutoffAt = Math.max(now() - safeDays * 86_400_000, Number(publishedAfter) || 0);
      const signals = [];

      for (const account of matchedAccounts) {
        const result = await listVideos({ schema: account.schema, limit: videosPerAccount, includePrivate: true });
        signals.push({
          schema: account.schema,
          username: normalizeAccountName(account.profile?.username),
          profile: account.profile,
          videos: (result.videos || []).filter((video) => !video.createdAt || Number(video.createdAt) >= cutoffAt),
        });
      }

      return summarizeOperationSignals(signals, {
        days: safeDays,
        requestedAccountCount: requested.size,
        generatedAt: now(),
      });
    } catch (error) {
      throw error;
    }
  }

  async function requestJson(endpoint, options = {}) {
    const settings = readSettings();
    if (!settings.baseUrl || !settings.apiKey) {
      throw statusError(400, "The official TikTok analytics bridge is not configured.");
    }
    const retryDelays = Array.isArray(options.retryDelays)
      ? options.retryDelays
      : (options.retryNetworkErrors ? networkRetryDelays : []);
    const operationLabel = clean(options.operationLabel) || "请求 TikTok 官方桥接服务";
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
      const bodyFactory = options.bodyFactory;
      const fetchOptions = { ...options };
      delete fetchOptions.bodyFactory;
      delete fetchOptions.retryNetworkErrors;
      delete fetchOptions.retryDelays;
      delete fetchOptions.operationLabel;
      delete fetchOptions.timeoutMs;
      delete fetchOptions.onRetry;
      try {
        const response = await fetchImpl(`${settings.baseUrl}${endpoint}`, {
          ...fetchOptions,
          ...(typeof bodyFactory === "function" ? { body: bodyFactory() } : {}),
          headers: { Authorization: `Bearer ${settings.apiKey}`, Accept: "application/json", ...(options.headers || {}) },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw statusError(response.status, payload.error || `TikTok official bridge returned HTTP ${response.status}.`);
        }
        return payload;
      } catch (error) {
        if (!shouldRetryBridgeError(error, options.retryNetworkErrors || Array.isArray(options.retryDelays)) || attempt >= retryDelays.length) {
          throw describeBridgeError(error, operationLabel, attempt + 1);
        }
        const delayMs = retryDelays[attempt];
        if (typeof options.onRetry === "function") {
          options.onRetry({
            attempt: attempt + 1,
            attempts: retryDelays.length + 1,
            delayMs,
            status: Number(error?.status || error?.statusCode) || 0,
            operationLabel,
            message: error?.message || ""
          });
        }
        await sleep(delayMs);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  function readSettings() {
    const stored = readJson(settingsPath, {});
    return {
      baseUrl: normalizeBaseUrl(stored.baseUrl || process.env.TIKTOK_ANALYTICS_BRIDGE_URL || DEFAULT_BASE_URL),
      apiKey: clean(stored.apiKey || process.env.TIKTOK_ANALYTICS_BRIDGE_API_KEY),
      updatedAt: Number(stored.updatedAt || 0),
    };
  }

  return { getPublicSettings, saveSettings, testConnection, listAccountPage, listAccounts, listArchivePage, listPublishAccounts, uploadPublishAsset, createPublishBatch, getPublishBatch, listVideos, getVideo, getOperationSignals };
}

function normalizeBaseUrl(value) {
  const cleanValue = clean(value).replace(/\/+$/, "");
  if (!cleanValue) return "";
  const url = new URL(cleanValue);
  if (!/^https?:$/.test(url.protocol)) {
    throw statusError(400, "The TikTok AI Tool URL must use HTTP or HTTPS.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function normalizeAccountName(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function unavailableResult(error) {
  return { connected: false, status: "unavailable", matchedAccountCount: 0, summary: { detailedVideoCount: 0 }, accounts: [], error };
}

function clean(value) {
  return String(value ?? "").trim();
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function statusError(status, message) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function shouldRetryBridgeError(error, enabled) {
  if (!enabled || !error) return false;
  const status = Number(error.status || error.statusCode);
  if (RETRYABLE_HTTP_STATUSES.has(status)) return true;
  return isRetryableNetworkError(error);
}

function isRetryableNetworkError(error) {
  if (!error || Number(error.status || error.statusCode)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  const code = clean(error.cause?.code || error.code).toUpperCase();
  return error instanceof TypeError || [
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ].includes(code);
}

function describeBridgeError(error, operationLabel, attempts) {
  const status = Number(error?.status || error?.statusCode);
  if (RETRYABLE_HTTP_STATUSES.has(status) && attempts > 1) {
    const detail = clean(error?.message);
    const extra = detail && !/^TikTok official bridge returned HTTP \d+\.$/.test(detail) ? ` ${detail}` : "";
    return statusError(status, `${operationLabel}暂时不可用（HTTP ${status}），已重试 ${attempts} 次。请稍后再试或点「继续执行」。${extra}`.trim());
  }
  if (status) return error;
  const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
  const code = clean(error?.cause?.code || error?.code);
  const detail = clean(error?.cause?.message || error?.message) || "未知网络错误";
  const suffix = code ? `${code}: ${detail}` : detail;
  const message = timedOut
    ? `${operationLabel}超时，已尝试 ${attempts} 次。`
    : `${operationLabel}网络失败，已尝试 ${attempts} 次：${suffix}`;
  return statusError(timedOut ? 504 : 502, message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
