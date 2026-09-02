const generateBtn = document.querySelector("#generateBtn");
const stopBtn = document.querySelector("#stopBtn");
const statusEl = document.querySelector("#status");
const progressBox = document.querySelector("#progressBox");
const progressText = document.querySelector("#progressText");
const progressStage = document.querySelector("#progressStage");
const progressFill = document.querySelector("#progressFill");
const sourceModes = Array.from(document.querySelectorAll('[name="sourceMode"]'));
const titleField = document.querySelector("#titleField");
const titleText = document.querySelector("#titleText");
const scriptField = document.querySelector("#scriptField");
const scriptText = document.querySelector("#scriptText");
const aspect = document.querySelector("#aspect");
const templateChoices = Array.from(document.querySelectorAll('[name="templateChoice"]'));
const autoCaptions = document.querySelector("#autoCaptions");
const captionPositions = Array.from(document.querySelectorAll(".caption-position"));
const captionPositionToggle = document.querySelector("#captionPositionToggle");
const captionPositionContent = document.querySelector("#captionPositionContent");
const saveCaptionPositionsBtn = document.querySelector("#saveCaptionPositionsBtn");
const captionPreviewStage = document.querySelector("#captionPreviewStage");
const captionPreviewText = document.querySelector("#captionPreviewText");
const audioField = document.querySelector("#audioField");
const audioFile = document.querySelector("#audioFile");
const backgroundFile = document.querySelector("#backgroundFile");
const backgroundColor = document.querySelector("#backgroundColor");
const variantCount = document.querySelector("#variantCount");
const autoTtsCheck = document.querySelector("#autoTtsCheck");
const autoTts = document.querySelector("#autoTts");
const ttsPanel = document.querySelector("#ttsPanel");
const ttsProvider = document.querySelector("#ttsProvider");
const elevenLabsVoiceId = document.querySelector("#elevenLabsVoiceId");
const elevenLabsModelId = document.querySelector("#elevenLabsModelId");
const resultVideo = document.querySelector("#resultVideo");
const downloadLink = document.querySelector("#downloadLink");
const batchResults = document.querySelector("#batchResults");
const resultList = document.querySelector("#resultList");
const downloadSelectedBtn = document.querySelector("#downloadSelectedBtn");
const publishPanel = document.querySelector("#publishPanel");
const refreshOfficialAccountsBtn = document.querySelector("#refreshOfficialAccountsBtn");
const officialAccountStatus = document.querySelector("#officialAccountStatus");
const officialAccountList = document.querySelector("#officialAccountList");
const officialGroupFilter = document.querySelector("#officialGroupFilter");
const officialNameFilter = document.querySelector("#officialNameFilter");
const publishDesc = document.querySelector("#publishDesc");
const publishTime = document.querySelector("#publishTime");
const publishIntervalMinutes = document.querySelector("#publishIntervalMinutes");
const publishSelectedBtn = document.querySelector("#publishSelectedBtn");
const publishResult = document.querySelector("#publishResult");
const startUnsplashBtn = document.querySelector("#startUnsplashBtn");
const unsplashAccessKey = document.querySelector("#unsplashAccessKey");
const unsplashKeywords = document.querySelector("#unsplashKeywords");
const unsplashCount = document.querySelector("#unsplashCount");
const unsplashOrientation = document.querySelector("#unsplashOrientation");
const unsplashImageSize = document.querySelector("#unsplashImageSize");
const unsplashDelayMs = document.querySelector("#unsplashDelayMs");
const unsplashOutputDir = document.querySelector("#unsplashOutputDir");
const unsplashStatus = document.querySelector("#unsplashStatus");

const templateNames = {
  player: "模板1 播放器",
  "center-wave": "模板2 中间波形",
  "minimal-wave": "模板3 日记播放器",
  "journal-wave": "模板4 日记波形",
  "hyperframes-chat": "模板6 聊天记录",
  "hyperframes-danmu": "模板7 弹幕评论区",
  "hyperframes-chat-danmu": "模板8 聊天+弹幕"
};

const templateFileNames = {
  player: "模板1",
  "center-wave": "模板2",
  "minimal-wave": "模板3",
  "journal-wave": "模板4",
  "hyperframes-chat": "模板6",
  "hyperframes-danmu": "模板7",
  "hyperframes-chat-danmu": "模板8"
};

const captionPositionsStorageKey = "podcast-video-caption-positions";
const supportedTemplates = new Set(["player", "center-wave", "minimal-wave", "journal-wave"]);
let pollTimer = null;
let activeCaptionTemplate = "player";
let currentJobId = "";
let stopRequested = false;
let officialAccounts = [];
let unsplashPollTimer = null;
let currentUnsplashJobId = "";

generateBtn.addEventListener("click", async () => {
  stopRequested = false;
  const mode = getSourceMode();
  const title = titleText.value.trim();
  const text = scriptText.value.trim();
  const audioItems = mode === "audio" ? getAudioItems() : [];
  const backgroundFiles = Array.from(backgroundFile.files || []);
  const templates = getSelectedTemplates();
  const variants = Math.max(1, Math.min(5, Number(variantCount.value) || 1));

  if (!templates.length) {
    setStatus("请至少勾选一个视频模板。");
    return;
  }

  if (mode === "audio" && !audioItems.length) {
    setStatus("请先选择本地音频文件。");
    return;
  }

  if (mode === "text" && !text) {
    setStatus("请输入配音文案。");
    return;
  }

  resetResults();
  generateBtn.disabled = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;
  downloadLink.classList.remove("is-visible");
  resultVideo.removeAttribute("src");

  try {
    if (mode === "audio") {
      await runAudioTemplateBatch({ audioItems, backgroundFiles, templates, variants });
    } else {
      await runTextTemplateBatch({ title, text, backgroundFiles, templates, variants });
    }
  } catch (error) {
    clearPoll();
    hideProgress();
    setStatus(error.message || "生成失败。");
  } finally {
    currentJobId = "";
    stopRequested = false;
    generateBtn.disabled = false;
    stopBtn.hidden = true;
    stopBtn.disabled = false;
  }
});

stopBtn?.addEventListener("click", async () => {
  stopRequested = true;
  stopBtn.disabled = true;
  setStatus("正在停止当前生成任务...");
  if (currentJobId) {
    try {
      await cancelJob(currentJobId);
    } catch (error) {
      setStatus(error.message || "停止任务失败。");
    }
  }
  clearPoll();
  hideProgress();
});

downloadSelectedBtn?.addEventListener("click", async () => {
  const checkedItems = Array.from(resultList.querySelectorAll(".result-check:checked"));
  if (!checkedItems.length) {
    setStatus("请先勾选要下载的视频。");
    return;
  }

  setStatus(`正在下载选中的 ${checkedItems.length} 条视频...`);
  for (const item of checkedItems) {
    triggerDownload(item.dataset.url, item.dataset.filename);
    await delay(450);
  }
  setStatus(`已触发 ${checkedItems.length} 条视频下载。`);
});

refreshOfficialAccountsBtn?.addEventListener("click", loadOfficialAccounts);
publishSelectedBtn?.addEventListener("click", publishSelectedVideos);
officialGroupFilter?.addEventListener("change", renderOfficialAccounts);
officialNameFilter?.addEventListener("input", renderOfficialAccounts);
startUnsplashBtn?.addEventListener("click", startUnsplashDownload);
sourceModes.forEach((mode) => mode.addEventListener("change", updateSourceMode));
removeUnsupportedTemplateOptions();
captionPositionToggle?.addEventListener("click", () => {
  const shouldOpen = captionPositionContent?.hidden;
  setCaptionPositionOpen(Boolean(shouldOpen));
});
saveCaptionPositionsBtn?.addEventListener("click", saveCaptionPositions);
templateChoices.forEach((choice) => choice.addEventListener("change", updateCaptionPreviewFromSelection));
captionPositions.forEach((input) => {
  input.addEventListener("input", () => {
    updateRangeValue(input);
    updateCaptionPreview(input.dataset.template);
  });
  input.addEventListener("focus", () => updateCaptionPreview(input.dataset.template));
  input.addEventListener("pointerenter", () => updateCaptionPreview(input.dataset.template));
  updateRangeValue(input);
});
ttsProvider.addEventListener("change", updateSourceMode);
autoTts.addEventListener("change", updateSourceMode);
aspect.addEventListener("change", updatePreviewAspect);
loadSavedCaptionPositions();
updatePreviewAspect();
setCaptionPositionOpen(false);
updateCaptionPreviewFromSelection();
updateSourceMode();
loadOfficialAccounts();

async function startUnsplashDownload() {
  if (currentUnsplashJobId) return cancelUnsplashDownload();
  const payload = {
    accessKey: unsplashAccessKey?.value.trim() || "",
    keywords: unsplashKeywords?.value.trim() || "",
    count: Number(unsplashCount?.value) || 1000,
    orientation: unsplashOrientation?.value || "portrait",
    imageSize: unsplashImageSize?.value || "regular",
    delayMs: Number(unsplashDelayMs?.value) || 350,
    outputDir: unsplashOutputDir?.value.trim() || ""
  };
  if (!payload.accessKey) return setUnsplashStatus("请输入 Unsplash Access Key。");
  if (!payload.keywords) return setUnsplashStatus("请输入图片关键词。");
  if (!payload.outputDir) return setUnsplashStatus("请输入保存目录。");

  startUnsplashBtn.disabled = true;
  setUnsplashStatus("正在提交 Unsplash 下载任务...");
  try {
    const response = await fetch("/api/images/unsplash/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "提交 Unsplash 下载任务失败。");
    currentUnsplashJobId = data.jobId;
    startUnsplashBtn.disabled = false;
    startUnsplashBtn.textContent = "停止拉图";
    pollUnsplashProgress();
  } catch (error) {
    currentUnsplashJobId = "";
    startUnsplashBtn.disabled = false;
    startUnsplashBtn.textContent = "开始拉图";
    setUnsplashStatus(error.message || "提交 Unsplash 下载任务失败。");
  }
}

async function cancelUnsplashDownload() {
  if (!currentUnsplashJobId) return;
  startUnsplashBtn.disabled = true;
  setUnsplashStatus("正在停止 Unsplash 下载任务...");
  try {
    await fetch(`/api/images/unsplash/cancel/${encodeURIComponent(currentUnsplashJobId)}`, { method: "POST" });
  } catch {
    // Worker may have already stopped.
  }
  clearUnsplashPoll();
  currentUnsplashJobId = "";
  startUnsplashBtn.disabled = false;
  startUnsplashBtn.textContent = "开始拉图";
}

function pollUnsplashProgress() {
  clearUnsplashPoll();
  const tick = async () => {
    if (!currentUnsplashJobId) return;
    try {
      const response = await fetch(`/api/images/unsplash/progress/${encodeURIComponent(currentUnsplashJobId)}?t=${Date.now()}`);
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "读取 Unsplash 下载进度失败。");
      setUnsplashStatus([
        `${Math.round(Number(job.percent) || 0)}%`,
        `已下载 ${Number(job.downloaded) || 0}/${Number(job.targetCount) || Number(unsplashCount?.value) || 0}`,
        `已跳过 ${Number(job.skipped) || 0}`,
        job.message || ""
      ].filter(Boolean).join(" ｜ "));
      if (job.status === "done" || job.status === "failed" || job.status === "canceled") {
        currentUnsplashJobId = "";
        startUnsplashBtn.disabled = false;
        startUnsplashBtn.textContent = "开始拉图";
        clearUnsplashPoll();
        return;
      }
    } catch (error) {
      setUnsplashStatus(error.message || "读取 Unsplash 下载进度失败。");
    }
    unsplashPollTimer = window.setTimeout(tick, 1500);
  };
  tick();
}

async function runAudioTemplateBatch({ audioItems, backgroundFiles, templates, variants }) {
  const total = audioItems.length * templates.length * variants;
  const backgrounds = await readBackgrounds(backgroundFiles);
  const nextBackground = createBackgroundPicker(backgrounds);
  const results = [];
  let finished = 0;

  setStatus(`批量生成准备中：共 ${total} 条视频`);
  showProgress(1, "正在读取素材...");

  for (let audioIndex = 0; audioIndex < audioItems.length; audioIndex++) {
    const audio = audioItems[audioIndex];
    const audioBase64 = await fileToBase64(audio.file);
    const audioTitle = stripExtension(audio.name) || `audio-${audioIndex + 1}`;

    for (const selectedTemplate of templates) {
      for (let variant = 1; variant <= variants; variant++) {
        if (stopRequested) throw new Error("已停止生成。");
        const background = nextBackground();
        const result = await runOneJob({
          id: buildOutputId(titlePrefix(audioTitle), selectedTemplate, variant, variants),
          title: audioTitle,
          text: "",
          selectedTemplate,
          audioName: audio.name,
          audioBase64,
          background,
          total,
          current: finished + 1,
          finished,
          metaLabel: `${audio.name} - ${templateNames[selectedTemplate] || selectedTemplate} - 第 ${variant} 版`
        });

        results.push(result);
        addResultItem(result, {
          audioName: audio.name,
          audioIndex,
          templateIndex: templates.indexOf(selectedTemplate),
          template: selectedTemplate,
          templateLabel: templateNames[selectedTemplate] || selectedTemplate,
          variant
        });
        showResultPreview(result);
        finished += 1;
      }
    }
  }

  showProgress(100, "批量生成完成。");
  setStatus(`批量生成完成：共 ${results.length} 条视频，可勾选下载。`);
}

async function runTextTemplateBatch({ title, text, backgroundFiles, templates, variants }) {
  const total = templates.length * variants;
  const backgrounds = await readBackgrounds(backgroundFiles);
  const nextBackground = createBackgroundPicker(backgrounds);
  const results = [];
  let finished = 0;
  const baseId = titlePrefix(title || firstTextLine(text) || "text-video");

  setStatus(`文案生成准备中：共 ${total} 条视频`);
  showProgress(1, "正在读取素材...");

  for (const selectedTemplate of templates) {
    for (let variant = 1; variant <= variants; variant++) {
      if (stopRequested) throw new Error("已停止生成。");
      const background = nextBackground();
      const result = await runOneJob({
        id: buildOutputId(baseId, selectedTemplate, variant, variants),
        title,
        text,
        selectedTemplate,
        audioName: "",
        audioBase64: "",
        background,
        total,
        current: finished + 1,
        finished,
        metaLabel: `${templateNames[selectedTemplate] || selectedTemplate} - 第 ${variant} 版`
      });

      results.push(result);
      addResultItem(result, {
        audioName: "文案自动配音",
        audioIndex: 0,
        templateIndex: templates.indexOf(selectedTemplate),
        template: selectedTemplate,
        templateLabel: templateNames[selectedTemplate] || selectedTemplate,
        variant
      });
      showResultPreview(result);
      finished += 1;
    }
  }

  showProgress(100, "文案生成完成。");
  setStatus(`文案生成完成：共 ${results.length} 条视频，可勾选下载。`);
}

async function runOneJob({ id, title, text, selectedTemplate, audioName, audioBase64, background, total, current, finished, metaLabel }) {
  const offset = Math.round((finished / total) * 100);
  setStatus(`生成 ${current}/${total}：${metaLabel}`);
  showProgress(offset, `正在创建第 ${current}/${total} 个任务...`);

  const jobId = await startGenerateJob({
    id,
    title,
    text,
    template: selectedTemplate,
    audioName,
    audioBase64,
    backgroundName: background?.name || "",
    backgroundBase64: background?.base64 || ""
  });
  currentJobId = jobId;

  return waitForJob(jobId, (job) => {
    const itemPercent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    const totalPercent = Math.round(((finished + itemPercent / 100) / total) * 100);
    const message = job.message || "正在生成...";
    showProgress(totalPercent, `生成 ${current}/${total}：${message}`);
    setStatus(`生成 ${current}/${total}：${message}`);
  });
}

async function readBackgrounds(backgroundFiles) {
  const backgrounds = [];
  for (const file of backgroundFiles) {
    backgrounds.push({
      name: file.name,
      base64: await fileToBase64(file)
    });
  }
  return backgrounds;
}

async function startGenerateJob(extraPayload) {
  const response = await fetch("/api/generate/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aspect: aspect.value,
      backgroundColor: backgroundColor.value,
      autoCaptions: Boolean(autoCaptions?.checked),
      captionPositions: getCaptionPositions(),
      autoTts: getSourceMode() === "text" && autoTts.checked,
      ttsProvider: ttsProvider.value,
      elevenLabsVoiceId: elevenLabsVoiceId.value.trim(),
      elevenLabsModelId: elevenLabsModelId.value.trim(),
      ...extraPayload
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "生成任务创建失败。");
  return data.jobId;
}

async function cancelJob(jobId) {
  const response = await fetch(`/api/generate/cancel/${encodeURIComponent(jobId)}`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "停止任务失败。");
  return data;
}

function waitForJob(jobId, onProgress) {
  clearPoll();
  return new Promise((resolve, reject) => {
    let progressReadFailures = 0;
    const load = async () => {
      try {
        const response = await fetch(`/api/generate/progress/${encodeURIComponent(jobId)}?t=${Date.now()}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "读取进度失败。");
        progressReadFailures = 0;

        onProgress(data);

        if (data.status === "done") {
          clearPoll();
          currentJobId = "";
          resolve(data.result);
          return;
        }

        if (data.status === "canceled") {
          clearPoll();
          currentJobId = "";
          reject(new Error("已停止生成。"));
          return;
        }

        if (data.status === "failed") {
          throw new Error(data.error || data.message || "生成失败。");
        }
      } catch (error) {
        progressReadFailures += 1;
        if (progressReadFailures <= 8) {
          setStatus(`读取进度失败，正在重试 ${progressReadFailures}/8...`);
          return;
        }
        clearPoll();
        reject(error);
      }
    };

    load();
    pollTimer = window.setInterval(load, 1000);
  });
}

function clearPoll() {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function clearUnsplashPoll() {
  if (unsplashPollTimer) window.clearTimeout(unsplashPollTimer);
  unsplashPollTimer = null;
}

async function loadOfficialAccounts() {
  if (!officialAccountList || !officialAccountStatus) return;
  officialAccountStatus.textContent = "正在读取 TikTok 官方授权账号...";
  officialAccountList.innerHTML = "";
  try {
    const response = await fetch(`/api/official-tiktok/publish-accounts?module=mid-video&t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取 TikTok 官方账号失败。");
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    officialAccounts = accounts;
    if (!accounts.length) {
      officialAccountStatus.textContent = "本项目还没有可发布的官方账号，请先在账户管理中分配账号分组。";
      return;
    }
    officialAccountStatus.textContent = `已读取 ${accounts.length} 个 TikTok 官方账号。`;
    officialAccountList.innerHTML = accounts.map((account, index) => {
      const id = escapeHtml(account.connectionId || account.id || "");
      const name = escapeHtml(account.displayName || account.label || account.username || `官方账号 ${index + 1}`);
      const groupName = escapeHtml(account.groupName || "未分组");
      return `
        <label class="official-account-item">
          <input class="official-account-check" type="checkbox" value="${id}" />
          <span>
            <strong>${name}</strong>
            <small>${groupName || id}</small>
          </span>
        </label>
      `;
    }).join("");
    updateOfficialFiltersFromDom();
  } catch (error) {
    officialAccountStatus.textContent = error.message || "读取 TikTok 官方账号失败。";
  }
}

function updateOfficialFiltersFromDom() {
  if (!officialGroupFilter || !officialAccountList) return;
  Array.from(officialAccountList.querySelectorAll(".official-account-item")).forEach((item, index) => {
    const phone = officialAccounts[index] || {};
    item.dataset.searchText = [
      phone.id,
      phone.connectionId,
      phone.displayName,
      phone.username,
      phone.ownerEmail,
      phone.serialName,
      phone.serialNo,
      phone.groupName,
      phone.remark
    ].filter(Boolean).join(" ").toLowerCase();
  });

  const currentGroup = officialGroupFilter.value;
  const groups = Array.from(officialAccountList.querySelectorAll(".official-account-item small"))
    .map((item) => item.textContent.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  officialGroupFilter.innerHTML = `<option value="">全部分组</option>${groups.map((group) => (
    `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`
  )).join("")}`;

  if (groups.includes(currentGroup)) {
    officialGroupFilter.value = currentGroup;
  }
  renderOfficialAccounts();
}

function renderOfficialAccounts() {
  if (!officialAccountList) return;
  const groupKeyword = (officialGroupFilter?.value || "").trim().toLowerCase();
  const nameKeyword = (officialNameFilter?.value || "").trim().toLowerCase();
  let visibleCount = 0;

  officialAccountList.querySelectorAll(".official-account-item").forEach((item) => {
    const name = item.querySelector("strong")?.textContent.trim().toLowerCase() || "";
    const group = item.querySelector("small")?.textContent.trim().toLowerCase() || "";
    const id = item.querySelector(".official-account-check")?.value.toLowerCase() || "";
    const haystack = item.dataset.searchText || `${name} ${group} ${id}`;
    const groupMatched = !groupKeyword || group === groupKeyword;
    const nameMatched = !nameKeyword || haystack.includes(nameKeyword);
    const visible = groupMatched && nameMatched;
    item.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  if (officialAccountStatus && officialAccountList.children.length) {
    officialAccountStatus.textContent = `已显示 ${visibleCount}/${officialAccountList.children.length} 个 TikTok 官方账号`;
  }
}

async function publishSelectedVideos() {
  const checkedVideos = Array.from(resultList.querySelectorAll(".result-check:checked"));
  const checkedPhones = Array.from(document.querySelectorAll(".official-account-check:checked"));
  if (!checkedVideos.length) {
    setPublishResult("请先勾选要发布的视频。");
    return;
  }
  if (!checkedPhones.length) {
    setPublishResult("请先勾选要发布到的 TikTok 官方授权账号。");
    return;
  }

  const videos = checkedVideos.map((item) => ({
    videoUrl: item.dataset.url,
    fileName: item.dataset.filename,
    title: item.dataset.title,
    audioName: item.dataset.audioName || "",
    audioIndex: Number(item.dataset.audioIndex) || 0,
    template: item.dataset.template || "",
    templateIndex: Number(item.dataset.templateIndex) || 0,
    templateLabel: item.dataset.templateLabel || "",
    variant: Number(item.dataset.variant) || 1
  }));
  const connectionIds = checkedPhones.map((item) => item.value).filter(Boolean);
  const scheduleAt = publishTime?.value ? Math.floor(new Date(publishTime.value).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const intervalMinutes = Math.max(0, Number(publishIntervalMinutes?.value) || 0);

  publishSelectedBtn.disabled = true;
  setPublishResult(`正在把 ${videos.length} 条视频提交到 ${connectionIds.length} 个官方账号，间隔 ${intervalMinutes} 分钟...`);
  try {
    const response = await fetch("/api/official-tiktok/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "mid-video",
        name: "播客模板视频发布",
        videos,
        connectionIds,
        accountAssignment: "round-robin",
        videoDesc: publishDesc?.value || "",
        scheduleAt,
        intervalMinutes
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "TikTok 官方发布失败。");
    setPublishResult(data.message || `已下发 ${videos.length} 条视频的官方发布任务${data.jobId ? `：${data.jobId}` : ""}。`);
  } catch (error) {
    setPublishResult(error.message || "TikTok 官方发布失败。");
  } finally {
    publishSelectedBtn.disabled = false;
  }
}

function setPublishResult(message) {
  if (publishResult) publishResult.textContent = message;
  setStatus(message);
}

function formatPublishScheduleRange(results) {
  const times = results
    .map((item) => Number(item.scheduleAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!times.length) return "";
  const first = formatLocalDateTime(times[0]);
  const last = formatLocalDateTime(times[times.length - 1]);
  return first === last ? ` 鍙戝竷鏃堕棿锛?{first}` : ` 鍙戝竷鏃堕棿锛?{first} - ${last}`;
}

function formatLocalDateTime(seconds) {
  const date = new Date(seconds * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getSourceMode() {
  return sourceModes.find((mode) => mode.checked)?.value || "audio";
}

function updateSourceMode() {
  const isTextMode = getSourceMode() === "text";
  titleField.hidden = !isTextMode;
  audioField.hidden = isTextMode;
  scriptField.hidden = !isTextMode;
  autoTtsCheck.hidden = !isTextMode;
  ttsPanel.hidden = !isTextMode;

  const showElevenLabs = isTextMode && ttsProvider.value === "elevenlabs";
  document.querySelectorAll(".elevenlabs-field").forEach((field) => {
    field.hidden = !showElevenLabs;
  });
}

function getAudioItems() {
  return Array.from(audioFile.files || []).map((file) => ({
    type: "file",
    file,
    name: file.name
  }));
}

function getSelectedTemplates() {
  return templateChoices.filter((choice) => supportedTemplates.has(choice.value) && choice.checked).map((choice) => choice.value);
}

function removeUnsupportedTemplateOptions() {
  templateChoices.forEach((choice) => {
    if (!supportedTemplates.has(choice.value)) {
      choice.closest(".template-option")?.remove();
    }
  });
}

function getCaptionPositions() {
  return Object.fromEntries(captionPositions.map((input) => [
    input.dataset.template,
    Math.max(20, Math.min(82, Number(input.value) || 50)) / 100
  ]));
}

function loadSavedCaptionPositions() {
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(captionPositionsStorageKey) || "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") return;

  captionPositions.forEach((input) => {
    const value = Number(saved[input.dataset.template]);
    if (!Number.isFinite(value)) return;
    input.value = String(Math.max(20, Math.min(82, Math.round(value * 100))));
    updateRangeValue(input);
  });
}

function saveCaptionPositions() {
  window.localStorage.setItem(captionPositionsStorageKey, JSON.stringify(getCaptionPositions()));
  updateCaptionPreview(activeCaptionTemplate);
  setStatus("字幕位置已保存，刷新页面后会自动恢复。");
}

function updateRangeValue(input) {
  const label = input.closest(".range-field")?.querySelector("em");
  if (label) label.textContent = `${input.value}%`;
}

function updateCaptionPreviewFromSelection() {
  const selected = getSelectedTemplates().find((template) => captionPositions.some((input) => input.dataset.template === template));
  updateCaptionPreview(selected || activeCaptionTemplate || "player");
}

function setCaptionPositionOpen(isOpen) {
  if (captionPositionContent) captionPositionContent.hidden = !isOpen;
  if (captionPositionToggle) {
    captionPositionToggle.classList.toggle("is-open", isOpen);
    captionPositionToggle.setAttribute("aria-expanded", String(isOpen));
  }
}

function updateCaptionPreview(template = activeCaptionTemplate) {
  activeCaptionTemplate = template || "player";
  const input = captionPositions.find((item) => item.dataset.template === activeCaptionTemplate) || captionPositions[0];
  const ratio = Math.max(20, Math.min(82, Number(input?.value) || 50));
  if (captionPreviewText) {
    captionPreviewText.style.top = `${ratio}%`;
    captionPreviewText.textContent = `${templateFileNames[activeCaptionTemplate] || "妯℃澘"} 瀛楀箷棰勮浣嶇疆`;
  }
  if (captionPreviewStage) {
    captionPreviewStage.dataset.template = activeCaptionTemplate;
    captionPreviewStage.classList.toggle("is-landscape", aspect.value === "landscape");
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setUnsplashStatus(message) {
  if (unsplashStatus) unsplashStatus.textContent = message;
}

function showProgress(percent, stage) {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  progressBox.hidden = false;
  progressText.textContent = `${safePercent}%`;
  progressStage.textContent = stage || "正在生成...";
  progressFill.style.width = `${safePercent}%`;
}

function hideProgress() {
  progressBox.hidden = true;
  progressText.textContent = "0%";
  progressStage.textContent = "准备中";
  progressFill.style.width = "0%";
}

function updatePreviewAspect() {
  const phone = document.querySelector(".phone");
  phone.classList.toggle("is-landscape", aspect.value === "landscape");
  updateCaptionPreview(activeCaptionTemplate);
}

function resetResults() {
  resultList.innerHTML = "";
  batchResults.hidden = true;
  if (publishPanel) publishPanel.hidden = true;
  if (publishResult) publishResult.textContent = "";
}

function addResultItem(result, meta) {
  batchResults.hidden = false;
  const url = `${result.videoUrl}?t=${Date.now()}`;
  const filename = `${result.id}.mp4`;
  const item = document.createElement("div");
  item.className = "result-item";
  item.innerHTML = `
    <label class="result-main">
      <input class="result-check" type="checkbox" checked />
      <span>
        <strong></strong>
        <small></small>
      </span>
    </label>
    <div class="result-actions">
      <button class="preview-result" type="button">棰勮</button>
      <a class="mini-download" href="" download="">涓嬭浇</a>
    </div>
  `;

  const checkbox = item.querySelector(".result-check");
  checkbox.dataset.url = result.videoUrl;
  checkbox.dataset.filename = filename;
  checkbox.dataset.title = result.title || filename;
  checkbox.dataset.audioName = meta.audioName || "";
  checkbox.dataset.audioIndex = String(Number.isFinite(Number(meta.audioIndex)) ? Number(meta.audioIndex) : 0);
  checkbox.dataset.template = meta.template || "";
  checkbox.dataset.templateIndex = String(Number.isFinite(Number(meta.templateIndex)) ? Number(meta.templateIndex) : 0);
  checkbox.dataset.templateLabel = meta.templateLabel || "";
  checkbox.dataset.variant = String(meta.variant || 1);
  if (publishPanel) publishPanel.hidden = false;
  item.querySelector("strong").textContent = filename;
  item.querySelector("small").textContent = `${meta.templateLabel} 路 ${meta.audioName} 路 绗?${meta.variant} 鐗?路 ${formatDuration(result.duration)}`;
  item.querySelector(".preview-result").addEventListener("click", () => showResultPreview(result));
  const miniDownload = item.querySelector(".mini-download");
  miniDownload.href = url;
  miniDownload.download = filename;
  resultList.appendChild(item);
}

function showResultPreview(result) {
  const url = `${result.videoUrl}?t=${Date.now()}`;
  resultVideo.src = url;
  downloadLink.href = result.videoUrl;
  downloadLink.download = `${result.id}.mp4`;
  downloadLink.classList.add("is-visible");
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function buildOutputId(baseId, selectedTemplate, variant, variants) {
  const suffix = templateFileNames[selectedTemplate] || selectedTemplate;
  const safeBase = makeSafeId(baseId);
  const safeSuffix = makeSafeId(suffix);
  return variants > 1 ? `${safeBase}-${safeSuffix}-v${variant}` : `${safeBase}-${safeSuffix}`;
}

function titlePrefix(value) {
  const text = String(value || "video").trim();
  return Array.from(text).slice(0, 6).join("") || "video";
}

function firstTextLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function makeSafeId(value) {
  return String(value || "video")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "video";
}

function formatDuration(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

function createBackgroundPicker(items) {
  if (!items.length) return () => null;
  let queue = [];
  return () => {
    if (!queue.length) queue = shuffle(items);
    return queue.shift() || null;
  };
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stripExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}
