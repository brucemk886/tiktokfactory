import { cardCanvasSize, wrapLines, wrapOverlayLines, planCenteredBlock, parseEmphasisRuns } from "./psychology-text-card.js";

const COVER_BG = "#111111";
const COVER_INK = "#f4f1ea";

export function renderTextCard(slide, aspectRatio) {
  return slide.kind === "cover" ? renderCoverCard(slide, aspectRatio) : renderContentCard(slide, aspectRatio);
}

function renderCoverCard(slide, aspectRatio) {
  const { width, height } = cardCanvasSize(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COVER_BG;
  ctx.fillRect(0, 0, width, height);
  const pad = Math.round(width * 0.12);
  const family = '"Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif';
  let size = Math.round(width * 0.078);
  let lines = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ctx.font = `600 ${size}px ${family}`;
    lines = wrapLines(slide.title, (text) => ctx.measureText(text).width, width - pad * 2);
    if (lines.length * size * 1.18 <= height - pad * 2 || attempt === 7) break;
    size = Math.max(28, Math.round(size * 0.9));
  }
  ctx.fillStyle = COVER_INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${size}px ${family}`;
  let y = planCenteredBlock(lines.length * size * 1.18, height, pad);
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += size * 1.18;
  }
  return canvas;
}

function renderContentCard(slide, aspectRatio) {
  const { width, height } = cardCanvasSize(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const pad = Math.round(width * 0.1);
  const maxWidth = width - pad * 2;
  const family = '"Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif';
  const blocks = (Array.isArray(slide.bullets) && slide.bullets.length ? slide.bullets : [slide.title]).filter(Boolean);
  const pageNumber = Number(slide.pageNumber) || 0;
  const doodle = slide.doodle !== false && blocks.length === 1;
  let size = Math.round(width * (blocks.length > 1 ? 0.042 : 0.048));
  let packed = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    packed = layoutEmphasisBlocks(ctx, blocks, maxWidth, size, family);
    const budget = height - pad * 2 - (doodle ? Math.round(height * 0.28) : 0) - (pageNumber ? Math.round(width * 0.12) : 0);
    if (packed.total <= budget || attempt === 7) break;
    size = Math.max(28, Math.round(size * 0.9));
  }
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, width, height);
  if (pageNumber) {
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `600 ${Math.round(width * 0.052)}px ${family}`;
    ctx.fillText(`${pageNumber}.`, width / 2, Math.round(height * 0.09));
  }
  const textTop = pageNumber ? Math.round(height * 0.22) : pad;
  const textBottom = doodle ? Math.round(height * 0.68) : height - pad;
  let y = textTop + Math.max(0, Math.round((textBottom - textTop - packed.total) / 2));
  ctx.textBaseline = "top";
  ctx.fillStyle = "#171717";
  for (const line of packed.lines) {
    if (line.gap) {
      y += line.gap;
      continue;
    }
    let x = Math.round((width - line.width) / 2);
    ctx.textAlign = "left";
    for (const part of line.parts) {
      ctx.font = `${part.bold ? 700 : 400} ${size}px ${family}`;
      ctx.fillText(part.text, x, y);
      x += part.width;
    }
    y += size * 1.28;
  }
  if (doodle) drawContentDoodle(ctx, width, height, pageNumber || 1);
  return canvas;
}

function layoutEmphasisBlocks(ctx, blocks, maxWidth, size, family) {
  const measure = (text, bold) => {
    ctx.font = `${bold ? 700 : 400} ${size}px ${family}`;
    return ctx.measureText(text).width;
  };
  const lines = [];
  for (const [index, block] of blocks.entries()) {
    if (index) lines.push({ gap: size * 0.9 });
    const runs = parseEmphasisRuns(block);
    const tokens = [];
    for (const run of runs) {
      for (const token of run.text.split(/(\s+)/).filter(Boolean)) {
        tokens.push({ text: token, bold: run.bold, space: /^\s+$/.test(token) });
      }
    }
    let current = [];
    let width = 0;
    const flush = () => {
      if (!current.length) return;
      lines.push({ parts: current, width });
      current = [];
      width = 0;
    };
    for (const token of tokens) {
      if (token.space && !current.length) continue;
      const tokenWidth = measure(token.text, token.bold);
      if (current.length && !token.space && width + tokenWidth > maxWidth) flush();
      current.push({ ...token, width: tokenWidth });
      width += tokenWidth;
    }
    flush();
  }
  const total = lines.reduce((sum, line) => sum + (line.gap || size * 1.28), 0);
  return { lines, total };
}

function drawContentDoodle(ctx, width, height, pageNumber) {
  const variant = ((Number(pageNumber) || 1) - 1) % 6;
  const s = width / 1080;
  const cx = width / 2;
  const y = height - 12 * s;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (variant === 0) doodleYoga(ctx, cx, y, s);
  else if (variant === 1) doodlePapers(ctx, cx, y, s);
  else if (variant === 2) doodlePhone(ctx, cx, y, s);
  else if (variant === 3) doodleDistance(ctx, cx, y, s);
  else if (variant === 4) doodleHug(ctx, cx, y, s);
  else doodleWalk(ctx, cx, y, s);
  ctx.restore();
}

function doodleHead(ctx, x, y, r, hair, face) {
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.15, r * 1.05, r * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function doodleYoga(ctx, cx, y, s) {
  ctx.fillStyle = "#7eb6e8";
  ctx.beginPath();
  ctx.moveTo(cx - 92 * s, y);
  ctx.lineTo(cx - 58 * s, y - 210 * s);
  ctx.lineTo(cx + 58 * s, y - 210 * s);
  ctx.lineTo(cx + 92 * s, y);
  ctx.closePath();
  ctx.fill();
  doodleHead(ctx, cx, y - 168 * s, 28 * s, "#e36d7a", "#f3c2b0");
  ctx.strokeStyle = "#f3c2b0";
  ctx.lineWidth = 14 * s;
  ctx.beginPath();
  ctx.moveTo(cx - 38 * s, y - 128 * s);
  ctx.quadraticCurveTo(cx - 70 * s, y - 150 * s, cx - 42 * s, y - 178 * s);
  ctx.moveTo(cx + 38 * s, y - 128 * s);
  ctx.quadraticCurveTo(cx + 70 * s, y - 150 * s, cx + 42 * s, y - 178 * s);
  ctx.stroke();
  ctx.fillStyle = "#f4b39a";
  ctx.beginPath();
  ctx.moveTo(cx - 34 * s, y - 138 * s);
  ctx.quadraticCurveTo(cx, y - 118 * s, cx + 34 * s, y - 138 * s);
  ctx.lineTo(cx + 28 * s, y - 40 * s);
  ctx.lineTo(cx - 28 * s, y - 40 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ead18a";
  ctx.fillRect(cx - 26 * s, y - 48 * s, 52 * s, 70 * s);
}

function doodlePapers(ctx, cx, y, s) {
  ctx.fillStyle = "#efe7d8";
  for (let i = 0; i < 5; i += 1) {
    ctx.save();
    ctx.translate(cx, y - 18 * s - i * 16 * s);
    ctx.rotate((i - 2) * 0.04);
    ctx.fillRect(-70 * s, -18 * s, 140 * s, 28 * s);
    ctx.restore();
  }
  doodleHead(ctx, cx, y - 148 * s, 26 * s, "#b08968", "#e8b9a4");
  ctx.fillStyle = "#c9d4de";
  ctx.beginPath();
  ctx.moveTo(cx - 42 * s, y - 118 * s);
  ctx.quadraticCurveTo(cx, y - 70 * s, cx + 42 * s, y - 118 * s);
  ctx.lineTo(cx + 50 * s, y - 36 * s);
  ctx.lineTo(cx - 50 * s, y - 36 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#e8b9a4";
  ctx.lineWidth = 12 * s;
  ctx.beginPath();
  ctx.moveTo(cx - 46 * s, y - 96 * s);
  ctx.lineTo(cx - 86 * s, y - 38 * s);
  ctx.moveTo(cx + 46 * s, y - 96 * s);
  ctx.lineTo(cx + 86 * s, y - 38 * s);
  ctx.stroke();
}

function doodlePhone(ctx, cx, y, s) {
  doodleHead(ctx, cx - 8 * s, y - 176 * s, 26 * s, "#4c4c4c", "#f0c3ae");
  ctx.fillStyle = "#8eb6d4";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(cx - 36 * s, y - 148 * s, 72 * s, 110 * s, 18 * s);
  else ctx.rect(cx - 36 * s, y - 148 * s, 72 * s, 110 * s);
  ctx.fill();
  ctx.fillStyle = "#dfe7c8";
  ctx.fillRect(cx - 30 * s, y - 42 * s, 28 * s, 70 * s);
  ctx.fillRect(cx + 4 * s, y - 42 * s, 28 * s, 70 * s);
  ctx.fillStyle = "#222";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(cx + 38 * s, y - 132 * s, 22 * s, 36 * s, 4 * s);
  else ctx.rect(cx + 38 * s, y - 132 * s, 22 * s, 36 * s);
  ctx.fill();
  ctx.strokeStyle = "#f0c3ae";
  ctx.lineWidth = 11 * s;
  ctx.beginPath();
  ctx.moveTo(cx + 32 * s, y - 118 * s);
  ctx.lineTo(cx + 48 * s, y - 108 * s);
  ctx.stroke();
}

function doodleDistance(ctx, cx, y, s) {
  doodleHead(ctx, cx - 90 * s, y - 150 * s, 22 * s, "#6b4f3a", "#ebb49c");
  doodleHead(ctx, cx + 90 * s, y - 150 * s, 22 * s, "#c45c6a", "#f3c2b0");
  ctx.fillStyle = "#d7c4a8";
  ctx.fillRect(cx - 108 * s, y - 126 * s, 36 * s, 90 * s);
  ctx.fillStyle = "#f4b39a";
  ctx.fillRect(cx + 72 * s, y - 126 * s, 36 * s, 90 * s);
}

function doodleHug(ctx, cx, y, s) {
  doodleHead(ctx, cx, y - 158 * s, 26 * s, "#8a6a52", "#eac0ab");
  ctx.strokeStyle = "#eac0ab";
  ctx.lineWidth = 14 * s;
  ctx.beginPath();
  ctx.arc(cx, y - 88 * s, 38 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#cfd6c4";
  ctx.beginPath();
  ctx.ellipse(cx, y - 70 * s, 40 * s, 48 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function doodleWalk(ctx, cx, y, s) {
  doodleHead(ctx, cx + 10 * s, y - 176 * s, 24 * s, "#3f3f3f", "#efc2ad");
  ctx.fillStyle = "#9bb7c9";
  ctx.beginPath();
  ctx.moveTo(cx - 8 * s, y - 150 * s);
  ctx.lineTo(cx + 28 * s, y - 150 * s);
  ctx.lineTo(cx + 18 * s, y - 48 * s);
  ctx.lineTo(cx - 18 * s, y - 48 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#efc2ad";
  ctx.lineWidth = 12 * s;
  ctx.beginPath();
  ctx.moveTo(cx + 22 * s, y - 128 * s);
  ctx.lineTo(cx + 58 * s, y - 88 * s);
  ctx.moveTo(cx - 4 * s, y - 46 * s);
  ctx.lineTo(cx - 28 * s, y);
  ctx.moveTo(cx + 12 * s, y - 46 * s);
  ctx.lineTo(cx + 42 * s, y);
  ctx.stroke();
}

export function renderOverlayCard(slide, image, aspectRatio, { grayscale = false } = {}) {
  const { width, height } = cardCanvasSize(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (grayscale) ctx.filter = "grayscale(1)";
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
  const pad = Math.round(width * 0.08);
  const smash = slide.smash === true;
  const isCover = slide.kind === "cover";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let titleSize = Math.round(width * (isCover ? 0.092 : 0.062));
  let bodySize = Math.round(width * 0.052);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const lines = [];
    if (slide.title) {
      ctx.font = `700 ${titleSize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
      wrapOverlayLines(slide.title, (text) => ctx.measureText(text).width, width - pad * 2, smash).forEach((line, index, packed) => {
        lines.push({ text: line, size: titleSize, weight: 700, gap: titleSize * 1.12 + (index === packed.length - 1 ? titleSize * 0.32 : 0) });
      });
    }
    if (slide.subtitle) {
      ctx.font = `600 ${bodySize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
      wrapOverlayLines(slide.subtitle, (text) => ctx.measureText(text).width, width - pad * 2, smash).forEach((line, index, packed) => {
        lines.push({ text: line, size: bodySize, weight: 600, gap: bodySize * 1.35 + (index === packed.length - 1 ? bodySize * 0.5 : 0) });
      });
    }
    ctx.font = `600 ${bodySize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
    for (const line of slide.lines || []) {
      // Paragraph spacing goes after the LAST wrapped part of each logical
      // line; wrapped continuations keep the normal line height.
      wrapOverlayLines(line, (text) => ctx.measureText(text).width, width - pad * 2, smash).forEach((part, index, packed) => {
        lines.push({ text: part, size: bodySize, weight: 600, gap: bodySize * 1.38 + (index === packed.length - 1 ? bodySize * 0.42 : 0) });
      });
    }
    const total = lines.reduce((sum, line) => sum + line.gap, 0);
    const budget = isCover ? Math.round(height * 0.44) : height - pad * 2;
    if (total <= budget || attempt === 7) {
      // Covers sit on the upper part of the photo like the reference posts;
      // content pages stay centered on their bright empty backgrounds.
      let y = isCover ? Math.round(height * 0.12) : planCenteredBlock(total, height, pad);
      paintOverlayScrim(ctx, width, y, total);
      ctx.fillStyle = "#0a0a0a";
      for (const line of lines) {
        ctx.font = `${line.weight} ${line.size}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
        ctx.fillText(line.text, width / 2, y);
        y += line.gap;
      }
      return canvas;
    }
    titleSize = Math.max(40, Math.round(titleSize * 0.9));
    bodySize = Math.max(30, Math.round(bodySize * 0.9));
  }
  return canvas;
}

// A soft white band behind the copy keeps dark text readable even when the
// matched photo is dark where the text lands.
function paintOverlayScrim(ctx, width, top, total) {
  if (!total) return;
  const margin = Math.round(total * 0.3) + 24;
  const start = Math.max(0, top - margin);
  const end = top + total + margin;
  const gradient = ctx.createLinearGradient(0, start, 0, end);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.62)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.62)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, start, width, end - start);
}

