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
  const keep = (Array.isArray(existing) ? existing : []).filter((card) => normalizeCardGroup(card.template || card.kind) !== kind);
  const merged = [...keep, ...taggedIncoming];
  const ordered = [
    ...merged.filter((card) => normalizeCardGroup(card.template || card.kind) === "cover"),
    ...merged.filter((card) => normalizeCardGroup(card.template || card.kind) !== "cover"),
  ];
  const cap = Math.max(1, Math.min(6, Number(limit) || 6));
  const cards = ordered.slice(0, cap);
  const nextKeys = new Set(cards.map((card) => card.key));
  return {
    cards,
    removed: (Array.isArray(existing) ? existing : []).filter((card) => !nextKeys.has(card.key)),
  };
}

export function formatCoverQuote(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[“"'][\s\S]*[”"']$/.test(text)) return text;
  return `“${text}”`;
}

export function parseCardBullets(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
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

export function buildPerImageCopySlides({ title, subtitle, copies, body, count, smash } = {}) {
  const heading = String(title || "").trim();
  const caption = String(subtitle || "").trim();
  const applySmash = (line) => smash ? smashCardWords(line) : line;
  const fields = Array.isArray(copies)
    ? normalizeCopyFields(copies, count)
    : splitContentCardBodies(body, count, smash).map((lines) => lines.join("\n"));
  const slides = normalizeCopyFields(fields, count).map((field, index) => ({
    kind: index === 0 ? "cover" : "block",
    title: index === 0 ? applySmash(heading) : "",
    subtitle: index === 0 ? applySmash(caption) : "",
    lines: linesFromCopyField(field, smash),
  }));
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
    const text = String(line || "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
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
  const groups = Array.isArray(copies)
    ? normalizeCopyFields(copies, count).map((field) => linesFromCopyField(field, smash))
    : splitContentCardBodies(body, count, smash);
  if (!heading && !groups.some((group) => group.length)) throw Object.assign(new Error("请填写内容标题或文案。"), { statusCode: 400 });
  if (!groups.length) {
    return [{
      kind: "content",
      title: smash ? smashCardWords(heading) : heading,
      accent: mark,
      bullets: [],
    }].filter((slide) => slide.title);
  }
  return groups.map((bullets, index) => ({
    kind: "content",
    title: index === 0 ? (smash ? smashCardWords(heading) : heading) : "",
    accent: index === 0 ? mark : "",
    bullets,
  }));
}
