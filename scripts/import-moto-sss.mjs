import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyFeishuCatalogImport, normalizeNovelTitle } from "./feishu-novel-import.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPREADSHEET = "EYWFsA9FXhJ6lZt5Z0QcyBXFnVe";
const SHEET_ID = "7Hlb2b";
const PLATFORM = "MotoNovel";
const RANK = "🔥SSS";

function cellText(value) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(" ");
  if (typeof value === "object") return String(value.text || value.name || value.link || value.value || "").trim();
  return String(value).trim();
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeChannel(value) {
  const raw = String(value || "").trim();
  if (raw === "男") return "男频";
  if (raw === "女") return "女频";
  return raw;
}

function parseMonthDay(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (!match) return String(value || "").trim();
  return `2026-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

async function tenantToken(feishu) {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: feishu.appId, app_secret: feishu.appSecret })
  });
  const body = await response.json();
  if (!body.tenant_access_token) throw new Error(`飞书凭证失败：${body.msg || body.code}`);
  return body.tenant_access_token;
}

async function api(token, apiPath) {
  const response = await fetch(`https://open.feishu.cn${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  if (!response.ok || Number(body.code) !== 0) {
    throw new Error(`读取飞书失败：${body.msg || body.message || response.status}`);
  }
  return body.data || {};
}

function parseHitSheet(rows) {
  const headers = (rows[0] || []).map(cellText);
  const index = Object.fromEntries(headers.map((header, i) => [normalizeHeader(header), i]));
  const books = [];
  const rankCounts = new Map();
  for (let rowNumber = 2; rowNumber < rows.length; rowNumber++) {
    const row = rows[rowNumber] || [];
    const title = cellText(row[index["书名"]]);
    if (!title) continue;
    const rank = cellText(row[index["推荐度"]]);
    rankCounts.set(rank || "(空)", (rankCounts.get(rank || "(空)") || 0) + 1);
    const english = cellText(row[index["英文简介"]]);
    const chinese = cellText(row[index["中文简介"]]);
    books.push({
      rowNumber: rowNumber + 1,
      sheetId: SHEET_ID,
      sheetTitle: "历史爆款",
      featured: false,
      date: parseMonthDay(cellText(row[index["上架日期"]])),
      title,
      bookId: cellText(row[index["id"]]),
      category: normalizeChannel(cellText(row[index["频道"]])),
      sellingPoint: cellText(row[index["标签"]]),
      note: rank,
      sourceContent: english || chinese,
      rank
    });
  }
  return { books, rankCounts };
}

function wranglerOutput(result, label) {
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `wrangler 失败：${label}`);
  }
  const start = result.stdout.indexOf("[");
  return JSON.parse(result.stdout.slice(start).trim());
}

function wranglerQuery(sql) {
  const quoted = sql.replaceAll('"', '\\"');
  const result = spawnSync(
    `npx wrangler d1 execute factory-prod --remote --config wrangler.jsonc --json --command "${quoted}"`,
    { cwd: path.join(ROOT, "factory-cloud"), encoding: "utf8", shell: true }
  );
  const parsed = wranglerOutput(result, sql);
  const batch = Array.isArray(parsed) ? parsed[0] : parsed;
  return batch?.results || [];
}

function wranglerFile(sql) {
  const file = path.join(ROOT, "factory-cloud", ".tmp-moto-sss.sql");
  fs.writeFileSync(file, sql, "utf8");
  try {
    const result = spawnSync(
      "npx",
      ["wrangler", "d1", "execute", "factory-prod", "--remote", "--config", "wrangler.jsonc", "--json", "--file", file],
      { cwd: path.join(ROOT, "factory-cloud"), encoding: "utf8", shell: true }
    );
    wranglerOutput(result, "file");
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function main() {
  return run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

async function run() {
  const dry = process.argv.includes("--dry-run");
  const feishu = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).feishu;
  const token = await tenantToken(feishu);
  const sheets = await api(token, `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(SPREADSHEET)}/sheets/query`);
  const target = (sheets.sheets || []).find((sheet) => sheet.sheet_id === SHEET_ID);
  if (!target) throw new Error("没有找到工作表 历史爆款。");
  const rowCount = Math.min(Number(target.grid_properties?.row_count) || 553, 2000);
  const values = await api(token, `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(SPREADSHEET)}/values/${encodeURIComponent(`${SHEET_ID}!A1:H${rowCount}`)}`);
  const rows = values.valueRange?.values || [];
  const parsed = parseHitSheet(rows);
  const sss = parsed.books.filter((book) => book.rank === RANK);
  const unique = [...new Map(sss.map((book) => [normalizeNovelTitle(book.title), book])).values()];
  const existing = wranglerQuery("SELECT id, title, platform, book_id FROM factory_novels").map((row) => ({
    id: row.id,
    title: row.title,
    platform: row.platform,
    bookId: row.book_id || ""
  }));
  const existingTitles = new Set(existing.map((row) => normalizeNovelTitle(row.title)));
  const now = new Date().toISOString();
  const applied = applyFeishuCatalogImport(existing, unique, {
    now,
    createId: () => `novel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  });
  const created = applied.novels
    .filter((novel) => !existing.some((row) => row.id === novel.id))
    .map((novel) => {
      const source = unique.find((book) => normalizeNovelTitle(book.title) === normalizeNovelTitle(novel.title));
      const sourceContent = String(novel.sourceContent || source?.sourceContent || "").trim()
        || [source?.title, source?.sellingPoint, source?.rank].filter(Boolean).join("\n");
      return { ...novel, platform: PLATFORM, sourceContent };
    });
  const filled = applied.novels.filter((novel) => {
    const prev = existing.find((row) => row.id === novel.id);
    return prev && String(novel.bookId || "") && String(novel.bookId || "") !== String(prev.book_id || prev.bookId || "");
  });

  console.log(JSON.stringify({
    sheet: target.title,
    rankCounts: Object.fromEntries(parsed.rankCounts),
    sssRows: sss.length,
    sssUnique: unique.length,
    existing: existing.length,
    overlap: unique.filter((book) => existingTitles.has(normalizeNovelTitle(book.title))).map((book) => book.title),
    toCreate: created.length,
    toFillBookId: filled.length,
    dry
  }, null, 2));

  if (dry || !created.length) return;

  for (let index = 0; index < created.length; index += 8) {
    const slice = created.slice(index, index + 8);
    const valuesSql = slice.map((novel) => `(${[
      sqlString(novel.id),
      sqlString(novel.title),
      sqlString(PLATFORM),
      sqlString(novel.bookId),
      sqlString(""),
      sqlString(""),
      sqlString(novel.category),
      novel.featured ? 1 : 0,
      sqlString(novel.sellingPoint),
      sqlString(novel.note),
      sqlString(novel.sourceContent),
      sqlString("active"),
      sqlString(novel.createdAt),
      sqlString(novel.updatedAt)
    ].join(", ")})`).join(", ");
    const sql = `INSERT OR IGNORE INTO factory_novels (
      id, title, platform, book_id, promotion_code, promotion_copy, category, featured,
      selling_point, note, source_content, status, created_at, updated_at
    ) VALUES ${valuesSql};`;
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        wranglerFile(sql);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * attempt);
      }
    }
    if (lastError) throw lastError;
    console.log(`inserted ${Math.min(index + slice.length, created.length)}/${created.length}`);
  }
}

main();
