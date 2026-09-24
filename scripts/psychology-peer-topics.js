// Fixed topic labels grokbot may attach to a viral post. Ops reports group by these ids.
export const PEER_TOPICS = Object.freeze([
  ['anxious', '焦虑型依恋'],
  ['avoidant', '回避型依恋'],
  ['breakup', '分手'],
  ['situationship', '暧昧'],
  ['boundaries', '边界感'],
  ['self-worth', '自我价值'],
]);
export const TOPIC_LABELS = Object.fromEntries(PEER_TOPICS);
const BY_LABEL = new Map(PEER_TOPICS.flatMap(([id, label]) => [[id, id], [label, id]]));

// Returns topic ids, or null when the field was omitted. Throws Error when present but invalid.
export function parseTopics(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('topics 须为 1–3 个题材标签。');
  const ids = [];
  for (const item of value) {
    const id = BY_LABEL.get(String(item || '').trim());
    if (!id) throw new Error('topics 只能是：' + PEER_TOPICS.map(([, label]) => label).join('、') + '。');
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
