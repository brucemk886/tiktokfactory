const ui = window.OfficialAnalytics;
const params = new URLSearchParams(location.search);
const state = { account: params.get("account") || "", video: params.get("video") || "", data: null, detail: null };
if (!state.account || !state.video) location.replace(ui.listHref());
load();

async function load() {
  setBackLink();
  ui.showStatus("正在读取视频完整数据…");
  try {
    const [archive, detail] = await Promise.allSettled([
      ui.fetchDashboard({ account: state.account, video: state.video, days: "all" }),
      fetch(ui.withModule("/api/official-analytics/video-detail?account=" + encodeURIComponent(state.account) + "&video=" + encodeURIComponent(state.video)), { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "读取视频详情失败");
          return payload;
        }),
    ]);
    state.data = archive.status === "fulfilled" ? archive.value : null;
    state.detail = detail.status === "fulfilled" ? detail.value : null;
    const archived = (state.data?.videos || []).find((entry) => String(entry.id) === state.video);
    if (!archived && !state.detail?.video) {
      throw new Error(detail.reason?.message || archive.reason?.message || "未找到该视频归档");
    }
    render();
    ui.hideStatus();
    ui.$("#detailNotice").textContent = detail.status === "rejected"
      ? "完整数据暂时读取失败，当前展示已归档数据。暂缺指标会在同步后补充。"
      : "展示官方接口已返回的数据；暂无数据表示该字段尚未同步或未获授权。";
  } catch (error) {
    ui.showStatus(error.message || "读取失败");
    ui.$("#detailNotice").textContent = error.message || "读取失败，请稍后重试。";
  }
}
function value(item, ...keys) { return ui.pick(item, ...keys) ?? ui.pick(ui.parseObject(item.analytics), ...keys); }
function render() {
  const archived = (state.data?.videos || []).find((entry) => String(entry.id) === state.video);
  const live = state.detail?.video && typeof state.detail.video === "object" ? state.detail.video : {};
  const item = mergeVideoDetail(archived, live);
  renderVideoMetrics(item);
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

function setBackLink() {
  const fallback = ui.withModule("/official-account-videos?account=" + encodeURIComponent(state.account));
  const link = ui.$("#backVideos");
  link.href = fallback;
  const allowed = {
    "/novel-ops-report": "novel-promotion", "/mid-video-ops-report": "mid-video",
    "/psychology-ops-report": "psychology", "/psychology-effects": "psychology",
  };
  try {
    const back = new URL(params.get("returnTo") || "", location.origin);
    if (back.origin === location.origin && allowed[back.pathname] === ui.currentModule()) {
      link.href = back.pathname + back.search;
      link.textContent = "返回数据概览";
    }
  } catch {}
}
function mergeVideoDetail(archived = {}, live = {}) {
  const present = (object) => Object.fromEntries(Object.entries(object || {}).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  return { ...present(archived), ...present(live), analytics: {
    ...present(ui.parseObject(archived.analytics)), ...present(ui.parseObject(live.analytics)),
  } };
}
function renderVideoMetrics(item) {
  const metric = (keys, format) => {
    const raw = value(item, ...keys);
    return raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))
      ? "暂无数据" : format(Number(raw));
  };
  const rows = [
    ["播放量", metric(["views", "viewCount", "view_count", "playCount"], ui.format)],
    ["完播率", metric(["fullWatchRate", "full_video_watched_rate", "fullVideoWatchedRate"], ui.percent)],
    ["平均观看时长", metric(["averageTimeWatched", "average_time_watched"], ui.duration)],
    ["总观看时长", metric(["totalTimeWatched", "total_time_watched"], ui.duration)],
    ["视频时长", metric(["duration", "videoDuration", "video_duration"], ui.duration)],
    ["触达人数", metric(["reach"], ui.format)],
    ["点赞", metric(["likes", "like_count", "diggCount"], ui.format)],
    ["评论", metric(["comments", "comment_count", "commentCount"], ui.format)],
    ["分享", metric(["shares", "share_count", "shareCount"], ui.format)],
  ];
  ui.$("#videoMetrics").innerHTML = rows.map(([label, number]) =>
    '<div class="metric"><span>' + label + '</span><strong>' + ui.escapeHtml(number) + '</strong></div>').join("");
}
