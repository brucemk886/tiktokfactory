const state = { users: [], profiles: [], groups: [], groupHint: "选择 GeeLark 配置后自动读取分组" };
const $ = (selector) => document.querySelector(selector);
const SIDEBAR_MODULES = Object.freeze([
  { id: "psychology-topics", label: "心理学题目", adminOnly: true },
  { id: "psychology", label: "心理学视频自动化", adminOnly: true },
  { id: "schulte", label: "舒尔特训练", adminOnly: true },
  { id: "ai", label: "AI 创作", adminOnly: true },
  { id: "asset-usage", label: "素材使用率", adminOnly: true },
  { id: "tasks", label: "Reddit 自动发布" },
  { id: "stats", label: "发布记录" },
  { id: "analytics", label: "数据总览" },
  { id: "operator", label: "小说 AI 自运营", adminOnly: true },
  { id: "tiktok-connections", label: "TikTok 官方账号", adminOnly: true },
  { id: "analytics-settings", label: "抓取配置", adminOnly: true },
  { id: "accounts", label: "账户管理", adminOnly: true }
]);

$("#profileForm").addEventListener("submit", saveProfile);
$("#userForm").addEventListener("submit", saveUser);
$("#clearUserBtn").addEventListener("click", clearUserForm);
$("#userProfile").addEventListener("change", () => loadProfileGroups([]));
$("#userRole").addEventListener("change", () => {
  updateGroupPermissionHint();
  renderSidebarOptions(selectedSidebarModules());
});
$("#refreshUserGroupsBtn").addEventListener("click", () => loadProfileGroups(selectedGroups()));
$("#selectAllUserGroupsBtn").addEventListener("click", () => setAllGroups(true));
$("#clearUserGroupsBtn").addEventListener("click", () => setAllGroups(false));
$("#selectAllSidebarBtn").addEventListener("click", () => setAllSidebarModules(true));
$("#clearSidebarBtn").addEventListener("click", () => setAllSidebarModules(false));
$("#saveSidebarBtn").addEventListener("click", saveSidebarSettings);

load();

async function load() {
  const response = await fetch("/api/admin/accounts");
  const data = await response.json();
  if (!response.ok) return alert(data.error || "读取账户配置失败。");
  state.users = data.users || [];
  state.profiles = data.profiles || [];
  render();
  renderSidebarOptions(defaultSidebarModules($("#userRole").value));
  await loadProfileGroups([]);
}

function render() {
  const selectedProfileId = $("#userProfile").value;
  $("#userProfile").innerHTML = state.profiles.map((profile) => (
    `<option value="${esc(profile.id)}">${esc(profile.name)}${profile.hasApiKey ? "" : "（未配置密钥）"}</option>`
  )).join("");
  if (state.profiles.some((profile) => profile.id === selectedProfileId)) $("#userProfile").value = selectedProfileId;

  $("#profileList").innerHTML = state.profiles.map((profile) => `
    <article>
      <div><strong>${esc(profile.name)}</strong><small>${esc(profile.appId || "未填写 App ID")} · ${profile.hasApiKey ? "已保存 API Key" : "未保存 API Key"}</small></div>
      <div><button data-edit-profile="${esc(profile.id)}">编辑</button>${profile.id !== "default" ? `<button data-delete-profile="${esc(profile.id)}">删除</button>` : ""}</div>
    </article>
  `).join("");

  $("#userList").innerHTML = state.users.map((user) => {
    const groupText = user.role === "admin"
      ? "全部 GeeLark 分组"
      : (user.allowedGeeLarkGroups?.length ? `分组：${user.allowedGeeLarkGroups.join("、")}` : "未分配 GeeLark 分组");
    const directoryText = user.allowedDirectory ? user.allowedDirectory : "未分配共享目录";
    const sidebarText = sidebarModuleSummary(user.sidebarModules, user.role);
    return `
      <article>
        <div>
          <strong>${esc(user.username)}</strong>
          <small>${user.role === "admin" ? "管理员" : "成员"} · ${esc(profileName(user.geelarkProfileId))}</small>
          <small>${esc(groupText)} · ${esc(directoryText)}</small>
          <small>侧边栏：${esc(sidebarText)}</small>
        </div>
        <div><span class="status-dot ${user.active ? "" : "off"}">${user.active ? "启用" : "停用"}</span><button data-edit-user="${esc(user.id)}">编辑</button></div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-edit-profile]").forEach((button) => {
    button.onclick = () => editProfile(button.dataset.editProfile);
  });
  document.querySelectorAll("[data-delete-profile]").forEach((button) => {
    button.onclick = () => deleteProfile(button.dataset.deleteProfile);
  });
  document.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.onclick = () => editUser(button.dataset.editUser);
  });
}

function profileName(id) {
  return state.profiles.find((profile) => profile.id === id)?.name || "默认 GeeLark";
}

function editProfile(id) {
  const profile = state.profiles.find((item) => item.id === id);
  $("#profileId").value = profile.id;
  $("#profileName").value = profile.name;
  $("#profileBaseUrl").value = profile.apiBaseUrl;
  $("#profileAppId").value = profile.appId;
  $("#profileApiKey").value = "";
  $("#profileStatus").textContent = `正在编辑：${profile.name}`;
}

async function saveProfile(event) {
  event.preventDefault();
  const response = await fetch("/api/admin/geelark-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: $("#profileId").value,
      name: $("#profileName").value,
      apiBaseUrl: $("#profileBaseUrl").value,
      appId: $("#profileAppId").value,
      apiKey: $("#profileApiKey").value
    })
  });
  const data = await response.json();
  $("#profileStatus").textContent = response.ok ? "GeeLark 配置已保存。" : data.error || "保存失败。";
  if (response.ok) {
    $("#profileForm").reset();
    $("#profileBaseUrl").value = "https://openapi.geelark.cn";
    await load();
  }
}

async function deleteProfile(id) {
  if (!confirm("确定删除这条 GeeLark 配置？")) return;
  const response = await fetch(`/api/admin/geelark-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "删除失败。");
  await load();
}

async function editUser(id) {
  const user = state.users.find((item) => item.id === id);
  $("#userId").value = user.id;
  $("#userName").value = user.username;
  $("#userName").disabled = true;
  $("#userRole").value = user.role;
  $("#userProfile").value = user.geelarkProfileId;
  $("#userAllowedDirectory").value = user.allowedDirectory || "";
  $("#userPassword").value = "";
  $("#userActive").checked = user.active;
  $("#userStatus").textContent = `正在编辑：${user.username}`;
  renderSidebarOptions(user.sidebarModules || defaultSidebarModules(user.role));
  updateGroupPermissionHint();
  await loadProfileGroups(user.allowedGeeLarkGroups || []);
}

async function clearUserForm() {
  $("#userForm").reset();
  $("#userId").value = "";
  $("#userName").disabled = false;
  $("#userActive").checked = true;
  $("#userStatus").textContent = "";
  renderSidebarOptions(defaultSidebarModules($("#userRole").value));
  updateGroupPermissionHint();
  await loadProfileGroups([]);
}

async function saveUser(event) {
  event.preventDefault();
  const id = $("#userId").value;
  const payload = {
    username: $("#userName").value,
    displayName: $("#userName").value,
    role: $("#userRole").value,
    geelarkProfileId: $("#userProfile").value,
    allowedGeeLarkGroups: selectedGroups(),
    sidebarModules: selectedSidebarModules(),
    allowedDirectory: $("#userAllowedDirectory").value,
    password: $("#userPassword").value,
    active: $("#userActive").checked
  };
  const response = await fetch(id ? `/api/admin/accounts/${encodeURIComponent(id)}` : "/api/admin/accounts", {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  $("#userStatus").textContent = response.ok ? "登录账号已保存。" : data.error || "保存失败。";
  if (response.ok) {
    await clearUserForm();
    await load();
  }
}

async function saveSidebarSettings() {
  const id = $("#userId").value;
  const status = $("#sidebarSaveStatus");
  if (!id) {
    status.textContent = "请先从下方账号列表点击“编辑”；新账号请使用“保存登录账号”。";
    return;
  }

  const button = $("#saveSidebarBtn");
  button.disabled = true;
  status.textContent = "正在保存...";
  try {
    const response = await fetch(`/api/admin/accounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: $("#userRole").value,
        sidebarModules: selectedSidebarModules()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存失败。");
    status.textContent = "角色与侧边栏设置已保存，刷新或重新登录后生效。";
    await load();
  } catch (error) {
    status.textContent = error.message || "保存失败。";
  } finally {
    button.disabled = false;
  }
}

async function loadProfileGroups(preserveSelection = []) {
  const profileId = $("#userProfile").value;
  const groupSelect = $("#userGroups");
  if (!profileId) {
    groupSelect.innerHTML = "";
    state.groupHint = "请先创建 GeeLark 配置";
    $("#userGroupsHint").textContent = state.groupHint;
    return;
  }
  state.groupHint = "正在读取 GeeLark 分组...";
  $("#userGroupsHint").textContent = state.groupHint;
  $("#refreshUserGroupsBtn").disabled = true;
  try {
    const response = await fetch(`/api/admin/geelark-profiles/${encodeURIComponent(profileId)}/groups?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取分组失败。");
    state.groups = data.groups || [];
    renderGroupOptions(preserveSelection);
    state.groupHint = state.groups.length
      ? `共 ${state.groups.length} 个分组、${data.accountCount || 0} 个账号，可同时勾选多个`
      : "该配置未读取到 GeeLark 分组";
    $("#userGroupsHint").textContent = state.groupHint;
  } catch (error) {
    state.groups = [];
    renderGroupOptions(preserveSelection);
    state.groupHint = error.message || "读取分组失败。";
    $("#userGroupsHint").textContent = state.groupHint;
  } finally {
    $("#refreshUserGroupsBtn").disabled = false;
    updateGroupPermissionHint();
  }
}

function renderGroupOptions(selected) {
  const selectedSet = new Set((selected || []).map(String));
  const currentNames = new Set(state.groups.map((group) => group.name));
  const options = state.groups.map((group) => ({ name: group.name, label: `${group.name}（${group.accountCount} 个账号）` }));
  for (const name of selectedSet) {
    if (!currentNames.has(name)) options.push({ name, label: `${name}（已保存，当前接口未返回）` });
  }
  $("#userGroups").innerHTML = options.map((group) => (
    `<label class="group-checkbox-item"><input type="checkbox" value="${esc(group.name)}"${selectedSet.has(group.name) ? " checked" : ""}><span>${esc(group.label)}</span></label>`
  )).join("");
}

function selectedGroups() {
  return Array.from($("#userGroups").querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function setAllGroups(checked) {
  if ($("#userRole").value === "admin") return;
  $("#userGroups").querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
  });
}

function updateGroupPermissionHint() {
  const groupList = $("#userGroups");
  const isAdmin = $("#userRole").value === "admin";
  groupList.classList.toggle("is-disabled", isAdmin);
  groupList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.disabled = isAdmin;
  });
  $("#selectAllUserGroupsBtn").disabled = isAdmin;
  $("#clearUserGroupsBtn").disabled = isAdmin;
  $("#userGroupsHint").textContent = isAdmin ? "管理员默认可以查看全部 GeeLark 分组" : state.groupHint;
}

function availableSidebarModules(role = $("#userRole").value) {
  return SIDEBAR_MODULES.filter((item) => role === "admin" || !item.adminOnly);
}

function defaultSidebarModules(role) {
  return availableSidebarModules(role).map((item) => item.id);
}

function renderSidebarOptions(selected) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : defaultSidebarModules($("#userRole").value));
  const modules = availableSidebarModules();
  $("#userSidebarModules").innerHTML = modules.map((item) => (
    `<label class="sidebar-checkbox-item"><input type="checkbox" value="${esc(item.id)}"${selectedSet.has(item.id) ? " checked" : ""}><span>${esc(item.label)}</span></label>`
  )).join("");
  $("#userSidebarHint").textContent = $("#userRole").value === "admin"
    ? "勾选后，该管理员登录时才显示对应模块。"
    : "成员仅可选择任务、发布记录和数据总览。";
}

function selectedSidebarModules() {
  return Array.from($("#userSidebarModules").querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function setAllSidebarModules(checked) {
  $("#userSidebarModules").querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
  });
}

function sidebarModuleSummary(selected, role) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : defaultSidebarModules(role));
  const labels = SIDEBAR_MODULES.filter((item) => selectedSet.has(item.id)).map((item) => item.label);
  if (!labels.length) return "全部隐藏";
  if (labels.length === availableSidebarModules(role).length) return "全部显示";
  return labels.join("、");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}
