import { isImportedAudioFile } from "../../scripts/novel-audio-import.js";
import {
  attachAudioBoardImportStatus,
  attachFactoryNovel,
  attachPeerHitTimes,
  attachScaleRunMarks,
  collapseScaleRunHits,
  collectImportItems,
  filterPeerHits,
  filterPeerHitsByTime,
  importedPeerHitIdSet,
  mergePeerHit,
  normalizePeerHitInput,
  sortPeerHits
} from "../../scripts/peer-hits.js";
import { errorJson, json, readJson, safeId } from "./http.js";
import { putNovelAudio, serveNovelAudio } from "./novel-audio-archive.js";
import { attachPeerAudiosToNovels } from "./novels.js";
import { listNovelMatchIndex, listNovelScripts, listNovelsMatchingPeerHit, listNovelsMatchingPeerHits } from "./novel-store.js";
import { deletePeerHitRow, findPeerHitById, findPeerHitByKey, listPeerHitRows, upsertPeerHitRow } from "./peer-hits-store.js";

const IMPORT_LIMIT = 200;

export async function handlePeerHits(request, env, url, session, ctx) {
  if (!url.pathname.startsWith("/api/peer-hits")) return null;
  if (!session) return errorJson("请先登录。", 401);

  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/peer-hits") {
    const rows = await listPeerHitRows(db);
    const novels = await listNovelsMatchingPeerHits(db, rows);
    const importedIds = importedPeerHitIdSet(await listNovelScripts(db));
    const items = sortPeerHits(collapseScaleRunHits(filterPeerHitsByTime(
      filterPeerHits(attachScaleRunMarks(attachPeerHitTimes(rows.map((item) => attachAudioBoardImportStatus(attachFactoryNovel(item, novels), importedIds)))), url.searchParams.get("query") || ""),
      url.searchParams.get("range") || "all",
      Date.now(),
      Number(url.searchParams.get("since")) || 0
    )));
    return json({ items, count: items.length });
  }

  if (method === "POST" && pathname === "/api/peer-hits/import-to-novels") {
    const payload = await readJson(request);
    const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => String(id || "").trim()).filter(Boolean).slice(0, 20) : [];
    const hits = [];
    for (const id of ids) {
      const hit = await findPeerHitById(db, id);
      if (hit) hits.push(hit);
    }
    return json(await attachPeerAudiosToNovels(env, db, session, hits, ctx, request));
  }

  if (method === "POST" && (pathname === "/api/peer-hits" || pathname === "/api/peer-hits/import")) {
    const type = String(request.headers.get("content-type") || "");
    if (type.includes("multipart/form-data")) {
      return json(await importPeerHitsFromForm(env, db, request));
    }
    return json(await importPeerHits(db, await readJson(request)));
  }

  const audioMatch = pathname.match(/^\/api\/peer-hits\/([^/]+)\/audio$/);
  if (audioMatch) {
    const id = decodeURIComponent(audioMatch[1]);
    if (method === "GET") {
      const current = await findPeerHitById(db, id);
      if (!current?.audioId) return errorJson("这条还没有导入音频。", 404);
      const response = await serveNovelAudio(env, current.audioId, request);
      if (!response) return errorJson("没有这份音频。", 404);
      return response;
    }
    if (method === "POST") {
      try {
        return json(await uploadPeerHitAudio(env, db, id, request));
      } catch (error) {
        return errorJson(error.message || "音频上传失败。", error.statusCode || 400);
      }
    }
  }

  const match = pathname.match(/^\/api\/peer-hits\/([^/]+)$/);
  if (!match) return errorJson("没有找到该接口。", 404);
  const id = decodeURIComponent(match[1]);
  const current = await findPeerHitById(db, id);
  if (!current) return errorJson("没有找到这条同行视频。", 404);
  if (method === "GET") return json({ item: current });
  if (method === "DELETE") {
    await deletePeerHitRow(db, id);
    return json({ ok: true });
  }
  return null;
}

async function importPeerHits(db, payload) {
  const rawItems = collectImportItems(payload).slice(0, IMPORT_LIMIT);
  if (!rawItems.length) {
    const error = new Error("请提交视频链接、播放量、视频数据、小说名称和小说id。");
    error.statusCode = 400;
    throw error;
  }
  const now = Date.now();
  let created = 0;
  let updated = 0;
  const skipped = [];
  const items = [];
  const novels = rawItems.length === 1
    ? await listNovelsMatchingPeerHit(db, normalizePeerHitInput(rawItems[0], { now, source: "grokbot" }))
    : await listNovelMatchIndex(db);
  for (const raw of rawItems) {
    try {
      const incoming = attachFactoryNovel(normalizePeerHitInput(raw, { now, source: "grokbot" }), novels);
      const existing = await findPeerHitByKey(db, incoming.videoKey);
      const saved = await upsertPeerHitRow(db, mergePeerHit(existing, existing ? { ...incoming, id: existing.id } : incoming));
      items.push(saved);
      if (existing) updated += 1;
      else created += 1;
    } catch (error) {
      skipped.push(error.message || "这一条无法导入。");
    }
  }
  return {
    created,
    updated,
    skipped: skipped.length,
    skippedMessages: skipped.slice(0, 8),
    items,
    count: items.length,
    message: summarizeImport({ created, updated, skipped: skipped.length })
  };
}

async function importPeerHitsFromForm(env, db, request) {
  const form = await request.formData();
  const file = [form.get("audio"), form.get("file")].find((item) => item && typeof item.arrayBuffer === "function");
  const result = await importPeerHits(db, {
    videoUrl: String(form.get("videoUrl") || form.get("视频链接") || ""),
    playCount: String(form.get("playCount") || form.get("播放量") || ""),
    novelTitle: String(form.get("novelTitle") || form.get("小说名称") || ""),
    novelId: String(form.get("novelId") || form.get("小说id") || ""),
    platform: String(form.get("platform") || form.get("平台") || ""),
    publishedAt: String(form.get("publishedAt") || form.get("发布时间") || ""),
    videoData: {
      点赞: String(form.get("likes") || form.get("点赞") || ""),
      评论: String(form.get("comments") || form.get("评论") || ""),
      分享: String(form.get("shares") || form.get("分享") || ""),
      发布时间: String(form.get("publishedAt") || form.get("发布时间") || "")
    }
  });
  const hit = result.items[0];
  if (!hit || !file || !Number(file.size || 0)) return result;
  try {
    const saved = await attachPeerHitAudioFile(env, db, hit, file);
    result.items = [saved];
    result.message = result.message ? `${result.message}，已导入音频` : "已导入音频";
  } catch (error) {
    result.message = result.message
      ? `${result.message}，音频没传上去：${error.message || "上传失败"}`
      : (error.message || "条目已写入，音频没传上去。");
    result.audioError = error.message || "音频上传失败。";
  }
  return result;
}

async function uploadPeerHitAudio(env, db, id, request) {
  const hit = await findPeerHitById(db, id);
  if (!hit) throw Object.assign(new Error("没有找到这条同行视频。"), { statusCode: 404 });
  const form = await request.formData();
  const file = [form.get("audio"), form.get("file")].find((item) => item && typeof item.arrayBuffer === "function");
  if (!file || !Number(file.size || 0)) throw Object.assign(new Error("请选择要导入的 mp3。"), { statusCode: 400 });
  const saved = await attachPeerHitAudioFile(env, db, hit, file);
  return { ok: true, item: saved, items: [saved], message: "已导入音频" };
}

async function attachPeerHitAudioFile(env, db, hit, file) {
  if (!isImportedAudioFile(file)) throw Object.assign(new Error("只接受 mp3 音频。"), { statusCode: 400 });
  if (Number(file.size || 0) > 20 * 1024 * 1024) throw Object.assign(new Error("音频文件超过 20MB。"), { statusCode: 413 });
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength < 1024) throw Object.assign(new Error("音频文件太小。"), { statusCode: 400 });
  const audioId = safeId(`peer-${hit.id}`);
  await putNovelAudio(env, audioId, bytes, file.type || "audio/mpeg");
  return upsertPeerHitRow(db, {
    ...hit,
    audioId,
    audioName: String(file.name || `${audioId}.mp3`).trim().slice(0, 240),
    audioSize: bytes.byteLength,
    updatedAt: Date.now()
  });
}

function summarizeImport({ created, updated, skipped }) {
  const parts = [];
  if (created) parts.push(`新增 ${created} 条`);
  if (updated) parts.push(`更新 ${updated} 条`);
  if (skipped) parts.push(`跳过 ${skipped} 条`);
  return parts.join("，") || "没有写入新的同行视频。";
}
