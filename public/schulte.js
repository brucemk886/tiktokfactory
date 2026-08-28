const $ = (selector) => document.querySelector(selector);
const SETTINGS_KEY = "localFactory.schulte.settings.v4";
const PREVIOUS_SETTINGS_KEY = "localFactory.schulte.settings.v3";
const LEGACY_SETTINGS_KEY = "localFactory.schulte.settings.v1";
const BATCH_SETTINGS_KEY = "localFactory.schulte.batch.v1";
const SAMPLE_TRACKING_CURSOR_KEY = "localFactory.schulte.sampleTrackingCursor.v1";

let pollTimer = null;
let currentJobId = "";
let selectedTemplate = "wheel";
const SCHULTE_TEMPLATES = ["wheel", "tracking", "memory", "peripheral"];
let batchPhones = [];
const selectedBatchPhoneIds = new Set();

loadSavedSettings();
selectTemplate(selectedTemplate, false);
setDefaultBatchSchedule();
updateBatchSequence();
loadBatchPhones();
loadBatchTasks();
attachDirectoryPickers();

$("#saveSettingsBtn").addEventListener("click", saveSettings);

$("#randomSeedBtn").addEventListener("click", () => {
  $("#seed").value = String(Math.floor(1000 + Math.random() * 998999));
});

document.querySelectorAll("[data-template]").forEach((button) => {
  button.addEventListener("click", () => selectTemplate(button.dataset.template, true));
});

$("#generateBtn").addEventListener("click", startRender);
$("#sampleCount").addEventListener("input", updateGenerateButtonLabel);
$("#refreshBatchPhonesBtn").addEventListener("click", loadBatchPhones);
$("#refreshBatchTasksBtn").addEventListener("click", loadBatchTasks);
$("#batchSelectVisibleBtn").addEventListener("click", selectVisibleBatchPhones);
$("#batchGroupFilter").addEventListener("change", renderBatchPhones);
$("#batchNameFilter").addEventListener("input", renderBatchPhones);
$("#batchPhoneList").addEventListener("change", handleBatchPhoneSelection);
$("#batchTaskList").addEventListener("click", handleBatchTaskAction);
$("#createBatchBtn").addEventListener("click", createBatchTask);
$("#batchTotalVideos").addEventListener("input", updateBatchSequence);
$("#day").addEventListener("input", updateBatchSequence);
document.querySelectorAll("[data-batch-template]").forEach((input) => {
  input.addEventListener("change", () => {
    updateBatchTemplateSummary();
    saveBatchSettings();
  });
});
$("#trainingMode").addEventListener("change", updateWheelVariationSummary);
$("#layoutStyle").addEventListener("change", updateWheelVariationSummary);
$("#backgroundStyle").addEventListener("change", updateWheelVariationSummary);
$("#trackingMode").addEventListener("change", updateTrackingVariationSummary);
$("#trackingBackground").addEventListener("change", updateTrackingVariationSummary);
$("#memorySteps").addEventListener("input", updateConceptVariationSummary);
$("#memoryBackground").addEventListener("change", updateConceptVariationSummary);
$("#peripheralTargets").addEventListener("input", updateConceptVariationSummary);
$("#batchAutoPublish").addEventListener("change", updateBatchPublishState);
updateBatchPublishState();
updateGenerateButtonLabel();

async function startRender() {
  const payload = getFormSettings();

  if (["wheel", "memory", "peripheral"].includes(payload.template) && !payload.mainTitle) {
    setStatus("请填写画面主标题。", true);
    $("#mainTitle").focus();
    return;
  }

  if (payload.template === "wheel" && payload.instructionStartsAt >= payload.trainingStartsAt - 0.5) {
    setStatus("提示出现时间至少要比计时开始早 0.5 秒。", true);
    return;
  }
  if (payload.template === "wheel" && payload.trainingStartsAt >= payload.durationSeconds - 2) {
    setStatus("计时开始时间必须早于视频结束时间。", true);
    return;
  }
  if (payload.backgroundMusicMode === "local" && !payload.backgroundMusicDir) {
    setStatus("请选择本地背景音乐文件夹，或改用内置音乐。", true);
    return;
  }

  if (payload.sampleCount > 1) {
    await createSampleBatchTask(payload);
    return;
  }

  const renderPayload = resolveStandaloneSampleVariation(payload);
  setBusy(true);
  setProgress(2);
  setStatus(`正在创建${templateLabel(payload.template)}任务...`);

  try {
    const response = await fetchWithTimeout("/api/schulte/start", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(renderPayload)
    }, 15000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败。");

    currentJobId = data.jobId;
    clearInterval(pollTimer);
    pollTimer = setInterval(pollRender, 1200);
    await pollRender();
  } catch (error) {
    setBusy(false);
    setStatus(error.name === "AbortError" ? "创建任务请求超时，请重试。" : (error.message || "创建任务失败。"), true);
  }
}

function resolveStandaloneSampleVariation(payload) {
  if (payload.template === "memory" && payload.memoryBackground === "auto") {
    const memoryBackgrounds = ["aqua", "navy", "violet", "forest", "sunset", "rose", "graphite"];
    const storedCursor = Number.parseInt(localStorage.getItem(SAMPLE_TRACKING_CURSOR_KEY) || "0", 10);
    const cursor = Number.isFinite(storedCursor) && storedCursor >= 0 ? storedCursor : 0;
    localStorage.setItem(SAMPLE_TRACKING_CURSOR_KEY, String(cursor + 1));
    return {
      ...payload,
      memoryBackground: memoryBackgrounds[cursor % memoryBackgrounds.length]
    };
  }
  if (payload.template !== "tracking") return payload;

  const trackingModes = ["single", "dual", "triple"];
  const trackingBackgrounds = ["forest", "navy", "violet", "graphite", "amber"];
  const shouldRotateMode = payload.trackingMode === "auto";
  const shouldRotateBackground = payload.trackingBackground === "auto";
  if (!shouldRotateMode && !shouldRotateBackground) return payload;

  const storedCursor = Number.parseInt(localStorage.getItem(SAMPLE_TRACKING_CURSOR_KEY) || "0", 10);
  const cursor = Number.isFinite(storedCursor) && storedCursor >= 0 ? storedCursor : 0;
  localStorage.setItem(SAMPLE_TRACKING_CURSOR_KEY, String(cursor + 1));

  return {
    ...payload,
    trackingMode: shouldRotateMode
      ? trackingModes[cursor % trackingModes.length]
      : payload.trackingMode,
    trackingBackground: shouldRotateBackground
      ? trackingBackgrounds[cursor % trackingBackgrounds.length]
      : payload.trackingBackground
  };
}

async function pollRender() {
  if (!currentJobId) return;

  try {
    const response = await fetch(`/api/schulte/progress/${encodeURIComponent(currentJobId)}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "读取进度失败。");

    const reportedPercent = Number(job.percent) || 0;
    let displayPercent = reportedPercent;
    if (job.status === "running" && job.renderStartedAt && job.estimatedRenderMs) {
      const elapsedRatio = Math.max(
        0,
        (Date.now() - Number(job.renderStartedAt)) / Number(job.estimatedRenderMs)
      );
      const estimatedPercent = elapsedRatio <= 1
        ? 30 + elapsedRatio * 55
        : 85 + Math.min(9, (elapsedRatio - 1) * 6);
      displayPercent = Math.max(reportedPercent, estimatedPercent);
    }
    setProgress(displayPercent);
    setStatus(job.message || "正在渲染...");

    if (job.status === "done") {
      clearInterval(pollTimer);
      pollTimer = null;
      setBusy(false);
      setProgress(100);
      const videoUrl = job.result?.videoUrl || "";
      if (videoUrl) {
        $("#previewVideo").src = `${videoUrl}?t=${Date.now()}`;
        $("#previewVideo").load();
        if (job.result.template === "tracking") {
          $("#previewMeta").textContent = `模板 2 · DAY ${job.result.day} · ${trackingModeLabel(job.result.trackingMode)} · ${trackingBackgroundLabel(job.result.trackingBackground)} · 种子 ${job.result.seed}`;
        } else if (job.result.template === "memory") {
          $("#previewMeta").textContent = `模板 4 · DAY ${job.result.day} · ${job.result.memorySteps} 步位置记忆 · ${memoryBackgroundLabel(job.result.memoryBackground)} · 种子 ${job.result.seed}`;
        } else if (job.result.template === "peripheral") {
          $("#previewMeta").textContent = `模板 5 · DAY ${job.result.day} · ${job.result.peripheralTargets} 个目标图形 · 种子 ${job.result.seed}`;
        } else {
          $("#previewMeta").textContent = `模板 1 · DAY ${job.result.day} · ${trainingModeLabel(job.result.trainingMode)} · ${backgroundStyleLabel(job.result.backgroundStyle)} · 种子 ${job.result.seed}`;
        }
        $("#downloadLink").href = videoUrl;
        $("#downloadLink").classList.remove("is-hidden");
      }
      setStatus("样片生成完成，可以直接播放或下载。");
      return;
    }

    if (job.status === "failed") {
      clearInterval(pollTimer);
      pollTimer = null;
      setBusy(false);
      setStatus(job.error || job.message || "渲染失败。", true);
    }
  } catch (error) {
    clearInterval(pollTimer);
    pollTimer = null;
    setBusy(false);
    setStatus(error.message || "读取任务进度失败。", true);
  }
}

function selectTemplate(template, updateHeadline) {
  selectedTemplate = SCHULTE_TEMPLATES.includes(template) ? template : "wheel";
  document.querySelectorAll("[data-template]").forEach((button) => {
    const active = button.dataset.template === selectedTemplate;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-template-fields]").forEach((field) => {
    const supportedTemplates = String(field.dataset.templateFields || "")
      .split(/\s+/)
      .filter(Boolean);
    field.classList.toggle("is-hidden", !supportedTemplates.includes(selectedTemplate));
  });

  const headline = $("#headline");
  if (updateHeadline) {
    if (selectedTemplate === "tracking" && headline.value.trim() === "专注力改造计划") {
      headline.value = "每日前额叶训练";
    }
    if (selectedTemplate === "wheel" && headline.value.trim() === "每日前额叶训练") {
      headline.value = "专注力改造计划";
    }
  }

  if (selectedTemplate === "tracking") {
    $("#configHelp").textContent = "目标球、编号和运动轨迹都由随机种子决定，同一种子可重复生成。";
    updateTrackingVariationSummary();
    $("#previewMeta").textContent = "模板 2：小球视觉追踪；生成后会在这里预览。";
  } else if (selectedTemplate === "memory") {
    $("#configHelp").textContent = "每个随机种子都会生成不同的亮起路径，批量任务会自动递增训练天数并更换路径。";
    updateConceptVariationSummary();
    $("#previewMeta").textContent = "模板 4：网格位置顺序记忆；生成后会在这里预览。";
  } else if (selectedTemplate === "peripheral") {
    $("#configHelp").textContent = "每个随机种子都会改变闪现位置、顺序和目标分布，适合批量生成不同题目。";
    updateConceptVariationSummary();
    $("#previewMeta").textContent = "模板 5：周边闪视捕捉；生成后会在这里预览。";
  } else {
    $("#configHelp").textContent = "玩法、圆盘布局和背景可固定，也可在批量生成时自动轮换。";
    updateWheelVariationSummary();
    $("#previewMeta").textContent = "模板 1：三层旋转数字圆盘。";
  }
  updateBatchTemplateSummary();
  updateBatchSequence();
}

function setFeature(index, value, label) {
  $(`#featureValue${index}`).textContent = value;
  $(`#featureLabel${index}`).textContent = label;
}

function updateWheelVariationSummary() {
  if (selectedTemplate !== "wheel") return;
  const trainingMode = $("#trainingMode")?.value || "auto";
  const layoutStyle = $("#layoutStyle")?.value || "auto";
  const backgroundStyle = $("#backgroundStyle")?.value || "auto";
  setFeature(1, trainingMode === "auto" ? "4 种" : trainingModeLabel(trainingMode), "训练玩法");
  setFeature(2, layoutStyle === "auto" ? "3 种" : layoutStyleLabel(layoutStyle), "圆盘布局");
  setFeature(3, backgroundStyle === "auto" ? "5 套" : backgroundStyleLabel(backgroundStyle), "画面背景");
  updateBatchTemplateSummary();
}

function updateTrackingVariationSummary() {
  if (selectedTemplate !== "tracking") return;
  const mode = $("#trackingMode")?.value || "auto";
  const background = $("#trackingBackground")?.value || "auto";
  setFeature(1, mode === "auto" ? "3 种" : trackingModeLabel(mode), "追踪玩法");
  setFeature(2, "10", "动态小球");
  setFeature(3, background === "auto" ? "5 套" : trackingBackgroundLabel(background), "追踪背景");
  updateBatchTemplateSummary();
}

function updateConceptVariationSummary() {
  if (selectedTemplate === "memory") {
    setFeature(1, String(clampNumber($("#memorySteps")?.value, 4, 8, 6)), "记忆步骤");
    setFeature(2, "5 × 5", "位置网格");
    setFeature(
      3,
      $("#memoryBackground")?.value === "auto"
        ? "7 套"
        : memoryBackgroundLabel($("#memoryBackground")?.value),
      "记忆背景"
    );
  } else if (selectedTemplate === "peripheral") {
    setFeature(1, String(clampNumber($("#peripheralTargets")?.value, 2, 5, 3)), "目标图形");
    setFeature(2, "8", "闪现位置");
    setFeature(3, "中心", "视线焦点");
  } else {
    return;
  }
  updateBatchTemplateSummary();
}

function templateLabel(value) {
  return ({
    wheel: "旋转数字圆盘",
    tracking: "小球视觉追踪",
    memory: "网格位置记忆",
    peripheral: "周边闪视捕捉"
  })[value] || "舒尔特训练";
}

function templateNumberLabel(value) {
  return ({
    wheel: "模板1",
    tracking: "模板2",
    memory: "模板4",
    peripheral: "模板5"
  })[value] || "模板";
}

function getSelectedBatchTemplates() {
  return Array.from(document.querySelectorAll("[data-batch-template]:checked"))
    .map((input) => input.dataset.batchTemplate)
    .filter((template) => SCHULTE_TEMPLATES.includes(template));
}

function trackingModeLabel(value) {
  return ({
    auto: "自动轮换",
    single: "单目标",
    dual: "双目标",
    triple: "三目标"
  })[value] || "单目标";
}

function trackingBackgroundLabel(value) {
  return ({
    auto: "自动轮换",
    forest: "深林绿",
    navy: "深海蓝",
    violet: "暗夜紫",
    graphite: "石墨灰",
    amber: "琥珀棕"
  })[value] || "深林绿";
}

function memoryBackgroundLabel(value) {
  return ({
    auto: "自动轮换",
    aqua: "冰川青",
    navy: "深海蓝",
    violet: "暮光紫",
    forest: "森林绿",
    sunset: "日落橙",
    rose: "玫瑰粉",
    graphite: "石墨黑"
  })[value] || "冰川青";
}

function trainingModeLabel(value) {
  return ({
    auto: "自动轮换",
    sequence: "顺序寻找",
    reverse: "倒序寻找",
    missing: "缺失数字",
    duplicate: "重复数字"
  })[value] || "顺序寻找";
}

function layoutStyleLabel(value) {
  return ({
    auto: "自动轮换",
    classic: "经典",
    balanced: "均衡",
    focus: "聚焦"
  })[value] || "经典";
}

function backgroundStyleLabel(value) {
  return ({
    auto: "自动轮换",
    mint: "薄荷青绿",
    sky: "清透天蓝",
    lavender: "柔和紫灰",
    peach: "暖杏珊瑚",
    paper: "明亮纸白"
  })[value] || "薄荷青绿";
}

function getFormSettings() {
  const trackingSeconds = clampNumber($("#trackingSeconds").value, 10, 90, 30);
  const trainingMode = ["auto", "sequence", "reverse", "missing", "duplicate"].includes($("#trainingMode").value)
    ? $("#trainingMode").value
    : "auto";
  const layoutStyle = ["auto", "classic", "balanced", "focus"].includes($("#layoutStyle").value)
    ? $("#layoutStyle").value
    : "auto";
  const backgroundStyle = ["auto", "mint", "sky", "lavender", "peach", "paper"].includes($("#backgroundStyle").value)
    ? $("#backgroundStyle").value
    : "auto";
  return {
    template: selectedTemplate,
    day: clampNumber($("#day").value, 1, 999, selectedTemplate === "tracking" ? 46 : 24),
    wheelDurationSeconds: clampNumber($("#durationSeconds").value, 12, 180, 32),
    durationSeconds: selectedTemplate === "tracking"
      ? trackingSeconds + 7
      : ["memory", "peripheral"].includes(selectedTemplate)
        ? 16
        : clampNumber($("#durationSeconds").value, 12, 180, 32),
    trainingStartsAt: selectedTemplate === "tracking"
      ? 3
      : clampDecimal($("#trainingStartsAt").value, 3, 20, 4),
    instructionStartsAt: selectedTemplate === "tracking"
      ? 2
      : clampDecimal($("#instructionStartsAt").value, 1, 10, 2),
    seed: clampNumber($("#seed").value, 1, 999999, selectedTemplate === "tracking" ? 4602 : 2407),
    rotationSpeed: clampDecimal($("#rotationSpeed").value, 0.25, 3, 2.5),
    trainingMode,
    layoutStyle,
    backgroundStyle,
    instructionLanguage: $("#instructionLanguage").value === "en" ? "en" : "zh",
    trackingSeconds,
    ballSpeed: clampDecimal($("#ballSpeed").value, 0.5, 3, 1),
    trackingMode: ["auto", "single", "dual", "triple"].includes($("#trackingMode").value)
      ? $("#trackingMode").value
      : "auto",
    trackingBackground: ["auto", "forest", "navy", "violet", "graphite", "amber"].includes($("#trackingBackground").value)
      ? $("#trackingBackground").value
      : "auto",
    memorySteps: clampNumber($("#memorySteps").value, 4, 8, 6),
    memoryBackground: ["auto", "aqua", "navy", "violet", "forest", "sunset", "rose", "graphite"].includes($("#memoryBackground").value)
      ? $("#memoryBackground").value
      : "auto",
    peripheralTargets: clampNumber($("#peripheralTargets").value, 2, 5, 3),
    headline: $("#headline").value.trim() || ({
      tracking: "每日前额叶训练",
      memory: "网格位置记忆",
      peripheral: "周边闪视捕捉"
    })[selectedTemplate] || "专注力改造计划",
    mainTitle: $("#mainTitle").value.trim(),
    backgroundMusicMode: ["local", "built-in", "off"].includes($("#backgroundMusicMode").value)
      ? $("#backgroundMusicMode").value
      : "local",
    backgroundMusicEnabled: $("#backgroundMusicMode").value !== "off",
    backgroundMusicDir: $("#backgroundMusicMode").value === "local"
      ? $("#backgroundMusicDir").value.trim()
      : "",
    backgroundMusicVolume: clampDecimal($("#backgroundMusicVolume").value, 0, 1, 0.35),
    sampleCount: clampNumber($("#sampleCount").value, 1, 30, 1)
  };
}

function saveSettings() {
  const settings = getFormSettings();
  if (["wheel", "memory", "peripheral"].includes(settings.template) && !settings.mainTitle) {
    setStatus("请填写画面主标题。", true);
    $("#mainTitle").focus();
    return;
  }
  if (settings.template === "wheel" && settings.instructionStartsAt >= settings.trainingStartsAt - 0.5) {
    setStatus("提示出现时间至少要比计时开始早 0.5 秒。", true);
    return;
  }
  if (settings.template === "wheel" && settings.trainingStartsAt >= settings.durationSeconds - 2) {
    setStatus("计时开始时间必须早于视频结束时间。", true);
    return;
  }
  if (settings.backgroundMusicMode === "local" && !settings.backgroundMusicDir) {
    setStatus("请选择本地背景音乐文件夹，或改用内置音乐。", true);
    return;
  }

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    saveBatchSettings();
    applySettings(settings);
    setStatus("生成设置已保存，刷新页面后会自动恢复。提示：模板设置会一起保存。");
    const button = $("#saveSettingsBtn");
    button.textContent = "已保存";
    setTimeout(() => { button.textContent = "保存设置"; }, 1200);
  } catch {
    setStatus("保存设置失败，请检查浏览器存储权限。", true);
  }
}

function loadSavedSettings() {
  try {
    const current = localStorage.getItem(SETTINGS_KEY);
    const previous = localStorage.getItem(PREVIOUS_SETTINGS_KEY);
    const raw = current || previous || localStorage.getItem(LEGACY_SETTINGS_KEY);
    const saved = JSON.parse(raw || "null");
    if (saved) {
      if (!current) {
        saved.instructionStartsAt = 2;
        saved.trainingStartsAt = 4;
        saved.backgroundMusicMode = "local";
        saved.backgroundMusicEnabled = true;
        saved.backgroundMusicVolume = 0.35;
      }
      applySettings(saved);
    }
    const batchSaved = JSON.parse(localStorage.getItem(BATCH_SETTINGS_KEY) || "null");
    if (batchSaved) applyBatchSettings(batchSaved);
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
}

function applySettings(settings) {
  selectedTemplate = SCHULTE_TEMPLATES.includes(settings.template) ? settings.template : "wheel";
  $("#day").value = String(clampNumber(settings.day, 1, 999, selectedTemplate === "tracking" ? 46 : 24));
  $("#sampleCount").value = String(clampNumber(settings.sampleCount, 1, 30, 1));
  $("#durationSeconds").value = String(clampNumber(settings.durationSeconds, 12, 180, 32));
  $("#trainingStartsAt").value = String(clampDecimal(settings.trainingStartsAt, 3, 20, 4));
  $("#instructionStartsAt").value = String(clampDecimal(settings.instructionStartsAt, 1, 10, 2));
  $("#seed").value = String(clampNumber(settings.seed, 1, 999999, selectedTemplate === "tracking" ? 4602 : 2407));
  $("#rotationSpeed").value = String(clampDecimal(settings.rotationSpeed, 0.25, 3, 2.5));
  $("#trainingMode").value = ["auto", "sequence", "reverse", "missing", "duplicate"].includes(settings.trainingMode)
    ? settings.trainingMode
    : "auto";
  $("#layoutStyle").value = ["auto", "classic", "balanced", "focus"].includes(settings.layoutStyle)
    ? settings.layoutStyle
    : "auto";
  $("#backgroundStyle").value = ["auto", "mint", "sky", "lavender", "peach", "paper"].includes(settings.backgroundStyle)
    ? settings.backgroundStyle
    : "auto";
  $("#instructionLanguage").value = settings.instructionLanguage === "en" ? "en" : "zh";
  $("#trackingSeconds").value = String(clampNumber(settings.trackingSeconds, 10, 90, 30));
  $("#ballSpeed").value = String(clampDecimal(settings.ballSpeed, 0.5, 3, 1));
  $("#trackingMode").value = ["auto", "single", "dual", "triple"].includes(settings.trackingMode)
    ? settings.trackingMode
    : "auto";
  $("#trackingBackground").value = ["auto", "forest", "navy", "violet", "graphite", "amber"].includes(settings.trackingBackground)
    ? settings.trackingBackground
    : "auto";
  $("#memorySteps").value = String(clampNumber(settings.memorySteps, 4, 8, 6));
  $("#memoryBackground").value = ["auto", "aqua", "navy", "violet", "forest", "sunset", "rose", "graphite"].includes(settings.memoryBackground)
    ? settings.memoryBackground
    : "auto";
  $("#peripheralTargets").value = String(clampNumber(settings.peripheralTargets, 2, 5, 3));
  $("#headline").value = String(settings.headline || (selectedTemplate === "tracking" ? "每日前额叶训练" : "专注力改造计划")).slice(0, 24);
  $("#mainTitle").value = String(settings.mainTitle || "每日前额叶训练").slice(0, 24);
  $("#backgroundMusicMode").value = ["local", "built-in", "off"].includes(settings.backgroundMusicMode)
    ? settings.backgroundMusicMode
    : (settings.backgroundMusicEnabled === false ? "off" : "built-in");
  $("#backgroundMusicDir").value = String(settings.backgroundMusicDir || "");
  $("#backgroundMusicVolume").value = String(clampDecimal(settings.backgroundMusicVolume, 0, 1, 0.35));
  updateWheelVariationSummary();
  updateTrackingVariationSummary();
  updateConceptVariationSummary();
  updateBatchTemplateSummary();
  updateBatchSequence();
  updateGenerateButtonLabel();
}

function attachDirectoryPickers() {
  document.querySelectorAll("[data-pick-directory]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.pickDirectory);
      if (!target) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "选择中...";
      try {
        const response = await fetch("/api/select-directory", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            initialPath: target.value.trim(),
            title: "选择舒尔特背景音乐文件夹"
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "打开目录选择失败");
        if (data.path) {
          target.value = data.path;
          $("#backgroundMusicMode").value = "local";
        }
      } catch (error) {
        setStatus(error.message || "打开目录选择失败", true);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

function setBusy(busy) {
  $("#generateBtn").disabled = busy;
  $("#randomSeedBtn").disabled = busy;
  document.querySelectorAll("[data-template]").forEach((button) => { button.disabled = busy; });
  $("#sampleCount").disabled = busy;
  if (busy) {
    $("#generateBtn").textContent = clampNumber($("#sampleCount").value, 1, 30, 1) > 1
      ? "正在创建批量任务..."
      : "正在生成...";
  } else {
    updateGenerateButtonLabel();
  }
}

function updateGenerateButtonLabel() {
  const button = $("#generateBtn");
  if (!button || button.disabled) return;
  const count = clampNumber($("#sampleCount").value, 1, 30, 1);
  button.textContent = count === 1 ? "生成一条样片" : `生成 ${count} 条样片`;
}

function setStatus(message, isError = false) {
  const target = $("#statusText");
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function setProgress(percent) {
  $("#progressBar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

async function createSampleBatchTask(generation) {
  const totalVideos = clampNumber(generation.sampleCount, 1, 30, 1);
  const taskName = `本地样片 · ${templateLabel(generation.template)} · ${totalVideos}条 · DAY ${generation.day}`;

  setBusy(true);
  setProgress(5);
  setStatus(`正在创建 ${totalVideos} 条本地样片任务...`);

  try {
    const response = await fetchWithTimeout("/api/auto-tasks", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        taskType: "schulte",
        name: taskName,
        generation: {
          ...generation,
          totalVideos,
          startDay: generation.day
        },
        publish: {
          autoPublish: false,
          envIds: [],
          accounts: [],
          videoDesc: "",
          scheduleAt: 0,
          intervalMinutes: 0,
          batchPublishLimit: 300,
          dailyPublishLimit: 300
        }
      })
    }, 20000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建本地样片任务失败。");

    setProgress(100);
    setStatus(`已加入队列：将顺序生成 ${totalVideos} 条本地样片，不会发布到 GeeLark。`);
    await loadBatchTasks();
    document.querySelector(".schulte-batch-section")?.scrollIntoView({behavior: "smooth", block: "start"});
  } catch (error) {
    setProgress(0);
    setStatus(error.name === "AbortError" ? "创建样片任务请求超时，请重试。" : (error.message || "创建本地样片任务失败。"), true);
  } finally {
    setBusy(false);
  }
}

async function createBatchTask() {
  const generation = getFormSettings();
  const batchTemplates = getSelectedBatchTemplates();
  const totalVideos = clampNumber($("#batchTotalVideos").value, 1, 300, 30);
  const autoPublish = $("#batchAutoPublish").checked;
  const envIds = Array.from(selectedBatchPhoneIds);
  const scheduleAt = Math.floor(new Date($("#batchScheduleAt").value).getTime() / 1000);

  if (!batchTemplates.length) {
    return setBatchStatus("请至少勾选一个批量生成模板。", true);
  }
  if (batchTemplates.some((template) => ["wheel", "memory", "peripheral"].includes(template)) && !generation.mainTitle) {
    $("#mainTitle").focus();
    return setBatchStatus("请先在上方填写画面主标题。", true);
  }
  if (batchTemplates.includes("wheel") && generation.instructionStartsAt >= generation.trainingStartsAt - 0.5) {
    return setBatchStatus("提示出现时间至少要比计时开始早 0.5 秒。", true);
  }
  if (batchTemplates.includes("wheel") && generation.trainingStartsAt >= generation.wheelDurationSeconds - 2) {
    return setBatchStatus("计时开始时间必须早于视频结束时间。", true);
  }
  if (generation.backgroundMusicMode === "local" && !generation.backgroundMusicDir) {
    return setBatchStatus("请选择本地背景音乐文件夹，或改用内置音乐。", true);
  }
  if (autoPublish && !envIds.length) {
    return setBatchStatus("自动发布至少需要选择一个 GeeLark 账号。", true);
  }
  if (autoPublish && (!scheduleAt || scheduleAt < Math.floor(Date.now() / 1000) + 300)) {
    return setBatchStatus("起始发布时间至少要晚于当前时间 5 分钟。", true);
  }

  const accountsById = new Map(batchPhones.map((phone) => [String(phone.id), phone]));
  const accounts = envIds.map((id) => {
    const phone = accountsById.get(id) || {};
    return {
      id,
      name: phone.serialName || "",
      serialNo: phone.serialNo || "",
      groupName: phone.groupName || "",
      remark: phone.remark || ""
    };
  });
  const taskName = $("#batchTaskName").value.trim()
    || `舒尔特${batchTemplates.map(templateNumberLabel).join("+")} · ${totalVideos}条 · DAY ${generation.day}`;

  $("#createBatchBtn").disabled = true;
  setBatchStatus(`正在创建 ${totalVideos} 条舒尔特视频任务...`);
  saveBatchSettings();

  try {
    const response = await fetchWithTimeout("/api/auto-tasks", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        taskType: "schulte",
        name: taskName,
        generation: {
          ...generation,
          template: batchTemplates[0],
          templates: batchTemplates,
          totalVideos,
          startDay: generation.day
        },
        publish: {
          autoPublish,
          envIds,
          accounts,
          videoDesc: $("#batchVideoDesc").value.trim(),
          scheduleAt: autoPublish ? scheduleAt : 0,
          intervalMinutes: clampNumber($("#batchIntervalMinutes").value, 0, 1440, 15),
          batchPublishLimit: clampNumber($("#batchPublishLimit").value, 1, 300, 300),
          dailyPublishLimit: 300
        }
      })
    }, 20000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建舒尔特批量任务失败。");

    selectedBatchPhoneIds.clear();
    renderBatchPhones();
    $("#batchTaskName").value = "";
    setBatchStatus(`任务已加入队列，将生成 ${totalVideos} 条视频${autoPublish ? "并按计划自动发布" : "，生成后等待人工检查"}。`);
    await loadBatchTasks();
  } catch (error) {
    setBatchStatus(error.name === "AbortError" ? "创建任务请求超时，请重试。" : (error.message || "创建舒尔特批量任务失败。"), true);
  } finally {
    $("#createBatchBtn").disabled = false;
  }
}

async function loadBatchPhones() {
  $("#batchPhoneList").innerHTML = '<div class="schulte-empty">正在读取 GeeLark 账号...</div>';
  try {
    const response = await fetch(`/api/geelark/phones?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取 GeeLark 账号失败。");
    batchPhones = Array.isArray(data.phones) ? data.phones : [];
    const validIds = new Set(batchPhones.map((phone) => String(phone.id)));
    for (const id of selectedBatchPhoneIds) {
      if (!validIds.has(id)) selectedBatchPhoneIds.delete(id);
    }
    const groups = Array.from(new Set(batchPhones.map((phone) => phone.groupName).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
    const previousGroup = $("#batchGroupFilter").value;
    $("#batchGroupFilter").innerHTML = '<option value="">全部分组</option>'
      + groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
    if (groups.includes(previousGroup)) $("#batchGroupFilter").value = previousGroup;
    renderBatchPhones();
  } catch (error) {
    $("#batchPhoneList").innerHTML = `<div class="schulte-empty">${escapeHtml(error.message)}</div>`;
  }
}

function visibleBatchPhones() {
  const group = $("#batchGroupFilter").value;
  const query = $("#batchNameFilter").value.trim().toLowerCase();
  return batchPhones.filter((phone) => {
    if (group && phone.groupName !== group) return false;
    return !query || [phone.serialName, phone.serialNo, phone.remark, phone.groupName]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderBatchPhones() {
  const phones = visibleBatchPhones();
  $("#batchPhoneList").innerHTML = phones.length
    ? phones.map((phone) => {
      const id = String(phone.id);
      return `<label class="schulte-phone-card">
        <input class="schulte-phone-check" type="checkbox" value="${escapeHtml(id)}" ${selectedBatchPhoneIds.has(id) ? "checked" : ""} />
        <span><strong>${escapeHtml(phone.serialName || phone.serialNo || id)}</strong><small>${escapeHtml(phone.groupName || "未分组")}</small></span>
      </label>`;
    }).join("")
    : '<div class="schulte-empty">当前筛选没有账号。</div>';
  updateBatchSelectedCount();
}

function handleBatchPhoneSelection(event) {
  const input = event.target.closest(".schulte-phone-check");
  if (!input) return;
  if (input.checked) selectedBatchPhoneIds.add(input.value);
  else selectedBatchPhoneIds.delete(input.value);
  updateBatchSelectedCount();
}

function selectVisibleBatchPhones() {
  const ids = visibleBatchPhones().map((phone) => String(phone.id));
  const shouldSelect = ids.some((id) => !selectedBatchPhoneIds.has(id));
  ids.forEach((id) => {
    if (shouldSelect) selectedBatchPhoneIds.add(id);
    else selectedBatchPhoneIds.delete(id);
  });
  renderBatchPhones();
}

function updateBatchSelectedCount() {
  $("#batchSelectedCount").textContent = `已选 ${selectedBatchPhoneIds.size} 个`;
}

async function loadBatchTasks() {
  try {
    const response = await fetch(`/api/auto-tasks?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取舒尔特任务失败。");
    renderBatchTasks((data.tasks || []).filter((task) => task.taskType === "schulte"));
  } catch (error) {
    $("#batchTaskList").innerHTML = `<div class="schulte-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderBatchTasks(tasks) {
  if (!tasks.length) {
    $("#batchTaskList").innerHTML = '<div class="schulte-empty">暂时没有舒尔特批量任务。</div>';
    return;
  }
  $("#batchTaskList").innerHTML = tasks.map((task) => {
    const progress = task.progress || {};
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || (task.status === "done" ? 100 : 0)));
    const generated = Array.isArray(task.generatedVideos) ? task.generatedVideos : [];
    const visibleVideos = generated.slice(0, 30);
    const links = visibleVideos
      .map((video, index) => `<a href="${escapeHtml(video.videoUrl)}" target="_blank" rel="noopener">视频 ${index + 1}</a>`)
      .join("");
    const remaining = generated.length > visibleVideos.length
      ? `<span class="schulte-task-more">其余 ${generated.length - visibleVideos.length} 条已保存在输出目录</span>`
      : "";
    const action = task.status === "failed"
      ? `<button type="button" data-batch-action="resume" data-id="${escapeHtml(task.id)}">重新执行</button>`
      : ["queued", "running"].includes(task.status)
        ? `<button type="button" data-batch-action="cancel" data-id="${escapeHtml(task.id)}">停止</button>`
        : "";
    const failed = Number(task.failedVideoCount) || 0;
    return `<article class="schulte-task-card">
      <div class="schulte-task-top"><strong>${escapeHtml(task.name)}</strong><span>${escapeHtml(batchStatusLabel(task.status))}</span></div>
      <p>${escapeHtml(task.message || task.error || "等待执行")}</p>
      <div class="schulte-task-progress"><i style="width:${percent}%"></i></div>
      <div class="schulte-task-metrics"><span>${Number(progress.current) || generated.length}/${Number(progress.total) || task.expectedVideoCount || 0} 条</span><span>成功 ${generated.length}${failed ? ` · 跳过 ${failed}` : ""}</span></div>
      <div class="schulte-task-actions">${links}${remaining}${action}</div>
    </article>`;
  }).join("");
}

async function handleBatchTaskAction(event) {
  const button = event.target.closest("button[data-batch-action]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/auto-tasks/${encodeURIComponent(button.dataset.id)}/${button.dataset.batchAction}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: "{}"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "任务操作失败。");
  } catch (error) {
    setBatchStatus(error.message || "任务操作失败。", true);
  }
  loadBatchTasks();
}

function updateBatchTemplateSummary() {
  const target = $("#batchTemplateSummary");
  if (!target) return;
  const templates = getSelectedBatchTemplates();
  if (!templates.length) {
    target.textContent = "尚未选择批量生成模板";
  } else if (templates.length > 1) {
    target.textContent = `已选 ${templates.length} 个：${templates.map(templateNumberLabel).join("、")} · 均衡随机轮换`;
  } else {
    const template = templates[0];
    target.textContent = template === "tracking"
      ? `模板 2：${trackingModeLabel($("#trackingMode")?.value)} · ${trackingBackgroundLabel($("#trackingBackground")?.value)}`
      : template === "memory"
        ? `模板 4：${clampNumber($("#memorySteps")?.value, 4, 8, 6)} 步位置记忆 · ${
            $("#memoryBackground")?.value === "auto"
              ? "7 套背景自动轮换"
              : memoryBackgroundLabel($("#memoryBackground")?.value)
          }`
        : template === "peripheral"
          ? `模板 5：捕捉 ${clampNumber($("#peripheralTargets")?.value, 2, 5, 3)} 个目标图形`
          : `模板 1：${trainingModeLabel($("#trainingMode")?.value)} · ${layoutStyleLabel($("#layoutStyle")?.value)}布局 · ${backgroundStyleLabel($("#backgroundStyle")?.value)}`;
  }
  const variation = $("#batchVariationPreview");
  if (variation) {
    if (templates.length > 1) {
      variation.textContent = "每轮让所有已选模板各生成一次并随机打乱；不足一轮时随机补齐，确保各模板数量尽量均衡。";
      return;
    }
    const template = templates[0] || selectedTemplate;
    const autoFields = template === "tracking"
      ? [
          $("#trackingMode")?.value === "auto" ? "追踪玩法" : "",
          $("#trackingBackground")?.value === "auto" ? "背景" : ""
        ].filter(Boolean)
      : template === "memory"
        ? [
            "题目路径",
            $("#memoryBackground")?.value === "auto" ? "7套背景" : ""
          ].filter(Boolean)
        : template === "peripheral"
          ? ["题目路径", "闪现顺序"]
      : [
          $("#trainingMode")?.value === "auto" ? "玩法" : "",
          $("#layoutStyle")?.value === "auto" ? "布局" : "",
          $("#backgroundStyle")?.value === "auto" ? "背景" : ""
        ].filter(Boolean);
    variation.textContent = autoFields.length
      ? `天数递增；${autoFields.join("、")}均匀轮换；随机种子不重复。`
      : "天数递增；当前玩法、布局和背景保持固定；随机种子不重复。";
  }
}

function updateBatchSequence() {
  const target = $("#batchSequencePreview");
  if (!target) return;
  const startDay = clampNumber($("#day").value, 1, 999, selectedTemplate === "tracking" ? 46 : 24);
  const total = clampNumber($("#batchTotalVideos").value, 1, 300, 30);
  const naturalEnd = startDay + total - 1;
  const endDay = ((naturalEnd - 1) % 999) + 1;
  target.textContent = naturalEnd <= 999
    ? `DAY ${startDay}–${endDay}`
    : `DAY ${startDay} 起，循环到 ${endDay}`;
}

function updateBatchPublishState() {
  const enabled = $("#batchAutoPublish").checked;
  $("#batchGroupFilter").disabled = !enabled;
  $("#batchNameFilter").disabled = !enabled;
  $("#batchSelectVisibleBtn").disabled = !enabled;
  $("#batchVideoDesc").disabled = !enabled;
  $("#batchScheduleAt").disabled = !enabled;
  $("#batchIntervalMinutes").disabled = !enabled;
  $("#batchPublishLimit").disabled = !enabled;
  $("#batchPhoneList").style.opacity = enabled ? "1" : "0.45";
  $("#batchPhoneList").style.pointerEvents = enabled ? "" : "none";
}

function setDefaultBatchSchedule() {
  if ($("#batchScheduleAt").value) return;
  const date = new Date(Date.now() + 30 * 60 * 1000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#batchScheduleAt").value = local;
}

function saveBatchSettings() {
  localStorage.setItem(BATCH_SETTINGS_KEY, JSON.stringify({
    templates: getSelectedBatchTemplates(),
    totalVideos: clampNumber($("#batchTotalVideos").value, 1, 300, 30),
    autoPublish: $("#batchAutoPublish").checked,
    videoDesc: $("#batchVideoDesc").value,
    intervalMinutes: clampNumber($("#batchIntervalMinutes").value, 0, 1440, 15),
    batchPublishLimit: clampNumber($("#batchPublishLimit").value, 1, 300, 300)
  }));
}

function applyBatchSettings(settings) {
  const templates = Array.isArray(settings.templates)
    ? settings.templates.filter((template) => SCHULTE_TEMPLATES.includes(template))
    : [selectedTemplate];
  document.querySelectorAll("[data-batch-template]").forEach((input) => {
    input.checked = templates.includes(input.dataset.batchTemplate);
  });
  $("#batchTotalVideos").value = String(clampNumber(settings.totalVideos, 1, 300, 30));
  $("#batchAutoPublish").checked = settings.autoPublish !== false;
  $("#batchVideoDesc").value = String(settings.videoDesc || "");
  $("#batchIntervalMinutes").value = String(clampNumber(settings.intervalMinutes, 0, 1440, 15));
  $("#batchPublishLimit").value = String(clampNumber(settings.batchPublishLimit, 1, 300, 300));
  updateBatchPublishState();
  updateBatchSequence();
  updateBatchTemplateSummary();
}

function setBatchStatus(message, isError = false) {
  const target = $("#batchStatusText");
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function batchStatusLabel(status) {
  return ({
    queued: "排队",
    running: "生成中",
    awaiting_review: "待发布",
    publishing: "发布中",
    checking: "核对中",
    retry_wait: "等待重试",
    retrying: "重试中",
    done: "已完成",
    failed: "失败",
    canceled: "已停止",
    needs_attention: "待处理"
  })[status] || status;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
}
