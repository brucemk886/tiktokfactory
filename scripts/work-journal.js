export const JOURNAL_KINDS = ["daily_work", "essay", "mindmap"];

export function beijingDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function emptyMindmap(title = "新脑图") {
  return {
    id: "root",
    text: String(title || "新脑图").slice(0, 80) || "新脑图",
    children: [],
  };
}

export function normalizeJournalEntry(payload = {}, { id, now = Date.now() } = {}) {
  const kind = String(payload.kind || "").trim();
  if (!JOURNAL_KINDS.includes(kind)) {
    throw Object.assign(new Error("类型仅支持每日工作、每日随笔或脑图。"), { status: 400 });
  }
  const title = String(payload.title || "").trim().slice(0, 120);
  if (!title) throw Object.assign(new Error("请填写标题。"), { status: 400 });
  const dateKey = String(payload.dateKey || payload.date || beijingDateKey(now)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw Object.assign(new Error("日期格式应为 YYYY-MM-DD。"), { status: 400 });
  }
  const body = kind === "mindmap" ? "" : String(payload.body || "").trim().slice(0, 50_000);
  const mindmap = kind === "mindmap" ? normalizeMindmap(payload.mindmap || payload.mindmapJson, title) : emptyMindmap(title);
  return {
    id: String(id || payload.id || "").trim(),
    kind,
    dateKey,
    title,
    body,
    mindmap,
    createdAt: Number(payload.createdAt) || now,
    updatedAt: now,
  };
}

export function filterJournalEntries(entries, { kind = "", query = "", dateKey = "" } = {}) {
  const normalizedKind = String(kind || "").trim();
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedDate = String(dateKey || "").trim();
  return (Array.isArray(entries) ? entries : [])
    .filter((item) => !normalizedKind || item.kind === normalizedKind)
    .filter((item) => !normalizedDate || item.dateKey === normalizedDate)
    .filter((item) => !normalizedQuery || [item.title, item.body, item.dateKey].some((value) => String(value || "").toLowerCase().includes(normalizedQuery)))
    .sort((left, right) => (right.dateKey || "").localeCompare(left.dateKey || "") || (right.updatedAt || 0) - (left.updatedAt || 0));
}

export function summarizeJournal(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    total: list.length,
    dailyWork: list.filter((item) => item.kind === "daily_work").length,
    essay: list.filter((item) => item.kind === "essay").length,
    mindmap: list.filter((item) => item.kind === "mindmap").length,
  };
}

function normalizeMindmap(value, fallbackTitle) {
  let node = value;
  if (typeof value === "string") {
    try {
      node = JSON.parse(value);
    } catch {
      node = null;
    }
  }
  return sanitizeMindNode(node, "root", fallbackTitle);
}

function sanitizeMindNode(node, fallbackId, fallbackTitle) {
  const text = String(node?.text || node?.title || fallbackTitle || "未命名").trim().slice(0, 80) || "未命名";
  const children = Array.isArray(node?.children) ? node.children.slice(0, 40) : [];
  return {
    id: String(node?.id || fallbackId || "node").slice(0, 80),
    text,
    children: children.map((child, index) => sanitizeMindNode(child, `${fallbackId}-${index + 1}`, "新节点")),
  };
}
