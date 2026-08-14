const elements = {
  bridgeUrl: document.querySelector("#bridgeUrl"),
  bridgeApiKey: document.querySelector("#bridgeApiKey"),
  authorizeLink: document.querySelector("#authorizeLink"),
  settingsSummary: document.querySelector("#settingsSummary"),
  statusMessage: document.querySelector("#statusMessage"),
  accountList: document.querySelector("#accountList"),
  saveButton: document.querySelector("#saveButton"),
  testButton: document.querySelector("#testButton"),
  refreshButton: document.querySelector("#refreshButton"),
  groupFilter: document.querySelector("#groupFilter"),
  accountSearch: document.querySelector("#accountSearch"),
  newGroupName: document.querySelector("#newGroupName"),
  createGroupBtn: document.querySelector("#createGroupBtn"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  assignGroupSelect: document.querySelector("#assignGroupSelect"),
  assignGroupBtn: document.querySelector("#assignGroupBtn"),
  deleteGroupBtn: document.querySelector("#deleteGroupBtn"),
  selectedCount: document.querySelector("#selectedCount"),
};

const state = { accounts: [], groups: [] };

elements.saveButton?.addEventListener("click", saveSettings);
elements.testButton?.addEventListener("click", testConnection);
elements.refreshButton?.addEventListener("click", loadAccounts);
elements.bridgeUrl?.addEventListener("input", updateAuthorizeLink);
elements.groupFilter?.addEventListener("change", renderAccounts);
elements.accountSearch?.addEventListener("input", renderAccounts);
elements.createGroupBtn?.addEventListener("click", createGroup);
elements.selectVisibleBtn?.addEventListener("click", selectVisible);
elements.assignGroupBtn?.addEventListener("click", assignSelected);
elements.deleteGroupBtn?.addEventListener("click", deleteCurrentGroup);

await loadSettings();
await loadAccounts();

async function loadSettings() {
  try {
    const result = await requestJson("/api/private-tiktok/settings");
    const settings = result.settings || {};
    elements.bridgeUrl.value = settings.baseUrl || "https://tiktokaitool.com";
    elements.settingsSummary.textContent = settings.configured ? `已连接 · ${settings.baseUrl}` : "尚未配置桥接 API Key。";
    updateAuthorizeLink();
  } catch (error) {
    elements.settingsSummary.textContent = error.message || "读取配置失败。";
  }
}

async function saveSettings() {
  setBusy(elements.saveButton, true, "保存中...");
  try {
    const result = await requestJson("/api/private-tiktok/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: elements.bridgeUrl.value.trim(), apiKey: elements.bridgeApiKey.value.trim() }),
    });
    elements.bridgeApiKey.value = "";
    elements.settingsSummary.textContent = result.settings?.configured ? `已连接 · ${result.settings.baseUrl}` : "配置已保存，但尚未填写 API Key。";
    updateAuthorizeLink();
    await loadAccounts();
  } catch (error) {
    showStatus(error.message || "保存配置失败。", true);
  } finally {
    setBusy(elements.saveButton, false, "保存配置");
  }
}

async function testConnection() {
  setBusy(elements.testButton, true, "测试中...");
  try {
    const result = await requestJson("/api/private-tiktok/test", { method: "POST", body: "{}" });
    showStatus(`连接成功，读取到 ${Number(result.accountCount || 0)} 个已授权账号。`);
  } catch (error) {
    showStatus(error.message || "连接测试失败。", true);
  } finally {
    setBusy(elements.testButton, false, "测试连接");
  }
}

async function loadAccounts() {
  setBusy(elements.refreshButton, true, "刷新中...");
  elements.accountList.innerHTML = '<div class="empty-state">正在读取已授权账号...</div>';
  try {
    const result = await requestJson("/api/private-tiktok/accounts");
    state.accounts = Array.isArray(result.accounts) ? result.accounts : [];
    state.groups = Array.isArray(result.groups) ? result.groups : [];
    fillGroupSelects();
    renderAccounts();
    showStatus(`已读取 ${state.accounts.length} 个已授权账号，${state.groups.length} 个分组。`);
  } catch (error) {
    state.accounts = [];
    elements.accountList.innerHTML = '<div class="empty-state">暂时无法读取账号。</div>';
    showStatus(error.message || "读取已授权账号失败。", true);
  } finally {
    setBusy(elements.refreshButton, false, "刷新账号");
  }
}

function fillGroupSelects() {
  const counts = {};
  for (const account of state.accounts) {
    if (account.groupId) counts[account.groupId] = (counts[account.groupId] || 0) + 1;
  }
  const options = state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}（${counts[group.id] || 0}）</option>`).join("");
  const currentFilter = elements.groupFilter.value;
  const currentAssign = elements.assignGroupSelect.value;
  elements.groupFilter.innerHTML = `<option value="">全部分组</option><option value="ungrouped">未分组</option>${options}`;
  elements.assignGroupSelect.innerHTML = `<option value="">未分组</option>${options}`;
  if ([...elements.groupFilter.options].some((item) => item.value === currentFilter)) elements.groupFilter.value = currentFilter;
  if ([...elements.assignGroupSelect.options].some((item) => item.value === currentAssign)) elements.assignGroupSelect.value = currentAssign;
}

function visibleAccounts() {
  const groupId = elements.groupFilter.value;
  const query = String(elements.accountSearch.value || "").trim().toLowerCase();
  return state.accounts.filter((account) => {
    if (groupId === "ungrouped" && account.groupId) return false;
    if (groupId && groupId !== "ungrouped" && account.groupId !== groupId) return false;
    if (!query) return true;
    const profile = account.profile || {};
    return [profile.username, profile.displayName, account.label, account.groupName, account.schema]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderAccounts() {
  const accounts = visibleAccounts();
  if (!state.accounts.length) {
    elements.accountList.innerHTML = '<div class="empty-state">暂无已授权账号。请先前往 TikTok AI Tool 完成授权。</div>';
    updateSelectedCount();
    return;
  }
  if (!accounts.length) {
    elements.accountList.innerHTML = '<div class="empty-state">当前筛选下没有账号。</div>';
    updateSelectedCount();
    return;
  }
  elements.accountList.innerHTML = accounts.map((account) => {
    const profile = account.profile || {};
    const username = profile.username ? `@${profile.username}` : profile.displayName || account.label || "TikTok 账号";
    const displayName = profile.displayName && profile.displayName !== profile.username ? profile.displayName : "官方授权账号";
    const videoCount = Number(account.syncedVideoCount ?? account.videoCount ?? 0);
    const syncedAt = formatTime(account.syncedAt || account.updatedAt);
    const key = accountKey(account);
    return `<article class="account-row">
      <input class="account-check" type="checkbox" value="${escapeHtml(key)}" data-schema="${escapeHtml(account.schema || "")}" data-username="${escapeHtml(profile.username || "")}" />
      <div><strong>${escapeHtml(username)}</strong><span>${escapeHtml(displayName)}</span></div>
      <div><small>分组</small><b class="group-chip${account.groupName ? "" : " is-empty"}">${escapeHtml(account.groupName || "未分组")}</b></div>
      <div><small>视频</small><b>${formatNumber(videoCount)}</b></div>
      <div><small>最近同步</small><b>${escapeHtml(syncedAt)}</b></div>
      <div><small>状态</small><b class="ready-pill">已授权</b></div>
    </article>`;
  }).join("");
  elements.accountList.querySelectorAll(".account-check").forEach((input) => input.addEventListener("change", updateSelectedCount));
  updateSelectedCount();
}

function selectVisible() {
  const inputs = Array.from(elements.accountList.querySelectorAll(".account-check"));
  const shouldCheck = inputs.some((input) => !input.checked);
  inputs.forEach((input) => { input.checked = shouldCheck; });
  updateSelectedCount();
}

function selectedAccounts() {
  return Array.from(elements.accountList.querySelectorAll(".account-check:checked")).map((input) => ({
    accountKey: input.value,
    schema: input.dataset.schema || "",
    username: input.dataset.username || ""
  }));
}

async function createGroup() {
  const name = elements.newGroupName.value.trim();
  if (!name) return showStatus("请填写分组名称。", true);
  setBusy(elements.createGroupBtn, true, "创建中...");
  try {
    const result = await requestJson("/api/official-tiktok/account-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    elements.newGroupName.value = "";
    applyGroupState(result);
    showStatus(`已创建分组「${name}」。`);
  } catch (error) {
    showStatus(error.message || "创建分组失败。", true);
  } finally {
    setBusy(elements.createGroupBtn, false, "新建");
  }
}

async function assignSelected() {
  const accounts = selectedAccounts();
  if (!accounts.length) return showStatus("请先勾选要分组的账号。", true);
  setBusy(elements.assignGroupBtn, true, "保存中...");
  try {
    const result = await requestJson("/api/official-tiktok/account-groups/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts, groupId: elements.assignGroupSelect.value })
    });
    applyGroupState(result);
    showStatus(`已将 ${accounts.length} 个账号${elements.assignGroupSelect.value ? "移入分组" : "移出分组"}。`);
  } catch (error) {
    showStatus(error.message || "账号分组失败。", true);
  } finally {
    setBusy(elements.assignGroupBtn, false, "移入分组");
  }
}

async function deleteCurrentGroup() {
  const groupId = elements.groupFilter.value;
  if (!groupId || groupId === "ungrouped") return showStatus("请先在筛选里选中要删除的分组。", true);
  const group = state.groups.find((item) => item.id === groupId);
  if (!window.confirm(`删除分组「${group?.name || groupId}」后，组内账号会回到未分组。确定删除吗？`)) return;
  setBusy(elements.deleteGroupBtn, true, "删除中...");
  try {
    const result = await requestJson(`/api/official-tiktok/account-groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
    applyGroupState(result);
    elements.groupFilter.value = "";
    renderAccounts();
    showStatus("分组已删除，账号已回到未分组。");
  } catch (error) {
    showStatus(error.message || "删除分组失败。", true);
  } finally {
    setBusy(elements.deleteGroupBtn, false, "删除当前分组");
  }
}

function applyGroupState(result) {
  const groups = Array.isArray(result.groups) ? result.groups : state.groups;
  const assignments = result.assignments || {};
  state.groups = groups;
  state.accounts = state.accounts.map((account) => {
    const groupId = officialAccountKeys(account).map((key) => assignments[key]).find(Boolean) || "";
    const group = groups.find((item) => item.id === groupId);
    return { ...account, groupId: group?.id || "", groupName: group?.name || "" };
  });
  fillGroupSelects();
  renderAccounts();
}

function officialAccountKeys(account) {
  return Array.from(new Set([
    account.accountKey,
    account.connectionId,
    account.id,
    account.schema,
    account.username,
    account.profile?.username
  ].map(normalizeAccountKey).filter(Boolean)));
}

function accountKey(account) {
  return officialAccountKeys(account)[0] || "";
}

function normalizeAccountKey(value) {
  let key = String(value || "").trim().replace(/^@/, "");
  if (key.toLowerCase().startsWith("tiktok:")) key = key.slice(7);
  return key;
}

function updateSelectedCount() {
  const count = elements.accountList.querySelectorAll(".account-check:checked").length;
  if (elements.selectedCount) elements.selectedCount.textContent = `已选 ${count} 个`;
}

function updateAuthorizeLink() {
  const baseUrl = String(elements.bridgeUrl?.value || "https://tiktokaitool.com").trim().replace(/\/+$/, "");
  elements.authorizeLink.href = `${baseUrl || "https://tiktokaitool.com"}/dashboard?view=connect`;
}

function showStatus(message, isError = false) {
  elements.statusMessage.hidden = false;
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("is-error", isError);
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const text = payload.error || `请求失败（${response.status}）`;
    if (response.status === 404 || /not found/i.test(text)) {
      throw new Error("分组接口还没加载，请重启本地服务后刷新本页再新建。");
    }
    throw new Error(text);
  }
  return payload;
}

function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function formatTime(value) {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
