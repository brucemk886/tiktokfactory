const state = {
  projects: [],
  agents: [],
  runs: [],
  handoffs: [],
  settings: {},
  summary: {},
  selectedProjectId: localStorage.getItem("lf_project_hub_selected") || ""
};
const $ = (selector) => document.querySelector(selector);
let pollTimer = null;

$("#refreshHubBtn").addEventListener("click", loadHub);
$("#runAllBtn").addEventListener("click", runSelectedProjectAgents);
$("#toggleProjectFormBtn").addEventListener("click", () => toggleForm("#projectForm"));
$("#toggleAgentFormBtn").addEventListener("click", () => toggleForm("#agentForm"));
$("#projectForm").addEventListener("submit", createProject);
$("#agentForm").addEventListener("submit", createAgent);
$("#handoffForm").addEventListener("submit", createHandoff);

loadHub();

async function loadHub() {
  setButtonBusy($("#refreshHubBtn"), true, "刷新中");
  try {
    const data = await request("/api/project-hub");
    Object.assign(state, data);
    ensureSelectedProject();
    render();
    schedulePoll();
  } catch (error) {
    $("#queueMeta").textContent = error.message || "读取子项目 Agent 中台失败。";
  } finally {
    setButtonBusy($("#refreshHubBtn"), false, "刷新");
  }
}

function ensureSelectedProject() {
  const activeProjects = state.projects.filter((item) => item.active !== false);
  if (!activeProjects.some((item) => item.id === state.selectedProjectId)) {
    state.selectedProjectId = activeProjects.find((item) => item.kind === "local-subproject")?.id || activeProjects[0]?.id || "";
  }
  if (state.selectedProjectId) localStorage.setItem("lf_project_hub_selected", state.selectedProjectId);
}

function render() {
  renderSummary();
  renderProjects();
  renderProjectFocus();
  renderAgents();
  renderRuns();
  renderHandoffs();
  $("#safetyBadge").textContent = `只读安全模式 · 并行 ${state.settings.maxConcurrent || 3}`;
  $("#queueMeta").textContent = `运行 ${state.settings.running || 0} · 排队 ${state.settings.queued || 0} · ${state.settings.model || "Codex"}`;
}

function renderSummary() {
  const selectedAgents = agentsForSelectedProject();
  const selectedRuns = runsForSelectedProject();
  const items = [
    ["子项目", state.summary.projects || 0, "neutral"],
    ["当前项目 Agent", selectedAgents.filter((item) => item.active !== false).length, "cyan"],
    ["正在运行", selectedRuns.filter((item) => item.status === "running").length, "lime"],
    ["需要处理", selectedRuns.filter((item) => ["failed", "interrupted"].includes(item.status)).length, "red"]
  ];
  $("#summaryStrip").innerHTML = items.map(([label, value, tone]) => `
    <div class="summary-item" data-tone="${tone}"><span>${label}</span><strong>${value}</strong></div>
  `).join("");
}

function renderProjects() {
  $("#projectList").innerHTML = state.projects.length ? state.projects.map((project) => {
    const agents = state.agents.filter((item) => item.projectId === project.id && item.active !== false);
    const activeRuns = state.runs.filter((item) => item.projectId === project.id && ["queued", "running"].includes(item.status));
    const selected = project.id === state.selectedProjectId;
    return `
      <article class="project-row ${selected ? "is-selected" : ""} ${project.active === false ? "is-inactive" : ""}">
        <button class="project-select" type="button" data-select-project="${esc(project.id)}" aria-selected="${selected}">
          <span class="project-row-main"><strong>${esc(project.name)}</strong><small>${esc(kindLabel(project.kind))}</small></span>
          <span class="project-row-meta"><b>${agents.length}</b> Agent${activeRuns.length ? `<i>${activeRuns.length} 运行中</i>` : ""}</span>
        </button>
        <button class="project-more" type="button" data-toggle-project="${esc(project.id)}" title="${project.active === false ? "启用" : "停用"}" aria-label="${project.active === false ? "启用" : "停用"} ${esc(project.name)}">${project.active === false ? "启" : "停"}</button>
      </article>`;
  }).join("") : empty("还没有登记子项目。");

  document.querySelectorAll("[data-select-project]").forEach((button) => button.addEventListener("click", () => selectProject(button.dataset.selectProject)));
  document.querySelectorAll("[data-toggle-project]").forEach((button) => button.addEventListener("click", () => toggleProject(button.dataset.toggleProject)));
}

function renderProjectFocus() {
  const project = selectedProject();
  $("#agentProject").value = project?.id || "";
  $("#handoffProject").value = project?.id || "";
  $("#selectedProjectKind").textContent = kindLabel(project?.kind).toUpperCase();
  $("#selectedProjectName").textContent = project?.name || "选择一个子项目";
  $("#selectedProjectObjective").textContent = project?.objective || "左侧选择后，这里只展示该项目的专属 Agent。";
  $("#runAllBtn").disabled = !project || project.active === false;
  $("#toggleAgentFormBtn").disabled = !project || project.active === false;

  const link = $("#openProjectLink");
  if (project?.route) {
    link.hidden = false;
    link.href = project.route;
    link.target = /^https?:\/\//i.test(project.route) ? "_blank" : "";
    link.rel = link.target ? "noreferrer" : "";
  } else {
    link.hidden = true;
    link.removeAttribute("href");
  }

  $("#projectScope").innerHTML = project ? `
    <span>检查范围</span>
    ${(project.modules || []).map((module) => `<code>${esc(module)}</code>`).join("") || "<em>尚未登记关键模块</em>"}
  ` : "";
}

function renderAgents() {
  const agents = agentsForSelectedProject();
  $("#agentCount").textContent = `${agents.length} 个`;
  $("#agentList").innerHTML = agents.length ? agents.map((agent) => {
    const activeRun = state.runs.find((run) => run.agentId === agent.id && ["queued", "running"].includes(run.status));
    const latestRun = state.runs.find((run) => run.agentId === agent.id);
    return `
      <article class="agent-row ${agent.active === false ? "is-inactive" : ""}">
        <div class="agent-identity">
          <span class="agent-mark">${esc(agentInitial(agent.name))}</span>
          <div><h3>${esc(agent.name)}</h3><p><span class="role-chip">${esc(roleLabel(agent.role))}</span>${latestRun ? `最近：${statusLabel(latestRun.status)} · ${formatTime(latestRun.finishedAt || latestRun.createdAt)}` : "尚未运行"}</p></div>
        </div>
        <p class="agent-instructions">${esc(agent.instructions)}</p>
        <div class="card-actions">
          ${activeRun ? `<button data-cancel-run="${esc(activeRun.id)}">停止</button>` : `<button data-run-agent="${esc(agent.id)}" ${agent.active === false ? "disabled" : ""}>运行检查</button>`}
          <button data-toggle-agent="${esc(agent.id)}">${agent.active === false ? "启用" : "停用"}</button>
        </div>
      </article>`;
  }).join("") : empty("这个子项目还没有专属 Agent。", "新增专属 Agent 后，它只会读取当前子项目的检查范围。");

  document.querySelectorAll("[data-run-agent]").forEach((button) => button.addEventListener("click", () => runAgent(button.dataset.runAgent)));
  document.querySelectorAll("[data-cancel-run]").forEach((button) => button.addEventListener("click", () => cancelRun(button.dataset.cancelRun)));
  document.querySelectorAll("[data-toggle-agent]").forEach((button) => button.addEventListener("click", () => toggleAgent(button.dataset.toggleAgent)));
}

function renderRuns() {
  const runs = runsForSelectedProject();
  $("#runList").innerHTML = runs.length ? runs.map((run) => {
    const agent = state.agents.find((item) => item.id === run.agentId);
    const content = run.error || run.result || (run.status === "queued" ? "等待可用并行槽位。" : "Agent 正在检查当前子项目。 ");
    return `
      <article class="run-row">
        <div class="run-state"><span class="status-chip" data-status="${esc(run.status)}">${statusLabel(run.status)}</span><time>${formatTime(run.createdAt)}</time></div>
        <div class="run-body">
          <div class="run-title"><h3>${esc(agent?.name || run.agentId)}</h3><span>${formatDuration(run.durationMs)}</span></div>
          <div class="run-progress" aria-label="执行进度"><span style="width:${Math.max(0, Math.min(100, Number(run.progress) || 0))}%"></span></div>
          <details ${run.error ? "open" : ""}><summary>${run.error ? "查看错误" : "查看结论"}</summary><pre class="run-result ${run.error ? "run-error" : ""}">${esc(content)}</pre></details>
        </div>
        <div class="card-actions">${["queued", "running"].includes(run.status) ? `<button data-cancel-run="${esc(run.id)}">停止</button>` : ""}</div>
      </article>`;
  }).join("") : empty("当前项目还没有运行记录。", "运行一个 Agent 后，检查结论会保存在这里。 ");
  document.querySelectorAll("#runList [data-cancel-run]").forEach((button) => button.addEventListener("click", () => cancelRun(button.dataset.cancelRun)));
}

function renderHandoffs() {
  const handoffs = state.handoffs.filter((item) => item.projectId === state.selectedProjectId);
  $("#handoffList").innerHTML = handoffs.length ? handoffs.map((handoff) => `
    <article class="handoff-row"><div><strong>${esc(handoff.source)}</strong><time>${formatTime(handoff.createdAt)}</time></div><p>${esc(handoff.summary)}</p></article>
  `).join("") : empty("当前项目还没有交接记录。", "手动记录或 Agent 完成检查后会自动写入。 ");
}

function selectProject(projectId) {
  state.selectedProjectId = projectId;
  localStorage.setItem("lf_project_hub_selected", projectId);
  $("#agentForm").hidden = true;
  render();
}

async function createProject(event) {
  event.preventDefault();
  try {
    const data = await request("/api/project-hub/projects", {
      method: "POST",
      body: JSON.stringify({
        name: $("#projectName").value,
        path: $("#projectPath").value,
        route: $("#projectRoute").value,
        objective: $("#projectObjective").value,
        modules: $("#projectModules").value.split(/\r?\n/)
      })
    });
    state.selectedProjectId = data.project.id;
    $("#projectForm").reset();
    $("#projectForm").hidden = true;
    $("#projectFormStatus").textContent = "已保存。";
    await loadHub();
  } catch (error) {
    $("#projectFormStatus").textContent = error.message;
  }
}

async function createAgent(event) {
  event.preventDefault();
  try {
    await request("/api/project-hub/agents", {
      method: "POST",
      body: JSON.stringify({
        name: $("#agentName").value,
        projectId: state.selectedProjectId,
        role: $("#agentRole").value,
        instructions: $("#agentInstructions").value
      })
    });
    $("#agentForm").reset();
    $("#agentForm").hidden = true;
    $("#agentFormStatus").textContent = "Agent 已保存。";
    await loadHub();
  } catch (error) {
    $("#agentFormStatus").textContent = error.message;
  }
}

async function createHandoff(event) {
  event.preventDefault();
  const summary = $("#handoffSummary").value.trim();
  if (!summary || !state.selectedProjectId) return;
  try {
    await request("/api/project-hub/handoffs", {
      method: "POST",
      body: JSON.stringify({ projectId: state.selectedProjectId, source: "manual", summary })
    });
    $("#handoffSummary").value = "";
    $("#handoffStatus").textContent = "已写入";
    await loadHub();
  } catch (error) {
    $("#handoffStatus").textContent = error.message;
  }
}

async function runAgent(agentId) {
  await actionRequest("/api/project-hub/runs", { agentId });
}

async function runSelectedProjectAgents() {
  if (!state.selectedProjectId) return;
  setButtonBusy($("#runAllBtn"), true, "正在加入队列");
  try {
    await actionRequest("/api/project-hub/runs/batch", { projectId: state.selectedProjectId });
  } finally {
    setButtonBusy($("#runAllBtn"), false, "运行当前项目 Agent");
  }
}

async function cancelRun(runId) {
  await actionRequest(`/api/project-hub/runs/${encodeURIComponent(runId)}/cancel`, {});
}

async function toggleProject(id) {
  const project = projectById(id);
  await request(`/api/project-hub/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ active: project.active === false }) });
  await loadHub();
}

async function toggleAgent(id) {
  const agent = state.agents.find((item) => item.id === id);
  await request(`/api/project-hub/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ active: agent.active === false }) });
  await loadHub();
}

async function actionRequest(url, payload) {
  try {
    await request(url, { method: "POST", body: JSON.stringify(payload) });
    await loadHub();
  } catch (error) {
    $("#queueMeta").textContent = error.message;
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (state.runs.some((item) => ["queued", "running"].includes(item.status))) pollTimer = setTimeout(loadHub, 2500);
}

function selectedProject() { return projectById(state.selectedProjectId); }
function projectById(id) { return state.projects.find((item) => item.id === id); }
function agentsForSelectedProject() { return state.agents.filter((item) => item.projectId === state.selectedProjectId); }
function runsForSelectedProject() { return state.runs.filter((item) => item.projectId === state.selectedProjectId); }
function toggleForm(selector) { const element = $(selector); element.hidden = !element.hidden; }
function agentInitial(name) { return String(name || "A").trim().slice(0, 1).toUpperCase(); }
function kindLabel(kind) { return ({ "local-subproject": "Local Factory 子项目", "external-product": "独立产品", "custom-subproject": "自定义子项目" })[kind] || "子项目"; }
function roleLabel(role) { return ({ quality: "质量", operations: "运营", release: "发布", data: "数据", research: "研究" })[role] || role; }
function statusLabel(status) { return ({ queued: "排队", running: "执行中", completed: "完成", failed: "失败", cancelled: "已停止", interrupted: "服务重启中断" })[status] || status; }
function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }
function formatDuration(value) { const seconds = Math.round((Number(value) || 0) / 1000); return seconds ? `${seconds} 秒` : ""; }
function empty(title, detail = "") { return `<div class="empty-state"><strong>${esc(title)}</strong>${detail ? `<span>${esc(detail)}</span>` : ""}</div>`; }
function setButtonBusy(button, busy, label) { button.disabled = busy; button.textContent = label; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]); }
