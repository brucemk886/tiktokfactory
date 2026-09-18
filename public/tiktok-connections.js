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
  deleteProjectSelect: document.querySelector("#deleteProjectSelect"),
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
  selectVisibleGroupsBtn: document.querySelector("#selectVisibleGroupsBtn"),
  assignGroupSelect: document.querySelector("#assignGroupSelect"),
  assignGroupBtn: document.querySelector("#assignGroupBtn"),
  deleteGroupBtn: document.querySelector("#deleteGroupBtn"),
  deleteGroupSelect: document.querySelector("#deleteGroupSelect"),
  selectedCount: document.querySelector("#selectedCount"),
  selectedGroupCount: document.querySelector("#selectedGroupCount"),
  accountPager: document.querySelector("#accountPager"),
  groupSearch: document.querySelector("#groupSearch"),
  groupList: document.querySelector("#groupList"),
  groupPager: document.querySelector("#groupPager"),
  groupsTab: document.querySelector("#groupsTab"),
  projectsTab: document.querySelector("#projectsTab"),
  groupsPane: document.querySelector("#groupsPane"),
  projectsPane: document.querySelector("#projectsPane"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  workspaceCopy: document.querySelector("#workspaceCopy"),
};

const PAGE_SIZE = 20;
const isOrganizePage = document.body.dataset.connectionsPage === "organize";
const canSelectAccounts = Boolean(document.querySelector("#assignGroupSelect") && document.querySelector("#accountList"));
const state = { accounts: [], groups: [], projects: [], page: 1, groupPage: 1, tab: "groups" };

elements.saveButton?.addEventListener("click", saveSettings);
elements.testButton?.addEventListener("click", testConnection);
elements.refreshButton?.addEventListener("click", () => loadAccounts({ refresh: true }));
elements.bridgeUrl?.addEventListener("input", updateAuthorizeLink);
elements.projectFilter?.addEventListener("change", () => {
  state.groupPage = 1;
  syncNewGroupProjectFromFilter();
  fillGroupSelects();
  renderGroups();
});
elements.groupFilter?.addEventListener("change", () => { state.page = 1; renderAccounts(); syncGroupReportBar(); });
elements.accountSearch?.addEventListener("input", () => { state.page = 1; renderAccounts(); });
elements.groupSearch?.addEventListener("input", () => { state.groupPage = 1; renderGroups(); });
elements.deleteProjectSelect?.addEventListener("change", fillDeleteGroupSelect);
elements.createProjectBtn?.addEventListener("click", createProject);
elements.deleteProjectBtn?.addEventListener("click", deleteCurrentProject);
elements.createGroupBtn?.addEventListener("click", createGroup);
elements.saveGroupProjectBtn?.addEventListener("click", saveCurrentGroupProject);
elements.moveGroupToProjectBtn?.addEventListener("click", moveSelectedGroups);
elements.selectVisibleBtn?.addEventListener("click", selectVisible);
elements.selectVisibleGroupsBtn?.addEventListener("click", selectVisibleGroups);
elements.assignGroupBtn?.addEventListener("click", assignSelected);
elements.deleteGroupBtn?.addEventListener("click", deleteCurrentGroup);
elements.groupsTab?.addEventListener("click", () => setWorkspaceTab("groups"));
elements.projectsTab?.addEventListener("click", () => setWorkspaceTab("projects"));

await loadSettings();
await loadAccounts();

async function loadSettings() {
  if (!elements.bridgeUrl) return;
  try {
    const result = await requestJson("/api/private-tiktok/settings");
    const settings = result.settings || {};
    elements.bridgeUrl.value = settings.baseUrl || "https://tiktokaitool.com";
    if (elements.settingsSummary) elements.settingsSummary.textContent = settings.configured ? `已连接 · ${settings.baseUrl}` : "尚未配置桥接 API Key。";
    updateAuthorizeLink();
  } catch (error) {
    if (elements.settingsSummary) elements.settingsSummary.textContent = error.message || "读取配置失败。";
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
  if (elements.accountList) elements.accountList.innerHTML = '<div class="empty-state">正在读取已授权账号...</div>';
  try {
    const [result, hub] = await Promise.all([
      requestJson(`/api/private-tiktok/accounts${refresh ? "?refresh=1" : ""}`),
      requestJson("/api/official-tiktok/publish-accounts").catch(() => ({ accounts: [] }))
    ]);
    state.accounts = attachPublishRiskMarks(Array.isArray(result.accounts) ? result.accounts : [], hub.accounts || []);
    state.groups = Array.isArray(result.groups) ? result.groups : [];
    state.projects = Array.isArray(result.projects) ? result.projects : [];
    fillProjectSelects();
    applyOrganizeQuery();
    fillGroupSelects();
    state.page = 1;
    state.groupPage = 1;
    renderWorkspace();
    syncGroupReportBar();
    showStatus(`已读取 ${state.accounts.length} 个已授权账号，${state.projects.length} 个项目，${state.groups.length} 个分组。`);
  } catch (error) {
    state.accounts = [];
    if (elements.accountList) elements.accountList.innerHTML = '<div class="empty-state">暂时无法读取账号。</div>';
    showStatus(error.message || "读取已授权账号失败。", true);
  } finally {
    setBusy(elements.refreshButton, false, "刷新账号");
  }
}

function fillProjectSelects() {
  const current = elements.projectFilter?.value || "";
  const options = state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}（${project.groupCount || 0} 组）</option>`).join("");
  if (elements.projectFilter) {
    elements.projectFilter.innerHTML = `<option value="">全部项目</option><option value="unassigned">未分配项目</option>${options}`;
    if ([...elements.projectFilter.options].some((item) => item.value === current)) elements.projectFilter.value = current;
  }
  if (elements.deleteProjectSelect) {
    const selected = elements.deleteProjectSelect.value;
    elements.deleteProjectSelect.innerHTML = `<option value="">请选择项目</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("")}`;
    if ([...elements.deleteProjectSelect.options].some((item) => item.value === selected)) elements.deleteProjectSelect.value = selected;
  }
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
  const projectId = elements.projectFilter?.value || "";
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
  const options = state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.projectName ? `${group.projectName} / ${group.name}` : group.name)}（${counts[group.id] || group.accountCount || 0}）</option>`).join("");
  const currentFilter = elements.groupFilter?.value || "";
  const currentAssign = elements.assignGroupSelect?.value || "";
  if (elements.groupFilter) {
    elements.groupFilter.innerHTML = `<option value="">全部分组</option><option value="ungrouped">未分组</option>${options}`;
    if ([...elements.groupFilter.options].some((item) => item.value === currentFilter)) elements.groupFilter.value = currentFilter;
  }
  if (elements.assignGroupSelect) {
    elements.assignGroupSelect.innerHTML = `<option value="">未分组</option>${state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.projectName ? `${group.projectName} / ${group.name}` : group.name)}</option>`).join("")}`;
    if ([...elements.assignGroupSelect.options].some((item) => item.value === currentAssign)) elements.assignGroupSelect.value = currentAssign;
  }
  if (elements.moveGroupSelect) {
    const currentMove = elements.moveGroupSelect.value || (currentFilter && currentFilter !== "ungrouped" ? currentFilter : "");
    elements.moveGroupSelect.innerHTML = `<option value="">请选择分组</option>${state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.projectName ? `${group.projectName} / ${group.name}` : group.name)}</option>`).join("")}`;
    if ([...elements.moveGroupSelect.options].some((item) => item.value === currentMove)) elements.moveGroupSelect.value = currentMove;
  }
  fillDeleteGroupSelect();
}

function fillDeleteGroupSelect() {
  if (!elements.deleteGroupSelect) return;
  const projectId = elements.deleteProjectSelect?.value || "";
  const groups = state.groups.filter((group) => !projectId || group.projectId === projectId);
  const current = elements.deleteGroupSelect.value;
  elements.deleteGroupSelect.innerHTML = `<option value="">请选择分组</option>${groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.projectName ? `${group.projectName} / ${group.name}` : group.name)}</option>`).join("")}`;
  if ([...elements.deleteGroupSelect.options].some((item) => item.value === current)) elements.deleteGroupSelect.value = current;
}

function visibleAccounts() {
  const groupId = elements.groupFilter?.value || "";
  const query = String(elements.accountSearch?.value || "").trim().toLowerCase();
  return state.accounts.filter((account) => {
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

function listedGroups() {
  const projectId = elements.projectFilter?.value || "";
  const query = String(elements.groupSearch?.value || "").trim().toLowerCase();
  return state.groups.filter((group) => {
    if (projectId === "unassigned" && group.projectId) return false;
    if (projectId && projectId !== "unassigned" && group.projectId !== projectId) return false;
    if (query) {
      const haystack = [group.name, group.projectName, group.id];
      if (!haystack.some((value) => String(value || "").toLowerCase().includes(query))) return false;
    }
    return true;
  }).sort((left, right) => String(left.projectName || "未分配项目").localeCompare(String(right.projectName || "未分配项目"), "zh-CN") || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN"));
}

function pagedAccounts() {
  const accounts = visibleAccounts();
  const total = accounts.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  return { accounts: accounts.slice(start, start + PAGE_SIZE), total, pageCount };
}

function renderAccounts() {
  if (!elements.accountList) return;
  const paged = pagedAccounts();
  if (!state.accounts.length) {
    elements.accountList.innerHTML = '<div class="empty-state">暂无已授权账号。请先前往 TikTok AI Tool 完成授权。</div>';
    renderPager(elements.accountPager, state.page, 0, 1);
    updateSelectedCount();
    return;
  }
  if (!paged.total) {
    elements.accountList.innerHTML = '<div class="empty-state">当前筛选下没有账号。</div>';
    renderPager(elements.accountPager, state.page, 0, 1);
    updateSelectedCount();
    return;
  }
  elements.accountList.innerHTML = paged.accounts.map((account) => {
    const profile = account.profile || {};
    const username = profile.username ? `@${profile.username}` : profile.displayName || account.label || "TikTok 账号";
    const displayName = profile.displayName && profile.displayName !== profile.username ? profile.displayName : "官方授权账号";
    const videoCount = Number(account.syncedVideoCount ?? account.videoCount ?? 0);
    const syncedAt = formatTime(account.syncedAt || account.updatedAt);
    const key = accountKey(account);
    const risk = account.publishRisk;
    const riskTitle = risk?.flagged ? `${risk.label || "官方接口风控"}（${risk.reason || "spam_risk"}）${Number(risk.count || 0) > 1 ? ` · ${risk.count} 次` : ""}` : "";
    const checkbox = canSelectAccounts
      ? `<input class="account-check" type="checkbox" value="${escapeHtml(key)}" data-schema="${escapeHtml(account.schema || "")}" data-username="${escapeHtml(profile.username || "")}" />`
      : "";
    return `<article class="account-row${canSelectAccounts ? "" : " is-readonly"}${risk?.flagged ? " is-risk" : ""}">
      ${checkbox}
      <div><strong>${escapeHtml(username)}${risk?.flagged ? `<span class="risk-pill" title="${escapeHtml(riskTitle)}">风控</span>` : ""}</strong><span>${escapeHtml(displayName)}</span></div>
      <div><small>项目 / 分组</small><b class="group-chip${account.groupName ? "" : " is-empty"}">${escapeHtml([account.projectName, account.groupName || "未分组"].filter(Boolean).join(" / "))}</b></div>
      <div><small>视频</small><b>${formatNumber(videoCount)}</b></div>
      <div><small>最近同步</small><b>${escapeHtml(syncedAt)}</b></div>
      <div><small>状态</small><b class="${risk?.flagged ? "risk-pill" : "ready-pill"}" title="${escapeHtml(riskTitle)}">${risk?.flagged ? "风控" : "已授权"}</b></div>
    </article>`;
  }).join("");
  elements.accountList.querySelectorAll(".account-check").forEach((input) => input.addEventListener("change", () => {
    input.closest(".account-row")?.classList.toggle("is-checked", input.checked);
    updateSelectedCount();
  }));
  renderPager(elements.accountPager, state.page, paged.total, paged.pageCount, (page) => {
    state.page = page;
    renderAccounts();
  });
  updateSelectedCount();
}

function pagedGroups() {
  const groups = listedGroups();
  const total = groups.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  state.groupPage = Math.min(Math.max(1, state.groupPage), pageCount);
  const start = (state.groupPage - 1) * PAGE_SIZE;
  return { groups: groups.slice(start, start + PAGE_SIZE), total, pageCount };
}

function groupAccountCount(groupId) {
  return state.accounts.filter((account) => account.groupId === groupId).length;
}

function renderGroups() {
  if (!elements.groupList) return;
  const paged = pagedGroups();
  if (!state.groups.length) {
    elements.groupList.innerHTML = '<div class="empty-state">暂无分组。请先到管理页新建分组。</div>';
    renderPager(elements.groupPager, state.groupPage, 0, 1);
    updateSelectedGroupCount();
    return;
  }
  if (!paged.total) {
    elements.groupList.innerHTML = '<div class="empty-state">当前筛选下没有分组。</div>';
    renderPager(elements.groupPager, state.groupPage, 0, 1);
    updateSelectedGroupCount();
    return;
  }
  elements.groupList.innerHTML = paged.groups.map((group) => {
    const count = groupAccountCount(group.id) || Number(group.accountCount || 0);
    return `<article class="account-row group-row">
      <input class="group-check" type="checkbox" value="${escapeHtml(group.id)}" />
      <div><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.projectName ? "已分配项目" : "尚未分配项目")}</span></div>
      <div><small>所属项目</small><b class="group-chip${group.projectName ? "" : " is-empty"}">${escapeHtml(group.projectName || "未分配项目")}</b></div>
      <div><small>账号</small><b>${formatNumber(count)}</b></div>
    </article>`;
  }).join("");
  elements.groupList.querySelectorAll(".group-check").forEach((input) => input.addEventListener("change", () => {
    input.closest(".account-row")?.classList.toggle("is-checked", input.checked);
    updateSelectedGroupCount();
  }));
  renderPager(elements.groupPager, state.groupPage, paged.total, paged.pageCount, (page) => {
    state.groupPage = page;
    renderGroups();
  });
  updateSelectedGroupCount();
}

function setWorkspaceTab(tab) {
  state.tab = tab === "projects" ? "projects" : "groups";
  const isProjects = state.tab === "projects";
  elements.groupsTab?.classList.toggle("is-active", !isProjects);
  elements.projectsTab?.classList.toggle("is-active", isProjects);
  if (elements.groupsTab) elements.groupsTab.setAttribute("aria-selected", String(!isProjects));
  if (elements.projectsTab) elements.projectsTab.setAttribute("aria-selected", String(isProjects));
  if (elements.groupsPane) elements.groupsPane.hidden = isProjects;
  if (elements.projectsPane) elements.projectsPane.hidden = !isProjects;
  if (elements.workspaceTitle) elements.workspaceTitle.textContent = isProjects ? "项目" : "分组";
  if (elements.workspaceCopy) elements.workspaceCopy.textContent = isProjects ? "只展示分组。勾选后移入项目，每页 20 个。" : "只展示账号。勾选后移入分组，每页 20 个。";
  renderWorkspace();
}

function renderWorkspace() {
  if (state.tab === "projects") renderGroups();
  else renderAccounts();
}

function renderPager(pager, currentPage, total, pageCount, onPage) {
  if (!pager) return;
  if (total <= PAGE_SIZE) {
    pager.hidden = true;
    pager.innerHTML = "";
    return;
  }
  pager.hidden = false;
  const buttons = [
    `<button type="button" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>`
  ];
  for (let page = 1; page <= pageCount; page += 1) {
    if (pageCount > 9 && page !== 1 && page !== pageCount && Math.abs(page - currentPage) > 2) {
      if (buttons[buttons.length - 1] !== "<span>…</span>") buttons.push("<span>…</span>");
      continue;
    }
    buttons.push(`<button type="button" data-page="${page}" class="${page === currentPage ? "is-active" : ""}">${page}</button>`);
  }
  buttons.push(`<button type="button" data-page="${currentPage + 1}" ${currentPage >= pageCount ? "disabled" : ""}>下一页</button>`);
  pager.innerHTML = `<span>每页 ${PAGE_SIZE} 个 · 第 ${currentPage} / ${pageCount} 页 · 共 ${total} 个</span>${buttons.join("")}`;
  pager.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.page);
      if (!Number.isFinite(next) || next < 1 || next > pageCount || next === currentPage || !onPage) return;
      onPage(next);
    });
  });
}

function applyOrganizeQuery() {
  if (!isOrganizePage) return;
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project") || "";
  const groupId = params.get("group") || "";
  if (projectId && elements.projectFilter && [...elements.projectFilter.options].some((item) => item.value === projectId)) {
    elements.projectFilter.value = projectId;
  }
  syncNewGroupProjectFromFilter();
  if (groupId) {
    fillGroupSelects();
    if (elements.groupFilter && [...elements.groupFilter.options].some((item) => item.value === groupId)) {
      elements.groupFilter.value = groupId;
    }
  }
}

function selectVisible() {
  const inputs = Array.from(elements.accountList?.querySelectorAll(".account-check") || []);
  const shouldCheck = inputs.some((input) => !input.checked);
  inputs.forEach((input) => {
    input.checked = shouldCheck;
    input.closest(".account-row")?.classList.toggle("is-checked", shouldCheck);
  });
  updateSelectedCount();
}

function selectVisibleGroups() {
  const inputs = Array.from(elements.groupList?.querySelectorAll(".group-check") || []);
  const shouldCheck = inputs.some((input) => !input.checked);
  inputs.forEach((input) => {
    input.checked = shouldCheck;
    input.closest(".account-row")?.classList.toggle("is-checked", shouldCheck);
  });
  updateSelectedGroupCount();
}

function selectedGroups() {
  return Array.from(elements.groupList?.querySelectorAll(".group-check:checked") || []).map((input) => input.value).filter(Boolean);
}

function selectedAccounts() {
  return Array.from(elements.accountList?.querySelectorAll(".account-check:checked") || []).map((input) => ({
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
    if (created && elements.projectFilter) elements.projectFilter.value = created.id;
    if (created && elements.deleteProjectSelect) elements.deleteProjectSelect.value = created.id;
    fillGroupSelects();
    showStatus(`已创建项目「${name}」。`);
  } catch (error) {
    showStatus(error.message || "创建项目失败。", true);
  } finally {
    setBusy(elements.createProjectBtn, false, "新建");
  }
}

async function deleteCurrentProject() {
  const projectId = elements.deleteProjectSelect?.value || elements.projectFilter?.value || "";
  if (!projectId || projectId === "unassigned") return showStatus("请先选择要删除的项目。", true);
  const project = state.projects.find((item) => item.id === projectId);
  if (!window.confirm(`删除项目「${project?.name || projectId}」后，组还会在，只是不再属于这个项目。确定删除吗？`)) return;
  setBusy(elements.deleteProjectBtn, true, "删除中...");
  try {
    const result = await requestJson(`/api/official-tiktok/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    applyGroupState(result);
    if (elements.projectFilter) elements.projectFilter.value = "";
    if (elements.deleteProjectSelect) elements.deleteProjectSelect.value = "";
    fillGroupSelects();
    renderWorkspace();
    showStatus("项目已删除。");
  } catch (error) {
    showStatus(error.message || "删除项目失败。", true);
  } finally {
    setBusy(elements.deleteProjectBtn, false, "删除所选项目");
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
    if (project && elements.projectFilter) elements.projectFilter.value = project.id;
    if (project && elements.deleteProjectSelect) elements.deleteProjectSelect.value = project.id;
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

async function moveSelectedGroups() {
  const groupIds = selectedGroups();
  const projectId = elements.moveGroupProjectSelect?.value || "";
  if (!groupIds.length) return showStatus("请先勾选要移动的分组。", true);
  if (!projectId) return showStatus("请选择要移入的项目。", true);
  const project = state.projects.find((item) => item.id === projectId);
  setBusy(elements.moveGroupToProjectBtn, true, "移动中...");
  try {
    let result = null;
    for (const groupId of groupIds) {
      result = await requestJson(`/api/official-tiktok/account-groups/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
    }
    applyGroupState(result || {});
    if (elements.projectFilter) elements.projectFilter.value = projectId;
    fillGroupSelects();
    renderWorkspace();
    showStatus(`已将 ${groupIds.length} 个分组移入「${project?.name || "项目"}」。`);
  } catch (error) {
    showStatus(error.message || "分组移入项目失败。", true);
  } finally {
    setBusy(elements.moveGroupToProjectBtn, false, "移入项目");
  }
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
    if (elements.projectFilter) elements.projectFilter.value = projectId;
    if (elements.groupFilter) elements.groupFilter.value = groupId;
    fillGroupSelects();
    renderWorkspace();
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
  const groupId = elements.deleteGroupSelect?.value || elements.groupFilter?.value || "";
  if (!groupId || groupId === "ungrouped") return showStatus("请先选择要删除的分组。", true);
  const group = state.groups.find((item) => item.id === groupId);
  if (!window.confirm(`删除分组「${group?.name || groupId}」后，组内账号会回到未分组。确定删除吗？`)) return;
  setBusy(elements.deleteGroupBtn, true, "删除中...");
  try {
    const result = await requestJson(`/api/official-tiktok/account-groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
    applyGroupState(result);
    if (elements.groupFilter) elements.groupFilter.value = "";
    if (elements.deleteGroupSelect) elements.deleteGroupSelect.value = "";
    renderWorkspace();
    showStatus("分组已删除，账号已回到未分组。");
  } catch (error) {
    showStatus(error.message || "删除分组失败。", true);
  } finally {
    setBusy(elements.deleteGroupBtn, false, "删除所选分组");
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
  renderWorkspace();
  syncGroupReportBar();
}

function currentGroupId() {
  const groupId = elements.groupFilter?.value || "";
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
  const count = elements.accountList?.querySelectorAll(".account-check:checked").length || 0;
  if (elements.selectedCount) elements.selectedCount.textContent = `已选 ${count} 个`;
}

function updateSelectedGroupCount() {
  const count = elements.groupList?.querySelectorAll(".group-check:checked").length || 0;
  if (elements.selectedGroupCount) elements.selectedGroupCount.textContent = `已选 ${count} 个`;
}

function updateAuthorizeLink() {
  const baseUrl = String(elements.bridgeUrl?.value || "https://tiktokaitool.com").trim().replace(/\/+$/, "");
  elements.authorizeLink.href = `${baseUrl || "https://tiktokaitool.com"}/dashboard?view=connect`;
}

function showStatus(message, isError = false) {
  if (!elements.statusMessage) return;
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
