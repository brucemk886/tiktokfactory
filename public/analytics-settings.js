const $ = (selector) => document.querySelector(selector);
const elements = {
  apiKeyInput: $("#apiKeyInput"), apiKeyHint: $("#apiKeyHint"), sourceState: $("#sourceState"),
  runTimeInput: $("#runTimeInput"), autoFetchInput: $("#autoFetchInput"), nextRunPreview: $("#nextRunPreview"),
  groupSearch: $("#groupSearch"), selectVisibleBtn: $("#selectVisibleBtn"), clearGroupsBtn: $("#clearGroupsBtn"),
  groupOptions: $("#groupOptions"), selectionCount: $("#selectionCount"), quotaWarning: $("#quotaWarning"),
  saveStatus: $("#saveStatus"), saveSettingsBtn: $("#saveSettingsBtn")
};

let groups = [];
let selectedGroups = new Set();
let keyCount = 0;

elements.groupSearch.addEventListener("input", renderGroups);
elements.selectVisibleBtn.addEventListener("click", () => {
  for (const group of visibleGroups()) selectedGroups.add(group.name);
  renderGroups();
});
elements.clearGroupsBtn.addEventListener("click", () => { selectedGroups.clear(); renderGroups(); });
elements.groupOptions.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-group]");
  if (!input) return;
  if (input.checked) selectedGroups.add(input.value); else selectedGroups.delete(input.value);
  updateSelection();
});
elements.saveSettingsBtn.addEventListener("click", saveSettings);

await loadSettings();

async function loadSettings() {
  setStatus("正在读取 GeeLark 当前账号组...");
  try {
    const data = await requestJson("/api/tiktok-analytics/settings");
    const settings = data.settings || {};
    keyCount = Number(settings.keyCount || 0);
    groups = (data.availableGroups || []).map((name) => ({ name, count: Number(data.groupCounts?.[name] || 0) }));
    selectedGroups = new Set(settings.groups || []);
    elements.runTimeInput.value = `${pad(settings.runHour)}:${pad(settings.runMinute)}`;
    elements.autoFetchInput.checked = settings.enabled === true;
    elements.apiKeyHint.textContent = settings.configured ? `已配置 ${keyCount} 个Key：${(settings.maskedApiKeys || []).join("、")}` : "尚未配置 API Key";
    elements.sourceState.textContent = settings.configured ? "已连接" : "未配置";
    elements.sourceState.dataset.tone = settings.configured ? "success" : "warning";
    elements.nextRunPreview.textContent = settings.enabled ? formatDateTime(settings.nextRunAt) : "自动抓取未启用";
    renderGroups();
    setStatus(`已实时读取 ${groups.length} 个 GeeLark 账号组。`, "success");
  } catch (error) {
    elements.groupOptions.innerHTML = `<div class="config-loading error">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  }
}

async function saveSettings() {
  const [runHour, runMinute] = String(elements.runTimeInput.value || "02:00").split(":").map(Number);
  if (elements.autoFetchInput.checked && !selectedGroups.size) return setStatus("启用自动抓取前，请至少勾选一个账号组。", "error");
  const payload = { enabled: elements.autoFetchInput.checked, runHour, runMinute, groups: [...selectedGroups] };
  const apiKeys = elements.apiKeyInput.value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  if (apiKeys.length) payload.apiKeys = apiKeys;
  setBusy(true);
  try {
    const data = await requestJson("/api/tiktok-analytics/settings", { method: "POST", body: JSON.stringify(payload) });
    elements.apiKeyInput.value = "";
    setStatus("抓取配置已保存，新的定时计划已经生效。", "success");
    await loadSettings();
    elements.nextRunPreview.textContent = data.nextRunAt ? formatDateTime(data.nextRunAt) : "自动抓取未启用";
  } catch (error) {
    setStatus(error.message, "error");
  } finally { setBusy(false); }
}

function visibleGroups() {
  const keyword = elements.groupSearch.value.trim().toLowerCase();
  return groups.filter((group) => !keyword || group.name.toLowerCase().includes(keyword));
}

function renderGroups() {
  const visible = visibleGroups();
  elements.groupOptions.innerHTML = visible.length ? visible.map((group) => `
    <label class="config-group-item"><input type="checkbox" data-group value="${escapeHtml(group.name)}" ${selectedGroups.has(group.name) ? "checked" : ""} /><span><strong>${escapeHtml(group.name)}</strong><small>${group.count} 个账号</small></span><i></i></label>
  `).join("") : `<div class="config-loading">没有匹配的账号组。</div>`;
  updateSelection();
}

function updateSelection() {
  const selectedAccounts = groups.filter((group) => selectedGroups.has(group.name)).reduce((sum, group) => sum + group.count, 0);
  elements.selectionCount.textContent = `已选 ${selectedGroups.size} 组 / ${selectedAccounts} 账号`;
  const dailyLimit = Math.max(1, keyCount) * 100;
  elements.quotaWarning.hidden = selectedAccounts <= dailyLimit;
  elements.quotaWarning.textContent = selectedAccounts > dailyLimit ? `当前共 ${selectedAccounts} 个账号，超过 ${keyCount || 1} 个Key合计${dailyLimit}次/天；超出部分当天不会请求。` : "";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function setBusy(value) { elements.saveSettingsBtn.disabled = value; elements.saveSettingsBtn.textContent = value ? "保存中..." : "保存抓取配置"; }
function setStatus(message, tone = "") { elements.saveStatus.textContent = message; elements.saveStatus.dataset.tone = tone; }
function pad(value) { return String(Number(value) || 0).padStart(2, "0"); }
function formatDateTime(value) { if (!Number(value)) return "等待计划"; const date = new Date(Number(value)); return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
