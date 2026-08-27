import {
  attachFactoryNovel,
  collectImportItems,
  filterPeerHits,
  mergePeerHit,
  normalizePeerHitInput,
  sortPeerHits
} from "../../scripts/peer-hits.js";
import { errorJson, json, readJson } from "./http.js";
import { listNovelSummaries } from "./novel-store.js";
import { deletePeerHitRow, findPeerHitById, findPeerHitByKey, listPeerHitRows, upsertPeerHitRow } from "./peer-hits-store.js";

const IMPORT_LIMIT = 200;

export async function handlePeerHits(request, env, url, session) {
  if (!url.pathname.startsWith("/api/peer-hits")) return null;
  if (!session) return errorJson("请先登录。", 401);
  if (session.user?.role !== "admin") return errorJson("仅管理员可以使用同行爆款。", 403);

  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/peer-hits") {
    const items = sortPeerHits(filterPeerHits(await listPeerHitRows(db), url.searchParams.get("query") || ""));
    return json({ items, count: items.length });
  }

  if (method === "POST" && (pathname === "/api/peer-hits" || pathname === "/api/peer-hits/import")) {
    return json(await importPeerHits(db, await readJson(request)));
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

function summarizeImport({ created, updated, skipped }) {
  const parts = [];
  if (created) parts.push(`新增 ${created} 条`);
  if (updated) parts.push(`更新 ${updated} 条`);
  if (skipped) parts.push(`跳过 ${skipped} 条`);
  return parts.join("，") || "没有写入新的同行视频。";
}
