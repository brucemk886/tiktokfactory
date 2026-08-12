const rangeInput = document.querySelector("#officialRange");
const queryInput = document.querySelector("#officialQuery");
const refreshButton = document.querySelector("#refreshOfficialRecordsBtn");
const status = document.querySelector("#officialRecordsStatus");
const rows = document.querySelector("#officialRecordRows");

refreshButton?.addEventListener("click", loadRecords);
rangeInput?.addEventListener("change", loadRecords);
queryInput?.addEventListener("input", debounce(loadRecords, 300));
loadRecords();

async function loadRecords() {
  status.textContent = "正在读取官方 API 发布记录...";
  const params = new URLSearchParams({ range: rangeInput?.value || "7d", query: queryInput?.value.trim() || "", t: String(Date.now()) });
  try {
    const response = await fetch(`/api/official-publish-records?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取官方 API 发布记录失败。");
    renderSummary(data.summary || {});
    renderRows(data.records || []);
  } catch (error) {
    status.textContent = error.message || "读取官方 API 发布记录失败。";
    rows.innerHTML = '<tr><td colspan="8">暂时无法读取记录。</td></tr>';
  }
}

function renderSummary(summary) {
  setText("#officialRecordCount", summary.recordCount || 0);
  setText("#officialBatchCount", summary.batchCount || 0);
  setText("#officialAccountCount", summary.accountCount || 0);
  setText("#officialSubmittedCount", summary.submittedCount || 0);
}

function renderRows(records) {
  if (!records.length) {
    rows.innerHTML = '<tr><td colspan="8">暂无官方 API 本地发布记录。</td></tr>';
    status.textContent = "暂无官方 API 本地发布记录。";
    return;
  }
  rows.innerHTML = records.map((record) => {
    const batchIds = unique([...(Array.isArray(record.officialBatchIds) ? record.officialBatchIds : []), ...(Array.isArray(record.taskIds) ? record.taskIds : []), record.batchId]);
    return `<tr><td>${escapeHtml(formatMilliseconds(record.createdAt))}</td><td>${escapeHtml(formatSeconds(record.scheduleAt))}</td><td><strong>${escapeHtml(record.accountName || record.accountUsername || record.connectionId || record.assignedEnvId || "-")}</strong><br><span class="muted">${escapeHtml(record.accountUsername || record.connectionId || "")}</span></td><td>${escapeHtml(record.fileName || record.title || "-")}</td><td>${escapeHtml(record.autoTaskId || "手动提交")}</td><td>${escapeHtml(batchIds.join(", ") || "-")}</td><td>${escapeHtml(statusLabel(record.status))}</td><td>${escapeHtml(record.note || "已由 Signal Desk 接管后续发布")}</td></tr>`;
  }).join("");
  status.textContent = `已读取 ${records.length} 条官方 API 本地发布记录。`;
}

function statusLabel(value) { const item = String(value || ""); if (["submitted", "done"].includes(item)) return "已提交发布中台"; if (item === "failed") return "本地交接失败"; if (item === "needs_check") return "待人工核实"; return item || "-"; }
function formatMilliseconds(value) { const timestamp = Number(value); return Number.isFinite(timestamp) && timestamp > 0 ? formatDate(new Date(timestamp)) : "-"; }
function formatSeconds(value) { const timestamp = Number(value); return Number.isFinite(timestamp) && timestamp > 0 ? formatDate(new Date(timestamp * 1000)) : "-"; }
function formatDate(date) { const pad = (part) => String(part).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function unique(values) { return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))); }
function setText(selector, value) { const element = document.querySelector(selector); if (element) element.textContent = String(value); }
function debounce(fn, wait) { let timer = 0; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
