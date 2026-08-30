const summaryEl = document.querySelector("#queueSummary");
const listEl = document.querySelector("#queueList");
const refreshBtn = document.querySelector("#refreshQueueBtn");

refreshBtn?.addEventListener("click", loadQueue);
loadQueue();

async function loadQueue() {
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const response = await fetch(`/api/auto-tasks?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取本地队列失败。");
    const tasks = Array.isArray(data.tasks) ? data.tasks.filter((task) => !task.deleted) : [];
    renderSummary(tasks, data.worker || {}, data.watchdog || {});
    renderTasks(tasks);
  } catch (error) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "读取本地队列失败。")}</div>`;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function renderSummary(tasks, worker, watchdog = {}) {
  const running = tasks.filter((task) => isActive(task)).length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const generated = tasks.reduce((sum, task) => sum + Number(task.generatedVideos?.length || task.progress?.current || 0), 0);
  summaryEl.innerHTML = [
    card("正在执行", running),
    card("排队中", queued),
    card("已生成视频", generated),
    card("工人", worker.running === false ? "未启动" : worker.activeTaskId ? "忙碌" : "空闲"),
    card("守护", watchdog.running ? (watchdog.restartCount ? `已拉起${watchdog.restartCount}次` : "在跑") : "未开")
  ].join("");
  const note = document.querySelector("#watchdogNote");
  if (note) note.textContent = watchdog.message || "";
}

function renderTasks(tasks) {
  const visible = [...tasks].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)).slice(0, 40);
  if (!visible.length) {
    listEl.innerHTML = '<div class="empty-state"><strong>本机暂无任务</strong><span>线上工厂下发的出片，或 GeeLark 备用任务，都会出现在这里。</span></div>';
    return;
  }
  listEl.innerHTML = visible.map((task) => {
    const generatedCount = Array.isArray(task.generatedVideos) ? task.generatedVideos.length : Number(task.progress?.current || 0);
    const expectedCount = Number(task.expectedVideoCount || task.generation?.totalVideos || 0);
    const uploading = isUploading(task);
    const progress = uploading ? (task.publishProgress || task.progress) : task.progress;
    const current = Number(progress?.current || generatedCount || 0);
    const total = Number(progress?.total || expectedCount || 0);
    const percent = total > 0 ? Math.round(current / total * 100) : Number(progress?.percent || 0);
    const uploads = (task.publishResults || []).filter((item) => item.status === "submitted" || item.status === "success").length;
    return `<article class="queue-item" data-status="${escapeAttr(task.status)}">
      <div class="queue-item-head">
        <div>
          <strong>${escapeHtml(task.name || "未命名任务")}</strong>
          <small>${escapeHtml(formatTime(task.updatedAt || task.createdAt))}</small>
        </div>
        <div class="queue-item-actions">
          <span class="queue-badge">${escapeHtml(statusLabel(task.status, uploading ? "publishing" : task.phase))}</span>
          ${canStop(task) ? `<button class="queue-stop-btn" type="button" data-action="cancel" data-id="${escapeAttr(task.id)}">停止</button>` : ""}
        </div>
      </div>
      <div class="queue-meta">
        <span class="queue-badge">${escapeHtml(sourceLabel(task))}</span>
        <span class="queue-badge">出片 ${generatedCount}${expectedCount ? `/${expectedCount}` : ""}</span>
        <span class="queue-badge">${uploading && !uploads ? `并行上传 ${total || generatedCount || ""}`.trim() : `上传 ${uploads}`}</span>
      </div>
      <div class="queue-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, percent))}%"></i></div>
      <p>${escapeHtml(displayMessage(task))}</p>
      ${renderTaskVideos(task)}
    </article>`;
  }).join("");
  listEl.querySelectorAll("button[data-action='cancel']").forEach((button) => {
    button.addEventListener("click", stopTask);
  });
}

async function stopTask(event) {
  const button = event.currentTarget;
  const taskId = button.dataset.id;
  if (!taskId) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/auto-tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "停止任务失败。");
    await loadQueue();
  } catch (error) {
    button.disabled = false;
    alert(error.message || "停止任务失败。");
  }
}

function renderTaskVideos(task) {
  const videos = Array.isArray(task.generatedVideos) ? task.generatedVideos : [];
  const uploads = Array.isArray(task.publishResults) ? task.publishResults : [];
  if (!videos.length && !uploads.length) return "";
  const videoRows = videos.map((video, index) => {
    const url = previewVideoUrl(video);
    const name = video.fileName || video.audioName || `视频 ${index + 1}`;
    return `<li>${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>` : `<span>${escapeHtml(name)}</span>`}<small>${escapeHtml(video.audioName || "")}</small></li>`;
  }).join("");
  const uploadRows = uploads.map((item) => {
    const account = item.username || item.name || item.connectionId || "未分配账号";
    return `<li><span>${escapeHtml(item.fileName || "未命名成片")}</span><small>${escapeHtml(account)} · ${escapeHtml(uploadStatusLabel(item.status))}${item.scheduleAt ? ` · ${formatTime(Number(item.scheduleAt) * 1000)}` : ""}</small></li>`;
  }).join("");
  return `<details class="queue-videos">
    <summary>查看要上传的视频（${videos.length} 条成片${uploads.length ? ` · ${uploads.length} 条上传记录` : ""}）</summary>
    ${videos.length ? `<div><strong>已生成</strong><ul>${videoRows}</ul></div>` : ""}
    ${uploads.length ? `<div><strong>上传队列</strong><ul>${uploadRows}</ul></div>` : ""}
  </details>`;
}

function previewVideoUrl(video) {
  const fileName = String(video?.fileName || "").trim();
  if (fileName) return `/outputs/${encodeURIComponent(fileName)}`;
  const url = String(video?.videoUrl || "");
  return url.startsWith("/outputs/") ? url : "";
}

function uploadStatusLabel(status) {
  return ({
    queued: "待上传",
    submitted: "已提交",
    success: "已发布",
    pending: "处理中",
    failed: "失败",
    skipped: "已跳过",
    needs_check: "待核验"
  })[status] || status || "未知";
}

function card(label, value) {
  return `<article><small>${escapeHtml(label)}</small><b>${escapeHtml(String(value))}</b></article>`;
}

function isUploading(task) {
  if (["done", "failed", "canceled", "cancelled", "needs_attention"].includes(String(task.status || ""))) return false;
  return task.phase === "publishing"
    || task.phase === "retrying"
    || /正在(?:并行)?上传|正在提交第|正在提交到|准备提交中台|正在提交 TikTok/.test(String(task.message || ""));
}

function displayMessage(task) {
  const message = String(task.message || "等待执行");
  const sequential = message.match(/正在上传第\s*\d+\s*\/\s*(\d+)\s*条成片(?:（约\s*(\d+)MB）)?/);
  if (!sequential) return message;
  const total = Number(task.generatedVideos?.length || task.generation?.totalVideos || sequential[1] || 0);
  const megabytes = sequential[2] ? `，每条约 ${sequential[2]}MB` : "";
  return total ? `正在并行上传 ${total} 条成片${megabytes}...` : "正在并行上传成片...";
}

function isActive(task) {
  return task.status === "running" || ["generating", "publishing", "checking", "retrying"].includes(task.phase);
}

function canStop(task) {
  return ["queued", "running"].includes(task.status)
    || ["generating", "publishing", "checking", "retry_wait", "retrying"].includes(task.phase);
}

function sourceLabel(task) {
  if (task.source === "factory-cloud") return "线上工厂";
  if (task.publish?.provider === "official") return "官方通道";
  return "GeeLark 备用";
}

function statusLabel(status, phase) {
  const labels = {
    queued: "排队",
    running: "执行中",
    generating: "出片中",
    publishing: "上传中",
    done: "完成",
    failed: "失败",
    canceled: "已取消",
    awaiting_review: "待确认",
    needs_attention: "需处理"
  };
  return labels[phase] || labels[status] || status || "未知";
}

function formatTime(value) {
  const date = new Date(Number(value) || 0);
  if (!Number(value) || Number.isNaN(date.getTime())) return "刚刚";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
