const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const FINAL_STATES = new Set(["success", "fail"]);
let kind = "image";
let tasks = [];
let pollTimer = 0;
let overviewSequence = 0;

$$("[data-kind]").forEach((button) => button.addEventListener("click", () => setKind(button.dataset.kind, true)));
$$('input[name="imageModel"]').forEach((input) => input.addEventListener("change", () => input.closest("label").classList.toggle("selected", input.checked)));
$("#videoModel").addEventListener("change", updateMediaOptions);
$("#aiForm").addEventListener("submit", submit);
$("#refreshBtn").addEventListener("click", loadOverview);
$("#taskList").addEventListener("click", handleTaskAction);

setKind("image", false);
loadOverview();

function setKind(nextKind, reload) {
  kind = ["image", "video", "analysis"].includes(nextKind) ? nextKind : "image";
  window.clearInterval(pollTimer);
  $$("[data-kind]").forEach((button) => button.classList.toggle("active", button.dataset.kind === kind));
  const analysis = kind === "analysis";
  $("#modeTitle").textContent = analysis ? "视频分析" : kind === "video" ? "AI 生视频" : "AI 生图";
  $("#providerKicker").textContent = analysis ? "VIDEO INTELLIGENCE" : "AI CREATION";
  $("#promptLabel").textContent = analysis ? "分析要求" : "画面描述";
  $("#prompt").placeholder = placeholderFor(kind);
  $("#imageModelPanel").hidden = kind !== "image";
  $("#videoModelPanel").hidden = kind !== "video";
  $("#noTextPanel").hidden = kind !== "image";
  $("#analysisUploadPanel").hidden = !analysis;
  $("#mediaOptions").hidden = analysis;
  $("#durationField").hidden = kind !== "video";
  $("#resolutionField").hidden = kind !== "video";
  $("#creditLabel").textContent = analysis ? "分析服务" : "可用积分";
  $("#credits").textContent = analysis ? "Google 官方优先" : "--";
  $("#submitHint").textContent = analysis
    ? "视频会安全上传并异步分析；临时文件会在任务结束后自动清理。"
    : "提交会消耗 Kie.ai 积分；多选模型会分别创建任务。";
  $("#submitBtn").textContent = analysis ? "上传并分析" : "开始生成";
  updateMediaOptions();
  if (reload) loadOverview();
}

function updateMediaOptions() {
  const minimax = kind === "video" && $("#videoModel").value === "minimax-h3";
  setOptions("#aspectRatio", minimax
    ? [["9:16", "竖版 9:16"], ["16:9", "横版 16:9"], ["1:1", "方形 1:1"], ["4:3", "横版 4:3"], ["3:4", "竖版 3:4"], ["21:9", "宽屏 21:9"]]
    : [["9:16", "竖版 9:16"], ["16:9", "横版 16:9"], ["1:1", "方形 1:1"], ["3:2", "横图 3:2"], ["2:3", "竖图 2:3"]], "9:16");
  setOptions("#duration", (minimax ? Array.from({ length: 12 }, (_, i) => i + 4) : [6, 10]).map((seconds) => [String(seconds), `${seconds} 秒`]), "6");
  setOptions("#resolution", minimax ? [["768P", "768P"], ["2K", "2K"]] : [["480p", "480p · 更快"], ["720p", "720p · 更清晰"]], minimax ? "768P" : "480p");
  $("#prompt").maxLength = minimax ? 7000 : 8000;
  if (kind === "video") $("#submitHint").textContent = minimax
    ? "MiniMax H3 文生视频 · 4–15 秒 · 768P / 2K；提交会消耗 Kie.ai 积分。"
    : "Grok Imagine 文生视频；提交会消耗 Kie.ai 积分。";
}

function setOptions(selector, options, fallback) {
  const select = $(selector);
  const previous = select.value;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  select.value = options.some(([value]) => value === previous) ? previous : fallback;
}

async function loadOverview() {
  const sequence = ++overviewSequence;
  $("#refreshBtn").disabled = true;
  try {
    const endpoint = kind === "analysis" ? "/api/gemini-video-analysis" : "/api/kie-ai";
    const data = await requestJson(endpoint);
    if (sequence !== overviewSequence) return;
    tasks = data.tasks || [];
    if (kind === "analysis") {
      $("#credits").textContent = data.configured === false ? "未配置" : data.fallbackConfigured ? "Google 官方 → Kie 兜底" : "Google 官方";
      $("#historyState").textContent = data.configured === false ? "视频分析服务未配置" : `${tasks.length} 条分析记录`;
    } else {
      $("#credits").textContent = data.credits === null || data.credits === undefined ? "--" : Number(data.credits).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
      $("#historyState").textContent = data.configured === false ? "Kie API Key 未配置" : `${tasks.length} 条记录`;
    }
    renderTasks();
    watchPending();
  } catch (error) {
    setMessage(error.message, true);
    $("#historyState").textContent = "读取失败";
  } finally {
    if (sequence === overviewSequence) $("#refreshBtn").disabled = false;
  }
}

async function submit(event) {
  event.preventDefault();
  const prompt = $("#prompt").value.trim();
  if (!prompt) return setMessage(kind === "analysis" ? "请输入分析要求。" : "请输入生成描述。", true);
  if (kind === "analysis") return submitAnalysis(prompt);

  const selectedModels = $$('input[name="imageModel"]:checked').map((input) => input.value);
  if (kind === "image" && !selectedModels.length) return setMessage("请至少选择一个生图模型。", true);
  const button = $("#submitBtn");
  button.disabled = true;
  button.textContent = "正在提交…";
  setMessage("正在向 Kie.ai 提交生成任务。", false);
  try {
    const modelRequests = kind === "image" ? selectedModels : [null];
    const results = await Promise.allSettled(modelRequests.map((imageModel) => requestJson("/api/kie-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, prompt, imageModel, videoModel: $("#videoModel").value, noImageText: $("#noImageText").checked, aspectRatio: $("#aspectRatio").value, duration: $("#duration").value, resolution: $("#resolution").value })
    })));
    const created = results.flatMap((result) => result.status === "fulfilled" ? [result.value.task] : []);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason?.message || String(result.reason)] : []);
    if (!created.length) throw new Error(failures[0] || "生成任务提交失败。");
    tasks = [...created, ...tasks];
    $("#prompt").value = "";
    renderTasks();
    watchPending();
    setMessage(failures.length ? `已提交 ${created.length} 个任务；${failures.length} 个模型失败：${failures.join("；")}` : `已提交 ${created.length} 个生成任务，结果会自动更新。`, Boolean(failures.length));
  } catch (error) {
    setMessage(error.message || "生成失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "开始生成";
  }
}

async function submitAnalysis(prompt) {
  const file = $("#analysisFile").files?.[0];
  if (!file) return setMessage("请选择需要分析的视频。", true);
  if (file.size > 500 * 1024 * 1024) return setMessage("单个视频不能超过 500 MB。", true);
  const mimeType = file.type || mimeForName(file.name);
  const button = $("#submitBtn");
  button.disabled = true;
  button.textContent = "准备上传…";
  try {
    const created = await requestJson("/api/gemini-video-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, fileName: file.name, mimeType, fileSize: file.size })
    });
    tasks = [created.task, ...tasks];
    renderTasks();
    const uploaded = await uploadVideo(created.uploadUrl, file, (percent) => {
      button.textContent = `上传 ${percent}%`;
      setMessage(`正在上传 ${file.name}：${percent}%`, false);
    });
    tasks = tasks.map((task) => task.id === uploaded.task.id ? uploaded.task : task);
    $("#prompt").value = "";
    $("#analysisFile").value = "";
    renderTasks();
    watchPending();
    setMessage("视频已上传，Google 官方 Gemini 3.8 Flash 正在分析；遇到限流或高负载会自动切换 Kie。可以离开页面，任务会继续运行。", false);
  } catch (error) {
    setMessage(error.message || "视频上传或分析任务启动失败。", true);
    loadOverview();
  } finally {
    button.disabled = false;
    button.textContent = "上传并分析";
  }
}

function uploadVideo(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    });
    xhr.addEventListener("load", () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `上传失败：HTTP ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("视频上传网络中断，请重试。")));
    xhr.send(file);
  });
}

function watchPending() {
  window.clearInterval(pollTimer);
  const activeIds = tasks.filter((task) => !FINAL_STATES.has(task.status)).map((task) => task.id);
  if (!activeIds.length) return;
  const activeKind = kind;
  pollTimer = window.setInterval(async () => {
    if (kind !== activeKind) return window.clearInterval(pollTimer);
    const base = activeKind === "analysis" ? "/api/gemini-video-analysis/" : "/api/kie-ai?id=";
    const refreshed = await Promise.all(activeIds.map((id) => requestJson(`${base}${encodeURIComponent(id)}`).then((data) => data.task).catch(() => null)));
    tasks = tasks.map((task) => refreshed.find((item) => item?.id === task.id) || task);
    renderTasks();
    if (tasks.every((task) => FINAL_STATES.has(task.status) || !activeIds.includes(task.id))) window.clearInterval(pollTimer);
  }, 4000);
}

function renderTasks() {
  $("#historyState").textContent = kind === "analysis" ? `${tasks.length} 条分析记录` : `${tasks.length} 条记录`;
  $("#taskList").innerHTML = tasks.length ? tasks.map(taskCard).join("") : `<div class="module-empty">${kind === "analysis" ? "还没有视频分析记录，从上方上传第一条视频。" : "还没有生成记录，从上方创建第一条内容。"}</div>`;
}

function taskCard(task) {
  const pending = !FINAL_STATES.has(task.status);
  const urls = Array.isArray(task.resultUrls) ? task.resultUrls : [];
  const media = task.kind === "image" && urls.length
    ? `<div class="ai-media-grid" data-count="${urls.length}">${urls.map((url, index) => `<figure class="ai-media-item"><img class="ai-media" src="${escapeHtml(url)}" alt="生成图片 ${index + 1}" loading="lazy" /><figcaption><span>${index + 1} / ${urls.length}</span><span class="ai-result-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="打开图片">↗</a><a href="${escapeHtml(url)}" download title="下载图片">↓</a></span></figcaption></figure>`).join("")}</div>`
    : task.kind === "video" && urls[0]
      ? `<video class="ai-media ai-video" src="${escapeHtml(urls[0])}" controls preload="metadata"></video>`
      : task.kind === "analysis" && task.resultText
        ? `<div class="ai-analysis-result-head"><span>分析结果</span><button type="button" data-copy-task="${escapeHtml(task.id)}">复制全文</button></div><pre class="ai-chat-result">${escapeHtml(task.resultText)}</pre>`
        : "";
  const progress = pending ? `<div class="ai-progress"><div><span style="width:${Math.max(5, Number(task.progress || 0))}%"></span></div><small>${task.progress ? `${task.progress}%` : "任务排队中"}</small></div>` : "";
  const usage = task.kind === "analysis" && (task.inputTokens || task.outputTokens) ? ` · ${Number(task.inputTokens || 0).toLocaleString("zh-CN")} 输入 / ${Number(task.outputTokens || 0).toLocaleString("zh-CN")} 输出 tokens` : "";
  return `<article class="ai-result-card ${task.kind === "analysis" ? "ai-analysis-card" : ""}">
    <div class="ai-result-meta"><span>${kindLabel(task)}</span><b class="ai-task-status ${escapeHtml(task.status)}">${statusLabel(task.status)}</b></div>
    ${task.fileName ? `<strong class="ai-analysis-file">${escapeHtml(task.fileName)} · ${formatBytes(task.fileSize)}</strong>` : ""}
    <p class="ai-result-prompt">${escapeHtml(task.prompt)}</p>
    ${media}${progress}
    ${task.error ? `<p class="ai-error">${escapeHtml(task.error)}</p>` : ""}
    <div class="ai-result-footer"><span>${formatTime(task.createdAt)}${Number(task.creditsConsumed) > 0 ? ` · ${Number(task.creditsConsumed).toLocaleString("zh-CN")} 积分` : ""}${usage}</span>${urls[0] ? `<span class="ai-result-actions"><a href="${escapeHtml(urls[0])}" target="_blank" rel="noreferrer" title="打开结果">↗</a><a href="${escapeHtml(urls[0])}" download title="下载">↓</a></span>` : ""}</div>
  </article>`;
}

async function handleTaskAction(event) {
  const button = event.target.closest("[data-copy-task]");
  if (!button) return;
  const task = tasks.find((item) => item.id === button.dataset.copyTask);
  if (!task?.resultText) return;
  await navigator.clipboard.writeText(task.resultText);
  const previous = button.textContent;
  button.textContent = "已复制";
  window.setTimeout(() => { button.textContent = previous; }, 1200);
}

function kindLabel(task) {
  if (task.kind === "analysis") return `视频分析 · Gemini 3.8 Flash · ${task.provider === "kie" ? "Kie 兜底" : "Google 官方"}`;
  if (task.model === "google/nano-banana") return "图片 · Nano Banana 标准版";
  if (task.model === "grok-imagine/text-to-image") return "图片 · Grok Imagine";
  if (task.model === "z-image") return "图片 · Z-Image";
  if (task.model === "minimax-h3/text-to-video") return "视频 · MiniMax H3";
  if (task.kind === "video") return "视频 · Grok Imagine Video";
  return "图片";
}

function statusLabel(status) {
  if (status === "success") return "已完成";
  if (status === "fail") return "失败";
  if (status === "uploading") return "等待上传";
  if (status === "processing") return "分析中";
  if (status === "generating") return "生成中";
  return "排队中";
}

function placeholderFor(value) {
  if (value === "analysis") return "例如：请总结视频内容，并分析开头钩子、叙事结构、关键场景、情绪变化、留存亮点和可复用的创作方法。用中文分点输出。";
  if (value === "video") return "例如：第一人称镜头穿过雨夜的纽约街道，霓虹反射在湿润路面，电影感，镜头缓慢推进……";
  return "例如：竖版电影海报，一名女性坐在复古唱片机旁，暖色灯光，细腻胶片颗粒，画面上方留出标题空间……";
}

function mimeForName(name) {
  const extension = String(name).split(".").pop().toLowerCase();
  return ({ mp4: "video/mp4", mpeg: "video/mpeg", mpg: "video/mpeg", mov: "video/quicktime", avi: "video/x-msvideo", flv: "video/x-flv", webm: "video/webm", wmv: "video/x-ms-wmv", "3gp": "video/3gpp" })[extension] || "application/octet-stream";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function setMessage(message, error) {
  $("#aiMessage").textContent = message;
  $("#aiMessage").classList.toggle("error", Boolean(error));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(Number(value) || Date.now());
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
