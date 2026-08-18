const summaryEl = document.querySelector("#queueSummary");
const listEl = document.querySelector("#queueList");
let pollTimer = 0;

loadQueue();

async function loadQueue() {
  clearTimeout(pollTimer);
  try {
    const response = await fetch(`/api/auto-tasks?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取本地队列失败。");
    const tasks = Array.isArray(data.tasks) ? data.tasks.filter((task) => !task.deleted) : [];
    renderSummary(tasks, data.worker || {});
    renderTasks(tasks);
  } catch (error) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "读取本地队列失败。")}</div>`;
  }
  if (!document.hidden) pollTimer = setTimeout(loadQueue, 3000);
}

function renderSummary(tasks, worker) {
  const running = tasks.filter((task) => isActive(task)).length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const generated = tasks.reduce((sum, task) => sum + Number(task.generatedVideos?.length || task.progress?.current || 0), 0);
  summaryEl.innerHTML = [
    card("正在执行", running),
    card("排队中", queued),
    card("已生成视频", generated),
    card("工人", worker.running === false ? "未启动" : worker.activeTaskId ? "忙碌" : "空闲")
  ].join("");
}

function renderTasks(tasks) {
  const visible = [...tasks].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)).slice(0, 40);
  if (!visible.length) {
    listEl.innerHTML = '<div class="empty-state"><strong>本机暂无任务</strong><span>线上工厂下发的出片，或 GeeLark 备用任务，都会出现在这里。</span></div>';
    return;
  }
  listEl.innerHTML = visible.map((task) => {
    const progress = task.phase === "publishing" || task.phase === "retrying" ? task.publishProgress : task.progress;
    const current = Number(progress?.current || task.generatedVideos?.length || 0);
    const total = Number(progress?.total || task.expectedVideoCount || 0);
    const percent = total > 0 ? Math.round(current / total * 100) : Number(progress?.percent || 0);
    const uploads = (task.publishResults || []).filter((item) => item.status === "submitted" || item.status === "success").length;
    return `<article class="queue-item" data-status="${escapeAttr(task.status)}">
      <div class="queue-item-head">
        <div>
          <strong>${escapeHtml(task.name || "未命名任务")}</strong>
          <small>${escapeHtml(formatTime(task.updatedAt || task.createdAt))}</small>
        </div>
        <span class="queue-badge">${escapeHtml(statusLabel(task.status, task.phase))}</span>
      </div>
      <div class="queue-meta">
        <span class="queue-badge">${escapeHtml(sourceLabel(task))}</span>
        <span class="queue-badge">出片 ${current}${total ? `/${total}` : ""}</span>
        <span class="queue-badge">上传 ${uploads}</span>
      </div>
      <div class="queue-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, percent))}%"></i></div>
      <p>${escapeHtml(task.message || "等待执行")}</p>
    </article>`;
  }).join("");
}

function card(label, value) {
  return `<article><small>${escapeHtml(label)}</small><b>${escapeHtml(String(value))}</b></article>`;
}

function isActive(task) {
  return task.status === "running" || ["generating", "publishing", "checking", "retrying"].includes(task.phase);
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
