import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { CHOICE_LABELS, hasCompleteFourImages } from "./psychology-topic-bank.js";

export function normalizeChoiceImages(value) {
  if (!Array.isArray(value) || value.length !== 4) return [];
  return CHOICE_LABELS.map((label, index) => {
    const item = value[index] && typeof value[index] === "object" ? value[index] : {};
    return {
      label,
      copy: String(item.copy || item.text || "").trim().slice(0, 80),
      imageKey: String(item.imageKey || "").trim(),
      imageUrl: String(item.imageUrl || item.url || "").trim(),
      imagePath: String(item.imagePath || "").trim(),
      dataUrl: String(item.dataUrl || item.imageBase64 || "").trim(),
    };
  });
}

export function workerTopicImagePath(choice) {
  const match = String(choice?.imageKey || "").match(/^psychology-topics\/([0-9a-f-]{36})\.(jpe?g|png|webp)$/i);
  if (!match) return "";
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  return `/api/worker/psychology-topic-images/${match[1]}.${ext}`;
}

export function fourChoiceLayout(aspectRatio) {
  const landscape = aspectRatio === "16:9";
  const width = landscape ? 1920 : 1080;
  const height = landscape ? 1080 : 1920;
  const titleH = landscape ? 140 : 240;
  const cols = landscape ? 4 : 2;
  const rows = landscape ? 1 : 2;
  return {
    landscape, width, height, titleH, cols, rows,
    cellW: Math.floor(width / cols),
    cellH: Math.floor((height - titleH) / rows),
  };
}

export function writeDataUrlFile(dataUrl, filePath) {
  const match = String(dataUrl || "").match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("选项图片编码无效。");
  fs.writeFileSync(filePath, Buffer.from(match[1].replace(/\s+/g, ""), "base64"));
}

export function buildFourChoiceFilter({ layout, fontFile, titleFile, copyFiles }) {
  const font = filterPath(fontFile || "C:/Windows/Fonts/msyh.ttc");
  const cells = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) {
      cells.push({ x: col * layout.cellW, y: layout.titleH + row * layout.cellH, index: row * layout.cols + col });
    }
  }
  const scaled = cells.map((cell) =>
    `[${cell.index + 1}:v]scale=${layout.cellW}:${layout.cellH}:force_original_aspect_ratio=increase,crop=${layout.cellW}:${layout.cellH},setsar=1[s${cell.index}]`
  );
  const overlays = cells.map((cell, index) => {
    const src = index === 0 ? "[0:v]" : `[t${index - 1}]`;
    const dst = index === cells.length - 1 ? "[grid]" : `[t${index}]`;
    return `${src}[s${cell.index}]overlay=${cell.x}:${cell.y}${dst}`;
  });
  const labels = cells.flatMap((cell) => {
    const copyY = cell.y + layout.cellH - 78;
    return [
      `drawbox=x=${cell.x + 16}:y=${cell.y + 18}:w=56:h=56:color=black@0.55:t=fill`,
      `drawtext=fontfile='${font}':text='${CHOICE_LABELS[cell.index]}':x=${cell.x + 28}:y=${cell.y + 26}:fontsize=36:fontcolor=white`,
      `drawbox=x=${cell.x + 12}:y=${copyY - 12}:w=${layout.cellW - 24}:h=72:color=black@0.45:t=fill`,
      `drawtext=fontfile='${font}':textfile='${filterPath(copyFiles[cell.index])}':reload=0:x=${cell.x + 24}:y=${copyY}:fontsize=28:fontcolor=white:line_spacing=6`,
    ];
  });
  return [...scaled, ...overlays, `[grid]${labels.join(",")}[final]`].join(";");
}

export function composeFourChoiceImage({ choices, outputPath, aspectRatio, fontFile, ffmpeg = "ffmpeg" }) {
  if (!hasCompleteFourImages(choices)) throw new Error("四图题目需要 A/B/C/D 四张图片和对应文案。");
  if (choices.some((item) => !item.imagePath || !fs.existsSync(item.imagePath))) throw new Error("四图选项图片缺失。");
  const layout = fourChoiceLayout(aspectRatio);
  const copyFiles = choices.map((_, index) => `${outputPath}.${CHOICE_LABELS[index]}.txt`);
  copyFiles.forEach((file, index) => fs.writeFileSync(file, wrapOverlay(choices[index].copy, layout.landscape ? 16 : 14), "utf8"));
  const graph = buildFourChoiceFilter({ layout, fontFile, copyFiles });
  const result = spawnSync(ffmpeg, [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", `color=c=0xf4efe4:s=${layout.width}x${layout.height}:d=1`,
    ...choices.flatMap((item) => ["-i", item.imagePath]),
    "-filter_complex", graph, "-map", "[final]", "-frames:v", "1", outputPath,
  ], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  for (const file of copyFiles) {
    try { fs.unlinkSync(file); } catch { /* keep output */ }
  }
  if (result.status !== 0) throw new Error(`拼合四图失败：${(result.stderr || result.stdout || "").slice(0, 1800)}`);
  if (!fs.existsSync(outputPath)) throw new Error("拼合四图后没有得到图片。");
  return outputPath;
}

function wrapOverlay(value, maxWidth) {
  const source = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || " ";
  const lines = [];
  let line = "";
  let width = 0;
  for (const char of source) {
    const charWidth = /[\u0000-\u00ff]/.test(char) ? 1 : 2;
    if (line && width + charWidth > maxWidth) {
      lines.push(line.trim());
      if (lines.length === 2) {
        lines[1] = `${lines[1].replace(/[.。…]+$/g, "")}…`;
        return lines.join("\n");
      }
      line = "";
      width = 0;
    }
    line += char;
    width += charWidth;
  }
  if (line.trim() && lines.length < 2) lines.push(line.trim());
  return lines.join("\n") || " ";
}

function filterPath(value) {
  return String(value).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
