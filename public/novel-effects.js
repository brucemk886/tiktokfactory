const pageParams = new URLSearchParams(location.search);
const state = {
  source: document.body.dataset.source === "third_party" ? "third_party" : "official_api",
  days: Number(document.querySelector("#daysTabs .is-active, #daysTabs .active")?.dataset.days) || 7,
  query: "",
  novelId: pageParams.get("novel") || "",
  page: 1,
  pageSize: 10,
  ranked: []
};

const daysTabs = document.querySelector("#daysTabs");
const searchForm = document.querySelector("#effectSearchForm");
const searchInput = document.querySelector("#effectSearch");
const refreshButton = document.querySelector("#effectRefresh");
const statusNode = document.querySelector("#sourceStatus");
const summaryNode = document.querySelector("#summaryGrid");
const hotHitsNode = document.querySelector("#hotHits");
const listHeadingNode = document.querySelector("#listHeading");
const resultsNode = document.querySelector("#novelResults");
const unassignedNode = document.querySelector("#unassignedSection");
const pagerNode = document.querySelector("#novelPager");

daysTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-days]");
  if (!button) return;
  state.days = Number(button.dataset.days) || 7;
  state.page = 1;
  setActive(daysTabs, button);
  loadEffects();
});
if (daysTabs) {
  const current = daysTabs.querySelector(`[data-days="${state.days}"]`) || daysTabs.querySelector(".is-active");
  if (current) setActive(daysTabs, current);
}
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  state.page = 1;
  renderPage();
});
refreshButton?.addEventListener("click", () => loadEffects({ refresh: true }));

function setActive(container, active) {
  container.querySelectorAll("button").forEach((button) => {
    const on = button === active;
    button.classList.toggle("is-active", on);
    button.classList.remove("active");
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

async function loadEffects({ refresh = false } = {}) {
  refreshButton.disabled = true;
  refreshButton.textContent = "加载中…";
  statusNode.className = "source-status";
  statusNode.innerHTML = "<span>正在读取小说播放排行…</span>";
  summaryNode.innerHTML = "";
  if (hotHitsNode) {
    hotHitsNode.hidden = true;
    hotHitsNode.innerHTML = "";
  }
  if (listHeadingNode) listHeadingNode.hidden = true;
  resultsNode.innerHTML = '<div class="loading">正在按效果倒序排列…</div>';
  unassignedNode.hidden = true;
  try {
    const params = new URLSearchParams({ source: state.source, days: String(state.days) });
    if (state.novelId) params.set("novel", state.novelId);
    if (refresh) params.set("refresh", "1");
    const response = await fetch(`/api/novel-effects?${params}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "读取数据概览失败");
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
  state.ranked = rankNovels(data.novels || []);
  renderStatus(data.dataStatus || {}, state.ranked.length);
  renderSummary(data.summary || {});
  renderHotHits(state.ranked);
  if (state.novelId) {
    const index = visibleNovels().findIndex((novel) => novel.id === state.novelId);
    if (index >= 0) state.page = Math.floor(index / state.pageSize) + 1;
  }
  renderPage();
  renderUnassigned(data.unassignedScripts || []);
}

function visibleNovels() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.ranked;
  return state.ranked.filter((novel) => (
    [novel.id, novel.title, novel.category, novel.platform, novel.promotionCode]
      .some((value) => String(value || "").toLowerCase().includes(query))
  ));
}

function renderPage() {
  const ranked = visibleNovels();
  const pageCount = Math.max(1, Math.ceil(ranked.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * state.pageSize;
  const pageNovels = ranked.slice(start, start + state.pageSize);
  if (listHeadingNode) listHeadingNode.hidden = !pageNovels.length;
  resultsNode.innerHTML = pageNovels.length
    ? pageNovels.map((novel, index) => renderNovel(novel, start + index + 1)).join("")
    : `<div class="empty-state">${state.query ? "没有匹配的小说。" : "这个周期还没有跑出播放的小说。先在书单里给开头配音并发布，再回来看今天 / 7 天 / 30 天排行。"}</div>`;
  renderPager(ranked.length, pageCount);
  focusCurrentNovel();
}

function renderPager(total, pageCount) {
  if (!pagerNode) return;
  if (total <= state.pageSize) {
    pagerNode.hidden = true;
    pagerNode.innerHTML = "";
    return;
  }
  pagerNode.hidden = false;
  const buttons = [];
  buttons.push(`<button type="button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一页</button>`);
  for (let page = 1; page <= pageCount; page++) {
    if (pageCount > 9 && page !== 1 && page !== pageCount && Math.abs(page - state.page) > 2) {
      if (buttons[buttons.length - 1] !== "<span>…</span>") buttons.push("<span>…</span>");
      continue;
    }
    buttons.push(`<button type="button" data-page="${page}" class="${page === state.page ? "is-active" : ""}">${page}</button>`);
  }
  buttons.push(`<button type="button" data-page="${state.page + 1}" ${state.page >= pageCount ? "disabled" : ""}>下一页</button>`);
  pagerNode.innerHTML = `<span>每页 ${state.pageSize} 条 · 共 ${pageCount} 页 · ${total} 本</span>${buttons.join("")}`;
  pagerNode.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.page);
      if (!Number.isFinite(next) || next < 1 || next > pageCount || next === state.page) return;
      state.page = next;
      renderPage();
      resultsNode.scrollIntoView({ block: "start" });
    });
  });
}

function rankNovels(novels) {
  return novels
    .map((novel) => ({
      ...novel,
      scripts: [...(novel.scripts || [])].sort(byViews)
    }))
    .filter((novel) => Number(novel.performance?.totalViews) > 0 || novel.id === state.novelId)
    .sort(byViews);
}

function byViews(left, right) {
  return Number(right.performance?.totalViews || 0) - Number(left.performance?.totalViews || 0);
}

function renderStatus(status, rankedCount) {
  const raw = Number(status.rawVideoCount || 0);
  const mapped = Number(status.mappedVideoCount || 0);
  const ready = status.status === "ready" ? "数据已就绪" : "当前数据不可用";
  const prefix = state.source === "official_api" ? ready : `${status.label || "GeeLark 第三方"} · ${ready}`;
  statusNode.classList.toggle("warning", status.status !== "ready" || raw > mapped);
  const archive = status.archiveDate ? `归档 ${status.archiveDate}` : "";
  statusNode.innerHTML = `<span><strong>${escapeHtml(prefix)}</strong>${status.error ? ` · ${escapeHtml(status.error)}` : ""}${archive ? ` · ${escapeHtml(archive)}` : ""}</span><small>读取视频 ${formatInteger(raw)} 条 · 已匹配内容 ${formatInteger(mapped)} 条 · ${periodLabel(status.days || state.days)} · ${formatInteger(rankedCount)} 本有播放</small>`;
}

function renderSummary(summary) {
  const metrics = [
    ...(state.source === "official_api" ? [
      ["发布总数", formatInteger(summary.publishTotal)],
      ["发布成功", formatInteger(summary.publishSuccess)],
      ["发布失败", formatInteger(summary.publishFailed)],
    ] : []),
    ["项目账号", formatInteger(summary.testedAccountCount)],
    ["总播放", formatNumber(summary.totalViews)],
    ["平均观看", formatSeconds(summary.averageTimeWatched)],
    ["平均完播率", formatRate(summary.fullWatchRate)],
    ["平均3秒留存", formatRate(summary.retentionAt3)],
    ["评论", formatNumber(summary.comments)],
  ];
  summaryNode.innerHTML = metrics.map(([label, value]) => `<article class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></article>`).join("");
}

function renderHotHits(ranked) {
  if (!hotHitsNode) return;
  const hits = ranked.filter((novel) => Number(novel.performance?.totalViews) > 0).slice(0, 5);
  if (!hits.length) {
    hotHitsNode.hidden = true;
    hotHitsNode.innerHTML = "";
    return;
  }
  hotHitsNode.hidden = false;
  hotHitsNode.innerHTML = `<header class="hot-hits-head"><div><p class="eyebrow">HOT NOW</p><h2>当下爆款</h2></div><p class="page-copy">${periodLabel(state.days)}效果最好的 ${hits.length} 本</p></header>
    <div class="hot-hits-grid">${hits.map((novel, index) => {
      const performance = novel.performance || {};
      return `<article class="hot-hit-card">
        <header class="hot-hit-head">
          <div class="rank-badge" aria-label="第 ${index + 1} 名">${index + 1}</div>
          <div class="hot-hit-body">
            <h3><button type="button" data-hot-id="${escapeHtml(novel.id)}">${escapeHtml(novel.title || "未命名小说")}</button></h3>
            <div class="novel-meta">${escapeHtml([novel.category, novel.platform, novel.promotionCode].filter(Boolean).join(" · ") || "未填写分类")}</div>
          </div>
          <div class="hot-hit-metrics">${miniMetric("播放", formatNumber(performance.totalViews))}${miniMetric("视频", performance.videoCount)}${miniMetric("账号", performance.accountCount)}</div>
        </header>
        ${renderVideoJumpList(novelVideos(novel))}
      </article>`;
    }).join("")}</div>`;
  hotHitsNode.querySelectorAll("[data-hot-id]").forEach((button) => {
    button.addEventListener("click", () => focusNovel(button.dataset.hotId));
  });
}

function focusNovel(novelId) {
  if (!novelId) return;
  state.novelId = novelId;
  if (state.query && !visibleNovels().some((novel) => novel.id === novelId)) {
    state.query = "";
    if (searchInput) searchInput.value = "";
  }
  const index = visibleNovels().findIndex((novel) => novel.id === novelId);
  state.page = index >= 0 ? Math.floor(index / state.pageSize) + 1 : 1;
  renderPage();
  resultsNode.scrollIntoView({ block: "start" });
}

function renderNovel(novel, rank) {
  const performance = novel.performance || {};
  const scripts = Array.isArray(novel.scripts) ? novel.scripts : [];
  const rewrites = rewriteScripts(scripts);
  return `<article class="novel-card${novel.id === state.novelId ? " is-focused" : ""}" id="novel-${escapeHtml(novel.id)}">
    <header class="novel-head">
      <div class="novel-title-block">
        <div class="rank-badge" aria-label="第 ${rank} 名">${rank}</div>
        <div>
          <p class="eyebrow">NOVEL · ${periodLabel(state.days)}</p>
          <h2>${escapeHtml(novel.title || "未命名小说")}</h2>
          <div class="novel-meta">${escapeHtml([novel.category, novel.platform, novel.promotionCode].filter(Boolean).join(" · ") || "未填写分类")} · ${rewrites.length} 个改写版本</div>
        </div>
      </div>
      <div class="novel-total">${miniMetric("播放", formatNumber(performance.totalViews))}${miniMetric("视频", performance.videoCount)}${miniMetric("账号", performance.accountCount)}${miniMetric("开头版本", scripts.length)}</div>
    </header>
    <div class="novel-actions">
      <a class="quiet-action" href="/novel-audio?novel=${encodeURIComponent(novel.id)}">查看音频与改写记录</a>
      <a class="quiet-action" href="/novel-rewrite?novel=${encodeURIComponent(novel.id)}">改写</a>
    </div>
    ${renderVideoJumpList(novelVideos(novel))}
    ${renderScripts(scripts)}
  </article>`;
}

function renderScripts(scripts) {
  if (!scripts.length) return '<div class="empty-state">该小说还没有文案版本。</div>';
  return `<table class="script-table"><thead><tr><th>改写 / 开头版本</th><th>视频</th><th>账号</th><th>播放</th><th>平均观看</th><th>完播率</th><th>3秒留存</th><th>评论</th><th>诊断</th></tr></thead><tbody>${scripts.map((script) => {
    const p = script.performance || {};
    const rewrite = isRewrite(script);
    return `<tr class="${rewrite ? "is-rewrite" : ""}"><td><div class="script-opening">${escapeHtml(openingText(script))}</div><div class="script-version">${escapeHtml(sourceLabel(script))} · ${escapeHtml(script.versionLabel || script.title || script.id || "未命名版本")} · ${script.audio ? escapeHtml(script.audio.title || script.audio.id) : "未绑定音频"}</div>${renderVideoDetails(script.videos || [])}</td><td>${formatInteger(p.videoCount)}</td><td>${formatInteger(p.accountCount)}</td><td>${formatNumber(p.totalViews)}</td><td>${formatSeconds(p.averageTimeWatched)}</td><td>${formatRate(p.fullWatchRate)}</td><td>${formatRate(p.retentionAt3)}</td><td>${formatNumber(p.comments)}</td><td class="diagnosis">${escapeHtml(p.diagnosis || "—")}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function renderVideoDetails(videos) {
  if (!videos.length) return "";
  return `<details class="video-details"><summary>查看 ${videos.length} 条对应视频</summary><div class="video-grid">${videos.map((video) => {
    const href = tiktokWatchUrl(video);
    const title = video.caption || video.videoId || "未命名视频";
    const titleHtml = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`
      : `<strong>${escapeHtml(title)}</strong>`;
    const openHtml = href
      ? `<a class="video-open" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">打开</a>`
      : "";
    return `<div class="video-row"><div class="video-main"><div class="video-title-row">${titleHtml}${openHtml}</div><small>${escapeHtml(video.username ? `@${String(video.username).replace(/^@/, "")}` : "未知账号")} · ${formatDate(video.publishedAt)} · ${escapeHtml(video.matchConfidence || "已映射")}</small></div>${videoMetric("播放", formatNumber(video.views))}${videoMetric("平均观看", formatSeconds(video.averageTimeWatched))}${videoMetric("完播", formatRate(video.fullWatchRate))}${videoMetric("3秒留存", formatRate(video.retentionAt3))}${videoMetric("评论", formatNumber(video.comments))}${videoMetric("时长", formatSeconds(video.duration))}</div>`;
  }).join("")}</div></details>`;
}

function novelVideos(novel) {
  return (Array.isArray(novel?.scripts) ? novel.scripts : [])
    .flatMap((script) => Array.isArray(script.videos) ? script.videos : [])
    .slice()
    .sort((left, right) => Number(right.views || 0) - Number(left.views || 0));
}

function tiktokWatchUrl(video = {}) {
  const existing = String(video.shareLink || video.videoUrl || video.url || "").trim();
  if (/tiktok\.com\/@[\w.]+\/video\/\d{10,}/i.test(existing)) return existing;
  const id = String(video.videoId || video.id || "").trim();
  const username = String(video.username || "").replace(/^@/, "").trim();
  if (/^\d{10,}$/.test(id) && username) return `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${id}`;
  return "";
}

function renderVideoJumpList(videos) {
  if (!videos.length) return '<p class="video-jump-empty">这本还没有可跳转的视频。</p>';
  return `<ul class="video-jump-list">${videos.map((video) => {
    const href = tiktokWatchUrl(video);
    const title = video.caption || video.videoId || "未命名视频";
    const account = video.username ? `@${String(video.username).replace(/^@/, "")}` : "未知账号";
    const meta = `${account} · ${formatNumber(video.views)} 播放`;
    if (!href) {
      return `<li><span>${escapeHtml(title)}</span><small>${escapeHtml(meta)}</small><span class="empty-value">无链接</span></li>`;
    }
    return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a><small>${escapeHtml(meta)}</small><a class="video-open" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">打开</a></li>`;
  }).join("")}</ul>`;
}

function renderUnassigned(scripts) {
  const ranked = [...scripts].filter((script) => Number(script.performance?.totalViews) > 0).sort(byViews);
  unassignedNode.hidden = !ranked.length;
  if (!ranked.length) return;
  unassignedNode.innerHTML = `<p class="eyebrow">UNASSIGNED</p><h2>未归属小说但已有播放的文案</h2><p class="page-copy">这些改写或开头已映射到视频，但还没归入书单里的小说。</p>${renderScripts(ranked)}`;
}

function rewriteScripts(scripts = []) {
  return scripts.filter(isRewrite);
}

function isRewrite(script) {
  return ["manual-rewrite", "ai-operation-rewrite", "ai-marketing", "ai-style-rewrite", "novel-seed"].includes(script?.sourceType)
    || Boolean(script?.parentScriptId);
}

function sourceLabel(script) {
  return ({
    "manual-rewrite": "人工改写",
    "ai-operation-rewrite": "AI 数据改写",
    "ai-marketing": "营销生成",
    "ai-style-rewrite": "风格改版",
    "novel-seed": "种子音频",
    "audio-library": "音频库"
  })[script?.sourceType] || (script?.parentScriptId ? "改写版本" : "原版本");
}

function focusCurrentNovel() {
  if (!state.novelId) return;
  const card = document.querySelector(`#novel-${CSS.escape(state.novelId)}`);
  if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
}

function periodLabel(days) {
  const value = Number(days) || 7;
  if (value <= 1) return "今天";
  if (value <= 7) return "近 7 天";
  return "近 30 天";
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
