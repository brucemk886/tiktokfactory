const KIE_API_ROOT = "https://api.kie.ai";
export const KIE_GEMINI_VIDEO_MODEL = "gemini-3-8-flash";
const KIE_GEMINI_VIDEO_PATH = "/gemini-3-8-flash-openai/v1/chat/completions";

function providerError(message, status = 502) {
  return Object.assign(new Error(message), { statusCode: status });
}

export function createKieGeminiVideoClient({ apiKey, fetchImpl = fetch } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw providerError("Kie.ai API Key 尚未配置，无法进行视频分析。", 503);

  return {
    async analyze({ videoUrl, prompt }) {
      const response = await fetchImpl(`${KIE_API_ROOT}${KIE_GEMINI_VIDEO_PATH}`, {
        method: "POST",
        signal: AbortSignal.timeout(15 * 60 * 1000),
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: videoUrl } }
            ]
          }],
          stream: false,
          include_thoughts: false,
          reasoning_effort: "medium"
        })
      });
      const data = await readProviderJson(response);
      const code = Number(data?.code || data?.statusCode || 0);
      if (!response.ok || data?.error || code >= 400) {
        const detail = data?.error?.message || (typeof data?.error === "string" ? data.error : "") || data?.message || data?.msg || `HTTP ${response.status}`;
        throw providerError(`Kie Gemini 视频分析失败：${safeDetail(detail, key)}`, response.ok ? (code >= 400 && code <= 599 ? code : 502) : response.status);
      }
      const payload = Array.isArray(data?.choices) ? data : data?.data || data;
      const content = payload?.choices?.[0]?.message?.content;
      const text = typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n\n").trim()
          : "";
      if (!text) {
        const diagnostic = {
          event: "kie-video-empty-response",
          status: response.status,
          contentType: response.headers.get("content-type"),
          code: Number.isFinite(code) ? code : null,
          keys: Object.keys(data || {}).slice(0, 15),
          choiceCount: Array.isArray(payload?.choices) ? payload.choices.length : 0,
          finishReason: safeDetail(payload?.choices?.[0]?.finish_reason || "", key)
        };
        console.warn(JSON.stringify(diagnostic));
        const detail = data?.message || data?.msg || payload?.choices?.[0]?.finish_reason || "空响应";
        throw providerError(`Kie Gemini 视频分析没有返回文本：${safeDetail(detail, key)}。`, 502);
      }
      return {
        text,
        inputTokens: Number(payload?.usage?.prompt_tokens || 0),
        outputTokens: Number(payload?.usage?.completion_tokens || 0),
        creditsConsumed: Number(data?.credits_consumed || data?.creditsConsumed || 0)
      };
    }
  };
}


function safeDetail(value, key) {
  return String(value || "").split(key).join("[redacted]").replace(/https?:\/\/[^\s"<>]+/gi, "[url]").slice(0, 500);
}

async function readProviderJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw providerError(`Kie 视频分析返回空响应（HTTP ${response.status}）。`);
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw providerError("Kie 视频分析响应超过大小限制。");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); }
    catch { throw providerError(`Kie 视频分析返回无效 JSON（HTTP ${response.status}，${String(response.headers.get("content-type") || "unknown").slice(0, 80)}）。`, response.ok ? 502 : response.status); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
