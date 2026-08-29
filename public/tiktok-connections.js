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
  projectFilter: document.querySelector("#projectFilter"),
  newProjectName: document.querySelector("#newProjectName"),
  createProjectBtn: document.querySelector("#createProjectBtn"),
  deleteProjectBtn: document.querySelector("#deleteProjectBtn"),
  groupFilter: document.querySelector("#groupFilter"),
  accountSearch: document.querySelector("#accountSearch"),
  newGroupName: document.querySelector("#newGroupName"),
  newGroupProject: document.querySelector("#newGroupProject"),
  createGroupBtn: document.querySelector("#createGroupBtn"),
  groupReportBar: document.querySelector("#groupReportBar"),
  groupProjectSelect: document.querySelector("#groupProjectSelect"),
  saveGroupProjectBtn: document.querySelector("#saveGroupProjectBtn"),
  moveGroupSelect: document.querySelector("#moveGroupSelect"),
  moveGroupProjectSelect: document.querySelector("#moveGroupProjectSelect"),
  moveGroupToProjectBtn: document.querySelector("#moveGroupToProjectBtn"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  assignGroupSelect: document.querySelector("#assignGroupSelect"),
  assignGroupBtn: document.querySelector("#assignGroupBtn"),
  deleteGroupBtn: document.querySelector("#deleteGroupBtn"),
  selectedCount: document.querySelector("#selectedCount"),
};

const state = { accounts: [], groups: [], projects: [] };

elements.saveButton?.addEventListener("click", saveSettings);
elements.testButton?.addEventListener("click", testConnection);
elements.refreshButton?.addEventListener("click", () => loadAccounts({ refresh: true }));
elements.bridgeUrl?.addEventListener("input", updateAuthorizeLink);
elements.projectFilter?.addEventListener("change", () => {
  syncNewGroupProjectFromFilter();
  fillGroupSelects();
  renderAccounts();
  syncGroupReportBar();
});
elements.groupFilter?.addEventListener("change", () => { renderAccounts(); syncGroupReportBar(); });
elements.accountSearch?.addEventListener("input", renderAccounts);
elements.createProjectBtn?.addEventListener("click", createProject);
elements.deleteProjectBtn?.addEventListener("click", deleteCurrentProject);
elements.createGroupBtn?.addEventListener("click", createGroup);
elements.saveGroupProjectBtn?.addEventListener("click", saveCurrentGroupProject);
elements.moveGroupToProjectBtn?.addEventListener("click", moveGroupToProject);
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

async function loadAccounts({ refresh = false } = {}) {
  setBusy(elements.refreshButton, true, refresh ? "正在从主站同步..." : "刷新中...");
  elements.accountList.innerHTML = '<div class="empty-state">正在读取已授权账号...</div>';
  try {
    const [result, hub] = await Promise.all([
      requestJson(`/api/private-tiktok/accounts${refresh ? "?refresh=1" : ""}`),
      requestJson("/api/official-tiktok/publish-accounts").catch(() => ({ accounts: [] }))
    ]);
    state.accounts = attachPublishRiskMarks(Array.isArray(result.accounts) ? result.accounts : [], hub.accounts || []);
    state.groups = Array.isArray(result.groups) ? result.groups : [];
    state.projects = Array.isArray(result.projects) ? result.projects : [];
    fillProjectSelects();
    fillGroupSelects();
    renderAccounts();
    syncGroupReportBar();
    showStatus(`已读取 ${state.accounts.length} 个已授权账号，${state.projects.length} 个项目，${state.groups.length} 个分组。`);
  } catch (error) {
    state.accounts = [];
    elements.accountList.innerHTML = '<div class="empty-state">暂时无法读取账号。</div>';
    showStatus(error.message || "读取已授权账号失败。", true);
  } finally {
    setBusy(elements.refreshButton, false, "刷新账号");
  }
}

function fillProjectSelects() {
  const current = elements.projectFilter.value;
  const options = state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}（${project.groupCount || 0} 组）</option>`).join("");
  elements.projectFilter.innerHTML = `<option value="">全部项目</option><option value="unassigned">未分配项目</option>${options}`;
  if ([...elements.projectFilter.options].some((item) => item.value === current)) elements.projectFilter.value = current;
  if (elements.groupProjectSelect) {
    const selected = elements.groupProjectSelect.value;
    elements.groupProjectSelect.innerHTML = `<option value="">未分配项目</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("")}`;
    if ([...elements.groupProjectSelect.options].some((item) => item.value === selected)) elements.groupProjectSelect.value = selected;
  }
  if (elements.newGroupProject) {
    const selected = elements.newGroupProject.value;
    elements.newGroupProject.innerHTML = `<option value="">请选择项目</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("")}`;
    const preferred = selected || (current && current !== "unassigned" ? current : "");
    if ([...elements.newGroupProject.options].some((item) => item.value === preferred)) elements.newGroupProject.value = preferred;
  }
  if (elements.moveGroupProjectSelect) {
    const selected = elements.moveGroupProjectSelect.value;
    elements.moveGroupProjectSelect.innerHTML = `<option value="">请选择项目</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("")}`;
    if ([...elements.moveGroupProjectSelect.options].some((item) => item.value === selected)) elements.moveGroupProjectSelect.value = selected;
  }
}

function syncNewGroupProjectFromFilter() {
  const filter = elements.projectFilter?.value || "";
  if (elements.newGroupProject && filter && filter !== "unassigned") {
    elements.newGroupProject.value = filter;
  }
}

function visibleGroups() {
  const projectId = elements.projectFilter.value;
  return state.groups.filter((group) => {
    if (projectId === "unassigned") return !group.projectId;
    if (projectId) return group.projectId === projectId;
    return true;
  });
}

function fillGroupSelects() {
  const counts = {};
  for (const account of state.accounts) {
    if (account.groupId) counts[account.groupId] = (counts[account.groupId] || 0) + 1;
  }
  const groups = visibleGroups();
  const options = groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}（${counts[group.id] || group.accountCount || 0}）</option>`).join("");
  const currentFilter = elements.groupFilter.value;
  const currentAssign = elements.assignGroupSelect.value;
  elements.groupFilter.innerHTML = `<option value="">全部分组</option><option value="ungrouped">未分组</option>${options}`;
  elements.assignGroupSelect.innerHTML = `<option value="">未分组</option>${state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.projectName ? `${group.projectName} / ${group.name}` : group.name)}</option>`).join("")}`;
  if ([...elements.groupFilter.options].some((item) => item.value === currentFilter)) elements.groupFilter.value = currentFilter;
  if ([...elements.assignGroupSelect.options].some((item) => item.value === currentAssign)) elements.assignGroupSelect.value = currentAssign;
  if (elements.moveGroupSelect) {
    const currentMove = elements.moveGroupSelect.value || (currentFilter && currentFilter !== "ungrouped" ? currentFilter : "");
    elements.moveGroupSelect.innerHTML = `<option value="">请选择分组</option>${state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.projectName ? `${group.projectName} / ${group.name}` : group.name)}</option>`).join("")}`;
    if ([...elements.moveGroupSelect.options].some((item) => item.value === currentMove)) elements.moveGroupSelect.value = currentMove;
  }
}

function visibleAccounts() {
  const projectId = elements.projectFilter.value;
  const groupId = elements.groupFilter.value;
  const query = String(elements.accountSearch.value || "").trim().toLowerCase();
  return state.accounts.filter((account) => {
    if (projectId === "unassigned" && account.projectId) return false;
    if (projectId && projectId !== "unassigned" && account.projectId !== projectId) return false;
    if (groupId === "ungrouped" && account.groupId) return false;
    if (groupId && groupId !== "ungrouped" && account.groupId !== groupId) return false;
    if (query) {
      const profile = account.profile || {};
      const haystack = [profile.username, profile.displayName, account.label, account.groupName, account.projectName, account.schema, account.publishRisk?.flagged ? "风控 spam_risk" : ""];
      if (!haystack.some((value) => String(value || "").toLowerCase().includes(query))) return false;
    }
    return true;
  }).sort((left, right) => Number(Boolean(right.publishRisk?.flagged)) - Number(Boolean(left.publishRisk?.flagged)));
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
    const risk = account.publishRisk;
    const riskTitle = risk?.flagged ? `${risk.label || "官方接口风控"}（${risk.reason || "spam_risk"}）${Number(risk.count || 0) > 1 ? ` · ${risk.count} 次` : ""}` : "";
    return `<article class="account-row${risk?.flagged ? " is-risk" : ""}">
      <input class="account-check" type="checkbox" value="${escapeHtml(key)}" data-schema="${escapeHtml(account.schema || "")}" data-username="${escapeHtml(profile.username || "")}" />
      <div><strong>${escapeHtml(username)}${risk?.flagged ? `<span class="risk-pill" title="${escapeHtml(riskTitle)}">风控</span>` : ""}</strong><span>${escapeHtml(displayName)}</span></div>
      <div><small>项目 / 分组</small><b class="group-chip${account.groupName ? "" : " is-empty"}">${escapeHtml([account.projectName, account.groupName || "未分组"].filter(Boolean).join(" / "))}</b></div>
      <div><small>视频</small><b>${formatNumber(videoCount)}</b></div>
      <div><small>最近同步</small><b>${escapeHtml(syncedAt)}</b></div>
      <div><small>状态</small><b class="${risk?.flagged ? "risk-pill" : "ready-pill"}" title="${escapeHtml(riskTitle)}">${risk?.flagged ? "风控" : "已授权"}</b></div>
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

async function createProject() {
  const name = elements.newProjectName.value.trim();
  if (!name) return showStatus("请填写项目名称。", true);
  setBusy(elements.createProjectBtn, true, "创建中...");
  try {
    const result = await requestJson("/api/official-tiktok/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    elements.newProjectName.value = "";
    applyGroupState(result);
    const created = result.projects?.find((item) => item.name === name);
    if (created) elements.projectFilter.value = created.id;
    fillGroupSelects();
    showStatus(`已创建项目「${name}」。`);
  } catch (error) {
    showStatus(error.message || "创建项目失败。", true);
  } finally {
    setBusy(elements.createProjectBtn, false, "新建");
  }
}

async function deleteCurrentProject() {
  const projectId = elements.projectFilter.value;
  if (!projectId || projectId === "unassigned") return showStatus("请先在筛选里选中要删除的项目。", true);
  const project = state.projects.find((item) => item.id === projectId);
  if (!window.confirm(`删除项目「${project?.name || projectId}」后，组还会在，只是不再属于这个项目。确定删除吗？`)) return;
  setBusy(elements.deleteProjectBtn, true, "删除中...");
  try {
    const result = await requestJson(`/api/official-tiktok/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    applyGroupState(result);
    elements.projectFilter.value = "";
    fillGroupSelects();
    renderAccounts();
    showStatus("项目已删除。");
  } catch (error) {
    showStatus(error.message || "删除项目失败。", true);
  } finally {
    setBusy(elements.deleteProjectBtn, false, "删除当前项目");
  }
}

async function createGroup() {
  const name = elements.newGroupName.value.trim();
  const projectId = elements.newGroupProject?.value || "";
  if (!projectId) return showStatus("请先选择这个分组属于哪个项目。", true);
  if (!name) return showStatus("请填写分组名称。", true);
  const project = state.projects.find((item) => item.id === projectId);
  setBusy(elements.createGroupBtn, true, "创建中...");
  try {
    const result = await requestJson("/api/official-tiktok/account-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, projectId })
    });
    elements.newGroupName.value = "";
    applyGroupState(result);
    if (project) elements.projectFilter.value = project.id;
    fillGroupSelects();
    showStatus(`已在「${project?.name || "项目"}」下创建分组「${name}」。`);
  } catch (error) {
    showStatus(error.message || "创建分组失败。", true);
  } finally {
    setBusy(elements.createGroupBtn, false, "新建");
  }
}

async function saveCurrentGroupProject() {
  const groupId = currentGroupId();
  if (!groupId) return showStatus("请先在筛选里选中要移动的分组。", true);
  const projectId = elements.groupProjectSelect?.value || "";
  if (!projectId) return showStatus("请选择要移入的项目。", true);
  await applyGroupProject(groupId, projectId, elements.saveGroupProjectBtn);
}

async function moveGroupToProject() {
  const groupId = elements.moveGroupSelect?.value || "";
  const projectId = elements.moveGroupProjectSelect?.value || "";
  if (!groupId) return showStatus("请选择要移动的分组。", true);
  if (!projectId) return showStatus("请选择要移入的项目。", true);
  await applyGroupProject(groupId, projectId, elements.moveGroupToProjectBtn);
}

async function applyGroupProject(groupId, projectId, button) {
  const group = state.groups.find((item) => item.id === groupId);
  const project = state.projects.find((item) => item.id === projectId);
  setBusy(button, true, "移动中...");
  try {
    const result = await requestJson(`/api/official-tiktok/account-groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    applyGroupState(result);
    elements.projectFilter.value = projectId;
    if (elements.groupFilter) elements.groupFilter.value = groupId;
    fillGroupSelects();
    renderAccounts();
    syncGroupReportBar();
    showStatus(`已将分组「${group?.name || groupId}」移入「${project?.name || "项目"}」。`);
  } catch (error) {
    showStatus(error.message || "分组移入项目失败。", true);
  } finally {
    setBusy(button, false, "移入项目");
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
  const projects = Array.isArray(result.projects) ? result.projects : state.projects;
  const assignments = result.assignments || {};
  state.groups = groups;
  state.projects = projects;
  state.accounts = state.accounts.map((account) => {
    const groupId = officialAccountKeys(account).map((key) => assignments[key]).find(Boolean) || account.groupId || "";
    const group = groups.find((item) => item.id === groupId);
    return {
      ...account,
      groupId: group?.id || "",
      groupName: group?.name || "",
      projectId: group?.projectId || "",
      projectName: group?.projectName || "",
      reportEnabled: Boolean(group?.reportEnabled),
    };
  });
  fillProjectSelects();
  fillGroupSelects();
  renderAccounts();
  syncGroupReportBar();
}

function currentGroupId() {
  const groupId = elements.groupFilter.value;
  return groupId && groupId !== "ungrouped" ? groupId : "";
}

function syncGroupReportBar() {
  const groupId = currentGroupId();
  const group = state.groups.find((item) => item.id === groupId);
  if (!elements.groupReportBar) return;
  elements.groupReportBar.hidden = !group;
  if (!group) return;
  if (elements.groupProjectSelect) elements.groupProjectSelect.value = group.projectId || "";
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

function attachPublishRiskMarks(accounts, riskAccounts) {
  const byId = new Map();
  for (const item of Array.isArray(riskAccounts) ? riskAccounts : []) {
    const risk = item?.publishRisk;
    if (!risk?.flagged) continue;
    const connectionId = String(item.connectionId || item.id || "").trim();
    const schema = String(item.schema || (connectionId ? `tiktok:${connectionId}` : "")).trim();
    if (connectionId) byId.set(connectionId, risk);
    if (schema) byId.set(schema, risk);
    if (schema.startsWith("tiktok:")) byId.set(schema.slice("tiktok:".length), risk);
  }
  return (Array.isArray(accounts) ? accounts : []).map((account) => {
    const connectionId = String(account.connectionId || account.id || "").trim();
    const schema = String(account.schema || account.username || (connectionId ? `tiktok:${connectionId}` : "")).trim();
    const risk = byId.get(connectionId) || byId.get(schema) || (schema.startsWith("tiktok:") ? byId.get(schema.slice("tiktok:".length)) : null);
    return risk ? { ...account, publishRisk: risk } : account;
  });
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
