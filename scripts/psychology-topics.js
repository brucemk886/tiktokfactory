import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 45_000;

export function createPsychologyTopicsService({ workDir, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const settingsPath = path.join(workDir, "psychology-topics-settings.json");
  const libraryPath = path.join(workDir, "psychology-topics.json");

  function readSettings() {
    const saved = readJson(settingsPath, {});
    return {
      apiUrl: String(saved.apiUrl || "").trim(),
      authType: normalizeAuthType(saved.authType),
      apiToken: String(saved.apiToken || "").trim(),
      updatedAt: Number(saved.updatedAt) || 0
    };
  }

  function getPublicSettings() {
    const settings = readSettings();
    const library = readLibrary();
    return {
      apiUrl: settings.apiUrl,
      authType: settings.authType,
      tokenConfigured: Boolean(settings.apiToken),
      updatedAt: settings.updatedAt,
      syncedAt: library.syncedAt || "",
      total: library.topics.length
    };
  }

  function saveSettings(payload = {}) {
    const current = readSettings();
    const apiUrl = String(payload.apiUrl ?? current.apiUrl).trim();
    if (apiUrl && !/^https?:\/\//i.test(apiUrl)) throw badRequest("题库 API 地址必须以 http:// 或 https:// 开头。");
    const next = {
      apiUrl,
      authType: normalizeAuthType(payload.authType ?? current.authType),
      apiToken: resolveSecretInput(payload.apiToken, current.apiToken),
      updatedAt: Date.now()
    };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
    return getPublicSettings();
  }

  async function sync() {
    const settings = readSettings();
    if (!settings.apiUrl) throw badRequest("请先填写心理学题库 API 地址并保存。");
    const headers = { Accept: "application/json" };
    if (settings.apiToken && settings.authType === "bearer") headers.Authorization = `Bearer ${settings.apiToken}`;
    if (settings.apiToken && settings.authType === "x-api-key") headers["X-API-Key"] = settings.apiToken;
    const { raw } = await fetchTextWithRetry(fetchImpl, settings.apiUrl, { headers, timeoutMs });
    let payload;
    try { payload = JSON.parse(raw); } catch { throw externalError("题库接口没有返回有效 JSON。"); }
    const topics = normalizeTopics(payload);
    if (!topics.length) throw externalError("接口已连接，但没有识别到题目。请确认返回中包含 items、questions、tests 或 data 数组。");
    const library = { syncedAt: new Date().toISOString(), sourceUrl: settings.apiUrl, topics };
    fs.mkdirSync(path.dirname(libraryPath), { recursive: true });
    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), "utf8");
    return { syncedAt: library.syncedAt, total: topics.length };  }

  function list({ query = "", page = 1, pageSize = 20 } = {}) {
    const library = readLibrary();
    const keyword = String(query).trim().toLowerCase();
    const filtered = keyword
      ? library.topics.filter((item) => `${item.question} ${item.hookTitle} ${item.answerGuide}`.toLowerCase().includes(keyword))
      : library.topics;
    const safePageSize = clampInt(pageSize, 1, 100, 20);
    const safePage = clampInt(page, 1, Math.max(1, Math.ceil(filtered.length / safePageSize)), 1);
    const start = (safePage - 1) * safePageSize;
    return {
      items: filtered.slice(start, start + safePageSize),
      total: filtered.length,
      page: safePage,
      pageSize: safePageSize,
      syncedAt: library.syncedAt || "",
      sourceUrl: library.sourceUrl || ""
    };
  }

  function get(id) {
    return readLibrary().topics.find((item) => item.id === String(id || "")) || null;
  }

  function readLibrary() {
    const saved = readJson(libraryPath, {});
    return {
      syncedAt: String(saved.syncedAt || ""),
      sourceUrl: String(saved.sourceUrl || ""),
      topics: Array.isArray(saved.topics) ? saved.topics : []
    };
  }

  return { getPublicSettings, saveSettings, sync, list, get };
}

export function normalizeTopics(payload) {
  const source = findTopicArray(payload);
  const topics = source.map(normalizeTopic).filter((item) => item.question);
  const seen = new Set();
  return topics.filter((item) => {
    const key = item.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findTopicArray(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.items, payload?.questions, payload?.tests, payload?.topics,
    payload?.data, payload?.data?.items, payload?.data?.questions, payload?.data?.tests, payload?.data?.topics,
    payload?.result, payload?.result?.items, payload?.result?.questions
  ];
  return candidates.find(Array.isArray) || [];
}

function normalizeTopic(value, index) {
  if (typeof value === "string") value = { question: value };
  const question = firstText(value?.question, value?.title, value?.name, value?.text, value?.prompt);
  const options = normalizeOptions(value?.options || value?.choices || value?.answers || value?.variants);
  const answerGuide = firstText(
    value?.answerGuide,
    value?.analysis,
    value?.result,
    value?.answer,
    value?.description,
    buildAnswerGuide(value?.options || value?.choices || value?.answers || value?.variants)
  );
  const hookTitle = firstText(value?.hookTitle, value?.headline, question);
  const imageUrl = firstText(value?.imageUrl, value?.image, value?.cover, value?.thumbnail);
  const sourceId = firstText(value?.id, value?._id, value?.uuid, value?.slug);
  const id = sourceId || crypto.createHash("sha1").update(`${question}|${index}`).digest("hex").slice(0, 16);
  return { id, question, hookTitle, answerGuide, options, imageUrl };
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string") return { label: String.fromCharCode(65 + index), text: item };
    const explicitText = firstText(item?.text, item?.content, item?.title, item?.value, item?.description);
    const sourceLabel = firstText(item?.label, item?.key, item?.id);
    const sourceUsesLabelAsText = !explicitText && sourceLabel && sourceLabel.length > 2;
    return {
      label: sourceUsesLabelAsText ? String.fromCharCode(65 + index) : firstText(sourceLabel, String.fromCharCode(65 + index)),
      text: firstText(explicitText, sourceUsesLabelAsText ? sourceLabel : "")
    };
  }).filter((item) => item.text);
}

function buildAnswerGuide(value) {
  if (!Array.isArray(value)) return "";
  return value.map((item, index) => {
    if (!item || typeof item !== "object") return "";
    const choice = firstText(item.text, item.content, item.title, item.value, item.label);
    const explanation = firstText(item.interpretation, item.projection, item.meaning, item.analysis, item.description);
    if (!choice || !explanation) return "";
    return `${String.fromCharCode(65 + index)}. ${choice}: ${explanation}`;
  }).filter(Boolean).join("\n");
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeAuthType(value) {
  return value === "bearer" || value === "x-api-key" ? value : "none";
}

export function resolveSecretInput(value, currentValue = "") {
  const next = String(value || "").trim();
  const current = String(currentValue || "").trim();
  if (!next || /^[*\u2022]+$/.test(next)) return current;
  if (current.length >= 16 && next.length < 16) return current;
  return next;
}

export async function fetchTextWithRetry(fetchImpl, url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, attempts = 3 } = {}) {
  const retryDelays = [1_200, 3_000];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      const raw = await response.text();
      if (!response.ok) {
        const error = externalError(`题库接口请求失败：HTTP ${response.status}${raw ? ` · ${raw.slice(0, 180)}` : ""}`);
        error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        throw error;
      }
      return { response, raw };
    } catch (error) {
      const isTimeout = error?.name === "AbortError";
      const isRetryable = isTimeout || error?.retryable === true || !error?.statusCode;
      if (!isRetryable || attempt === attempts - 1) {
        if (error?.statusCode) throw error;
        const code = error?.cause?.code || error?.code || "";
        const detail = code ? `（${code}）` : "";
        if (isTimeout) throw externalError(`题库接口超过 ${Math.round(timeoutMs / 1000)} 秒未响应，已自动重试 ${attempts} 次。`);
        throw externalError(`题库接口连接失败${detail}：${error?.message || "未知网络错误"}，已自动重试 ${attempts} 次。`);
      }
      await delay(retryDelays[Math.min(attempt, retryDelays.length - 1)]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function externalError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}
