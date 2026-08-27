export function novelAudioObjectKey(audioId) {
  const id = String(audioId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  return id ? `novel-audio/${id}.mp3` : "";
}

export async function putNovelAudio(env, audioId, body, contentType = "audio/mpeg") {
  const key = novelAudioObjectKey(audioId);
  if (!key) throw Object.assign(new Error("音频 ID 无效。"), { statusCode: 400 });
  if (!env?.ARCHIVE) throw Object.assign(new Error("工厂未绑定音频存储。"), { statusCode: 501 });
  const type = /^audio\//i.test(String(contentType || "")) ? String(contentType) : "audio/mpeg";
  await env.ARCHIVE.put(key, body, {
    httpMetadata: { contentType: type }
  });
  return { ok: true, audioId: key.slice("novel-audio/".length, -4), key };
}

export async function copyNovelAudio(env, fromId, toId) {
  const fromKey = novelAudioObjectKey(fromId);
  const toKey = novelAudioObjectKey(toId);
  if (!fromKey || !toKey) throw Object.assign(new Error("音频 ID 无效。"), { statusCode: 400 });
  if (!env?.ARCHIVE) throw Object.assign(new Error("工厂未绑定音频存储。"), { statusCode: 501 });
  const object = await env.ARCHIVE.get(fromKey);
  if (!object) throw Object.assign(new Error("没有这份爆款音频。"), { statusCode: 404 });
  await env.ARCHIVE.put(toKey, object.body, {
    httpMetadata: { contentType: object.httpMetadata?.contentType || "audio/mpeg" }
  });
  return { ok: true, audioId: toId, key: toKey, size: Number(object.size) || 0 };
}

export async function serveNovelAudio(env, audioId, request) {
  const key = novelAudioObjectKey(audioId);
  if (!key || !env?.ARCHIVE) return null;
  const range = request?.headers?.get("range") || request?.headers?.get("Range") || "";
  const object = range
    ? await env.ARCHIVE.get(key, { range: request.headers })
    : await env.ARCHIVE.get(key);
  if (!object) return null;
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || "audio/mpeg");
  headers.set("cache-control", "private, max-age=3600");
  headers.set("accept-ranges", "bytes");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  if (object.range) {
    const offset = Number(object.range.offset) || 0;
    const length = Number(object.range.length) || Number(object.size) || 0;
    const end = Math.max(offset, offset + length - 1);
    const total = Number(object.size) || end + 1;
    headers.set("content-range", `bytes ${offset}-${end}/${total}`);
    headers.set("content-length", String(length || Math.max(0, end - offset + 1)));
    return new Response(object.body, { status: 206, headers });
  }
  if (object.size != null) headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
