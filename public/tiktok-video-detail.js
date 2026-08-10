const state = {
  accounts: [],
  videos: [],
  selectedSchema: "",
  selectedVideoId: "",
  loading: false
};

const elements = {
  accountSelect: document.querySelector("#accountSelect"),
  videoSearch: document.querySelector("#videoSearch"),
  searchButton: document.querySelector("#searchButton"),
  refreshButton: document.querySelector("#refreshButton"),
  queryStatus: document.querySelector("#queryStatus"),
  videoCount: document.querySelector("#videoCount"),
  videoList: document.querySelector("#videoList"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent")
};

await initialize();

async function initialize() {
  bindEvents();
  bindRetentionHover();
  await loadAccounts();
}

function bindEvents() {
  elements.accountSelect.addEventListener("change", async () => {
    state.selectedSchema = elements.accountSelect.value;
    state.selectedVideoId = "";
    elements.videoSearch.value = "";
    showEmptyDetail();
    await loadVideos();
  });
  elements.searchButton.addEventListener("click", () => loadVideos({ openExact: true }));
  elements.refreshButton.addEventListener("click", loadAccounts);
  elements.videoSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadVideos({ openExact: true });
  });
}

async function loadAccounts() {
  setLoading(true, "正在读取授权账号与同步 Schema...");
  try {
    const result = await fetchJson("/api/private-tiktok/accounts");
    state.accounts = Array.isArray(result.accounts) ? result.accounts : [];
    if (!state.accounts.length) {
      elements.accountSelect.innerHTML = '<option value="">没有可用同步账号</option>';
      state.selectedSchema = "";
      renderVideoList();
      setStatus("目标数据库中还没有可用的 TikTok Organic 账号。", true);
      return;
    }
    const previous = state.selectedSchema;
    elements.accountSelect.innerHTML = state.accounts.map((account) => {
      const label = `${account.label || account.schema} · ${formatNumber(account.syncedVideoCount)} 条视频`;
      return `<option value="${escapeHtml(account.schema)}">${escapeHtml(label)}</option>`;
    }).join("");
    state.selectedSchema = state.accounts.some((item) => item.schema === previous) ? previous : state.accounts[0].schema;
    elements.accountSelect.value = state.selectedSchema;
    await loadVideos();
  } catch (error) {
    setStatus(error.message || "读取授权账号失败。", true);
  } finally {
    setLoading(false);
  }
}

async function loadVideos({ openExact = false } = {}) {
  if (!state.selectedSchema) return;
  setLoading(true, "正在读取该账号的同步视频...");
  try {
    const query = elements.videoSearch.value.trim();
    const params = new URLSearchParams({ schema: state.selectedSchema, query, limit: "60" });
    const result = await fetchJson(`/api/private-tiktok/videos?${params}`);
    state.videos = Array.isArray(result.videos) ? result.videos : [];
    renderVideoList();
    setStatus(`已读取 ${state.videos.length} 条视频${query ? `，筛选条件：${query}` : ""}。`);
    if (openExact && /^\d{5,30}$/.test(query)) {
      await loadVideoDetail(query);
    }
  } catch (error) {
    state.videos = [];
    renderVideoList();
    setStatus(error.message || "读取视频列表失败。", true);
  } finally {
    setLoading(false);
  }
}

function renderVideoList() {
  elements.videoCount.textContent = `${state.videos.length} 条`;
  if (!state.videos.length) {
    elements.videoList.innerHTML = '<div class="empty-list">没有符合条件的视频。</div>';
    return;
  }
  elements.videoList.innerHTML = state.videos.map((video) => `
    <button class="video-list-item${video.id === state.selectedVideoId ? " is-active" : ""}" type="button" data-video-id="${escapeHtml(video.id)}">
      <img src="${escapeHtml(video.thumbnailUrl)}" alt="" loading="lazy" />
      <span class="video-list-copy">
        <strong>${escapeHtml(video.caption || "无标题视频")}</strong>
        <span>${formatNumber(video.views)} 播放 · ${formatPercent(video.fullWatchRate)} 完播</span>
        <small>${escapeHtml(video.id)} · ${formatDate(video.createdAt)}</small>
      </span>
    </button>
  `).join("");
  elements.videoList.querySelectorAll("[data-video-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.videoId;
      elements.videoSearch.value = id;
      loadVideoDetail(id);
    });
  });
}

async function loadVideoDetail(videoId) {
  if (!state.selectedSchema || !videoId) return;
  setLoading(true, `正在读取视频 ${videoId} 的完整指标...`);
  try {
    const params = new URLSearchParams({ schema: state.selectedSchema });
    const result = await fetchJson(`/api/private-tiktok/videos/${encodeURIComponent(videoId)}?${params}`);
    state.selectedVideoId = videoId;
    renderVideoList();
    renderVideoDetail(result);
    setStatus(`视频 ${videoId} 已读取，可与 TikTok Studio 后台核对。`);
  } catch (error) {
    showEmptyDetail(error.message || "读取单条视频失败。");
    setStatus(error.message || "读取单条视频失败。", true);
  } finally {
    setLoading(false);
  }
}

function renderVideoDetail(result) {
  const video = result.video || {};
  const profile = result.profile || {};
  elements.detailEmpty.hidden = true;
  elements.detailContent.hidden = false;
  setText("#profileName", profile.username ? `@${profile.username}` : profile.displayName || result.schema || "-");
  setText("#videoCaption", video.caption || "无标题视频");
  setText("#videoId", video.id || "-");
  setText("#createdAt", formatDateTime(video.createdAt));
  setText("#syncedAt", formatDateTime(video.syncedAt));
  setText("#schemaName", result.schema || "-");
  const thumbnail = document.querySelector("#videoThumbnail");
  thumbnail.src = video.thumbnailUrl || "";
  thumbnail.hidden = !video.thumbnailUrl;
  const link = document.querySelector("#videoLink");
  link.href = video.shareUrl || video.embedUrl || "#";
  link.hidden = !(video.shareUrl || video.embedUrl);

  setText("#metricViews", formatNumber(video.views));
  setText("#metricReach", formatNumber(video.reach));
  setText("#metricAverageWatch", formatSeconds(video.averageTimeWatched));
  setText("#metricDuration", formatSeconds(video.duration));
  setText("#metricFullWatch", formatPercent(video.fullWatchRate));
  setText("#metricLikes", formatNumber(video.likes));
  setText("#metricComments", formatNumber(video.comments));
  setText("#metricShares", formatNumber(video.shares));
  setText("#metricFavorites", formatNumber(video.favorites));
  setText("#metricFollowers", formatNumber(video.newFollowers));

  const retention = sortTimeline(video.retention);
  const engagementLikes = sortTimeline(video.engagementLikes);
  setText("#retentionRows", `${retention.length} 个时间点`);
  setText("#likeRows", `${engagementLikes.length} 个时间点`);
  requestAnimationFrame(() => {
    drawLineChart(document.querySelector("#retentionChart"), retention, { color: "#cafa42", fill: "rgba(202,250,66,.10)" });
    drawLineChart(document.querySelector("#likeChart"), engagementLikes, { color: "#64d6d8", fill: "rgba(100,214,216,.10)" });
  });
  renderCheckpoints(retention, Number(video.duration) || 0);
  renderBars("#sourceBreakdown", video.impressionSources, "impressionSource", 8);
  renderBars("#genderBreakdown", video.audienceGender, "gender", 8);
  renderBars("#typeBreakdown", video.audienceType, "type", 8);
  renderBars("#countryBreakdown", video.audienceCountry, "country", 10);
  renderBars("#cityBreakdown", video.audienceCity, "cityName", 10);
  renderComments(result.comments || []);
}

function renderCheckpoints(points, duration) {
  const targetSeconds = [0, 1, 3, 5, 10, Math.max(0, Math.round(duration / 2)), Math.max(0, Math.round(duration))];
  const unique = [...new Set(targetSeconds)].sort((a, b) => a - b);
  document.querySelector("#retentionCheckpoints").innerHTML = unique.map((second) => {
    const point = nearestPoint(points, second);
    return `<div><span>${second}s</span><strong>${point ? formatPercent(point.percentage) : "-"}</strong></div>`;
  }).join("");
}

function renderBars(selector, items, labelKey, limit) {
  const container = document.querySelector(selector);
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => ({ label: String(item[labelKey] || "未知"), value: percentValue(item.percentage) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  if (!rows.length) {
    container.innerHTML = '<div class="bar-empty">该视频暂未同步此项数据。</div>';
    return;
  }
  container.innerHTML = rows.map((row) => `
    <div class="bar-item">
      <div class="bar-item-head"><span>${escapeHtml(row.label)}</span><strong>${row.value.toFixed(1)}%</strong></div>
      <div class="bar-track"><i style="width:${Math.max(0, Math.min(100, row.value))}%"></i></div>
    </div>
  `).join("");
}

function renderComments(comments) {
  setText("#commentCount", `${comments.length} 条`);
  const tbody = document.querySelector("#commentRows");
  if (!comments.length) {
    tbody.innerHTML = '<tr><td class="no-comments" colspan="5">该视频暂未同步评论。</td></tr>';
    return;
  }
  tbody.innerHTML = comments.map((comment) => `
    <tr>
      <td class="comment-user"><strong>${escapeHtml(comment.displayName || comment.username || "匿名用户")}</strong><small>${escapeHtml(comment.uniqueIdentifier || comment.username || "")}</small></td>
      <td>${escapeHtml(comment.text || "")}</td>
      <td>${formatNumber(comment.likes)}</td>
      <td>${formatNumber(comment.replies)}</td>
      <td>${formatDateTime(comment.createdAt)}</td>
    </tr>
  `).join("");
}

function drawLineChart(canvas, points, palette) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(520, Math.round(rect.width));
  const height = Math.max(160, Math.round(rect.height));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const pad = { left: 44, right: 18, top: 18, bottom: 28 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  context.font = '10px Inter, "Microsoft YaHei", sans-serif';
  context.lineWidth = 1;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let value = 0; value <= 100; value += 25) {
    const y = pad.top + chartHeight - (value / 100) * chartHeight;
    context.strokeStyle = "#252c32";
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
    context.fillStyle = "#69737d";
    context.fillText(`${value}%`, pad.left - 8, y);
  }
  if (!points.length) {
    canvas.__lineChartMeta = null;
    context.fillStyle = "#7f8993";
    context.textAlign = "center";
    context.fillText("该视频暂未同步趋势数据", pad.left + chartWidth / 2, pad.top + chartHeight / 2);
    return;
  }
  const maxSecond = Math.max(1, ...points.map((item) => Number(item.second) || 0));
  const coordinates = points.map((item) => ({
    item,
    x: pad.left + ((Number(item.second) || 0) / maxSecond) * chartWidth,
    y: pad.top + chartHeight - (percentValue(item.percentage) / 100) * chartHeight
  }));
  canvas.__lineChartMeta = { width, height, pad, coordinates };
  context.beginPath();
  context.moveTo(coordinates[0].x, pad.top + chartHeight);
  coordinates.forEach((point) => context.lineTo(point.x, point.y));
  context.lineTo(coordinates.at(-1).x, pad.top + chartHeight);
  context.closePath();
  context.fillStyle = palette.fill;
  context.fill();
  context.beginPath();
  coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.strokeStyle = palette.color;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#69737d";
  context.textAlign = "center";
  context.textBaseline = "top";
  const tickCount = 5;
  for (let index = 0; index <= tickCount; index += 1) {
    const second = Math.round((maxSecond / tickCount) * index);
    const x = pad.left + (index / tickCount) * chartWidth;
    context.fillText(`${second}s`, x, pad.top + chartHeight + 9);
  }
}

function bindRetentionHover() {
  const canvas = document.querySelector("#retentionChart");
  const hover = document.querySelector("#retentionHover");
  const secondLabel = document.querySelector("#retentionHoverSecond");
  const valueLabel = document.querySelector("#retentionHoverValue");
  if (!canvas || !hover || !secondLabel || !valueLabel) return;

  const hide = () => { hover.hidden = true; };
  canvas.addEventListener("pointerleave", hide);
  canvas.addEventListener("pointermove", (event) => {
    const meta = canvas.__lineChartMeta;
    if (!meta?.coordinates?.length) {
      hide();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / meta.width;
    const scaleY = rect.height / meta.height;
    const localX = event.clientX - rect.left;
    const plotLeft = meta.pad.left * scaleX;
    const plotRight = (meta.width - meta.pad.right) * scaleX;
    if (localX < plotLeft || localX > plotRight) {
      hide();
      return;
    }

    const nearest = meta.coordinates.reduce((best, point) => {
      const distance = Math.abs(point.x * scaleX - localX);
      return !best || distance < best.distance ? { point, distance } : best;
    }, null)?.point;
    if (!nearest) {
      hide();
      return;
    }

    const x = nearest.x * scaleX;
    const y = nearest.y * scaleY;
    const tooltip = hover.querySelector(".chart-tooltip");
    const guide = hover.querySelector(".chart-hover-guide");
    const dot = hover.querySelector(".chart-hover-dot");
    guide.style.left = `${x}px`;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    tooltip.style.left = `${Math.max(70, Math.min(rect.width - 70, x))}px`;
    tooltip.style.top = `${Math.max(58, y)}px`;
    secondLabel.textContent = `第 ${formatTimelineSecond(nearest.item.second)} 秒`;
    valueLabel.textContent = formatPercent(nearest.item.percentage);
    hover.hidden = false;
  });
}

function formatTimelineSecond(value) {
  const second = Number(value);
  if (!Number.isFinite(second)) return "0";
  return Number.isInteger(second) ? String(second) : second.toFixed(1).replace(/\.0$/, "");
}

function sortTimeline(items) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => Number(a.second) - Number(b.second));
}

function nearestPoint(points, second) {
  if (!points.length) return null;
  return points.reduce((best, item) => Math.abs(Number(item.second) - second) < Math.abs(Number(best.second) - second) ? item : best, points[0]);
}

function showEmptyDetail(message = "选择一条视频开始核对") {
  elements.detailContent.hidden = true;
  elements.detailEmpty.hidden = false;
  elements.detailEmpty.querySelector("strong").textContent = message;
}

function setLoading(loading, message = "") {
  state.loading = loading;
  elements.searchButton.disabled = loading;
  elements.refreshButton.disabled = loading;
  elements.accountSelect.disabled = loading;
  if (message) setStatus(message);
}

function setStatus(message, error = false) {
  elements.queryStatus.textContent = message;
  elements.queryStatus.classList.toggle("is-error", error);
}

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value ?? "-");
}

function percentValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number > 1 ? number : number * 100;
}

function formatPercent(value) {
  return `${percentValue(value).toFixed(1)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatSeconds(value) {
  const seconds = Number(value) || 0;
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}

function formatDate(value) {
  const date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatDateTime(value) {
  const date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "-";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
