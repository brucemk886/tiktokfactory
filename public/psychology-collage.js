const $ = (selector) => document.querySelector(selector);
const JOB_KEY = "lf_psychology_collage_job";
let settingsConfigured = false;
let timer = null;

bind();
loadSettings();
updateEstimate();
if (localStorage.getItem(JOB_KEY)) poll(localStorage.getItem(JOB_KEY));

function bind() {
  $("#startBtn").addEventListener("click", start);
  $("#saveSettingsBtn").addEventListener("click", () => saveSettings(true));
  $("#pickMusicBtn").addEventListener("click", pickDirectory);
  ["#sceneCount", "#totalVideos"].forEach((selector) => $(selector).addEventListener("input", updateEstimate));
}

async function loadSettings() {
  try {
    const response = await fetch("/api/psychology/settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取配置失败。");
    settingsConfigured = Boolean(data.configured);
    $("#voiceId").value = data.elevenLabsVoiceId || "";
    $("#voiceModel").value = data.elevenLabsModelId || "eleven_multilingual_v2";
    $("#backgroundMusicDir").value = data.backgroundMusicDir || "";
    $("#backgroundMusicVolume").value = data.backgroundMusicVolume ?? .10;
    $("#settingsStatus").textContent = data.configured ? "Kie、ElevenLabs 和 Voice ID 已配置。" : "请补齐 Kie、ElevenLabs 或 Voice ID。";
  } catch (error) { $("#settingsStatus").textContent = error.message; }
}

async function saveSettings(showMessage) {
  const response = await fetch("/api/psychology/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kieApiKey: $("#kieApiKey").value.trim(),
      elevenLabsApiKey: $("#elevenLabsApiKey").value.trim(),
      elevenLabsVoiceId: $("#voiceId").value.trim(),
      elevenLabsModelId: $("#voiceModel").value,
      backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
      backgroundMusicVolume: number("#backgroundMusicVolume", .10),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存配置失败。");
  settingsConfigured = Boolean(data.settings?.configured);
  $("#kieApiKey").value = "";
  $("#elevenLabsApiKey").value = "";
  if (showMessage) $("#settingsStatus").textContent = settingsConfigured ? "生成配置已保存在本机。" : "仍缺少 API Key 或 Voice ID。";
  return settingsConfigured;
}

async function start() {
  const topic = $("#topic").value.trim();
  const scenes = clamp(number("#sceneCount", 10), 8, 12);
  const videos = clamp(number("#totalVideos", 1), 1, 3);
  if (topic.length < 4) return status("请输入至少 4 个字的选题。", true);
  if (!window.confirm(`将调用约 ${scenes * videos} 次 Kie.ai 生图，并进行 ${scenes} 段 ElevenLabs 配音。确认开始吗？`)) return;
  $("#startBtn").disabled = true;
  status("正在保存配置并创建任务...");
  try {
    if (!await saveSettings(false) || !settingsConfigured) throw new Error("请先补齐 Kie、ElevenLabs 和 Voice ID。");
    const response = await fetch("/api/psychology-collage/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        angle: $("#angle").value.trim(),
        script: $("#script").value.trim(),
        targetDuration: clamp(number("#targetDuration", 90), 60, 120),
        sceneCount: scenes,
        totalVideos: videos,
        credit: $("#credit").value.trim() || "@心理学",
        imageModel: document.querySelector('[name="imageModel"]:checked')?.value || "nano-banana",
        backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
        backgroundMusicVolume: clamp(number("#backgroundMusicVolume", .10), 0, .5),
        elevenLabsVoiceId: $("#voiceId").value.trim(),
        elevenLabsModelId: $("#voiceModel").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败。");
    localStorage.setItem(JOB_KEY, data.jobId);
    $("#resultList").innerHTML = "";
    poll(data.jobId);
  } catch (error) {
    status(error.message, true);
    $("#startBtn").disabled = false;
  }
}

async function poll(jobId) {
  clearTimeout(timer);
  try {
    const response = await fetch(`/api/psychology-collage/progress/${encodeURIComponent(jobId)}?t=${Date.now()}`, { cache: "no-store" });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "读取任务状态失败。");
    render(job);
    if (["done", "failed", "canceled"].includes(job.status)) {
      $("#startBtn").disabled = false;
      if (job.status === "done") localStorage.removeItem(JOB_KEY);
      return;
    }
    $("#startBtn").disabled = true;
    timer = setTimeout(() => poll(jobId), 1600);
  } catch (error) {
    status(error.message, true);
    $("#startBtn").disabled = false;
  }
}

function render(job) {
  const percent = clamp(Number(job.percent) || (job.status === "done" ? 100 : 0), 0, 100);
  $("#progressPercent").textContent = `${Math.round(percent)}%`;
  $("#progressBar").style.width = `${percent}%`;
  $("#jobMessage").textContent = job.message || job.error || "执行中...";
  status(job.status === "failed" ? "生成失败" : "心理学拼贴任务执行中", job.status === "failed");
  if (job.score) {
    $("#scorePanel").hidden = false;
    $("#scorePanel").innerHTML = `<strong>脚本评分 ${escape(job.score.score)}/100</strong><br>${escape(Object.entries(job.score.dimensions || {}).map(([key, value]) => `${label(key)} ${value}`).join(" · "))}`;
  }
  $("#resultList").innerHTML = (job.results || []).map((result, index) => `<article class="collage-result"><strong>视频 ${index + 1} · ${Number(result.duration || 0).toFixed(1)} 秒 · ${escape(result.score)} 分</strong><div><a href="${escape(result.videoUrl)}" target="_blank">打开成片</a><a href="${escape(result.contactSheetUrl)}" target="_blank">五帧联系表</a></div></article>`).join("");
}

async function pickDirectory() {
  try {
    const response = await fetch("/api/select-directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initialPath: $("#backgroundMusicDir").value.trim(), title: "选择心理学背景音乐目录" }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "选择目录失败。");
    if (!data.canceled && data.path) $("#backgroundMusicDir").value = data.path;
  } catch (error) { status(error.message, true); }
}
function updateEstimate() { $("#imageEstimate").textContent = `预计 ${clamp(number("#sceneCount", 10), 8, 12) * clamp(number("#totalVideos", 1), 1, 3)} 张拼贴图`; }
function status(message, error = false) { $("#statusText").textContent = message; $("#statusText").style.color = error ? "#a33e36" : ""; }
function label(key) { return ({ structure: "结构", opening: "开头", pacing: "节奏", scanability: "字幕", retention: "留存", cta: "互动" })[key] || key; }
function number(selector, fallback) { const value = Number($(selector).value); return Number.isFinite(value) ? value : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || min)); }
function escape(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
