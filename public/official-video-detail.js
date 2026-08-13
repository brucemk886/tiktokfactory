const ui = window.OfficialAnalytics;
const params = new URLSearchParams(location.search);
const state = { account: params.get("account") || "", video: params.get("video") || "", data: null, detail: null };
if (!state.account || !state.video) location.replace("/official-analytics");
load();

async function load() {
  ui.showStatus("正在读取视频完整数据…");
  try {
    const [archive, detail] = await Promise.all([
      ui.fetchDashboard({ account: state.account, video: state.video, days: "all" }),
      fetch(`/api/official-analytics/video-detail?account=${encodeURIComponent(state.account)}&video=${encodeURIComponent(state.video)}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "读取视频详情失败");
          return payload;
        }),
    ]);
    state.data = archive;
    state.detail = detail;
    render();
    ui.hideStatus();
  } catch (error) {
    ui.showStatus(error.message || "读取失败");
  }
}
function value(item, ...keys) { return ui.pick(item, ...keys) ?? ui.pick(ui.parseObject(item.analytics), ...keys); }
function render() {
  const archived = (state.data?.videos || []).find((entry) => String(entry.id) === state.video);
  const live = state.detail?.video && typeof state.detail.video === "object" ? state.detail.video : {};
  const item = archived ? { ...archived, ...live, analytics: { ...ui.parseObject(archived.analytics), ...ui.parseObject(live.analytics) } } : live;
  ui.$("#backVideos").href = `/official-account-videos?account=${encodeURIComponent(state.account)}`;
  if (!item || !Object.keys(item).length) { ui.showStatus("未找到该视频归档"); return; }
  const title = item.title || item.caption || "未命名视频";
  const thumb = value(item, "thumbnailUrl", "thumbnail_url", "coverImageUrl", "cover_image_url");
  const share = value(item, "shareUrl", "share_url", "embedUrl", "embed_url");
  ui.$("#videoProfile").innerHTML = `${thumb ? `<img class="video-detail-cover" src="${ui.escapeHtml(thumb)}" alt="" referrerpolicy="no-referrer"/>` : ""}<div><p>VIDEO DATA</p><h2>${ui.escapeHtml(title)}</h2><small>视频 ID：${ui.escapeHtml(item.id)} · 发布时间 ${ui.videoDateTime(item)}</small></div>`;
  if (share) { ui.$("#openVideo").href = share; ui.$("#openVideo").classList.remove("is-hidden"); }
  ui.renderDistribution(ui.$("#sourceDistribution"), value(item, "impressionSources", "impression_sources", "trafficSources", "traffic_sources"), "当前授权暂未返回流量来源", { trafficSources: true });
  ui.renderDistribution(ui.$("#videoCountryDistribution"), value(item, "audienceCountry", "audience_country", "audience_countries"), "当前授权暂未返回视频受众国家/地区");
  renderComments(item, state.detail?.comments);
  ui.drawRetention(ui.$("#retentionChart"), value(item, "retention", "videoViewRetention", "video_view_retention"));
}
function renderComments(item, detailComments) {
  const raw = Array.isArray(detailComments) ? detailComments : value(item, "commentList", "comment_list", "videoComments", "video_comments", "commentDetails", "comment_details", "commentsData", "comments_data");
  const parsed = typeof raw === "string" ? ui.parseObject(raw) : raw;
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.comments) ? parsed.comments : Array.isArray(parsed?.list) ? parsed.list : [];
  const container = ui.$("#videoComments");
  if (!rows.length) { container.innerHTML = `<div class="empty compact-empty">${Number(item.comments) > 0 ? `归档仅返回评论总数 ${ui.format(item.comments)}，暂未返回评论明细` : "当前视频暂无已归档评论"}</div>`; return; }
  container.innerHTML = `<div class="comment-list">${rows.map((comment) => {
    const authorData = ui.parseObject(comment.author);
    const author = ui.pick(comment, "username", "displayName", "display_name", "authorName", "author_name") || ui.pick(authorData, "username", "displayName", "display_name") || "TikTok 用户";
    const text = ui.pick(comment, "text", "comment", "content") || "";
    const likes = ui.pick(comment, "likes", "likeCount", "like_count");
    const replies = ui.pick(comment, "replies", "replyCount", "reply_count");
    const created = ui.pick(comment, "createTime", "create_time", "createdAt", "created_at");
    return `<article class="comment-row"><div><strong>${ui.escapeHtml(author)}</strong>${created ? `<time>${ui.dateTime(created)}</time>` : ""}</div><p>${ui.escapeHtml(text)}</p><small>点赞 ${ui.format(likes)} · 回复 ${ui.format(replies)}</small></article>`;
  }).join("")}</div>`;
}
