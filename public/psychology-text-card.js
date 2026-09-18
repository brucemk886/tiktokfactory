export const TEXT_CARD_ASPECTS = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "3:4": { width: 1080, height: 1440 },
  "9:16": { width: 1080, height: 1920 },
};

export function cardCanvasSize(aspectRatio) {
  return TEXT_CARD_ASPECTS[aspectRatio] || TEXT_CARD_ASPECTS["1:1"];
}

export function planCenteredBlock(totalHeight, canvasHeight, pad) {
  return Math.max(pad, Math.round((canvasHeight - totalHeight) / 2));
}

export function smashCardWords(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

export function normalizeTextCardTemplate(value) {
  return value === "cover" ? "cover" : "content";
}

export function normalizeCardGroup(value) {
  if (value === "cover" || value === "stock") return value;
  return "content";
}

export function mergeTextCardSets(existing = [], incoming = [], group, limit = 6) {
  const kind = normalizeCardGroup(group);
  const taggedIncoming = (Array.isArray(incoming) ? incoming : []).map((card) => ({ ...card, template: card.template || kind }));
  const current = Array.isArray(existing) ? existing : [];
  const others = current.filter((card) => normalizeCardGroup(card.template || card.kind) !== kind);
  const same = current.filter((card) => normalizeCardGroup(card.template || card.kind) === kind);
  const cap = Math.max(1, Math.min(6, Number(limit) || 6));
  const sameNext = [...same, ...taggedIncoming].slice(0, cap);
  const merged = [...others, ...sameNext];
  const ordered = [
    ...merged.filter((card) => normalizeCardGroup(card.template || card.kind) === "cover"),
    ...merged.filter((card) => normalizeCardGroup(card.template || card.kind) !== "cover"),
  ];
  const nextKeys = new Set(ordered.map((card) => card.key));
  return {
    cards: ordered,
    removed: current.filter((card) => !nextKeys.has(card.key)),
  };
}

export function formatCoverQuote(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[“"'][\s\S]*[”"']$/.test(text)) return text;
  return `“${text}”`;
}

const LIST_PREFIX = /^(?:[\s\u00a0]*)(?:[-*–—•●◦‣⁃∙·▪▫]|[0-9]{1,2}[.)])+\s*/u;

export function stripListMarker(value) {
  let text = String(value || "").trim();
  for (let index = 0; index < 4; index += 1) {
    const next = text.replace(LIST_PREFIX, "").trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

export function parseCardBullets(value) {
  return String(value || "").split(/\r?\n/).map((line) => stripListMarker(line)).filter(Boolean);
}

export function wrapLines(text, measure, maxWidth) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const words = raw.includes(" ") ? raw.split(/\s+/).filter(Boolean) : [raw];
  const lines = [];
  let current = "";
  const append = (word) => {
    if (measure(word) > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let chunk = "";
      for (const character of word) {
        const next = chunk + character;
        if (chunk && measure(next) > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk = next;
        }
      }
      current = chunk;
      return;
    }
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  };
  words.forEach(append);
  if (current) lines.push(current);
  return lines;
}

export function wrapOverlayLines(text, measure, maxWidth, smash = false) {
  if (!smash) return wrapLines(text, measure, maxWidth);
  const raw = String(text || "").trim();
  if (!raw) return [];
  const words = raw.includes(" ") ? raw.split(/\s+/).filter(Boolean) : [raw];
  const lines = [];
  let current = [];
  const widthOf = (parts) => measure(smashCardWords(parts.join(" ")));
  for (const word of words) {
    const next = [...current, word];
    if (current.length && widthOf(next) > maxWidth) {
      lines.push(smashCardWords(current.join(" ")));
      current = [word];
    } else {
      current = next;
    }
  }
  if (current.length) lines.push(smashCardWords(current.join(" ")));
  return lines.flatMap((line) => (measure(line) <= maxWidth ? [line] : wrapLines(line, measure, maxWidth)));
}

export function splitEven(total, count) {
  const safeCount = Math.max(1, Math.min(6, Number(count) || 1));
  const size = Math.max(0, Number(total) || 0);
  if (!size) return [0];
  const used = Math.min(safeCount, size);
  const base = Math.floor(size / used);
  const extra = size % used;
  return Array.from({ length: used }, (_, index) => base + (index < extra ? 1 : 0));
}

export function parseOverlayBlocks(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trimEnd());
  const blocks = [];
  let current = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(trimmed);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

export function linesFromCopyField(value, smash = false) {
  return String(value || "").split(/\r?\n/).map((line) => {
    const text = line.trim();
    return smash ? smashCardWords(text) : text;
  }).filter(Boolean);
}

export function normalizeCopyFields(copies, count) {
  const list = Array.isArray(copies) ? copies.map((value) => String(value ?? "")) : [];
  const limit = Math.max(1, Math.min(6, Number(count) || list.length || 1));
  return Array.from({ length: limit }, (_, index) => list[index] || "");
}

export function buildPerImageCopySlides({ title, subtitle, copies, body, count, smash, kind } = {}) {
  const heading = String(title || "").trim();
  const caption = String(subtitle || "").trim();
  const fields = Array.isArray(copies)
    ? normalizeCopyFields(copies, count)
    : splitContentCardBodies(body, count, false).map((lines) => lines.join("\n"));
  const slides = normalizeCopyFields(fields, count).map((field, index) => {
    const headingPage = Boolean(kind) || index === 0;
    return {
      kind: kind || (index === 0 ? "cover" : "block"),
      smash: Boolean(smash),
      title: headingPage ? heading : "",
      subtitle: headingPage ? caption : "",
      lines: linesFromCopyField(field, false),
    };
  });
  return slides;
}

export function buildStockOverlaySlides(options = {}) {
  const slides = buildPerImageCopySlides(options);
  if (!slides.some((slide) => slide.title || slide.subtitle || slide.lines.length)) {
    throw Object.assign(new Error("请填写每张图片的文案。"), { statusCode: 400 });
  }
  return slides;
}

export function splitContentCardBodies(body, count, smash = false) {
  const clean = (line) => {
    const text = stripListMarker(line);
    return smash ? smashCardWords(text) : text;
  };
  const blocks = parseOverlayBlocks(body).map((block) => block.map(clean).filter(Boolean)).filter((block) => block.length);
  const limit = Math.max(1, Math.min(6, Number(count) || 1));
  if (blocks.length > 1) return blocks.slice(0, limit);
  const bullets = parseCardBullets(body).map((line) => smash ? smashCardWords(line) : line);
  if (!bullets.length) return [];
  const sizes = splitEven(bullets.length, limit);
  let offset = 0;
  return sizes.map((size) => {
    const slice = bullets.slice(offset, offset + size);
    offset += size;
    return slice;
  }).filter((slice) => slice.length);
}

export function buildTextCardSlides({ title, body, copies, accent, count, smash, template } = {}) {
  const heading = String(title || "").trim();
  const mark = String(accent || "").trim();
  const kind = normalizeTextCardTemplate(template);
  if (kind === "cover") {
    const quote = smash ? smashCardWords(heading) : heading;
    if (!quote) throw Object.assign(new Error("请填写封面文案。"), { statusCode: 400 });
    return [{
      kind: "cover",
      title: formatCoverQuote(quote),
      accent: "",
      bullets: [],
    }];
  }
  const bullets = parseCardBullets(Array.isArray(copies) ? copies[0] : body).map((line) => smash ? smashCardWords(line) : line);
  if (!heading && !bullets.length) throw Object.assign(new Error("请填写内容标题或文案。"), { statusCode: 400 });
  return [{
    kind: "content",
    title: smash ? smashCardWords(heading) : heading,
    accent: mark,
    bullets,
  }];
}
