const $ = (selector) => document.querySelector(selector);
const taskList = $("#taskList");
const createStatus = $("#createStatus");
const createTaskBtn = $("#createTaskBtn");
const phoneList = $("#phoneList");
const phoneStatus = $("#phoneStatus");
const groupFilter = $("#groupFilter");
const nameFilter = $("#nameFilter");
let phones = [];
let assetGroups = [];
let pollTimer = null;
let captionPresets = [];
const captionPresetStorageKey = "reddit-publish-caption-presets";
const selectedCaptionPresetKey = "reddit-publish-caption-selected";

$("#createTaskBtn").addEventListener("click", createTask);
$("#refreshTasksBtn").addEventListener("click", loadTasks);
$("#refreshPhonesBtn").addEventListener("click", loadPhones);
$("#selectVisibleBtn").addEventListener("click", selectVisible);
$("#saveDedupBtn").addEventListener("click", saveDedupSettings);
$("#captionPresetSelect").addEventListener("change", selectCaptionPreset);
$("#addCaptionPresetBtn").addEventListener("click", addCaptionPreset);
$("#updateCaptionPresetBtn").addEventListener("click", updateCaptionPreset);
$("#deleteCaptionPresetBtn").addEventListener("click", deleteCaptionPreset);
$("#assetGroupSelect").addEventListener("change", updateVideoSourceVisibility);
$("#refreshSharedLibrariesBtn")?.addEventListener("click", loadSharedLibraries);
$("#sharedVideoLibrary")?.addEventListener("change", applySharedLibrarySelection);
$("#sharedAudioLibrary")?.addEventListener("change", applySharedLibrarySelection);
$("#sharedMusicLibrary")?.addEventListener("change", applySharedLibrarySelection);
groupFilter.addEventListener("change", filterPhones);
nameFilter.addEventListener("input", filterPhones);
attachDirectoryPickers();
loadSavedSettings();
applyIncomingAudioBatch();
loadCaptionPresets();
setDefaultSchedule();
loadAssetGroups();
loadSharedLibraries();
loadPhones();
loadTasks();

function applyIncomingAudioBatch() {
  const params = new URLSearchParams(location.search);
  const audioDir = params.get("audioDir");
  if (!audioDir || params.get("source") !== "audio-library") return;
  const count = Math.max(1, Number(params.get("count")) || 1);
  $("#audioDir").value = audioDir;
  $("#taskName").value = `音频库 Reddit 任务 ${new Date().toLocaleDateString("zh-CN")}`;
  $("#totalVideos").value = String(count);
  setCreateStatus(`已从音频素材库载入 ${count} 条音频，请继续选择素材组和发布账号。`);
  history.replaceState({}, "", "/tasks");
}

async function createTask() {
  const selected = Array.from(phoneList.querySelectorAll(".geelark-phone-check:checked"));
  const autoPublish = $("#autoPublish").checked;
  const materialSource = $("#assetGroupSelect")?.value || "";
  const assetGroupId = materialSource === "__manual__" ? "" : materialSource;
  if ((!assetGroupId && !$("#videoDir").value.trim()) || !$("#audioDir").value.trim()) return setCreateStatus("请选择素材组或视频素材目录，并选择音频目录。");
  if (autoPublish && !selected.length) return setCreateStatus("自动发布任务至少需要选择一个 GeeLark 账号。");
  const accounts = selected.map((input) => {
    const phone = phones.find((item) => String(item.id) === input.value) || {};
    return { id: input.value, name: phone.serialName || "", serialNo: phone.serialNo || "", groupName: phone.groupName || "", remark: phone.remark || "" };
  });
  const schedule = $("#scheduleAt").value ? Math.floor(new Date($("#scheduleAt").value).getTime() / 1000) : Math.floor(Date.now() / 1000) + 600;
  if (autoPublish && schedule < Math.floor(Date.now() / 1000) + 300) return setCreateStatus("自动发布的起始时间至少需要晚于当前时间 5 分钟。");
  const payload = {
    name: $("#taskName").value.trim(),
    generation: {
      assetGroupId,
      videoDir: $("#videoDir").value.trim(), includeVideoSubfolders: true,
      audioDir: $("#audioDir").value.trim(), backgroundMusicDir: $("#musicDir").value.trim(), saveDir: "",
      segmentMode: "fixed", segmentSeconds: number("#segmentSeconds", 5), totalVideos: number("#totalVideos", 40),
      subtitleYPercent: number("#subtitleY", 66), subtitleFontSize: number("#subtitleSize", 62), subtitleAnimationMode: $("#subtitleMode").value,
      quality: $("#quality").value, autoCaptions: $("#autoCaptions").checked, dedup: collectDedup()
    },
    publish: {
      autoPublish, envIds: selected.map((input) => input.value), accounts, videoDesc: $("#videoDesc").value,
      scheduleAt: schedule, intervalMinutes: number("#intervalMinutes", 15), batchPublishLimit: number("#batchLimit", 300), dailyPublishLimit: number("#dailyLimit", 300)
    }
  };
  createTaskBtn.disabled = true;
  setCreateStatus("正在创建任务...");
  try {
    const response = await fetch("/api/auto-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败。");
    setCreateStatus(`已加入队列：${data.task.name}`);
    createTaskBtn.disabled = false;
    void loadTasks();
  } catch (error) {
    setCreateStatus(error.message || "创建任务失败。");
  } finally {
    createTaskBtn.disabled = false;
  }
}

async function loadTasks() {
  clearTimeout(pollTimer);
  try {
    const [tasksResponse, safetyResponse] = await Promise.all([fetch(`/api/auto-tasks?t=${Date.now()}`), fetch(`/api/geelark/safety?t=${Date.now()}`)]);
    const data = await tasksResponse.json();
    const safety = await safetyResponse.json();
    if (!tasksResponse.ok) throw new Error(data.error || "读取任务失败。");
    $("#safetySummary").textContent = `今日已提交排期 ${safety.scheduledToday || 0}/${safety.defaultDailyLimit || 300}，待核实 ${safety.uncertainCount || 0}，成片保留 ${data.worker?.retentionHours || 48} 小时`;
    renderTasks((data.tasks || []).filter((task) => task.taskType !== "psychology"));
  } catch (error) {
    taskList.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "读取任务失败。")}</div>`;
  }
  pollTimer = setTimeout(loadTasks, 2500);
}

function renderTasks(tasks) {
  updateQueueMetrics(tasks);
  if (!tasks.length) {
    taskList.innerHTML = '<div class="empty-state"><strong>队列为空</strong><span>创建任务后会在这里显示实时进度</span></div>';
    return;
  }
  const queuedTasks = tasks.filter((task) => task.status === "queued").sort((a, b) => {
    const scheduleDifference = Number(a.publish?.scheduleAt || 0) - Number(b.publish?.scheduleAt || 0);
    return scheduleDifference || Number(a.createdAt) - Number(b.createdAt);
  });
  const queuedPositions = new Map(queuedTasks.map((task, index) => [task.id, index]));
  const activeCount = tasks.some((task) => task.status === "running") ? 1 : 0;
  taskList.innerHTML = tasks.map((task) => {
    const progress = task.phase === "publishing" || task.phase === "retrying" ? task.publishProgress : task.progress;
    const current = Number(progress?.current) || 0;
    const total = Number(progress?.total) || 0;
    const percent = total > 0 ? Math.round(current / total * 100) : Number(progress?.percent) || 0;
    const failures = (task.publishResults || []).filter((item) => item.status === "failed" || item.status === "needs_check");
    const scheduleLines = buildTaskScheduleLines(task);
    const scheduleHtml = scheduleLines.length
      ? `<div class="task-schedule"><strong>具体排期</strong>${scheduleLines.map((item) => `<span><b>${escapeHtml(formatScheduleAt(item.scheduleAt))}</b><em>${item.count} 条</em></span>`).join("")}</div>`
      : "";
    const actions = ["running", "queued"].includes(task.status)
      ? `<button class="secondary-btn" data-action="cancel" data-id="${escapeAttr(task.id)}">停止</button>`
      : ["failed", "paused", "awaiting_review"].includes(task.status)
        ? `<button class="secondary-btn" data-action="resume" data-id="${escapeAttr(task.id)}">继续执行</button>` : "";
    const failureHtml = failures.length ? `<div class="manual-items"><strong>待人工处理</strong>${failures.map((item) => `<div class="manual-item"><span>${escapeHtml(item.fileName)}<small>${escapeHtml(item.message || item.status)}</small></span><button data-action="retry" data-task-id="${escapeAttr(task.id)}" data-record-id="${escapeAttr(item.recordId)}">重新发布</button></div>`).join("")}</div>` : "";
    const queueAhead = task.status === "queued" ? activeCount + (queuedPositions.get(task.id) || 0) : 0;
    const taskMessage = task.status === "queued"
      ? queueAhead > 0
        ? `排队等待中，前方 ${queueAhead} 个任务；完成后会自动开始。`
        : "即将开始生成。"
      : task.message || "等待执行";
    return `<article class="auto-task-item" data-status="${escapeAttr(task.status)}">
      <div class="task-item-head"><div><strong>${escapeHtml(task.name)}</strong><small>${formatTime(task.createdAt)}</small></div><div class="task-head-actions"><span class="task-status-badge">${escapeHtml(statusLabel(task.status))}</span>${actions}</div></div>
      <div class="task-progress"><div style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>
      <p>${escapeHtml(taskMessage)}</p>
      <div class="task-counts">${Number(task.failedVideoCount) > 0 ? `<span>???? ${Number(task.failedVideoCount)} ?</span>` : ""}<span>预计 ${task.expectedVideoCount || task.generatedVideos?.length || 0} 条</span><span>生成 ${task.generatedVideos?.length || 0} 条</span><span>发布成功 ${task.publishSummary?.submitted || 0}</span><span>安全跳过 ${task.publishSummary?.skipped || 0}</span><span>失败 ${task.publishSummary?.failed || 0}</span></div>
      ${scheduleHtml}${task.error ? `<div class="task-error">${escapeHtml(task.error)}</div>` : ""}${failureHtml}
    </article>`;
  }).join("");
  taskList.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", handleTaskAction));
}

async function handleTaskAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === "retry") {
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

async function loadAssetGroups() {
  const select = $("#assetGroupSelect");
  const hint = $("#assetGroupHint");
  if (!select) return;
  try {
    const response = await fetch(`/api/asset-groups?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取素材组失败。");
    assetGroups = Array.isArray(data.groups) ? data.groups : [];
    select.innerHTML = `<option value="">请选择一个素材组</option>${assetGroups.map((group) => `<option value="${escapeAttr(group.id)}">${escapeHtml(group.name || group.id)}（${Number(group.totalAssets ?? group.assets?.length) || 0} 条）</option>`).join("")}`;
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
      $("#directAudioSource").hidden = false;
      $("#directMusicSource").hidden = false;
      return;
    }
    const libraries = data.libraries || [];
    panel.hidden = false;
    $("#directAudioSource").hidden = true;
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
  } catch (error) {
    panel.hidden = true;
    if (hint) hint.textContent = error.message || "共享素材库读取失败。";
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
  if (targetId === "sharedAudioLibrary") $("#audioDir").value = $("#sharedAudioLibrary")?.value || "";
  if (targetId === "sharedMusicLibrary") $("#musicDir").value = $("#sharedMusicLibrary")?.value || "";
}

function updateVideoSourceVisibility() {}

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
  const accountCount = Array.isArray(task.publish.envIds) ? task.publish.envIds.length : 0;
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
      if (data.path) input.value = data.path;
    } finally { button.disabled = false; }
  }));
}

function collectDedup() {
  const saved = readStored("reddit-mix-dedup-settings");
  return { enabled: true, ...saved, scaleMin: number("#scaleMin", 1.03), scaleMax: number("#scaleMax", 1.08), rotateMin: number("#rotateMin", -0.8), rotateMax: number("#rotateMax", 0.8), mirrorChance: number("#mirrorChance", 30), sharpen: number("#sharpen", 0.2), speedMin: number("#speedMin", 0.96), speedMax: number("#speedMax", 1.04) };
}

async function saveDedupSettings() {
  const dedup = collectDedup();
  localStorage.setItem("reddit-mix-dedup-settings", JSON.stringify(dedup));
  const status = $("#dedupSaveStatus");
  try {
    await saveSharedRedditSettings({ dedup });
    if (status) status.textContent = `已统一保存 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  } catch (error) {
    if (status) status.textContent = `本机已保存，同步失败：${error.message || "请求失败"}`;
  }
}

function loadCaptionPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(captionPresetStorageKey) || "[]");
    captionPresets = Array.isArray(saved) ? saved.filter((item) => item && item.id && String(item.text || "").trim()) : [];
  } catch {
    captionPresets = [];
  }
  renderCaptionPresets(localStorage.getItem(selectedCaptionPresetKey) || "");
}

function renderCaptionPresets(selectedId = "") {
  const select = $("#captionPresetSelect");
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
  const hasSelection = Boolean($("#captionPresetSelect").value);
  $("#updateCaptionPresetBtn").disabled = !hasSelection;
  $("#deleteCaptionPresetBtn").disabled = !hasSelection;
}

function captionPresetLabel(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
}

function setCaptionPresetStatus(message, isWarning = false) {
  const status = $("#captionPresetStatus");
  status.textContent = message;
  status.style.color = isWarning ? "var(--task-amber)" : "var(--task-muted)";
}

async function loadSavedSettings() {
  const subtitle = readStored("reddit-mix-subtitle-settings");
  setValue("#subtitleY", subtitle.yPercent); setValue("#subtitleSize", subtitle.fontSize); setValue("#subtitleMode", subtitle.animationMode);
  const dedup = readStored("reddit-mix-dedup-settings");
  setValue("#scaleMin", dedup.scaleMin); setValue("#scaleMax", dedup.scaleMax); setValue("#rotateMin", dedup.rotateMin); setValue("#rotateMax", dedup.rotateMax); setValue("#mirrorChance", dedup.mirrorChance); setValue("#sharpen", dedup.sharpen); setValue("#speedMin", dedup.speedMin); setValue("#speedMax", dedup.speedMax);
  try {
    const response = await fetch("/api/reddit-mix/settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取统一配置失败。");
    if (!data.exists) return;
    const sharedSubtitle = data.settings?.subtitle || {};
    const sharedDedup = data.settings?.dedup || {};
    setValue("#subtitleY", sharedSubtitle.yPercent); setValue("#subtitleSize", sharedSubtitle.fontSize); setValue("#subtitleMode", sharedSubtitle.animationMode);
    setValue("#scaleMin", sharedDedup.scaleMin); setValue("#scaleMax", sharedDedup.scaleMax); setValue("#rotateMin", sharedDedup.rotateMin); setValue("#rotateMax", sharedDedup.rotateMax); setValue("#mirrorChance", sharedDedup.mirrorChance); setValue("#sharpen", sharedDedup.sharpen); setValue("#speedMin", sharedDedup.speedMin); setValue("#speedMax", sharedDedup.speedMax);
    localStorage.setItem("reddit-mix-subtitle-settings", JSON.stringify(sharedSubtitle));
    localStorage.setItem("reddit-mix-dedup-settings", JSON.stringify(sharedDedup));
  } catch (error) {
    setCreateStatus(`统一配置读取失败，当前使用本机配置：${error.message || "请求失败"}`);
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
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
