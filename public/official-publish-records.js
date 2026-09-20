const rangeInput = document.querySelector("#officialRange");
const queryInput = document.querySelector("#officialQuery");
const refreshButton = document.querySelector("#refreshOfficialRecordsBtn");
const status = document.querySelector("#officialRecordsStatus");
const rows = document.querySelector("#officialRecordRows");

let recordPage=1,loadVersion=0;
function resetRecords(){recordPage=1;return loadRecords();}
document.querySelector('#recordsPrev').addEventListener('click',()=>{recordPage=Math.max(1,recordPage-1);loadRecords();});
document.querySelector('#recordsNext').addEventListener('click',()=>{recordPage++;loadRecords();});
refreshButton?.addEventListener("click", loadRecords);
rangeInput?.addEventListener("change", resetRecords);
queryInput?.addEventListener("input", debounce(resetRecords, 300));
installRecordTooltip();
loadRecords();

async function loadRecords() {
  const version=++loadVersion;
  document.querySelector('#recordsPrev').disabled=true;document.querySelector('#recordsNext').disabled=true;
  document.dispatchEvent(new Event("dismiss-record-tooltip"));
  status.textContent = "正在读取官方 API 发布记录...";
  const params = new URLSearchParams({ page:String(recordPage), range: rangeInput?.value || "7d", query: queryInput?.value.trim() || "", t: String(Date.now()) });
  try {
    const response = await fetch(`/api/official-publish-records?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取官方 API 发布记录失败。");
    if(version!==loadVersion)return;
    document.querySelector('#recordsPrev').disabled=recordPage<=1;document.querySelector('#recordsNext').disabled=!data.pagination?.hasMore;
    document.querySelector('#recordsPage').textContent='第 '+recordPage+' 页 · 共 '+(data.pagination?.total??data.records?.length??0)+' 条'+(data.pagination?' · 每页 50 条':'');
    renderSummary(data.summary || {});
    renderRows(data.records || []);
  } catch (error) {
    if(version!==loadVersion)return;
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
    const batchIds = record.autoBatchId ? unique([record.batchId]) : unique([...(Array.isArray(record.officialBatchIds) ? record.officialBatchIds : []), ...(Array.isArray(record.taskIds) ? record.taskIds : []), record.batchId]);
    const openUrl = record.shareLink || record.videoUrl || "";
    const canOpen = /tiktok\.com\/@[\w.]+\/(?:video|photo)\/\d{10,}/i.test(openUrl);
    const note = clippedText(recordNote(record));
    const openLabel = record.mediaType === "photo" || /\/photo\//i.test(openUrl) ? "打开图文" : "打开视频";
    const openLink = canOpen ? `<a href="${escapeHtml(openUrl)}" target="_blank" rel="noreferrer">${openLabel}</a><br><div class="muted">${note}</div>` : note;
    return `<tr><td>${escapeHtml(formatMilliseconds(record.createdAt))}</td><td>${escapeHtml(formatSeconds(record.scheduleAt))}</td><td>${accountCell(record)}</td><td>${clippedText(record.fileName || record.title || "-")}</td><td>${clippedText(record.autoTaskId || "手动提交")}</td><td>${clippedText(batchIds.join(", ") || "-")}</td><td>${escapeHtml(record.nextRetryAt?`等待自动重试 ${record.autoRetryCount}/2`:statusLabel(record.status))}</td><td>${openLink}</td></tr>`;
  }).join("");
  status.textContent = `已读取 ${records.length} 条官方 API 本地发布记录。`;
}

function clippedText(value) {
  const text=escapeHtml(String(value ?? '-'));
  return `<span class="record-truncate" tabindex="0">${text}</span>`;
}

// Render outside the scrolling table so long details are never clipped by its edges.
function installRecordTooltip() {
  const tooltip = document.createElement("div");
  tooltip.id = "record-detail-tooltip";
  tooltip.className = "record-detail-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  let active = null;
  let hideTimer;
  const cancelHide = () => clearTimeout(hideTimer);
  const hide = () => {
    cancelHide();
    active?.removeAttribute("aria-describedby");
    active = null;
    tooltip.hidden = true;
  };
  const scheduleHide = () => { cancelHide(); hideTimer = setTimeout(hide, 180); };
  const show = (target) => {
    cancelHide();
    if (active === target && !tooltip.hidden) return;
    active?.removeAttribute("aria-describedby");
    active = target;
    tooltip.textContent = target.textContent;
    target.setAttribute("aria-describedby", tooltip.id);
    tooltip.hidden = false;
    tooltip.scrollTop = 0;
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const below = window.innerHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const useBelow = below >= Math.min(260, above);
    tooltip.style.maxHeight = `${Math.max(40, Math.min(360, useBelow ? below : above))}px`;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(useBelow ? rect.bottom + gap : rect.top - height - gap, window.innerHeight - height - margin))}px`;
  };
  const targetInCell = (element) => element instanceof Element && element.closest("td")?.querySelector(".record-truncate");
  rows.addEventListener("mouseover", (event) => {
    const target = targetInCell(event.target);
    if (target) show(target);
  });
  rows.addEventListener("mouseout", (event) => {
    if (targetInCell(event.relatedTarget) !== active) scheduleHide();
  });
  rows.addEventListener("focusin", (event) => {
    const target = targetInCell(event.target);
    if (target) show(target);
  });
  rows.addEventListener("focusout", scheduleHide);
  rows.addEventListener("click", (event) => {
    const target = targetInCell(event.target);
    if (target && !event.target.closest("a")) show(target);
  });
  tooltip.addEventListener("mouseenter", cancelHide);
  tooltip.addEventListener("mouseleave", scheduleHide);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
  document.addEventListener("pointerdown", (event) => {
    if (!tooltip.contains(event.target) && targetInCell(event.target) !== active) hide();
  });
  document.addEventListener("scroll", (event) => { if (event.target !== tooltip) hide(); }, true);
  window.addEventListener("resize", hide);
  document.addEventListener("dismiss-record-tooltip", hide);
}

function accountCell(record) {
  const handle = String(record.accountUsername || record.username || "").replace(/^@/, "").trim();
  const remark = String(record.accountName || "").replace(/^@/, "").trim();
  const primary = handle ? `@${handle}` : (remark || record.connectionId || record.assignedEnvId || "-");
  const secondary = handle && remark && remark.toLowerCase() !== handle.toLowerCase() ? remark : "";
  return `<strong>${escapeHtml(primary)}</strong>${secondary ? `<br><span class="muted">${escapeHtml(secondary)}</span>` : ""}`;
}

function recordNote(record) {
  const reason = failReasonLabel(record.publishError || "");
  if (reason) return `${record.nextRetryAt?`已安排自动重试 ${record.autoRetryCount}/2；`:""}失败原因：${reason}`;
  return record.note || "已由 Signal Desk 接管后续发布";
}

function failReasonLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const labels = {
    spam_risk: "TikTok 审核判定这次发布有风险，没有更细原因，官方要求不要重试",
    spam_risk_text: "文案被判定有垃圾或风险内容，不要重试",
    spam_risk_too_many_posts: "该账号 24 小时内通过开放接口发得太多，请改用 TikTok App",
    spam_risk_too_many_pending_share: "该账号待发布草稿太多",
    spam_risk_user_banned_from_posting: "该账号已被 TikTok 禁止发新帖，不要重试",
    picture_size: "封面或图片尺寸不符合限制",
    picture_size_check_failed: "封面或图片尺寸不符合限制",
    duration: "时长不符合 TikTok 限制",
    duration_check_failed: "时长不符合 TikTok 限制",
    file_format: "文件格式不符合 TikTok 限制",
    file_format_check_failed: "文件格式不符合 TikTok 限制",
    frame_rate: "帧率不符合 TikTok 限制",
    frame_rate_check_failed: "帧率不符合 TikTok 限制",
    video_pull_failed: "TikTok 拉不到视频文件（地址无法访问或超时）",
    photo_pull_failed: "TikTok 拉不到图片文件（地址无法访问或超时）",
    internal: "TikTok 服务端异常，可以稍后重试",
    auth_removed: "发布过程中账号取消了授权，不要重试",
    publish_cancelled: "发布已被取消",
    privacy_level_not_authorized: "该账号未授权所选隐私级别"
  };
  const mapped = labels[raw.toLowerCase()];
  return mapped ? `${mapped}（${raw}）` : raw;
}

function statusLabel(value) {
  const item = String(value || "");
  if (["submitted", "done"].includes(item)) return "已提交发布中台";
  if (item === "published") return "已发布到 TikTok";
  if (item === "failed" || item === "rejected") return "发布失败";
  if (item === "needs_check" || item === "needs_review") return "待人工核实";
  if (item === "processing" || item === "submitting") return "发布中";
  return item || "-";
}
function formatMilliseconds(value) { const timestamp = Number(value); return Number.isFinite(timestamp) && timestamp > 0 ? formatDate(new Date(timestamp)) : "-"; }
function formatSeconds(value) { const timestamp = Number(value); return Number.isFinite(timestamp) && timestamp > 0 ? formatDate(new Date(timestamp * 1000)) : "-"; }
function formatDate(date) { const pad = (part) => String(part).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function unique(values) { return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))); }
function setText(selector, value) { const element = document.querySelector(selector); if (element) element.textContent = String(value); }
function debounce(fn, wait) { let timer = 0; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
