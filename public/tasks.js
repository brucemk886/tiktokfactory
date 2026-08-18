const $ = (selector) => document.querySelector(selector);
const taskList = $("#taskList");
const createStatus = $("#createStatus");
const createTaskBtn = $("#createTaskBtn");
const phoneList = $("#phoneList");
const phoneStatus = $("#phoneStatus");
const groupFilter = $("#groupFilter");
const nameFilter = $("#nameFilter");
const publishChannel = location.pathname === "/geelark-tasks" ? "geelark" : "official";
let phones = [];
let officialTikTokAccounts = [];
let novels = [];
let currentUserRole = "member";
let assetGroups = [];
let audioGroups = [];
let sharedLibrariesConfigured = false;
let pollTimer = null;
let lastTaskRenderKey = "";
let captionPresets = [];
const captionPresetStorageKey = "reddit-publish-caption-presets";
const selectedCaptionPresetKey = "reddit-publish-caption-selected";
applyPublishChannelChrome();

$("#createTaskBtn").addEventListener("click", () => createTask());
$("#generateVideosBtn")?.addEventListener("click", () => createTask({ generateOnly: true }));
$("#refreshTasksBtn").addEventListener("click", loadTasks);
$("#refreshPhonesBtn").addEventListener("click", refreshPublishAccounts);
$("#selectVisibleBtn").addEventListener("click", selectVisible);
$("#selectOfficialAccountsBtn")?.addEventListener("click", selectOfficialAccounts);
$("#officialGroupFilter")?.addEventListener("change", filterOfficialAccounts);
$("#officialNameFilter")?.addEventListener("input", filterOfficialAccounts);
$("#publishProvider")?.addEventListener("change", updatePublishProviderView);
$("#saveRulesBtn")?.addEventListener("click", saveGenerationRules);
$("#openingTitleEnabled")?.addEventListener("change", persistOpeningTitleSetting);
["#totalVideos", "#intervalMinutes", "#scheduleAt", "#autoPublish"].forEach((selector) => {
  $(selector)?.addEventListener("input", updatePublishPlanHint);
  $(selector)?.addEventListener("change", updatePublishPlanHint);
});
document.querySelectorAll("input[name='captionMode']").forEach((input) => input.addEventListener("change", persistCaptionMode));
$("#captionPresetSelect")?.addEventListener("change", selectCaptionPreset);
$("#addCaptionPresetBtn")?.addEventListener("click", addCaptionPreset);
$("#updateCaptionPresetBtn")?.addEventListener("click", updateCaptionPreset);
$("#deleteCaptionPresetBtn")?.addEventListener("click", deleteCaptionPreset);
$("#assetGroupSelect").addEventListener("change", updateVideoSourceVisibility);
$("#refreshSharedLibrariesBtn")?.addEventListener("click", loadSharedLibraries);
$("#sharedVideoLibrary")?.addEventListener("change", applySharedLibrarySelection);
$("#sharedAudioLibrary")?.addEventListener("change", applySharedLibrarySelection);
$("#audioDir")?.addEventListener("change", () => {
  if ($("#audioDir").value.trim()) clearSelectedMixNovels();
});
$("#audioGroupSelect")?.addEventListener("change", () => applyAudioGroupSelection());
$("#sharedMusicLibrary")?.addEventListener("change", applySharedLibrarySelection);
groupFilter.addEventListener("change", filterPhones);
nameFilter.addEventListener("input", filterPhones);
attachDirectoryPickers();
loadSavedSettings();
applyIncomingAudioBatch();
loadCaptionPresets();
setDefaultSchedule();
loadAssetGroups();
loadAudioGroups();
loadSharedLibraries();
loadNovels();
initializePublishProvider();
updatePublishPlanHint();
loadTasks();
$("#videoPreviewClose")?.addEventListener("click", closeVideoPreview);
$("#videoPreviewOverlay")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeVideoPreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#videoPreviewOverlay")?.hidden) closeVideoPreview();
});
window.addEventListener("pagehide", stopTaskPolling);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopTaskPolling();
  else void loadTasks();
});

function applyIncomingAudioBatch() {
  const params = new URLSearchParams(location.search);
  const audioDir = params.get("audioDir");
  if (!audioDir || params.get("source") !== "audio-library") return;
  const count = Math.max(1, Number(params.get("count")) || 1);
  $("#audioDir").value = audioDir;
  clearSelectedMixNovels();
  $("#taskName").value = `音频库 Reddit 任务 ${new Date().toLocaleDateString("zh-CN")}`;
  $("#totalVideos").value = String(count);
  setCreateStatus(`已从音频素材库载入 ${count} 条音频，请继续选择素材组和发布账号。`);
  history.replaceState({}, "", location.pathname);
}

async function createTask(options = {}) {
  const generateOnly = options.generateOnly === true;
  const provider = getPublishProvider();
  const selectedAudios = provider === "official" ? getSelectedAudioItems() : [];
  const selected = provider === "official"
    ? Array.from($("#officialAccountList").querySelectorAll(".official-tiktok-account-check:checked"))
    : Array.from(phoneList.querySelectorAll(".geelark-phone-check:checked"));
  const autoPublish = generateOnly ? false : $("#autoPublish").checked;
  const materialSource = $("#assetGroupSelect")?.value || "";
  const assetGroupId = materialSource === "__manual__" ? "" : materialSource;
  if (!assetGroupId && !$("#videoDir").value.trim()) return setCreateStatus("请选择素材组或视频素材目录。");
  const audioDir = selectedAudios.length ? "" : $("#audioDir").value.trim();
  if (provider !== "official" && !audioDir) return setCreateStatus("请选择音频目录。");
  if (provider === "official" && !selectedAudios.length && !audioDir) return setCreateStatus("请勾选混剪小说，或选择音频目录，二者选一个。");
  if (provider === "official" && selectedAudios.some((item) => !item.platform || !item.promotionCode)) {
    return setCreateStatus("勾选的小说里有书还缺少平台或推广码，请先回书单补全。");
  }
  if (autoPublish && !selected.length) return setCreateStatus(provider === "official" ? "自动发布任务至少需要选择一个官方授权账号。" : "自动发布任务至少需要选择一个 GeeLark 账号。");
  const accounts = provider === "geelark" ? selected.map((input) => {
    const phone = phones.find((item) => String(item.id) === input.value) || {};
    return { id: input.value, name: phone.serialName || "", serialNo: phone.serialNo || "", groupName: phone.groupName || "", remark: phone.remark || "" };
  }) : [];
  const officialAccounts = provider === "official" ? selected.map((input) => {
    const account = officialTikTokAccounts.find((item) => String(item.connectionId || item.id) === input.value) || {};
    return { connectionId: input.value, name: account.displayName || account.username || input.value, username: account.username || "", ownerEmail: account.ownerEmail || "" };
  }) : [];
  const schedule = $("#scheduleAt").value ? Math.floor(new Date($("#scheduleAt").value).getTime() / 1000) : Math.floor(Date.now() / 1000) + 600;
  if (autoPublish && schedule < Math.floor(Date.now() / 1000) + 300) return setCreateStatus("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
  const payload = {
    name: $("#taskName").value.trim(),
    generation: {
      assetGroupId,
      videoDir: $("#videoDir").value.trim(), includeVideoSubfolders: true,
      audioDir, audioItems: selectedAudios, backgroundMusicDir: $("#musicDir").value.trim(), saveDir: "",
      segmentMode: "fixed", segmentSeconds: number("#segmentSeconds", 5), totalVideos: number("#totalVideos", 40),
      subtitleYPercent: number("#subtitleY", 66), subtitleFontSize: number("#subtitleSize", 62), subtitleAnimationMode: $("#subtitleMode").value,
      quality: $("#quality").value, autoCaptions: $("#autoCaptions").checked, openingTitleEnabled: $("#openingTitleEnabled")?.checked === true, dedup: collectDedup(),
      novelId: selectedAudios[0]?.novelId || "", novelPlatform: selectedAudios[0]?.platform || "", novelPromotionCode: selectedAudios[0]?.promotionCode || ""
    },
    publish: {
      provider, autoPublish,
      envIds: provider === "geelark" ? selected.map((input) => input.value) : [], accounts,
      connectionIds: provider === "official" ? selected.map((input) => input.value) : [], officialAccounts,
      captionMode: getCaptionMode(),
      videoDesc: getCaptionMode() === "manual" ? $("#videoDesc").value : "",
      scheduleAt: schedule, intervalMinutes: number("#intervalMinutes", 60), batchPublishLimit: number("#batchLimit", 300), dailyPublishLimit: number("#dailyLimit", 300)
    }
  };
  setCreateButtonsDisabled(true);
  setCreateStatus(generateOnly ? "正在加入生成队列..." : "正在创建任务...");
  try {
    const response = await fetch("/api/auto-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败。");
    if (!generateOnly) clearAccountSelection();
    setCreateStatus(generateOnly
      ? `已加入生成队列：${data.task.name}。成片可在右侧预览，不会自动发布。`
      : `已加入队列：${data.task.name}`);
    void persistGenerationRules({ quiet: true });
    void loadTasks();
  } catch (error) {
    setCreateStatus(error.message || "创建任务失败。");
  } finally {
    setCreateButtonsDisabled(false);
  }
}

function setCreateButtonsDisabled(disabled) {
  if (createTaskBtn) createTaskBtn.disabled = disabled;
  if ($("#generateVideosBtn")) $("#generateVideosBtn").disabled = disabled;
}

async function loadTasks() {
  clearTimeout(pollTimer);
  try {
    const [tasksResponse, safetyResponse] = await Promise.all([fetch(`/api/auto-tasks?t=${Date.now()}`), fetch(`/api/geelark/safety?t=${Date.now()}`)]);
    const data = await tasksResponse.json();
    const safety = await safetyResponse.json();
    if (!tasksResponse.ok) throw new Error(data.error || "读取任务失败。");
    $("#safetySummary").textContent = `今日已提交排期 ${safety.scheduledToday || 0}/${safety.defaultDailyLimit || 300}，待核实 ${safety.uncertainCount || 0}，成片保留 ${data.worker?.retentionHours || 48} 小时`;
    const allTasks = data.tasks || [];
    const visibleTasks = allTasks.filter((task) => {
      if (task.taskType === "psychology" || task.taskType === "schulte") return false;
      const provider = task.publish?.provider || "geelark";
      return publishChannel === "official" ? provider === "official" : provider !== "official";
    });
    updateQueueMetrics(visibleTasks);
    const renderKey = createTaskRenderKey(visibleTasks, allTasks);
    if (renderKey !== lastTaskRenderKey) {
      renderTasks(visibleTasks, allTasks);
      lastTaskRenderKey = renderKey;
    }
  } catch (error) {
    taskList.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "读取任务失败。")}</div>`;
  }
  if (!document.hidden) pollTimer = setTimeout(loadTasks, 3000);
}

function renderTasks(tasks, allTasks = tasks) {
  if (!tasks.length) {
    taskList.innerHTML = '<div class="empty-state"><strong>队列为空</strong><span>创建任务后会在这里显示实时进度</span></div>';
    return;
  }
  const queuedTasks = tasks.filter((task) => task.status === "queued").sort((a, b) => {
    const scheduleDifference = Number(a.publish?.scheduleAt || 0) - Number(b.publish?.scheduleAt || 0);
    return scheduleDifference || Number(a.createdAt) - Number(b.createdAt);
  });
  const queuedPositions = new Map(queuedTasks.map((task, index) => [task.id, index]));
  const blocking = (allTasks || []).find((task) => task.status === "running" || ["generating", "publishing", "checking", "retrying"].includes(task.phase));
  const activeCount = blocking ? 1 : (tasks.some((task) => task.status === "running") ? 1 : 0);
  taskList.innerHTML = tasks.map((task) => {
    const progress = task.phase === "publishing" || task.phase === "retrying" ? task.publishProgress : task.progress;
    const current = Number(progress?.current) || 0;
    const total = Number(progress?.total) || 0;
    const percent = total > 0 ? Math.round(current / total * 100) : Number(progress?.percent) || 0;
    const failures = (task.publishResults || []).filter((item) => item.status === "failed" || item.status === "needs_check");
    const isOfficial = task.publish?.provider === "official";
    const accountLabels = Array.from(new Set(
      (isOfficial ? task.publish?.officialAccounts : task.publish?.accounts || [])
        .map((account) => String(isOfficial
          ? account?.username || account?.name || account?.connectionId || ""
          : account?.groupName || "").trim())
        .filter(Boolean)
    ));
    const groupHtml = accountLabels.length
      ? `<div class="task-groups"><span>${isOfficial ? "TikTok \u5b98\u65b9\u8d26\u53f7" : "\u8d26\u53f7\u5206\u7ec4"}</span>${accountLabels.map((name) => `<b>${escapeHtml(name)}</b>`).join("")}</div>`
      : "";
    const scheduleLines = buildTaskScheduleLines(task);
    const scheduleHtml = scheduleLines.length
      ? `<div class="task-schedule"><strong>具体排期</strong>${scheduleLines.map((item) => `<span><b>${escapeHtml(formatScheduleAt(item.scheduleAt))}</b><em>${item.count} 条</em></span>`).join("")}</div>`
      : "";
    const taskIsActive = ["running", "queued"].includes(task.status) || ["generating", "publishing", "checking", "retry_wait", "retrying"].includes(task.phase);
    const actions = taskIsActive
      ? `<button class="secondary-btn" data-action="cancel" data-id="${escapeAttr(task.id)}">停止</button>`
      : ["failed", "paused", "awaiting_review"].includes(task.status)
        ? `<button class="secondary-btn" data-action="resume" data-id="${escapeAttr(task.id)}">继续执行</button>`
        : "";
    const renameAction = `<button class="secondary-btn" data-action="rename" data-id="${escapeAttr(task.id)}">改名</button>`;
    const archiveAction = !taskIsActive ? `<button class="secondary-btn task-delete-btn" data-admin-action data-action="archive" data-id="${escapeAttr(task.id)}">删除</button>` : "";
    const failureHtml = failures.length ? `<div class="manual-items"><strong>待人工处理</strong>${failures.map((item) => `<div class="manual-item"><span>${escapeHtml(item.fileName)}<small>${escapeHtml(item.message || item.status)}</small></span><button data-action="retry" data-task-id="${escapeAttr(task.id)}" data-record-id="${escapeAttr(item.recordId)}">重新发布</button></div>`).join("")}</div>` : "";
    const queueAhead = task.status === "queued" ? activeCount + (queuedPositions.get(task.id) || 0) : 0;
    const taskMessage = task.status === "queued"
      ? blocking && blocking.id !== task.id
        ? `本机正在执行「${blocking.name || "其他任务"}」，完成后才会开始混剪。页面上的排期是发布时间，不是开始生成时间。`
        : queueAhead > 0
        ? `排队等待中，前方 ${queueAhead} 个任务；完成后会自动开始。`
        : "即将开始生成。"
      : task.message || "等待执行";
    return `<article class="auto-task-item" data-status="${escapeAttr(task.status)}">
      <div class="task-item-head"><div><strong>${escapeHtml(task.name)}</strong><small>${formatTime(task.createdAt)}</small></div><div class="task-head-actions"><span class="task-status-badge">${escapeHtml(statusLabel(task.status))}</span>${renameAction}${actions}${archiveAction}</div></div>
      ${groupHtml}
      <div class="task-progress"><div style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>
      <p>${escapeHtml(taskMessage)}</p>
      <div class="task-counts">${Number(task.failedVideoCount) > 0 ? `<span>\u751f\u6210\u8df3\u8fc7 ${Number(task.failedVideoCount)} \u6761</span>` : ""}<span>预计 ${task.expectedVideoCount || task.generatedVideos?.length || 0} 条</span><span>生成 ${task.generatedVideos?.length || 0} 条</span><span>${task.publish?.provider === "official" ? "已提交中台" : "发布成功"} ${task.publishSummary?.submitted || 0}</span><span>处理中 ${task.publishSummary?.pending || 0}</span><span>安全跳过 ${task.publishSummary?.skipped || 0}</span><span>\u5f85\u6838\u5b9e ${task.publishSummary?.needsCheck || 0}</span><span>失败 ${task.publishSummary?.failed || 0}</span></div>
      ${scheduleHtml}${renderTaskPreviews(task)}${task.error ? `<div class="task-error">${escapeHtml(task.error)}</div>` : ""}${failureHtml}
    </article>`;
  }).join("");
  taskList.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", handleTaskAction));
  taskList.querySelectorAll("[data-preview-url]").forEach((button) => {
    button.addEventListener("click", () => openVideoPreview(button.dataset.previewUrl, button.dataset.previewTitle));
  });
}

function previewVideoUrl(video) {
  const fileName = String(video?.fileName || "").trim();
  if (fileName) return `/outputs/${encodeURIComponent(fileName)}`;
  const url = String(video?.videoUrl || "");
  return url.startsWith("/outputs/") ? url : "";
}

function renderTaskPreviews(task) {
  const videos = (task.generatedVideos || []).filter((item) => item.videoUrl || item.fileName);
  if (!videos.length) return "";
  return `<div class="task-previews">
    <strong>混剪预览 ${videos.length} 条</strong>
    <div class="task-preview-grid">
      ${videos.map((video, index) => {
        const url = previewVideoUrl(video);
        const title = stripPreviewName(video.audioName || video.fileName || `视频 ${index + 1}`);
        const badge = [video.novelPromotionCode, video.novelPlatform].filter(Boolean).join(" · ");
        if (!url || video.outputDeletedAt) {
          return `<div class="task-preview-card is-gone">
            <span class="task-preview-thumb"><i>已清理</i></span>
            <span>${escapeHtml(title)}${badge ? `<small>${escapeHtml(badge)}</small>` : ""}</span>
          </div>`;
        }
        return `<button type="button" class="task-preview-card" data-preview-url="${escapeAttr(url)}" data-preview-title="${escapeAttr(title)}">
          <span class="task-preview-thumb"><i>播放</i></span>
          <span>${escapeHtml(title)}${badge ? `<small>${escapeHtml(badge)}</small>` : ""}</span>
        </button>`;
      }).join("")}
    </div>
  </div>`;
}

function stripPreviewName(value) {
  return String(value || "").replace(/\.[a-z0-9]+$/i, "") || "混剪视频";
}

function openVideoPreview(url, title) {
  const overlay = $("#videoPreviewOverlay");
  const player = $("#videoPreviewPlayer");
  const heading = $("#videoPreviewTitle");
  if (!overlay || !player || !url) return;
  if (heading) heading.textContent = title || "混剪预览";
  if (player.src !== new URL(url, location.href).href) {
    player.src = url;
    player.load();
  }
  overlay.hidden = false;
  player.play().catch(() => {});
}

function closeVideoPreview() {
  const overlay = $("#videoPreviewOverlay");
  const player = $("#videoPreviewPlayer");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  if (overlay) overlay.hidden = true;
}

function createTaskRenderKey(tasks, allTasks = []) {
  const blocking = (allTasks || []).find((task) => task.status === "running" || ["generating", "publishing"].includes(task.phase));
  return JSON.stringify({
    blocking: blocking ? { id: blocking.id, name: blocking.name, progress: blocking.progress } : null,
    tasks: tasks.map((task) => ({
    id: task.id,
    name: task.name,
    status: task.status,
    phase: task.phase,
    message: task.message,
    error: task.error,
    progress: task.progress,
    publishProgress: task.publishProgress,
    expectedVideoCount: task.expectedVideoCount,
    failedVideoCount: task.failedVideoCount,
    generatedVideoCount: task.generatedVideos?.length || 0,
    generatedVideoKeys: (task.generatedVideos || []).map((item) => item.videoUrl || item.fileName || ""),
    publishSummary: task.publishSummary,
    publishResultCount: task.publishResults?.length || 0,
    unresolvedResults: (task.publishResults || [])
      .filter((item) => item.status === "failed" || item.status === "needs_check")
      .map((item) => [item.recordId, item.fileName, item.status, item.message]),
    scheduleAt: task.publish?.scheduleAt,
    intervalMinutes: task.publish?.intervalMinutes,
    provider: task.publish?.provider || "geelark",
    accounts: (task.publish?.accounts || []).map((account) => [account.id, account.groupName]),
    officialAccounts: (task.publish?.officialAccounts || []).map((account) => [account.connectionId, account.name, account.username])
  }))
  });
}

function stopTaskPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

async function handleTaskAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === "rename") {
      const name = prompt("修改任务名称", button.closest(".auto-task-item")?.querySelector(".task-item-head strong")?.textContent || "");
      if (name === null) return;
      const response = await fetch(`/api/auto-tasks/${encodeURIComponent(button.dataset.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "修改任务名称失败。");
    } else if (action === "archive") {
      if (!confirm("删除后仅从当前执行队列隐藏，历史记录仍会保留。确定删除吗？")) return;
      const response = await fetch(`/api/auto-tasks/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除任务失败。");
    } else if (action === "retry") {
      const response = await fetch(`/api/auto-tasks/${encodeURIComponent(button.dataset.taskId)}/retry-publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: button.dataset.recordId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "重新发布失败。");
    } else {
      const response = await fetch(`/api/auto-tasks/${encodeURIComponent(button.dataset.id)}/${action}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败。");
    }
    await loadTasks();
  } catch (error) {
    alert(error.message || "操作失败。");
  } finally {
    button.disabled = false;
  }
}

async function loadPhones() {
  phoneStatus.textContent = "正在读取 GeeLark 账号...";
  try {
    const response = await fetch(`/api/geelark/phones?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取账号失败。");
    phones = data.phones || [];
    const groups = Array.from(new Set(phones.map((phone) => phone.groupName).filter(Boolean))).sort();
    groupFilter.innerHTML = `<option value="">全部分组</option>${groups.map((group) => `<option value="${escapeAttr(group)}">${escapeHtml(group)}</option>`).join("")}`;
    phoneList.innerHTML = phones.map((phone) => `<label class="geelark-phone-item" data-search="${escapeAttr([phone.serialName, phone.serialNo, phone.groupName, phone.remark, phone.id].join(" ").toLowerCase())}" data-group="${escapeAttr(phone.groupName || "")}"><input class="geelark-phone-check" type="checkbox" value="${escapeAttr(phone.id)}" /><span><strong>${escapeHtml(phone.serialName || phone.id)}</strong><small>${escapeHtml(phone.groupName || phone.serialNo || phone.id)}</small></span></label>`).join("");
    phoneList.querySelectorAll(".geelark-phone-check").forEach((input) => input.addEventListener("change", updateSelectedAccountCount));
    phoneStatus.textContent = `已读取 ${phones.length} 个账号。`;
    updateSelectedAccountCount();
  } catch (error) {
    phoneStatus.textContent = error.message || "读取账号失败。";
  }
}

async function initializePublishProvider() {
  try {
    const response = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) currentUserRole = data.user?.role === "admin" ? "admin" : "member";
  } catch {
    currentUserRole = "member";
  }
  const providerField = $("#publishProviderField");
  const providerSelect = $("#publishProvider");
  if (providerField) providerField.hidden = true;
  if (providerSelect) providerSelect.value = publishChannel;
  await updatePublishProviderView();
}

function getPublishProvider() {
  return publishChannel;
}

function applyPublishChannelChrome() {
  document.body.dataset.publishChannel = publishChannel;
  const official = publishChannel === "official";
  document.title = official ? "Reddit 自动发布 · Local Factory" : "GeeLark · Reddit 自动发布 · Local Factory";
  if ($("#pageKicker")) $("#pageKicker").textContent = official ? "OFFICIAL API" : "GEELARK BACKUP";
  if ($("#pageTitle")) $("#pageTitle").textContent = official ? "Reddit 自动发布" : "GeeLark · Reddit 自动发布";
  const novelField = document.querySelector(".novel-select-field");
  if (novelField) novelField.hidden = !official;
  if ($("#pageLead")) $("#pageLead").textContent = official
    ? "勾选混剪小说，或改选本机 F:\\音频目录 里的文件夹。小说音频不用传到线上，工人在本机按文件名查找。"
    : "GeeLark 备用发布，成片不叠加平台和推广码。";
  if ($("#publishLead")) $("#publishLead").textContent = official
    ? "选择官方授权账号，设置文案与发布时间。GeeLark 发布已移到备用区。"
    : "选择 GeeLark 账号发布。官方 API 任务在小说推文的 Reddit 自动发布里。";
}

async function loadNovels() {
  if (publishChannel !== "official") return;
  const root = $("#novelAudioPicker");
  if (!root) return;
  try {
    const response = await fetch(`/api/novel-content?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取小说书单失败。");
    novels = Array.isArray(data.novels) ? data.novels : [];
    renderNovelAudioPicker();
  } catch (error) {
    novels = [];
    root.textContent = error.message || "读取小说书单失败。";
  }
}

function enabledMixAudios(novel) {
  return (novel.scripts || []).filter((script) => script.audio?.id && script.mixEnabled !== false);
}

function renderNovelAudioPicker() {
  const root = $("#novelAudioPicker");
  if (!root) return;
  if (!novels.length) {
    root.textContent = "还没有小说书单。";
    updateNovelBadgeHint();
    return;
  }
  root.innerHTML = novels.map((novel) => {
    const audios = enabledMixAudios(novel);
    return `
      <label class="novel-audio-novel">
        <input type="checkbox" data-novel-id="${escapeAttr(novel.id)}" ${audios.length ? "" : "disabled"} />
        <strong>${escapeHtml(novel.title || "未命名")}</strong>
        <small>${escapeHtml(formatNovelBadge(novel))} · ${audios.length} 条生效音频</small>
      </label>`;
  }).join("");
  root.querySelectorAll("[data-novel-id]").forEach((input) => {
    input.addEventListener("change", updateNovelBadgeHint);
  });
  updateNovelBadgeHint();
}

function getSelectedNovels() {
  return Array.from(document.querySelectorAll("#novelAudioPicker [data-novel-id]:checked"))
    .map((input) => novels.find((item) => item.id === input.dataset.novelId))
    .filter(Boolean);
}

function getSelectedAudioItems() {
  return getSelectedNovels().flatMap((novel) => enabledMixAudios(novel).map((script) => ({
    id: script.audio.id,
    path: script.audio.targetAudioPath || "",
    fileName: script.audio.fileName || "",
    scriptId: script.id,
    novelId: novel.id,
    platform: novel.platform || "",
    promotionCode: novel.promotionCode || "",
    promotionCopy: novel.promotionCopy || "",
    openingTitle: script.openingTitle || script.title || "",
    title: script.openingTitle || script.versionLabel || script.title || script.audio.title || ""
  })));
}

function updateNovelBadgeHint() {
  const hint = $("#novelBadgeHint");
  if (!hint) return;
  const selectedNovels = getSelectedNovels();
  const selected = getSelectedAudioItems();
  if (!selectedNovels.length) {
    hint.textContent = "勾选小说后不用再选音频目录。工人会在本机 F:\\音频目录 和音频库里找对应 mp3，不用再往线上传。";
    updateAudioSourceMode();
    updateCaptionModeView();
    return;
  }
  hint.textContent = `已选 ${selectedNovels.length} 本小说，将抽 ${selected.length} 条生效音频。音频目录已收起。`;
  updateAudioSourceMode();
  updateCaptionModeView();
}

function formatNovelBadge(novel) {
  const platform = formatNovelPlatform(novel.platform);
  return [novel.promotionCode, platform].filter(Boolean).join(" · ") || "未设置平台/推广码";
}

function formatNovelPlatform(platform) {
  return platform === "NovelMaster" ? "Novel Master" : String(platform || "");
}

async function updatePublishProviderView() {
  const provider = getPublishProvider();
  const geelarkPanel = $("#geelarkPublishAccounts");
  const officialPanel = $("#officialPublishAccounts");
  if (geelarkPanel) geelarkPanel.hidden = provider !== "geelark";
  if (officialPanel) officialPanel.hidden = provider !== "official";
  $("#refreshPhonesBtn").textContent = provider === "official" ? "刷新授权账号" : "刷新账号";
  if (provider === "official") await loadOfficialTikTokAccounts();
  else await loadPhones();
}

async function refreshPublishAccounts() {
  if (getPublishProvider() === "official") return loadOfficialTikTokAccounts();
  return loadPhones();
}

async function loadOfficialTikTokAccounts() {
  const list = $("#officialAccountList");
  if (!list || currentUserRole !== "admin") return;
  phoneStatus.textContent = "正在读取官方授权账号...";
  list.innerHTML = "";
  try {
    const response = await fetch(`/api/official-tiktok/publish-accounts?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取官方授权账号失败。");
    const allAccounts = Array.isArray(data.accounts) ? data.accounts : [];
    officialTikTokAccounts = allAccounts.filter((account) => Array.isArray(account.scopes) && account.scopes.includes("video.publish"));
    const groups = Array.from(new Set(officialTikTokAccounts.map((account) => account.groupName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    if ($("#officialGroupFilter")) {
      $("#officialGroupFilter").innerHTML = `<option value="">全部分组</option><option value="ungrouped">未分组</option>${groups.map((group) => `<option value="${escapeAttr(group)}">${escapeHtml(group)}</option>`).join("")}`;
    }
    list.innerHTML = officialTikTokAccounts.map((account, index) => {
      const connectionId = account.connectionId || account.id || "";
      const displayName = account.displayName || account.username || `TikTok 账号 ${index + 1}`;
      const username = account.username ? `@${account.username}` : connectionId;
      const owner = account.ownerEmail || "未标记归属邮箱";
      const groupName = account.groupName || "未分组";
      return `<label class="geelark-phone-item" data-search="${escapeAttr([displayName, username, owner, groupName, connectionId].join(" ").toLowerCase())}" data-group="${escapeAttr(account.groupName || "")}"><input class="official-tiktok-account-check" type="checkbox" value="${escapeAttr(connectionId)}" /><span><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(username)} · ${escapeHtml(groupName)}</small></span></label>`;
    }).join("");
    list.querySelectorAll(".official-tiktok-account-check").forEach((input) => input.addEventListener("change", updateSelectedOfficialAccountCount));
    const hiddenCount = allAccounts.length - officialTikTokAccounts.length;
    phoneStatus.textContent = officialTikTokAccounts.length
      ? `已读取 ${officialTikTokAccounts.length} 个可发布账号${hiddenCount ? `，隐藏 ${hiddenCount} 个无 video.publish 权限账号` : ""}。可按分组筛选。`
      : allAccounts.length ? "没有具有 video.publish 权限的账号。" : "暂无官方授权账号。";
    filterOfficialAccounts();
    updateSelectedOfficialAccountCount();
  } catch (error) {
    officialTikTokAccounts = [];
    phoneStatus.textContent = error.message || "读取官方授权账号失败。";
  }
}

function selectOfficialAccounts() {
  const inputs = Array.from($("#officialAccountList")?.querySelectorAll(".geelark-phone-item:not([hidden]) .official-tiktok-account-check") || []);
  const shouldCheck = inputs.some((input) => !input.checked);
  inputs.forEach((input) => { input.checked = shouldCheck; });
  updateSelectedOfficialAccountCount();
}

function filterOfficialAccounts() {
  const list = $("#officialAccountList");
  if (!list) return;
  const group = $("#officialGroupFilter")?.value || "";
  const query = String($("#officialNameFilter")?.value || "").trim().toLowerCase();
  list.querySelectorAll(".geelark-phone-item").forEach((item) => {
    const matchGroup = !group || (group === "ungrouped" ? !item.dataset.group : item.dataset.group === group);
    const matchQuery = !query || String(item.dataset.search || "").includes(query);
    item.hidden = !(matchGroup && matchQuery);
  });
}

function updateSelectedOfficialAccountCount() {
  const count = $("#officialAccountList")?.querySelectorAll(".official-tiktok-account-check:checked").length || 0;
  if ($("#selectedOfficialAccountCount")) $("#selectedOfficialAccountCount").textContent = `已选 ${count} 个`;
  updatePublishPlanHint();
}

async function loadAudioGroups() {
  const select = $("#audioGroupSelect");
  const hint = $("#audioGroupHint");
  if (!select) return;
  try {
    const response = await fetch(`/api/audio-groups?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取音频目录失败。");
    audioGroups = Array.isArray(data.groups) ? data.groups : [];
    const current = select.value || $("#audioDir")?.value || "";
    select.innerHTML = `<option value="">请选择音频文件夹</option>${audioGroups.map((group) => `<option value="${escapeAttr(group.id)}" data-path="${escapeAttr(group.path)}">${escapeHtml(group.name || group.id)}（${Number(group.totalAssets) || 0} 条）</option>`).join("")}`;
    const matched = audioGroups.find((group) => group.id === current || group.path === current);
    if (matched) select.value = matched.id;
    applyAudioGroupSelection({ keepNovels: true });
    if (hint) hint.textContent = audioGroups.length
      ? `固定读取 ${data.libraryRoot || "F:\\音频目录"}，已同步 ${audioGroups.length} 个文件夹。`
      : "本机 F:\\音频目录 下还没有文件夹，或工人还没同步上来。";
  } catch (error) {
    select.innerHTML = '<option value="">音频目录读取失败</option>';
    if (hint) hint.textContent = error.message || "读取音频目录失败。";
  }
}

function applyAudioGroupSelection({ keepNovels = false } = {}) {
  const select = $("#audioGroupSelect");
  const group = audioGroups.find((item) => item.id === select?.value);
  if ($("#audioDir")) $("#audioDir").value = group?.path || "";
  if (group?.path && !keepNovels) clearSelectedMixNovels();
}

async function loadAssetGroups() {
  const select = $("#assetGroupSelect");
  const hint = $("#assetGroupHint");
  if (!select) return;
  try {
    const response = await fetch(`/api/asset-groups?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取素材组失败。");
    assetGroups = Array.isArray(data.groups) ? data.groups : [];
    select.innerHTML = `<option value="">请选择一个素材组</option>${assetGroups.map((group) => `<option value="${escapeAttr(group.id)}">${escapeHtml(group.name || group.id)}（${assetCount(group)} 条）</option>`).join("")}`;
    if (hint) hint.textContent = assetGroups.length ? `已读取 ${assetGroups.length} 个素材组。` : "暂无已建立索引的素材组，请使用共享素材库。";
    updateVideoSourceVisibility();
  } catch (error) {
    select.innerHTML = '<option value="">素材组读取失败</option>';
    if (hint) hint.textContent = error.message || "读取素材组失败，请使用共享素材库。";
    updateVideoSourceVisibility();
  }
}

async function loadSharedLibraries() {
  const panel = $("#sharedLibraryPanel");
  const hint = $("#sharedLibraryHint");
  const refresh = $("#refreshSharedLibrariesBtn");
  if (!panel) return;
  if (refresh) refresh.disabled = true;
  if (hint) hint.textContent = "正在读取共享目录下的素材库...";
  try {
    const response = await fetch(`/api/shared-libraries?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取共享素材库失败。");
    if (!data.configured) {
      panel.hidden = true;
      sharedLibrariesConfigured = false;
      $("#directMusicSource").hidden = false;
      updateAudioSourceMode();
      return;
    }
    const libraries = data.libraries || [];
    panel.hidden = false;
    sharedLibrariesConfigured = true;
    $("#directMusicSource").hidden = true;
    const options = libraries.map((library) => `<option value="${escapeAttr(library.path)}">${escapeHtml(library.name)}</option>`).join("");
    ["#sharedVideoLibrary", "#sharedAudioLibrary", "#sharedMusicLibrary"].forEach((selector, index) => {
      const select = $(selector);
      if (!select) return;
      const current = select.value;
      select.innerHTML = `${index === 2 ? '<option value="">不使用背景音乐</option>' : '<option value="">请选择素材库</option>'}${options}`;
      if (Array.from(select.options).some((option) => option.value === current)) select.value = current;
    });
    if (hint) hint.textContent = `共享目录：${data.root}，已读取 ${libraries.length} 个一级素材库。`;
    updateAudioSourceMode();
  } catch (error) {
    panel.hidden = true;
    sharedLibrariesConfigured = false;
    if (hint) hint.textContent = error.message || "共享素材库读取失败。";
    updateAudioSourceMode();
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

function applySharedLibrarySelection(event) {
  const targetId = event?.currentTarget?.id || "";
  const videoDir = $("#sharedVideoLibrary")?.value || "";
  if (targetId === "sharedVideoLibrary" && videoDir) {
    $("#videoDir").value = videoDir;
    const source = $("#assetGroupSelect");
    if (source) {
      source.value = "";
      updateVideoSourceVisibility();
    }
  }
  if (targetId === "sharedAudioLibrary") {
    $("#audioDir").value = $("#sharedAudioLibrary")?.value || "";
    if ($("#sharedAudioLibrary")?.value) clearSelectedMixNovels();
  }
  if (targetId === "sharedMusicLibrary") $("#musicDir").value = $("#sharedMusicLibrary")?.value || "";
}

function usingMixNovels() {
  return publishChannel === "official" && getSelectedAudioItems().length > 0;
}

function clearSelectedMixNovels() {
  document.querySelectorAll("#novelAudioPicker [data-novel-id]:checked").forEach((input) => { input.checked = false; });
  updateNovelBadgeHint();
}

function updateAudioSourceMode() {
  const useNovels = usingMixNovels();
  const sharedAudio = $("#sharedAudioSource");
  const directAudio = $("#directAudioSource");
  if (directAudio) directAudio.hidden = useNovels || sharedLibrariesConfigured;
  if (sharedAudio) sharedAudio.hidden = useNovels || !sharedLibrariesConfigured;
}

function updateVideoSourceVisibility() {}

function clearAccountSelection() {
  groupFilter.value = "";
  nameFilter.value = "";
  phoneList.querySelectorAll(".geelark-phone-check:checked").forEach((input) => { input.checked = false; });
  filterPhones();
  updateSelectedAccountCount();
  $("#officialAccountList")?.querySelectorAll(".official-tiktok-account-check:checked").forEach((input) => { input.checked = false; });
  updateSelectedOfficialAccountCount();
}

function filterPhones() {
  const group = groupFilter.value;
  const keyword = nameFilter.value.trim().toLowerCase();
  let visible = 0;
  phoneList.querySelectorAll(".geelark-phone-item").forEach((item) => {
    const show = (!group || item.dataset.group === group) && (!keyword || item.dataset.search.includes(keyword));
    item.hidden = !show;
    if (show) visible += 1;
  });
  phoneStatus.textContent = `已显示 ${visible}/${phones.length} 个账号。`;
}

function selectVisible() {
  const visible = Array.from(phoneList.querySelectorAll(".geelark-phone-item:not([hidden]) .geelark-phone-check"));
  const shouldCheck = visible.some((input) => !input.checked);
  visible.forEach((input) => { input.checked = shouldCheck; });
  updateSelectedAccountCount();
}

function updateSelectedAccountCount() {
  const count = phoneList.querySelectorAll(".geelark-phone-check:checked").length;
  const target = $("#selectedAccountCount");
  if (target) target.textContent = `已选 ${count} 个`;
  updatePublishPlanHint();
}

function updatePublishPlanHint() {
  const hint = $("#publishPlanHint");
  if (!hint) return;
  const videos = Math.max(0, number("#totalVideos", 0));
  const accounts = getPublishProvider() === "official"
    ? ($("#officialAccountList")?.querySelectorAll(".official-tiktok-account-check:checked").length || 0)
    : (phoneList?.querySelectorAll(".geelark-phone-check:checked").length || 0);
  const interval = Math.max(0, number("#intervalMinutes", 60));
  if (!videos || !accounts) {
    hint.textContent = "生成条数会轮流分给所选账号，同一账号的下一条才按间隔排期。例如 5 条视频 + 5 个账号 = 起始时间同时各发 1 条。";
    return;
  }
  const waves = Math.ceil(videos / accounts);
  const firstWave = Math.min(accounts, videos);
  if (waves === 1) {
    hint.textContent = `将生成 ${videos} 条视频，分给 ${accounts} 个账号，起始时间同时发出 ${firstWave} 条。每条视频只发一个账号。`;
    return;
  }
  hint.textContent = `将生成 ${videos} 条视频，轮流分给 ${accounts} 个账号：起始时间先发 ${firstWave} 条，同一账号下一条间隔 ${interval} 分钟，共 ${waves} 个时间点。`;
}

function updateQueueMetrics(tasks) {
  const set = (selector, value) => { if ($(selector)) $(selector).textContent = String(value); };
  set("#queuedCount", tasks.filter((task) => task.status === "queued").length);
  set("#runningCount", tasks.filter((task) => ["running", "generating", "publishing", "retry_wait", "retrying"].includes(task.status) || ["generating", "publishing", "retry_wait", "retrying"].includes(task.phase)).length);
  set("#attentionCount", tasks.filter((task) => ["needs_attention", "failed", "awaiting_review"].includes(task.status)).length);
  set("#doneCount", tasks.filter((task) => task.status === "done").length);
}

function buildTaskScheduleLines(task) {
  const stored = (task.schedulePlan || []).flatMap((day) => Array.isArray(day.times) ? day.times : []);
  if (stored.length) return stored.sort((a, b) => Number(a.scheduleAt) - Number(b.scheduleAt));
  if (!task.publish?.autoPublish) return [];
  const total = Number(task.expectedVideoCount) || Number(task.generatedVideos?.length) || 0;
  const accountCount = task.publish?.provider === "official"
    ? (Array.isArray(task.publish.connectionIds) ? task.publish.connectionIds.length : 0)
    : (Array.isArray(task.publish.envIds) ? task.publish.envIds.length : 0);
  if (!total || !accountCount) return [];
  const startAt = Number(task.publish.scheduleAt) || 0;
  const intervalSeconds = Math.max(0, Number(task.publish.intervalMinutes) || 0) * 60;
  const lines = [];
  for (let offset = 0; offset < total; offset += accountCount) {
    lines.push({ scheduleAt: startAt + Math.floor(offset / accountCount) * intervalSeconds, count: Math.min(accountCount, total - offset) });
  }
  return lines;
}

function formatScheduleAt(value) {
  const date = new Date(Number(value) * 1000);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function attachDirectoryPickers() {
  document.querySelectorAll("[data-pick-directory]").forEach((button) => button.addEventListener("click", async () => {
    const input = document.getElementById(button.dataset.pickDirectory);
    button.disabled = true;
    try {
      const response = await fetch("/api/select-directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initialPath: input.value, title: "选择文件夹" }) });
      const data = await response.json();
      if (data.path) {
        input.value = data.path;
        if (input.id === "audioDir") clearSelectedMixNovels();
      }
    } finally { button.disabled = false; }
  }));
}

function collectDedup() {
  const saved = readStored("reddit-mix-dedup-settings");
  return { enabled: true, ...saved, scaleMin: number("#scaleMin", 1.03), scaleMax: number("#scaleMax", 1.08), rotateMin: number("#rotateMin", -0.8), rotateMax: number("#rotateMax", 0.8), mirrorChance: number("#mirrorChance", 30), sharpen: number("#sharpen", 0.2), speedMin: number("#speedMin", 0.96), speedMax: number("#speedMax", 1.04) };
}

function collectSubtitleSettings() {
  return {
    ...readStored("reddit-mix-subtitle-settings"),
    yPercent: number("#subtitleY", 66),
    fontSize: number("#subtitleSize", 62),
    animationMode: $("#subtitleMode")?.value || "sentence",
    openingTitleEnabled: $("#openingTitleEnabled")?.checked === true
  };
}

function collectGenerationSettings() {
  return {
    totalVideos: number("#totalVideos", 40),
    segmentSeconds: number("#segmentSeconds", 5),
    quality: $("#quality")?.value === "quality" ? "quality" : "fast",
    autoCaptions: $("#autoCaptions")?.checked !== false
  };
}

function applyGenerationSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  setValue("#totalVideos", settings.totalVideos);
  setValue("#segmentSeconds", settings.segmentSeconds);
  setValue("#quality", settings.quality);
  if ($("#autoCaptions") && typeof settings.autoCaptions === "boolean") $("#autoCaptions").checked = settings.autoCaptions;
}

function setRulesSaveStatus(message) {
  const status = $("#rulesSaveStatus");
  if (status) status.textContent = message;
}

async function persistGenerationRules({ quiet = false } = {}) {
  const subtitle = collectSubtitleSettings();
  const generation = collectGenerationSettings();
  const dedup = collectDedup();
  localStorage.setItem("reddit-mix-subtitle-settings", JSON.stringify(subtitle));
  localStorage.setItem("reddit-mix-generation-settings", JSON.stringify(generation));
  localStorage.setItem("reddit-mix-dedup-settings", JSON.stringify(dedup));
  try {
    await saveSharedRedditSettings({ subtitle, generation, dedup });
    if (!quiet) setRulesSaveStatus(`已保存整组生成规则 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`);
  } catch (error) {
    if (!quiet) setRulesSaveStatus(`本机已保存，同步失败：${error.message || "请求失败"}`);
  }
}

async function saveGenerationRules() {
  return persistGenerationRules();
}

function getCaptionMode() {
  return document.querySelector("input[name='captionMode']:checked")?.value === "manual" ? "manual" : "auto";
}

function persistCaptionMode() {
  localStorage.setItem("reddit-publish-caption-mode", getCaptionMode());
  updateCaptionModeView();
}

function restoreCaptionMode() {
  const saved = localStorage.getItem("reddit-publish-caption-mode") === "manual" ? "manual" : "auto";
  document.querySelectorAll("input[name='captionMode']").forEach((input) => {
    input.checked = input.value === saved;
  });
  updateCaptionModeView();
}

function updateCaptionModeView() {
  const manual = getCaptionMode() === "manual";
  const autoPanel = $("#autoCaptionPanel");
  const manualPanel = $("#manualCaptionPanel");
  if (autoPanel) autoPanel.hidden = manual;
  if (manualPanel) manualPanel.hidden = !manual;
  if (!manual) renderAutoCaptionPreview();
}

function renderAutoCaptionPreview() {
  const hint = $("#autoCaptionHint");
  const preview = $("#autoCaptionPreview");
  if (!hint || !preview) return;
  const selected = getSelectedAudioItems();
  if (!selected.length) {
    hint.textContent = "默认按每条音频自动生成：用音频文件名作文案，并轮换不同标签。勾选小说或选音频目录后可预览第一条。";
    preview.hidden = true;
    preview.textContent = "";
    return;
  }
  const first = selected[0];
  const sample = buildTikTokCaptionPreview(first);
  hint.textContent = selected.length === 1
    ? "这条成片将自动使用下面的文案；正文来自音频文件名，标签会按音频轮换。"
    : `已选 ${selected.length} 条音频，每条成片用自己的文件名和不同标签。下面是第一条预览：`;
  preview.hidden = !sample;
  preview.textContent = sample;
}

function buildTikTokCaptionPreview(item = {}) {
  const title = String(item.openingTitle || item.title || item.audioName || "").replace(/\s+/g, " ").trim();
  const promo = String(item.promotionCopy || "").trim();
  const platform = String(item.platform || "").replace(/\s+/g, "").trim();
  const tags = [platform ? `#${platform}` : "", "#reddit", "#storytime"].filter(Boolean).join(" ");
  return [title, promo, tags].filter(Boolean).join("\n\n");
}

function loadCaptionPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(captionPresetStorageKey) || "[]");
    captionPresets = Array.isArray(saved) ? saved.filter((item) => item && item.id && String(item.text || "").trim()) : [];
  } catch {
    captionPresets = [];
  }
  renderCaptionPresets(localStorage.getItem(selectedCaptionPresetKey) || "");
  restoreCaptionMode();
}

function renderCaptionPresets(selectedId = "") {
  const select = $("#captionPresetSelect");
  if (!select) return;
  select.innerHTML = `<option value="">临时文案</option>${captionPresets.map((item, index) => `<option value="${escapeAttr(item.id)}">${index + 1}. ${escapeHtml(captionPresetLabel(item.text))}</option>`).join("")}`;
  const selected = captionPresets.find((item) => item.id === selectedId);
  select.value = selected ? selected.id : "";
  if (selected) $("#videoDesc").value = selected.text;
  updateCaptionPresetButtons();
}

function selectCaptionPreset() {
  const id = $("#captionPresetSelect").value;
  const selected = captionPresets.find((item) => item.id === id);
  localStorage.setItem(selectedCaptionPresetKey, id);
  if (selected) $("#videoDesc").value = selected.text;
  setCaptionPresetStatus(selected ? "已载入所选文案。" : "当前为临时文案，不会自动加入文案库。");
  updateCaptionPresetButtons();
}

function addCaptionPreset() {
  const text = $("#videoDesc").value.trim();
  if (!text) return setCaptionPresetStatus("请先输入文案。", true);
  const duplicate = captionPresets.find((item) => item.text === text);
  if (duplicate) {
    renderCaptionPresets(duplicate.id);
    localStorage.setItem(selectedCaptionPresetKey, duplicate.id);
    return setCaptionPresetStatus("这条文案已经在文案库中。", true);
  }
  const preset = { id: `caption-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, updatedAt: Date.now() };
  captionPresets.push(preset);
  persistCaptionPresets(preset.id);
  setCaptionPresetStatus(`已新增第 ${captionPresets.length} 条文案。`);
}

function updateCaptionPreset() {
  const id = $("#captionPresetSelect").value;
  const preset = captionPresets.find((item) => item.id === id);
  if (!preset) return setCaptionPresetStatus("请先选择一条已保存文案。", true);
  const text = $("#videoDesc").value.trim();
  if (!text) return setCaptionPresetStatus("文案不能为空。", true);
  preset.text = text;
  preset.updatedAt = Date.now();
  persistCaptionPresets(id);
  setCaptionPresetStatus("所选文案已更新。 ");
}

function deleteCaptionPreset() {
  const id = $("#captionPresetSelect").value;
  const preset = captionPresets.find((item) => item.id === id);
  if (!preset) return setCaptionPresetStatus("请先选择要删除的文案。", true);
  if (!window.confirm(`确认删除文案“${captionPresetLabel(preset.text)}”吗？`)) return;
  captionPresets = captionPresets.filter((item) => item.id !== id);
  localStorage.removeItem(selectedCaptionPresetKey);
  localStorage.setItem(captionPresetStorageKey, JSON.stringify(captionPresets));
  $("#videoDesc").value = "";
  renderCaptionPresets();
  setCaptionPresetStatus("文案已删除。 ");
}

function persistCaptionPresets(selectedId) {
  localStorage.setItem(captionPresetStorageKey, JSON.stringify(captionPresets));
  localStorage.setItem(selectedCaptionPresetKey, selectedId);
  renderCaptionPresets(selectedId);
}

function updateCaptionPresetButtons() {
  const hasSelection = Boolean($("#captionPresetSelect")?.value);
  if ($("#updateCaptionPresetBtn")) $("#updateCaptionPresetBtn").disabled = !hasSelection;
  if ($("#deleteCaptionPresetBtn")) $("#deleteCaptionPresetBtn").disabled = !hasSelection;
}

function captionPresetLabel(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
}

function setCaptionPresetStatus(message, isWarning = false) {
  const status = $("#captionPresetStatus");
  if (!status) return;
  status.textContent = message;
  status.style.color = isWarning ? "var(--task-amber)" : "var(--task-muted)";
}

async function loadSavedSettings() {
  const subtitle = readStored("reddit-mix-subtitle-settings");
  setValue("#subtitleY", subtitle.yPercent); setValue("#subtitleSize", subtitle.fontSize); setValue("#subtitleMode", subtitle.animationMode);
  if ($("#openingTitleEnabled")) $("#openingTitleEnabled").checked = subtitle.openingTitleEnabled === true;
  applyGenerationSettings(readStored("reddit-mix-generation-settings"));
  const dedup = readStored("reddit-mix-dedup-settings");
  setValue("#scaleMin", dedup.scaleMin); setValue("#scaleMax", dedup.scaleMax); setValue("#rotateMin", dedup.rotateMin); setValue("#rotateMax", dedup.rotateMax); setValue("#mirrorChance", dedup.mirrorChance); setValue("#sharpen", dedup.sharpen); setValue("#speedMin", dedup.speedMin); setValue("#speedMax", dedup.speedMax);
  try {
    const response = await fetch("/api/reddit-mix/settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取统一配置失败。");
    if (!data.exists) return;
    const sharedSubtitle = data.settings?.subtitle || {};
    const sharedGeneration = data.settings?.generation || {};
    const sharedDedup = data.settings?.dedup || {};
    setValue("#subtitleY", sharedSubtitle.yPercent); setValue("#subtitleSize", sharedSubtitle.fontSize); setValue("#subtitleMode", sharedSubtitle.animationMode);
    if ($("#openingTitleEnabled")) $("#openingTitleEnabled").checked = sharedSubtitle.openingTitleEnabled === true;
    applyGenerationSettings(sharedGeneration);
    setValue("#scaleMin", sharedDedup.scaleMin); setValue("#scaleMax", sharedDedup.scaleMax); setValue("#rotateMin", sharedDedup.rotateMin); setValue("#rotateMax", sharedDedup.rotateMax); setValue("#mirrorChance", sharedDedup.mirrorChance); setValue("#sharpen", sharedDedup.sharpen); setValue("#speedMin", sharedDedup.speedMin); setValue("#speedMax", sharedDedup.speedMax);
    localStorage.setItem("reddit-mix-subtitle-settings", JSON.stringify(sharedSubtitle));
    localStorage.setItem("reddit-mix-generation-settings", JSON.stringify(sharedGeneration));
    localStorage.setItem("reddit-mix-dedup-settings", JSON.stringify(sharedDedup));
  } catch (error) {
    setCreateStatus(`统一配置读取失败，当前使用本机配置：${error.message || "请求失败"}`);
  }
}

async function persistOpeningTitleSetting() {
  const subtitle = collectSubtitleSettings();
  localStorage.setItem("reddit-mix-subtitle-settings", JSON.stringify(subtitle));
  try {
    await saveSharedRedditSettings({ subtitle });
    setRulesSaveStatus(`开头标题已${subtitle.openingTitleEnabled ? "开启" : "关闭"}并保存，下次打开仍用这个勾选。`);
  } catch {
    setRulesSaveStatus("开头标题已保存在本机，统一配置同步失败。");
  }
}

async function saveSharedRedditSettings(payload) {
  const response = await fetch("/api/reddit-mix/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存统一配置失败。");
  return data.settings;
}

function setDefaultSchedule() { const date = new Date(Date.now() + 30 * 60 * 1000); date.setSeconds(0, 0); $("#scheduleAt").value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
function statusLabel(status) { return ({ queued: "排队中", running: "执行中", generating: "生成中", publishing: "发布中", retry_wait: "等待重试", retrying: "正在重试", done: "已完成", failed: "执行失败", needs_attention: "待人工处理", awaiting_review: "等待确认发布", canceled: "已停止" })[status] || status; }
function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : ""; }
function number(selector, fallback) { const value = Number($(selector)?.value); return Number.isFinite(value) ? value : fallback; }
function setValue(selector, value) { if (value !== undefined && value !== null && value !== "" && $(selector)) $(selector).value = value; }
function readStored(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function setCreateStatus(text) { createStatus.textContent = text; }
function assetCount(group) {
  return Number(group?.totalAssets ?? group?.clipCount ?? group?.assetCount ?? group?.videoCount ?? group?.assets?.length) || 0;
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
