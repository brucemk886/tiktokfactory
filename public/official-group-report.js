const MODULE_FROM_PATH = {
  "/novel-ops-report": "novel-promotion",
  "/mid-video-ops-report": "mid-video",
  "/psychology-ops-report": "psychology",
};

const MODULE_LABEL = {
  "novel-promotion": "小说推文",
  "mid-video": "中视频",
  "psychology": "心理学",
};

function reportNoun() {
  return state.module === "novel-promotion" ? "数据概览" : "运营报表";
}

function reportTitle() {
  return state.module === "novel-promotion"
    ? "数据概览"
    : `${MODULE_LABEL[state.module] || "项目"} · 运营报表`;
}

function reportCopy(project = {}) {
  if (state.module === "novel-promotion") {
    return project.name
      ? `${project.name} 看项目账号的发布和播放，不区分是不是小说内容。`
      : "看小说推文项目账号的发布和播放，不区分是不是小说内容。";
  }
  return project.name
    ? `${project.name} 按分组落日报和周报，方便后面分开对照。`
    : "这个模块还没有项目。";
}

const PAGE_SIZE = 10;
const params = new URLSearchParams(location.search);
const todayKey = shanghaiDateKey();
const state = {
  module: MODULE_FROM_PATH[location.pathname] || params.get("module") || "",
  period: params.get("period") === "week" ? "week" : params.get("period") === "range" ? "range" : "today",
  groupId: params.get("group") || "",
  fromKey: params.get("from") || params.get("date") || "",
  toKey: params.get("to") || params.get("date") || "",
  data: null,
  pages: { high: 1, low: 1 },
};

if (!state.fromKey || !state.toKey) {
  applyPeriodRange(state.period === "week" ? "week" : "today");
}

bindToolbar();
loadReport();

function bindToolbar() {
  document.querySelectorAll("#periodTabs [data-period]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.period === (state.period === "range" ? "" : state.period));
    button.addEventListener("click", () => {
      applyPeriodRange(button.dataset.period);
      fillDateInputs();
      document.querySelectorAll("#periodTabs [data-period]").forEach((item) => item.classList.toggle("is-active", item === button));
    });
  });
  document.querySelector("#fromDate")?.addEventListener("change", () => {
    state.fromKey = document.querySelector("#fromDate").value;
    syncPeriodFromDates();
  });
  document.querySelector("#toDate")?.addEventListener("change", () => {
    state.toKey = document.querySelector("#toDate").value;
    syncPeriodFromDates();
  });
  document.querySelector("#groupSelect")?.addEventListener("change", (event) => {
    state.groupId = event.target.value;
  });
  document.querySelector("#queryBtn")?.addEventListener("click", () => {
    readFilters();
    if (state.fromKey && state.toKey && state.fromKey > state.toKey) {
      document.querySelector("#reportMeta").textContent = "结束日期不能早于开始日期。";
      return;
    }
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
  fillDateInputs();
}

async function loadReport() {
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
  try {
    const query = new URLSearchParams({ module: state.module, period: state.period });
    if (state.groupId) query.set("group", state.groupId);
    if (state.fromKey) query.set("from", state.fromKey);
    if (state.toKey) query.set("to", state.toKey);
    const response = await fetch(`/api/official-tiktok/ops-report?${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "读取报表失败。");
    state.data = data;
    if (!state.groupId && data.report?.groupId) state.groupId = data.report.groupId;
    if (data.report?.fromKey) state.fromKey = data.report.fromKey;
    if (data.report?.toKey) state.toKey = data.report.toKey;
    state.pages = { high: 1, low: 1 };
    render();
  } catch (error) {
    meta.textContent = error.message || "读取报表失败。";
    renderEmpty(error.message || "读取报表失败。");
  }
}

function render() {
  const data = state.data || {};
  const project = data.project || {};
  const groups = data.groups || [];
  const report = data.report || {};
  const scopeName = report.groupName || (state.groupId ? groups.find((item) => item.id === state.groupId)?.name : "全部项目") || "全部项目";
  document.querySelector("#pageCopy").textContent = reportCopy(project);
  fillSelects(data);
  fillDateInputs();
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
  document.querySelector("#summaryGrid").innerHTML = [
    ["发布总数", formatNumber(summary.publishTotal ?? ((Number(summary.publishSuccess) || 0) + (Number(summary.publishFailed) || 0)))],
    ["发布视频", formatNumber(summary.published)],
    ["发布成功", formatNumber(summary.publishSuccess)],
    ["发布失败", formatNumber(summary.publishFailed)],
    ["风控账号", formatNumber(summary.riskAccountCount)],
    ["0 播", formatNumber(summary.zeroView)],
    ["低播", formatNumber(summary.lowView)],
    ["高播", formatNumber(summary.highView)],
    ["总播放", formatNumber(summary.views)],
    ["均播", formatNumber(summary.avgView ?? averageViews(summary))],
    ["异常账号", formatNumber(summary.anomalyAccountCount)],
  ].map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  renderAnomalies(report.anomalyAccounts || []);
  renderBucket("zeroSection", "0 播 / 账号异常", "发布后还是 0 播放，优先检查账号或审核。", report.buckets?.zeroView || []);
  renderBucket("highSection", "高播视频", `播放达到 ${report.thresholds?.highView || 1000} 以上。`, report.buckets?.highView || [], "high");
  renderBucket("lowSection", "低播视频", `播放低于 ${report.thresholds?.lowView || 200}。`, report.buckets?.lowView || [], "low");
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

function fillDateInputs() {
  const fromInput = document.querySelector("#fromDate");
  const toInput = document.querySelector("#toDate");
  if (fromInput) {
    fromInput.max = todayKey;
    fromInput.value = state.fromKey || todayKey;
  }
  if (toInput) {
    toInput.max = todayKey;
    toInput.value = state.toKey || todayKey;
  }
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
  document.querySelector("#summaryGrid").innerHTML = "";
  ["anomalySection", "zeroSection", "lowSection", "highSection"].forEach((id) => {
    document.querySelector(`#${id}`).innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  });
}

function renderAnomalies(rows) {
  const node = document.querySelector("#anomalySection");
  if (!rows.length) {
    node.innerHTML = `<div class="section-title"><div><p>ACCOUNT ALERT</p><h2>异常账号</h2></div></div><div class="empty">这一时段没有 0 播账号。</div>`;
    return;
  }
  node.innerHTML = `<div class="section-title"><div><p>ACCOUNT ALERT</p><h2>异常账号</h2></div></div>
    <div class="table-wrap"><table><thead><tr><th>账号</th><th>发布</th><th>0 播</th><th>低播</th><th>高播</th><th>总播放</th></tr></thead>
    <tbody>${rows.map((item) => `<tr>
      <td>@${escapeHtml(item.username || item.label || "-")}</td>
      <td>${formatNumber(item.published)}</td>
      <td>${formatNumber(item.zero)}</td>
      <td>${formatNumber(item.low)}</td>
      <td>${formatNumber(item.high)}</td>
      <td>${formatNumber(item.views)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderBucket(id, title, hint, rows, pageKey = "") {
  const node = document.querySelector(`#${id}`);
  if (!rows.length) {
    node.innerHTML = `<div class="section-title"><div><p>VIDEO</p><h2>${escapeHtml(title)}</h2></div></div><div class="empty">${escapeHtml(hint)} 这一时段没有这类视频。</div>`;
    return;
  }
  const paged = pageKey ? paginateItems(rows, state.pages[pageKey] || 1) : { items: rows, page: 1, pageCount: 1, total: rows.length };
  if (pageKey) state.pages[pageKey] = paged.page;
  node.innerHTML = `<div class="section-title"><div><p>VIDEO</p><h2>${escapeHtml(title)}</h2></div><span>${paged.total} 条</span></div>
    <div class="table-wrap"><table><thead><tr><th>视频</th><th>账号</th><th>播放</th><th>点赞</th><th>发布时间</th><th>跳转</th></tr></thead>
    <tbody>${paged.items.map((item) => `<tr>
      <td>${videoTitleCell(item)}</td>
      <td>@${escapeHtml(item.username || "-")}</td>
      <td>${formatNumber(item.views)}</td>
      <td>${formatNumber(item.likes)}</td>
      <td>${formatTime(item.createdAt)}</td>
      <td>${videoJumpCell(item)}</td>
    </tr>`).join("")}</tbody></table></div>
    ${pageKey ? renderPager(pageKey, paged) : ""}`;
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
      const pageCount = Math.max(1, Math.ceil((state.data?.report?.buckets?.[pageKey === "high" ? "highView" : "lowView"] || []).length / PAGE_SIZE) || 1);
      if (!Number.isFinite(next) || next < 1 || next > pageCount || next === state.pages[pageKey]) return;
      state.pages[pageKey] = next;
      render();
      document.querySelector(`#${pageKey === "high" ? "highSection" : "lowSection"}`)?.scrollIntoView({ block: "start" });
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
  state.fromKey = document.querySelector("#fromDate")?.value || state.fromKey;
  state.toKey = document.querySelector("#toDate")?.value || state.toKey;
  syncPeriodFromDates();
}

function applyPeriodRange(period) {
  state.period = period;
  if (period === "week") {
    state.fromKey = weekStartKey();
    state.toKey = todayKey;
    return;
  }
  state.fromKey = todayKey;
  state.toKey = todayKey;
}

function syncPeriodFromDates() {
  const weekStart = weekStartKey();
  if (state.fromKey === todayKey && state.toKey === todayKey) {
    state.period = "today";
    document.querySelectorAll("#periodTabs [data-period]").forEach((item) => item.classList.toggle("is-active", item.dataset.period === "today"));
    return;
  }
  if (state.fromKey === weekStart && state.toKey === todayKey) {
    state.period = "week";
    document.querySelectorAll("#periodTabs [data-period]").forEach((item) => item.classList.toggle("is-active", item.dataset.period === "week"));
    return;
  }
  state.period = "range";
  document.querySelectorAll("#periodTabs [data-period]").forEach((item) => item.classList.remove("is-active"));
}

function syncQuery() {
  const next = new URL(location.href);
  next.searchParams.set("period", state.period);
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
  if (report.period === "week") return `本周 · ${from} 至 ${to}`;
  if (from && to && from !== to) return `${from} 至 ${to}`;
  return `今日 · ${from || to || ""}`;
}

function averageViews(summary) {
  const published = Number(summary.published || 0);
  return published ? Math.round(Number(summary.views || 0) / published) : 0;
}

function shanghaiDateKey(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function weekStartKey(timestamp = Date.now()) {
  const dateKey = shanghaiDateKey(timestamp);
  const dayStart = Date.parse(`${dateKey}T00:00:00+08:00`);
  const weekday = new Date(timestamp).toLocaleDateString("en-US", { timeZone: "Asia/Shanghai", weekday: "short" });
  const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
  return shanghaiDateKey(dayStart - offset * 86_400_000);
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
