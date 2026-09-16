const API_ROOT = "https://generativelanguage.googleapis.com";
export const GEMINI_VIDEO_MODEL = "gemini-3.8-flash";

function providerError(message, status = 502) {
  return Object.assign(new Error(message), { statusCode: status });
}

async function providerJson(response, action) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    const status = Number(response.status) || 502;
    throw providerError(`${action}失败（HTTP ${status}）：${detail}`, status);
  }
  return body;
}

export function createGeminiVideoClient({ apiKey, fetchImpl = fetch } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw providerError("Google Gemini API Key 未配置。", 503);
  const headers = { "x-goog-api-key": key };

  return {
    async upload({ body, size, mimeType, displayName }) {
      const start = await fetchImpl(`${API_ROOT}/upload/v1beta/files`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "x-goog-upload-protocol": "resumable",
          "x-goog-upload-command": "start",
          "x-goog-upload-header-content-length": String(size),
          "x-goog-upload-header-content-type": mimeType
        },
        body: JSON.stringify({ file: { display_name: displayName } })
      });
      if (!start.ok) await providerJson(start, "创建 Google 视频上传");
      const uploadUrl = start.headers.get("x-goog-upload-url");
      if (!uploadUrl) throw providerError("Google 未返回视频上传地址。");
      const uploaded = await fetchImpl(uploadUrl, {
        method: "POST",
        headers: {
          "content-length": String(size),
          "x-goog-upload-offset": "0",
          "x-goog-upload-command": "upload, finalize"
        },
        body
      });
      const data = await providerJson(uploaded, "上传视频到 Google");
      if (!data.file?.name || !data.file?.uri) throw providerError("Google 视频上传结果不完整。");
      return data.file;
    },

    async getFile(name) {
      const response = await fetchImpl(`${API_ROOT}/v1beta/${String(name).replace(/^\//, "")}`, { headers });
      return providerJson(response, "读取 Google 视频状态");
    },

    async analyze({ fileUri, mimeType, prompt }) {
      const response = await fetchImpl(`${API_ROOT}/v1beta/models/${GEMINI_VIDEO_MODEL}:generateContent`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { file_data: { file_uri: fileUri, mime_type: mimeType } },
            { text: prompt }
          ] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
        })
      });
      return providerJson(response, "Gemini 视频分析");
    },

    async removeFile(name) {
      const response = await fetchImpl(`${API_ROOT}/v1beta/${String(name).replace(/^\//, "")}`, {
        method: "DELETE",
        headers
      });
      if (!response.ok && response.status !== 404) await providerJson(response, "清理 Google 临时视频");
    }
  };
}

export function extractGeminiText(payload) {
  const text = (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) {
    const reason = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason || "未返回文本";
    throw providerError(`Gemini 视频分析没有生成结果：${reason}`);
  }
  return text;
}

export function usageFromGemini(payload) {
  const usage = payload?.usageMetadata || {};
  return {
    inputTokens: Number(usage.promptTokenCount || 0),
    outputTokens: Number(usage.candidatesTokenCount || 0)
  };
}
