export function normalizeSubtitleAnimationMode(value) {
  const mode = String(value || "").trim();
  if (mode === "word-highlight" || mode === "word-pop") return mode;
  return "sentence";
}

export function subtitleNeedsWordTimestamps(value) {
  const mode = normalizeSubtitleAnimationMode(value);
  return mode === "word-highlight" || mode === "word-pop";
}

export function makeWordPopSubtitles(words, { width, height, fontFile, fontSize, yPercent } = {}) {
  const safeWidth = Math.max(1, Number(width) || 1080);
  const safeHeight = Math.max(1, Number(height) || 1920);
  const marginV = Math.round(safeHeight * (Math.max(0, Math.min(100, Number(yPercent) || 66)) / 100));
  const fontName = String(fontFile || "Microsoft YaHei").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Microsoft YaHei";
  const popSize = Math.round(Math.max(42, Number(fontSize) || 62) * 1.28);
  const tokens = normalizePopWords(words);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${safeWidth}`,
    `PlayResY: ${safeHeight}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${popSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,2,80,80,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index];
    const next = tokens[index + 1];
    const start = word.start;
    const end = next ? Math.max(start + 0.08, next.start) : Math.max(word.end, start + 0.12);
    if (end <= start) continue;
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\fscx72\\fscy72\\t(0,90,\\fscx100\\fscy100)}${escapeAss(word.text)}`);
  }
  return lines.join("\n");
}

export function normalizePopWords(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((item) => ({
      text: cleanPopToken(item?.text || item?.word || ""),
      start: Number(item?.start ?? item?.start_time),
      end: Number(item?.end ?? item?.end_time)
    }))
    .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
    .sort((left, right) => left.start - right.start);
}

function cleanPopToken(value) {
  return String(value || "")
    .replace(/[{}]/g, "")
    .replace(/^[^A-Za-z0-9\u00C0-\u024F\u4E00-\u9FFF]+|[^A-Za-z0-9\u00C0-\u024F\u4E00-\u9FFF']+$/g, "")
    .trim();
}

function escapeAss(text) {
  return String(text || "").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

function assTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}
