import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BASE_URL = "https://api.kie.ai";
const IMAGE_MODELS = {
  grok: "grok-imagine/text-to-image",
  "nano-banana": "google/nano-banana"
};
const FINAL_STATES = new Set(["success", "fail"]);

export function createKieAiService({ workDir, readApiKey, fetchImpl = fetch, now = Date.now }) {
  const storePath = path.join(workDir, "kie-ai-generations.json");

  async function getOverview() {
    return {
      tasks: readStore(storePath).tasks.slice(0, 50).map(publicTask),
      credits: await safeCredits(),
      configured: Boolean(apiKey())
    };
  }

  async function createTask(input = {}) {
    const kind = ["image", "video", "chat"].includes(input.kind) ? input.kind : "chat";
    const prompt = String(input.prompt || "").trim();
    if (prompt.length < 2) throw requestError("请输入生成描述或对话内容。", 400);
    if (prompt.length > 8000) throw requestError("输入内容不能超过 8000 个字符。", 400);

    const id = crypto.randomUUID();
    const createdAt = now();
    if (kind === "chat") {
      const result = await createChat(prompt);
      return saveTask({
        id, kind, prompt, model: result.model, status: "success", taskId: "",
        resultText: result.text, resultUrls: [], error: "", progress: 100,
        creditsConsumed: result.creditsConsumed, createdAt, updatedAt: createdAt, completedAt: createdAt
      });
    }

    const imageModel = String(input.imageModel || "grok");
    if (kind === "image" && !IMAGE_MODELS[imageModel]) throw requestError("不支持这个生图模型。", 400);
    const remote = await createMediaTask(kind, prompt, { ...input, imageModel });
    return saveTask({
      id, kind, prompt, model: remote.model, status: "waiting", taskId: remote.taskId,
      resultText: "", resultUrls: [], error: "", progress: 0, creditsConsumed: 0,
      createdAt, updatedAt: createdAt, completedAt: 0
    });
  }

  async function refreshTask(id) {
    const store = readStore(storePath);
    const index = store.tasks.findIndex((task) => task.id === String(id || ""));
    if (index < 0) throw requestError("找不到这条生成任务。", 404);
    const current = store.tasks[index];
    if (!current.taskId || FINAL_STATES.has(current.status)) return publicTask(current);

    const remote = await getRemoteTask(current.taskId);
    const status = remote.state === "success" ? "success" : remote.state === "fail" ? "fail" : remote.state;
    const updatedAt = now();
    const next = {
      ...current,
      status,
      progress: status === "success" ? 100 : remote.progress,
      resultUrls: remote.resultUrls,
      error: remote.error,
      creditsConsumed: remote.creditsConsumed,
      updatedAt,
      completedAt: FINAL_STATES.has(status) ? (remote.completeTime || updatedAt) : 0
    };
    store.tasks[index] = next;
    writeStore(storePath, store);
    return publicTask(next);
  }

  async function safeCredits() {
    if (!apiKey()) return null;
    try {
      const data = await kieRequest("/api/v1/chat/credit");
      return Number(data.data || 0);
    } catch {
      return null;
    }
  }

  async function createMediaTask(kind, prompt, options) {
    const model = kind === "image"
      ? IMAGE_MODELS[options.imageModel] || IMAGE_MODELS.grok
      : "grok-imagine/text-to-video";
    const imagePrompt = options.noImageText === false ? prompt : `${prompt}\n\nMANDATORY OUTPUT RULE: Create visuals only. Do not render any visible text, captions, titles, labels, letters, numbers, logos, watermarks, subtitles, signs, interface elements, or typography anywhere in the image. If the concept mentions words or labels, express them only through imagery. Leave clean visual space so text can be added later in post-production.`;
    const input = kind === "image"
      ? model === IMAGE_MODELS["nano-banana"]
        ? { prompt: imagePrompt, aspect_ratio: String(options.aspectRatio || "9:16"), output_format: "png" }
        : { prompt: imagePrompt, aspect_ratio: String(options.aspectRatio || "9:16") }
      : {
          prompt,
          aspect_ratio: String(options.aspectRatio || "9:16"),
          mode: "normal",
          duration: String(options.duration || "6"),
          resolution: String(options.resolution || "480p")
        };
    const data = await kieRequest("/api/v1/jobs/createTask", {
      method: "POST",
      body: JSON.stringify({ model, input })
    });
    const taskId = String(data.data?.taskId || "");
    if (!taskId) throw new Error("Kie.ai 没有返回任务 ID。");
    return { taskId, model };
  }

  async function getRemoteTask(taskId) {
    const data = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    const details = data.data || {};
    return {
      state: String(details.state || "waiting"),
      progress: Math.max(0, Math.min(100, Number(details.progress || 0))),
      resultUrls: parseResultUrls(details.resultJson),
      error: String(details.failMsg || details.failCode || ""),
      creditsConsumed: Number(details.creditsConsumed || 0),
      completeTime: Number(details.completeTime || 0)
    };
  }

  async function createChat(prompt) {
    const data = await kieRequest("/gemini-3-5-flash-openai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        stream: false,
        include_thoughts: false,
        reasoning_effort: "medium"
      })
    });
    const text = extractChatText(data);
    if (!text) throw new Error("AI 对话没有返回文本内容。");
    return { text, model: "gemini-3.5-flash", creditsConsumed: Number(data.credits_consumed || 0) };
  }

  async function kieRequest(apiPath, init = {}) {
    const key = apiKey();
    if (!key) throw requestError("Kie.ai API Key 尚未配置，请先在心理学视频页面保存密钥。", 400);
    const response = await fetchImpl(`${BASE_URL}${apiPath}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw requestError(kieError(data, `Kie.ai 请求失败：HTTP ${response.status}`), response.status);
    if (typeof data.code === "number" && data.code !== 200 && String(data.msg || "").toLowerCase() !== "success") {
      throw new Error(kieError(data, "Kie.ai 请求失败。"));
    }
    return data;
  }

  function apiKey() {
    return String(process.env.KIE_API_KEY || readApiKey?.() || "").trim();
  }

  function saveTask(task) {
    const store = readStore(storePath);
    store.tasks = [task, ...store.tasks.filter((item) => item.id !== task.id)].slice(0, 100);
    writeStore(storePath, store);
    return publicTask(task);
  }

  return { getOverview, createTask, refreshTask };
}

function readStore(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { version: 1, tasks: Array.isArray(value.tasks) ? value.tasks : [] };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function writeStore(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function publicTask(task) {
  return {
    id: task.id,
    kind: task.kind,
    model: task.model,
    prompt: task.prompt,
    status: task.status,
    resultUrls: Array.isArray(task.resultUrls) ? task.resultUrls.filter(isHttpUrl) : [],
    resultText: String(task.resultText || ""),
    error: String(task.error || ""),
    progress: Number(task.progress || 0),
    creditsConsumed: Number(task.creditsConsumed || 0),
    createdAt: Number(task.createdAt || 0),
    updatedAt: Number(task.updatedAt || 0)
  };
}

function parseResultUrls(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed?.resultUrls) ? parsed.resultUrls.map(String).filter(isHttpUrl) : [];
  } catch {
    return [];
  }
}

function extractChatText(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  const parts = data.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim() : "";
}

function kieError(data, fallback) {
  const value = data?.msg || data?.message || data?.error || fallback;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
