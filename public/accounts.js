const state = { users: [], profiles: [], sidebarModules: [], accountGroups: { projects: [], groups: [] }, originalPassword: "", currentUserId: "" };
const $ = (selector) => document.querySelector(selector);

$("#userForm").addEventListener("submit", saveUser);
$("#clearUserBtn").addEventListener("click", clearUserForm);
$("#togglePasswordBtn")?.addEventListener("click", togglePasswordVisible);
$("#copyPasswordBtn")?.addEventListener("click", copyPassword);
$("#deleteUserBtn")?.addEventListener("click", () => deleteUser($("#userId").value));
$("#userRole").addEventListener("change", () => {
  const user = currentUser();
  renderSidebarOptions(user ? user.sidebarModules : defaultBusinessModules($("#userRole").value));
  renderAccountGroups(user ? user.allowedAccountGroups : []);
});

load();

async function load() {
  const response = await fetch("/api/admin/accounts");
  const data = await response.json();
  if (!response.ok) return alert(data.error || "读取账户配置失败。");
  state.users = data.users || [];
  state.profiles = data.profiles || [];
  state.sidebarModules = data.sidebarModules || [];
  state.accountGroups = data.accountGroups || { projects: [], groups: [] };
  state.currentUserId = data.currentUserId || "";
  renderPeople();
  const editing = currentUser();
  renderSidebarOptions(editing ? editing.sidebarModules : defaultBusinessModules($("#userRole").value));
  renderAccountGroups(editing ? editing.allowedAccountGroups : []);
}

function renderPeople() {
  const editingId = $("#userId").value;
  const visibleUsers = state.users.filter((user) => user.active);
  $("#userList").innerHTML = visibleUsers.length
    ? visibleUsers.map((user) => `
      <div class="people-item${user.id === editingId ? " is-active" : ""}">
        <button class="people-main" type="button" data-edit-user="${esc(user.id)}">
          <span>
            <strong>${esc(user.username)}</strong>
            <small>${user.role === "admin" ? "管理员" : "成员"}</small>
            <small class="people-password">${user.password ? `密码 ${esc(user.password)}` : "密码未记录"}</small>
            <em>${esc(sidebarModuleSummary(user.sidebarModules, user.role))} · ${esc(accountGroupSummary(user.allowedAccountGroups))}</em>
          </span>
        </button>
      </div>
    `).join("")
    : '<p class="empty-state">还没有启用中的登录账号。</p>';
  document.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.onclick = () => editUser(button.dataset.editUser);
  });
}

function currentUser() {
  return state.users.find((item) => item.id === $("#userId").value) || null;
}

function editUser(id) {
  const user = state.users.find((item) => item.id === id);
  $("#userId").value = user.id;
  $("#formTitle").textContent = `编辑 ${user.username}`;
  $("#userName").value = user.username;
  $("#userName").disabled = true;
  $("#userRole").value = user.role;
  state.originalPassword = user.password || "";
  $("#userPassword").value = user.password || "";
  $("#userPassword").type = "text";
  $("#togglePasswordBtn").textContent = "隐藏";
  $("#passwordHint").textContent = user.password
    ? "可直接改这段密码，保存后立即生效。"
    : "旧密码已加密看不到，设一个新密码后就能在这里查看。";
  $("#userActive").checked = user.active;
  $("#userStatus").textContent = "";
  $("#deleteUserBtn").hidden = user.id === state.currentUserId;
  renderSidebarOptions(user.sidebarModules);
  renderAccountGroups(user.allowedAccountGroups);
  renderPeople();
}

function clearUserForm() {
  $("#userForm").reset();
  $("#userId").value = "";
  $("#formTitle").textContent = "新建账号";
  $("#userName").disabled = false;
  $("#userActive").checked = true;
  state.originalPassword = "";
  $("#userPassword").type = "text";
  $("#togglePasswordBtn").textContent = "隐藏";
  $("#passwordHint").textContent = "管理员可以直接查看和修改各账号密码。";
  $("#deleteUserBtn").hidden = true;
  $("#userStatus").textContent = "";
  renderSidebarOptions(defaultBusinessModules($("#userRole").value));
  renderAccountGroups([]);
  renderPeople();
}

async function saveUser(event) {
  event.preventDefault();
  const existing = currentUser();
  const role = $("#userRole").value;
  const payload = {
    username: $("#userName").value,
    displayName: $("#userName").value,
    role,
    sidebarModules: mergeSidebarModules(existing, role),
    allowedAccountGroups: selectedAccountGroups(),
    active: $("#userActive").checked
  };
  const nextPassword = $("#userPassword").value;
  if (!existing || nextPassword !== state.originalPassword) payload.password = nextPassword;
  if (existing) {
    payload.geelarkProfileId = existing.geelarkProfileId;
    payload.allowedGeeLarkGroups = existing.allowedGeeLarkGroups || [];
    payload.allowedDirectory = existing.allowedDirectory || "";
  }
  const id = existing?.id;
  const response = await fetch(id ? `/api/admin/accounts/${encodeURIComponent(id)}` : "/api/admin/accounts", {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  $("#userStatus").textContent = response.ok ? "账号已保存。" : data.error || "保存失败。";
  if (response.ok) {
    clearUserForm();
    await load();
  }
}

async function deleteUser(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  if (user.id === state.currentUserId) return alert("不能删除当前正在使用的账号。");
  if (!confirm(`确定删除账号 ${user.username}？删除后无法恢复。`)) return;
  const response = await fetch(`/api/admin/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return alert(data.error || "删除失败。");
  if ($("#userId").value === id) clearUserForm();
  await load();
}

function copyPassword() {
  const value = $("#userPassword").value;
  if (!value) return;
  navigator.clipboard.writeText(value).then(() => {
    $("#copyPasswordBtn").textContent = "已复制";
    setTimeout(() => { $("#copyPasswordBtn").textContent = "复制"; }, 1200);
  }).catch(() => {
    $("#userPassword").select();
    document.execCommand("copy");
  });
}

function togglePasswordVisible() {
  const input = $("#userPassword");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  $("#togglePasswordBtn").textContent = hidden ? "隐藏" : "显示";
}

function isGeeLarkModule(item) {
  return item?.group?.id === "geelark-backup";
}

function roleSidebarModules(role = $("#userRole").value) {
  return state.sidebarModules.filter((item) => Array.isArray(item.roles) && item.roles.includes(role));
}

function businessModules(role) {
  return roleSidebarModules(role).filter((item) => !isGeeLarkModule(item) && item.id !== "accounts");
}

function geelarkModules(role) {
  return roleSidebarModules(role).filter(isGeeLarkModule);
}

function businessGroups(role = $("#userRole").value) {
  const groups = [];
  for (const item of businessModules(role)) {
    const id = item.group?.id || item.id;
    const label = item.group?.label || item.label;
    let group = groups.find((entry) => entry.id === id);
    if (!group) {
      group = { id, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function defaultBusinessModules(role) {
  if (role === "operator") return [];
  return businessModules(role).map((item) => item.id);
}

function mergeSidebarModules(user, role) {
  const geelarkIds = new Set(geelarkModules(role).map((item) => item.id));
  const keptGeeLark = (user?.sidebarModules || []).filter((moduleId) => geelarkIds.has(moduleId));
  const pinned = role === "admin" ? ["accounts"] : [];
  return [...new Set([...selectedSidebarModules(), ...keptGeeLark, ...pinned])];
}

function renderSidebarOptions(selected) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  $("#userSidebarModules").innerHTML = businessGroups().map((group) => {
    const on = group.items.some((item) => selectedSet.has(item.id));
    const canExpand = group.items.length > 1;
    return `
      <div class="module-card${on ? " is-on" : ""}" data-group-id="${esc(group.id)}">
        <div class="module-card-head">
          <label class="module-switch">
            <input class="group-switch" type="checkbox"${on ? " checked" : ""}>
            <span>
              <strong>${esc(group.label)}</strong>
              <small>${esc(group.items.map((item) => item.label).join("、"))}</small>
            </span>
          </label>
          ${canExpand ? `<button class="module-expand is-open" type="button">收起</button>` : ""}
        </div>
        ${canExpand ? `
          <div class="module-children">
            ${group.items.map((item) => `
              <label class="check-row">
                <input class="child-switch" type="checkbox" value="${esc(item.id)}"${selectedSet.has(item.id) ? " checked" : ""}>
                <span>${esc(item.label)}</span>
              </label>
            `).join("")}
          </div>
        ` : `<input class="child-switch" type="checkbox" value="${esc(group.items[0].id)}"${selectedSet.has(group.items[0].id) ? " checked" : ""} hidden>`}
      </div>
    `;
  }).join("");
  $("#userSidebarHint").textContent = "打开大模块后，可去掉不想展示的子页面。同行爆款在「小说推文」下面。";
  bindModuleCards();
}

function bindModuleCards() {
  document.querySelectorAll(".module-card").forEach((card) => {
    const groupSwitch = card.querySelector(".group-switch");
    const children = Array.from(card.querySelectorAll(".child-switch"));
    const expand = card.querySelector(".module-expand");
    const panel = card.querySelector(".module-children");
    groupSwitch.addEventListener("change", () => {
      children.forEach((input) => { input.checked = groupSwitch.checked; });
      card.classList.toggle("is-on", groupSwitch.checked);
    });
    children.forEach((input) => {
      input.addEventListener("change", () => {
        const anyOn = children.some((item) => item.checked);
        groupSwitch.checked = anyOn;
        card.classList.toggle("is-on", anyOn);
      });
    });
    expand?.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      expand.classList.toggle("is-open", open);
      expand.textContent = open ? "收起" : "子功能";
    });
  });
}

function selectedSidebarModules() {
  return Array.from($("#userSidebarModules").querySelectorAll(".child-switch:checked")).map((input) => input.value);
}

function sidebarModuleSummary(selected, role) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  const labels = businessGroups(role)
    .filter((group) => group.items.some((item) => selectedSet.has(item.id)))
    .map((group) => group.label);
  if (!labels.length) return "未开模块";
  if (labels.length === businessGroups(role).length) return "全部模块";
  return labels.join(" · ");
}

function accountProjects() {
  const groups = Array.isArray(state.accountGroups.groups) ? state.accountGroups.groups : [];
  const projects = Array.isArray(state.accountGroups.projects) ? state.accountGroups.projects : [];
  return projects.map((project) => ({
    ...project,
    groups: groups.filter((group) => group.projectId === project.id)
  })).filter((project) => project.groups.length);
}

function renderAccountGroups(selected) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  const projects = accountProjects();
  const node = $("#userAccountGroups");
  if (!node) return;
  node.innerHTML = projects.length
    ? projects.map((project) => `
      <div class="module-card${project.groups.some((group) => selectedSet.has(group.id)) ? " is-on" : ""}" data-project-id="${esc(project.id)}">
        <div class="module-card-head">
          <label class="module-switch">
            <input class="group-switch" type="checkbox"${project.groups.some((group) => selectedSet.has(group.id)) ? " checked" : ""}>
            <span>
              <strong>${esc(project.name)}</strong>
              <small>${esc(project.groups.map((group) => group.name).join("、"))}</small>
            </span>
          </label>
        </div>
        <div class="module-children">
          ${project.groups.map((group) => `
            <label class="check-row">
              <input class="account-group-switch" type="checkbox" value="${esc(group.id)}"${selectedSet.has(group.id) ? " checked" : ""}>
              <span>${esc(group.name)}${group.accountCount ? ` · ${group.accountCount} 个账号` : ""}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `).join("")
    : '<p class="empty-state">还没有账号分组。先到官方通道的 TikTok 账号页建项目和分组。</p>';
  node.querySelectorAll(".module-card").forEach((card) => {
    const groupSwitch = card.querySelector(".group-switch");
    const children = Array.from(card.querySelectorAll(".account-group-switch"));
    groupSwitch?.addEventListener("change", () => {
      children.forEach((input) => { input.checked = groupSwitch.checked; });
      card.classList.toggle("is-on", groupSwitch.checked);
    });
    children.forEach((input) => {
      input.addEventListener("change", () => {
        const anyOn = children.some((item) => item.checked);
        if (groupSwitch) groupSwitch.checked = anyOn;
        card.classList.toggle("is-on", anyOn);
      });
    });
  });
}

function selectedAccountGroups() {
  return Array.from(document.querySelectorAll(".account-group-switch:checked")).map((input) => input.value);
}

function accountGroupSummary(selected) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  const count = selectedSet.size;
  if (!count) return "未分配分组";
  return `${count} 个分组`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}
