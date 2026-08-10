import fs from "node:fs";
import path from "node:path";
import { summarizeOperationSignals } from "./private-tiktok-signals.js";

const DEFAULT_BASE_URL = "https://tiktokaitool.com";
const REQUEST_TIMEOUT_MS = 20_000;

export function createOfficialTikTokAnalyticsService({ workDir, fetchImpl = fetch, now = () => Date.now() } = {}) {
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
    const result = await requestJson("/api/integrations/local-factory/accounts");
    return { connected: true, source: "official", accountCount: result.accounts?.length || 0 };
  }

  async function listAccounts() {
    return requestJson("/api/integrations/local-factory/accounts");
  }

  async function listVideos({ schema, query = "", limit = 20, includePrivate = false } = {}) {
    const params = new URLSearchParams({
      accountId: clean(schema),
      query: clean(query),
      limit: String(Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)))),
    });
    if (includePrivate) params.set("includePrivate", "1");
    return requestJson(`/api/integrations/local-factory/videos?${params}`);
  }

  async function getVideoDetail({ schema, videoId } = {}) {
    const params = new URLSearchParams({ accountId: clean(schema) });
    return requestJson(`/api/integrations/local-factory/videos/${encodeURIComponent(clean(videoId))}?${params}`);
  }

  async function getOperationSignals({ accountNames = [], days = 10, videosPerAccount = 30, publishedAfter = 0 } = {}) {
    if (!getPublicSettings().configured) {
      return unavailableResult("Official TikTok analytics is not configured.");
    }

    try {
      const requested = new Set((accountNames || []).map(normalizeAccountName).filter(Boolean));
      const accountResult = await requestJson("/api/integrations/local-factory/accounts");
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

  async function requestJson(endpoint) {
    const settings = readSettings();
    if (!settings.baseUrl || !settings.apiKey) {
      throw statusError(400, "The official TikTok analytics bridge is not configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${settings.baseUrl}${endpoint}`, {
        headers: { Authorization: `Bearer ${settings.apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw statusError(response.status, payload.error || `TikTok official bridge returned HTTP ${response.status}.`);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw statusError(504, "The official TikTok analytics bridge timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
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

  return { getPublicSettings, saveSettings, testConnection, listAccounts, listVideos, getVideoDetail, getOperationSignals };
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
