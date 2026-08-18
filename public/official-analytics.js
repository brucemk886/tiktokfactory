const ui = window.OfficialAnalytics;
const page = ui.MODULE_PAGES[location.pathname.replace(/\/$/, "") || "/"] || null;
const state = { days: "30", search: "", data: null, module: page?.module || "" };

if (page) {
  document.title = `${page.title} · Local Factory`;
  if (ui.$("#pageKicker")) ui.$("#pageKicker").textContent = page.kicker;
  if (ui.$("#pageTitle")) ui.$("#pageTitle").textContent = page.title;
  if (ui.$("#pageCopy")) ui.$("#pageCopy").textContent = page.copy;
}

ui.$("#daysFilter")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-days]");
  if (!button) return;
  state.days = button.dataset.days;
  ui.activate(button, "[data-days]");
  load();
});
ui.$("#accountSearch")?.addEventListener("input", ui.debounce((event) => {
  state.search = event.target.value.trim();
  load();
}, 300));
ui.$("#syncOfficialData")?.addEventListener("click", () => ui.syncNow(load));
load();

async function load() {
  ui.showStatus("正在读取账号数据…");
  try {
    state.data = await ui.fetchDashboard({ days: state.days, search: state.search, module: state.module });
    render();
    ui.hideStatus();
  } catch (error) {
    ui.showStatus(error.message || "读取失败");
  }
}

function render() {
  const data = state.data || {};
  ui.$("#syncState").textContent = data.state?.running
    ? "正在同步…"
    : data.latestDate
      ? `最近同步：${data.latestDate}`
      : "尚无数据，请点击立即同步";
  renderOverview(data.overview || {});
  const rows = data.accounts || [];
  ui.$("#accountCount").textContent = `${rows.length} 个账号`;
  const empty = state.module
    ? "这个模块还没有绑定账号。请到官方通道的 TikTok 账号里，把账号分到对应项目的分组。"
    : "暂无官方授权账号归档";
  ui.$("#accountRows").innerHTML = rows.length
    ? rows.map((item) => `<tr><td><div class="account-name">${ui.avatar(item)}<div><strong>${ui.escapeHtml(item.label)}</strong><small>${ui.escapeHtml(item.schema)}</small></div></div></td><td>${ui.escapeHtml(item.groupName || "未分组")}</td><td>${ui.format(item.followers)}</td><td>${ui.format(item.videoCount)}</td><td>${ui.format(item.views)}</td><td>${ui.format(item.likes)}</td><td>${ui.format(item.comments)}</td><td>${ui.format(item.shares)}</td><td>${ui.format(item.reach)}</td><td>${ui.dateTime(item.syncedAt)}</td><td><span class="video-actions"><a class="table-action" href="${ui.withModule(`/official-account-detail?account=${encodeURIComponent(item.schema)}`)}">账号详情</a><a class="table-action primary-table-action" href="${ui.withModule(`/official-account-videos?account=${encodeURIComponent(item.schema)}`)}">全部视频</a></span></td></tr>`).join("")
    : `<tr><td colspan="11" class="empty">${empty}</td></tr>`;
}

function renderOverview(values) {
  const items = [["授权账号", values.accounts], ["归档视频", values.videos], ["粉丝", values.followers], ["播放", values.views], ["点赞", values.likes], ["评论", values.comments], ["分享", values.shares], ["触达", values.reach]];
  ui.$("#overviewCards").innerHTML = items.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${ui.format(value)}</strong></div>`).join("");
}
