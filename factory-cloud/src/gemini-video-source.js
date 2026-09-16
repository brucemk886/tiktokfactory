import { errorJson } from "./http.js";

export const GEMINI_VIDEO_SOURCE_PATH = "/api/integrations/gemini-video-source/";
const MAX_URL_LIFETIME_SECONDS = 2 * 60 * 60;

export async function createGeminiVideoSourceUrl({ baseUrl, analysisId, secret, expiresAt }) {
  const id = String(analysisId || "").trim();
  const key = String(secret || "").trim();
  const expires = Math.floor(Number(expiresAt || 0) / 1000);
  if (!id || !key || !Number.isSafeInteger(expires)) throw new Error("无法创建 Kie 视频读取地址。");
  const signature = await hmacHex(key, `${id}.${expires}`);
  return `${String(baseUrl || "").replace(/\/$/, "")}${GEMINI_VIDEO_SOURCE_PATH}${encodeURIComponent(id)}?expires=${expires}&signature=${signature}`;
}

export async function handleGeminiVideoSource(request, env, url, now = Date.now()) {
  if (!url.pathname.startsWith(GEMINI_VIDEO_SOURCE_PATH)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return errorJson("仅支持读取视频。", 405);
  const id = decodeURIComponent(url.pathname.slice(GEMINI_VIDEO_SOURCE_PATH.length));
  const expires = Number(url.searchParams.get("expires") || 0);
  const signature = String(url.searchParams.get("signature") || "").toLowerCase();
  const nowSeconds = Math.floor(now / 1000);
  const secret = String(env.KIE_API_KEY || "").trim();
  if (!id || !secret || !Number.isSafeInteger(expires) || expires < nowSeconds || expires > nowSeconds + MAX_URL_LIFETIME_SECONDS) {
    return errorJson("视频读取地址无效或已过期。", 401);
  }
  const expected = await hmacHex(secret, `${id}.${expires}`);
  if (!constantTimeEqual(signature, expected)) return errorJson("视频读取地址签名无效。", 401);
  const row = await env.DB.prepare("SELECT r2_key,mime_type,file_size,status FROM factory_video_analyses WHERE id=?").bind(id).first();
  if (!row || !["queued", "processing"].includes(row.status)) return errorJson("视频已不存在。", 404);
  if (request.method === "HEAD") {
    const object = await env.ARCHIVE.head(row.r2_key);
    if (!object) return errorJson("视频已不存在。", 404);
    return new Response(null, { status: 200, headers: sourceHeaders(row.mime_type, Number(object.size || row.file_size || 0)) });
  }
  const range = request.headers.get("range") || "";
  const object = range ? await env.ARCHIVE.get(row.r2_key, { range: request.headers }) : await env.ARCHIVE.get(row.r2_key);
  if (!object?.body) return errorJson("视频已不存在。", 404);
  const headers = sourceHeaders(row.mime_type, Number(object.size || row.file_size || 0));
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  // R2 may include full-object range metadata even without a Range request.
  if (range && object.range) {
    const offset = Number(object.range.offset || 0);
    const length = Number(object.range.length || 0);
    const total = Number(object.size || row.file_size || offset + length);
    headers.set("content-range", `bytes ${offset}-${Math.max(offset, offset + length - 1)}/${total}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

function sourceHeaders(mimeType, size) {
  const headers = new Headers({
    "content-type": String(mimeType || "application/octet-stream"),
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff"
  });
  if (size > 0) headers.set("content-length", String(size));
  return headers;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}
