import { errorJson, hex, json } from "./http.js";
import { getProfile } from "./auth.js";

export async function handleGeeLark(request, env, url, session) {
  if (!session) return null;
  const pathname = url.pathname;
  const method = request.method;

  if (method === "GET" && pathname === "/api/geelark/phones") {
    const profile = await getProfile(env.DB, session.user.geelarkProfileId);
    if (!profile?.app_id || !profile?.api_key) return json({ configured: false, phones: [] });
    try {
      const data = await geelarkPost(profile, "/open/v1/phone/list", { page: 1, pageSize: 100 });
      const phones = Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []);
      return json({ configured: true, phones });
    } catch (error) {
      return errorJson(error.message || "读取 GeeLark 云手机失败。", 502);
    }
  }

  if (method === "GET" && pathname === "/api/geelark/safety") {
    return json({ ok: true, cloud: true, message: "GeeLark 安全检查在云端仅做配置校验。" });
  }

  return null;
}

async function geelarkPost(profile, apiPath, body) {
  const appId = String(profile.app_id || "");
  const apiKey = String(profile.api_key || "");
  const base = String(profile.api_base_url || "https://openapi.geelark.cn").replace(/\/+$/, "");
  const traceId = crypto.randomUUID();
  const ts = String(Date.now());
  const nonce = traceId.slice(0, 6);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${appId}${traceId}${ts}${nonce}${apiKey}`));
  const sign = hex(new Uint8Array(digest)).toUpperCase();
  const response = await fetch(`${base}${apiPath}`, {
    method: "POST",
    headers: {
      appId,
      traceId,
      ts,
      nonce,
      sign,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || `GeeLark 请求失败：${response.status}`);
  if (data.code && data.code !== 0) throw new Error(`GeeLark 返回错误 ${data.code}：${data.msg || ""}`);
  return data.data ?? data;
}
