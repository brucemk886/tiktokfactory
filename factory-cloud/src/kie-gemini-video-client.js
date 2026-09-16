const KIE_API_ROOT = "https://api.kie.ai";
export const KIE_GEMINI_VIDEO_MODEL = "gemini-3-8-flash";
const KIE_GEMINI_VIDEO_PATH = "/gemini-3-8-flash-openai/v1/chat/completions";

function providerError(message, status = 502) {
  return Object.assign(new Error(message), { statusCode: status });
}

export function createKieGeminiVideoClient({ apiKey, fetchImpl = fetch } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw providerError("Kie.ai API Key 尚未配置，无法启用视频分析兜底。", 503);

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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || data?.msg || `HTTP ${response.status}`;
        throw providerError(`Kie Gemini 视频分析失败：${detail}`, response.status);
      }
      const content = data?.choices?.[0]?.message?.content;
      const text = typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n\n").trim()
          : "";
      if (!text) throw providerError("Kie Gemini 视频分析没有返回文本。", 502);
      return {
        text,
        inputTokens: Number(data?.usage?.prompt_tokens || 0),
        outputTokens: Number(data?.usage?.completion_tokens || 0),
        creditsConsumed: Number(data?.credits_consumed || data?.creditsConsumed || 0)
      };
    }
  };
}
