import { isImportedAudioFile } from "../../scripts/novel-audio-import.js";
import {
  attachFactoryNovel,
  collectImportItems,
  filterPeerHits,
  mergePeerHit,
  normalizePeerHitInput,
  sortPeerHits
} from "../../scripts/peer-hits.js";
import { errorJson, json, readJson, safeId } from "./http.js";
import { putNovelAudio, serveNovelAudio } from "./novel-audio-archive.js";
import { listNovelSummaries } from "./novel-store.js";
import { deletePeerHitRow, findPeerHitById, findPeerHitByKey, listPeerHitRows, upsertPeerHitRow } from "./peer-hits-store.js";

const IMPORT_LIMIT = 200;

export async function handlePeerHits(request, env, url, session) {
  if (!url.pathname.startsWith("/api/peer-hits")) return null;
  if (!session) return errorJson("请先登录。", 401);

  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/peer-hits") {
    const items = sortPeerHits(filterPeerHits(await listPeerHitRows(db), url.searchParams.get("query") || ""));
    return json({ items, count: items.length });
  }

  if (method === "POST" && (pathname === "/api/peer-hits" || pathname === "/api/peer-hits/import")) {
    const type = String(request.headers.get("content-type") || "");
    if (type.includes("multipart/form-data")) {
      return json(await importPeerHitsFromForm(env, db, request));
    }
    return json(await importPeerHits(db, await readJson(request)));
  }

  const audioMatch = pathname.match(/^\/api\/peer-hits\/([^/]+)\/audio$/);
  if (method === "GET" && audioMatch) {
    const current = await findPeerHitById(db, decodeURIComponent(audioMatch[1]));
    if (!current?.audioId) return errorJson("这条还没有导入音频。", 404);
    const response = await serveNovelAudio(env, current.audioId, request);
    if (!response) return errorJson("没有这份音频。", 404);
    return response;
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
  const novels = await listNovelSummaries(db);
  const now = Date.now();
  let created = 0;
  let updated = 0;
  const skipped = [];
  const items = [];
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
    videoData: {
      点赞: String(form.get("likes") || form.get("点赞") || ""),
      评论: String(form.get("comments") || form.get("评论") || ""),
      分享: String(form.get("shares") || form.get("分享") || "")
    }
  });
  const hit = result.items[0];
  if (!hit || !file || !Number(file.size || 0)) return result;
  if (!isImportedAudioFile(file)) {
    const error = new Error("只接受 mp3 音频。");
    error.statusCode = 400;
    throw error;
  }
  if (Number(file.size || 0) > 20 * 1024 * 1024) {
    const error = new Error("音频文件超过 20MB。");
    error.statusCode = 413;
    throw error;
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength < 1024) {
    const error = new Error("音频文件太小。");
    error.statusCode = 400;
    throw error;
  }
  const audioId = safeId(`peer-${hit.id}`);
  await putNovelAudio(env, audioId, bytes, file.type || "audio/mpeg");
  const saved = await upsertPeerHitRow(db, {
    ...hit,
    audioId,
    audioName: String(file.name || `${audioId}.mp3`).trim().slice(0, 240),
    audioSize: bytes.byteLength,
    updatedAt: Date.now()
  });
  result.items = [saved];
  result.message = result.message ? `${result.message}，已导入音频` : "已导入音频";
  return result;
}

function summarizeImport({ created, updated, skipped }) {
  const parts = [];
  if (created) parts.push(`新增 ${created} 条`);
  if (updated) parts.push(`更新 ${updated} 条`);
  if (skipped) parts.push(`跳过 ${skipped} 条`);
  return parts.join("，") || "没有写入新的同行视频。";
}
