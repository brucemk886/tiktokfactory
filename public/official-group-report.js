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

const params = new URLSearchParams(location.search);
const state = {
  module: MODULE_FROM_PATH[location.pathname] || params.get("module") || "",
  period: params.get("period") === "week" ? "week" : "today",
  data: null,
};

document.querySelectorAll("#periodTabs [data-period]").forEach((button) => {
  button.classList.toggle("is-active", button.dataset.period === state.period);
  button.addEventListener("click", () => {
    state.period = button.dataset.period;
    const next = new URL(location.href);
    next.searchParams.set("period", state.period);
    history.replaceState({}, "", next);
    document.querySelectorAll("#periodTabs [data-period]").forEach((item) => item.classList.toggle("is-active", item === button));
    loadReport();
  });
});

loadReport();

async function loadReport() {
  const title = document.querySelector("#pageTitle");
  const copy = document.querySelector("#pageCopy");
  const meta = document.querySelector("#reportMeta");
  if (!state.module) {
    title.textContent = "运营报表";
    copy.textContent = "请从小说推文、中视频或心理学模块进入。";
    meta.textContent = "还没有指定项目。";
    renderEmpty("运营报表按项目统计，不按分组。");
    return;
  }
  title.textContent = `${MODULE_LABEL[state.module] || "项目"} · 运营报表`;
  document.title = title.textContent;
  meta.textContent = "正在读取报表…";
  try {
    const query = new URLSearchParams({ module: state.module, period: state.period });
    const response = await fetch(`/api/official-tiktok/ops-report?${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "读取报表失败。");
    state.data = data;
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
  document.querySelector("#pageCopy").textContent = project.name
    ? `${project.name} 下已分配分组账号的今日 / 本周新发情况。开关关着就不统计。`
    : "这个模块还没有项目。";
  renderProjectBar(project, groups);
  if (!report.enabled) {
    document.querySelector("#reportMeta").textContent = "这个项目还没打开运营报表。";
    renderEmpty("打开上面的开关后，会按整个项目统计今天和本周的 0 播、低播、高播。");
    return;
  }
  const summary = report.summary || {};
  document.querySelector("#reportMeta").textContent = `${report.period === "week" ? "本周" : "今日"} · ${report.dateKey || ""} · ${groups.length} 个分组 · 低播 < ${report.thresholds?.lowView || 200} · 高播 ≥ ${report.thresholds?.highView || 1000}`;
  document.querySelector("#summaryGrid").innerHTML = [
    ["发布视频", summary.published],
    ["0 播", summary.zeroView],
    ["低播", summary.lowView],
    ["高播", summary.highView],
    ["总播放", summary.views],
    ["异常账号", summary.anomalyAccountCount],
  ].map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div>`).join("");
  renderAnomalies(report.anomalyAccounts || []);
  renderBucket("zeroSection", "0 播 / 账号异常", "发布后还是 0 播放，优先检查账号或审核。", report.buckets?.zeroView || []);
  renderBucket("lowSection", "低播视频", `播放低于 ${report.thresholds?.lowView || 200}。`, report.buckets?.lowView || []);
  renderBucket("highSection", "高播视频", `播放达到 ${report.thresholds?.highView || 1000} 以上。`, report.buckets?.highView || []);
}

function renderProjectBar(project, groups) {
  const node = document.querySelector("#groupPanel");
  if (!project.id) {
    node.innerHTML = `<div class="empty">这个模块还没有项目。</div>`;
    return;
  }
  node.innerHTML = `<div class="section-title"><div><p>PROJECT</p><h2>${escapeHtml(project.name || "未命名项目")}</h2></div>
    <label class="report-switch"><input type="checkbox" id="projectReportToggle"${project.reportEnabled ? " checked" : ""}><span>${project.reportEnabled ? "已开统计" : "未开统计"}</span></label></div>
    <p class="section-hint">${groups.length ? `包含 ${groups.map((item) => item.name).join("、")}。` : "这个项目下还没有分组，先到 TikTok 账号页把账号分进去。"}</p>`;
  node.querySelector("#projectReportToggle")?.addEventListener("change", (event) => {
    toggleProjectReport(project.id, event.target.checked);
  });
}

async function toggleProjectReport(projectId, enabled) {
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

function renderBucket(id, title, hint, rows) {
  const node = document.querySelector(`#${id}`);
  if (!rows.length) {
    node.innerHTML = `<div class="section-title"><div><p>VIDEO</p><h2>${escapeHtml(title)}</h2></div></div><div class="empty">${escapeHtml(hint)} 这一时段没有这类视频。</div>`;
    return;
  }
  node.innerHTML = `<div class="section-title"><div><p>VIDEO</p><h2>${escapeHtml(title)}</h2></div></div>
    <div class="table-wrap"><table><thead><tr><th>视频</th><th>账号</th><th>播放</th><th>点赞</th><th>发布时间</th></tr></thead>
    <tbody>${rows.map((item) => `<tr>
      <td>${escapeHtml(item.title || item.id)}</td>
      <td>@${escapeHtml(item.username || "-")}</td>
      <td>${formatNumber(item.views)}</td>
      <td>${formatNumber(item.likes)}</td>
      <td>${formatTime(item.createdAt)}</td>
    </tr>`).join("")}</tbody></table></div>`;
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
