import fs from "node:fs";
import path from "node:path";

const TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000;
const SHEET_META_TTL_MS = 10 * 60 * 1000;
const READ_CHUNK_ROWS = 1000;
const MAX_READ_ROWS = 20_000;
const MAX_READ_COLUMNS = 20;

export function createFeishuBookService({ root, workDir, readConfig }) {
  const cacheDir = path.join(workDir, "feishu-books");
  fs.mkdirSync(cacheDir, { recursive: true });

  let tokenCache = { value: "", expiresAt: 0 };
  let sheetCache = { value: null, expiresAt: 0 };

  function getSettings() {
    const feishu = readConfig(root).feishu || {};
    const wikiUrl = String(feishu.wikiUrl || "").trim();
    return {
      appId: String(feishu.appId || "").trim(),
      appSecret: String(feishu.appSecret || "").trim(),
      wikiUrl,
      wikiToken: String(feishu.wikiToken || extractWikiToken(wikiUrl)).trim()
    };
  }

  function getStatus() {
    const settings = getSettings();
    return {
      configured: Boolean(settings.appId && settings.appSecret && settings.wikiToken),
      wikiUrl: settings.wikiUrl,
      cachedSheets: sheetCache.value?.sheets?.length || 0
    };
  }

  async function listSheets({ force = false } = {}) {
    const settings = requireSettings();
    if (!force && sheetCache.value && sheetCache.expiresAt > Date.now()) return sheetCache.value;

    const node = await resolveWikiNode(settings.wikiToken);
    if (node.obj_type !== "sheet") {
      throw new Error(`当前飞书副本类型为 ${node.obj_type || "未知"}，不是电子表格。`);
    }

    const data = await apiRequest(`/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(node.obj_token)}/sheets/query`);
    const sheets = (data?.sheets || [])
      .map((sheet) => ({
        id: String(sheet.sheet_id || ""),
        title: String(sheet.title || "未命名工作表"),
        index: Number(sheet.index) || 0,
        hidden: Boolean(sheet.hidden),
        rowCount: Number(sheet.grid_properties?.row_count) || 0,
        columnCount: Number(sheet.grid_properties?.column_count) || 0
      }))
      .filter((sheet) => sheet.id)
      .sort((left, right) => left.index - right.index);

    const value = {
      sourceTitle: String(node.title || "飞书小说书单"),
      spreadsheetToken: String(node.obj_token),
      sheets
    };
    sheetCache = { value, expiresAt: Date.now() + SHEET_META_TTL_MS };
    return value;
  }

  async function syncSheet(sheetId) {
    const meta = await listSheets({ force: true });
    const sheet = meta.sheets.find((item) => item.id === sheetId)
      || meta.sheets.find((item) => !item.hidden)
      || meta.sheets[0];
    if (!sheet) throw new Error("飞书电子表格中没有可读取的工作表。");

    const rowCount = Math.min(MAX_READ_ROWS, Math.max(1, sheet.rowCount));
    const columnCount = Math.min(MAX_READ_COLUMNS, Math.max(1, sheet.columnCount));
    const lastColumn = columnName(columnCount);
    const rows = [];
    let revision = 0;

    for (let startRow = 1; startRow <= rowCount; startRow += READ_CHUNK_ROWS) {
      const endRow = Math.min(rowCount, startRow + READ_CHUNK_ROWS - 1);
      const range = `${sheet.id}!A${startRow}:${lastColumn}${endRow}`;
      const data = await apiRequest(`/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(meta.spreadsheetToken)}/values/${encodeURIComponent(range)}`);
      revision = Math.max(revision, Number(data?.revision) || 0);
      const values = Array.isArray(data?.valueRange?.values) ? data.valueRange.values : [];
      for (const row of values) rows.push(Array.isArray(row) ? row.map(cellText) : []);
    }

    const parsed = parseBookRows(rows, { sheetId: sheet.id, sheetTitle: sheet.title });
    const payload = {
      version: 1,
      sourceTitle: meta.sourceTitle,
      sourceUrl: getSettings().wikiUrl,
      spreadsheetToken: meta.spreadsheetToken,
      sheet,
      revision,
      syncedAt: new Date().toISOString(),
      totalRowsRead: rows.length,
      headerRow: parsed.headerRow,
      headers: parsed.headers,
      books: parsed.books
    };
    fs.writeFileSync(cachePath(sheet.id), JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }

  async function getLibrary({ sheetId = "", query = "", channel = "", tag = "", page = 1, pageSize = 20 } = {}) {
    const meta = await listSheets();
    const sheet = meta.sheets.find((item) => item.id === sheetId)
      || meta.sheets.find((item) => !item.hidden)
      || meta.sheets[0];
    if (!sheet) throw new Error("飞书电子表格中没有可读取的工作表。");

    let library = readCache(sheet.id);
    if (!library) library = await syncSheet(sheet.id);

    const needle = String(query || "").trim().toLowerCase();
    const selectedChannel = String(channel || "").trim();
    const selectedTag = String(tag || "").trim();
    const filtered = library.books.filter((book) => {
      if (selectedChannel && book.channel !== selectedChannel) return false;
      if (selectedTag && !book.tags.includes(selectedTag)) return false;
      if (!needle) return true;
      return [book.title, book.bookId, book.channel, book.sellingPoint, book.reason, book.intro, ...book.tags]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });

    const safePageSize = Math.min(100, Math.max(10, Number(pageSize) || 20));
    const totalPages = Math.max(1, Math.ceil(filtered.length / safePageSize));
    const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const start = (safePage - 1) * safePageSize;
    const channels = uniqueSorted(library.books.map((book) => book.channel).filter(Boolean));
    const tags = countValues(library.books.flatMap((book) => book.tags)).slice(0, 80);
    const channelTotals = {
      female: library.books.filter((book) => book.channel.includes("女")).length,
      male: library.books.filter((book) => book.channel.includes("男")).length
    };

    return {
      configured: true,
      sourceTitle: library.sourceTitle,
      sourceUrl: library.sourceUrl,
      sheet: library.sheet,
      sheets: meta.sheets,
      syncedAt: library.syncedAt,
      revision: library.revision,
      totalBooks: library.books.length,
      filteredBooks: filtered.length,
      channelTotals,
      channels,
      tags,
      page: safePage,
      pageSize: safePageSize,
      totalPages,
      books: filtered.slice(start, start + safePageSize)
    };
  }

  function readCache(sheetId) {
    const filePath = cachePath(sheetId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function cachePath(sheetId) {
    return path.join(cacheDir, `${String(sheetId).replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
  }

  function requireSettings() {
    const settings = getSettings();
    if (!settings.appId || !settings.appSecret) throw new Error("飞书 App ID 或 App Secret 未配置。");
    if (!settings.wikiToken) throw new Error("飞书 Wiki 副本链接未配置。");
    return settings;
  }

  async function getTenantToken() {
    if (tokenCache.value && tokenCache.expiresAt > Date.now()) return tokenCache.value;
    const settings = requireSettings();
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: settings.appId, app_secret: settings.appSecret })
    });
    const body = await readResponse(response);
    if (!response.ok || Number(body.code) !== 0 || !body.tenant_access_token) {
      throw feishuError("获取飞书访问凭证失败", body, response.status);
    }
    tokenCache = {
      value: String(body.tenant_access_token),
      expiresAt: Date.now() + Math.max(60_000, Number(body.expire || 7200) * 1000 - TOKEN_EARLY_REFRESH_MS)
    };
    return tokenCache.value;
  }

  async function resolveWikiNode(wikiToken) {
    const data = await apiRequest(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`);
    return data?.node || {};
  }

  async function apiRequest(apiPath) {
    const token = await getTenantToken();
    const response = await fetch(`https://open.feishu.cn${apiPath}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await readResponse(response);
    if (!response.ok || Number(body.code) !== 0) {
      if (response.status === 401) tokenCache = { value: "", expiresAt: 0 };
      throw feishuError("读取飞书书单失败", body, response.status);
    }
    return body.data || {};
  }

  return { getStatus, listSheets, syncSheet, getLibrary };
}

export function parseBookRows(rows, { sheetId = "", sheetTitle = "" } = {}) {
  if (!Array.isArray(rows) || !rows.length) return { headerRow: 0, headers: [], books: [] };
  const headerIndex = detectHeaderRow(rows);
  const rawHeaders = rows[headerIndex] || [];
  const width = Math.max(rawHeaders.length, ...rows.slice(headerIndex + 1, headerIndex + 40).map((row) => row.length));
  const headers = Array.from({ length: width }, (_, index) => String(rawHeaders[index] || "").trim() || `列${columnName(index + 1)}`);
  const fieldIndexes = mapFieldIndexes(headers, rows.slice(headerIndex + 1, headerIndex + 80));
  const books = [];

  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const title = valueAt(row, fieldIndexes.title);
    const bookId = valueAt(row, fieldIndexes.bookId);
    if (!title && !bookId) continue;
    if (title.length > 600 || /^日期$|^书名$|^英文书名$/i.test(title)) continue;

    const tags = splitTags(valueAt(row, fieldIndexes.tags) || valueAt(row, fieldIndexes.sellingPoint));
    books.push({
      id: `${sheetId}-${index + 1}`,
      rowNumber: index + 1,
      sheetId,
      sheetTitle,
      date: normalizeDate(valueAt(row, fieldIndexes.date)),
      title,
      bookId,
      channel: valueAt(row, fieldIndexes.channel),
      tags,
      sellingPoint: valueAt(row, fieldIndexes.sellingPoint),
      note: valueAt(row, fieldIndexes.note),
      reason: valueAt(row, fieldIndexes.reason),
      intro: valueAt(row, fieldIndexes.intro)
    });
  }

  return { headerRow: headerIndex + 1, headers, books };
}

function detectHeaderRow(rows) {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(12, rows.length); index++) {
    const normalized = (rows[index] || []).map(normalizeHeader);
    const score = normalized.reduce((total, value) => total + (isKnownHeader(value) ? 2 : value ? 0.1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function mapFieldIndexes(headers, sampleRows) {
  const normalized = headers.map(normalizeHeader);
  const find = (...aliases) => normalized.findIndex((header) => aliases.some((alias) => header === alias || header.includes(alias)));
  const mapped = {
    date: find("日期", "上新日期"),
    title: find("英文书名", "书籍标题", "书名"),
    bookId: find("英文书id", "书籍id", "书id", "id"),
    channel: find("频道"),
    tags: find("标签"),
    sellingPoint: find("小说卖点", "卖点"),
    note: find("备注"),
    reason: find("推荐理由"),
    intro: find("简介", "开头", "正文", "内容")
  };

  if (mapped.intro < 0) {
    const used = new Set(Object.values(mapped).filter((index) => index >= 0));
    let bestIndex = -1;
    let bestLength = 0;
    for (let column = 0; column < headers.length; column++) {
      if (used.has(column)) continue;
      const lengths = sampleRows.map((row) => String(row?.[column] || "").trim().length).filter(Boolean);
      const average = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
      if (average > bestLength && average >= 80) {
        bestLength = average;
        bestIndex = column;
      }
    }
    mapped.intro = bestIndex;
  }

  if (mapped.intro < 0 && mapped.reason >= 0 && mapped.note >= 0) {
    const reasonLength = averageColumnLength(sampleRows, mapped.reason);
    const noteLength = averageColumnLength(sampleRows, mapped.note);
    if (reasonLength >= 80 && reasonLength > noteLength * 2) {
      mapped.intro = mapped.reason;
      mapped.reason = mapped.note;
    }
  }
  return mapped;
}

function averageColumnLength(rows, column) {
  const lengths = rows.map((row) => String(row?.[column] || "").trim().length).filter(Boolean);
  return lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 0;
}

function isKnownHeader(value) {
  return ["日期", "英文书名", "英文书id", "频道", "小说卖点", "备注", "推荐理由", "书名", "标签", "id", "书籍id", "书籍标题"].includes(value);
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] || "").trim() : "";
}

function cellText(value) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return String(value.text || value.name || value.link || value.value || value.fileToken || "").trim();
  }
  return String(value).trim();
}

function splitTags(value) {
  return uniqueSorted(String(value || "").split(/[,，、|/\s]+/).map((item) => item.trim()).filter((item) => item.length > 1 && item.length < 30));
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(raw)) return raw.replaceAll("/", "-");
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return raw;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "zh-Hans-CN"));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function columnName(number) {
  let value = Math.max(1, Number(number) || 1);
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function extractWikiToken(value) {
  const match = String(value || "").match(/\/wiki\/([^/?#]+)/i);
  return match ? match[1] : "";
}

async function readResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { code: response.status, msg: text.slice(0, 500) };
  }
}

function feishuError(prefix, body, status) {
  const code = Number(body?.code) || Number(status) || 0;
  const message = String(body?.msg || body?.message || "未知错误");
  const error = new Error(`${prefix}：${message}${code ? `（${code}）` : ""}`);
  error.statusCode = status === 403 ? 403 : 502;
  return error;
}
