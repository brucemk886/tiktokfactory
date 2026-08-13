const ui = window.OfficialAnalytics;
const params = new URLSearchParams(location.search);
const state = { account: params.get("account") || "", search: "", sortKey: "views", sortOrder: "desc", data: null };
if (!state.account) location.replace("/official-analytics");

ui.$("#videoSearch")?.addEventListener("input", ui.debounce((event) => { state.search = event.target.value.trim().toLowerCase(); renderVideos(); }, 200));
document.querySelector(".video-list-head")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sort]");
  if (!button) return;
  if (state.sortKey === button.dataset.sort) state.sortOrder = state.sortOrder === "desc" ? "asc" : "desc";
  else { state.sortKey = button.dataset.sort; state.sortOrder = "desc"; }
  renderVideos();
});
load();

async function load() { ui.showStatus("正在读取账号视频…"); try { state.data = await ui.fetchDashboard({ account: state.account, days: "all" }); render(); ui.hideStatus(); } catch (error) { ui.showStatus(error.message || "读取失败"); } }
function value(item, ...keys) { return ui.pick(item, ...keys) ?? ui.pick(ui.parseObject(item.analytics), ...keys); }
function numeric(item, key) {
  const aliases = { createTime: ["createTime", "createdAt", "create_time", "publishTime", "publish_time", "publishedAt", "published_at"], duration: ["duration", "videoDuration", "video_duration"], totalTimeWatched: ["totalTimeWatched", "total_time_watched"], averageTimeWatched: ["averageTimeWatched", "average_time_watched"], fullWatchRate: ["fullWatchRate", "full_video_watched_rate"] };
  const raw = value(item, ...(aliases[key] || [key]));
  if (key === "createTime" && !Number.isFinite(Number(raw))) return Date.parse(String(raw || "")) || 0;
  return Number(raw) || 0;
}
function render() { const account = (state.data?.accounts || []).find((item) => item.schema === state.account); ui.$("#pageTitle").textContent = `${account?.label || state.account} 的全部视频`; ui.$("#backAccount").href = `/official-account-detail?account=${encodeURIComponent(state.account)}`; renderVideos(); }
function renderVideos() {
  const direction = state.sortOrder === "desc" ? -1 : 1;
  const rows = (state.data?.videos || []).filter((item) => !state.search || `${item.id || ""} ${item.title || item.caption || ""}`.toLowerCase().includes(state.search)).sort((a, b) => (numeric(a, state.sortKey) - numeric(b, state.sortKey)) * direction);
  document.querySelectorAll("button[data-sort]").forEach((button) => { button.classList.toggle("is-active", button.dataset.sort === state.sortKey); button.dataset.direction = button.dataset.sort === state.sortKey ? state.sortOrder : ""; });
  ui.$("#videoCount").textContent = `${rows.length} 条视频`;
  ui.$("#videoRows").innerHTML = rows.length ? rows.map((item) => {
    const title = item.title || item.caption || "未命名视频";
    const thumb = value(item, "thumbnailUrl", "thumbnail_url", "coverImageUrl", "cover_image_url");
    const share = value(item, "shareUrl", "share_url", "embedUrl", "embed_url");
    const published = value(item, "createTime", "createdAt", "create_time", "publishTime", "publish_time", "publishedAt", "published_at");
    return `<div class="video-row rich-video-grid"><span class="video-identity rich-video-identity">${thumb ? `<img src="${ui.escapeHtml(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : ""}<i><strong>${ui.escapeHtml(title)}</strong><small>视频 ID：${ui.escapeHtml(item.id || "")}</small></i></span><span>${ui.dateTime(published)}</span><span>${ui.duration(value(item, "duration", "videoDuration", "video_duration"))}</span><span>${ui.format(item.views)}</span><span>${ui.format(item.likes)}</span><span>${ui.format(item.comments)}</span><span>${ui.format(item.shares)}</span><span>${ui.duration(value(item, "totalTimeWatched", "total_time_watched"))}</span><span>${ui.duration(value(item, "averageTimeWatched", "average_time_watched"))}</span><span>${ui.percent(value(item, "fullWatchRate", "full_video_watched_rate"))}</span><span>${ui.format(item.reach)}</span><span class="video-actions"><a class="table-action primary-table-action" href="/official-video-detail?account=${encodeURIComponent(state.account)}&video=${encodeURIComponent(item.id || "")}">留存分析</a>${share ? `<a class="table-action" target="_blank" rel="noreferrer" href="${ui.escapeHtml(share)}">打开</a>` : ""}</span></div>`;
  }).join("") : '<div class="empty">该账号暂无匹配的视频归档</div>';
}
