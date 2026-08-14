const state = {
  source: document.body.dataset.source === "third_party" ? "third_party" : "official_api",
  days: 30,
  query: ""
};

const daysTabs = document.querySelector("#daysTabs");
const searchForm = document.querySelector("#effectSearchForm");
const searchInput = document.querySelector("#effectSearch");
const refreshButton = document.querySelector("#effectRefresh");
const statusNode = document.querySelector("#sourceStatus");
const summaryNode = document.querySelector("#summaryGrid");
const resultsNode = document.querySelector("#novelResults");
const unassignedNode = document.querySelector("#unassignedSection");

daysTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-days]");
  if (!button) return;
  state.days = Number(button.dataset.days) || 30;
  setActive(daysTabs, button);
  loadEffects();
});
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  loadEffects();
});
refreshButton?.addEventListener("click", loadEffects);

function setActive(container, active) {
  container.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === active));
}

async function loadEffects() {
  refreshButton.disabled = true;
  refreshButton.textContent = "加载中…";
  statusNode.className = "source-status";
  statusNode.innerHTML = "<span>正在读取小说、文案、音频与视频映射…</span>";
  summaryNode.innerHTML = "";
  resultsNode.innerHTML = '<div class="loading">正在计算小说效果…</div>';
  unassignedNode.hidden = true;
  try {
    const params = new URLSearchParams({ source: state.source, days: String(state.days), query: state.query });
    const response = await fetch(`/api/novel-effects?${params}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "读取小说效果失败");
    render(payload);
  } catch (error) {
    statusNode.classList.add("warning");
    statusNode.textContent = error.message || "读取失败";
    resultsNode.innerHTML = `<div class="error-state">${escapeHtml(error.message || "读取失败")}</div>`;
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "刷新";
  }
}

function render(data) {
  renderStatus(data.dataStatus || {});
  renderSummary(data.summary || {});
  const novels = Array.isArray(data.novels) ? data.novels : [];
  resultsNode.innerHTML = novels.length ? novels.map(renderNovel).join("") : '<div class="empty-state">暂无匹配的小说效果数据。请先在小说书单中建立小说，并将文案绑定对应音频。</div>';
  renderUnassigned(data.unassignedScripts || []);
}

function renderStatus(status) {
  const sourceName = status.label || (state.source === "official_api" ? "TikTok 官方 API" : "GeeLark 第三方");
  const raw = Number(status.rawVideoCount || 0);
  const mapped = Number(status.mappedVideoCount || 0);
  statusNode.classList.toggle("warning", status.status !== "ready" || raw > mapped);
  statusNode.innerHTML = `<span><strong>${escapeHtml(sourceName)}</strong> · ${status.status === "ready" ? "数据已就绪" : "当前数据不可用"}${status.error ? ` · ${escapeHtml(status.error)}` : ""}</span><small>读取视频 ${formatInteger(raw)} 条 · 已匹配内容 ${formatInteger(mapped)} 条 · 近 ${formatInteger(status.days || state.days)} 天</small>`;
}

function renderSummary(summary) {
  const metrics = [
    ["小说", formatInteger(summary.novelCount)], ["开头 / 文案版本", formatInteger(summary.scriptCount)],
    ["对应音频", formatInteger(summary.audioCount)], ["测试视频", formatInteger(summary.videoCount)],
    ["测试账号", formatInteger(summary.testedAccountCount)], ["总播放", formatNumber(summary.totalViews)],
    ["平均观看", formatSeconds(summary.averageTimeWatched)], ["平均完播率", formatRate(summary.fullWatchRate)],
    ["平均3秒留存", formatRate(summary.retentionAt3)], ["评论", formatNumber(summary.comments)],
  ];
  summaryNode.innerHTML = metrics.map(([label, value]) => `<article class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></article>`).join("");
}

function renderNovel(novel) {
  const performance = novel.performance || {};
  const scripts = Array.isArray(novel.scripts) ? novel.scripts : [];
  return `<article class="novel-card"><header class="novel-head"><div><p class="eyebrow">NOVEL</p><h2>${escapeHtml(novel.title || "未命名小说")}</h2><div class="novel-meta">${escapeHtml([novel.category, novel.platform, novel.promotionCode].filter(Boolean).join(" · ") || "未填写分类")}</div></div><div class="novel-total">${miniMetric("开头版本", scripts.length)}${miniMetric("视频", performance.videoCount)}${miniMetric("账号", performance.accountCount)}${miniMetric("播放", formatNumber(performance.totalViews))}</div></header>${renderScripts(scripts)}</article>`;
}

function renderScripts(scripts) {
  if (!scripts.length) return '<div class="empty-state">该小说还没有文案版本。</div>';
  return `<table class="script-table"><thead><tr><th>开头 / 文案版本</th><th>视频</th><th>账号</th><th>播放</th><th>平均观看</th><th>完播率</th><th>3秒留存</th><th>评论</th><th>诊断</th></tr></thead><tbody>${scripts.map((script) => {
    const p = script.performance || {};
    return `<tr><td><div class="script-opening">${escapeHtml(openingText(script))}</div><div class="script-version">${escapeHtml(script.versionLabel || script.title || script.id || "未命名版本")} · ${script.audio ? escapeHtml(script.audio.title || script.audio.id) : "未绑定音频"}</div>${renderVideoDetails(script.videos || [])}</td><td>${formatInteger(p.videoCount)}</td><td>${formatInteger(p.accountCount)}</td><td>${formatNumber(p.totalViews)}</td><td>${formatSeconds(p.averageTimeWatched)}</td><td>${formatRate(p.fullWatchRate)}</td><td>${formatRate(p.retentionAt3)}</td><td>${formatNumber(p.comments)}</td><td class="diagnosis">${escapeHtml(p.diagnosis || "—")}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function renderVideoDetails(videos) {
  if (!videos.length) return "";
  return `<details class="video-details"><summary>查看 ${videos.length} 条对应视频</summary><div class="video-grid">${videos.map((video) => `<div class="video-row"><div class="video-main"><strong>${escapeHtml(video.caption || video.videoId || "未命名视频")}</strong><small>${escapeHtml(video.username || "未知账号")} · ${formatDate(video.publishedAt)} · ${escapeHtml(video.matchConfidence || "已映射")}</small></div>${videoMetric("播放", formatNumber(video.views))}${videoMetric("平均观看", formatSeconds(video.averageTimeWatched))}${videoMetric("完播", formatRate(video.fullWatchRate))}${videoMetric("3秒留存", formatRate(video.retentionAt3))}${videoMetric("评论", formatNumber(video.comments))}${videoMetric("时长", formatSeconds(video.duration))}</div>`).join("")}</div></details>`;
}

function renderUnassigned(scripts) {
  unassignedNode.hidden = !scripts.length;
  if (!scripts.length) return;
  unassignedNode.innerHTML = `<p class="eyebrow">UNASSIGNED</p><h2>未归属小说的文案</h2><p class="page-copy">这些文案已有音频或视频映射，但尚未归入小说。</p>${renderScripts(scripts)}`;
}

function openingText(script) { const text = String(script.openingText || script.hook || script.text || script.content || script.title || "—").replace(/\s+/g, " ").trim(); return text.length > 150 ? `${text.slice(0, 150)}…` : text || "—"; }
function miniMetric(label, value) { return `<div><span>${label}</span><strong>${value ?? 0}</strong></div>`; }
function videoMetric(label, value) { return `<div class="video-stat"><small>${label}</small><strong>${value}</strong></div>`; }
function formatInteger(value) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Number(value) || 0); }
function formatNumber(value) { const n = Number(value) || 0; return n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 1 : 2).replace(/\.0+$/, "")}万` : formatInteger(n); }
function formatRate(value) { const n = Number(value); if (!Number.isFinite(n)) return '<span class="empty-value">—</span>'; return `${(n > 1 ? n : n * 100).toFixed(1)}%`; }
function formatSeconds(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? `${n.toFixed(n >= 10 ? 1 : 2)}s` : '<span class="empty-value">—</span>'; }
function formatDate(value) { const n = Number(value); if (!n) return "—"; return new Date(n).toLocaleString("zh-CN", { hour12: false }); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

loadEffects();
