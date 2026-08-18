const $ = (selector) => document.querySelector(selector);
const startBtn = $("#startBtn");
const stopBtn = $("#stopBtn");
const preprocessBtn = $("#preprocessBtn");
const assetModes = Array.from(document.querySelectorAll('[name="assetMode"]'));
const assetGroupName = $("#assetGroupName");
const assetInputDir = $("#assetInputDir");
const assetOutputField = $("#assetOutputField");
const assetOutputDir = $("#assetOutputDir");
const assetMinSeconds = $("#assetMinSeconds");
const assetMaxSeconds = $("#assetMaxSeconds");
const sourceLimitSeconds = $("#sourceLimitSeconds");
const cutSettings = $("#cutSettings");
const assetGroupSelect = $("#assetGroupSelect");
const assetGroupStats = $("#assetGroupStats");
const videoDir = $("#videoDir");
const includeVideoSubfolders = $("#includeVideoSubfolders");
const audioDir = $("#audioDir");
const backgroundMusicDir = $("#backgroundMusicDir");
const saveDir = $("#saveDir");
const segmentModes = Array.from(document.querySelectorAll('[name="segmentMode"]'));
const fixedSecondsField = $("#fixedSecondsField");
const ratioField = $("#ratioField");
const segmentSeconds = $("#segmentSeconds");
const segmentRatio = $("#segmentRatio");
const totalVideos = $("#totalVideos");
const subtitleYPercent = $("#subtitleYPercent");
const subtitleFontSize = $("#subtitleFontSize");
const subtitleAnimationMode = $("#subtitleAnimationMode");
const saveSubtitleSettingsBtn = $("#saveSubtitleSettingsBtn");
const quality = $("#quality");
const autoCaptions = $("#autoCaptions");
const dedupEnabled = $("#dedupEnabled");
const dedupScaleMin = $("#dedupScaleMin");
const dedupScaleMax = $("#dedupScaleMax");
const dedupRotateMin = $("#dedupRotateMin");
const dedupRotateMax = $("#dedupRotateMax");
const dedupBrightnessMin = $("#dedupBrightnessMin");
const dedupBrightnessMax = $("#dedupBrightnessMax");
const dedupContrastMin = $("#dedupContrastMin");
const dedupContrastMax = $("#dedupContrastMax");
const dedupSaturationMin = $("#dedupSaturationMin");
const dedupSaturationMax = $("#dedupSaturationMax");
const dedupMirrorChance = $("#dedupMirrorChance");
const dedupSharpen = $("#dedupSharpen");
const dedupSpeedMin = $("#dedupSpeedMin");
const dedupSpeedMax = $("#dedupSpeedMax");
const dedupOverlayDir = $("#dedupOverlayDir");
const dedupOverlayOpacity = $("#dedupOverlayOpacity");
const dedupOverlayCount = $("#dedupOverlayCount");
const saveDedupSettingsBtn = $("#saveDedupSettingsBtn");
const dedupStatus = $("#dedupStatus");
const statusEl = $("#status");
const progressBox = $("#progressBox");
const progressText = $("#progressText");
const progressStage = $("#progressStage");
const progressFill = $("#progressFill");
const resultVideo = $("#resultVideo");
const downloadLink = $("#downloadLink");
const batchResults = $("#batchResults");
const resultList = $("#resultList");
const downloadSelectedBtn = $("#downloadSelectedBtn");
const publishPanel = $("#publishPanel");
const refreshPublishAccountsBtn = $("#refreshPublishAccountsBtn");
const publishProvider = $("#publishProvider");
const geelarkPublishAccounts = $("#geelarkPublishAccounts");
const officialPublishAccounts = $("#officialPublishAccounts");
const selectVisibleGeeLarkBtn = $("#selectVisibleGeeLarkBtn");
const geelarkStatus = $("#geelarkStatus");
const geelarkPhoneList = $("#geelarkPhoneList");
const geelarkGroupFilter = $("#geelarkGroupFilter");
const geelarkNameFilter = $("#geelarkNameFilter");
const officialTikTokStatus = $("#officialTikTokStatus");
const officialTikTokAccountList = $("#officialTikTokAccountList");
const selectAllOfficialTikTokBtn = $("#selectAllOfficialTikTokBtn");
const publishDesc = $("#publishDesc");
const publishTime = $("#publishTime");
const publishIntervalMinutes = $("#publishIntervalMinutes");
const publishSelectedBtn = $("#publishSelectedBtn");
const publishResult = $("#publishResult");
const redditHelp = $("#redditHelp");
const redditHelpToggle = $("#redditHelpToggle");
const redditHelpClose = $("#redditHelpClose");

let pollTimer = null;
let currentJobId = "";
let currentJobType = "";
let knownResultUrls = new Set();
let assetGroups = [];
let assetUsage = {};
let geelarkPhones = [];
let officialTikTokAccounts = [];
const dedupStorageKey = "reddit-mix-dedup-settings";
const subtitleStorageKey = "reddit-mix-subtitle-settings";

startBtn.addEventListener("click", startMix);
stopBtn.addEventListener("click", stopCurrentJob);
preprocessBtn?.addEventListener("click", startAssetPreprocess);
assetModes.forEach((input) => input.addEventListener("change", updateAssetMode));
segmentModes.forEach((input) => input.addEventListener("change", updateSegmentMode));
assetGroupSelect?.addEventListener("change", renderAssetStats);
downloadSelectedBtn.addEventListener("click", downloadSelected);
refreshPublishAccountsBtn?.addEventListener("click", refreshPublishAccounts);
publishProvider?.addEventListener("change", updatePublishProvider);
selectVisibleGeeLarkBtn?.addEventListener("click", selectVisibleGeeLarkPhones);
selectAllOfficialTikTokBtn?.addEventListener("click", selectAllOfficialTikTokAccounts);
geelarkGroupFilter?.addEventListener("change", renderGeeLarkPhones);
geelarkNameFilter?.addEventListener("input", renderGeeLarkPhones);
publishSelectedBtn?.addEventListener("click", publishSelectedVideos);
redditHelpToggle?.addEventListener("click", () => setHelpOpen(redditHelp?.dataset.open !== "true"));
redditHelpClose?.addEventListener("click", () => setHelpOpen(false));
saveDedupSettingsBtn?.addEventListener("click", saveDedupSettings);
saveSubtitleSettingsBtn?.addEventListener("click", saveSubtitleSettings);
[subtitleYPercent, subtitleFontSize, subtitleAnimationMode, $("#openingTitleEnabled")].forEach((input) => input?.addEventListener("change", saveSubtitleSettings));

downloadLink.classList.remove("is-visible");
attachDirectoryPickers();
updateAssetMode();
updateSegmentMode();
loadSubtitleSettings();
loadDedupSettings();
loadSharedRedditSettings();
setHelpOpen(localStorage.getItem("reddit-help-open") === "true");
updatePublishProvider();
loadAssetGroups();

function attachDirectoryPickers() {
  document.querySelectorAll("[data-pick-directory]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.pickDirectory);
      if (!target) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "Picking...";
      try {
        const response = await fetch("/api/select-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initialPath: target.value.trim(),
            title: "Select folder"
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to open folder picker.");
        if (data.path) {
          target.value = data.path;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (error) {
        setStatus(error.message || "Failed to open folder picker.");
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

function setHelpOpen(open) {
  if (!redditHelp || !redditHelpToggle) return;
  redditHelp.dataset.open = open ? "true" : "false";
  redditHelpToggle.setAttribute("aria-expanded", open ? "true" : "false");
  localStorage.setItem("reddit-help-open", open ? "true" : "false");
}

async function startAssetPreprocess() {
  const payload = {
    mode: getAssetMode(),
    groupName: assetGroupName.value.trim(),
    inputDir: assetInputDir.value.trim(),
    outputDir: assetOutputDir.value.trim(),
    minSeconds: Number(assetMinSeconds.value) || 45,
    maxSeconds: Number(assetMaxSeconds.value) || 75,
    sourceLimitSeconds: Number(sourceLimitSeconds.value) || 0,
    quality: quality.value,
    width: 1080,
    height: 1920,
    fps: 30
  };
  if (!payload.groupName) return setStatus("请输入素材组名称。");
  if (!payload.inputDir) return setStatus("请输入输入素材文件夹。");
  if (payload.mode === "cut" && !payload.outputDir) return setStatus("请输入输出素材组文件夹。");

  preprocessBtn.disabled = true;
  showProgress(1, "提交素材组任务...");
  try {
    const response = await fetch("/api/asset-groups/preprocess/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    currentJobId = data.jobId;
    currentJobType = "asset";
    stopBtn.hidden = false;
    pollProgress();
  } catch (error) {
    preprocessBtn.disabled = false;
    hideProgress();
    setStatus(error.message || "Task failed.");
  }
}

async function startMix() {
  const payload = collectMixPayload();
  if (!payload.audioDir) return setStatus("请输入音频文件夹路径。");
  if (!payload.videoDir && !payload.assetGroupId) return setStatus("请选择素材组或视频素材目录。");

  resetResults();
  startBtn.disabled = true;
  stopBtn.hidden = false;
  showProgress(1, "提交混剪任务...");
  try {
    const response = await fetch("/api/reddit-mix/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    currentJobId = data.jobId;
    currentJobType = "mix";
    pollProgress();
  } catch (error) {
    finishJobUi();
    hideProgress();
    setStatus(error.message || "Task failed.");
  }
}

async function stopCurrentJob() {
  if (!currentJobId) return;
  const type = currentJobType;
  stopBtn.disabled = true;
  setStatus("正在停止任务...");
  const url = type === "asset"
    ? `/api/asset-groups/preprocess/cancel/${encodeURIComponent(currentJobId)}`
    : `/api/reddit-mix/cancel/${encodeURIComponent(currentJobId)}`;
  try {
    await fetch(url, { method: "POST" });
  } catch {
    // Ignore; polling may already have stopped.
  }
  clearPoll();
  finishJobUi();
  hideProgress();
}

async function pollProgress() {
  clearPoll();
  const tick = async () => {
    if (!currentJobId) return;
    try {
      const base = currentJobType === "asset" ? "/api/asset-groups/preprocess/progress" : "/api/reddit-mix/progress";
      const response = await fetch(`${base}/${encodeURIComponent(currentJobId)}?t=${Date.now()}`);
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "读取进度失败。");
      showJobProgress(job);
      if (currentJobType === "mix") renderResults(job.results || []);

      if (job.status === "done") {
        setStatus(job.message || "任务完成。");
        clearPoll();
        finishJobUi();
        showProgress(100, "完成");
        return;
      }
      if (job.status === "failed" || job.status === "canceled") {
        setStatus(job.message || "任务已结束。");
        clearPoll();
        finishJobUi();
        return;
      }
    } catch (error) {
      setStatus(error.message || "Task failed.");
    }
    pollTimer = window.setTimeout(tick, 1500);
  };
  tick();
}

async function loadAssetGroups() {
  if (!assetGroupSelect || !assetGroupStats) return;
  try {
    const response = await fetch(`/api/asset-groups?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    assetGroups = data.groups || [];
    assetUsage = data.usage || {};
    const current = assetGroupSelect.value;
    assetGroupSelect.innerHTML = assetGroups.length
      ? assetGroups.map((group) => `<option value="${escapeAttr(group.id)}">${escapeHtml(group.name || group.id)}（${assetCount(group)} 条）</option>`).join("")
      : `<option value="">先生成或导入素材组</option>`;
    if (assetGroups.some((group) => group.id === current)) assetGroupSelect.value = current;
    renderAssetStats();
  } catch (error) {
    assetGroupStats.textContent = error.message || "读取素材组失败。";
  }
}

function renderAssetStats() {
  if (!assetGroupSelect || !assetGroupStats) return;
  const group = assetGroups.find((item) => item.id === assetGroupSelect.value);
  if (!group) {
    assetGroupStats.textContent = "素材组统计会显示在这里。";
    return;
  }
  const assets = Array.isArray(group.assets) ? group.assets : [];
  const usedCount = Number(group.usedAssets) || assets.filter((asset) => assetUsage.assets?.[asset.id]?.usedCount > 0).length;
  const totalUsed = assets.reduce((sum, asset) => sum + (assetUsage.assets?.[asset.id]?.usedCount || 0), 0);
  assetGroupStats.textContent = `素材组：${group.name || group.id}｜素材 ${assetCount(group)} 条｜总时长 ${formatDuration(group.totalDuration || 0)}｜已用素材 ${usedCount} 条｜片段使用 ${totalUsed} 次｜生成视频 ${group.generatedVideos || 0} 条`;
}

function collectMixPayload() {
  return {
    videoDir: videoDir.value.trim(),
    includeVideoSubfolders: includeVideoSubfolders.checked,
    audioDir: audioDir.value.trim(),
    backgroundMusicDir: backgroundMusicDir.value.trim(),
    backgroundMusicVolume: 0.12,
    saveDir: saveDir.value.trim(),
    assetGroupId: assetGroupSelect?.value || "",
    segmentMode: getSegmentMode(),
    segmentSeconds: Number(segmentSeconds.value) || 5,
    segmentRatio: Number(segmentRatio.value) || 10,
    totalVideos: Number(totalVideos.value) || 1,
    subtitleYPercent: Number(subtitleYPercent.value) || 66,
    subtitleFontSize: Number(subtitleFontSize.value) || 62,
    subtitleAnimationMode: subtitleAnimationMode?.value || "sentence",
    quality: quality.value,
    autoCaptions: autoCaptions.checked,
    openingTitleEnabled: $("#openingTitleEnabled")?.checked === true,
    dedup: collectDedupSettings()
  };
}

function collectSubtitleSettings() {
  return {
    yPercent: numberValue(subtitleYPercent, 66),
    fontSize: numberValue(subtitleFontSize, 62),
    animationMode: subtitleAnimationMode?.value || "sentence",
    openingTitleEnabled: $("#openingTitleEnabled")?.checked === true
  };
}

function loadSubtitleSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(subtitleStorageKey) || "{}");
    applySubtitleSettings(saved);
  } catch {
    // Keep defaults.
  }
}

async function saveSubtitleSettings() {
  const subtitle = collectSubtitleSettings();
  localStorage.setItem(subtitleStorageKey, JSON.stringify(subtitle));
  try {
    await saveSharedRedditSettings({ subtitle });
    setStatus("字幕位置和样式已统一保存，自动任务页面会同步使用。");
  } catch (error) {
    setStatus(`本机已保存，但同步自动任务失败：${error.message || "请求失败"}`);
  }
}

function applySubtitleSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  setInputValue(subtitleYPercent, settings.yPercent);
  setInputValue(subtitleFontSize, settings.fontSize);
  if (subtitleAnimationMode && settings.animationMode) subtitleAnimationMode.value = settings.animationMode;
  if ($("#openingTitleEnabled")) $("#openingTitleEnabled").checked = settings.openingTitleEnabled === true;
}

function collectDedupSettings() {
  return {
    enabled: Boolean(dedupEnabled?.checked),
    scaleMin: numberValue(dedupScaleMin, 1.03),
    scaleMax: numberValue(dedupScaleMax, 1.08),
    rotateMin: numberValue(dedupRotateMin, -0.8),
    rotateMax: numberValue(dedupRotateMax, 0.8),
    brightnessMin: numberValue(dedupBrightnessMin, -0.03),
    brightnessMax: numberValue(dedupBrightnessMax, 0.04),
    contrastMin: numberValue(dedupContrastMin, 0.96),
    contrastMax: numberValue(dedupContrastMax, 1.06),
    saturationMin: numberValue(dedupSaturationMin, 0.95),
    saturationMax: numberValue(dedupSaturationMax, 1.12),
    mirrorChance: numberValue(dedupMirrorChance, 30),
    sharpen: numberValue(dedupSharpen, 0.2),
    speedMin: numberValue(dedupSpeedMin, 0.96),
    speedMax: numberValue(dedupSpeedMax, 1.04),
    overlayDir: dedupOverlayDir?.value.trim() || "",
    overlayOpacity: numberValue(dedupOverlayOpacity, 0.01),
    overlayCount: numberValue(dedupOverlayCount, 0)
  };
}

function loadDedupSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(dedupStorageKey) || "{}");
    applyDedupSettings(saved);
  } catch {
    // Keep defaults.
  }
}

async function saveDedupSettings() {
  const settings = collectDedupSettings();
  localStorage.setItem(dedupStorageKey, JSON.stringify(settings));
  try {
    await saveSharedRedditSettings({ dedup: settings });
    if (dedupStatus) dedupStatus.textContent = "素材去重参数已统一保存，手动生成和自动任务都会使用这组值。";
  } catch (error) {
    if (dedupStatus) dedupStatus.textContent = `本机已保存，但同步自动任务失败：${error.message || "请求失败"}`;
  }
}

async function loadSharedRedditSettings() {
  try {
    const response = await fetch("/api/reddit-mix/settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取统一配置失败。");
    if (data.exists) {
      applySubtitleSettings(data.settings?.subtitle);
      applyDedupSettings(data.settings?.dedup);
      localStorage.setItem(subtitleStorageKey, JSON.stringify(data.settings?.subtitle || {}));
      localStorage.setItem(dedupStorageKey, JSON.stringify(data.settings?.dedup || {}));
      return;
    }
    await saveSharedRedditSettings({ subtitle: collectSubtitleSettings(), dedup: collectDedupSettings() });
  } catch (error) {
    setStatus(`统一配置读取失败，当前继续使用本机配置：${error.message || "请求失败"}`);
  }
}

async function saveSharedRedditSettings(payload) {
  const response = await fetch("/api/reddit-mix/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存统一配置失败。");
  return data.settings;
}

function applyDedupSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  if (dedupEnabled && typeof settings.enabled === "boolean") dedupEnabled.checked = settings.enabled;
  setInputValue(dedupScaleMin, settings.scaleMin);
  setInputValue(dedupScaleMax, settings.scaleMax);
  setInputValue(dedupRotateMin, settings.rotateMin);
  setInputValue(dedupRotateMax, settings.rotateMax);
  setInputValue(dedupBrightnessMin, settings.brightnessMin);
  setInputValue(dedupBrightnessMax, settings.brightnessMax);
  setInputValue(dedupContrastMin, settings.contrastMin);
  setInputValue(dedupContrastMax, settings.contrastMax);
  setInputValue(dedupSaturationMin, settings.saturationMin);
  setInputValue(dedupSaturationMax, settings.saturationMax);
  setInputValue(dedupMirrorChance, settings.mirrorChance);
  setInputValue(dedupSharpen, settings.sharpen);
  setInputValue(dedupSpeedMin, settings.speedMin);
  setInputValue(dedupSpeedMax, settings.speedMax);
  setInputValue(dedupOverlayDir, settings.overlayDir);
  setInputValue(dedupOverlayOpacity, settings.overlayOpacity);
  setInputValue(dedupOverlayCount, settings.overlayCount);
}

function setInputValue(input, value) {
  if (!input || value === undefined || value === null || value === "") return;
  input.value = String(value);
}

function numberValue(input, fallback) {
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : fallback;
}

function renderResults(results) {
  if (!results.length) return;
  batchResults.hidden = false;
  publishPanel.hidden = false;
  for (const item of results) {
    if (!item.videoUrl || knownResultUrls.has(item.videoUrl)) continue;
    knownResultUrls.add(item.videoUrl);
    addResultItem(item);
    showPreview(item);
  }
}

function addResultItem(item) {
  const fileName = item.fileName || decodeURIComponent(item.videoUrl.split("/").pop() || "reddit-mix.mp4");
  const row = document.createElement("div");
  row.className = "result-item";
  row.innerHTML = `
    <label class="result-main">
      <input class="result-check" type="checkbox" checked />
      <span>
        <strong>${escapeHtml(fileName)}</strong>
        <small>${escapeHtml(item.audioName || "")} · ${formatDuration(item.duration)} · ${escapeHtml(item.assetGroupName || "")} · 第 ${Number(item.variant) || 1} 版</small>
      </span>
    </label>
    <div class="result-actions">
      <button type="button" class="preview-result-btn">预览</button>
      <a class="mini-download" href="${escapeAttr(item.videoUrl)}" download="${escapeAttr(fileName)}">下载</a>
    </div>
  `;
  const checkbox = row.querySelector(".result-check");
  checkbox.dataset.url = item.videoUrl;
  checkbox.dataset.filename = fileName;
  checkbox.dataset.title = stripExtension(item.audioName || fileName);
  checkbox.dataset.audioName = item.audioName || "";
  checkbox.dataset.audioIndex = String(Number(item.audioIndex) || 0);
  checkbox.dataset.template = "reddit-mix";
  checkbox.dataset.templateIndex = "0";
  checkbox.dataset.templateLabel = "Reddit 混剪";
  checkbox.dataset.variant = String(Number(item.variant) || 1);
  row.querySelector(".preview-result-btn")?.addEventListener("click", () => showPreview(item));
  resultList.appendChild(row);
}

function showPreview(item) {
  resultVideo.src = item.videoUrl;
  resultVideo.load();
  downloadLink.href = item.videoUrl;
  downloadLink.download = item.fileName || "reddit-mix.mp4";
  downloadLink.classList.add("is-visible");
}

async function downloadSelected() {
  const checked = Array.from(resultList.querySelectorAll(".result-check:checked"));
  if (!checked.length) return setStatus("请先勾选要下载的视频。");
  for (const item of checked) {
    const link = document.createElement("a");
    link.href = item.dataset.url;
    link.download = item.dataset.filename || "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    await delay(350);
  }
  setStatus(`已触发 ${checked.length} 条视频下载。`);
}

async function loadGeeLarkPhones() {
  if (!geelarkPhoneList || !geelarkStatus) return;
  geelarkStatus.textContent = "正在读取 GeeLark 云手机...";
  geelarkPhoneList.innerHTML = "";
  try {
    const response = await fetch(`/api/geelark/phones?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    if (!data.configured) {
      geelarkStatus.textContent = "GeeLark API 未配置。";
      return;
    }
    geelarkPhones = data.phones || [];
    if (!geelarkPhones.length) {
      geelarkStatus.textContent = "没有读取到云手机。";
      return;
    }
    geelarkPhoneList.innerHTML = geelarkPhones.map((phone, index) => {
      const id = escapeHtml(phone.id || phone.envId || phone.phoneId || phone.serialNo || "");
      const name = escapeHtml(phone.serialName || phone.name || phone.deviceName || `云手机 ${index + 1}`);
      const groupName = escapeHtml(phone.group?.name || phone.groupName || "");
      return `<label class="geelark-phone-item"><input class="geelark-phone-check" type="checkbox" value="${id}" /><span><strong>${name}</strong><small>${groupName || id}</small></span></label>`;
    }).join("");
    updateGeeLarkFiltersFromDom();
  } catch (error) {
    geelarkStatus.textContent = error.message || "读取 GeeLark 云手机失败。";
  }
}

function selectedPublishProvider() {
  return publishProvider?.value === "official" ? "official" : "geelark";
}

async function updatePublishProvider() {
  const useOfficial = selectedPublishProvider() === "official";
  if (geelarkPublishAccounts) geelarkPublishAccounts.hidden = useOfficial;
  if (officialPublishAccounts) officialPublishAccounts.hidden = !useOfficial;
  setPublishResult("");
  if (useOfficial) await loadOfficialTikTokAccounts();
  else await loadGeeLarkPhones();
}

async function refreshPublishAccounts() {
  if (selectedPublishProvider() === "official") await loadOfficialTikTokAccounts();
  else await loadGeeLarkPhones();
}

async function loadOfficialTikTokAccounts() {
  if (!officialTikTokAccountList || !officialTikTokStatus) return;
  officialTikTokStatus.textContent = "正在读取线上已授权 TikTok 账号...";
  officialTikTokAccountList.innerHTML = "";
  try {
    const response = await fetch(`/api/official-tiktok/publish-accounts?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    const allAccounts = Array.isArray(data.accounts) ? data.accounts : [];
    officialTikTokAccounts = allAccounts.filter((account) => Array.isArray(account.scopes) && account.scopes.includes("video.publish"));
    if (!officialTikTokAccounts.length) {
      officialTikTokStatus.textContent = allAccounts.length
        ? "线上账号已连接，但没有账号包含 video.publish 发布权限，请重新授权后再试。"
        : "线上中台没有返回可发布的授权账号。";
      return;
    }
    officialTikTokAccountList.innerHTML = officialTikTokAccounts.map((account, index) => {
      const connectionId = escapeHtml(account.connectionId || account.id || "");
      const displayName = escapeHtml(account.displayName || account.username || `TikTok 账号 ${index + 1}`);
      const ownerEmail = escapeHtml(account.ownerEmail || "未标记归属邮箱");
      const username = escapeHtml(account.username ? `@${account.username}` : connectionId);
      return `<label class="geelark-phone-item"><input class="official-tiktok-account-check" type="checkbox" value="${connectionId}" /><span><strong>${displayName}</strong><small>${ownerEmail} · ${username}</small></span></label>`;
    }).join("");
    const skippedCount = allAccounts.length - officialTikTokAccounts.length;
    officialTikTokStatus.textContent = `已读取 ${officialTikTokAccounts.length} 个具有发布权限的账号${skippedCount ? `，已隐藏 ${skippedCount} 个无发布权限账号` : ""}；建议先选 1 个小范围测试。`;
  } catch (error) {
    officialTikTokStatus.textContent = error.message || "读取线上授权账号失败。";
  }
}

function selectAllOfficialTikTokAccounts() {
  if (!officialTikTokAccountList) return;
  const checkboxes = Array.from(officialTikTokAccountList.querySelectorAll(".official-tiktok-account-check"));
  const shouldSelect = checkboxes.some((item) => !item.checked);
  checkboxes.forEach((item) => { item.checked = shouldSelect; });
  setPublishResult(shouldSelect ? `已勾选 ${checkboxes.length} 个官方授权账号。` : "已取消全选官方授权账号。");
}

function updateGeeLarkFiltersFromDom() {
  if (!geelarkGroupFilter || !geelarkPhoneList) return;
  Array.from(geelarkPhoneList.querySelectorAll(".geelark-phone-item")).forEach((item, index) => {
    const phone = geelarkPhones[index] || {};
    item.dataset.searchText = [phone.id, phone.serialName, phone.serialNo, phone.groupName, phone.remark].filter(Boolean).join(" ").toLowerCase();
  });
  const groups = Array.from(geelarkPhoneList.querySelectorAll(".geelark-phone-item small"))
    .map((item) => item.textContent.trim()).filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  geelarkGroupFilter.innerHTML = `<option value="">全部分组</option>${groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("")}`;
  renderGeeLarkPhones();
}

function renderGeeLarkPhones() {
  const groupKeyword = (geelarkGroupFilter?.value || "").trim().toLowerCase();
  const nameKeyword = (geelarkNameFilter?.value || "").trim().toLowerCase();
  let visibleCount = 0;
  geelarkPhoneList.querySelectorAll(".geelark-phone-item").forEach((item) => {
    const group = item.querySelector("small")?.textContent.trim().toLowerCase() || "";
    const haystack = item.dataset.searchText || "";
    const visible = (!groupKeyword || group === groupKeyword) && (!nameKeyword || haystack.includes(nameKeyword));
    item.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  if (geelarkStatus && geelarkPhoneList.children.length) geelarkStatus.textContent = `已显示 ${visibleCount}/${geelarkPhoneList.children.length} 个 GeeLark 账号`;
}

function selectVisibleGeeLarkPhones() {
  if (!geelarkPhoneList) return;
  let selectedCount = 0;
  geelarkPhoneList.querySelectorAll(".geelark-phone-item").forEach((item) => {
    if (item.hidden) return;
    const checkbox = item.querySelector(".geelark-phone-check");
    if (!checkbox) return;
    checkbox.checked = true;
    selectedCount += 1;
  });
  setPublishResult(`已勾选当前筛选出的 ${selectedCount} 个 GeeLark 账号。`);
}

async function publishSelectedVideos() {
  const checkedVideos = Array.from(resultList.querySelectorAll(".result-check:checked"));
  if (!checkedVideos.length) return setPublishResult("请先勾选要发布的视频。");
  const videos = checkedVideos.map((item) => ({
    videoUrl: item.dataset.url,
    fileName: item.dataset.filename,
    title: item.dataset.title,
    audioName: item.dataset.audioName || "",
    audioIndex: Number(item.dataset.audioIndex) || 0,
    template: item.dataset.template || "reddit-mix",
    templateIndex: Number(item.dataset.templateIndex) || 0,
    templateLabel: item.dataset.templateLabel || "Reddit 混剪",
    variant: Number(item.dataset.variant) || 1
  }));
  const scheduleAt = publishTime?.value ? Math.floor(new Date(publishTime.value).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const intervalMinutes = Math.max(0, Number(publishIntervalMinutes?.value) || 0);

  if (selectedPublishProvider() === "official") {
    return publishSelectedVideosThroughOfficialApi(videos, scheduleAt, intervalMinutes);
  }

  const checkedPhones = Array.from(document.querySelectorAll(".geelark-phone-check:checked"));
  if (!checkedPhones.length) return setPublishResult("请先勾选 GeeLark 云手机账号。");
  const envIds = checkedPhones.map((item) => item.value).filter(Boolean);
  const accounts = checkedPhones.map((item) => {
    const row = item.closest(".geelark-phone-item");
    const phone = geelarkPhones.find((entry) => String(entry.id) === item.value) || {};
    return {
      id: item.value,
      name: row?.querySelector("strong")?.textContent.trim() || phone.serialName || "",
      serialNo: phone.serialNo || "",
      groupName: phone.groupName || row?.querySelector("small")?.textContent.trim() || "",
      remark: phone.remark || ""
    };
  });
  publishSelectedBtn.disabled = true;
  setPublishResult(`正在提交 ${videos.length} 条视频到 ${envIds.length} 个账号...`);
  try {
    const response = await fetch("/api/geelark/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videos, envIds, accounts, videoDesc: publishDesc?.value || "", scheduleAt, intervalMinutes })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    const taskCount = (data.results || []).reduce((sum, item) => sum + (item.taskIds || []).length, 0);
    setPublishResult(`已提交发布任务：${data.results?.length || 0} 个视频，${taskCount} 个任务。`);
  } catch (error) {
    setPublishResult(error.message || "GeeLark 发布失败。");
  } finally {
    publishSelectedBtn.disabled = false;
  }
}

async function publishSelectedVideosThroughOfficialApi(videos, scheduleAt, intervalMinutes) {
  const checkedAccounts = Array.from(document.querySelectorAll(".official-tiktok-account-check:checked"));
  const connectionIds = checkedAccounts.map((item) => item.value).filter(Boolean);
  if (!connectionIds.length) return setPublishResult("请先勾选线上已授权的 TikTok 账号。");

  publishSelectedBtn.disabled = true;
  setPublishResult(`正在通过 TikTok 官方 API 提交 ${videos.length} 条视频到 ${connectionIds.length} 个账号...`);
  try {
    const response = await fetch("/api/official-tiktok/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videos,
        connectionIds,
        videoDesc: publishDesc?.value || "",
        scheduleAt,
        intervalMinutes,
        name: "Local Factory Reddit 发布"
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    setPublishResult(`TikTok 官方 API 已创建 ${data.taskCount || 0} 个任务，共 ${data.batchCount || 0} 个批次。可到线上中台查看处理状态和最终视频 ID。`);
  } catch (error) {
    setPublishResult(error.message || "TikTok 官方 API 发布失败。");
  } finally {
    publishSelectedBtn.disabled = false;
  }
}

function updateAssetMode() {
  if (!assetOutputField || !cutSettings) return;
  const isCut = getAssetMode() === "cut";
  assetOutputField.hidden = !isCut;
  cutSettings.hidden = !isCut;
}

function updateSegmentMode() {
  const mode = getSegmentMode();
  fixedSecondsField.hidden = mode !== "fixed";
  ratioField.hidden = mode !== "ratio";
}

function getAssetMode() {
  return assetModes.find((input) => input.checked)?.value || "cut";
}

function getSegmentMode() {
  return segmentModes.find((input) => input.checked)?.value || "fixed";
}

function resetResults() {
  knownResultUrls = new Set();
  resultList.innerHTML = "";
  batchResults.hidden = true;
  publishPanel.hidden = true;
  resultVideo.removeAttribute("src");
  downloadLink.classList.remove("is-visible");
}

function finishJobUi() {
  currentJobId = "";
  currentJobType = "";
  startBtn.disabled = false;
  if (preprocessBtn) preprocessBtn.disabled = false;
  stopBtn.hidden = true;
  stopBtn.disabled = false;
}

function clearPoll() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function showJobProgress(job) {
  const percent = Number(job?.percent) || 1;
  const message = job?.message || "任务进行中...";
  const current = Number(job?.progressCurrent);
  const total = Number(job?.progressTotal);
  const countText = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? `生成 ${Math.max(0, Math.min(total, current))}/${total} ｜ `
    : "";
  showProgress(percent, `${countText}${message}`);
}

function showProgress(percent, stage) {
  progressBox.hidden = false;
  progressText.textContent = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  progressStage.textContent = stage;
  progressFill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  setStatus(stage);
}

function hideProgress() {
  progressBox.hidden = true;
  progressFill.style.width = "0%";
}

function setPublishResult(message) {
  if (publishResult) publishResult.textContent = message;
  setStatus(message);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function stripExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}

function assetCount(group) {
  return Number(group?.totalAssets ?? group?.clipCount ?? group?.assetCount ?? group?.videoCount ?? group?.assets?.length) || 0;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
