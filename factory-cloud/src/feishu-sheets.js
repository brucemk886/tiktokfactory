import {
  extractSheetIdFromUrl,
  extractWikiToken,
  parseFeishuImportRows,
  pickFeishuCatalogSheets
} from "../../scripts/feishu-novel-import.js";

const DEFAULT_WIKI_URL = "https://my.feishu.cn/wiki/DMPvw98Wri5WCfk9wkScDrV1nce?sheet=acDhJT";
const READ_CHUNK_ROWS = 1000;
const MAX_READ_ROWS = 12_000;
const MAX_READ_COLUMNS = 20;

export function feishuSettings(env = {}) {
  const wikiUrl = String(env.FEISHU_WIKI_URL || DEFAULT_WIKI_URL).trim();
  return {
    appId: String(env.FEISHU_APP_ID || "").trim(),
    appSecret: String(env.FEISHU_APP_SECRET || "").trim(),
    wikiUrl,
    wikiToken: extractWikiToken(wikiUrl),
    defaultSheetId: extractSheetIdFromUrl(wikiUrl) || "acDhJT"
  };
}

export function feishuConfigured(env = {}) {
  const settings = feishuSettings(env);
  return Boolean(settings.appId && settings.appSecret && settings.wikiToken);
}

export function feishuStatus(env = {}) {
  const settings = feishuSettings(env);
  return {
    configured: feishuConfigured(env),
    wikiUrl: settings.wikiUrl,
    defaultSheetId: settings.defaultSheetId
  };
}

export async function fetchFeishuCatalogBooks(env) {
  const settings = requireSettings(env);
  const token = await getTenantToken(settings);
  const node = await resolveWikiNode(token, settings.wikiToken);
  if (node.obj_type !== "sheet") {
    throw Object.assign(new Error(`当前飞书副本类型为 ${node.obj_type || "未知"}，不是电子表格。`), { statusCode: 400 });
  }

  const sheets = await listSheets(token, node.obj_token);
  const selected = pickFeishuCatalogSheets(sheets);
  if (!selected.length) throw Object.assign(new Error("飞书副本里没有「重点书单」或「历史爆款」工作表。"), { statusCode: 400 });

  const books = [];
  for (const sheet of selected) {
    const rows = await readSheetRows(token, node.obj_token, sheet);
    const parsed = parseFeishuImportRows(rows, { sheetId: sheet.id, sheetTitle: sheet.title });
    books.push(...parsed.books);
  }
  return {
    sourceTitle: String(node.title || "飞书小说书单"),
    sheets: selected,
    books
  };
}

function requireSettings(env) {
  const settings = feishuSettings(env);
  if (!settings.appId || !settings.appSecret) {
    throw Object.assign(new Error("飞书未配置。请先设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。"), { statusCode: 400 });
  }
  if (!settings.wikiToken) {
    throw Object.assign(new Error("飞书 Wiki 副本链接未配置。"), { statusCode: 400 });
  }
  return settings;
}

async function getTenantToken(settings) {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: settings.appId, app_secret: settings.appSecret })
  });
  const body = await readResponse(response);
  if (!response.ok || Number(body.code) !== 0 || !body.tenant_access_token) {
    throw feishuError("获取飞书访问凭证失败", body, response.status);
  }
  return String(body.tenant_access_token);
}

async function resolveWikiNode(token, wikiToken) {
  const data = await apiRequest(token, `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`);
  return data?.node || {};
}

async function listSheets(token, spreadsheetToken) {
  const data = await apiRequest(token, `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`);
  return (data?.sheets || [])
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
}

async function readSheetRows(token, spreadsheetToken, sheet) {
  const rowCount = Math.min(MAX_READ_ROWS, Math.max(1, sheet.rowCount));
  const columnCount = Math.min(MAX_READ_COLUMNS, Math.max(1, sheet.columnCount));
  const lastColumn = columnName(columnCount);
  const rows = [];
  for (let startRow = 1; startRow <= rowCount; startRow += READ_CHUNK_ROWS) {
    const endRow = Math.min(rowCount, startRow + READ_CHUNK_ROWS - 1);
    const range = `${sheet.id}!A${startRow}:${lastColumn}${endRow}`;
    const data = await apiRequest(token, `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(range)}`);
    const values = Array.isArray(data?.valueRange?.values) ? data.valueRange.values : [];
    for (const row of values) rows.push(Array.isArray(row) ? row : []);
  }
  return rows;
}

async function apiRequest(token, apiPath) {
  const response = await fetch(`https://open.feishu.cn${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await readResponse(response);
  if (!response.ok || Number(body.code) !== 0) {
    throw feishuError("读取飞书书单失败", body, response.status);
  }
  return body.data || {};
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
