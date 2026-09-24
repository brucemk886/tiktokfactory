// Quality gate for rewrites Grokbot writes through the peer-hits API. A version
// failing any rule rejects the whole request, so the bot sees the reason and
// template or spliced output never reaches the library.
import { isEnglishPeerCopy } from '../../scripts/psychology-peer-language.js';

export const REWRITE_RULES = Object.freeze({ sharedLineChars: 20 });
const LINK = /https?:\/\/|www\.|link\s*in\s*(my\s*)?bio|linkinbio/i;
// Machine-joined fragments such as "Do they You track…" or "they Closeness".
const SPLICE = /\b(do|does|did|when|if|they|you|he|she|we)\s+(they|you|he|she|we)\s+(You|They|He|She|We|I)\b|\b(they|you|he|she|we)\s+(You|They|He|She|We|Closeness|Affection)\b/;
export const lineKey = text => String(text || '').trim().toLowerCase();
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const quote = text => '「' + String(text).slice(0, 60) + (String(text).length > 60 ? '…' : '') + '」';

// Rules one version must meet on its own. originalPages: the post's original page texts, if known.
export function checkRewrite(rewrite, originalPages = [], rules = REWRITE_RULES) {
  if (!rewrite.caption.trim()) fail('caption 不能为空，请写发布文案（简短即可）。');
  const originals = new Set(originalPages.map(lineKey).filter(line => line.length >= rules.sharedLineChars));
  rewrite.pages.forEach((page, index) => {
    const at = `第 ${index + 1} 页`;
    if (LINK.test(page) || LINK.test(rewrite.caption)) fail(`${at}或 caption 包含链接或引流（link in bio），请删除。`);
    if (originals.has(lineKey(page))) fail(`${at}原样照抄了原文 ${quote(page)}，改写需要换成新的表达。`);
    if (SPLICE.test(page)) fail(`${at}有拼接痕迹 ${quote(page)}，请由模型逐句重写，不要用程序拼接句子。`);
  });
  if (!isEnglishPeerCopy([rewrite.title, rewrite.caption, ...rewrite.pages].join('\n'))) fail('改写必须是英文。');
}

// Rules across posts: an image page may not repeat another post's rewrite word
// for word, in this request or anywhere in the library (deleted versions included).
// entries: [{ sourceKey, pages, label }]
export async function checkSharedLines(db, entries, rules = REWRITE_RULES) {
  const owners = new Map();
  for (const entry of entries) for (const page of entry.pages) {
    const key = lineKey(page);
    if (key.length < rules.sharedLineChars) continue;
    const seen = owners.get(key);
    if (seen && seen.sourceKey !== entry.sourceKey) fail(`${entry.label}：${quote(page)} 与本次提交里另一篇爆款的改写完全相同，疑似模板。每篇爆款请单独改写。`);
    if (!seen) owners.set(key, { sourceKey: entry.sourceKey, label: entry.label });
  }
  if (!owners.size) return;
  const clash = await db.prepare(`SELECT lower(trim(p.value)) AS line, v.source_key FROM psychology_copy_variants v, json_each(v.pages_json) p
    WHERE v.review_status='approved' AND lower(trim(p.value)) IN (SELECT value FROM json_each(?)) LIMIT 200`).bind(JSON.stringify([...owners.keys()])).all();
  for (const row of clash.results) {
    const mine = owners.get(row.line);
    if (mine && mine.sourceKey !== row.source_key) fail(`${mine.label}：${quote(row.line)} 与文案库里其他爆款的改写完全相同，疑似模板。每篇爆款请单独改写。`);
  }
}
