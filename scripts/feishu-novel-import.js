const TITLE_ALIASES = ["英文书名", "书籍标题", "书名"];
const CONTENT_ALIASES = ["免费内容", "免费章节", "简介", "推荐理由", "开头", "正文", "内容"];
const KNOWN_HEADERS = [
  "日期", "上架日期", "上新日期",
  "英文书名", "书籍标题", "书名",
  "搜索词", "推广码", "书籍id", "英文书id", "书id", "id",
  "免费内容", "免费章节", "简介", "推荐理由", "开头", "正文", "内容",
  "频道", "小说卖点", "卖点", "备注", "标签", "爆款指数"
];

export function extractWikiToken(value) {
  const match = String(value || "").match(/\/wiki\/([^/?#]+)/i);
  return match ? match[1] : "";
}

export function extractSheetIdFromUrl(value) {
  try {
    const sheet = new URL(String(value || ""), "https://my.feishu.cn").searchParams.get("sheet");
    return String(sheet || "").trim();
  } catch {
    const match = String(value || "").match(/[?&]sheet=([^&#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

export function normalizeNovelTitle(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function pickFeishuCatalogSheets(sheets) {
  const list = Array.isArray(sheets) ? sheets.filter((sheet) => sheet?.id) : [];
  const featured = list.find((sheet) => String(sheet.title || "").includes("重点书单"));
  const hits = list.find((sheet) => String(sheet.title || "").includes("历史爆款"));
  return [featured, hits].filter(Boolean);
}

export function isFeaturedSheetTitle(title) {
  return String(title || "").includes("重点书单");
}

export function parseFeishuImportRows(rows, { sheetId = "", sheetTitle = "" } = {}) {
  if (!Array.isArray(rows) || !rows.length) return { headerRow: 0, headers: [], books: [] };
  const headerIndex = detectHeaderRow(rows);
  const rawHeaders = rows[headerIndex] || [];
  const width = Math.max(rawHeaders.length, ...rows.slice(headerIndex + 1, headerIndex + 40).map((row) => Array.isArray(row) ? row.length : 0), 1);
  const headers = Array.from({ length: width }, (_, index) => String(rawHeaders[index] || "").trim() || `列${index + 1}`);
  const fieldIndexes = mapFieldIndexes(headers, rows.slice(headerIndex + 1, headerIndex + 80));
  const featured = isFeaturedSheetTitle(sheetTitle);
  const books = [];

  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const title = valueAt(row, fieldIndexes.title);
    if (!title || title.length > 600 || /^(日期|书名|英文书名)$/i.test(title)) continue;
    books.push({
      rowNumber: index + 1,
      sheetId,
      sheetTitle,
      featured,
      date: normalizeDate(valueAt(row, fieldIndexes.date)),
      title,
      bookId: valueAt(row, fieldIndexes.bookId),
      category: valueAt(row, fieldIndexes.channel),
      sellingPoint: valueAt(row, fieldIndexes.sellingPoint),
      note: valueAt(row, fieldIndexes.note),
      sourceContent: valueAt(row, fieldIndexes.content) || valueAt(row, fieldIndexes.reason)
    });
  }

  return { headerRow: headerIndex + 1, headers, books };
}

export function mergeFeishuImportBooks(books) {
  const merged = new Map();
  for (const book of Array.isArray(books) ? books : []) {
    const title = String(book.title || "").trim();
    const key = normalizeNovelTitle(title);
    if (!key) continue;
    const current = {
      ...book,
      title,
      featured: Boolean(book.featured),
      date: String(book.date || "").trim(),
      bookId: String(book.bookId || "").trim(),
      category: String(book.category || "").trim(),
      sellingPoint: String(book.sellingPoint || "").trim(),
      note: String(book.note || "").trim(),
      sourceContent: String(book.sourceContent || "").trim()
    };
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, current);
      continue;
    }
    merged.set(key, {
      ...prev,
      featured: prev.featured || current.featured,
      date: prev.date || current.date,
      bookId: prev.bookId || current.bookId,
      category: prev.category || current.category,
      sellingPoint: longerText(prev.sellingPoint, current.sellingPoint),
      note: longerText(prev.note, current.note),
      sourceContent: longerText(prev.sourceContent, current.sourceContent),
      sheetTitle: [prev.sheetTitle, current.sheetTitle].filter(Boolean).join(" / ")
    });
  }
  return [...merged.values()];
}

export function applyFeishuCatalogImport(novels, books, { now = new Date().toISOString(), createId } = {}) {
  const next = (Array.isArray(novels) ? novels : []).map((novel) => ({ ...novel }));
  const existing = new Set(next.map((novel) => normalizeNovelTitle(novel.title)).filter(Boolean));
  const details = [];
  let created = 0;
  let skipped = 0;
  const makeId = typeof createId === "function" ? createId : () => `novel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  for (const book of mergeFeishuImportBooks(books)) {
    const title = book.title.slice(0, 180);
    const titleKey = normalizeNovelTitle(title);
    if (existing.has(titleKey)) {
      skipped += 1;
      const novel = next.find((item) => normalizeNovelTitle(item.title) === titleKey);
      if (novel && !String(novel.bookId || "").trim() && book.bookId) {
        novel.bookId = book.bookId.slice(0, 240);
        novel.updatedAt = now;
      }
      details.push({ title, reason: "exists" });
      continue;
    }

    const createdAt = toCreatedAt(book.date) || now;
    const novel = {
      id: String(makeId() || "").trim() || `novel-${Date.now()}`,
      title,
      platform: "NovelMaster",
      bookId: book.bookId.slice(0, 240),
      promotionCode: "",
      promotionCopy: "",
      category: book.category.slice(0, 120),
      featured: Boolean(book.featured),
      sellingPoint: book.sellingPoint.slice(0, 2_000),
      note: book.note.slice(0, 2_000),
      sourceContent: book.sourceContent.slice(0, 200_000),
      status: "active",
      createdAt,
      updatedAt: now
    };
    next.push(novel);
    existing.add(titleKey);
    created += 1;
    details.push({ title: novel.title, novelId: novel.id, reason: "created", featured: novel.featured });
  }

  return { novels: next, created, skipped, details };
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
    date: find("上架日期", "上新日期", "日期"),
    title: find(...TITLE_ALIASES),
    bookId: find("英文书id", "书籍id", "书id"),
    channel: find("频道"),
    sellingPoint: find("小说卖点", "卖点"),
    note: find("备注"),
    content: find(...CONTENT_ALIASES),
    reason: find("推荐理由")
  };

  if (mapped.content < 0) {
    const used = new Set(Object.values(mapped).filter((index) => index >= 0));
    let bestIndex = -1;
    let bestLength = 0;
    for (let column = 0; column < headers.length; column++) {
      if (used.has(column)) continue;
      const average = averageColumnLength(sampleRows, column);
      if (average > bestLength && average >= 80) {
        bestLength = average;
        bestIndex = column;
      }
    }
    mapped.content = bestIndex;
  }
  return mapped;
}

function averageColumnLength(rows, column) {
  const lengths = rows.map((row) => String(row?.[column] || "").trim().length).filter(Boolean);
  return lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 0;
}

function isKnownHeader(value) {
  return KNOWN_HEADERS.some((header) => normalizeHeader(header) === value);
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function valueAt(row, index) {
  return index >= 0 ? cellText(row[index]) : "";
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

function longerText(left, right) {
  return String(right || "").length > String(left || "").length ? String(right || "") : String(left || "");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(raw)) {
    const [year, month, day] = raw.replaceAll("/", "-").split("-");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return raw;
}

function toCreatedAt(date) {
  const day = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00.000Z` : "";
}
