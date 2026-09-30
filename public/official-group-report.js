const MODULE_FROM_PATH = {
  "/novel-ops-report": "novel-promotion",
  "/mid-video-ops-report": "mid-video",
  "/psychology-ops-report": "psychology",
  "/psychology-effects": "psychology",
};

const MODULE_LABEL = {
  "novel-promotion": "小说推文",
  "mid-video": "中视频",
  "psychology": "心理学",
};

function reportNoun() {
  if (location.pathname === "/psychology-effects") return "数据概览";
  return state.module === "novel-promotion" ? "数据概览" : "运营报表";
}

function reportTitle() {
  return reportNoun() === "数据概览"
    ? "数据概览"
    : `${MODULE_LABEL[state.module] || "项目"} · 运营报表`;
}

function reportCopy(project = {}) {
  if (state.module === "novel-promotion") {
    return project.name
      ? `${project.name} 看项目账号的发布和播放，不区分是不是小说内容。`
      : "看小说推文项目账号的发布和播放，不区分是不是小说内容。";
  }
  if (location.pathname === "/psychology-effects") return "心理学按账号池与内容池看运营规模、低流量恢复与匹配效果；作品明细和主页访问继续独立展示。";
  return project.name
    ? `${project.name} 按今天、昨天、近7天和最近30天看分组发布和播放。`
    : "这个模块还没有项目。";
}

const PAGE_SIZE = 10;
const PAGE_BUCKETS = { high: "highView", low: "lowView", normal: "midView" };
const PRESET_PERIODS = ["today", "yesterday", "7d", "30d"];
const params = new URLSearchParams(location.search);
const todayKey = shanghaiDateKey();
const state = {
  module: MODULE_FROM_PATH[location.pathname] || params.get("module") || "",
  period: normalizePeriodParam(params.get("period")),
  groupId: params.get("group") || "",
  fromKey: params.get("from") || params.get("date") || "",
  toKey: params.get("to") || params.get("date") || "",
  data: null,
  traffic: null,
  trafficPage: 1,
  pages: { high: 1, low: 1, normal: 1 },
  activeTab: ["high", "low", "anomaly"].includes(params.get("tab")) ? params.get("tab") : "high",
};

if (PRESET_PERIODS.includes(state.period) || !state.fromKey || !state.toKey) {
  applyPeriodRange(state.period);
} else {
  syncPeriodFromDates();
}

let reportRequest = 0;
let reportController;

bindToolbar();
if (document.documentElement?.classList.contains("psychology-module")) document.body?.classList.add("psychology-module");
loadReport();

function bindToolbar() {
  document.querySelectorAll("[data-result-tab]").forEach((button, index, buttons) => {
    button.addEventListener("click", () => selectResultTab(button.dataset.resultTab));
    button.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % buttons.length
        : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length
        : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      buttons[next].focus();
      selectResultTab(buttons[next].dataset.resultTab);
    });
  });
  updateResultTabs();
  document.querySelectorAll("#periodTabs [data-period]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.period === state.period);
    button.addEventListener("click", () => {
      applyPeriodRange(button.dataset.period);
      markActivePeriod();
      syncQuery();
      loadReport();
    });
  });
  document.querySelector("#groupSelect")?.addEventListener("change", (event) => {
    state.groupId = event.target.value;
  });
  document.querySelector("#queryBtn")?.addEventListener("click", () => {
    readFilters();
    syncQuery();
    loadReport();
  });
  document.querySelector("#projectReportToggle")?.addEventListener("change", (event) => {
    const projectId = state.data?.project?.id;
    if (!projectId) {
      event.target.checked = !event.target.checked;
      return;
    }
    toggleProjectReport(projectId, event.target.checked);
  });
  markActivePeriod();
}

async function loadReport() {
  const requestId = ++reportRequest;
  reportController?.abort();
  const controller = new AbortController();
  reportController = controller;
  const title = document.querySelector("#pageTitle");
  const copy = document.querySelector("#pageCopy");
  const meta = document.querySelector("#reportMeta");
  if (!state.module) {
    title.textContent = "运营报表";
    copy.textContent = "请从小说推文、中视频或心理学模块进入。";
    meta.textContent = "还没有指定项目。";
    renderEmpty("运营报表按项目和分组分别落库。");
    return;
  }
  title.textContent = reportTitle();
  document.title = title.textContent;
  meta.textContent = "正在读取报表…";
  document.querySelector("#publishStatus").textContent = "";
  state.data = null;
  renderEmpty("正在读取报表…");
  try {
    const query = new URLSearchParams({ module: state.module, period: state.period, view: "analytics" });
    if (state.groupId) query.set("group", state.groupId);
    if (state.fromKey) query.set("from", state.fromKey);
    if (state.toKey) query.set("to", state.toKey);
    if (location.pathname === "/psychology-effects") { void loadTraffic(query, requestId, controller.signal); void loadMatchingOverview(query, requestId, controller.signal); }
    const publishQuery = new URLSearchParams(query);
    publishQuery.set("view", "publish");
    // Start both reads together; slow receipts never delay rendering analytics.
    const publishPromise = fetch(`/api/official-tiktok/ops-report?${publishQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .catch(() => ({ ok: false, data: {} }));
    const response = await fetch(`/api/official-tiktok/ops-report?${query}`, { cache: "no-store", signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (requestId !== reportRequest) return;
    if (!response.ok) throw new Error(data.error || "读取报表失败。");
    state.data = data;
    if (!state.groupId && data.report?.groupId) state.groupId = data.report.groupId;
    if (PRESET_PERIODS.includes(data.report?.period)) {
      applyPeriodRange(data.report.period);
    } else {
      if (data.report?.fromKey) state.fromKey = data.report.fromKey;
      if (data.report?.toKey) state.toKey = data.report.toKey;
      if (data.report?.period) state.period = normalizePeriodParam(data.report.period);
    }
    state.pages = { high: 1, low: 1, normal: 1 };
    render();
    if (data.publishStatus === "pending" && data.report?.enabled) {
      void loadPublishOutcome(publishPromise, requestId, controller.signal);
    }
  } catch (error) {
    if (requestId !== reportRequest || controller.signal.aborted) return;
    meta.textContent = error.message || "读取报表失败。";
    renderEmpty(error.message || "读取报表失败。");
  }
}

async function loadPublishOutcome(publishPromise, requestId, signal) {
  try {
    const { ok, data } = await publishPromise;
    if (requestId !== reportRequest) return;
    if (!ok || data.publishStatus !== "ready") throw new Error("publish unavailable");
    state.data.report.summary = { ...state.data.report.summary, ...data.report.summary };
    state.data.publishStatus = "ready";
  } catch (error) {
    if (requestId !== reportRequest || signal.aborted) return;
    state.data.publishStatus = "unavailable";
  }
  renderSummary();
}

function render() {
  const data = state.data || {};
  const project = data.project || {};
  const groups = data.groups || [];
  const report = data.report || {};
  const scopeName = report.groupName || (state.groupId ? groups.find((item) => item.id === state.groupId)?.name : "全部项目") || "全部项目";
  document.querySelector("#pageCopy").textContent = reportCopy(project);
  fillSelects(data);
  markActivePeriod();
  bindReportToggle(project);
  renderProjectBar(project, groups);
  if (!report.enabled) {
    document.querySelector("#reportMeta").textContent = `这个项目还没打开${reportNoun()}。`;
    renderEmpty("打开最上方的开关后，会按项目和分组分别统计 0 播、低播、高播和均播。");
    return;
  }
  if (report.missing) {
    document.querySelector("#reportMeta").textContent = `${rangeLabel(report)} · ${scopeName} · 还没有这一段的落库快照`;
    renderEmpty("这一段还没有落库快照。改成当天查询，或等定时任务跑完后再看。");
    return;
  }
  const summary = report.summary || {};
  const sourceLabel = data.source === "snapshot" ? "历史快照" : "实时查询";
  document.querySelector("#reportMeta").textContent = `${rangeLabel(report)} · ${scopeName} · ${sourceLabel} · 低播 < ${report.thresholds?.lowView || 200} · 高播 ≥ ${report.thresholds?.highView || 1000}`;
  renderSummary();
  renderAnomalies(report.anomalyAccounts || [], report.buckets?.zeroView || []);
  updateResultTabs();
  renderBucket("highSection", "高播视频", `播放达到 ${report.thresholds?.highView || 1000} 以上。`, report.buckets?.highView || [], "high");
  renderBucket("lowSection", "低播视频", `播放低于 ${report.thresholds?.lowView || 200}。`, report.buckets?.lowView || [], "low");
  if (!Array.isArray(report.buckets?.midView) && Number(summary.midView) > 0) {
    document.querySelector("#normalSection").innerHTML = '<div class="empty">该历史快照未保存正常播放视频明细，请选择今天、昨天、近7天或最近30天查询。</div>';
  } else {
    renderBucket("normalSection", "正常播放视频", `播放 ≥ ${report.thresholds?.lowView || 200} 且 < ${report.thresholds?.highView || 1000}。`, report.buckets?.midView || [], "normal");
  }
}

function renderSummary() {
  const report = state.data?.report || {};
  const status = state.data?.publishStatus;
  const publishNumber = value => status === "pending" || status === "unavailable" ? "—" : formatNumber(value);
  document.querySelector("#publishStatus").textContent = status === "pending"
    ? "发布结果读取中…" : status === "unavailable" ? "发布结果暂时不可用，点击查询重试。" : "";
  const summary = report.summary || {};
  document.querySelector("#summaryGrid").innerHTML = [
    ["发布总数", publishNumber(summary.publishTotal ?? ((Number(summary.publishSuccess) || 0) + (Number(summary.publishFailed) || 0)))],
    ["发布视频", formatNumber(summary.published)],
    ["发布成功", publishNumber(summary.publishSuccess)],
    ["发布失败", publishNumber(summary.publishFailed)],
    ["风控账号", publishNumber(summary.riskAccountCount)],
    ["0 播", formatNumber(summary.zeroView)],
    ["低播", formatNumber(summary.lowView)],
    ["高播", formatNumber(summary.highView)],
    ["总播放", formatNumber(summary.views)],
    ...(location.pathname === "/psychology-effects" ? [
      ["主页访问次数", state.traffic?.summary?.profileViews == null ? "—" : formatNumber(state.traffic.summary.profileViews), "按所选 UTC 日期统计，数据有延迟；覆盖情况见底部明细。"],
      ["主页访问比", state.traffic?.summary?.ratio == null ? "—" : `${(state.traffic.summary.ratio * 100).toFixed(2)}%`, "同账号、同日主页访问 ÷ 同期播放；与旁边总播放的统计口径不同，详见底部说明。"],
    ] : []),
    ["均播", formatNumber(summary.avgView ?? averageViews(summary))],
    ["异常账号", formatNumber(summary.anomalyAccountCount)],
  ].map(([label, value, hint]) => `<div class="metric"${hint ? ` title="${escapeHtml(hint)}"` : ""}><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function fillSelects(data) {
  const scopes = data.scopes || [
    ...(data.canSeeProjectTotal ? [{ id: "", name: "全部项目" }] : []),
    ...(data.groups || []).map((item) => ({ id: item.id, name: item.name })),
  ];
  const groupSelect = document.querySelector("#groupSelect");
  if (!groupSelect) return;
  const current = state.groupId || data.report?.groupId || "";
  groupSelect.innerHTML = scopes.map((item) => (
    `<option value="${escapeHtml(item.id)}"${item.id === current ? " selected" : ""}>${escapeHtml(item.name)}</option>`
  )).join("") || `<option value="">暂无分组</option>`;
  state.groupId = groupSelect.value;
}

function markActivePeriod() {
  document.querySelectorAll("#periodTabs [data-period]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.period === state.period);
  });
}

function bindReportToggle(project) {
  const toggle = document.querySelector("#projectReportToggle");
  const label = document.querySelector("#reportToggleLabel");
  if (!toggle) return;
  toggle.disabled = !project.id;
  toggle.checked = Boolean(project.reportEnabled);
  if (label) label.textContent = project.reportEnabled ? "已开统计" : "未开统计";
}

function renderProjectBar(project, groups) {
  const node = document.querySelector("#groupPanel");
  if (!project.id) {
    node.innerHTML = `<div class="empty">这个模块还没有项目。</div>`;
    return;
  }
  node.innerHTML = `<div class="section-title"><div><p>PROJECT</p><h2>${escapeHtml(project.name || "未命名项目")}</h2></div></div>
    <p class="section-hint">${groups.length ? `包含 ${groups.map((item) => item.name).join("、")}。每个分组单独落库，方便分开测试。` : "这个项目下还没有分组，先到 TikTok 账号页把账号分进去。"}</p>`;
}

async function toggleProjectReport(projectId, enabled) {
  const label = document.querySelector("#reportToggleLabel");
  if (label) label.textContent = enabled ? "已开统计" : "未开统计";
  try {
    const response = await fetch(`/api/official-tiktok/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportEnabled: enabled }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "更新开关失败。");
    loadReport();
  } catch (error) {
    document.querySelector("#reportMeta").textContent = error.message || "更新开关失败。";
    loadReport();
  }
}

function renderEmpty(message) {
  updateResultTabs();
  document.querySelector("#summaryGrid").innerHTML = "";
  ["anomalySection", "lowSection", "highSection", "normalSection"].forEach((id) => {
    document.querySelector(`#${id}`).innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  });
}

function renderAnomalies(rows, zeroVideos = []) {
  const node = document.querySelector("#anomalySection");
  if (!rows.length) {
    node.innerHTML = `<div class="section-title"><div><p>ACCOUNT ALERT</p><h2>异常账号</h2></div></div><div class="empty">这一时段没有 0 播账号。</div>`;
    return;
  }
  node.innerHTML = `<p class="section-hint">该时段有 0 播视频的账号，展开查看对应视频。</p><div class="report-anomalies">${rows.map((item) => {
    const videos = zeroVideos.filter((video) => item.account ? video.account === item.account : video.username === item.username);
    return `<details class="report-anomaly"><summary><strong>@${escapeHtml(item.username || item.label || "-")}</strong><span>0 播 ${formatNumber(item.zero)} 条 · 发布 ${formatNumber(item.published)} 条 · 总播放 ${formatNumber(item.views)}</span></summary>${videos.length ? videoTable(videos, "anomaly") : '<div class="empty">该快照暂无对应视频明细。</div>'}</details>`;
  }).join("")}</div>`;
}

function renderBucket(id, title, hint, rows, pageKey = "") {
  const node = document.querySelector(`#${id}`);
  if (!rows.length) {
    node.innerHTML = `${pageKey === "normal" ? "" : `<div class="section-title"><div><p>VIDEO</p><h2>${escapeHtml(title)}</h2></div></div>`}<div class="empty">${escapeHtml(hint)} 这一时段没有这类视频。</div>`;
    return;
  }
  const paged = pageKey ? paginateItems(rows, state.pages[pageKey] || 1) : { items: rows, page: 1, pageCount: 1, total: rows.length };
  if (pageKey) state.pages[pageKey] = paged.page;
  node.innerHTML = `<p class="section-hint">${escapeHtml(hint)} · ${paged.total} 条</p>${videoTable(paged.items, pageKey === "normal" ? state.activeTab : pageKey)}${pageKey ? renderPager(pageKey, paged) : ""}`;
  if (pageKey) bindPager(node, pageKey);
}

function paginateItems(items, page) {
  const list = Array.isArray(items) ? items : [];
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE) || 1);
  const current = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const start = (current - 1) * PAGE_SIZE;
  return {
    items: list.slice(start, start + PAGE_SIZE),
    page: current,
    pageCount,
    total: list.length,
  };
}

function renderPager(pageKey, paged) {
  if (paged.total <= PAGE_SIZE) return "";
  const buttons = [];
  buttons.push(`<button type="button" data-page="${paged.page - 1}" ${paged.page <= 1 ? "disabled" : ""}>上一页</button>`);
  for (let page = 1; page <= paged.pageCount; page++) {
    if (paged.pageCount > 9 && page !== 1 && page !== paged.pageCount && Math.abs(page - paged.page) > 2) {
      if (buttons[buttons.length - 1] !== "<span>…</span>") buttons.push("<span>…</span>");
      continue;
    }
    buttons.push(`<button type="button" data-page="${page}" class="${page === paged.page ? "is-active" : ""}">${page}</button>`);
  }
  buttons.push(`<button type="button" data-page="${paged.page + 1}" ${paged.page >= paged.pageCount ? "disabled" : ""}>下一页</button>`);
  return `<div class="ops-video-pager" data-bucket="${escapeHtml(pageKey)}"><span>每页 ${PAGE_SIZE} 条 · 共 ${paged.pageCount} 页 · ${paged.total} 条</span>${buttons.join("")}</div>`;
}

function bindPager(node, pageKey) {
  node.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.page);
      const pageCount = Math.max(1, Math.ceil((state.data?.report?.buckets?.[PAGE_BUCKETS[pageKey]] || []).length / PAGE_SIZE) || 1);
      if (!Number.isFinite(next) || next < 1 || next > pageCount || next === state.pages[pageKey]) return;
      state.pages[pageKey] = next;
      render();
      document.querySelector(`#${pageKey}Section`)?.scrollIntoView({ block: "start" });
    });
  });
}

function tiktokWatchUrl(video = {}) {
  const existing = String(video.shareLink || video.videoUrl || video.url || "").trim();
  if (/tiktok\.com\/@[\w.]+\/video\/\d{10,}/i.test(existing)) return existing;
  const id = String(video.id || video.videoId || "").trim();
  const username = String(video.username || "").replace(/^@/, "").trim();
  if (/^\d{10,}$/.test(id) && username) return `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${id}`;
  return "";
}

function videoTitleCell(item) {
  const title = escapeHtml(item.title || item.id || "未命名视频");
  const href = tiktokWatchUrl(item);
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${title}</a>` : title;
}

function videoJumpCell(item) {
  const href = tiktokWatchUrl(item);
  return href
    ? `<a class="table-action" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">打开</a>`
    : "—";
}

function readFilters() {
  state.groupId = document.querySelector("#groupSelect")?.value || "";
}

function applyPeriodRange(period) {
  state.period = normalizePeriodParam(period);
  if (state.period === "yesterday") {
    state.fromKey = shiftDateKey(todayKey, -1);
    state.toKey = state.fromKey;
    return;
  }
  if (state.period === "7d") {
    state.fromKey = shiftDateKey(todayKey, -6);
    state.toKey = todayKey;
    return;
  }
  if (state.period === "30d") {
    state.fromKey = shiftDateKey(todayKey, -29);
    state.toKey = todayKey;
    return;
  }
  state.fromKey = todayKey;
  state.toKey = todayKey;
}

function syncPeriodFromDates() {
  const matched = PRESET_PERIODS.find((period) => {
    const from = period === "yesterday" ? shiftDateKey(todayKey, -1)
      : period === "7d" ? shiftDateKey(todayKey, -6)
        : period === "30d" ? shiftDateKey(todayKey, -29)
          : todayKey;
    const to = period === "yesterday" ? from : todayKey;
    return state.fromKey === from && state.toKey === to;
  });
  state.period = matched || "today";
  markActivePeriod();
}

function syncQuery() {
  const next = new URL(location.href);
  next.searchParams.set("period", state.period);
  next.searchParams.set("tab", state.activeTab);
  if (state.groupId) next.searchParams.set("group", state.groupId);
  else next.searchParams.delete("group");
  if (state.fromKey) next.searchParams.set("from", state.fromKey);
  else next.searchParams.delete("from");
  if (state.toKey) next.searchParams.set("to", state.toKey);
  else next.searchParams.delete("to");
  next.searchParams.delete("date");
  history.replaceState({}, "", next);
}

function rangeLabel(report) {
  const from = report.fromKey || report.dateKey || state.fromKey;
  const to = report.toKey || report.dateKey || state.toKey;
  if (report.period === "yesterday") return `昨天 · ${from}`;
  if (report.period === "7d") return `近7天 · ${from} 至 ${to}`;
  if (report.period === "30d") return `最近30天 · ${from} 至 ${to}`;
  if (report.period === "week") return `本周 · ${from} 至 ${to}`;
  if (from && to && from !== to) return `${from} 至 ${to}`;
  return `今天 · ${from || to || ""}`;
}

function averageViews(summary) {
  const published = Number(summary.published || 0);
  return published ? Math.round(Number(summary.views || 0) / published) : 0;
}

function shanghaiDateKey(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function shiftDateKey(dateKey, days) {
  return shanghaiDateKey(Date.parse(`${dateKey}T00:00:00+08:00`) + days * 86_400_000);
}

function normalizePeriodParam(value) {
  const period = String(value || "").trim();
  if (period === "week") return "7d";
  return PRESET_PERIODS.includes(period) ? period : "today";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatTime(value) {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "-";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function selectResultTab(tab) {
  if (!["high", "low", "anomaly"].includes(tab)) return;
  state.activeTab = tab;
  updateResultTabs();
  syncQuery();
}
function updateResultTabs() {
  const report = state.data?.report;
  const counts = report?.enabled && !report.missing ? {
    high: report.buckets?.highView?.length || 0,
    low: report.buckets?.lowView?.length || 0,
    anomaly: report.anomalyAccounts?.length || 0,
  } : null;
  const labels = { high: "高播视频", low: "低播视频", anomaly: "异常账号" };
  document.querySelectorAll("[data-result-tab]").forEach((button) => {
    const tab = button.dataset.resultTab;
    const active = tab === state.activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    button.textContent = labels[tab] + (counts ? " (" + counts[tab] + ")" : "");
  });
  for (const tab of Object.keys(labels)) {
    document.querySelector("#" + tab + "Section").hidden = tab !== state.activeTab;
  }
}
function videoDetailHref(item, tab = state.activeTab) {
  if (!item.account || !item.id) return "";
  const back = new URL(location.href);
  back.searchParams.set("tab", tab);
  const query = new URLSearchParams({
    account: item.account, video: item.id, module: state.module,
    returnTo: back.pathname + back.search,
  });
  return "/official-video-detail?" + query;
}
function videoTable(items, tab) {
  return '<div class="table-wrap"><table class="report-video-table"><thead><tr><th>视频</th><th>账号</th><th>播放</th><th>点赞</th><th>发布时间</th><th>操作</th></tr></thead><tbody>' +
    items.map((item) => {
      const detail = videoDetailHref(item, tab);
      return '<tr><td class="report-video-title">' + videoTitleCell(item) + '</td><td>@' + escapeHtml(item.username || "-") +
        '</td><td>' + formatNumber(item.views) + '</td><td>' + formatNumber(item.likes) + '</td><td>' + formatTime(item.createdAt) +
        '</td><td><div class="report-video-actions">' + (detail ? '<a class="table-action primary-table-action" href="' + escapeHtml(detail) + '">视频详情</a>' : '<span>暂无详情</span>') +
        videoJumpCell(item) + '</div></td></tr>';
    }).join("") + '</tbody></table></div>';
}


async function loadTraffic(query, requestId, signal) {
  const panel = document.querySelector('#trafficPanel');
  document.querySelector('#trafficDetails').hidden = false;
  panel.innerHTML = '<h2>主页访问</h2><p role="status">正在读取同期播放与主页访问…</p>';
  state.traffic = null;
  state.trafficPage = 1;
  try {
    const q = new URLSearchParams(query); q.set('view', 'traffic');
    const response = await fetch(`/api/official-tiktok/ops-report?${q}`, {cache:'no-store', signal});
    const data = await response.json();
    if (requestId !== reportRequest || signal.aborted) return;
    if (!response.ok) throw new Error(data.error || '主页访问读取失败，请点击查询重试。');
    if (!data.report?.enabled) { document.querySelector('#trafficDetails').hidden = true; return; }
    state.traffic = data.traffic;
    renderTraffic();
    if (state.data?.report?.enabled) renderSummary();
  } catch (error) {
    if (requestId !== reportRequest || signal.aborted) return;
    panel.innerHTML = `<h2>主页访问</h2><p role="alert">${escapeHtml(error.message)}</p>`;
  }
}

function renderTraffic() {
  const panel = document.querySelector('#trafficPanel');
  const data = state.traffic;
  if (!data) return;
  const s = data.summary;
  const count = v => v === null ? '—' : formatNumber(v);
  const ratio = v => v === null ? '—' : `${(v * 100).toFixed(2)}%`;
  const totalPages = Math.max(1, Math.ceil(data.accounts.length / PAGE_SIZE));
  state.trafficPage = Math.min(totalPages, Math.max(1, state.trafficPage));
  const rows = data.accounts.slice((state.trafficPage - 1) * PAGE_SIZE, state.trafficPage * PAGE_SIZE);
  panel.innerHTML = `<div class="section-title"><h2>主页访问</h2><span>${escapeHtml(data.fromKey)} 至 ${escapeHtml(data.toKey)} · UTC</span></div>
    <p class="section-hint">每天后台更新。TikTok 日报存在延迟，今天可能尚无数据；未返回显示为 —。这里统计日期内发生的播放，上方的视频表现统计所选日期发布视频的累计播放。</p>
    <div class="traffic-metrics">${[
      ['同期视频播放', count(s.videoViews)], ['主页访问次数', count(s.profileViews)],
      ['主页访问比', ratio(s.ratio)], ['可配对账号', `${s.coveredAccounts} / ${s.totalAccounts}`],
    ].map(([label,value])=>`<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <p class="section-hint">访问比 = 同账号、同日的主页访问 ÷ 视频播放。参与计算：${formatNumber(s.pairedProfileViews)} 次访问 / ${formatNumber(s.pairedVideoViews)} 次播放，共 ${s.pairedDays} 个账号日。仅供趋势参考，主页访问可能来自搜索等其他入口，不代表视频观众转化率。</p>
    <p class="section-hint">所选范围最新数据日：${escapeHtml(s.latestDate || '尚无')} · 最近同步：${s.updatedAt ? escapeHtml(formatTime(s.updatedAt)) : '等待首次同步'}</p>
    <div class="traffic-table-wrap"><table class="traffic-table"><thead><tr><th>账号</th><th>同期播放</th><th>主页访问</th><th>访问比</th><th>配对天数</th><th>最近同步</th><th>数据状态</th></tr></thead><tbody>${rows.length ? rows.map(row => {
      const status = row.syncStatus === 'error' ? '本次同步失败' : row.pairedDays === row.expectedDays ? '完整' : row.pairedDays ? '部分日期可用' : row.syncStatus === 'pending' ? '等待首次同步' : '所选日期未返回完整指标';
      return `<tr><td>${escapeHtml(row.label)}</td><td>${count(row.videoViews)}</td><td>${count(row.profileViews)}</td><td title="仅按配对日期计算">${ratio(row.ratio)}</td><td>${row.pairedDays} / ${row.expectedDays}</td><td>${row.updatedAt ? escapeHtml(formatTime(row.updatedAt)) : '—'}</td><td>${status}</td></tr>`;
    }).join('') : '<tr><td colspan="7">当前分组暂无账号。</td></tr>'}</tbody></table></div>
    <div class="traffic-pager"><button type="button" data-traffic-page="-1" ${state.trafficPage === 1 ? 'disabled' : ''}>上一页</button><span>第 ${state.trafficPage} / ${totalPages} 页 · 共 ${data.accounts.length} 个账号</span><button type="button" data-traffic-page="1" ${state.trafficPage === totalPages ? 'disabled' : ''}>下一页</button></div>`;
  panel.querySelectorAll('[data-traffic-page]').forEach(button => button.addEventListener('click', () => {
    state.trafficPage += Number(button.dataset.trafficPage); renderTraffic();
  }));
}

async function loadMatchingOverview(query, requestId, signal) {
 const panel=document.querySelector('#matchingOverview');
 if(!panel)return;
 panel.hidden=false;panel.setAttribute('aria-busy','true');
 panel.innerHTML='<div class="section-title"><h2>账号池 × 内容池</h2></div><p role="status">正在读取账号分层与匹配效果…</p>';
 try{
  const q=new URLSearchParams(query);q.set('view','pools');q.set('media','photo');
  const res=await fetch('/api/official-tiktok/ops-report?'+q,{cache:'no-store',signal}),data=await res.json();
  if(requestId!==reportRequest||signal.aborted)return;
  if(!res.ok)throw Error(data.error||'匹配概览读取失败');
  if(data.report?.enabled===false){panel.hidden=true;return;}
  if(!data.matching)throw Error('匹配概览暂未就绪');
  renderMatchingOverview(data.matching,panel,query);
 }catch(error){if(requestId!==reportRequest||signal.aborted)return;panel.innerHTML='<h2>账号池 × 内容池</h2><p role="alert">'+escapeHtml(error.message)+' <button type="button" class="table-action" id="retryMatchingOverview">重试</button></p>';document.querySelector('#retryMatchingOverview').onclick=()=>loadMatchingOverview(query,requestId,signal);}
 finally{if(requestId===reportRequest&&!signal.aborted)panel.setAttribute('aria-busy','false');}
}
function renderMatchingOverview(m,panel,query){
 const count=v=>v==null?'—':formatNumber(v),percent=v=>v==null?'—':(v*100).toFixed(1)+'%',pools=m.accountPools||[],contents=m.contentPools||[],cov=m.coverage||{},rec=m.recovery||{},stats=m.overview?.mature||{};
 const rescue=pools.filter(r=>['rescue','rescue_entry','rescue_retention','rescue_hook','rescue_hold','rescue-hook','rescue-content'].includes(r.id));
 const diagnostic=pools.filter(r=>['diagnostic','diagnose'].includes(r.id));
 const totalFor=rows=>rows.length?rows.reduce((n,r)=>n+Number(r.accounts||0),0):0;
 const period=query?.get('period')||state.period,group=query?.get('group')||state.groupId,linkQuery=new URLSearchParams({period:period==='yesterday'?'custom':period,media:'photo'});if(group)linkQuery.set('group',group);if(!PRESET_PERIODS.includes(period)||period==='yesterday'){linkQuery.set('from',query?.get('from')||state.fromKey);linkQuery.set('to',query?.get('to')||state.toKey);}
 const allocation=m.allocation||{},actual=allocation.rows||[],planned=actual.reduce((n,r)=>n+Number(r.planned||0),0),warmup=actual.reduce((n,r)=>n+Number(r.warmup||0),0);
 const longQuery=new URLSearchParams(linkQuery);longQuery.set('period','30d');longQuery.delete('from');longQuery.delete('to');const weekQuery=new URLSearchParams(longQuery);weekQuery.set('period','7d');
 panel.innerHTML='<div class="section-title"><div><p>POOL MATCHING</p><h2>账号池 × 内容池</h2></div><a class="table-action primary-table-action" href="/psychology-ops-report?'+escapeHtml(linkQuery.toString())+'">进入运营报表</a></div>'+
 (m.readiness?.status==='warming'?'<div class="matching-readiness" role="status"><strong>优胜版本补测中</strong><p>'+escapeHtml(m.readiness.nextStep)+'</p><small>当前严格优胜版本 '+count(m.readiness.winnerVersions)+' · 满足对应池条件的版本 '+count(m.readiness.readyVersions)+'。低号缺少合格基准会跳过并记录原因。</small></div>':'')+'<div class="matching-overview-cards">'+[['授权账号',cov.authorizedAccounts],['需内容救援',totalFor(rescue)],['近零待诊断',totalFor(diagnostic)],['样本不足待观察',cov.observingAccounts],['跨层改善',rec.improved],['已满72h可评估作品',stats.n]].map(([label,value])=>'<div class="metric"><span>'+escapeHtml(label)+'</span><strong>'+count(value)+'</strong></div>').join('')+'</div>'+
 '<div class="matching-overview-pools">'+pools.map(r=>'<span>'+escapeHtml(r.label)+' <strong>'+count(r.accounts)+'</strong></span>').join('')+'</div>'+
 '<p class="section-hint">内容池：'+contents.map(r=>escapeHtml(r.label)+' '+count(r.versions)).join(' · ')+'。只统计已观察的具体版本；今天的新发布样本尚未满72小时。自动运营实际匹配使用近30天成熟累计样本。 <a href="/psychology-ops-report?'+escapeHtml(weekQuery.toString())+'">近7天复盘</a> · <a href="/psychology-ops-report?'+escapeHtml(longQuery.toString())+'">近30天分层</a></p>'+
 '<p class="section-hint">已满72h样本：中位播放 '+count(stats.medianViews)+' · 千播率 '+percent(stats.potentialRate)+' · 完成率 '+percent(stats.completion)+'；待同步 '+count(cov.missingMetrics)+' 条。使用最新累计指标，不是第72小时的精确快照。</p>'+
 '<p class="section-hint">新策略实际分配 '+count(allocation.total??planned)+' 条 · 其中固定版本补测 '+count(warmup)+' 条。以排期时的账号池与内容池统计，历史表现按当前分层回看，分别呈现。</p>'+
 '<p class="section-hint">分池反映可观测流量表现，不代表平台内部权重。低号恢复要求两期各至少6条且覆盖3个来源；样本不足暂不判断。匹配结果与具体内容版本见运营报表。</p>';
}
