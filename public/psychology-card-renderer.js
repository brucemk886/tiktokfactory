import { cardCanvasSize, wrapLines, wrapOverlayLines, planCenteredBlock, stripListMarker } from "./psychology-text-card.js";

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
  const pad = Math.round(width * 0.085);
  const maxWidth = width - pad * 2;
  const family = '"Avenir Next","Segoe UI",Helvetica,Arial,sans-serif';
  let titleSize = Math.round(width * 0.082);
  let bodySize = Math.round(width * 0.042);
  let pack = { titleLines: [], bullets: [], total: 0 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ctx.font = `800 ${titleSize}px ${family}`;
    const titleLines = slide.title ? wrapLines(slide.title, (text) => ctx.measureText(text).width, maxWidth) : [];
    ctx.font = `400 ${bodySize}px ${family}`;
    const mark = "•  ";
    const markWidth = ctx.measureText(mark).width;
    const bullets = [];
    for (const bullet of slide.bullets) {
      const text = stripListMarker(bullet);
      const lines = wrapLines(text, (t) => ctx.measureText(t).width, maxWidth - markWidth);
      if (lines.length) bullets.push(lines);
    }
    const titleHeight = titleLines.length ? titleLines.length * titleSize * 1.08 + titleSize * 0.55 : 0;
    const bodyHeight = bullets.reduce((sum, lines) => sum + lines.length * bodySize * 1.42 + bodySize * 0.28, 0);
    pack = { titleLines, bullets, mark, markWidth, titleHeight, total: titleHeight + bodyHeight };
    if (pack.total <= height - pad * 2 || attempt === 7) break;
    titleSize = Math.max(36, Math.round(titleSize * 0.9));
    bodySize = Math.max(22, Math.round(bodySize * 0.9));
  }
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  let y = pad;
  ctx.textAlign = "left";
  ctx.fillStyle = "#111111";
  ctx.font = `800 ${titleSize}px ${family}`;
  for (const line of pack.titleLines) {
    ctx.fillText(line, pad, y);
    y += titleSize * 1.08;
  }
  if (pack.titleLines.length) y += titleSize * 0.55;
  const listTop = y;
  ctx.font = `400 ${bodySize}px ${family}`;
  for (const lines of pack.bullets) {
    lines.forEach((line, index) => {
      ctx.fillText(index === 0 ? `${pack.mark}${line}` : line, pad + (index === 0 ? 0 : pack.markWidth), y);
      y += bodySize * 1.42;
    });
    y += bodySize * 0.28;
  }
  if (slide.accent) {
    const accentSize = Math.max(24, Math.round(width * 0.038));
    ctx.fillStyle = "#e23b2e";
    ctx.font = `600 ${accentSize}px ${family}`;
    ctx.textAlign = "right";
    ctx.fillText(slide.accent, width - pad, listTop + bodySize * 1.2);
  }
  return canvas;
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
      ctx.font = `400 ${bodySize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
      wrapOverlayLines(slide.subtitle, (text) => ctx.measureText(text).width, width - pad * 2, smash).forEach((line, index, packed) => {
        lines.push({ text: line, size: bodySize, weight: 400, gap: bodySize * 1.35 + (index === packed.length - 1 ? bodySize * 0.5 : 0) });
      });
    }
    ctx.font = `400 ${bodySize}px "Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`;
    for (const line of slide.lines || []) {
      // Paragraph spacing goes after the LAST wrapped part of each logical
      // line; wrapped continuations keep the normal line height.
      wrapOverlayLines(line, (text) => ctx.measureText(text).width, width - pad * 2, smash).forEach((part, index, packed) => {
        lines.push({ text: part, size: bodySize, weight: 400, gap: bodySize * 1.38 + (index === packed.length - 1 ? bodySize * 0.42 : 0) });
      });
    }
    const total = lines.reduce((sum, line) => sum + line.gap, 0);
    const budget = isCover ? Math.round(height * 0.44) : height - pad * 2;
    if (total <= budget || attempt === 7) {
      // Covers sit on the upper part of the photo like the reference posts;
      // content pages stay centered on their bright empty backgrounds.
      let y = isCover ? Math.round(height * 0.12) : planCenteredBlock(total, height, pad);
      paintOverlayScrim(ctx, width, y, total);
      ctx.fillStyle = "#111111";
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

