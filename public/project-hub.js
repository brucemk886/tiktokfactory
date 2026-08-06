const state = {
  projects: [],
  handoffs: [],
  selectedProjectId: ""
};

const elements = {
  summaryStrip: document.querySelector("#summaryStrip"),
  projectList: document.querySelector("#projectList"),
  projectForm: document.querySelector("#projectForm"),
  projectFormStatus: document.querySelector("#projectFormStatus"),
  selectedProjectKind: document.querySelector("#selectedProjectKind"),
  selectedProjectName: document.querySelector("#selectedProjectName"),
  selectedProjectObjective: document.querySelector("#selectedProjectObjective"),
  openProjectLink: document.querySelector("#openProjectLink"),
  toggleProjectStateBtn: document.querySelector("#toggleProjectStateBtn"),
  projectScope: document.querySelector("#projectScope"),
  handoffProject: document.querySelector("#handoffProject"),
  handoffForm: document.querySelector("#handoffForm"),
  handoffSummary: document.querySelector("#handoffSummary"),
  handoffStatus: document.querySelector("#handoffStatus"),
  handoffMeta: document.querySelector("#handoffMeta"),
  handoffList: document.querySelector("#handoffList")
};

document.querySelector("#refreshHubBtn")?.addEventListener("click", loadHub);
document.querySelector("#toggleProjectFormBtn")?.addEventListener("click", () => {
  elements.projectForm.hidden = !elements.projectForm.hidden;
});
elements.projectForm?.addEventListener("submit", createProject);
elements.handoffForm?.addEventListener("submit", createHandoff);
elements.toggleProjectStateBtn?.addEventListener("click", toggleProjectState);

loadHub();

async function loadHub() {
  try {
    const data = await request("/api/project-hub");
    state.projects = data.projects || [];
    state.handoffs = data.handoffs || [];
    if (!state.projects.some((item) => item.id === state.selectedProjectId)) {
      state.selectedProjectId = state.projects[0]?.id || "";
    }
    render(data.summary || {});
  } catch (error) {
    elements.projectList.innerHTML = emptyState("项目中台读取失败", error.message);
  }
}

function render(summary) {
  renderSummary(summary);
  renderProjects();
  renderSelectedProject();
  renderHandoffs();
}

function renderSummary(summary) {
  const items = [
    ["子项目", summary.projects || 0, "已登记的项目边界"],
    ["运行中", summary.activeProjects || 0, "当前启用的项目"],
    ["交接记录", summary.handoffs || 0, "可跨任务读取的记忆"],
    ["已暂停", summary.attention || 0, "暂不参与当前工作"]
  ];
  elements.summaryStrip.innerHTML = items.map(([label, value, note]) => `
    <article><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>
  `).join("");
}

function renderProjects() {
  elements.projectList.innerHTML = state.projects.length
    ? state.projects.map((project) => `
      <button class="project-row ${project.id === state.selectedProjectId ? "is-selected" : ""}" type="button" data-project-id="${escapeHtml(project.id)}">
        <span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.objective || "尚未填写目标")}</small></span>
        <em class="project-state ${project.active === false ? "is-paused" : ""}">${project.active === false ? "暂停" : "启用"}</em>
      </button>
    `).join("")
    : emptyState("还没有子项目", "新增后会在这里形成独立项目记忆。");
  elements.projectList.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProjectId = button.dataset.projectId;
      renderProjects();
      renderSelectedProject();
      renderHandoffs();
    });
  });
}

function renderSelectedProject() {
  const project = selectedProject();
  elements.handoffProject.value = project?.id || "";
  elements.selectedProjectKind.textContent = project?.kind === "custom-subproject" ? "CUSTOM PROJECT" : "LOCAL SUBPROJECT";
  elements.selectedProjectName.textContent = project?.name || "选择一个子项目";
  elements.selectedProjectObjective.textContent = project?.objective || "这里展示项目目标、入口和关键模块。";
  elements.openProjectLink.hidden = !project?.route;
  if (project?.route) elements.openProjectLink.href = project.route;
  elements.toggleProjectStateBtn.hidden = !project;
  if (project) elements.toggleProjectStateBtn.textContent = project.active === false ? "启用项目" : "暂停项目";
  elements.projectScope.innerHTML = project ? `
    <div class="scope-meta">
      <span><small>项目目录</small><strong>${escapeHtml(project.path || "当前工作区")}</strong></span>
      <span><small>页面入口</small><strong>${escapeHtml(project.route || "未配置")}</strong></span>
    </div>
    <div class="module-list">
      ${(project.modules || []).map((item) => `<code>${escapeHtml(item)}</code>`).join("") || "<span>尚未登记关键模块。</span>"}
    </div>
  ` : emptyState("选择左侧项目", "项目详情会展示在这里。");
}

function renderHandoffs() {
  const project = selectedProject();
  const handoffs = state.handoffs.filter((item) => item.projectId === project?.id);
  elements.handoffMeta.textContent = project ? `${project.name} · ${handoffs.length} 条` : "未选择项目";
  elements.handoffList.innerHTML = handoffs.length
    ? handoffs.map((item) => `
      <article class="handoff-row">
        <div><strong>${escapeHtml(item.source || "manual")}</strong><time>${formatTime(item.createdAt)}</time></div>
        <p>${escapeHtml(item.summary)}</p>
      </article>
    `).join("")
    : emptyState("暂无交接记录", "关键决定写入后，后续任务可以继续读取。");
}

async function createProject(event) {
  event.preventDefault();
  elements.projectFormStatus.textContent = "正在保存...";
  try {
    const payload = {
      name: document.querySelector("#projectName").value,
      path: document.querySelector("#projectPath").value,
      route: document.querySelector("#projectRoute").value,
      objective: document.querySelector("#projectObjective").value,
      modules: document.querySelector("#projectModules").value
    };
    const data = await request("/api/project-hub/projects", { method: "POST", body: JSON.stringify(payload) });
    state.selectedProjectId = data.project.id;
    elements.projectForm.reset();
    elements.projectForm.hidden = true;
    await loadHub();
  } catch (error) {
    elements.projectFormStatus.textContent = error.message;
  }
}

async function createHandoff(event) {
  event.preventDefault();
  const summary = elements.handoffSummary.value.trim();
  if (!state.selectedProjectId || !summary) return;
  elements.handoffStatus.textContent = "正在写入...";
  try {
    await request("/api/project-hub/handoffs", {
      method: "POST",
      body: JSON.stringify({ projectId: state.selectedProjectId, summary })
    });
    elements.handoffSummary.value = "";
    elements.handoffStatus.textContent = "已写入共享记忆";
    await loadHub();
  } catch (error) {
    elements.handoffStatus.textContent = error.message;
  }
}

async function toggleProjectState() {
  const project = selectedProject();
  if (!project) return;
  await request(`/api/project-hub/projects/${encodeURIComponent(project.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ active: project.active === false })
  });
  await loadHub();
}

function selectedProject() {
  return state.projects.find((item) => item.id === state.selectedProjectId) || null;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function emptyState(title, detail) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
