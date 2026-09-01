import { errorJson, json, now, readJson } from "./http.js";
import { createKieClient } from "./kie.js";

const FINAL_STATES = new Set(["success", "fail"]);
const IMAGE_MODEL_IDS = new Set(["grok", "nano-banana"]);

export async function handleAi(request, env, url, session) {
  if (!session) return null;
  const pathname = url.pathname;
  if (pathname !== "/api/kie-ai" && !pathname.startsWith("/api/kie-ai/")) return null;
  if (session.user?.role !== "admin") return errorJson("仅管理员可以使用 AI 创作。", 403);

  try {
    const db = env.DB;
    await ensureAiTable(db);
    const method = request.method;
    const id = url.searchParams.get("id") || decodeURIComponent(pathname.split("/")[3] || "");
    const kie = createKieClient({
      apiKey: String(env.KIE_API_KEY || "").trim(),
      fetchImpl: env.fetch || fetch
    });

    if (method === "GET" && id) {
      return json({ task: await refreshGeneration(db, kie, session.user.username, id) });
    }
    if (method === "GET" && pathname === "/api/kie-ai") {
      const rows = ((await db.prepare(`
        SELECT * FROM factory_ai_generations
        WHERE owner_username = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(session.user.username).all()).results) || [];
      return json({
        tasks: rows.map(publicTask),
        credits: await safeCredits(kie),
        configured: Boolean(String(env.KIE_API_KEY || "").trim()),
        cloud: true
      });
    }
    if (method === "POST" && pathname === "/api/kie-ai") {
      return json({ task: await createGeneration(db, kie, session.user.username, await readJson(request)) }, 201);
    }
    return errorJson("不支持这个 AI 创作请求。", 405);
  } catch (error) {
    return errorJson(error.message || "AI 创作失败。", Number(error.statusCode || error.status) || 500);
  }
}

async function createGeneration(db, kie, ownerUsername, input = {}) {
  const kind = input.kind === "video" ? "video" : input.kind === "image" ? "image" : "";
  if (!kind) throw Object.assign(new Error("云端 AI 创作只支持生图和生视频。"), { statusCode: 400 });
  const prompt = String(input.prompt || "").trim();
  if (prompt.length < 2) throw Object.assign(new Error("请输入生成描述。"), { statusCode: 400 });
  if (prompt.length > 8000) throw Object.assign(new Error("输入内容不能超过 8000 个字符。"), { statusCode: 400 });
  const imageModel = String(input.imageModel || "grok");
  if (kind === "image" && !IMAGE_MODEL_IDS.has(imageModel)) {
    throw Object.assign(new Error("不支持这个生图模型。"), { statusCode: 400 });
  }

  const remote = await kie.createKieMediaTask(kind, prompt, {
    imageModel,
    noImageText: input.noImageText,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    resolution: input.resolution
  });
  const stamp = now();
  const row = {
    id: crypto.randomUUID(),
    owner_username: ownerUsername,
    kind,
    model: remote.model,
    prompt,
    status: "waiting",
    task_id: remote.taskId,
    result_urls_json: "[]",
    result_text: "",
    error: "",
    progress: 0,
    credits_consumed: 0,
    created_at: stamp,
    updated_at: stamp,
    completed_at: 0
  };
  await db.prepare(`
    INSERT INTO factory_ai_generations (
      id, owner_username, kind, model, prompt, status, task_id,
      result_urls_json, result_text, error, progress, credits_consumed,
      created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.id, row.owner_username, row.kind, row.model, row.prompt, row.status, row.task_id,
    row.result_urls_json, row.result_text, row.error, row.progress, row.credits_consumed,
    row.created_at, row.updated_at, row.completed_at
  ).run();
  return publicTask(row);
}

async function refreshGeneration(db, kie, ownerUsername, id) {
  const row = await db.prepare(`
    SELECT * FROM factory_ai_generations WHERE id = ? AND owner_username = ?
  `).bind(String(id || ""), ownerUsername).first();
  if (!row) throw Object.assign(new Error("找不到该生成任务。"), { statusCode: 404 });
  if (!row.task_id || FINAL_STATES.has(row.status)) return publicTask(row);

  const remote = await kie.getKieTask(row.task_id);
  const status = remote.state === "success" ? "success" : remote.state === "fail" ? "fail" : remote.state;
  const updatedAt = now();
  const next = {
    ...row,
    status,
    progress: status === "success" ? 100 : remote.progress,
    result_urls_json: JSON.stringify(remote.resultUrls),
    error: remote.error,
    credits_consumed: remote.creditsConsumed,
    updated_at: updatedAt,
    completed_at: FINAL_STATES.has(status) ? (remote.completeTime || updatedAt) : 0
  };
  await db.prepare(`
    UPDATE factory_ai_generations SET
      status = ?, progress = ?, result_urls_json = ?, error = ?,
      credits_consumed = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND owner_username = ?
  `).bind(
    next.status, next.progress, next.result_urls_json, next.error,
    next.credits_consumed, next.updated_at, next.completed_at,
    next.id, ownerUsername
  ).run();
  return publicTask(next);
}

async function safeCredits(kie) {
  try {
    return await kie.getKieCredits();
  } catch {
    return null;
  }
}

function publicTask(row) {
  return {
    id: row.id,
    kind: row.kind,
    model: row.model,
    prompt: row.prompt,
    status: row.status,
    resultUrls: parseUrls(row.result_urls_json),
    resultText: String(row.result_text || ""),
    error: String(row.error || ""),
    progress: Number(row.progress || 0),
    creditsConsumed: Number(row.credits_consumed || 0) / 1000,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0)
  };
}

function parseUrls(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function ensureAiTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS factory_ai_generations (
      id TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      result_urls_json TEXT NOT NULL DEFAULT '[]',
      result_text TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0,
      credits_consumed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_factory_ai_generations_owner
    ON factory_ai_generations (owner_username, created_at DESC)
  `).run();
}
