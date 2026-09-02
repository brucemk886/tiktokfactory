const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "lf_psychology_mid_settings";
const JOB_KEY = "lf_psychology_mid_job";
const QUIZ_TYPES = ["auto", "hidden-number", "position-choice", "character-choice", "embrace-choice"];
let selectedQuizType = "auto";
let settingsConfigured = false;
let elevenLabsConfigured = false;
let elevenLabsVoiceConfigured = false;
let pollTimer = null;

initialize();

async function initialize() {
  restoreLocalSettings();
  selectQuizType(selectedQuizType);
  updateGenerateLabel();
  bindEvents();
  await loadSettings();
  const jobId = localStorage.getItem(JOB_KEY);
  if (jobId) pollJob(jobId);
}

function bindEvents() {
  document.querySelectorAll("[data-quiz-type]").forEach((button) => {
    button.addEventListener("click", () => selectQuizType(button.dataset.quizType));
  });
  $("#startBtn").addEventListener("click", startJob);
  $("#saveSettingsBtn").addEventListener("click", () => saveSettings(true));
  $("#pickMusicBtn").addEventListener("click", pickMusicDirectory);
  $("#totalVideos").addEventListener("input", updateGenerateLabel);
  ["#topic", "#angle", "#script", "#targetDuration", "#totalVideos", "#credit", "#backgroundMusicDir", "#backgroundMusicVolume"].forEach((selector) => {
    $(selector).addEventListener("change", saveLocalSettings);
  });
  document.querySelectorAll('[name="imageModel"]').forEach((input) => input.addEventListener("change", saveLocalSettings));
}

async function loadSettings() {
  try {
    const response = await fetch("/api/psychology/settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取配置失败。");
    settingsConfigured = Boolean(data.kieConfigured || data.configured);
    elevenLabsConfigured = Boolean(data.elevenLabsConfigured);
    elevenLabsVoiceConfigured = Boolean(data.elevenLabsVoiceId);
    if (!$("#elevenLabsVoiceId").value) $("#elevenLabsVoiceId").value = data.elevenLabsVoiceId || "";
    $("#elevenLabsModelId").value = data.elevenLabsModelId || "eleven_multilingual_v2";
    if (!$("#backgroundMusicDir").value) $("#backgroundMusicDir").value = data.backgroundMusicDir || "";
    if (!localStorage.getItem(STORAGE_KEY)) $("#backgroundMusicVolume").value = data.backgroundMusicVolume ?? 0.10;
    renderSettingsStatus();
  } catch (error) {
    $("#settingsStatus").textContent = error.message;
  }
}

async function saveSettings(showMessage = false) {
  const payload = {
    kieApiKey: $("#kieApiKey").value.trim(),
    elevenLabsApiKey: $("#elevenLabsApiKey").value.trim(),
    elevenLabsVoiceId: $("#elevenLabsVoiceId").value.trim(),
    elevenLabsModelId: $("#elevenLabsModelId").value.trim() || "eleven_multilingual_v2",
    backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
    backgroundMusicVolume: numberValue("#backgroundMusicVolume", 0.10),
  };
  const response = await fetch("/api/psychology/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存配置失败。");
  settingsConfigured = Boolean(data.settings?.kieConfigured || data.settings?.configured);
  elevenLabsConfigured = Boolean(data.settings?.elevenLabsConfigured);
  elevenLabsVoiceConfigured = Boolean(data.settings?.elevenLabsVoiceId);
  $("#kieApiKey").value = "";
  $("#elevenLabsApiKey").value = "";
  if (showMessage) {
    setStatus(settingsConfigured ? "生成配置已保存在本机。英文走 Kokoro，中文走 ElevenLabs。" : "已保存，但仍缺少 Kie.ai API Key。");
    renderSettingsStatus();
  }
  saveLocalSettings();
  return settingsConfigured;
}

async function startJob() {
  const topic = $("#topic").value.trim();
  if (topic.length < 4) return setStatus("请输入至少 4 个字的心理学选题。", true);
  const script = $("#script").value.trim();
  const language = hasChineseText(script) ? "zh-CN" : "en";
  const ttsLabel = language === "zh-CN" ? "ElevenLabs（会使用额度）" : "本机 Kokoro（不消耗 ElevenLabs）";
  const totalVideos = clamp(numberValue("#totalVideos", 1), 1, 3);
  const duration = Math.round(clamp(numberValue("#targetDuration", 16), 12, 20));
  const confirmed = window.confirm(`心理学目标2 · ${language === "zh-CN" ? "中文" : "英文"} · ${quizTypeLabel(selectedQuizType)} · ${duration} 秒 · ${totalVideos} 条。预计调用 Kie 生图 ${totalVideos} 次；配音使用 ${ttsLabel}，整段只生成一次。确认开始吗？`);
  if (!confirmed) return;

  $("#startBtn").disabled = true;
  setStatus("正在保存配置并创建心理学任务...");
  setProgress(3);
  try {
    const configured = await saveSettings(false);
    if (!configured || !settingsConfigured) throw new Error("请先补齐 Kie.ai API Key。");
    if (language === "zh-CN" && (!elevenLabsConfigured || !elevenLabsVoiceConfigured)) {
      throw new Error("检测到中文文案，请先配置 ElevenLabs API Key 和 Voice ID。");
    }
    const payload = {
      topic,
      angle: $("#angle").value.trim(),
      script,
      language,
      quizType: selectedQuizType,
      targetDuration: duration,
      totalVideos,
      imageModel: document.querySelector('[name="imageModel"]:checked')?.value || "nano-banana",
      credit: $("#credit").value.trim() || (language === "zh-CN" ? "一知心理课 一场心灵旅" : "PSYCHOLOGY LAB"),
      backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
      backgroundMusicVolume: clamp(numberValue("#backgroundMusicVolume", 0.10), 0, 0.5),
      kokoroVoice: $("#kokoroVoice")?.value || "am_adam",
      elevenLabsVoiceId: $("#elevenLabsVoiceId").value.trim(),
      elevenLabsModelId: $("#elevenLabsModelId").value.trim() || "eleven_multilingual_v2",
    };
    saveLocalSettings();
    const response = await fetch("/api/psychology-narrative/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败。");
    localStorage.setItem(JOB_KEY, data.jobId);
    $("#resultList").innerHTML = "";
    pollJob(data.jobId);
  } catch (error) {
    setStatus(error.message, true);
    $("#startBtn").disabled = false;
  }
}

async function pollJob(jobId) {
  clearTimeout(pollTimer);
  try {
    const response = await fetch(`/api/psychology-narrative/progress/${encodeURIComponent(jobId)}?t=${Date.now()}`, { cache: "no-store" });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "读取任务状态失败。");
    renderJob(job);
    if (["done", "failed", "canceled"].includes(job.status)) {
      $("#startBtn").disabled = false;
      if (job.status === "done") localStorage.removeItem(JOB_KEY);
      return;
    }
    $("#startBtn").disabled = true;
    pollTimer = setTimeout(() => pollJob(jobId), 1600);
  } catch (error) {
    setStatus(error.message, true);
    $("#startBtn").disabled = false;
  }
}

function renderJob(job) {
  const percent = clamp(Number(job.percent) || (job.status === "done" ? 100 : 0), 0, 100);
  setProgress(percent);
  setStatus(job.status === "failed" ? (job.message || "任务失败。") : (job.message || "心理学目标2任务执行中"), job.status === "failed");

  if (job.score) {
    $("#scorePanel").hidden = false;
    const dimensions = Object.entries(job.score.dimensions || {}).map(([name, value]) => `${dimensionLabel(name)} ${value}`).join(" · ");
    $("#scorePanel").innerHTML = `<strong>脚本评分 ${escapeHtml(job.score.score)}/100</strong><span>${escapeHtml(dimensions)}</span>`;
  }

  const results = Array.isArray(job.results) ? job.results : [];
  renderResults(results);
  if (results[0] && job.status === "done") showPreview(results[0]);
}

function renderResults(results) {
  const list = $("#resultList");
  list.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "psy-empty";
    empty.textContent = "还没有生成结果。";
    list.append(empty);
    return;
  }
  results.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "psy-result-card";
    const title = document.createElement("strong");
    title.textContent = item.title || item.fileName || `心理学目标2样片 ${index + 1}`;
    const meta = document.createElement("div");
    meta.className = "psy-result-meta";
    [item.templateLabel || "心理学 · 目标2", quizTypeLabel(item.quizType), item.language === "zh-CN" ? "中文 · ElevenLabs" : "English · Kokoro", `${Number(item.duration || 0).toFixed(1)} 秒`].forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      meta.append(chip);
    });
    const actions = document.createElement("div");
    actions.className = "psy-result-actions";
    const video = document.createElement("a");
    video.href = item.videoUrl;
    video.download = item.fileName || "";
    video.textContent = "下载 MP4";
    actions.append(video);
    if (item.contactSheetUrl) {
      const sheet = document.createElement("a");
      sheet.href = item.contactSheetUrl;
      sheet.target = "_blank";
      sheet.rel = "noopener";
      sheet.textContent = "五帧联系表";
      actions.append(sheet);
    }
    card.append(title, meta, actions);
    list.append(card);
  });
}

function showPreview(item) {
  const video = $("#previewVideo");
  video.src = item.videoUrl;
  video.classList.remove("is-hidden");
  $("#previewEmpty").classList.add("is-hidden");
  $("#previewMeta").textContent = `${item.title || "心理学 · 目标2"} · ${quizTypeLabel(item.quizType)} · ${item.language === "zh-CN" ? "中文 / ElevenLabs" : "English / Kokoro"} · ${Number(item.duration || 0).toFixed(1)} 秒`;
  const download = $("#downloadLink");
  download.href = item.videoUrl;
  download.download = item.fileName || "心理学-目标2.mp4";
  download.classList.remove("is-hidden");
  video.load();
}

async function pickMusicDirectory() {
  $("#pickMusicBtn").disabled = true;
  try {
    const response = await fetch("/api/select-directory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialPath: $("#backgroundMusicDir").value.trim(), title: "选择心理学视频背景音乐文件夹" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "选择目录失败。");
    if (!data.canceled && data.path) {
      $("#backgroundMusicDir").value = data.path;
      saveLocalSettings();
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    $("#pickMusicBtn").disabled = false;
  }
}

function selectQuizType(quizType) {
  selectedQuizType = QUIZ_TYPES.includes(quizType) ? quizType : "auto";
  document.querySelectorAll("[data-quiz-type]").forEach((button) => {
    const active = button.dataset.quizType === selectedQuizType;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", String(active));
  });
  saveLocalSettings();
}

function updateGenerateLabel() {
  const count = Math.round(clamp(numberValue("#totalVideos", 1), 1, 3));
  $("#startBtn").textContent = count > 1 ? `生成 ${count} 条目标2样片` : "生成一条目标2样片";
}

function saveLocalSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    topic: $("#topic").value,
    quizType: selectedQuizType,
    targetDuration: numberValue("#targetDuration", 16),
    totalVideos: numberValue("#totalVideos", 1),
    imageModel: document.querySelector('[name="imageModel"]:checked')?.value || "nano-banana",
    credit: $("#credit").value,
    kokoroVoice: $("#kokoroVoice")?.value || "am_adam",
    backgroundMusicDir: $("#backgroundMusicDir").value,
    backgroundMusicVolume: numberValue("#backgroundMusicVolume", 0.10),
  }));
}

function restoreLocalSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return;
    if (saved.topic) $("#topic").value = saved.topic;
    $("#targetDuration").value = saved.targetDuration || 16;
    $("#totalVideos").value = saved.totalVideos || 1;
    $("#credit").value = !saved.credit || saved.credit === "一知心理课 一场心灵旅" ? "PSYCHOLOGY LAB" : saved.credit;
    if (saved.kokoroVoice && $("#kokoroVoice")?.querySelector(`option[value="${saved.kokoroVoice}"]`)) {
      $("#kokoroVoice").value = saved.kokoroVoice;
    }
    $("#backgroundMusicDir").value = saved.backgroundMusicDir || "";
    $("#backgroundMusicVolume").value = saved.backgroundMusicVolume ?? 0.10;
    if (QUIZ_TYPES.includes(saved.quizType)) selectedQuizType = saved.quizType;
    else if (saved.layout === "single") selectedQuizType = "hidden-number";
    else if (saved.layout === "choices-4") selectedQuizType = "character-choice";
    const model = document.querySelector(`[name="imageModel"][value="${saved.imageModel}"]`);
    if (model) model.checked = true;
  } catch {}
}

function quizTypeLabel(value) {
  return ({
    auto: "自动识别",
    "hidden-number": "隐藏数字",
    "position-choice": "位置选择",
    "character-choice": "人物选择",
    "embrace-choice": "拥抱偏好",
  })[value] || "互动测试";
}

function dimensionLabel(name) {
  return ({ structure: "结构", opening: "开头", pacing: "节奏", scanability: "字幕", retention: "留存", cta: "互动", safety: "非诊断表达" })[name] || name;
}

function renderSettingsStatus() {
  if (!settingsConfigured) {
    $("#settingsStatus").textContent = "请补充 Kie.ai API Key。英文口播仍可使用本机 Kokoro。";
    return;
  }
  $("#settingsStatus").textContent = elevenLabsConfigured && elevenLabsVoiceConfigured
    ? "已就绪：英文走本机 Kokoro；检测到中文时自动走 ElevenLabs；生图走 Kie.ai。"
    : "英文生成已就绪：本机 Kokoro + Kie.ai。中文文案还需配置 ElevenLabs API Key 和 Voice ID。";
}

function hasChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function setStatus(message, error = false) {
  const node = $("#statusText");
  node.textContent = message;
  node.classList.toggle("error", error);
}

function setProgress(percent) {
  $("#progressBar").style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
}

function numberValue(selector, fallback) {
  const value = Number($(selector).value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
