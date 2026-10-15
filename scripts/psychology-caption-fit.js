// Append a call-to-action to a publishing caption without exceeding TikTok's caption limit.
// When the combined text is too long, the original caption is shortened (the CTA is always kept intact)
// so one long caption never blocks a whole publishing round.
export const TIKTOK_CAPTION_MAX = 2200;
const SEPARATOR = '\n\n';
const ELLIPSIS = '…';
const WORD_BOUNDARY_WINDOW = 80;

export function fitCaptionWithCTA(caption, cta, max = TIKTOK_CAPTION_MAX) {
  const base = String(caption || '').trim(), tail = String(cta || '');
  if (!tail) return { caption: base, truncated: false };
  if (base.endsWith(tail) && base.length <= max) return { caption: base, truncated: false };
  const joined = base ? base + SEPARATOR + tail : tail;
  if (joined.length <= max) return { caption: joined, truncated: false };
  const budget = max - SEPARATOR.length - tail.length - ELLIPSIS.length;
  if (budget < 1) throw Object.assign(new Error('承接引导文案过长，无法放入 ' + max + ' 字的发布文案，请缩短引导模板。'), { statusCode: 400 });
  let cut = '';
  for (const ch of base) { if (cut.length + ch.length > budget) break; cut += ch; }
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  if (boundary > 0 && cut.length - boundary <= WORD_BOUNDARY_WINDOW) cut = cut.slice(0, boundary);
  cut = cut.replace(/[\s#@]+$/u, '');
  return { caption: cut + ELLIPSIS + SEPARATOR + tail, truncated: true };
}
