const state = { users: [], profiles: [], groups: [], sidebarModules: [], groupHint: "选择配置后读取分组" };
const $ = (selector) => document.querySelector(selector);

$("#profileForm").addEventListener("submit", saveProfile);
$("#refreshPhonesBtn")?.addEventListener("click", loadPhones);
$("#userForm").addEventListener("submit", saveUserAccess);
$("#userProfile").addEventListener("change", () => loadProfileGroups([]));
$("#refreshUserGroupsBtn").addEventListener("click", () => loadProfileGroups(selectedGroups()));
$("#selectAllUserGroupsBtn").addEventListener("click", () => setAllGroups(true));
$("#clearUserGroupsBtn").addEventListener("click", () => setAllGroups(false));

load();

async function load() {
  const response = await fetch("/api/admin/accounts");
  const data = await response.json();
  if (!response.ok) return alert(data.error || "读取 GeeLark 配置失败。");
  state.users = data.users || [];
  state.profiles = data.profiles || [];
  state.sidebarModules = data.sidebarModules || [];
  renderProfiles();
  renderProfileOptions();
  renderPeople();
  await loadPhones();
  const user = currentUser();
  if (user) await editUser(user.id);
}

function renderProfiles() {
  $("#profileList").innerHTML = state.profiles.map((profile) => `
    <article class="entity-card">
      <div>
        <strong>${esc(profile.name)}</strong>
        <small>${esc(profile.appId || "未填写 App ID")} · ${profile.hasApiKey ? "已保存 API Key" : "未保存 API Key"}</small>
      </div>
      <div class="entity-actions">
        <button data-edit-profile="${esc(profile.id)}" type="button">编辑</button>
        ${profile.id !== "default" ? `<button data-delete-profile="${esc(profile.id)}" type="button">删除</button>` : ""}
      </div>
    </article>
  `).join("");
  document.querySelectorAll("[data-edit-profile]").forEach((button) => {
    button.onclick = () => editProfile(button.dataset.editProfile);
  });
  document.querySelectorAll("[data-delete-profile]").forEach((button) => {
    button.onclick = () => deleteProfile(button.dataset.deleteProfile);
  });
}

function renderProfileOptions() {
  const selected = $("#userProfile").value;
  $("#userProfile").innerHTML = state.profiles.map((profile) => (
    `<option value="${esc(profile.id)}">${esc(profile.name)}${profile.hasApiKey ? "" : "（未配置密钥）"}</option>`
  )).join("");
  if (state.profiles.some((profile) => profile.id === selected)) $("#userProfile").value = selected;
}

function renderPeople() {
  const editingId = $("#userId").value;
  const visibleUsers = state.users.filter((user) => user.active);
  $("#userList").innerHTML = visibleUsers.length
    ? visibleUsers.map((user) => `
      <button class="people-item${user.id === editingId ? " is-active" : ""}" type="button" data-edit-user="${esc(user.id)}">
        <strong>${esc(user.username)}</strong>
        <small>${user.role === "admin" ? "管理员" : "成员"} · ${esc(profileName(user.geelarkProfileId))}</small>
      </button>
    `).join("")
    : '<p class="empty-state">没有已启用的登录账号。</p>';
  document.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.onclick = () => editUser(button.dataset.editUser);
  });
}

function profileName(id) {
  return state.profiles.find((profile) => profile.id === id)?.name || "默认配置";
}

function currentUser() {
  return state.users.find((item) => item.id === $("#userId").value) || null;
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
      apiKey: $("#profileApiKey").value,
    }),
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
  if (!user) return;
  $("#userId").value = user.id;
  $("#formTitle").textContent = user.username;
  $("#userProfile").value = user.geelarkProfileId;
  $("#userStatus").textContent = "";
  renderGeeLarkModules(user.sidebarModules || []);
  updateGroupPermissionHint(user.role);
  renderPeople();
  await loadProfileGroups(user.allowedGeeLarkGroups || []);
}

async function saveUserAccess(event) {
  event.preventDefault();
  const user = currentUser();
  if (!user) {
    $("#userStatus").textContent = "请先选择左侧账号。";
    return;
  }
  const response = await fetch(`/api/admin/accounts/${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geelarkProfileId: $("#userProfile").value,
      allowedGeeLarkGroups: selectedGroups(),
      sidebarModules: mergeSidebarModules(user)
    })
  });
  const data = await response.json();
  $("#userStatus").textContent = response.ok ? "GeeLark 权限已保存。" : data.error || "保存失败。";
  if (response.ok) await load();
}

function isGeeLarkModule(item) {
  return item?.group?.id === "geelark-backup";
}

function geelarkModules(role) {
  return state.sidebarModules.filter((item) => item.roles?.includes(role) && isGeeLarkModule(item));
}

function renderGeeLarkModules(selected) {
  const user = currentUser();
  const role = user?.role || "operator";
  const selectedSet = new Set(selected || []);
  const modules = geelarkModules(role);
  $("#userSidebarModules").innerHTML = `
    <div class="module-group">
      ${modules.map((item) => (
        `<label class="check-row"><input type="checkbox" value="${esc(item.id)}"${selectedSet.has(item.id) ? " checked" : ""}><span>${esc(item.label)}</span></label>`
      )).join("")}
    </div>
  `;
}

function mergeSidebarModules(user) {
  const geelarkIds = new Set(state.sidebarModules.filter(isGeeLarkModule).map((item) => item.id));
  const keptBusiness = (user.sidebarModules || []).filter((moduleId) => !geelarkIds.has(moduleId));
  const selectedGeeLark = Array.from($("#userSidebarModules").querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
  return [...keptBusiness, ...selectedGeeLark];
}

async function loadPhones() {
  const status = $("#phoneStatus");
  const list = $("#phoneList");
  status.textContent = "正在读取在线账号…";
  try {
    const response = await fetch("/api/geelark/phones", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取 GeeLark 账号失败。");
    if (!data.configured) {
      status.textContent = "还没配好 API，先保存上面的 App ID 和 API Key。";
      list.innerHTML = '<p class="empty-state">未配置 GeeLark。</p>';
      return;
    }
    const phones = (data.phones || []).filter(isOnlinePhone);
    status.textContent = phones.length ? `当前在线 ${phones.length} 个账号。` : "现在没有在线、可以展示的账号。";
    list.innerHTML = phones.length
      ? phones.map((phone) => `
        <article class="entity-card">
          <div>
            <strong>${esc(phone.serialName || phone.name || phone.serialNo || phone.id || "GeeLark 账号")}</strong>
            <small>${esc(phone.groupName || "未分组")} · ${esc(phone.serialNo || phone.id || "")}</small>
          </div>
          <div class="entity-actions"><span class="status-dot">在线</span></div>
        </article>
      `).join("")
      : '<p class="empty-state">没有在线账号。</p>';
  } catch (error) {
    status.textContent = error.message || "读取在线账号失败。";
    list.innerHTML = `<p class="empty-state">${esc(error.message || "读取失败")}</p>`;
  }
}

async function loadProfileGroups(preserveSelection = []) {
  const profileId = $("#userProfile").value;
  if (!profileId) {
    $("#userGroups").innerHTML = "";
    state.groupHint = "请先保存 API 配置";
    $("#userGroupsHint").textContent = state.groupHint;
    return;
  }
  state.groupHint = "正在读取分组…";
  $("#userGroupsHint").textContent = state.groupHint;
  $("#refreshUserGroupsBtn").disabled = true;
  try {
    const response = await fetch(`/api/admin/geelark-profiles/${encodeURIComponent(profileId)}/groups?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取分组失败。");
    state.groups = data.groups || [];
    renderGroupOptions(preserveSelection);
    state.groupHint = state.groups.length
      ? `共 ${state.groups.length} 个分组、${data.accountCount || 0} 个在线可展示账号`
      : "该配置未读取到分组";
    $("#userGroupsHint").textContent = state.groupHint;
  } catch (error) {
    state.groups = [];
    renderGroupOptions(preserveSelection);
    state.groupHint = error.message || "读取分组失败。";
    $("#userGroupsHint").textContent = state.groupHint;
  } finally {
    $("#refreshUserGroupsBtn").disabled = false;
    updateGroupPermissionHint(currentUser()?.role);
  }
}

function renderGroupOptions(selected) {
  const selectedSet = new Set((selected || []).map(String));
  const currentNames = new Set(state.groups.map((group) => group.name));
  const options = state.groups.map((group) => ({ name: group.name, label: `${group.name}（${group.accountCount}）` }));
  for (const name of selectedSet) {
    if (!currentNames.has(name)) options.push({ name, label: `${name}（已保存）` });
  }
  $("#userGroups").innerHTML = `
    <div class="module-group">
      ${options.map((group) => (
        `<label class="check-row"><input type="checkbox" value="${esc(group.name)}"${selectedSet.has(group.name) ? " checked" : ""}><span>${esc(group.label)}</span></label>`
      )).join("")}
    </div>
  `;
}

function selectedGroups() {
  return Array.from($("#userGroups").querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function setAllGroups(checked) {
  if (currentUser()?.role === "admin") return;
  $("#userGroups").querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
  });
}

function updateGroupPermissionHint(role = currentUser()?.role) {
  const isAdmin = role === "admin";
  $("#userGroups").classList.toggle("is-disabled", Boolean(isAdmin));
  $("#userGroups").querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.disabled = isAdmin;
  });
  $("#selectAllUserGroupsBtn").disabled = isAdmin;
  $("#clearUserGroupsBtn").disabled = isAdmin;
  if (isAdmin) $("#userGroupsHint").textContent = "管理员默认可以查看全部分组";
}

function isOnlinePhone(phone) {
  if (phone.online === true || phone.isOnline === true || Number(phone.online) === 1) return true;
  if (phone.online === false || phone.isOnline === false || Number(phone.online) === 0) return false;
  const raw = phone.status ?? phone.onlineStatus ?? phone.envStatus ?? phone.runStatus ?? phone.rpaStatus;
  if (raw === undefined || raw === null || raw === "") return true;
  if (Number(raw) === 1) return true;
  if (Number(raw) === 0) return false;
  const status = String(raw).toLowerCase();
  if (["offline", "off", "stopped", "stop", "false", "离线", "未上线"].some((value) => status.includes(value))) return false;
  return ["online", "running", "on", "true", "已上线", "在线"].some((value) => status.includes(value)) || Number(raw) > 0;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}
