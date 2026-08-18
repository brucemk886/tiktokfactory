export async function requestAudioJob(url, body, { api, onProgress } = {}) {
  const request = api || defaultApi;
  const result = await request(url, {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (result.item || Array.isArray(result.items) || result.targetAudioDir) return result;
  if (!result.jobId) throw new Error(result.error || result.message || "音频任务未受理。");
  return waitForAudioJob(result.jobId, { api: request, onProgress });
}

export async function waitForAudioJob(jobId, options = {}) {
  return waitForCloudJob(jobId, options);
}

export async function waitForCloudJob(jobId, { api, onProgress, attempts = 270 } = {}) {
  const request = api || defaultApi;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const data = await request(`/api/audio-library/progress/${encodeURIComponent(jobId)}`);
    onProgress?.(data);
    if (data.status === "done") return { ...data.result, jobId, queued: true };
    if (["failed", "error", "cancelled", "canceled"].includes(String(data.status || ""))) {
      throw new Error(data.error || data.message || "工人机任务失败。");
    }
    await sleep(2000);
  }
  throw new Error("等待工人机超时。请确认本机工厂已启动。");
}

async function defaultApi(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
