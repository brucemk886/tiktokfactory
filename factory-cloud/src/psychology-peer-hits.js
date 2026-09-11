import { errorJson, json, randomToken, sha256Hex } from "./http.js";
import { importPsychologyPeerHits, listPsychologyPeerHits } from "./psychology-peer-hits-store.js";

export const PSYCHOLOGY_PEER_API = "/api/integrations/psychology/peer-hits";
const INTERNAL = "/api/psychology-peer-hits";
const reject = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };
async function readImport(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) reject("请使用 Content-Type: application/json。", 415);
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) reject("请求最多 1 MB。", 413);
  if (!request.body) reject("请提交 JSON 视频数据。", 400);
  const reader = request.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); reject("请求最多 1 MB。", 413); }
    chunks.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { reject("请求体不是有效 JSON。", 400); }
}
async function externalActor(request, db) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer (\S+)$/i)?.[1];
  if (!token || !token.startsWith("psy_hits_") || token.length > 200) reject("请提供同行爆款专用 Bearer API Key。", 401);
  const key = await db.prepare(`SELECT k.owner_id FROM psychology_peer_hit_keys k
    JOIN factory_users u ON u.id = k.owner_id WHERE k.token_hash = ? AND u.active = 1 AND u.role = 'admin'`)
    .bind(await sha256Hex(token)).first();
  if (!key) reject("API Key 无效、已停用或所属账号不可用。", 401);
  return key.owner_id;
}
export async function handlePsychologyPeerHits(request, env, url, session) {
  const external = url.pathname === PSYCHOLOGY_PEER_API;
  if (!external && url.pathname !== INTERNAL && !url.pathname.startsWith(INTERNAL + "/")) return null;
  try {
    const db = env.DB;
    if (external) {
      const actor = await externalActor(request, db);
      if (request.method !== "POST") return errorJson("此密钥仅支持 POST 写入同行爆款。", 405);
      return json(await importPsychologyPeerHits(db, await readImport(request), actor));
    }
    if (!session) return errorJson("请先登录。", 401);
    const user = session.user;
    if (user?.role !== "admin" || !user.sidebarModules?.includes("psychology-peer-hits")) return errorJson("没有心理学同行爆款权限。", 403);
    if (request.method !== "GET" && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return errorJson("不允许跨站修改。", 403);
    if (url.pathname === INTERNAL + "/api-key") {
      if (request.method === "GET") {
        const key = await db.prepare("SELECT token_prefix, created_at FROM psychology_peer_hit_keys WHERE owner_id = ?").bind(user.id).first();
        return json({ configured: Boolean(key), prefix: key?.token_prefix || "", createdAt: key?.created_at || null, endpoint: PSYCHOLOGY_PEER_API });
      }
      if (request.method === "POST") {
        const apiKey = "psy_hits_" + randomToken(32), createdAt = Date.now();
        await db.prepare(`INSERT INTO psychology_peer_hit_keys(owner_id,token_hash,token_prefix,created_at) VALUES(?,?,?,?)
          ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash,token_prefix=excluded.token_prefix,created_at=excluded.created_at`)
          .bind(user.id, await sha256Hex(apiKey), apiKey.slice(0, 18), createdAt).run();
        return json({ apiKey, createdAt, endpoint: PSYCHOLOGY_PEER_API }, 201);
      }
      if (request.method === "DELETE") {
        await db.prepare("DELETE FROM psychology_peer_hit_keys WHERE owner_id = ?").bind(user.id).run();
        return json({ ok: true });
      }
      return errorJson("不支持此请求方法。", 405);
    }
    if (url.pathname === INTERNAL) {
      if (request.method === "GET") return json(await listPsychologyPeerHits(db, url.searchParams));
      if (request.method === "POST") return json(await importPsychologyPeerHits(db, await readImport(request), user.id));
      return errorJson("不支持此请求方法。", 405);
    }
    return errorJson("没有找到该接口。", 404);
  } catch (error) {
    return errorJson(error.statusCode ? error.message : "同行爆款处理失败，请稍后重试。", error.statusCode || 500);
  }
}
