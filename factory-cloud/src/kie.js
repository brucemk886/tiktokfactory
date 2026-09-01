const BASE_URL = "https://api.kie.ai";

const IMAGE_MODELS = {
  grok: "grok-imagine/text-to-image",
  "nano-banana": "google/nano-banana"
};

export function createKieClient({ apiKey, fetchImpl = fetch } = {}) {
  function requireKey() {
    const value = String(apiKey || "").trim();
    if (!value) throw Object.assign(new Error("Kie.ai API Key 尚未配置。"), { statusCode: 400 });
    return value;
  }

  async function kieRequest(path, init = {}) {
    const response = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
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
    const requestedImageModel = String(options.imageModel || "grok");
    const model = kind === "image"
      ? IMAGE_MODELS[requestedImageModel] || IMAGE_MODELS.grok
      : "grok-imagine/text-to-video";
    const imagePrompt = options.noImageText === false
      ? prompt
      : `${prompt}\n\nMANDATORY OUTPUT RULE: Create visuals only. Do not render any visible text, captions, titles, labels, letters, numbers, logos, watermarks, subtitles, signs, interface elements, or typography anywhere in the image. If the concept mentions words or labels, express them only through imagery. Leave clean visual space so text can be added later in post-production.`;
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

  return { getKieCredits, createKieMediaTask, getKieTask };
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
