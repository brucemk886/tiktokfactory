export const COVER_BACKDROPS = Object.freeze([
  { id: "taupe-quote", name: "Taupe Quote", kind: "solid-quote", bg: "#8b776c", ink: "#f6f1ea", quote: "rgba(255,255,255,.18)" },
  { id: "cream-marks", name: "Cream Marks", kind: "corner-quotes", bg: "#f4ece2", ink: "#8c1f24", quote: "#b13338" },
  { id: "window-light", name: "Window Light", kind: "paper-light", bg: "#f3eee6", ink: "#1a1a1a", wash: "rgba(255,255,255,.42)" },
  { id: "mint-stack", name: "Mint Stack", kind: "torn-stack", bg: "#d7e7b8", ink: "#243023", paper: "#f4f1e6", stamp: "#7d9a4a" },
  { id: "crumple-note", name: "Crumple Note", kind: "crumpled", bg: "#c9d4e0", ink: "#2a241c", paper: "#f7f3ea", sticker: "#f3b6c4" },
  { id: "ink-navy", name: "Ink Navy", kind: "solid-quote", bg: "#1b2433", ink: "#f3efe6", quote: "rgba(243,239,230,.16)" },
  { id: "sage-wash", name: "Sage Wash", kind: "wash", bg: "#c9d5c2", ink: "#243028", top: "#e7eee3" },
  { id: "dusty-rose", name: "Dusty Rose", kind: "solid-quote", bg: "#c9a4a0", ink: "#fff8f4", quote: "rgba(255,255,255,.2)" },
  { id: "charcoal-soft", name: "Charcoal Soft", kind: "solid-quote", bg: "#2c2c2c", ink: "#f2f0ea", quote: "rgba(255,255,255,.12)" },
  { id: "linen-beige", name: "Linen Beige", kind: "framed", bg: "#e8dcc8", ink: "#3a3228", frame: "#cbbba0" },
  { id: "sky-wash", name: "Sky Wash", kind: "wash", bg: "#b9cbe0", ink: "#1d2a3a", top: "#e8f0f8" },
  { id: "lined-journal", name: "Lined Journal", kind: "lined-note", bg: "#f7f4ee", ink: "#2b2b2b", line: "#d7d0c4" },
  { id: "polaroid-ivory", name: "Polaroid Ivory", kind: "framed", bg: "#f6f1e8", ink: "#222222", frame: "#ffffff" },
  { id: "forest-depth", name: "Forest Depth", kind: "solid-quote", bg: "#2f4a3c", ink: "#eef6ee", quote: "rgba(238,246,238,.16)" },
  { id: "terracotta", name: "Terracotta", kind: "corner-quotes", bg: "#c56a48", ink: "#fff4ea", quote: "#f0c2ae" },
  { id: "ink-blot", name: "Ink Blot", kind: "blot", bg: "#efe8dc", ink: "#1f1b16", blot: "rgba(40,32,24,.08)" },
  { id: "soft-peach", name: "Soft Peach", kind: "wash", bg: "#f0c9b5", ink: "#3a241c", top: "#f8e4d6" },
  { id: "slate-blue", name: "Slate Blue", kind: "solid-quote", bg: "#4d5d73", ink: "#f5f7fb", quote: "rgba(245,247,251,.16)" },
  { id: "wine-page", name: "Wine Page", kind: "corner-quotes", bg: "#6e2430", ink: "#f8ebe4", quote: "#c56b74" },
  { id: "warm-sand", name: "Warm Sand", kind: "paper-light", bg: "#e5d3b5", ink: "#2b2418", wash: "rgba(255,248,232,.35)" },
  { id: "olive-field", name: "Olive Field", kind: "wash", bg: "#8b9154", ink: "#f7f6ea", top: "#c4c88a" },
  { id: "fog-gray", name: "Fog Gray", kind: "paper-light", bg: "#d8d6d1", ink: "#222222", wash: "rgba(255,255,255,.38)" },
  { id: "butter-page", name: "Butter Page", kind: "lined-note", bg: "#f4e7b4", ink: "#2c2718", line: "#e0cf8e" },
  { id: "ice-card", name: "Ice Card", kind: "framed", bg: "#d9e7ef", ink: "#1a2c38", frame: "#f7fbff" },
  { id: "cocoa-quote", name: "Cocoa Quote", kind: "solid-quote", bg: "#5b3d32", ink: "#f6efe7", quote: "rgba(246,239,231,.16)" },
  { id: "blush-note", name: "Blush Note", kind: "torn-stack", bg: "#f0cfd6", ink: "#3a2430", paper: "#fff7f4", stamp: "#d48aa0" },
  { id: "graphite", name: "Graphite", kind: "solid-quote", bg: "#3f4448", ink: "#f3f1ec", quote: "rgba(243,241,236,.14)" },
  { id: "ivory-rule", name: "Ivory Rule", kind: "framed", bg: "#f8f4ec", ink: "#7a1e22", frame: "#e6dccb" },
  { id: "moss-card", name: "Moss Card", kind: "wash", bg: "#6d7a4e", ink: "#f4f6ea", top: "#a3ae7c" },
  { id: "midnight", name: "Midnight", kind: "solid-quote", bg: "#12151c", ink: "#f2eee6", quote: "rgba(242,238,230,.14)" },
]);

export function coverBackdropById(id) {
  return COVER_BACKDROPS.find((item) => item.id === id) || COVER_BACKDROPS[0];
}

export function pickCoverBackdrop({ excludeId, random } = {}) {
  const pool = COVER_BACKDROPS.filter((item) => item.id !== excludeId);
  const list = pool.length ? pool : COVER_BACKDROPS;
  const roll = Number.isFinite(random) ? random : Math.random();
  return list[Math.abs(Math.floor(roll * list.length)) % list.length];
}

export function formatBackdropDate(date = new Date()) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return { weekday: `(${weekday}.)`, monthDay };
}

export function paintCoverBackdrop(ctx, width, height, backdrop) {
  const theme = coverBackdropById(backdrop?.id || backdrop);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  if (theme.kind === "wash") paintWash(ctx, width, height, theme);
  if (theme.kind === "paper-light") paintPaperLight(ctx, width, height, theme);
  if (theme.kind === "solid-quote") paintGiantQuotes(ctx, width, height, theme);
  if (theme.kind === "corner-quotes") paintCornerQuotes(ctx, width, height, theme);
  if (theme.kind === "torn-stack") paintTornStack(ctx, width, height, theme);
  if (theme.kind === "crumpled") paintCrumpled(ctx, width, height, theme);
  if (theme.kind === "lined-note") paintLinedNote(ctx, width, height, theme);
  if (theme.kind === "framed") paintFrame(ctx, width, height, theme);
  if (theme.kind === "blot") paintBlot(ctx, width, height, theme);
}

function paintWash(ctx, width, height, theme) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.top || "#fff");
  gradient.addColorStop(1, theme.bg);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function paintPaperLight(ctx, width, height, theme) {
  const gradient = ctx.createLinearGradient(width * 0.15, 0, width * 0.85, height);
  gradient.addColorStop(0, theme.wash || "rgba(255,255,255,.4)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(0,0,0,.04)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const { weekday, monthDay } = formatBackdropDate();
  ctx.fillStyle = theme.ink;
  ctx.globalAlpha = 0.55;
  ctx.font = `400 ${Math.round(width * 0.032)}px "Times New Roman",Georgia,serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(weekday, Math.round(width * 0.08), Math.round(height * 0.07));
  ctx.textAlign = "right";
  ctx.fillText(monthDay, width - Math.round(width * 0.08), Math.round(height * 0.07));
  ctx.globalAlpha = 1;
}

function paintGiantQuotes(ctx, width, height, theme) {
  ctx.fillStyle = theme.quote || "rgba(255,255,255,.16)";
  ctx.font = `700 ${Math.round(width * 0.34)}px Georgia,"Times New Roman",serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("“", Math.round(width * 0.05), Math.round(height * 0.04));
}

function paintCornerQuotes(ctx, width, height, theme) {
  ctx.fillStyle = theme.quote || theme.ink;
  ctx.font = `700 ${Math.round(width * 0.16)}px Georgia,"Times New Roman",serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("“", Math.round(width * 0.08), Math.round(height * 0.08));
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("”", width - Math.round(width * 0.08), height - Math.round(height * 0.08));
}

function paintTornStack(ctx, width, height, theme) {
  const pad = Math.round(width * 0.08);
  for (let index = 0; index < 4; index += 1) {
    ctx.fillStyle = theme.paper || "#f4f1e6";
    ctx.globalAlpha = 0.72 + index * 0.06;
    roundRect(ctx, pad + index * 8, pad + index * 18, width - pad * 2 - index * 16, height - pad * 2 - index * 28, 18);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.stamp || "#7d9a4a";
  ctx.beginPath();
  ctx.arc(width - pad - 54, pad + 70, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${Math.round(width * 0.018)}px "Segoe UI",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NOTE", width - pad - 54, pad + 70);
  ctx.fillStyle = theme.ink;
  ctx.globalAlpha = 0.45;
  ctx.font = `500 ${Math.round(width * 0.022)}px "Segoe UI",sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Capture words", pad + 28, pad + 36);
  ctx.fillText("in mind", pad + 28, pad + 62);
  ctx.globalAlpha = 1;
}

function paintCrumpled(ctx, width, height, theme) {
  ctx.fillStyle = theme.paper || "#f7f3ea";
  roundRect(ctx, Math.round(width * 0.08), Math.round(height * 0.12), Math.round(width * 0.84), Math.round(height * 0.72), 8);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.04)";
  for (let index = 0; index < 12; index += 1) {
    ctx.beginPath();
    ctx.ellipse(width * (0.2 + (index % 5) * 0.14), height * (0.22 + Math.floor(index / 5) * 0.18), 90, 28, index * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = theme.sticker || "#f3b6c4";
  ctx.beginPath();
  ctx.arc(Math.round(width * 0.22), Math.round(height * 0.18), 48, 0, Math.PI * 2);
  ctx.fill();
}

function paintLinedNote(ctx, width, height, theme) {
  ctx.strokeStyle = theme.line || "#d7d0c4";
  ctx.lineWidth = 2;
  const start = Math.round(height * 0.18);
  for (let y = start; y < height - 80; y += Math.round(height * 0.045)) {
    ctx.beginPath();
    ctx.moveTo(Math.round(width * 0.1), y);
    ctx.lineTo(Math.round(width * 0.9), y);
    ctx.stroke();
  }
}

function paintFrame(ctx, width, height, theme) {
  const inset = Math.round(width * 0.06);
  ctx.strokeStyle = theme.frame || "#fff";
  ctx.lineWidth = Math.round(width * 0.018);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
}

function paintBlot(ctx, width, height, theme) {
  ctx.fillStyle = theme.blot || "rgba(40,32,24,.08)";
  ctx.beginPath();
  ctx.ellipse(width * 0.72, height * 0.22, 180, 110, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(width * 0.28, height * 0.78, 160, 90, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
