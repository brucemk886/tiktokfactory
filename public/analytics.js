const elements = Object.fromEntries([
  "syncState", "periodFilter", "groupFilter", "accountFilter", "sortFilter", "analyticsNav", "pageTitle", "pageDescription",
  "refreshBtn", "manualFetchProfile", "manualFetchGroupOptions", "manualFetchGroupSummary", "manualFetchBtn", "videoCount", "matchedCount", "totalViews", "totalLikes", "commentShareCount", "engagementRate",
  "pageStatus",
  "accountCountBadge", "accountRows", "accountPagination", "nextRunText", "videoCountBadge", "videoRows", "videoPagination",
  "audioCountBadge", "audioRows", "audioDetailEmpty", "audioDetailPanel", "audioDetailTitle", "audioDetailMeta", "audioPlayer", "audioVideoRows",
  "audioOverview", "audioOverviewTotal", "audioOverviewVideos", "audioOverviewStrong", "audioOverviewWatch", "audioOverviewWeak",
  "audioStrongBar", "audioWatchBar", "audioWeakBar", "audioBestList", "audioRiskList",
  "accountAnalysisCountBadge", "accountOverview", "accountOverviewTotal", "accountOverviewVideos", "accountOverviewStrong", "accountOverviewWatch", "accountOverviewWeak",
  "accountStrongBar", "accountWatchBar", "accountWeakBar", "accountToneFilter", "accountRankRows", "accountDetailEmpty", "accountDetailPanel", "accountDetailTitle", "accountDetailMeta", "accountVideoRows",
  "todayVideos", "todayViews", "todayAverage", "todayEngagement", "yesterdayVideos", "yesterdayViews", "yesterdayAverage", "yesterdayEngagement",
  "sevenDaysVideos", "sevenDaysViews", "sevenDaysAverage", "sevenDaysEngagement", "selectedPeriodLabel",
  "reuseModal", "reuseDialogTitle", "reuseDialogMeta", "reuseDialogBody", "closeReuseBtn"
].map((id) => [id, document.querySelector(`#${id}`)]));

let currentAudioName = "";
let currentAccountName = "";
let accountAnalyticsItems = [];
let activeProfileGroups = [];
let profileGroupsLoaded = false;
// Never send the HTML placeholder or a stale localStorage profile to the API.
// This is especially important for members restricted to one GeeLark profile.
let verifiedAnalyticsProfileId = "";
const PAGE_SIZE = 10;
let accountPage = 1;
let videoPage = 1;
const requestedView = new URLSearchParams(window.location.search).get("view") || "dashboard";
const activeView = ["dashboard", "account", "video"].includes(requestedView) ? requestedView : "dashboard";
const isAudioView = false;
const isAccountView = activeView === "account";
const isVideoView = activeView === "video";

document.body.classList.toggle("audio-only-view", isAudioView);
document.body.classList.toggle("account-only-view", isAccountView);
document.body.classList.toggle("video-only-view", isVideoView);
elements.analyticsNav?.classList.toggle("is-active", !isAudioView && !isAccountView && !isVideoView);
if (isAccountView) {
  elements.pageTitle.textContent = "账号表现";
  elements.pageDescription.textContent = "按账号汇总播放稳定性、爆款率与低播风险，快速识别值得放量和需要淘汰的账号。";
  elements.periodFilter.value = "10d";
} else if (isVideoView) {
  elements.pageTitle.textContent = "视频表现";
  elements.pageDescription.textContent = "只展示你被授权账号组内的视频数据，按播放、互动和发布时间筛选。";
}

elements.refreshBtn.addEventListener("click", loadDashboard);
elements.manualFetchBtn.addEventListener("click", fetchSelectedGroup);
elements.manualFetchProfile.addEventListener("change", async () => {
  verifiedAnalyticsProfileId = elements.manualFetchProfile.value || "";
  localStorage.setItem("local-factory.analytics.geelark-profile", elements.manualFetchProfile.value || "");
  await loadManualFetchGroups(elements.manualFetchProfile.value);
  reloadFromFirstPage();
});
elements.manualFetchGroupOptions.addEventListener("change", updateManualFetchSummary);
elements.periodFilter.addEventListener("change", reloadFromFirstPage);
elements.groupFilter.addEventListener("change", reloadFromFirstPage);
elements.sortFilter.addEventListener("change", reloadFromFirstPage);
elements.accountFilter.addEventListener("input", debounce(reloadFromFirstPage, 250));
elements.videoRows.addEventListener("click", handleReuseAction);

function handleReuseAction(event) {
  const button = event.target.closest("[data-reuse-video]");
  if (button) openReuseDetail(button.dataset.reuseVideo);
}
elements.audioRows.addEventListener("click", handleAudioAction);
elements.audioOverview.addEventListener("click", handleAudioAction);
elements.accountRankRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-account-detail]");
  if (button) openAccountDetail(button.dataset.accountDetail);
});
elements.accountToneFilter.addEventListener("change", () => renderAccountAnalytics(accountAnalyticsItems));

function handleAudioAction(event) {
  const detailButton = event.target.closest("[data-audio-detail]");
  const playButton = event.target.closest("[data-audio-play]");
  const audioName = detailButton?.dataset.audioDetail || playButton?.dataset.audioPlay || "";
  if (audioName) openAudioDetail(audioName, { autoPlay: Boolean(playButton) });
}
elements.closeReuseBtn.addEventListener("click", closeReuseDetail);
elements.reuseModal.addEventListener("click", (event) => {
  if (event.target === elements.reuseModal) closeReuseDetail();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.reuseModal.hidden) closeReuseDetail();
});

await loadManualFetchProfiles();
await loadDashboard();

async function loadManualFetchProfiles() {
  try {
    const data = await requestJson("/api/tiktok-analytics/settings");
    const profiles = data.profiles || [];
    elements.manualFetchProfile.innerHTML = `<option value="">选择 GeeLark 账号</option>${profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join("")}`;
    const savedProfileId = localStorage.getItem("local-factory.analytics.geelark-profile") || "";
    const defaultProfileId = profiles.some((profile) => profile.id === savedProfileId)
      ? savedProfileId
      : data.defaultProfileId || data.activeProfileIds?.[0] || profiles.find((profile) => profile.id === "default")?.id || profiles[0]?.id || "";
    elements.manualFetchProfile.value = defaultProfileId;
    verifiedAnalyticsProfileId = defaultProfileId;
    if (defaultProfileId) localStorage.setItem("local-factory.analytics.geelark-profile", defaultProfileId);
    await loadManualFetchGroups(defaultProfileId);
  } catch {
    elements.manualFetchGroupOptions.innerHTML = `<span>暂时无法读取 GeeLark 账号。</span>`;
  }
}

async function loadManualFetchGroups(profileId) {
  activeProfileGroups = [];
  profileGroupsLoaded = false;
  elements.manualFetchGroupOptions.innerHTML = profileId ? `<span>正在读取账号组...</span>` : `<span>请先选择 GeeLark 账号。</span>`;
  elements.manualFetchGroupSummary.textContent = "勾选账号组";
  if (!profileId) {
    updateGroupOptions([]);
    return;
  }
  try {
    const data = await requestJson(`/api/tiktok-analytics/settings?profileId=${encodeURIComponent(profileId)}&t=${Date.now()}`);
    const groupCounts = data.groupCounts || {};
    const groups = (data.availableGroups || []).map((name) => ({ name, accountCount: Number(groupCounts[name] || 0) }));
    activeProfileGroups = groups.map((group) => String(group.name || "").trim()).filter(Boolean);
    profileGroupsLoaded = true;
    updateGroupOptions(activeProfileGroups);
    elements.manualFetchGroupOptions.innerHTML = groups.length ? groups.map((group) => `
      <label><input type="checkbox" value="${escapeHtml(group.name)}" /><span>${escapeHtml(group.name)}</span><small>${Number(group.accountCount || 0)} 个账号</small></label>
    `).join("") : `<span>该 GeeLark 账号没有可抓取分组。</span>`;
  } catch (error) {
    profileGroupsLoaded = true;
    updateGroupOptions([]);
    elements.manualFetchGroupOptions.innerHTML = `<span>${escapeHtml(error.message || "读取账号组失败。")} </span>`;
  }
}

function selectedManualFetchGroups() {
  return Array.from(elements.manualFetchGroupOptions.querySelectorAll("input:checked")).map((input) => input.value);
}

function updateManualFetchSummary() {
  const count = selectedManualFetchGroups().length;
  elements.manualFetchGroupSummary.textContent = count ? `已选 ${count} 个账号组` : "勾选账号组";
}

async function fetchSelectedGroup() {
  const profileId = elements.manualFetchProfile.value;
  const groupNames = selectedManualFetchGroups();
  if (!profileId) return setStatus("请先选择 GeeLark 账号。", "error");
  if (!groupNames.length) return setStatus("请至少勾选一个要手动抓取的账号组。", "error");
  elements.manualFetchBtn.disabled = true;
  elements.manualFetchBtn.textContent = "提交中...";
  try {
    const result = await requestJson("/api/tiktok-analytics/fetch-group", { method: "POST", body: JSON.stringify({ profileId, groupNames }) });
    setStatus(`已开始抓取 ${groupNames.length} 个账号组的 ${Number(result.accountCount || 0)} 个账号，页面会自动更新。`, "success");
    await loadDashboard();
  } catch (error) {
    setStatus(error.message || "手动抓取提交失败。", "error");
  } finally {
    elements.manualFetchBtn.disabled = false;
    elements.manualFetchBtn.textContent = "手动抓取";
  }
}

async function loadDashboard() {
  const params = new URLSearchParams({
    period: elements.periodFilter.value,
    group: elements.groupFilter.value,
    account: elements.accountFilter.value.trim(),
    sort: elements.sortFilter.value,
    t: Date.now()
  });
  if (verifiedAnalyticsProfileId) params.set("profileId", verifiedAnalyticsProfileId);
  try {
    const data = await requestJson(`/api/tiktok-analytics?${params}`);
    renderDashboard(data);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function reloadFromFirstPage() {
  accountPage = 1;
  videoPage = 1;
  loadDashboard();
}

function renderDashboard(data) {
  const summary = data.summary || {};
  const status = data.status || {};
  elements.videoCount.textContent = formatNumber(summary.videoCount);
  elements.matchedCount.textContent = `${formatNumber(summary.matchedCount)} 条已匹配本地记录`;
  elements.totalViews.textContent = formatNumber(summary.views);
  elements.totalLikes.textContent = formatNumber(summary.likes);
  elements.commentShareCount.textContent = formatNumber(Number(summary.comments || 0) + Number(summary.shares || 0));
  elements.engagementRate.textContent = `${Number(summary.engagement || 0).toFixed(2)}%`;
  renderPeriods(data.periods || {}, elements.periodFilter.value);
  updateGroupOptions(profileGroupsLoaded ? activeProfileGroups : (data.filters?.groups || []));
  renderAccounts(data.accounts || []);
  renderAccountAnalytics(data.accounts || []);
  renderAudioRankings(data.audioRankings || []);
  renderVideos(data.videos || []);
  renderQuota(status);

  const run = status.lastRun;
  if (status.running) {
    const completed = run?.completed || 0;
    const total = run?.total || 0;
    elements.syncState.textContent = `抓取中 ${completed}/${total}`;
    setStatus(`正在抓取账号数据：${completed}/${total}，失败 ${run?.failed || 0} 个。`);
  } else {
    elements.syncState.textContent = run?.finishedAt ? `上次 ${formatDateTime(run.finishedAt)}` : "尚未抓取";
    if (run?.finishedAt) setStatus(`上次抓取完成：${run.completed || 0}/${run.total || 0} 个账号，失败 ${run.failed || 0} 个。`, run.failed ? "warning" : "success");
    else setStatus(`已读取 ${summary.videoCount || 0} 条本地视频数据。`, "success");
  }
}

function renderPeriods(periods, selectedPeriod) {
  const selectedLabel = periodLabel(selectedPeriod);
  const values = [
    ["today", periods.today || {}],
    ["yesterday", periods.yesterday || {}],
    ["sevenDays", periods.selected || periods.tenDays || periods.sevenDays || {}]
  ];
  for (const [prefix, summary] of values) {
    elements[`${prefix}Videos`].textContent = `${formatNumber(summary.videoCount)} 条`;
    elements[`${prefix}Views`].textContent = formatNumber(summary.views);
    elements[`${prefix}Average`].textContent = formatNumber(summary.averageViews);
    elements[`${prefix}Engagement`].textContent = `${Number(summary.engagement || 0).toFixed(2)}%`;
  }
  elements.selectedPeriodLabel.textContent = `${selectedLabel}发布`;
  document.querySelectorAll("[data-period-card]").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.periodCard === elements.periodFilter.value);
    card.onclick = () => {
      elements.periodFilter.value = card.dataset.periodCard;
      reloadFromFirstPage();
    };
  });
}

function periodLabel(period) {
  if (period === "today") return "今日";
  if (period === "yesterday") return "昨日";
  if (period === "all") return "全部历史";
  const days = /^(\d+)d$/.exec(String(period || ""));
  return days ? `最近 ${days[1]} 日` : "最近 10 日";
}

function renderAccounts(accounts) {
  elements.accountCountBadge.textContent = `${accounts.length} 个`;
  const page = getPage(accounts, accountPage);
  accountPage = page.current;
  elements.accountRows.innerHTML = page.items.length ? page.items.map((item) => `
    <tr>
      <td><strong>@${escapeHtml(item.username)}</strong></td>
      <td>${formatNumber(item.videos)}</td>
      <td>${formatNumber(item.views)}</td>
      <td>${formatNumber(item.averageViews)}</td>
      <td>${Number(item.engagement || 0).toFixed(2)}%</td>
      <td>${escapeHtml(formatDateTime(item.lastFetchedAt))}</td>
    </tr>
  `).join("") : emptyRow(6, "暂无账号数据，请先抓取 Demo。");
  renderPagination(elements.accountPagination, page, (nextPage) => {
    accountPage = nextPage;
    renderAccounts(accounts);
  }, "账号");
}

function renderAccountAnalytics(accounts) {
  accountAnalyticsItems = [...accounts];
  const ranked = [...accounts].sort((a, b) => accountPerformanceScore(b) - accountPerformanceScore(a));
  const groups = { "audio-strong": [], "audio-watch": [], "audio-weak": [] };
  for (const item of ranked) groups[accountTone(item)].push(item);
  const selectedTone = elements.accountToneFilter.value;
  const visibleAccounts = selectedTone === "all" ? ranked : groups[selectedTone] || [];
  const totalVideos = ranked.reduce((sum, item) => sum + Number(item.videos || 0), 0);

  elements.accountAnalysisCountBadge.textContent = selectedTone === "all"
    ? `${ranked.length} 个`
    : `${visibleAccounts.length} / ${ranked.length} 个`;
  elements.accountOverviewTotal.textContent = formatNumber(ranked.length);
  elements.accountOverviewVideos.textContent = `${formatNumber(totalVideos)} 条发布视频`;
  elements.accountOverviewStrong.textContent = formatNumber(groups["audio-strong"].length);
  elements.accountOverviewWatch.textContent = formatNumber(groups["audio-watch"].length);
  elements.accountOverviewWeak.textContent = formatNumber(groups["audio-weak"].length);
  setDistributionWidth(elements.accountStrongBar, groups["audio-strong"].length, ranked.length);
  setDistributionWidth(elements.accountWatchBar, groups["audio-watch"].length, ranked.length);
  setDistributionWidth(elements.accountWeakBar, groups["audio-weak"].length, ranked.length);

  if (!visibleAccounts.length) {
    elements.accountRankRows.innerHTML = `<div class="audio-empty small">当前表现筛选下暂无账号。</div>`;
    resetAccountDetail();
    return;
  }

  elements.accountRankRows.innerHTML = visibleAccounts.map((item, index) => {
    const tone = accountTone(item);
    const active = currentAccountName === item.username ? " is-active" : "";
    const groupName = item.groups?.join("、") || "未匹配账号组";
    return `<article class="account-rank-item${active}">
      <div class="account-rank-main">
        <span>#${index + 1}</span>
        <strong>@${escapeHtml(item.username)}</strong>
        <small>${escapeHtml(groupName)} · ${formatNumber(item.videos)} 条视频</small>
      </div>
      <div class="account-rank-metrics">
        <div><span>均播</span><strong>${formatNumber(item.averageViews)}</strong></div>
        <div><span>中位</span><strong>${formatNumber(item.medianViews)}</strong></div>
        <div><span>最高</span><strong>${formatNumber(item.maxViews)}</strong></div>
      </div>
      <div class="account-rank-foot">
        <span class="${tone}">${accountToneLabel(tone)}</span>
        <small>低于100 ${Number(item.low100Rate || 0).toFixed(0)}%</small>
        <small>破500 ${Number(item.over500Rate || 0).toFixed(0)}%</small>
        <button type="button" data-account-detail="${escapeHtml(item.username)}">查看视频</button>
      </div>
    </article>`;
  }).join("");

  if (isAccountView && (!currentAccountName || !visibleAccounts.some((item) => item.username === currentAccountName))) {
    openAccountDetail(visibleAccounts[0].username);
  }
}

function accountPerformanceScore(item) {
  const sampleWeight = Math.min(1, Number(item.videos || 0) / 8);
  const playback = Number(item.averageViews || 0) * 0.45 + Number(item.medianViews || 0) * 0.4 + Number(item.maxViews || 0) * 0.15;
  const stability = Number(item.over500Rate || 0) * 8 - Number(item.low100Rate || 0) * 10;
  return (playback + stability) * (0.55 + sampleWeight * 0.45);
}

function accountTone(item) {
  if (Number(item.videos) >= 4 && Number(item.averageViews) >= 800 && Number(item.low100Rate) <= 20) return "audio-strong";
  if (Number(item.videos) >= 4 && (Number(item.averageViews) < 200 || Number(item.low100Rate) >= 50)) return "audio-weak";
  return "audio-watch";
}

function accountToneLabel(tone) {
  return tone === "audio-strong" ? "高表现" : tone === "audio-weak" ? "低表现" : "待观察";
}

async function openAccountDetail(username) {
  currentAccountName = username;
  elements.accountRankRows.querySelectorAll(".account-rank-item").forEach((item) => {
    const button = item.querySelector("[data-account-detail]");
    item.classList.toggle("is-active", button?.dataset.accountDetail === username);
  });
  elements.accountDetailEmpty.hidden = true;
  elements.accountDetailPanel.hidden = false;
  elements.accountDetailTitle.textContent = `@${username}`;
  elements.accountDetailMeta.textContent = "正在读取账号视频详情...";
  elements.accountVideoRows.innerHTML = emptyRow(7, "正在读取...");

  try {
    const params = new URLSearchParams({
      username,
      period: elements.periodFilter.value,
      group: elements.groupFilter.value,
      sort: "newest",
      t: Date.now()
    });
    const data = await requestJson(`/api/tiktok-analytics/account-details?${params}`);
    renderAccountDetail(data);
  } catch (error) {
    elements.accountDetailMeta.textContent = error.message;
    elements.accountVideoRows.innerHTML = emptyRow(7, "读取失败。");
  }
}

function renderAccountDetail(data) {
  const summary = data.summary || {};
  const videos = data.videos || [];
  elements.accountDetailTitle.textContent = `@${data.username || "-"}`;
  elements.accountDetailMeta.textContent = `${formatNumber(summary.videos || videos.length)} 条视频 · 总播放 ${formatNumber(summary.views)} · 均播 ${formatNumber(summary.averageViews)} · 中位 ${formatNumber(summary.medianViews)} · 最高 ${formatNumber(summary.maxViews)} · 低于100 ${Number(summary.low100Rate || 0).toFixed(0)}% · 破500 ${Number(summary.over500Rate || 0).toFixed(0)}%`;
  elements.accountVideoRows.innerHTML = videos.length ? videos.map((video) => {
    const engagement = video.views ? ((video.likes + video.comments + video.shares + video.bookmarks) / video.views) * 100 : 0;
    return `<tr>
      <td>${escapeHtml(formatUnixTime(video.createTime))}</td>
      <td class="number-cell">${formatNumber(video.views)}</td>
      <td>${formatNumber(video.likes)}</td>
      <td>${engagement.toFixed(2)}%</td>
      <td class="account-audio-cell" title="${escapeHtml(video.local?.audioName || "")}">${escapeHtml(shortAudioName(video.local?.audioName || "未匹配音频"))}</td>
      <td class="source-cell"><strong title="${escapeHtml(video.local?.fileName || "")}">${escapeHtml(video.local?.fileName || "未匹配")}</strong><small>${escapeHtml(video.local?.groupName || "")}</small></td>
      <td>${video.shareUrl ? `<a class="open-link" href="${escapeHtml(video.shareUrl)}" target="_blank" rel="noreferrer" title="打开 TikTok">↗</a>` : "-"}</td>
    </tr>`;
  }).join("") : emptyRow(7, "当前周期没有这个账号的视频。");
}

function resetAccountDetail() {
  currentAccountName = "";
  elements.accountDetailEmpty.hidden = false;
  elements.accountDetailPanel.hidden = true;
  elements.accountDetailTitle.textContent = "-";
  elements.accountDetailMeta.textContent = "-";
  elements.accountVideoRows.innerHTML = "";
}

function renderAudioRankings(rows) {
  elements.audioCountBadge.textContent = `${rows.length} 条`;
  renderAudioOverview(rows);
  if (!rows.length) {
    elements.audioRows.innerHTML = `<div class="audio-empty small">当前筛选范围暂无已匹配音频数据。</div>`;
    resetAudioDetail();
    return;
  }
  elements.audioRows.innerHTML = rows.map((item, index) => {
    const tone = audioTone(item);
    const active = currentAudioName === item.audioName ? " is-active" : "";
    return `<article class="audio-rank-item${active}">
      <div class="audio-rank-main">
        <span>#${index + 1}</span>
        <strong title="${escapeHtml(item.audioName)}">${escapeHtml(shortAudioName(item.audioName))}</strong>
        <small>${formatNumber(item.videos)} 条视频 · ${formatNumber(item.accounts)} 个账号 · 均播 ${formatNumber(item.averageViews)} · 中位 ${formatNumber(item.medianViews)}</small>
      </div>
      <div class="audio-rank-stats">
        <span class="${tone}">${audioToneLabel(tone)}</span>
        <small>低播 ${rateBadge(item.low100Rate, true)}</small>
        <small>破500 ${rateBadge(item.over500Rate)}</small>
      </div>
      <div class="audio-rank-actions">
        <button type="button" data-audio-detail="${escapeHtml(item.audioName)}">发布视频详情</button>
        <button type="button" data-audio-play="${escapeHtml(item.audioName)}">播放音频</button>
      </div>
    </article>`;
  }).join("");
  if (isAudioView && (!currentAudioName || !rows.some((item) => item.audioName === currentAudioName))) {
    openAudioDetail(rows[0].audioName, { autoPlay: false });
  }
}

function renderAudioOverview(rows) {
  const groups = { "audio-strong": [], "audio-watch": [], "audio-weak": [] };
  for (const item of rows) groups[audioTone(item)].push(item);
  const total = rows.length;
  const totalVideos = rows.reduce((sum, item) => sum + Number(item.videos || 0), 0);

  elements.audioOverviewTotal.textContent = formatNumber(total);
  elements.audioOverviewVideos.textContent = `${formatNumber(totalVideos)} 条发布视频`;
  elements.audioOverviewStrong.textContent = formatNumber(groups["audio-strong"].length);
  elements.audioOverviewWatch.textContent = formatNumber(groups["audio-watch"].length);
  elements.audioOverviewWeak.textContent = formatNumber(groups["audio-weak"].length);
  setDistributionWidth(elements.audioStrongBar, groups["audio-strong"].length, total);
  setDistributionWidth(elements.audioWatchBar, groups["audio-watch"].length, total);
  setDistributionWidth(elements.audioWeakBar, groups["audio-weak"].length, total);

  const sampled = rows.filter((item) => Number(item.videos) >= 2);
  const best = sampled.filter((item) => audioTone(item) !== "audio-weak").sort((a, b) => audioPerformanceScore(b) - audioPerformanceScore(a)).slice(0, 3);
  const risk = sampled.filter((item) => audioTone(item) !== "audio-strong").sort((a, b) => audioPerformanceScore(a) - audioPerformanceScore(b)).slice(0, 3);
  elements.audioBestList.innerHTML = renderAudioOverviewList(best, "暂无足够样本");
  elements.audioRiskList.innerHTML = renderAudioOverviewList(risk, "暂无高风险样本");
}

function renderAudioOverviewList(items, emptyText) {
  if (!items.length) return `<div class="overview-list-empty">${escapeHtml(emptyText)}</div>`;
  return items.map((item, index) => {
    const tone = audioTone(item);
    return `<button type="button" data-audio-detail="${escapeHtml(item.audioName)}">
      <span class="overview-rank">${index + 1}</span>
      <span class="overview-audio-name"><strong title="${escapeHtml(item.audioName)}">${escapeHtml(shortAudioName(item.audioName))}</strong><small>${formatNumber(item.videos)} 条 · 均播 ${formatNumber(item.averageViews)} · 低播 ${Number(item.low100Rate || 0).toFixed(0)}%</small></span>
      <b class="${tone}">${audioToneLabel(tone)}</b>
    </button>`;
  }).join("");
}

function audioPerformanceScore(item) {
  const sampleWeight = Math.min(1, Number(item.videos || 0) / 5);
  const playback = Number(item.averageViews || 0) * 0.6 + Number(item.medianViews || 0) * 0.4;
  const rateSignal = Number(item.over500Rate || 0) * 8 - Number(item.low100Rate || 0) * 10;
  return (playback + rateSignal) * (0.55 + sampleWeight * 0.45);
}

function setDistributionWidth(element, count, total) {
  element.style.width = total ? `${(count / total) * 100}%` : "0%";
  element.title = `${count} 条，占 ${total ? ((count / total) * 100).toFixed(0) : 0}%`;
}

async function openAudioDetail(audioName, { autoPlay = false } = {}) {
  currentAudioName = audioName;
  elements.audioRows.querySelectorAll(".audio-rank-item").forEach((item) => {
    const button = item.querySelector("[data-audio-detail]");
    item.classList.toggle("is-active", button?.dataset.audioDetail === audioName);
  });
  elements.audioDetailEmpty.hidden = true;
  elements.audioDetailPanel.hidden = false;
  elements.audioDetailTitle.textContent = shortAudioName(audioName);
  elements.audioDetailMeta.textContent = "正在读取发布视频详情...";
  elements.audioVideoRows.innerHTML = emptyRow(6, "正在读取...");
  elements.audioPlayer.pause();
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.hidden = true;

  try {
    const params = new URLSearchParams({
      audioName,
      period: elements.periodFilter.value,
      group: elements.groupFilter.value,
      account: elements.accountFilter.value.trim(),
      sort: "newest",
      t: Date.now()
    });
    const data = await requestJson(`/api/tiktok-analytics/audio-details?${params}`);
    renderAudioDetail(data);
    if (data.audioAvailable) {
      elements.audioPlayer.src = `/api/tiktok-analytics/audio-file?audioName=${encodeURIComponent(audioName)}&t=${Date.now()}`;
      elements.audioPlayer.hidden = false;
      if (autoPlay) {
        try { await elements.audioPlayer.play(); } catch {}
      }
    }
  } catch (error) {
    elements.audioDetailMeta.textContent = error.message;
    elements.audioVideoRows.innerHTML = emptyRow(6, "读取失败。");
  }
}

function renderAudioDetail(data) {
  const summary = data.summary || {};
  const videos = data.videos || [];
  elements.audioDetailTitle.textContent = shortAudioName(data.audioName || "");
  elements.audioDetailMeta.textContent = `${formatNumber(summary.videos || videos.length)} 条视频 · 均播 ${formatNumber(summary.averageViews)} · 中位 ${formatNumber(summary.medianViews)} · 最高 ${formatNumber(summary.maxViews)} · 低播 ${Number(summary.low100Rate || 0).toFixed(0)}%`;
  elements.audioVideoRows.innerHTML = videos.length ? videos.map((video) => {
    const engagement = video.views ? ((video.likes + video.comments + video.shares + video.bookmarks) / video.views) * 100 : 0;
    return `<tr>
      <td>${escapeHtml(formatUnixTime(video.createTime))}</td>
      <td><strong>@${escapeHtml(video.username)}</strong><small>${escapeHtml(video.local?.groupName || "-")}</small></td>
      <td class="number-cell">${formatNumber(video.views)}</td>
      <td>${engagement.toFixed(2)}%</td>
      <td class="source-cell"><strong>${escapeHtml(video.local?.fileName || "-")}</strong><small>${escapeHtml(video.local?.matchConfidence || "")}</small></td>
      <td>${video.shareUrl ? `<a class="open-link" href="${escapeHtml(video.shareUrl)}" target="_blank" rel="noreferrer" title="打开 TikTok">↗</a>` : "-"}</td>
    </tr>`;
  }).join("") : emptyRow(6, "这条音频在当前筛选范围没有视频。");
}

function resetAudioDetail() {
  currentAudioName = "";
  elements.audioDetailPanel.hidden = true;
  elements.audioDetailEmpty.hidden = false;
  elements.audioVideoRows.innerHTML = "";
  elements.audioPlayer.pause();
  elements.audioPlayer.removeAttribute("src");
}

function audioTone(item) {
  if (Number(item.videos) >= 5 && Number(item.low100Rate) <= 10 && Number(item.averageViews) >= 800) return "audio-strong";
  if (Number(item.videos) >= 4 && Number(item.low100Rate) >= 50) return "audio-weak";
  return "audio-watch";
}

function audioToneLabel(tone) {
  return ({ "audio-strong": "可放量", "audio-weak": "先停用", "audio-watch": "观察" })[tone] || "观察";
}

function rateBadge(value, reverse = false) {
  const rate = Math.max(0, Number(value) || 0);
  const level = reverse
    ? (rate >= 50 ? "bad" : rate >= 25 ? "mid" : "good")
    : (rate >= 50 ? "good" : rate >= 20 ? "mid" : "muted");
  return `<span class="rate-badge ${level}">${rate.toFixed(0)}%</span>`;
}

function shortAudioName(value) {
  const text = String(value || "");
  return text.replace(/\.[a-z0-9]+$/i, "").replace(/^\[music\]/i, "").slice(0, 72) || "未命名音频";
}

function renderVideos(videos) {
  elements.videoCountBadge.textContent = `${videos.length} 条`;
  const page = getPage(videos, videoPage);
  videoPage = page.current;
  elements.videoRows.innerHTML = page.items.length ? page.items.map((video) => {
    const engagement = video.views ? ((video.likes + video.comments + video.shares + video.bookmarks) / video.views) * 100 : 0;
    const source = video.local
      ? `<strong>${escapeHtml(video.local.groupName || "未分组")}</strong><small title="${escapeHtml(video.local.audioName)}">${escapeHtml(video.local.fileName || video.local.audioName || "已匹配")}</small><em class="match-${escapeHtml(video.local.matchConfidence || "medium")}">${matchLabel(video.local)}</em>`
      : `<span class="unmatched">没有本地发布记录</span>`;
    return `<tr>
      <td>${escapeHtml(formatUnixTime(video.createTime))}</td>
      <td class="video-copy"><strong>@${escapeHtml(video.username)}</strong></td>
      <td class="number-cell">${formatNumber(video.views)}</td>
      <td class="delta-cell">${video.viewsDelta ? `+${formatNumber(video.viewsDelta)}` : "-"}</td>
      <td>${formatNumber(video.likes)}</td><td>${formatNumber(video.comments)}</td><td>${formatNumber(video.shares)}</td><td>${formatNumber(video.bookmarks)}</td>
      <td>${engagement.toFixed(2)}%</td>
      <td class="source-cell">${source}</td>
      <td><a class="open-link" href="${escapeHtml(video.shareUrl)}" target="_blank" rel="noreferrer" title="打开 TikTok">↗</a></td>
      <td>${video.local ? `<button class="reuse-detail-btn" type="button" data-reuse-video="${escapeHtml(video.id)}">查看</button>` : `<span class="muted-action">无记录</span>`}</td>
    </tr>`;
  }).join("") : emptyRow(12, "当前筛选条件下暂无视频数据。");
  renderPagination(elements.videoPagination, page, (nextPage) => {
    videoPage = nextPage;
    renderVideos(videos);
  }, "视频");
}

function getPage(items, requestedPage) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(requestedPage) || 1), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), total, totalPages, current, start };
}

function renderPagination(container, page, onChange, itemLabel) {
  container.hidden = page.total <= PAGE_SIZE;
  if (container.hidden) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <span>共 ${formatNumber(page.total)} 个${itemLabel}，第 ${page.current}/${page.totalPages} 页</span>
    <div>
      <button type="button" data-page="${page.current - 1}" ${page.current === 1 ? "disabled" : ""}>上一页</button>
      <button type="button" data-page="${page.current + 1}" ${page.current === page.totalPages ? "disabled" : ""}>下一页</button>
    </div>`;
  container.querySelectorAll("button[data-page]").forEach((button) => {
    button.addEventListener("click", () => onChange(Number(button.dataset.page)));
  });
}

async function openReuseDetail(videoId) {
  elements.reuseModal.hidden = false;
  document.body.classList.add("modal-open");
  elements.reuseDialogTitle.textContent = "素材抽取复用详情";
  elements.reuseDialogMeta.textContent = "正在读取本地素材记录...";
  elements.reuseDialogBody.innerHTML = `<div class="reuse-loading">正在计算素材时间段重叠情况...</div>`;
  try {
    const data = await requestJson(`/api/tiktok-analytics/videos/${encodeURIComponent(videoId)}/reuse?t=${Date.now()}`);
    renderReuseDetail(data);
  } catch (error) {
    elements.reuseDialogMeta.textContent = "无法读取";
    elements.reuseDialogBody.innerHTML = `<div class="reuse-error">${escapeHtml(error.message)}</div>`;
  }
}

function closeReuseDetail() {
  elements.reuseModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function renderReuseDetail(data) {
  const video = data.video || {};
  const reuse = data.reuse || {};
  const summary = reuse.summary || {};
  const clips = reuse.clips || [];
  const related = reuse.relatedVideos || [];
  elements.reuseDialogTitle.textContent = video.local?.fileName || "素材抽取复用详情";
  elements.reuseDialogMeta.textContent = `TikTok @${video.username || "-"} · ${formatNumber(video.views)} 播放 · ${matchLabel(video.local)} · ${reuse.groupId || "未记录素材组"}`;
  elements.reuseDialogBody.innerHTML = `
    <div class="match-explainer"><strong>对应关系说明</strong><span>这里展示的是系统判定与当前TikTok视频对应的本地成片。匹配依据为账号、发布时间和发布标签；超过30分钟的记录不会强行匹配。</span></div>
    <section class="reuse-summary-grid">
      <article><span>本视频抽取了</span><strong>${formatNumber(summary.clipCount)} 段</strong><small>素材总时长 ${formatSeconds(summary.totalSeconds)}</small></article>
      <article><span>其中重复了</span><strong>${formatSeconds(summary.reusedSeconds)}</strong><small>与其他成片抽到同一时间段</small></article>
      <article><span>时间段重复度</span><strong class="${reuseTone(summary.reusePercent)}">${Number(summary.reusePercent || 0).toFixed(1)}%</strong><small>重复秒数 ÷ 本视频素材总秒数</small></article>
      <article><span>用过的源素材</span><strong>${Number(summary.sharedAssetPercent || 0).toFixed(1)}%</strong><small>${summary.sharedAssetClips || 0} 段的源文件也被其他成片使用</small></article>
      <article><span>涉及其他成片</span><strong>${formatNumber(summary.relatedVideoCount)} 条</strong><small>仅表示素材有关联，不代表画面完全相同</small></article>
    </section>
    <section class="reuse-section">
      <div class="reuse-section-head"><div><strong>本片素材明细</strong><span>红色越深表示同一时间段在其他成片中出现越多</span></div></div>
      <div class="reuse-table-wrap"><table class="reuse-table"><thead><tr><th>#</th><th>素材文件</th><th>抽取区间</th><th>时长</th><th>素材累计使用</th><th>重叠成片</th><th>重复秒数</th><th>片段复用率</th></tr></thead><tbody>
        ${clips.map((clip) => `<tr>
          <td>${clip.index}</td><td class="reuse-file" title="${escapeHtml(clip.fileName)}">${escapeHtml(clip.fileName || clip.assetId)}</td>
          <td>${formatSeconds(clip.start)} – ${formatSeconds(clip.end)}</td><td>${formatSeconds(clip.duration)}</td>
          <td>${clip.assetUseCount} 次 <small>峰值 ${clip.maxBucketReuse} 次</small></td><td>${clip.relatedVideoCount}</td><td>${formatSeconds(clip.reusedSeconds)}</td>
          <td>${reuseBar(clip.reusePercent)}</td>
        </tr>`).join("") || emptyRow(8, "没有保存素材片段记录。")}
      </tbody></table></div>
    </section>
    <section class="reuse-section">
      <div class="reuse-section-head"><div><strong>哪些其他视频用了相同素材</strong><span>“共同素材”只代表来自同一个源视频；只有“重叠秒数”才代表抽到了同一段画面</span></div></div>
      <div class="reuse-table-wrap"><table class="reuse-table related-table"><thead><tr><th>本地成片</th><th>TikTok对应</th><th>共同源素材</th><th>同画面秒数</th><th>播放</th><th>点赞</th><th>打开</th></tr></thead><tbody>
        ${related.map((item) => `<tr>
          <td class="reuse-file" title="${escapeHtml(item.outputId)}">${escapeHtml(item.outputId)}</td><td>${item.username ? `<strong>@${escapeHtml(item.username)}</strong><small>${escapeHtml(formatUnixTime(item.createTime))} · ${escapeHtml(matchLabel(item))}</small>` : "没有对应记录"}</td>
          <td>${item.sharedAssetCount}</td><td>${formatSeconds(item.sharedSeconds)}</td><td class="number-cell">${item.hasMetrics ? formatNumber(item.views) : "-"}</td><td>${item.hasMetrics ? formatNumber(item.likes) : "-"}</td>
          <td>${item.shareUrl ? `<a class="open-link" href="${escapeHtml(item.shareUrl)}" target="_blank" rel="noreferrer">↗</a>` : "-"}</td>
        </tr>`).join("") || emptyRow(7, "这条视频暂未发现与其他成片重叠的素材区间。")}
      </tbody></table></div>
    </section>`;
}

function reuseBar(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="reuse-bar"><i class="${reuseTone(value)}" style="width:${value}%"></i><span>${value.toFixed(1)}%</span></div>`;
}

function reuseTone(value) {
  if (Number(value) >= 60) return "reuse-high";
  if (Number(value) >= 25) return "reuse-medium";
  return "reuse-low";
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 60) return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function matchLabel(local) {
  if (!local) return "未匹配本地成片";
  const minutes = Math.max(0, Number(local.matchDistanceSeconds) || 0) / 60;
  const confidence = local.matchConfidence === "high" ? "高可信" : "需留意";
  return `${confidence} · 时间偏差${minutes < 1 ? "不足1" : Math.round(minutes)}分钟`;
}

function renderQuota(status) {
  const settings = status.settings || {};
  const groups = (settings.groups || []).map((name) => String(name || "").trim()).filter(Boolean);
  elements.nextRunText.textContent = settings.enabled
    ? `${formatDateTime(settings.nextRunAt)}${groups.length ? ` · ${groups.join("、")}` : ""}`
    : "未启用";
}

function updateGroupOptions(groups) {
  const current = elements.groupFilter.value;
  elements.groupFilter.innerHTML = `<option value="">全部账号组</option>${groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("")}`;
  if (groups.includes(current)) elements.groupFilter.value = current;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function setStatus(message, tone = "") {
  elements.pageStatus.textContent = message;
  elements.pageStatus.dataset.tone = tone;
}

function setButtonBusy(button, busy, label = "") {
  if (!button) return;
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.originalLabel;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { notation: Number(value) >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatUnixTime(seconds) { return formatDateTime(Number(seconds) * 1000); }
function formatDateTime(milliseconds) {
  const value = Number(milliseconds);
  if (!value) return "-";
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function pad(value) { return String(Number(value) || 0).padStart(2, "0"); }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}" class="empty-cell">${escapeHtml(text)}</td></tr>`; }
function debounce(fn, wait) { let timer = 0; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
