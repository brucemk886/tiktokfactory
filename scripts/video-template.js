export const VIDEO_TEMPLATE_MIX = "mix";
export const VIDEO_TEMPLATE_PARKOUR = "parkour";
export const DEFAULT_PARKOUR_VIDEO_DIR = "D:\\方块跑酷模拟器视频\\0818";

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

export function pickUnusedParkourSource(videoMeta = [], { usedIds, usage } = {}) {
  const used = new Set([...(usedIds || [])].map((value) => String(value || "").trim()).filter(Boolean));
  const unused = (Array.isArray(videoMeta) ? videoMeta : []).filter((source) => {
    const id = String(source?.id || "");
    const file = String(source?.file || "");
    if (!id && !file) return false;
    if (used.has(id) || used.has(file)) return false;
    if (Number(usage?.assets?.[id]?.usedCount || 0) > 0) return false;
    return true;
  });
  if (!unused.length) return null;
  return unused[Math.floor(Math.random() * unused.length)];
}
