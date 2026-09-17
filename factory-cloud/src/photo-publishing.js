import { errorJson, json, readJson } from "./http.js";
import { signalDesk, signalDeskBinary } from "./signal-desk.js";

const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/webp"]);
const PHOTO_ASSET_KEY = /^(temporary--)?[0-9a-f-]{36}\.(jpg|jpeg|webp)$/i;
const PHOTO_PRIVACY_LEVELS = new Set(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]);

export async function handlePhotoPublishing(request, env, url, session, assertAccess) {
  if (!session) return null;
  if (request.method === "POST" && url.pathname === "/api/official-tiktok/photo-assets/import") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以生成并导入图片。", 403);
    try {
      return json(await importGeneratedPhoto(env, env.DB, session.user, await readJson(request)), 201);
    } catch (error) {
      return errorJson(error.message || "导入生成图片失败。", error.statusCode || 400);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/official-tiktok/photo-publish") {
    try {
      const payload = normalizePhotoPublishPayload(await readJson(request));
      await assertAccess(env, session.user, { module: payload.module, connectionIds: [payload.connectionId] });
      const batch = await signalDesk(env, env.DB, "/api/v1/publish/batches", { method: "POST", body: buildPhotoBatchRequest(payload) });
      return json({
        accepted: true,
        batchId: batch.batch?.id || "",
        duplicate: batch.duplicate === true,
        message: batch.duplicate ? "这组图片已经提交，请到官方发布记录查看。" : "图片帖子已提交，主站会按排期调用 TikTok 官方图文接口。"
      }, batch.duplicate ? 200 : 202);
    } catch (error) {
      return errorJson(error.message || "创建图文发布任务失败。", error.statusCode || 400);
    }
  }
  return null;
}

export async function importGeneratedPhoto(env, db, user, input = {}) {
  const generationId = String(input.generationId || "").trim();
  const peerJobId = String(input.peerJobId || '').trim();
  const resultIndex = Number(input.resultIndex || 0);
  if ((!generationId && !peerJobId) || (generationId && peerJobId) || !Number.isInteger(resultIndex) || resultIndex < 0) throw statusError("生成图片编号无效。", 400);
  let sourceUrl;
  if (peerJobId) {
    if (!user.sidebarModules?.includes('psychology-peer-hits') || !user.sidebarModules?.includes('psychology-photo')) throw statusError('没有这组图文的访问权限。', 403);
    const job = await db.prepare("SELECT result_json FROM factory_jobs WHERE id = ? AND created_by = ? AND type = 'psychology-photo-story' AND status = 'done'").bind(peerJobId, user.username).first();
    if (!job) throw statusError('图文任务不存在或尚未全部生成完成。', 404);
    const result = JSON.parse(job.result_json || '{}').results?.[resultIndex];
    if (!result || result.imageModel !== 'z-image') throw statusError('这页生成图片不存在。', 404);
    sourceUrl = result.imageUrl;
  } else {
    const row = await db.prepare(`
      SELECT id, model, status, result_urls_json
      FROM factory_ai_generations
      WHERE id = ? AND owner_username = ?
    `).bind(generationId, user.username).first();
    if (!row || row.model !== "z-image" || row.status !== "success") throw statusError("这张 Z-Image 图片不存在或尚未生成完成。", 404);
    const urls = parseStringArray(row.result_urls_json);
    sourceUrl = urls[resultIndex] || "";
  }
  if (!/^https:\/\//i.test(sourceUrl)) throw statusError("生成图片地址无效。", 400);
  const response = await (env.fetch || fetch)(sourceUrl, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!response.ok) throw statusError(`读取生成图片失败：HTTP ${response.status}`, 502);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (!PHOTO_CONTENT_TYPES.has(contentType)) throw statusError("Z-Image 返回的图片不是 TikTok 支持的 JPG 或 WebP。", 415);
  if (declaredSize > PHOTO_MAX_BYTES) throw statusError("生成图片超过 TikTok 20 MB 限制。", 413);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > PHOTO_MAX_BYTES) throw statusError("生成图片为空或超过 TikTok 20 MB 限制。", 413);
  const extension = contentType === "image/webp" ? "webp" : "jpg";
  return signalDeskBinary(env, db, "/api/v1/publish/assets", {
    body: bytes,
    contentType,
    fileName: `psychology-z-image-${generationId || peerJobId}-${resultIndex}.${extension}`,
    fileSize: bytes.byteLength
  });
}

export function normalizePhotoPublishPayload(input = {}, now = Date.now()) {
  const module = String(input.module || "psychology").trim();
  if (module !== "psychology") throw statusError("图文模板只能发布心理学项目内容。", 400);
  const connectionId = String(input.connectionId || "").trim();
  if (!connectionId) throw statusError("请先选择发布账号。", 400);
  const assets = Array.isArray(input.assets) ? input.assets.map((asset) => ({
    assetKey: String(asset?.assetKey || "").trim(),
    fileName: String(asset?.fileName || "image").slice(0, 180),
    contentType: String(asset?.contentType || "").split(";")[0].toLowerCase(),
    fileSize: Math.max(0, Number(asset?.fileSize || 0) || 0)
  })) : [];
  if (!assets.length || assets.length > 6 || assets.some((asset) => !PHOTO_ASSET_KEY.test(asset.assetKey) || !PHOTO_CONTENT_TYPES.has(asset.contentType) || !asset.fileSize || asset.fileSize > PHOTO_MAX_BYTES)) throw statusError("每条图片帖子需要 1–6 张已导入的 JPG 或 WebP 图片。", 400);
  if (new Set(assets.map((asset) => asset.assetKey)).size !== assets.length) throw statusError("图集中不能重复使用同一张图片。", 400);
  const title = String(input.title || "");
  const caption = String(input.caption || "");
  if (title.length > 90 || caption.length > 4000) throw statusError("图片标题最多 90 个字符，文案最多 4000 个字符。", 400);
  const privacyLevel = String(input.privacyLevel || "PUBLIC_TO_EVERYONE");
  if (!PHOTO_PRIVACY_LEVELS.has(privacyLevel)) throw statusError("图片帖子的可见范围无效。", 400);
  const photoCoverIndex = Number(input.photoCoverIndex || 0);
  if (!Number.isInteger(photoCoverIndex) || photoCoverIndex < 0 || photoCoverIndex >= assets.length) throw statusError("图集封面无效。", 400);
  const musicSoundId = input.musicSoundId === undefined ? "" : String(input.musicSoundId).trim();
  if (musicSoundId && !/^\d{1,30}$/.test(musicSoundId)) throw statusError("音乐 ID 无效。", 400);
  const scheduleAt = Math.max(0, Number(input.scheduleAt || 0) || 0);
  if (!Number.isSafeInteger(scheduleAt) || scheduleAt > now + 14 * 86400000) throw statusError("发布时间不能超过未来 14 天。", 400);
  const requestId = String(input.requestId || crypto.randomUUID()).trim().slice(0, 100);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw statusError("提交编号无效，请刷新后重试。", 400);
  return { module, connectionId, assets, title, caption, privacyLevel, photoCoverIndex, musicSoundId, autoAddMusic: !musicSoundId && input.autoAddMusic === true, disableComment: input.disableComment === true, scheduleAt, requestId };
}

export function buildPhotoBatchRequest(payload) {
  const assetKeys = payload.assets.map((asset) => asset.assetKey);
  return {
    externalId: `local-factory-photo-${payload.requestId}`,
    name: "心理学图文发布",
    items: [{
      externalRef: `${payload.requestId}:0`, connectionId: payload.connectionId,
      assetKey: assetKeys[0], photoAssetKeys: assetKeys,
      fileName: payload.title || `心理学图片帖子 · ${assetKeys.length} 张`,
      contentType: payload.assets[0].contentType,
      fileSize: payload.assets.reduce((sum, asset) => sum + asset.fileSize, 0),
      scheduleAt: payload.scheduleAt,
      postInfo: {
        title: payload.title, caption: payload.caption, privacyLevel: payload.privacyLevel,
        photoCoverIndex: payload.photoCoverIndex, disableComment: payload.disableComment,
        autoAddMusic: payload.autoAddMusic,
        ...(payload.musicSoundId ? { musicSoundId: payload.musicSoundId } : {})
      }
    }]
  };
}

function parseStringArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function statusError(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }
