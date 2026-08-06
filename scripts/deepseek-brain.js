import fs from "node:fs";
import path from "node:path";
import {
  buildOperationPromptV2,
  operationOutputSchema
} from "./codex-brain.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;
const DEFAULT_ANALYSIS_CHUNK_CHARS = 70_000;
const REQUIRED_STAGES = ["cold_start", "testing", "breakout", "scaling", "qualified", "recovery"];
const EVIDENCE_OUTPUT_SCHEMA = Object.freeze({
  accountFindings: [{
    username: "string",
    diagnosis: "string",
    retentionPatterns: ["string"],
    distributionPatterns: ["string"],
    strongestVideoIds: ["string"],
    weakestVideoIds: ["string"],
    recommendedTests: ["string"]
  }],
  crossVideoPatterns: ["string"],
  risks: ["string"]
});

export function createDeepSeekBrainService({
  workDir,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  analysisChunkChars = DEFAULT_ANALYSIS_CHUNK_CHARS,
  env = process.env
}) {
  const settingsPath = path.join(workDir, "deepseek-settings.json");
  let lastTest = null;
  let lastOperationRun = null;
  let running = false;

  function readSettings() {
    const saved = readJson(settingsPath, {});
    return {
      apiKey: String(env.DEEPSEEK_API_KEY || saved.apiKey || "").trim(),
      model: DEFAULT_MODEL,
      reasoningMode: saved.reasoningMode === "disabled" ? "disabled" : "enabled"
    };
  }

  function getPublicSettings() {
    const settings = readSettings();
    return {
      configured: Boolean(settings.apiKey),
      apiKeyHint: maskSecret(settings.apiKey),
      model: settings.model,
      reasoningMode: settings.reasoningMode,
      baseUrl: DEFAULT_BASE_URL,
      environmentOverride: Boolean(env.DEEPSEEK_API_KEY),
      running,
      lastTest,
      lastOperationRun
    };
  }

  function saveSettings(payload = {}) {
    const current = readSettings();
    const incomingKey = String(payload.apiKey || "").trim();
    const apiKey = payload.clearApiKey === true
      ? ""
      : incomingKey && !/^\*+$/.test(incomingKey)
        ? incomingKey
        : current.apiKey;
    if (incomingKey && incomingKey.length < 16) {
      throw statusError(400, "Invalid DeepSeek API key.");
    }
    const saved = readJson(settingsPath, {});
    const next = {
      apiKey: env.DEEPSEEK_API_KEY ? String(saved.apiKey || "").trim() : apiKey,
      model: DEFAULT_MODEL,
      reasoningMode: payload.reasoningMode === "disabled" ? "disabled" : "enabled",
      updatedAt: Date.now()
    };
    atomicWriteJson(settingsPath, next);
    return getPublicSettings();
  }

  async function testConnection(payload = {}) {
    if (running) throw statusError(409, "DeepSeek is busy.");
    const settings = resolveRequestSettings(payload);
    requireApiKey(settings.apiKey);
    running = true;
    const startedAt = Date.now();
    try {
      const response = await requestCompletion({
        settings,
        messages: [
          { role: "system", content: "Reply with exactly DEEPSEEK_CONNECTED." },
          { role: "user", content: "Connection test." }
        ],
        maxTokens: 24,
        reasoningMode: "disabled"
      });
      if (String(response.content || "").trim() !== "DEEPSEEK_CONNECTED") {
        throw statusError(502, "DeepSeek returned an unexpected test response.");
      }
      lastTest = {
        ok: true,
        testedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        model: settings.model,
        usage: response.usage
      };
      return { ok: true, ...getPublicSettings(), running: false };
    } catch (error) {
      lastTest = {
        ok: false,
        testedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        model: settings.model,
        error: String(error?.message || error)
      };
      throw error;
    } finally {
      running = false;
    }
  }

  async function generateOperationStrategy(payload = {}, options = {}) {
    if (running) throw statusError(409, "DeepSeek is already processing another request.");
    const settings = resolveRequestSettings(options);
    requireApiKey(settings.apiKey);
    running = true;
    const startedAt = Date.now();
    try {
      const response = await requestCompletion({
        settings,
        messages: [
          {
            role: "system",
            content: "You are a TikTok operations analyst. Return one valid JSON object only, with no markdown or commentary. All operator-facing analysis and rationale text must be in Simplified Chinese; keep only schema enums and publishing-copy fields in their required language."
          },
          {
            role: "user",
            content: `${buildOperationPromptV2(payload)}\n\nRequired JSON schema:\n${JSON.stringify(operationOutputSchema)}`
          }
        ],
        maxTokens: 12_000,
        reasoningMode: settings.reasoningMode,
        jsonOutput: true
      });
      const strategy = parseAndValidateStrategy(response.content);
      lastOperationRun = {
        ok: true,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        model: settings.model,
        reasoningMode: settings.reasoningMode,
        usage: response.usage
      };
      return { strategy, ...lastOperationRun };
    } catch (error) {
      lastOperationRun = {
        ok: false,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        model: settings.model,
        reasoningMode: settings.reasoningMode,
        error: String(error?.message || error)
      };
      throw error;
    } finally {
      running = false;
    }
  }

  async function analyzeOperationDataset(payload = {}, options = {}) {
    if (running) throw statusError(409, "DeepSeek is already processing another request.");
    const settings = resolveRequestSettings(options);
    requireApiKey(settings.apiKey);
    running = true;
    const startedAt = Date.now();
    const dataset = normalizeFullPrivateDataset(payload.fullPrivatePerformance || payload.privatePerformance);
    const chunks = buildAnalysisChunks(dataset, analysisChunkChars);
    let usage = null;
    try {
      const batchAnalyses = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const response = await requestCompletion({
          settings,
          messages: [
            {
              role: "system",
              content: "You are a TikTok retention-data analyst. Analyze every supplied video and every supplied second-by-second curve point. Return one concise valid JSON object only. Do not ignore low-view videos and do not confuse distribution with retention. Write all human-readable analysis text in Simplified Chinese."
            },
            {
              role: "user",
              content: `Analyze this complete batch of owner-authorized TikTok metrics. Compare second-by-second retention, like timing, completion, average watch time, reach, engagement, traffic sources, and audience distributions. Identify exact drop seconds and distribution-versus-retention conflicts.\n\nBatch ${index + 1}/${chunks.length}:\n${JSON.stringify(chunk)}\n\nRequired JSON shape:\n${JSON.stringify(EVIDENCE_OUTPUT_SCHEMA)}`
            }
          ],
          maxTokens: 4_000,
          reasoningMode: settings.reasoningMode,
          jsonOutput: true
        });
        usage = mergeUsage(usage, response.usage);
        batchAnalyses.push({
          batch: index + 1,
          coverage: summarizeChunkCoverage(chunk),
          analysis: normalizeEvidenceAnalysis(parseJsonObject(response.content))
        });
      }

      const evidenceReport = {
        windowDays: dataset.windowDays,
        accountCount: dataset.accounts.length,
        videoCount: dataset.accounts.reduce((sum, account) => sum + account.videos.length, 0),
        retentionPointCount: dataset.accounts.reduce((sum, account) => sum + account.videos.reduce((videoSum, video) => videoSum + video.retentionCurve.length, 0), 0),
        likePointCount: dataset.accounts.reduce((sum, account) => sum + account.videos.reduce((videoSum, video) => videoSum + video.likeCurve.length, 0), 0),
        batchCount: chunks.length,
        batches: batchAnalyses
      };
      const strategyPayload = { ...payload, fullPrivatePerformance: undefined };
      const strategyResponse = await requestCompletion({
        settings,
        messages: [
          {
            role: "system",
            content: "You are a TikTok operations analyst. Synthesize the complete batch evidence into one operating strategy. Return one valid JSON object only, with no markdown or commentary. All operator-facing analysis and rationale text must be in Simplified Chinese; keep only schema enums and publishing-copy fields in their required language."
          },
          {
            role: "user",
            content: `${buildOperationPromptV2(strategyPayload)}\n\nDeepSeek full-dataset evidence report. Every recent video and every available second-by-second curve was processed in the preceding batches:\n${JSON.stringify(evidenceReport)}\n\nRequired JSON schema:\n${JSON.stringify(operationOutputSchema)}`
          }
        ],
        maxTokens: 12_000,
        reasoningMode: settings.reasoningMode,
        jsonOutput: true
      });
      usage = mergeUsage(usage, strategyResponse.usage);
      const strategy = parseAndValidateStrategy(strategyResponse.content);
      lastOperationRun = {
        ok: true,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        model: settings.model,
        reasoningMode: settings.reasoningMode,
        usage,
        analysisStats: {
          accounts: evidenceReport.accountCount,
          videos: evidenceReport.videoCount,
          retentionPoints: evidenceReport.retentionPointCount,
          likePoints: evidenceReport.likePointCount,
          batches: evidenceReport.batchCount
        }
      };
      return { strategy, evidenceReport, ...lastOperationRun };
    } catch (error) {
      lastOperationRun = {
        ok: false,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        model: settings.model,
        reasoningMode: settings.reasoningMode,
        usage,
        error: String(error?.message || error)
      };
      throw error;
    } finally {
      running = false;
    }
  }

  function resolveRequestSettings(payload = {}) {
    const settings = readSettings();
    return {
      ...settings,
      apiKey: String(payload.apiKey || settings.apiKey || "").trim(),
      reasoningMode: payload.reasoningMode === "disabled"
        ? "disabled"
        : payload.reasoningMode === "enabled"
          ? "enabled"
          : settings.reasoningMode
    };
  }

  async function requestCompletion({ settings, messages, maxTokens, reasoningMode, jsonOutput = false }) {
    if (typeof fetchImpl !== "function") throw statusError(500, "This Node.js runtime does not support fetch.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${DEFAULT_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages,
          stream: false,
          max_tokens: maxTokens,
          thinking: { type: reasoningMode },
          ...(jsonOutput ? { response_format: { type: "json_object" } } : {})
        }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
        throw statusError(response.status === 401 ? 401 : 502, `DeepSeek API request failed: ${detail}`);
      }
      const content = String(data?.choices?.[0]?.message?.content || "").trim();
      if (!content) throw statusError(502, "DeepSeek returned no usable content.");
      return { content, usage: data.usage || null };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw statusError(504, `DeepSeek API request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      if (error?.statusCode) throw error;
      throw statusError(502, `DeepSeek API connection failed: ${String(error?.message || error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getStatus: getPublicSettings,
    getPublicSettings,
    saveSettings,
    testConnection,
    generateOperationStrategy,
    analyzeOperationDataset
  };
}

export function buildAnalysisChunks(value = {}, maxChars = DEFAULT_ANALYSIS_CHUNK_CHARS) {
  const dataset = normalizeFullPrivateDataset(value);
  const safeMax = Math.max(2_000, Number(maxChars) || DEFAULT_ANALYSIS_CHUNK_CHARS);
  const fragments = [];
  for (const account of dataset.accounts) {
    const base = { ...account, videos: undefined };
    let videos = [];
    for (const video of account.videos) {
      const candidate = { ...base, videos: [...videos, video] };
      if (videos.length && JSON.stringify(candidate).length > safeMax) {
        fragments.push({ ...base, videos });
        videos = [video];
      } else {
        videos.push(video);
      }
    }
    if (videos.length || !account.videos.length) fragments.push({ ...base, videos });
  }
  const chunks = [];
  let accounts = [];
  for (const fragment of fragments) {
    const candidate = { windowDays: dataset.windowDays, accounts: [...accounts, fragment] };
    if (accounts.length && JSON.stringify(candidate).length > safeMax) {
      chunks.push({ windowDays: dataset.windowDays, accounts });
      accounts = [fragment];
    } else {
      accounts.push(fragment);
    }
  }
  if (accounts.length) chunks.push({ windowDays: dataset.windowDays, accounts });
  return chunks;
}

function normalizeFullPrivateDataset(value = {}) {
  const number = (input) => input === null || input === undefined || !Number.isFinite(Number(input)) ? null : Number(input);
  const curve = (items) => (items || []).map((item) => ({
    second: Math.max(0, Number(item?.second) || 0),
    percentage: number(item?.percentage)
  })).filter((item) => item.percentage !== null).sort((left, right) => left.second - right.second);
  const breakdown = (items) => (items || []).map((item) => ({
    label: String(item?.label || "").slice(0, 100),
    percentage: number(item?.percentage)
  })).filter((item) => item.label && item.percentage !== null);
  return {
    windowDays: Math.max(1, Number(value.windowDays) || 10),
    accounts: (value.accounts || []).slice(0, 100).map((account) => ({
      username: String(account.username || "").replace(/^@/, "").slice(0, 100),
      videoCount: Math.max(0, Number(account.videoCount) || 0),
      averageViews: number(account.averageViews),
      maxViews: Math.max(0, Number(account.maxViews) || 0),
      averageWatchRatio: number(account.averageWatchRatio),
      averageFullWatchRate: number(account.averageFullWatchRate),
      averageRetention3: number(account.averageRetention3),
      averageRetention5: number(account.averageRetention5),
      averageRetention10: number(account.averageRetention10),
      averageRetentionEnd: number(account.averageRetentionEnd),
      averageForYouRate: number(account.averageForYouRate),
      conflictCount: Math.max(0, Number(account.conflictCount) || 0),
      videos: (account.videos || []).slice(0, 30).map((video) => ({
        videoId: String(video.videoId || "").slice(0, 40),
        caption: String(video.caption || "").slice(0, 500),
        createdAt: Math.max(0, Number(video.createdAt) || 0),
        duration: Math.max(0, Number(video.duration) || 0),
        views: Math.max(0, Number(video.views) || 0),
        reach: Math.max(0, Number(video.reach) || 0),
        likes: Math.max(0, Number(video.likes) || 0),
        comments: Math.max(0, Number(video.comments) || 0),
        shares: Math.max(0, Number(video.shares) || 0),
        favorites: Math.max(0, Number(video.favorites) || 0),
        profileViews: Math.max(0, Number(video.profileViews) || 0),
        newFollowers: Math.max(0, Number(video.newFollowers) || 0),
        averageTimeWatched: number(video.averageTimeWatched),
        totalTimeWatched: number(video.totalTimeWatched),
        averageWatchRatio: number(video.averageWatchRatio),
        fullWatchRate: number(video.fullWatchRate),
        largestRetentionDrop: number(video.largestRetentionDrop),
        largestRetentionDropSecond: number(video.largestRetentionDropSecond),
        diagnosticEngagementRate: number(video.diagnosticEngagementRate),
        conflict: String(video.conflict || "").slice(0, 100),
        retentionCurve: curve(video.retentionCurve),
        likeCurve: curve(video.likeCurve),
        impressionSources: breakdown(video.impressionSources),
        audienceGender: breakdown(video.audienceGender),
        audienceCountry: breakdown(video.audienceCountry),
        audienceCity: breakdown(video.audienceCity),
        audienceType: breakdown(video.audienceType)
      }))
    })).filter((account) => account.username)
  };
}

function summarizeChunkCoverage(chunk = {}) {
  const accounts = chunk.accounts || [];
  const videos = accounts.flatMap((account) => account.videos || []);
  return {
    accounts: Array.from(new Set(accounts.map((account) => account.username))).filter(Boolean),
    videoIds: videos.map((video) => video.videoId).filter(Boolean),
    videoCount: videos.length,
    retentionPointCount: videos.reduce((sum, video) => sum + (video.retentionCurve?.length || 0), 0),
    likePointCount: videos.reduce((sum, video) => sum + (video.likeCurve?.length || 0), 0)
  };
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(stripCodeFence(String(value || "")));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  throw statusError(502, "DeepSeek dataset analysis response was not valid JSON.");
}

function normalizeEvidenceAnalysis(value = {}) {
  const texts = (items, limit = 10, maxLength = 400) => (items || []).slice(0, limit).map((item) => String(item || "").slice(0, maxLength)).filter(Boolean);
  return {
    accountFindings: (value.accountFindings || []).slice(0, 40).map((item) => ({
      username: String(item?.username || "").replace(/^@/, "").slice(0, 100),
      diagnosis: String(item?.diagnosis || "").slice(0, 800),
      retentionPatterns: texts(item?.retentionPatterns),
      distributionPatterns: texts(item?.distributionPatterns),
      strongestVideoIds: texts(item?.strongestVideoIds, 10, 40),
      weakestVideoIds: texts(item?.weakestVideoIds, 10, 40),
      recommendedTests: texts(item?.recommendedTests)
    })),
    crossVideoPatterns: texts(value.crossVideoPatterns, 12),
    risks: texts(value.risks, 10)
  };
}

function mergeUsage(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries(Array.from(keys).map((key) => {
    const leftValue = Number(left[key]);
    const rightValue = Number(right[key]);
    return [key, Number.isFinite(leftValue) || Number.isFinite(rightValue)
      ? (Number.isFinite(leftValue) ? leftValue : 0) + (Number.isFinite(rightValue) ? rightValue : 0)
      : right[key] ?? left[key]];
  }));
}

function parseAndValidateStrategy(value) {
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(String(value || "")));
  } catch {
    throw statusError(502, "DeepSeek strategy response was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw statusError(502, "DeepSeek returned an empty strategy.");
  const publishingStages = new Set((parsed.publishingPlan || []).map((item) => item?.stage));
  if (REQUIRED_STAGES.some((id) => !publishingStages.has(id))) {
    throw statusError(502, "DeepSeek returned incomplete account-stage strategy data.");
  }
  return parsed;
}

function stripCodeFence(value) {
  const text = value.trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

function requireApiKey(apiKey) {
  if (!apiKey) throw statusError(400, "Save a DeepSeek API key first.");
}

function maskSecret(value) {
  const text = String(value || "");
  return text ? `${"*".repeat(Math.min(8, Math.max(4, text.length - 4)))}${text.slice(-4)}` : "";
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
