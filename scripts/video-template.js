export const VIDEO_TEMPLATE_MIX = "mix";
export const VIDEO_TEMPLATE_PARKOUR = "parkour";
export const DEFAULT_PARKOUR_VIDEO_DIR = "D:\\方块跑酷模拟器视频\\0819";

export function normalizeVideoTemplate(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["parkour", "template-2", "template2", "2"].includes(raw)) return VIDEO_TEMPLATE_PARKOUR;
  return VIDEO_TEMPLATE_MIX;
}

export function isParkourVideoTemplate(value) {
  return normalizeVideoTemplate(value?.videoTemplate ?? value) === VIDEO_TEMPLATE_PARKOUR;
}

export function resolveParkourVideoDir(value) {
  const dir = String(value || "").trim();
  return dir || DEFAULT_PARKOUR_VIDEO_DIR;
}

export function parkourNeedsLoop(videoDuration, audioDuration) {
  return Number(videoDuration) + 0.05 < Number(audioDuration);
}

export function listUnusedParkourSources(videoMeta = [], { usedIds, usage } = {}) {
  const used = new Set([...(usedIds || [])].map((value) => String(value || "").trim()).filter(Boolean));
  return (Array.isArray(videoMeta) ? videoMeta : []).filter((source) => {
    const id = String(source?.id || "");
    const file = String(source?.file || "");
    if (!id && !file) return false;
    if (used.has(id) || used.has(file)) return false;
    if (Number(usage?.assets?.[id]?.usedCount || 0) > 0) return false;
    return true;
  });
}

export function pickUnusedParkourSource(videoMeta = [], options = {}) {
  const unused = listUnusedParkourSources(videoMeta, options);
  if (!unused.length) return null;
  return unused[Math.floor(Math.random() * unused.length)];
}

// Every parkour render is used once, so the footage we cut off is gone for
// good. Plan the bed to waste as little as possible:
//   1. a single video at least as long as the audio, the shortest such one;
//   2. otherwise (or when that single video would throw away more footage
//      than a concat of shorter ones) stitch unused shorter videos together,
//      longest first, finishing with the best-fitting remainder;
//   3. equal waste → prefer the single video (fewer cuts).
// Returns null when even all remaining footage is too short.
export function planParkourSources(videoMeta = [], audioDuration, options = {}) {
  const target = Number(audioDuration) || 0;
  if (target <= 0) return null;
  const unused = listUnusedParkourSources(videoMeta, options)
    .map((source) => ({ ...source, duration: Number(source.duration) || 0 }))
    .filter((source) => source.duration > 0)
    .sort((a, b) => a.duration - b.duration);
  if (!unused.length) return null;

  const single = unused.find((source) => source.duration + 0.05 >= target) || null;
  const singlePlan = single
    ? { mode: "single", sources: [single], totalDuration: single.duration, waste: round2(single.duration - target) }
    : null;

  const shorter = unused.filter((source) => source.duration + 0.05 < target);
  const concatPlan = planConcat(shorter, target);

  if (singlePlan && concatPlan) return singlePlan.waste <= concatPlan.waste ? singlePlan : concatPlan;
  return singlePlan || concatPlan;
}

function planConcat(shorter, target) {
  if (!shorter.length) return null;
  const pool = [...shorter].sort((a, b) => b.duration - a.duration);
  const picked = [];
  let remaining = target;
  while (remaining > 0.05 && pool.length) {
    // Best fit for what is left: the shortest clip that covers the remainder.
    const coverIndex = findLastIndex(pool, (source) => source.duration + 0.05 >= remaining);
    if (coverIndex >= 0) {
      picked.push(pool.splice(coverIndex, 1)[0]);
      remaining = 0;
      break;
    }
    // Nothing covers it alone: take the longest and keep going.
    const next = pool.shift();
    picked.push(next);
    remaining -= next.duration;
  }
  if (remaining > 0.05) return null;
  const totalDuration = picked.reduce((sum, source) => sum + source.duration, 0);
  return { mode: "concat", sources: picked, totalDuration, waste: round2(totalDuration - target) };
}

function findLastIndex(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (predicate(list[index])) return index;
  }
  return -1;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
