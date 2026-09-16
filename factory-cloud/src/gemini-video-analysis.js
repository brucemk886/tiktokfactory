import { errorJson, json, now, safeId } from "./http.js";
import { GEMINI_VIDEO_MODEL } from "./gemini-video-client.js";

const BASE = "/api/gemini-video-analysis";
const MAX_BYTES = 500 * 1024 * 1024;
const VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo", "video/x-flv",
  "video/webm", "video/x-ms-wmv", "video/3gpp"
]);

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

export async function handleGeminiVideoAnalysis(request, env, url, session) {
  if (!session || (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`))) return null;
  if (session.user?.role !== "admin") return errorJson("仅管理员可以使用视频分析。", 403);
  try {
    await ensureGeminiVideoTable(env.DB);
    const suffix = decodeURIComponent(url.pathname.slice(BASE.length)).replace(/^\//, "");
    const [id, action] = suffix.split("/");
    if (request.method === "GET" && !id) {
      const rows = (await env.DB.prepare("SELECT * FROM factory_video_analyses WHERE owner_username=? ORDER BY created_at DESC LIMIT 50").bind(session.user.username).all()).results || [];
      return json({ tasks: rows.map(publicAnalysis), configured: configured(env), model: GEMINI_VIDEO_MODEL });
    }
    if (request.method === "GET" && id) {
      const row = await ownedRow(env.DB, id, session.user.username);
      if (!row) return errorJson("找不到该视频分析任务。", 404);
      return json({ task: publicAnalysis(row) });
    }
    if (request.method === "POST" && !id) {
      if (!configured(env)) return errorJson("Google 视频分析服务尚未配置完成。", 503);
      const input = await request.json().catch(() => fail("请提交有效 JSON。"));
      const prompt = String(input?.prompt || "").trim();
      const fileName = String(input?.fileName || "").trim().slice(0, 240);
      const mimeType = String(input?.mimeType || "").toLowerCase();
      const fileSize = Number(input?.fileSize || 0);
      if (prompt.length < 2 || prompt.length > 8000) fail("分析要求需为 2–8000 个字符。");
      if (!fileName) fail("请选择视频文件。");
      validateVideo(mimeType, fileSize);
      const stamp = now();
      const taskId = crypto.randomUUID();
      const r2Key = `gemini-video/${safeId(session.user.username)}/${taskId}/${safeId(fileName)}`;
      await env.DB.prepare(`INSERT INTO factory_video_analyses (
        id,owner_username,model,file_name,mime_type,file_size,prompt,status,progress,result_text,error,r2_key,google_file_name,input_tokens,output_tokens,created_at,updated_at,completed_at
      ) VALUES (?,?,?,?,?,?,?,'uploading',0,'','',?,'',0,0,?,?,0)`).bind(
        taskId, session.user.username, GEMINI_VIDEO_MODEL, fileName, mimeType, fileSize, prompt, r2Key, stamp, stamp
      ).run();
      return json({ task: publicAnalysis(await ownedRow(env.DB, taskId, session.user.username)), uploadUrl: `${BASE}/${taskId}/upload` }, 201);
    }
    if (request.method === "PUT" && id && action === "upload") {
      const row = await ownedRow(env.DB, id, session.user.username);
      if (!row) return errorJson("找不到该视频分析任务。", 404);
      if (row.status !== "uploading") return errorJson("这个任务已经上传或正在分析。", 409);
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (!request.body || (contentLength && contentLength !== Number(row.file_size))) return errorJson("上传文件大小与创建任务时不一致。", 400);
      validateVideo(row.mime_type, Number(row.file_size));
      const stored = await env.ARCHIVE.put(row.r2_key, request.body, {
        httpMetadata: { contentType: row.mime_type },
        customMetadata: { owner: session.user.username, analysisId: row.id, fileName: row.file_name }
      });
      if (Number(stored?.size || 0) !== Number(row.file_size)) {
        await env.ARCHIVE.delete(row.r2_key);
        return errorJson("上传文件不完整，请重新上传。", 400);
      }
      const stamp = now();
      await env.DB.prepare("UPDATE factory_video_analyses SET status='queued',progress=5,updated_at=? WHERE id=? AND owner_username=? AND status='uploading'").bind(stamp, id, session.user.username).run();
      try {
        await env.GEMINI_VIDEO_WORKFLOW.createBatch([{ id, params: { analysisId: id } }]);
      } catch {
        await env.DB.prepare("UPDATE factory_video_analyses SET status='fail',error=?,updated_at=?,completed_at=? WHERE id=?").bind("分析任务启动失败，请删除后重新上传。", stamp, stamp, id).run();
        await env.ARCHIVE.delete(row.r2_key);
        return errorJson("分析任务启动失败，请重新上传。", 503);
      }
      return json({ task: publicAnalysis(await ownedRow(env.DB, id, session.user.username)) }, 202);
    }
    if (request.method === "DELETE" && id && !action) {
      const row = await ownedRow(env.DB, id, session.user.username);
      if (!row) return errorJson("找不到该视频分析任务。", 404);
      if (!["success", "fail", "uploading"].includes(row.status)) return errorJson("任务正在分析，完成后才能删除。", 409);
      await env.ARCHIVE.delete(row.r2_key);
      await env.DB.prepare("DELETE FROM factory_video_analyses WHERE id=? AND owner_username=?").bind(id, session.user.username).run();
      return json({ deleted: true });
    }
    return errorJson("不支持这个视频分析请求。", 405);
  } catch (error) {
    return errorJson(error.message || "视频分析失败。", Number(error.statusCode || error.status) || 500);
  }
}

function configured(env) {
  return Boolean(String(env.GEMINI_API_KEY || "").trim() && env.GEMINI_VIDEO_WORKFLOW && env.ARCHIVE);
}

function validateVideo(mimeType, size) {
  if (!VIDEO_MIME_TYPES.has(String(mimeType || "").toLowerCase())) fail("仅支持 MP4、MPEG、MOV、AVI、FLV、WebM、WMV 或 3GP 视频。");
  if (!Number.isSafeInteger(size) || size < 1) fail("视频文件大小无效。");
  if (size > MAX_BYTES) fail("单个视频不能超过 500 MB。", 413);
}

async function ownedRow(db, id, owner) {
  return db.prepare("SELECT * FROM factory_video_analyses WHERE id=? AND owner_username=?").bind(String(id || ""), owner).first();
}

export function publicAnalysis(row) {
  return {
    id: row.id,
    kind: "analysis",
    model: row.model,
    fileName: row.file_name,
    fileSize: Number(row.file_size || 0),
    prompt: row.prompt,
    status: row.status,
    progress: Number(row.progress || 0),
    resultText: String(row.result_text || ""),
    error: String(row.error || ""),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0)
  };
}

export async function ensureGeminiVideoTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS factory_video_analyses (
    id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, model TEXT NOT NULL, file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0, result_text TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
    r2_key TEXT NOT NULL, google_file_name TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_factory_video_analyses_owner ON factory_video_analyses(owner_username,created_at DESC)").run();
}
