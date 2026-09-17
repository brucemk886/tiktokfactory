import { buildKieVideoTaskInput } from "../../scripts/kie-video-models.js";
import { buildKieImageTaskInput, KIE_IMAGE_MODELS } from "../../scripts/kie-image-models.js";

const BASE_URL = "https://api.kie.ai";
const IMAGE_MODELS = KIE_IMAGE_MODELS;

export function createKieClient({ apiKey, fetchImpl = fetch } = {}) {
  function requireKey() {
    const value = String(apiKey || "").trim();
    if (!value) throw Object.assign(new Error("Kie.ai API Key 尚未配置。"), { statusCode: 400 });
    return value;
  }

  async function kieRequest(path, init = {}) {
    const response = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      signal: init.signal || AbortSignal.timeout(90000),
      headers: {
        Authorization: `Bearer ${requireKey()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(kieError(data, `Kie.ai 请求失败：HTTP ${response.status}`)), { statusCode: response.status });
    if (typeof data.code === "number" && data.code !== 200 && String(data.msg || "").toLowerCase() !== "success") {
      throw new Error(kieError(data, "Kie.ai 请求失败。"));
    }
    return data;
  }

  async function getKieCredits() {
    const data = await kieRequest("/api/v1/chat/credit");
    return Number(data.data || 0);
  }

  async function createKieMediaTask(kind, prompt, options = {}) {
    const imageTask = kind === "image"
      ? buildKieImageTaskInput({
        imageModel: options.imageModel || "grok",
        prompt,
        aspectRatio: options.aspectRatio,
        noImageText: options.noImageText
      })
      : null;
    const { model, input } = imageTask || buildKieVideoTaskInput({ ...options, prompt });
    const data = await kieRequest("/api/v1/jobs/createTask", {
      method: "POST",
      body: JSON.stringify({ model, input })
    });
    const taskId = String(data.data?.taskId || "");
    if (!taskId) throw new Error("Kie.ai 未返回任务 ID。");
    return { taskId, model };
  }

  async function getKieTask(taskId) {
    const data = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    const details = data.data || {};
    return {
      taskId: String(details.taskId || taskId),
      state: String(details.state || "waiting"),
      progress: Math.max(0, Math.min(100, Number(details.progress || 0))),
      resultUrls: parseResultUrls(details.resultJson),
      error: String(details.failMsg || details.failCode || ""),
      creditsConsumed: Math.round(Number(details.creditsConsumed || 0) * 1000),
      completeTime: Number(details.completeTime || 0)
    };
  }

  async function createChatCompletion(prompt, { model = 'gemini-3-8-flash', imageUrls = [] } = {}) {
    const paths = {
      'gemini-3-5-flash': '/gemini-3-5-flash-openai/v1/chat/completions',
      'gemini-3-8-flash': '/gemini-3-8-flash-openai/v1/chat/completions'
    };
    if (!paths[model]) throw new Error('不支持的 Kie 对话模型。');
    const images = imageUrls.map(value => String(value || '').trim());
    if (images.length > 35 || images.some(value => !/^https:\/\/[^\s]+$/i.test(value))) throw new Error('多模态图片地址无效。');
    const data = await kieRequest(paths[model], {
      method: 'POST',
      signal: AbortSignal.timeout(15 * 60 * 1000),
      body: JSON.stringify({ messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        ...images.map(url => ({ type: 'image_url', image_url: { url } }))
      ] }], stream: false, include_thoughts: false, reasoning_effort: 'medium' })
    });
    const payload = Array.isArray(data?.choices) ? data : data?.data || data;
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text || '').join('') : '';
    if (!text.trim()) throw new Error('AI 文案服务没有返回内容。');
    return {
      text,
      model,
      creditsConsumed: Number(data?.credits_consumed ?? payload?.credits_consumed ?? 0) || 0
    };
  }

  async function createChat(prompt, options = {}) {
    return (await createChatCompletion(prompt, options)).text;
  }

  return { getKieCredits, createKieMediaTask, getKieTask, createChat, createChatCompletion };
}

export { IMAGE_MODELS };

function parseResultUrls(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const urls = parsed?.resultUrls;
    return Array.isArray(urls) ? urls.map(String).filter((item) => /^https?:\/\//i.test(item)) : [];
  } catch {
    return [];
  }
}

function kieError(data, fallback) {
  return String(data?.msg || data?.message || data?.error || fallback);
}
