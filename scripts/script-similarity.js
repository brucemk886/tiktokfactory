// Near-duplicate detection for rewritten narration scripts. Two "versions"
// that differ only in a handful of words would be scheduled as two experiments
// and pollute the learning loop, and they cost a TTS run each.

export const DEFAULT_DUPLICATE_THRESHOLD = 0.9;

export function normalizeScriptText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_WORDS = 4000;

export function scriptWords(value) {
  return normalizeScriptText(value).split(" ").filter(Boolean).slice(0, MAX_WORDS);
}

// 1 - (word edit distance / longer length), 0..1. "0.9" means nine words in
// ten are the same words in the same order, which reads as the same script
// to a viewer even if a few adjectives were swapped.
export function scriptSimilarity(left, right) {
  const a = scriptWords(left);
  const b = scriptWords(right);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const longest = Math.max(a.length, b.length);
  return 1 - wordEditDistance(a, b) / longest;
}

function wordEditDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

export function findNearDuplicateScript(text, scripts = [], { threshold = DEFAULT_DUPLICATE_THRESHOLD } = {}) {
  const normalized = normalizeScriptText(text);
  if (!normalized) return null;
  let best = null;
  for (const script of Array.isArray(scripts) ? scripts : []) {
    const other = String(script?.text || "");
    if (!other.trim()) continue;
    if (normalizeScriptText(other) === normalized) return { script, similarity: 1 };
    const similarity = scriptSimilarity(normalized, other);
    if (similarity >= threshold && (!best || similarity > best.similarity)) best = { script, similarity };
  }
  return best;
}

// The spoken call to action must point at this novel's own code and app.
// Returns "" when consistent, otherwise a human-readable problem.
export function promotionCtaMismatch(text, { promotionCode = "", platform = "" } = {}) {
  const body = String(text || "");
  const code = String(promotionCode || "").trim();
  const app = String(platform || "").trim().toLowerCase().replace(/\s+/g, "");
  const ctaPattern = /\bsearch\s+(?:for\s+)?(?:the\s+code\s+|code\s+)?["“']?([A-Za-z0-9][A-Za-z0-9_-]{2,60})["”']?\s+(?:on|in)\s+(?:the\s+)?(good\s*novel|novel\s*master|moto\s*novel)/gi;
  const matches = [...body.matchAll(ctaPattern)];
  if (!matches.length) return "";
  for (const match of matches) {
    const spokenCode = String(match[1] || "").trim();
    const spokenApp = String(match[2] || "").toLowerCase().replace(/\s+/g, "");
    if (code && spokenCode.toLowerCase() !== code.toLowerCase()) {
      return `文案里的搜索码是「${spokenCode}」，这本书的推广码是「${code}」。`;
    }
    if (app && spokenApp !== app) {
      return `文案里让人去「${match[2]}」搜，这本书的平台是「${platform}」。`;
    }
  }
  return "";
}
