const statsRange = document.querySelector("#statsRange");
const statsGroup = document.querySelector("#statsGroup");
const statsAccount = document.querySelector("#statsAccount");
const refreshStatsBtn = document.querySelector("#refreshStatsBtn");
const statsStatus = document.querySelector("#statsStatus");
const statsRows = document.querySelector("#statsRows");
const statRecordCount = document.querySelector("#statRecordCount");
const statTaskCount = document.querySelector("#statTaskCount");
const statAccountCount = document.querySelector("#statAccountCount");
const statGroupCount = document.querySelector("#statGroupCount");
const retryPanel = document.querySelector("#retryPanel");
const retryList = document.querySelector("#retryList");
const retryCount = document.querySelector("#retryCount");

refreshStatsBtn?.addEventListener("click", loadStats);
statsRange?.addEventListener("change", loadStats);
statsGroup?.addEventListener("change", loadStats);
statsAccount?.addEventListener("input", debounce(loadStats, 300));
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-retry-record]");
  if (button) retryPublishRecord(button.dataset.retryRecord, button);
});

loadStats();

async function loadStats() {
  statsStatus.textContent = "正在读取发布记录...";
  const params = new URLSearchParams({
    range: statsRange.value,
    group: statsGroup.value,
    account: statsAccount.value.trim()
  });

  try {
    const response = await fetch(`/api/publish-records?${params.toString()}&t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取发布记录失败。");
    updateGroupOptions(data.filters?.groups || []);
    renderSummary(data.summary || {});
    renderRows(data.records || []);
    renderRetryList(data.records || []);
  } catch (error) {
    statsStatus.textContent = error.message || "读取发布记录失败。";
  }
}

function updateGroupOptions(groups) {
  const current = statsGroup.value;
  statsGroup.innerHTML = `<option value="">全部分组</option>${groups.map((group) => (
    `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`
  )).join("")}`;
  if (groups.includes(current)) statsGroup.value = current;
}

function renderSummary(summary) {
  statRecordCount.textContent = summary.recordCount || 0;
  statTaskCount.textContent = summary.taskCount || 0;
  statAccountCount.textContent = summary.accountCount || 0;
  statGroupCount.textContent = summary.groupCount || 0;
}

function renderRows(records) {
  if (!records.length) {
    statsRows.innerHTML = `<tr><td colspan="10">暂无发布记录。</td></tr>`;
    statsStatus.textContent = "暂无发布记录。";
    return;
  }

  statsRows.innerHTML = records.map((record) => {
    const taskIds = Array.isArray(record.taskIds) ? record.taskIds.join(", ") : "";
    const link = record.shareLink
      ? `<a href="${escapeHtml(record.shareLink)}" target="_blank" rel="noreferrer">TikTok</a>`
      : `<span class="muted">待回收</span>`;
    const retryAction = canRetry(record)
      ? `<button class="stats-retry-btn" data-retry-record="${escapeHtml(record.id)}">重新发布</button>`
      : `<span class="muted">-</span>`;
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(record.scheduleAt))}</td>
        <td>${escapeHtml(record.accountName || record.assignedEnvId || "-")}</td>
        <td>${escapeHtml(record.groupName || "-")}</td>
        <td>${escapeHtml(record.audioName || "-")}</td>
        <td>${escapeHtml(record.templateLabel || record.template || "-")}</td>
        <td>${escapeHtml(record.fileName || record.title || "-")}</td>
        <td>${escapeHtml(taskIds || "-")}</td>
        <td>${escapeHtml(statusLabel(record.status))}</td>
        <td>${link}</td>
        <td>${retryAction}</td>
      </tr>
    `;
  }).join("");
  statsStatus.textContent = `已读取 ${records.length} 条发布记录。`;
}

function renderRetryList(records) {
  const pending = records.filter(canRetry);
  if (!retryPanel || !retryList || !retryCount) return;
  retryPanel.hidden = false;
  retryCount.textContent = `${pending.length} 条`;
  retryList.innerHTML = pending.length ? pending.map((record) => `
    <div class="stats-retry-item">
      <div>
        <strong>${escapeHtml(record.fileName || record.title || "未命名视频")}</strong>
        <small>${escapeHtml(record.accountName || record.assignedEnvId || "-")} · ${escapeHtml(record.groupName || "未分组")} · ${escapeHtml(statusLabel(record.status))}</small>
        <small>${escapeHtml(record.note || "等待重新执行")}</small>
      </div>
      <button class="stats-retry-btn" data-retry-record="${escapeHtml(record.id)}">重新发布</button>
    </div>
  `).join("") : `<div class="stats-retry-empty">当前没有发布失败或待核实的任务。</div>`;
}

async function retryPublishRecord(recordId, button) {
  if (!recordId || !button) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "处理中...";
  statsStatus.textContent = "正在核对 GeeLark 并重新提交...";
  try {
    const response = await fetch(`/api/publish-records/${encodeURIComponent(recordId)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "重新发布失败。");
    statsStatus.textContent = "重新发布请求已处理。";
    await loadStats();
  } catch (error) {
    statsStatus.textContent = error.message || "重新发布失败。";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function canRetry(record) {
  return ["failed", "needs_check"].includes(String(record?.status || "")) && Boolean(record?.id);
}

function statusLabel(status) {
  if (status === "submitted") return "已提交";
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  if (status === "needs_check") return "待核实";
  if (status === "retried") return "已重新提交";
  return status || "-";
}

function formatDateTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const date = new Date(value * 1000);
  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
