import { kvGet } from "./kv.js";

export async function signalDesk(env, db, endpoint, options = {}) {
  const settings = await kvGet(db, "official-settings", {});
  const baseUrl = String(settings.baseUrl || env.SIGNAL_DESK_BASE_URL || "https://tiktokaitool.com").replace(/\/+$/, "");
  const apiKey = String(settings.apiKey || env.SIGNAL_DESK_BRIDGE_KEY || "").trim();
  if (!apiKey) throw Object.assign(new Error("请先在 TikTok 账号页配置主站桥接密钥。"), { statusCode: 400 });
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `主站返回 ${response.status}`), { statusCode: response.status });
  }
  return data;
}

// /api/v1/accounts is paged (id keyset). Walk every page so callers that
// need the whole fleet still get one merged list.
export async function signalDeskAllAccounts(env, db, { pageLimit = 500, maxPages = 20 } = {}) {
  const accounts = [];
  let cursor = "";
  let last = {};
  for (let page = 0; page < Math.max(1, maxPages); page += 1) {
    const params = new URLSearchParams({ limit: String(pageLimit) });
    if (cursor) params.set("cursor", cursor);
    last = await signalDesk(env, db, `/api/v1/accounts?${params}`);
    accounts.push(...(Array.isArray(last.accounts) ? last.accounts : []));
    if (!last.hasMore || !last.nextCursor || last.nextCursor === cursor) break;
    cursor = last.nextCursor;
  }
  return { ...last, accounts, hasMore: false, nextCursor: "" };
}
