const $ = (selector) => document.querySelector(selector);
const elements = {
  apiKeyInput: $("#apiKeyInput"), apiKeyHint: $("#apiKeyHint"), sourceState: $("#sourceState"),
  runHourButton: $("#runHourButton"), runHourMenu: $("#runHourMenu"),
  runMinuteButton: $("#runMinuteButton"), runMinuteMenu: $("#runMinuteMenu"),
  autoFetchInput: $("#autoFetchInput"), nextRunPreview: $("#nextRunPreview"),
  profileOptions: $("#profileOptions"),
  groupSearch: $("#groupSearch"), selectVisibleBtn: $("#selectVisibleBtn"), clearGroupsBtn: $("#clearGroupsBtn"), refreshGroupsBtn: $("#refreshGroupsBtn"),
  groupOptions: $("#groupOptions"), selectionCount: $("#selectionCount"), quotaWarning: $("#quotaWarning"),
  saveStatus: $("#saveStatus"), saveSettingsBtn: $("#saveSettingsBtn")
};

let groups = [];
let profiles = [];
let selectedGroups = new Set();
let selectedProfileIds = new Set();
let keyCount = 0;

elements.groupSearch.addEventListener("input", renderGroups);
elements.selectVisibleBtn.addEventListener("click", () => {
  for (const group of visibleGroups()) selectedGroups.add(group.name);
  renderGroups();
});
elements.clearGroupsBtn.addEventListener("click", () => { selectedGroups.clear(); renderGroups(); });
elements.refreshGroupsBtn.addEventListener("click", refreshGroups);
elements.profileOptions.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-profile]");
  if (!input) return;
  if (input.checked) selectedProfileIds.add(input.value); else selectedProfileIds.delete(input.value);
  refreshGroups();
});
elements.groupOptions.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-group]");
  if (!input) return;
  if (input.checked) selectedGroups.add(input.value); else selectedGroups.delete(input.value);
  updateSelection();
});
elements.saveSettingsBtn.addEventListener("click", saveSettings);

initializeTimeOptions();
await loadSettings();

function initializeTimeOptions() {
  initializeTimePicker(elements.runHourButton, elements.runHourMenu, 24);
  initializeTimePicker(elements.runMinuteButton, elements.runMinuteMenu, 60);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".time-picker")) closeTimeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTimeMenus();
  });
}

function initializeTimePicker(trigger, menu, count) {
  menu.innerHTML = Array.from({ length: count }, (_, value) => {
    const label = pad(value);
    return `<button type="button" role="option" data-time-value="${label}" aria-selected="false">${label}</button>`;
  }).join("");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = menu.hidden;
    closeTimeMenus();
    menu.hidden = !shouldOpen;
    trigger.setAttribute("aria-expanded", String(shouldOpen));
  });
  menu.addEventListener("click", (event) => {
    const option = event.target.closest("button[data-time-value]");
    if (!option) return;
    setTimeValue(trigger, menu, option.dataset.timeValue);
    closeTimeMenus();
  });
}

function setTimeValue(trigger, menu, value) {
  const normalized = pad(value);
  trigger.dataset.value = normalized;
  trigger.querySelector("span").textContent = normalized;
  for (const option of menu.querySelectorAll("button[data-time-value]")) {
    const selected = option.dataset.timeValue === normalized;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-selected", String(selected));
  }
}

function closeTimeMenus() {
  for (const [trigger, menu] of [[elements.runHourButton, elements.runHourMenu], [elements.runMinuteButton, elements.runMinuteMenu]]) {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
}

async function loadSettings() {
  setStatus("正在读取 GeeLark 当前账号组...");
  try {
    const data = await requestJson("/api/tiktok-analytics/settings");
    const settings = data.settings || {};
    keyCount = Number(settings.keyCount || 0);
    profiles = data.profiles || [];
    selectedProfileIds = new Set(settings.profileIds || ["default"]);
    renderProfiles();
    groups = (data.availableGroups || []).map((name) => ({ name, count: Number(data.groupCounts?.[name] || 0) }));
    selectedGroups = new Set(settings.groups || []);
    setTimeValue(elements.runHourButton, elements.runHourMenu, settings.runHour);
    setTimeValue(elements.runMinuteButton, elements.runMinuteMenu, settings.runMinute);
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

async function refreshGroups() {
  if (!selectedProfileIds.size) {
    groups = [];
    selectedGroups.clear();
    renderGroups();
    return setStatus("请至少选择一个 GeeLark 数据源。", "error");
  }
  const previousSelection = new Set(selectedGroups);
  elements.refreshGroupsBtn.disabled = true;
  elements.refreshGroupsBtn.textContent = "正在刷新...";
  setStatus("正在从 GeeLark 刷新账号组...");
  try {
    const params = new URLSearchParams();
    for (const profileId of selectedProfileIds) params.append("profileId", profileId);
    const data = await requestJson(`/api/tiktok-analytics/settings?${params}`);
    profiles = data.profiles || profiles;
    renderProfiles();
    groups = (data.availableGroups || []).map((name) => ({ name, count: Number(data.groupCounts?.[name] || 0) }));
    selectedGroups = new Set([...previousSelection].filter((name) => groups.some((group) => group.name === name)));
    renderGroups();
    setStatus(`已刷新 ${groups.length} 个 GeeLark 账号组，可直接勾选新分组。`, "success");
  } catch (error) {
    setStatus(error.message || "刷新 GeeLark 账号组失败。", "error");
  } finally {
    elements.refreshGroupsBtn.disabled = false;
    elements.refreshGroupsBtn.textContent = "刷新 GeeLark 账号组";
  }
}

async function saveSettings() {
  const runHour = Number(elements.runHourButton.dataset.value);
  const runMinute = Number(elements.runMinuteButton.dataset.value);
  if (!selectedProfileIds.size) return setStatus("请至少选择一个 GeeLark 数据源。", "error");
  if (elements.autoFetchInput.checked && !selectedGroups.size) return setStatus("启用自动抓取前，请至少勾选一个账号组。", "error");
  const payload = { enabled: elements.autoFetchInput.checked, runHour, runMinute, groups: [...selectedGroups], profileIds: [...selectedProfileIds] };
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

function renderProfiles() {
  elements.profileOptions.innerHTML = profiles.length ? profiles.map((profile) => `
    <label class="config-profile-item"><input type="checkbox" data-profile value="${escapeHtml(profile.id)}" ${selectedProfileIds.has(profile.id) ? "checked" : ""} /><span><strong>${escapeHtml(profile.name)}</strong><small>作为 TikTok 数据抓取来源</small></span></label>
  `).join("") : `<div class="config-loading">尚未配置 GeeLark 账号。</div>`;
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
