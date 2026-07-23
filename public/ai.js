const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const FINAL_STATES = new Set(["success", "fail"]);
let kind = "image";
let tasks = [];
let pollTimer = 0;

$$("[data-kind]").forEach((button) => button.addEventListener("click", () => setKind(button.dataset.kind)));
$$('input[name="imageModel"]').forEach((input) => input.addEventListener("change", () => input.closest("label").classList.toggle("selected", input.checked)));
$("#aiForm").addEventListener("submit", submit);
$("#refreshBtn").addEventListener("click", loadOverview);

setKind("image");
loadOverview();

function setKind(nextKind) {
  kind = nextKind;
  $$('[data-kind]').forEach((button) => button.classList.toggle("active", button.dataset.kind === kind));
  const labels = { image: "AI 生图", video: "AI 生视频", chat: "AI 对话" };
  $("#modeTitle").textContent = labels[kind];
  $("#promptLabel").textContent = kind === "chat" ? "你想问什么" : "画面描述";
  $("#prompt").placeholder = placeholderFor(kind);
  $("#imageModelPanel").hidden = kind !== "image";
  $("#noTextPanel").hidden = kind !== "image";
  $("#mediaOptions").hidden = kind === "chat";
  $("#durationField").hidden = kind !== "video";
  $("#resolutionField").hidden = kind !== "video";
  $("#submitBtn").textContent = kind === "chat" ? "发送" : "开始生成";
}

async function loadOverview() {
  $("#refreshBtn").disabled = true;
  try {
    const data = await requestJson("/api/kie-ai");
    tasks = data.tasks || [];
    $("#credits").textContent = data.credits === null ? "--" : Number(data.credits).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    $("#historyState").textContent = data.configured ? `${tasks.length} 条记录` : "Kie API Key 未配置";
    renderTasks();
    schedulePolling();
  } catch (error) {
    setMessage(error.message, true);
    $("#historyState").textContent = "读取失败";
  } finally {
    $("#refreshBtn").disabled = false;
  }
}

async function submit(event) {
  event.preventDefault();
  const prompt = $("#prompt").value.trim();
  if (!prompt) return setMessage("请输入生成描述或对话内容。", true);
  const selectedModels = $$('input[name="imageModel"]:checked').map((input) => input.value);
  if (kind === "image" && !selectedModels.length) return setMessage("请至少选择一个生图模型。", true);

  const button = $("#submitBtn");
  button.disabled = true;
  button.textContent = kind === "chat" ? "正在回复…" : "正在提交…";
  setMessage(kind === "chat" ? "Gemini 正在生成回复。" : "正在向 Kie.ai 提交生成任务。", false);
  try {
    const modelRequests = kind === "image" ? selectedModels : [null];
    const results = await Promise.allSettled(modelRequests.map((imageModel) => requestJson("/api/kie-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        prompt,
        imageModel,
        noImageText: $("#noImageText").checked,
        aspectRatio: $("#aspectRatio").value,
        duration: $("#duration").value,
        resolution: $("#resolution").value
      })
    })));
    const created = results.flatMap((result) => result.status === "fulfilled" ? [result.value.task] : []);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason?.message || String(result.reason)] : []);
    if (!created.length) throw new Error(failures[0] || "生成任务提交失败。");
    tasks = [...created, ...tasks];
    $("#prompt").value = "";
    renderTasks();
    schedulePolling();
    setMessage(failures.length ? `已提交 ${created.length} 个任务；${failures.length} 个模型失败：${failures.join("；")}` : kind === "chat" ? "AI 已回复。" : `已提交 ${created.length} 个生成任务，结果会自动更新。`, Boolean(failures.length));
  } catch (error) {
    setMessage(error.message || "生成失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = kind === "chat" ? "发送" : "开始生成";
  }
}

function schedulePolling() {
  clearInterval(pollTimer);
  const active = tasks.filter((task) => !FINAL_STATES.has(task.status));
  if (!active.length) return;
  pollTimer = window.setInterval(refreshActiveTasks, 4000);
}

async function refreshActiveTasks() {
  const active = tasks.filter((task) => !FINAL_STATES.has(task.status));
  if (!active.length) return schedulePolling();
  const refreshed = await Promise.all(active.map((task) => requestJson(`/api/kie-ai/${encodeURIComponent(task.id)}`).then((data) => data.task).catch(() => null)));
  const byId = new Map(refreshed.filter(Boolean).map((task) => [task.id, task]));
  tasks = tasks.map((task) => byId.get(task.id) || task);
  renderTasks();
  if (!tasks.some((task) => !FINAL_STATES.has(task.status))) {
    clearInterval(pollTimer);
    pollTimer = 0;
    loadOverview();
  }
}

function renderTasks() {
  $("#historyState").textContent = `${tasks.length} 条记录`;
  $("#taskList").innerHTML = tasks.length ? tasks.map(taskCard).join("") : '<div class="module-empty">还没有生成记录，从上方创建第一条内容。</div>';
}

function taskCard(task) {
  const pending = !FINAL_STATES.has(task.status);
  const urls = Array.isArray(task.resultUrls) ? task.resultUrls : [];
  const media = task.kind === "image" && urls.length
    ? `<div class="ai-media-grid" data-count="${urls.length}">${urls.map((url, index) => `<figure class="ai-media-item"><img class="ai-media" src="${escapeHtml(url)}" alt="生成图片 ${index + 1}" loading="lazy" /><figcaption><span>${index + 1} / ${urls.length}</span><span class="ai-result-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="打开图片">↗</a><a href="${escapeHtml(url)}" download title="下载图片">↓</a></span></figcaption></figure>`).join("")}</div>`
    : task.kind === "video" && urls[0]
      ? `<video class="ai-media ai-video" src="${escapeHtml(urls[0])}" controls preload="metadata"></video>`
      : "";
  const resultText = task.resultText ? `<div class="ai-chat-result">${escapeHtml(task.resultText)}</div>` : "";
  const progress = pending ? `<div class="ai-progress"><div><span style="width:${Math.max(5, Number(task.progress || 0))}%"></span></div><small>${task.progress ? `${task.progress}%` : "任务排队中"}</small></div>` : "";
  return `<article class="ai-result-card">
    <div class="ai-result-meta"><span>${kindLabel(task)}</span><b class="ai-task-status ${escapeHtml(task.status)}">${statusLabel(task.status)}</b></div>
    <p class="ai-result-prompt">${escapeHtml(task.prompt)}</p>
    ${resultText}${media}${progress}
    ${task.error ? `<p class="ai-error">${escapeHtml(task.error)}</p>` : ""}
    <div class="ai-result-footer"><span>${formatTime(task.createdAt)}${Number(task.creditsConsumed) > 0 ? ` · ${Number(task.creditsConsumed).toLocaleString("zh-CN")} 积分` : ""}</span>${urls[0] ? `<span class="ai-result-actions"><a href="${escapeHtml(urls[0])}" target="_blank" rel="noreferrer" title="打开结果">↗</a><a href="${escapeHtml(urls[0])}" download title="下载">↓</a></span>` : ""}</div>
  </article>`;
}

function kindLabel(task) {
  if (task.model === "google/nano-banana") return "图片 · Nano Banana 标准版";
  if (task.model === "grok-imagine/text-to-image") return "图片 · Grok Imagine";
  if (task.kind === "video") return "视频 · Grok Imagine Video";
  return "对话 · Gemini 3.5 Flash";
}

function statusLabel(status) {
  if (status === "success") return "已完成";
  if (status === "fail") return "失败";
  if (status === "generating") return "生成中";
  return "排队中";
}

function placeholderFor(value) {
  if (value === "chat") return "例如：把这段 Reddit 故事改成适合 TikTok 的英文开场，前三秒制造冲突……";
  if (value === "video") return "例如：第一人称镜头穿过雨夜的纽约街道，霓虹反射在湿润路面，电影感，镜头缓慢推进……";
  return "例如：竖版电影海报，一名女性坐在复古唱片机旁，暖色灯光，细腻胶片颗粒，画面上方留出标题空间……";
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
