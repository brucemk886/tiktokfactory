import { errorJson, json, readJson } from "./http.js";
import { mergeAndStorePublishRecords } from "./publish-records-store.js";
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
  if (request.method === "POST" && url.pathname === "/api/official-tiktok/photo-assets/upload") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以上传图片卡片。", 403);
    try {
      return json(await importRenderedPhoto(env, env.DB, await readJson(request)), 201);
    } catch (error) {
      return errorJson(error.message || "上传文字卡片失败。", error.statusCode || 400);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/official-tiktok/stock-photos") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以搜索素材图。", 403);
    try {
      return json(await searchStockPhotos(env, url.searchParams));
    } catch (error) {
      return errorJson(error.message || "搜索素材图失败。", error.statusCode || 400);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/official-tiktok/generated-photos/file") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以读取生成图片。", 403);
    try {
      return await proxyGeneratedPhoto(env, env.DB, session.user, url.searchParams);
    } catch (error) {
      return errorJson(error.message || "读取生成图片失败。", error.statusCode || 400);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/official-tiktok/stock-photos/file") {
    if (session.user?.role !== "admin") return errorJson("仅管理员可以读取素材图。", 403);
    try {
      return proxyStockPhoto(env, url.searchParams.get("url"));
    } catch (error) {
      return errorJson(error.message || "读取素材图失败。", error.statusCode || 400);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/official-tiktok/photo-publish") {
    try {
      const payload = normalizePhotoPublishPayload(await readJson(request));
      await assertAccess(env, session.user, { module: payload.module, connectionIds: [payload.connectionId] });
      const batch = await signalDesk(env, env.DB, "/api/v1/publish/batches", { method: "POST", body: buildPhotoBatchRequest(payload) });
      const record = buildPhotoPublishRecord(payload, batch);
      try {
        await mergeAndStorePublishRecords(env.DB, [record]);
      } catch (error) {
        console.error("photo-publish-record", error?.message || error);
      }
      return json({
        accepted: true,
        batchId: batch.batch?.id || record.batchId || "",
        recordId: record.id,
        duplicate: batch.duplicate === true,
        message: batch.duplicate ? "这组图片已经提交，请到官方发布记录查看。" : "图片帖子已提交，请到官方发布记录查看进度。"
      }, batch.duplicate ? 200 : 202);
    } catch (error) {
      return errorJson(error.message || "创建图文发布任务失败。", error.statusCode || 400);
    }
  }
  return null;
}

export async function loadGeneratedPhoto(env, db, user, input = {}) {
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
  return { bytes, contentType, generationId, peerJobId, resultIndex };
}

export async function importGeneratedPhoto(env, db, user, input = {}) {
  const photo = await loadGeneratedPhoto(env, db, user, input);
  const extension = photo.contentType === "image/webp" ? "webp" : "jpg";
  return signalDeskBinary(env, db, "/api/v1/publish/assets", {
    body: photo.bytes,
    contentType: photo.contentType,
    fileName: `psychology-z-image-${photo.generationId || photo.peerJobId}-${photo.resultIndex}.${extension}`,
    fileSize: photo.bytes.byteLength
  });
}

export async function proxyGeneratedPhoto(env, db, user, params) {
  const photo = await loadGeneratedPhoto(env, db, user, {
    generationId: params.get("generationId"),
    resultIndex: params.get("resultIndex"),
  });
  return new Response(photo.bytes, {
    status: 200,
    headers: {
      "content-type": photo.contentType,
      "cache-control": "private, max-age=60",
    },
  });
}

export async function importRenderedPhoto(env, db, input = {}) {
  const { bytes, contentType } = decodeRenderedPhoto(input);
  const extension = contentType === "image/webp" ? "webp" : "jpg";
  const fileName = String(input.fileName || `psychology-text-card.${extension}`).replace(/[^\w.-]+/g, "-").slice(0, 180);
  return signalDeskBinary(env, db, "/api/v1/publish/assets", {
    body: bytes,
    contentType,
    fileName: fileName.endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`,
    fileSize: bytes.byteLength
  });
}

export function decodeRenderedPhoto(input = {}) {
  const raw = String(input.imageBase64 || input.dataUrl || "").trim();
  if (!raw) throw statusError("请先生成文字卡片。", 400);
  const dataUrl = raw.match(/^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  const declared = String(input.contentType || "").split(";")[0].trim().toLowerCase();
  const contentType = dataUrl ? dataUrl[1].toLowerCase() : declared;
  if (!PHOTO_CONTENT_TYPES.has(contentType)) throw statusError("文字卡片必须是 TikTok 支持的 JPG 或 WebP。", 415);
  const bytes = decodeBase64(dataUrl ? dataUrl[2] : raw);
  if (!bytes.byteLength || bytes.byteLength > PHOTO_MAX_BYTES) throw statusError("文字卡片为空或超过 TikTok 20 MB 限制。", 413);
  if (!looksLikePhotoBytes(bytes, contentType)) throw statusError("文字卡片文件损坏，请重新生成。", 400);
  return { bytes, contentType };
}

function decodeBase64(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean || clean.length > Math.ceil(PHOTO_MAX_BYTES * 4 / 3) + 128) throw statusError("文字卡片过大。", 413);
  try {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw statusError("文字卡片编码无效。", 400);
  }
}

function looksLikePhotoBytes(bytes, contentType) {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

const STOCK_PHOTO_HOSTS = new Set(["images.pexels.com", "images.unsplash.com", "plus.unsplash.com", "cdn.pixabay.com"]);
const PEOPLE_PATTERN = /\b(people|person|man|men|woman|women|girl|boy|child|children|baby|couple|family|human|portrait|selfie|face|faces|crowd|hand|hands|silhouette|someone|lady|gentleman|teen|kid|kids|model|dancer|tourist|worker|friend|friends|人|男人|女人|男女|情侣|人物|肖像)\b/i;

export function isAllowedStockPhotoUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && STOCK_PHOTO_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function stockSearchRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role === "cover" || role === "content" ? role : "";
}

export function buildPexelsSearchQuery(value, options = {}) {
  const role = stockSearchRole(options.role);
  const allowPeople = options.allowPeople === true || role === "cover";
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (allowPeople) {
    const base = raw || "couple sunset landscape portrait";
    return `${base} portrait cinematic couple people`;
  }
  const cleaned = raw.replace(PEOPLE_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (role === "content") {
    const base = cleaned || "bright airy daylight sky pastel horizon";
    return `${base} bright airy daylight soft light empty scene no people`;
  }
  const base = cleaned || "cinematic empty landscape fog forest interior hallway";
  return `${base} cinematic establishing shot empty scene still life no people`;
}

export function photoLooksLikePeople(...values) {
  return PEOPLE_PATTERN.test(values.map((value) => String(value || "")).join(" "));
}

// Relative luminance (0..1) of a Pexels avg_color like "#aabbcc"; photos
// without the field land in the middle so sorting stays stable.
export function photoLuminance(avgColor) {
  const match = String(avgColor || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return 0.5;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export async function searchStockPhotos(env, searchParams) {
  const query = String(searchParams.get("q") || searchParams.get("query") || "").trim();
  const count = Math.max(1, Math.min(30, Number(searchParams.get("count") || 12) || 12));
  const role = stockSearchRole(searchParams.get("role"));
  const allowPeople = searchParams.get("allowPeople") === "1" || role === "cover";
  const builtQuery = buildPexelsSearchQuery(query, { role, allowPeople });
  const accessKey = String(env.PEXELS_API_KEY || "").trim();
  if (!accessKey) {
    return { configured: false, photos: [], error: "还没有配置 Pexels。可以先粘贴 Pexels 图片链接。" };
  }
  const page = Math.max(1, Math.min(5, Number(searchParams.get("page") || 1) || 1));
  const endpoint = new URL("https://api.pexels.com/v1/search");
  endpoint.searchParams.set("query", builtQuery);
  endpoint.searchParams.set("orientation", "portrait");
  endpoint.searchParams.set("size", "large");
  endpoint.searchParams.set("per_page", String(Math.min(80, Math.max(20, count * 4))));
  if (page > 1) endpoint.searchParams.set("page", String(page));
  const response = await (env.fetch || fetch)(endpoint, {
    headers: { Authorization: accessKey },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw statusError(`Pexels 搜索失败：HTTP ${response.status}`, 502);
  const data = await response.json();
  let photos = (Array.isArray(data.photos) ? data.photos : []).map((photo) => {
    const alt = String(photo.alt || "");
    if (!allowPeople && photoLooksLikePeople(alt, photo.url)) return null;
    const imageUrl = photo.src?.portrait || photo.src?.large2x || photo.src?.large || photo.src?.original || "";
    const thumbUrl = photo.src?.medium || photo.src?.small || imageUrl;
    if (!isAllowedStockPhotoUrl(imageUrl)) return null;
    return {
      id: String(photo.id || ""),
      author: String(photo.photographer || "Pexels"),
      pageUrl: String(photo.url || ""),
      alt,
      avgColor: String(photo.avg_color || ""),
      luminance: photoLuminance(photo.avg_color),
      imageUrl,
      thumbUrl: `/api/official-tiktok/stock-photos/file?url=${encodeURIComponent(thumbUrl)}`,
      fileUrl: `/api/official-tiktok/stock-photos/file?url=${encodeURIComponent(imageUrl)}`,
    };
  }).filter(Boolean);
  // Content pads carry dark text, so hand out the brightest results first.
  if (role === "content") photos = photos.slice().sort((a, b) => b.luminance - a.luminance);
  photos = photos.slice(0, count);
  return { configured: true, photos, query: builtQuery };
}

export async function proxyStockPhoto(env, rawUrl) {
  if (!isAllowedStockPhotoUrl(rawUrl)) throw statusError("只支持 Pexels、Unsplash、Pixabay 的图片链接。", 400);
  const response = await (env.fetch || fetch)(rawUrl, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!response.ok) throw statusError(`读取素材图失败：HTTP ${response.status}`, 502);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw statusError("素材链接不是图片。", 415);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > PHOTO_MAX_BYTES) throw statusError("素材图为空或超过 20 MB。", 413);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    },
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

export function buildPhotoPublishRecord(payload, batch, now = Date.now()) {
  const batchRow = batch?.batch && typeof batch.batch === "object" ? batch.batch : (batch && typeof batch === "object" ? batch : {});
  const task = Array.isArray(batchRow.tasks) ? batchRow.tasks[0] || {} : {};
  const batchId = String(batchRow.id || "").trim();
  const taskId = String(task.id || "").trim();
  const photoCount = Array.isArray(payload.assets) ? payload.assets.length : 0;
  const title = String(payload.title || "").trim() || `心理学图文 · ${photoCount} 张`;
  return {
    id: `photo:${payload.requestId}`,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    scheduleAt: payload.scheduleAt || now,
    status: "submitted",
    fileName: title,
    title,
    connectionId: payload.connectionId,
    accountName: String(task.accountDisplayName || "").trim(),
    accountUsername: String(task.username || "").replace(/^@/, "").trim(),
    officialBatchIds: batchId ? [batchId] : [],
    batchId,
    taskIds: taskId ? [taskId] : [],
    remoteTaskId: taskId,
    externalRef: `${payload.requestId}:0`,
    autoTaskId: "psychology-photo",
    provider: "official",
    source: "official-tiktok",
    mediaType: "photo",
    photoCount,
    note: `图文发布模板已提交中台，${photoCount} 张图片`,
  };
}

function parseStringArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function statusError(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }
