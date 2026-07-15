import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API_TIMEOUT_MS = 45 * 1000;
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export class GeeLarkClient {
  constructor({ apiBaseUrl, appId, apiKey }) {
    this.apiBaseUrl = String(apiBaseUrl || "https://openapi.geelark.cn").replace(/\/+$/, "");
    this.appId = String(appId || "");
    this.apiKey = String(apiKey || "");
  }

  isConfigured() {
    return Boolean(this.appId && this.apiKey);
  }

  async listPhones({ page = 1, pageSize = 100 } = {}) {
    return this.post("/open/v1/phone/list", { page, pageSize });
  }

  async createTikTokVideoTasks({ envIds, videoUrl, videoDesc = "", scheduleAt, planName, maxTryTimes = 1 }) {
    const safeEnvIds = Array.from(new Set((envIds || []).map(String).filter(Boolean)));
    if (!safeEnvIds.length) throw new Error("请选择至少一个 GeeLark 云手机账号。");
    if (!videoUrl) throw new Error("缺少 GeeLark 视频资源地址。");

    const runAt = Number(scheduleAt) || Math.floor(Date.now() / 1000);
    return this.post("/open/v1/task/add", {
      planName: planName || `podcast-${Date.now()}`,
      taskType: 1,
      list: safeEnvIds.map((envId) => ({
        envId,
        scheduleAt: runAt,
        video: videoUrl,
        videoDesc: String(videoDesc || "").slice(0, 4000),
        maxTryTimes: Math.max(1, Math.min(2, Number(maxTryTimes) || 1)),
        timeoutMin: 30,
        needShareLink: true
      }))
    });
  }

  async queryTask(taskId) {
    return this.post("/open/v1/task/query", { taskId });
  }

  async historyRecords({ size = 100, lastId, ids } = {}) {
    const payload = { size };
    if (lastId) payload.lastId = String(lastId);
    if (Array.isArray(ids) && ids.length) payload.ids = ids.map(String).filter(Boolean).slice(0, 100);
    return this.post("/open/v1/task/historyRecords", payload);
  }

  async uploadTemporaryFile(filePath) {
    const fileType = path.extname(filePath).replace(/^\./, "").toLowerCase() || "mp4";
    const uploadInfo = await this.post("/open/v1/upload/getUrl", { fileType });
    const uploadUrl = uploadInfo?.uploadUrl || uploadInfo?.data?.uploadUrl;
    const resourceUrl = uploadInfo?.resourceUrl || uploadInfo?.data?.resourceUrl;
    if (!uploadUrl || !resourceUrl) {
      throw new Error("GeeLark 没有返回有效的上传地址。");
    }

    const uploadResponse = await fetchWithTimeout(uploadUrl, {
      method: "PUT",
      body: fs.createReadStream(filePath),
      duplex: "half"
    }, UPLOAD_TIMEOUT_MS, "GeeLark 文件上传");
    if (!uploadResponse.ok) {
      const message = await uploadResponse.text().catch(() => "");
      throw new Error(`GeeLark 文件上传失败：${message || uploadResponse.status}`);
    }

    return { resourceUrl, uploadUrl };
  }

  async post(apiPath, body = {}) {
    if (!this.isConfigured()) throw new Error("GeeLark App ID 或 API Key 未配置。");
    const headers = this.buildHeaders();
    const response = await fetchWithTimeout(`${this.apiBaseUrl}${apiPath}`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }, API_TIMEOUT_MS, `GeeLark 接口 ${apiPath}`);

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(`GeeLark 请求失败：${response.status} ${text.slice(0, 500)}`);
      error.geelarkResponseReceived = true;
      error.httpStatus = response.status;
      throw error;
    }
    if (data.code && data.code !== 0) {
      const error = new Error(`GeeLark 返回错误 ${data.code}：${data.msg || JSON.stringify(data.data || {})}`);
      error.geelarkResponseReceived = true;
      error.geelarkCode = data.code;
      throw error;
    }
    return data.data ?? data;
  }

  buildHeaders() {
    const traceId = crypto.randomUUID();
    const ts = String(Date.now());
    const nonce = traceId.slice(0, 6);
    const sign = crypto
      .createHash("sha256")
      .update(`${this.appId}${traceId}${ts}${nonce}${this.apiKey}`)
      .digest("hex")
      .toUpperCase();

    return {
      appId: this.appId,
      traceId,
      ts,
      nonce,
      sign
    };
  }
}

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label}请求超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createGeeLarkClient(config) {
  return new GeeLarkClient(config?.geelark || {});
}
