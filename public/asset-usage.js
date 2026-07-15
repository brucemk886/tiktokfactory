const groupSelect = document.querySelector("#groupSelect");
const refreshButton = document.querySelector("#refreshUsageBtn");
const reindexButton = document.querySelector("#reindexUsageBtn");
const usageStatus = document.querySelector("#usageStatus");
const folderRows = document.querySelector("#folderRows");
const assetRows = document.querySelector("#assetRows");

refreshButton?.addEventListener("click", loadUsage);
reindexButton?.addEventListener("click", startReindex);
groupSelect?.addEventListener("change", loadUsage);
loadUsage();

async function loadUsage() {
  usageStatus.textContent = "正在读取素材使用记录...";
  refreshButton.disabled = true;
  try {
    const groupId = groupSelect.value || "";
    const response = await fetch(`/api/asset-usage?groupId=${encodeURIComponent(groupId)}&t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取素材使用率失败。");
    updateGroups(data.groups || [], data.group?.id || "");
    renderDashboard(data);
  } catch (error) {
    usageStatus.textContent = error.message || "读取素材使用率失败。";
    folderRows.innerHTML = `<tr><td colspan="8">暂无可用素材组。</td></tr>`;
    assetRows.innerHTML = `<tr><td colspan="8">暂无数据。</td></tr>`;
  } finally {
    refreshButton.disabled = false;
  }
}

async function startReindex() {
  const groupId = groupSelect.value || "";
  if (!groupId) return;
  reindexButton.disabled = true;
  refreshButton.disabled = true;
  usageStatus.textContent = "正在创建素材索引任务...";
  try {
    const response = await fetch("/api/asset-usage/reindex/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建素材索引任务失败。");
    await pollReindex(data.jobId);
    await loadUsage();
  } catch (error) {
    usageStatus.textContent = error.message || "更新素材索引失败。";
  } finally {
    reindexButton.disabled = false;
    refreshButton.disabled = false;
  }
}

async function pollReindex(jobId) {
  while (true) {
    const response = await fetch(`/api/asset-usage/reindex/progress/${encodeURIComponent(jobId)}?t=${Date.now()}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "读取索引进度失败。");
    usageStatus.textContent = `${job.message || "正在更新素材索引"} ${job.percent || 0}%`;
    if (job.status === "done") return;
    if (job.status === "failed" || job.status === "canceled") throw new Error(job.message || "更新素材索引失败。");
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

function updateGroups(groups, selectedId) {
  const current = groupSelect.value;
  groupSelect.innerHTML = groups.length
    ? groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)} · ${Number(group.totalAssets) || 0} 条</option>`).join("")
    : `<option value="">暂无素材组</option>`;
  const target = groups.some((group) => group.id === current) ? current : selectedId;
  if (target) groupSelect.value = target;
}

function renderDashboard(data) {
  const summary = data.summary || {};
  setText("#totalAssets", summary.totalAssets || 0);
  setText("#totalDuration", formatDuration(summary.totalDuration));
  setText("#actualUsePercent", formatPercent(actualUsePercent(summary)));
  setText("#coveragePercent", formatPercent(summary.coveragePercent));
  setText("#generatedVideos", data.group?.generatedVideos || 0);
  usageStatus.textContent = data.group
    ? `${data.group.name} · ${data.folders?.length || 0} 个子文件夹 · 实际使用率按秒计算，5秒片段触达率按区间计算`
    : "尚未导入素材组。先在 Reddit 生成器中使用一次该素材目录。";
  renderFolders(data.folders || []);
  renderAssets(data.highReuseAssets || []);
}

function renderFolders(rows) {
  if (!rows.length) {
    folderRows.innerHTML = `<tr><td colspan="8">暂无子文件夹素材。</td></tr>`;
    return;
  }
  folderRows.innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.folder)}</strong></td>
      <td>${row.totalAssets}</td>
      <td>${formatDuration(row.totalDuration)}</td>
      <td>${formatDuration(row.usedSeconds)}</td>
      <td>${progressCell(actualUsePercent(row), "actual")}</td>
      <td>${progressCell(row.coveragePercent, "coverage")}</td>
      <td>${reuseCell(row)}</td>
      <td>${riskBadge(row.risk)}</td>
    </tr>
  `).join("");
}

function renderAssets(rows) {
  if (!rows.length) {
    assetRows.innerHTML = `<tr><td colspan="8">当前没有已使用的素材。</td></tr>`;
    return;
  }
  assetRows.innerHTML = rows.map((row) => `
    <tr>
      <td class="usage-file">${escapeHtml(row.fileName)}</td>
      <td>${escapeHtml(row.folder)}</td>
      <td>${formatDuration(row.duration)}</td>
      <td>${row.usedCount}</td>
      <td>${formatPercent(actualUsePercent(row))}</td>
      <td>${formatPercent(row.coveragePercent)}</td>
      <td>${reuseCell(row)}</td>
      <td>${riskBadge(row.risk)}</td>
    </tr>
  `).join("");
}

function progressCell(value, type) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="usage-progress ${type}"><span><i style="width:${percent}%"></i></span><b>${formatPercent(percent)}</b></div>`;
}

function reuseCell(row) {
  const reusedBuckets = Math.max(0, Number(row.reusedBuckets) || 0);
  const maxBucketReuse = Math.max(0, Number(row.maxBucketReuse) || 0);
  const peak = reusedBuckets > 0 && maxBucketReuse > 1 ? `${maxBucketReuse}次` : "无";
  return `<div class="reuse-cell"><strong>重复区间：${reusedBuckets}个</strong><small>最高重复：${peak}</small></div>`;
}

function actualUsePercent(row) {
  const total = Math.max(0, Number(row.totalDuration ?? row.duration) || 0);
  const used = Math.max(0, Number(row.usedSeconds) || 0);
  return total ? Math.min(100, used / total * 100) : 0;
}

function riskBadge(risk) {
  const labels = { low: "低复用", medium: "需关注", high: "高复用" };
  return `<span class="usage-risk ${escapeHtml(risk || "low")}">${labels[risk] || labels.low}</span>`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return minutes ? `${minutes}m ${String(remaining).padStart(2, "0")}s` : `${remaining}s`;
}

function formatPercent(value) { return `${Math.round(Number(value) || 0)}%`; }
function setText(selector, value) { const target = document.querySelector(selector); if (target) target.textContent = String(value); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
