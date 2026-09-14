import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Codex } from "@openai/codex-sdk";
import {
  PEER_LONGFORM_MAX_REGENERATIONS,
  PEER_LONGFORM_MAX_WORDS,
  PEER_LONGFORM_MIN_WORDS,
  PEER_LONGFORM_MODE,
  auditPeerLongformVariants,
  clipOpeningSource,
  normalizeOpeningVariantInput,
  resolveCodexExecutable
} from "./codex-brain.js";
import { defaultKokoroVoice } from "./kokoro-voices.js";
import {
  buildNarratorGenderPrompt,
  inferNarratorGenderHeuristic,
  narratorGenderOutputSchema,
  parseNarratorGenderResponse
} from "./narrator-gender.js";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

export const EXPECTED_PEER_HIT_COUNT = 85;
export const PEER_REWRITE_VARIANTS = 3;
export const DEFAULT_TTS_SPEED = 1.1;
export const GENDER_CLASSIFY_CHUNK = 8;
export const D1_ENQUEUE_CHUNK = 10;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cloudDir = path.join(root, "factory-cloud");
const wranglerCli = path.join(cloudDir, "node_modules", "wrangler", "bin", "wrangler.js");

export function parseBatchArgs(argv = process.argv.slice(2)) {
  const result = { enqueue: false, sync: false, status: false, batchId: "", skipModelGender: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value === "--enqueue") result.enqueue = true;
    else if (value === "--sync") result.sync = true;
    else if (value === "--status") result.status = true;
    else if (value === "--skip-model-gender") result.skipModelGender = true;
    else if (value === "--batch-id") result.batchId = String(argv[index += 1] || "").trim();
  }
  return result;
}

export function defaultBatchId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  return `peer85-${stamp}`;
}

export function buildPeerRewritePayload(row, classification, { batchId, batchIndex, batchTotal } = {}) {
  const narratorGender = classification?.gender === "male" ? "male" : "female";
  return {
    batchId,
    batchIndex,
    batchTotal,
    productionMode: PEER_LONGFORM_MODE,
    targetWordsMin: PEER_LONGFORM_MIN_WORDS,
    targetWordsMax: PEER_LONGFORM_MAX_WORDS,
    targetDurationMinSeconds: 180,
    targetDurationMaxSeconds: 300,
    maxRegenerations: PEER_LONGFORM_MAX_REGENERATIONS,
    novelId: String(row.novel_id || ""),
    title: String(row.novel_title || "").trim(),
    language: "English",
    sourceText: clipOpeningSource(String(row.source_text || ""), 18_000),
    sourceKind: "peer-transcript",
    sourceLabel: String(row.source_label || "同行爆款").trim(),
    sourceScriptId: String(row.source_script_id || ""),
    parentScriptId: String(row.source_script_id || ""),
    category: String(row.category || "").trim(),
    platform: String(row.platform || "NovelMaster").trim(),
    promotionCode: String(row.promotion_code || "").trim(),
    sellingPoint: String(row.selling_point || "").trim(),
    baseOpening: "",
    styles: ["auto", "auto", "auto"],
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    narratorGender,
    narratorGenderConfidence: Number(classification?.confidence) || 0,
    narratorGenderEvidence: String(classification?.evidence || "").slice(0, 300),
    ttsProvider: "kokoro",
    autoKeep: true,
    autoVoice: true,
    voiceId: defaultKokoroVoice(narratorGender),
    speechSpeed: DEFAULT_TTS_SPEED,
    speakOpeningTitle: false
  };
}

export function deterministicOpeningJobId(batchId, sourceScriptId) {
  const digest = crypto.createHash("sha256").update(`${batchId}\0${sourceScriptId}`).digest("hex").slice(0, 16);
  return `opening-peer-${digest}`;
}

export function buildQueueSql(plans, { batchId, createdAt = Date.now() } = {}) {
  const statements = [];
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const jobId = deterministicOpeningJobId(batchId, plan.payload.sourceScriptId);
    const title = `${plan.payload.title || "小说"} · 同行爆款三版 ${plan.payload.batchIndex || index + 1}/${plan.payload.batchTotal || plans.length}`.slice(0, 240);
    const stamp = createdAt + index;
    statements.push(`INSERT OR IGNORE INTO factory_jobs (id,type,status,title,percent,message,payload_json,result_json,error,created_by,worker_id,claimed_at,completed_at,created_at,updated_at) VALUES (${sqlString(jobId)},'opening-variants','queued',${sqlString(title)},0,'等待生成 3–5 分钟改写',${sqlString(JSON.stringify(plan.payload))},'{}','','codex-peer-rewrite-batch','',0,0,${stamp},${stamp});`);
  }

  return statements.join("\n");
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function queryPeerHits() {
  const sql = `SELECT s.id AS source_script_id, s.novel_id, n.title AS novel_title, n.platform, n.promotion_code, n.category, n.selling_point, COALESCE(t.text,json_extract(s.value_json,'$.text'),'') AS source_text, COALESCE(json_extract(s.value_json,'$.versionLabel'),json_extract(s.value_json,'$.openingTitle'),json_extract(s.value_json,'$.title'),'同行爆款') AS source_label FROM factory_novel_scripts s JOIN factory_novels n ON n.id=s.novel_id LEFT JOIN factory_script_transcripts t ON t.script_id=s.id WHERE json_extract(s.value_json,'$.sourceType')='peer-hit' AND length(trim(COALESCE(t.text,json_extract(s.value_json,'$.text'),'')))>=80 ORDER BY s.updated_at ASC, s.id ASC`;
  return runWranglerQuery(sql);
}

function queryBatchStatus(batchId) {
  return runWranglerQuery(`SELECT type,status,COUNT(*) AS count, SUM(CASE WHEN error<>'' THEN 1 ELSE 0 END) AS with_error FROM factory_jobs WHERE json_extract(payload_json,'$.batchId')=${sqlString(batchId)} GROUP BY type,status ORDER BY type,status`);
}

function queryCompletedUnsynced(batchId) {
  return runWranglerQuery(`SELECT id,created_at,payload_json,result_json FROM factory_jobs WHERE type='opening-variants' AND status='done' AND json_extract(payload_json,'$.batchId')=${sqlString(batchId)} AND COALESCE(json_extract(payload_json,'$.directSyncedDone'),0)<>1 ORDER BY completed_at ASC`);
}

export function buildCompletedOpeningSyncSql(row, { createdAt = Date.now() } = {}) {
  const payload = JSON.parse(String(row.payload_json || "{}"));
  const result = JSON.parse(String(row.result_json || "{}"));
  const variants = Array.isArray(result.variants) ? result.variants : [];
  if (variants.length !== PEER_REWRITE_VARIANTS) throw new Error(`${row.id} 没有完整的 ${PEER_REWRITE_VARIANTS} 个成稿。`);
  const auditInput = normalizeOpeningVariantInput(payload);
  const auditable = variants.map((variant) => ({
    ...variant,
    coreFact: variant.coreFact || String(variant.script || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)[0] || "已核对首句事实"
  }));
  const audit = auditPeerLongformVariants(auditable, auditInput);
  if (!audit.passed) throw new Error(`${row.id} 落库前复核失败：${audit.issues.slice(0, 6).join("；")}`);
  const scripts = variants.map((variant, index) => {
    const scriptId = `script-batch-${crypto.createHash("sha256").update(`${row.id}\0${index + 1}`).digest("hex").slice(0, 16)}`;
    const stamp = createdAt + index;
    const iso = new Date(stamp).toISOString();
    const value = {
      id: scriptId,
      novelId: payload.novelId,
      parentScriptId: payload.parentScriptId || payload.sourceScriptId || "",
      hookVariantId: `hook-${crypto.createHash("sha256").update(`${scriptId}\0${variant.script}`).digest("hex").slice(0, 16)}`,
      audioId: "",
      title: `${payload.title || "小说"} ${variant.styleLabel || `改写 ${index + 1}`}`.slice(0, 240),
      text: String(variant.script || "").trim(),
      versionLabel: String(variant.styleLabel || `3-5分钟版 ${index + 1}`).slice(0, 100),
      sourceType: "ai-style-rewrite",
      openingTitle: String(variant.openingTitle || "").trim().slice(0, 80),
      mixEnabled: true,
      kept: true,
      speakOpeningTitle: false,
      createdAt: iso,
      updatedAt: iso
    };
    return { id: scriptId, value, stamp };
  });
  const audioJobId = `audio-peer-${crypto.createHash("sha256").update(String(row.id)).digest("hex").slice(0, 16)}`;
  const audioQueueCreatedAt = Math.max(1, Number(row.created_at) || createdAt);
  const audioPayload = {
    batchId: payload.batchId,
    sourceOpeningJobId: row.id,
    targetAudioDir: "__novel__",
    novelTitle: payload.title,
    platform: payload.platform,
    voiceId: payload.voiceId,
    speechSpeed: payload.speechSpeed,
    ttsProvider: payload.ttsProvider || "kokoro",
    items: scripts.map((script, index) => ({
      novelId: payload.novelId,
      novelTitle: payload.title,
      platform: payload.platform,
      promotionCode: payload.promotionCode,
      scriptId: script.id,
      title: script.value.title,
      script: script.value.text,
      openingTitle: script.value.openingTitle,
      speakOpeningTitle: false,
      voiceId: payload.voiceId,
      speechSpeed: payload.speechSpeed,
      ttsProvider: payload.ttsProvider || "kokoro",
      sourceType: script.value.sourceType,
      batchVariantIndex: index + 1
    }))
  };
  const statements = scripts.map((script) => `INSERT OR IGNORE INTO factory_novel_scripts (id,novel_id,audio_id,value_json,updated_at) VALUES (${sqlString(script.id)},${sqlString(payload.novelId)},'',${sqlString(JSON.stringify(script.value))},${script.stamp});`);
  statements.push(`UPDATE factory_novels SET working=1,updated_at=${sqlString(new Date(createdAt).toISOString())} WHERE id=${sqlString(payload.novelId)};`);
  statements.push(`INSERT OR IGNORE INTO factory_jobs (id,type,status,title,percent,message,payload_json,result_json,error,created_by,worker_id,claimed_at,completed_at,created_at,updated_at) VALUES (${sqlString(audioJobId)},'audio-generate','queued',${sqlString(`${payload.title || "小说"} · 配音 3 条`.slice(0, 240))},0,'等待生成 3–5 分钟音频',${sqlString(JSON.stringify(audioPayload))},'{}','','codex-peer-rewrite-batch','',0,0,${audioQueueCreatedAt},${createdAt + 4});`);
  statements.push(`UPDATE factory_jobs SET payload_json=json_set(payload_json,'$.directSyncedDone',1),result_json=json_set(result_json,'$.autoKeptScriptIds',json(${sqlString(JSON.stringify(scripts.map((script) => script.id)))}),'$.audioJobId',${sqlString(audioJobId)}),updated_at=${createdAt + 5} WHERE id=${sqlString(row.id)};`);
  return { sql: statements.join("\n"), audioJobId, scriptIds: scripts.map((script) => script.id), audit };
}

function syncCompletedOpenings(batchId) {
  const rows = queryCompletedUnsynced(batchId);
  const synced = [];
  const rejected = [];
  for (const row of rows) {
    try {
      const plan = buildCompletedOpeningSyncSql(row);
      runWranglerSqlFile(plan.sql);
      synced.push({ openingJobId: row.id, audioJobId: plan.audioJobId, scriptIds: plan.scriptIds });
    } catch (error) {
      rejected.push({ openingJobId: row.id, error: String(error?.message || error) });
    }
  }
  return { found: rows.length, synced, rejected };
}
function runWranglerQuery(sql) {
  const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "factory-prod", "--remote", "--json", "--command", sql], {
    cwd: cloudDir,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(String(result.error?.message || result.stderr || result.stdout || `wrangler exit ${result.status}`).trim());
  const parsed = JSON.parse(String(result.stdout || "[]"));
  return parsed.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
}

function runWranglerSqlFile(sql) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-rewrite-queue-"));
  const sqlPath = path.join(tempDir, "enqueue.sql");
  try {
    fs.writeFileSync(sqlPath, sql, "utf8");
    const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "factory-prod", "--remote", "--file", sqlPath], {
      cwd: cloudDir,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.status !== 0) throw new Error(String(result.error?.message || result.stderr || result.stdout || `wrangler exit ${result.status}`).trim());
    return String(result.stdout || "").trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function classifyRows(rows, { skipModelGender = false } = {}) {
  const prepared = rows.map((row) => ({
    id: row.source_script_id,
    title: row.novel_title,
    text: row.source_text,
    heuristic: inferNarratorGenderHeuristic({ title: row.novel_title, text: row.source_text })
  }));
  if (skipModelGender) return prepared.map((item) => ({ id: item.id, ...item.heuristic, evidence: item.heuristic.clues.join(", ") || "无明确线索，按小说受众默认女声" }));
  const classified = [];
  const codexPath = resolveCodexExecutable();
  for (let offset = 0; offset < prepared.length; offset += GENDER_CLASSIFY_CHUNK) {
    const chunk = prepared.slice(offset, offset + GENDER_CLASSIFY_CHUNK);
    process.stdout.write(`旁白性别复核 ${offset + 1}-${offset + chunk.length}/${prepared.length}...\n`);
    try {
      const codex = new Codex(codexPath ? { codexPathOverride: codexPath } : undefined);
      const thread = codex.startThread({
        model: "gpt-5.6-terra",
        modelReasoningEffort: "medium",
        workingDirectory: root,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled"
      });
      const result = await thread.run(buildNarratorGenderPrompt(chunk), { outputSchema: narratorGenderOutputSchema(chunk.length) });
      classified.push(...parseNarratorGenderResponse(result.finalResponse, chunk));
    } catch (error) {
      process.stderr.write(`性别模型复核失败，使用规则兜底：${String(error?.message || error)}\n`);
      classified.push(...chunk.map((item) => ({ id: item.id, ...item.heuristic, evidence: item.heuristic.clues.join(", ") || "无明确线索，规则兜底" })));
    }
  }
  return classified;
}

function manifestPath(batchId) {
  const storage = resolveStorageDirs(root, readConfig(root));
  const dir = path.join(storage.workDir, "peer-rewrite-batches");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${batchId}.json`);
}

function loadManifestClassifications(batchId, rows) {
  const target = manifestPath(batchId);
  if (!fs.existsSync(target)) return [];
  try {
    const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
    const items = Array.isArray(manifest?.items) ? manifest.items : [];
    const expected = new Set(rows.map((row) => String(row.source_script_id || "")));
    if (items.length !== rows.length || items.some((item) => !expected.has(String(item.sourceScriptId || "")))) return [];
    return items.map((item) => ({
      id: String(item.sourceScriptId || ""),
      gender: item.narratorGender === "male" ? "male" : "female",
      confidence: Number(item.narratorGenderConfidence) || 0,
      evidence: String(item.narratorGenderEvidence || ""),
      source: "manifest"
    }));
  } catch {
    return [];
  }
}
function saveManifest(batchId, rows, classifications, enqueueStatus = []) {
  const byId = new Map(classifications.map((item) => [item.id, item]));
  const manifest = {
    batchId,
    createdAt: new Date().toISOString(),
    sourceCount: rows.length,
    variantsPerSource: PEER_REWRITE_VARIANTS,
    plannedScripts: rows.length * PEER_REWRITE_VARIANTS,
    targetDurationSeconds: { min: 180, max: 300 },
    targetWords: { min: PEER_LONGFORM_MIN_WORDS, max: PEER_LONGFORM_MAX_WORDS },
    maxRegenerations: PEER_LONGFORM_MAX_REGENERATIONS,
    status: enqueueStatus,
    items: rows.map((row, index) => {
      const classification = byId.get(row.source_script_id) || {};
      return {
        index: index + 1,
        sourceScriptId: row.source_script_id,
        novelId: row.novel_id,
        novelTitle: row.novel_title,
        platform: row.platform,
        sourceWords: String(row.source_text || "").match(/[A-Za-z0-9]+(?:[’'][A-Za-z0-9]+)*/g)?.length || 0,
        narratorGender: classification.gender || "female",
        narratorGenderConfidence: Number(classification.confidence) || 0,
        narratorGenderEvidence: String(classification.evidence || ""),
        voiceId: defaultKokoroVoice(classification.gender)
      };
    })
  };
  const target = manifestPath(batchId);
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2), "utf8");
  return target;
}

async function main() {
  const args = parseBatchArgs();
  const batchId = args.batchId || defaultBatchId();
  if (args.status) {
    console.log(JSON.stringify({ batchId, status: queryBatchStatus(batchId) }, null, 2));
    return;
  }
  if (args.sync) {
    const sync = syncCompletedOpenings(batchId);
    console.log(JSON.stringify({ batchId, sync, status: queryBatchStatus(batchId) }, null, 2));
    return;
  }
  const rows = queryPeerHits();
  if (rows.length !== EXPECTED_PEER_HIT_COUNT) {
    throw new Error(`同行爆款基线应为 ${EXPECTED_PEER_HIT_COUNT} 条，当前查到 ${rows.length} 条；为避免漏做或重复，批次未启动。`);
  }
  const cachedClassifications = loadManifestClassifications(batchId, rows);
  const classifications = cachedClassifications.length
    ? cachedClassifications
    : await classifyRows(rows, { skipModelGender: args.skipModelGender });
  if (cachedClassifications.length) process.stdout.write(`已复用批次清单中的 ${cachedClassifications.length} 条旁白性别审核。\n`);
  const byId = new Map(classifications.map((item) => [item.id, item]));
  const plans = rows.map((row, index) => ({
    row,
    classification: byId.get(row.source_script_id),
    payload: buildPeerRewritePayload(row, byId.get(row.source_script_id), {
      batchId,
      batchIndex: index + 1,
      batchTotal: rows.length
    })
  }));
  let status = queryBatchStatus(batchId);
  let saved = saveManifest(batchId, rows, classifications, status);
  let queueOutput = "";
  if (args.enqueue) {
    const outputs = [];
    for (let offset = 0; offset < plans.length; offset += D1_ENQUEUE_CHUNK) {
      const chunk = plans.slice(offset, offset + D1_ENQUEUE_CHUNK);
      process.stdout.write(`写入生产队列 ${offset + 1}-${offset + chunk.length}/${plans.length}...\n`);
      outputs.push(runWranglerSqlFile(buildQueueSql(chunk, { batchId, createdAt: Date.now() + offset })));
    }
    queueOutput = outputs.join("\n");
    status = queryBatchStatus(batchId);
    saved = saveManifest(batchId, rows, classifications, status);
  }
  console.log(JSON.stringify({
    batchId,
    sourceCount: rows.length,
    plannedScripts: rows.length * PEER_REWRITE_VARIANTS,
    genders: classifications.reduce((counts, item) => ({ ...counts, [item.gender]: (counts[item.gender] || 0) + 1 }), {}),
    maxRegenerations: PEER_LONGFORM_MAX_REGENERATIONS,
    enqueued: args.enqueue,
    status,
    manifestPath: saved,
    queueOutput: queueOutput.slice(-500)
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}