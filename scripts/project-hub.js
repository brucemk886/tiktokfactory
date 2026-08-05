import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";

const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 3;
const STORE_VERSION = 2;
const ACTIVE_RUN_STATES = new Set(["queued", "running"]);
const AGENT_ROLES = new Set(["quality", "operations", "release", "data", "research"]);

const LOCAL_SUBPROJECTS = [
  {
    id: "reddit-automation",
    name: "Reddit 自动发布",
    route: "/tasks",
    objective: "批量混剪 Reddit 内容，安全排期并通过 GeeLark 发布。",
    modules: ["scripts/auto-task-manager.js", "scripts/publish-service.js", "public/tasks.js"],
    kind: "local-subproject"
  },
  {
    id: "psychology-automation",
    name: "心理学视频自动化",
    route: "/psychology",
    objective: "从心理学题库生成图片、配音、视频并完成矩阵发布。",
    modules: ["scripts/psychology-topics.js", "scripts/kie-ai.js", "public/psychology.js"],
    kind: "local-subproject"
  },
  {
    id: "schulte-training",
    name: "舒尔特训练",
    route: "/schulte",
    objective: "批量生成多模板专注力训练视频，并持续验证播放表现。",
    modules: ["schulte-grid-generator", "public/schulte.js", "scripts/server.js"],
    kind: "local-subproject"
  },
  {
    id: "ai-creation",
    name: "AI 创作",
    route: "/ai",
    objective: "统一管理 Kie.ai 生图、生视频和 AI 对话能力。",
    modules: ["scripts/kie-ai.js", "public/ai.js"],
    kind: "local-subproject"
  },
  {
    id: "analytics-operations",
    name: "数据分析与运营大脑",
    route: "/operator",
    objective: "汇总发布数据，生成运营策略，并驱动下一轮内容实验。",
    modules: ["scripts/tiktok-analytics.js", "scripts/operation-brain.js", "public/operator.js"],
    kind: "local-subproject"
  }
];

const LOCAL_AGENTS = [
  ["reddit-release", "reddit-automation", "Reddit 发布安全 Agent", "release"],
  ["psychology-quality", "psychology-automation", "心理学视频质量 Agent", "quality"],
  ["schulte-quality", "schulte-training", "舒尔特训练质量 Agent", "quality"],
  ["ai-cost-quality", "ai-creation", "AI 成本与质量 Agent", "operations"],
  ["analytics-data", "analytics-operations", "数据与策略 Agent", "data"]
];

export function createProjectHubService({
  root,
  workDir,
  CodexClass = Codex,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  now = () => Date.now()
}) {
  const hubDir = path.join(workDir, "project-hub");
  const storePath = path.join(hubDir, "store.json");
  const runOutputDir = path.join(hubDir, "runs");
  const handoffDir = path.join(root, "docs", "handoffs");
  const controllers = new Map();
  const pending = [];
  const running = new Set();

  fs.mkdirSync(runOutputDir, { recursive: true });
  fs.mkdirSync(handoffDir, { recursive: true });
  initializeStore();

  function getOverview() {
    const store = readStore();
    const projects = store.projects.filter((item) => item.hidden !== true);
    const projectIds = new Set(projects.map((item) => item.id));
    const agents = store.agents.filter((item) => projectIds.has(item.projectId));
    const runs = store.runs
      .filter((item) => projectIds.has(item.projectId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      settings: {
        model,
        maxConcurrent,
        running: running.size,
        queued: runs.filter((item) => item.status === "queued").length,
        safetyMode: "read-only"
      },
      projects,
      agents,
      runs: runs.slice(0, 80),
      handoffs: store.handoffs
        .filter((item) => projectIds.has(item.projectId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 40),
      summary: {
        projects: projects.filter((item) => item.active !== false).length,
        agents: agents.filter((item) => item.active !== false).length,
        running: runs.filter((item) => item.status === "running").length,
        queued: runs.filter((item) => item.status === "queued").length,
        attention: runs.filter((item) => item.status === "failed").length
      }
    };
  }

  function getContext(projectId = "") {
    const store = readStore();
    const projects = projectId
      ? store.projects.filter((item) => item.id === projectId && item.hidden !== true)
      : store.projects.filter((item) => item.active !== false && item.hidden !== true);
    if (projectId && !projects.length) throw notFound("子项目不存在。");
    const projectIds = new Set(projects.map((item) => item.id));
    return {
      generatedAt: new Date(now()).toISOString(),
      projects,
      agents: store.agents.filter((item) => projectIds.has(item.projectId)),
      recentRuns: store.runs.filter((item) => projectIds.has(item.projectId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
      recentHandoffs: store.handoffs.filter((item) => projectIds.has(item.projectId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
    };
  }

  function createProject(payload = {}) {
    const store = readStore();
    const name = cleanText(payload.name, 80);
    if (!name) throw badRequest("请输入子项目名称。");
    const project = {
      id: uniqueId(store.projects, payload.id || slugify(name) || "subproject"),
      name,
      path: normalizeProjectPath(payload.path || root),
      objective: cleanText(payload.objective, 600),
      modules: normalizeList(payload.modules, 20, 120),
      route: cleanRoute(payload.route),
      kind: "custom-subproject",
      active: payload.active !== false,
      createdAt: now(),
      updatedAt: now()
    };
    store.projects.push(project);
    writeStore(store);
    return project;
  }

  function updateProject(id, payload = {}) {
    const store = readStore();
    const project = store.projects.find((item) => item.id === String(id) && item.hidden !== true);
    if (!project) throw notFound("子项目不存在。");
    if (payload.name !== undefined) project.name = cleanText(payload.name, 80) || project.name;
    if (payload.path !== undefined) project.path = normalizeProjectPath(payload.path);
    if (payload.objective !== undefined) project.objective = cleanText(payload.objective, 600);
    if (payload.modules !== undefined) project.modules = normalizeList(payload.modules, 20, 120);
    if (payload.route !== undefined) project.route = cleanRoute(payload.route);
    if (payload.active !== undefined) project.active = payload.active !== false;
    project.updatedAt = now();
    writeStore(store);
    return project;
  }

  function createAgent(payload = {}) {
    const store = readStore();
    const project = requireProject(store, payload.projectId);
    const name = cleanText(payload.name, 80);
    if (!name) throw badRequest("请输入 Agent 名称。");
    const role = AGENT_ROLES.has(payload.role) ? payload.role : "quality";
    const agent = {
      id: uniqueId(store.agents, payload.id || slugify(name) || "agent"),
      projectId: project.id,
      name,
      role,
      instructions: cleanText(payload.instructions, 2000) || defaultInstructions(role),
      active: payload.active !== false,
      createdAt: now(),
      updatedAt: now()
    };
    store.agents.push(agent);
    writeStore(store);
    return agent;
  }

  function updateAgent(id, payload = {}) {
    const store = readStore();
    const agent = store.agents.find((item) => item.id === String(id));
    if (!agent) throw notFound("Agent 不存在。");
    if (payload.projectId !== undefined) agent.projectId = requireProject(store, payload.projectId).id;
    if (payload.name !== undefined) agent.name = cleanText(payload.name, 80) || agent.name;
    if (payload.role !== undefined && AGENT_ROLES.has(payload.role)) agent.role = payload.role;
    if (payload.instructions !== undefined) agent.instructions = cleanText(payload.instructions, 2000) || defaultInstructions(agent.role);
    if (payload.active !== undefined) agent.active = payload.active !== false;
    agent.updatedAt = now();
    writeStore(store);
    return agent;
  }

  function startRun(payload = {}) {
    const store = readStore();
    const agent = store.agents.find((item) => item.id === String(payload.agentId));
    if (!agent || agent.active === false) throw badRequest("请选择已启用的 Agent。");
    const project = requireProject(store, agent.projectId);
    if (store.runs.some((item) => item.agentId === agent.id && ACTIVE_RUN_STATES.has(item.status))) {
      throw conflict(`${agent.name} 已有任务在执行队列中。`);
    }
    const run = {
      id: `run-${timestampId(now())}-${crypto.randomBytes(3).toString("hex")}`,
      projectId: project.id,
      agentId: agent.id,
      objective: cleanText(payload.objective, 2000) || agent.instructions,
      status: "queued",
      progress: 0,
      createdAt: now(),
      startedAt: 0,
      finishedAt: 0,
      durationMs: 0,
      model,
      result: "",
      error: ""
    };
    store.runs.push(run);
    writeStore(store);
    pending.push(run.id);
    queueMicrotask(drainQueue);
    return run;
  }

  function startAll(payload = {}) {
    const store = readStore();
    const projectId = String(payload.projectId || "");
    if (!projectId) throw badRequest("请先选择一个具体子项目。");
    requireProject(store, projectId);
    const agents = store.agents.filter((agent) => (
      agent.active !== false
      && agent.projectId === projectId
      && !store.runs.some((run) => run.agentId === agent.id && ACTIVE_RUN_STATES.has(run.status))
    ));
    if (!agents.length) throw badRequest("这个子项目没有可启动的 Agent，或 Agent 已在运行。");
    return agents.map((agent) => startRun({ agentId: agent.id, objective: payload.objective }));
  }

  function cancelRun(id) {
    const store = readStore();
    const run = store.runs.find((item) => item.id === String(id));
    if (!run) throw notFound("运行记录不存在。");
    if (!ACTIVE_RUN_STATES.has(run.status)) return run;
    controllers.get(run.id)?.abort();
    const queueIndex = pending.indexOf(run.id);
    if (queueIndex >= 0) pending.splice(queueIndex, 1);
    run.status = "cancelled";
    run.finishedAt = now();
    run.durationMs = run.startedAt ? run.finishedAt - run.startedAt : 0;
    run.progress = 100;
    writeStore(store);
    return run;
  }

  function addHandoff(payload = {}) {
    const store = readStore();
    const project = requireProject(store, payload.projectId);
    const summary = cleanText(payload.summary, 6000);
    if (!summary) throw badRequest("交接摘要不能为空。");
    const handoff = {
      id: `handoff-${timestampId(now())}-${crypto.randomBytes(3).toString("hex")}`,
      projectId: project.id,
      source: cleanText(payload.source, 80) || "manual",
      summary,
      decisions: normalizeList(payload.decisions, 20, 500),
      filesChanged: normalizeList(payload.filesChanged, 100, 300),
      tests: normalizeList(payload.tests, 30, 500),
      nextSteps: normalizeList(payload.nextSteps, 30, 500),
      createdAt: now()
    };
    store.handoffs.push(handoff);
    writeStore(store);
    writeHandoffMarkdown(handoffDir, project, handoff);
    return handoff;
  }

  async function drainQueue() {
    while (running.size < maxConcurrent && pending.length) {
      const runId = pending.shift();
      if (!runId || running.has(runId)) continue;
      running.add(runId);
      executeRun(runId).finally(() => {
        running.delete(runId);
        queueMicrotask(drainQueue);
      });
    }
  }

  async function executeRun(runId) {
    const store = readStore();
    const run = store.runs.find((item) => item.id === runId);
    if (!run || run.status !== "queued") return;
    const agent = store.agents.find((item) => item.id === run.agentId);
    const project = store.projects.find((item) => item.id === run.projectId);
    if (!agent || !project) return finishRun(runId, "failed", "子项目或 Agent 已不存在。");

    run.status = "running";
    run.progress = 10;
    run.startedAt = now();
    writeStore(store);

    const controller = new AbortController();
    controllers.set(runId, controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const codexPath = resolveCodexExecutable();
      const codex = new CodexClass(codexPath ? { codexPathOverride: codexPath } : undefined);
      const thread = codex.startThread({
        model,
        modelReasoningEffort: "medium",
        workingDirectory: project.path,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled"
      });
      const result = await thread.run(buildAgentPrompt({ project, agent, run }), { signal: controller.signal });
      const output = String(result.finalResponse || "").trim();
      if (!output) throw new Error("Agent 没有返回检查结论。");
      fs.writeFileSync(path.join(runOutputDir, `${runId}.md`), output, "utf8");
      finishRun(runId, "completed", "", output, result.usage || null);
      addHandoff({
        projectId: project.id,
        source: `agent:${agent.id}`,
        summary: output,
        nextSteps: ["根据 Agent 结论决定是否进入人工修复或下一轮测试。"]
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      finishRun(runId, cancelled ? "cancelled" : "failed", cancelled ? "Agent 已停止或执行超时。" : String(error?.message || error));
    } finally {
      clearTimeout(timer);
      controllers.delete(runId);
    }
  }

  function finishRun(id, status, error = "", result = "", usage = null) {
    const store = readStore();
    const run = store.runs.find((item) => item.id === id);
    if (!run || (run.status === "cancelled" && status !== "cancelled")) return;
    run.status = status;
    run.progress = 100;
    run.finishedAt = now();
    run.durationMs = run.startedAt ? run.finishedAt - run.startedAt : 0;
    run.error = cleanText(error, 2000);
    run.result = String(result || "").slice(0, 30_000);
    run.usage = usage;
    writeStore(store);
  }

  function initializeStore() {
    if (fs.existsSync(storePath)) {
      const store = readStore();
      let changed = migrateStore(store, root, now());
      for (const run of store.runs) {
        if (!ACTIVE_RUN_STATES.has(run.status)) continue;
        run.status = "interrupted";
        run.error = "本地服务重启，原 Agent 运行已中断，请重新执行。";
        run.finishedAt = now();
        run.progress = 100;
        changed = true;
      }
      if (changed) writeStore(store);
      return;
    }

    const projects = LOCAL_SUBPROJECTS.map((project) => ({
      ...project,
      path: root,
      active: true,
      createdAt: now(),
      updatedAt: now()
    }));
    const agents = LOCAL_AGENTS.map(([id, projectId, name, role]) => seedAgent(id, projectId, name, role, now()));
    writeStore({ version: STORE_VERSION, projects, agents, runs: [], handoffs: [] });
  }

  function readStore() {
    const fallback = { version: STORE_VERSION, projects: [], agents: [], runs: [], handoffs: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
      return {
        ...fallback,
        ...parsed,
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        agents: Array.isArray(parsed.agents) ? parsed.agents : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        handoffs: Array.isArray(parsed.handoffs) ? parsed.handoffs : []
      };
    } catch {
      return structuredClone(fallback);
    }
  }

  function writeStore(store) {
    fs.mkdirSync(hubDir, { recursive: true });
    const tempPath = `${storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tempPath, storePath);
  }

  function normalizeProjectPath(value) {
    const candidate = path.resolve(String(value || root).trim() || root);
    const rootPath = path.resolve(root);
    if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${path.sep}`)) {
      throw badRequest("只允许登记当前工作区内的子项目目录。");
    }
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) throw badRequest("子项目目录不存在。");
    return candidate;
  }

  return { getOverview, getContext, createProject, updateProject, createAgent, updateAgent, startRun, startAll, cancelRun, addHandoff };
}

function migrateStore(store, root, timestamp) {
  const before = JSON.stringify(store);
  store.version = STORE_VERSION;
  store.projects = Array.isArray(store.projects) ? store.projects : [];
  store.agents = Array.isArray(store.agents) ? store.agents : [];
  store.runs = Array.isArray(store.runs) ? store.runs : [];
  store.handoffs = Array.isArray(store.handoffs) ? store.handoffs : [];

  const legacyFactory = store.projects.find((item) => item.id === "local-factory");
  if (legacyFactory) {
    legacyFactory.active = false;
    legacyFactory.hidden = true;
    legacyFactory.kind = "legacy-container";
    legacyFactory.name = "Local Factory（旧总项目）";
  }

  for (const definition of LOCAL_SUBPROJECTS) {
    const existing = store.projects.find((item) => item.id === definition.id);
    if (existing) Object.assign(existing, definition, { path: root, active: existing.active !== false });
    else store.projects.push({ ...definition, path: root, active: true, createdAt: timestamp, updatedAt: timestamp });
  }

  const oldQuality = store.agents.find((item) => item.id === "factory-quality");
  if (oldQuality) Object.assign(oldQuality, { projectId: "reddit-automation", name: "Reddit 发布安全 Agent", role: "release", instructions: defaultInstructions("release") });
  const oldOperations = store.agents.find((item) => item.id === "factory-operations");
  if (oldOperations) Object.assign(oldOperations, { projectId: "analytics-operations", name: "数据与策略 Agent", role: "data", instructions: defaultInstructions("data") });

  for (const [id, projectId, name, role] of LOCAL_AGENTS) {
    const sameProjectAgent = store.agents.find((item) => item.projectId === projectId && item.active !== false);
    if (!sameProjectAgent) store.agents.push(seedAgent(id, projectId, name, role, timestamp));
  }

  const site = store.projects.find((item) => item.id === "tiktok-ai-tool");
  if (site) {
    site.active = false;
    site.hidden = true;
    site.kind = "external-product";
    site.route = site.route || "https://tiktokaitool.com/";
  }
  return before !== JSON.stringify(store);
}

function seedAgent(id, projectId, name, role, createdAt) {
  return { id, projectId, name, role, instructions: defaultInstructions(role), active: true, createdAt, updatedAt: createdAt };
}

function defaultInstructions(role) {
  const roles = {
    quality: "检查当前子项目的核心流程、错误处理、边界条件和测试缺口，优先报告会导致任务中断、重复发布或数据错误的问题。",
    operations: "检查当前子项目的自动化闭环、任务队列、成本和运行安全，指出阻塞规模化测试的问题。",
    release: "检查当前子项目的发布前风险、配置完整性、幂等保护、重试与部署验证项。",
    data: "检查当前子项目的数据来源、缓存新鲜度、关联准确性和指标口径。",
    research: "整理当前子项目内已有资料，给出可验证的下一步研究问题，不访问外部网络。"
  };
  return roles[role] || roles.quality;
}

function buildAgentPrompt({ project, agent, run }) {
  return `You are ${agent.name}, a read-only agent assigned to one Local Factory subproject.

Subproject: ${project.name}
Subproject objective: ${project.objective || "Not specified"}
Subproject route: ${project.route || "Not specified"}
In-scope modules: ${(project.modules || []).join(", ") || "Not specified"}
Agent role: ${agent.role}
Standing instructions: ${agent.instructions}
Current assignment: ${run.objective}

Rules:
1. Read AGENTS.md and docs/CURRENT_STATE.md first when present.
2. Stay inside the named subproject and its in-scope modules. Read shared dependencies only when evidence requires it.
3. Inspect the repository and run only read-only checks. Do not edit, create, delete, move, publish, deploy, install, or call external services.
4. Do not expose API keys, passwords, tokens, cookies, or personal data.
5. Clearly separate confirmed facts from inferences.
6. Return concise Markdown with exactly these sections:
   ## Status
   ## Findings
   ## Checks Performed
   ## Blockers
   ## Recommended Next Steps
   ## Handoff
7. Findings must be ordered by severity and include file references when applicable.`;
}

function writeHandoffMarkdown(handoffDir, project, handoff) {
  const date = new Date(handoff.createdAt).toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(handoffDir, `${date}-${slugify(project.id)}-${slugify(handoff.id)}.md`);
  const list = (items) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
  const content = `# ${project.name} Handoff\n\n- Created: ${new Date(handoff.createdAt).toISOString()}\n- Source: ${handoff.source}\n- Subproject: ${project.id}\n\n## Summary\n\n${handoff.summary}\n\n## Decisions\n\n${list(handoff.decisions)}\n\n## Files Changed\n\n${list(handoff.filesChanged)}\n\n## Tests\n\n${list(handoff.tests)}\n\n## Next Steps\n\n${list(handoff.nextSteps)}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function requireProject(store, id) {
  const project = store.projects.find((item) => item.id === String(id));
  if (!project || project.active === false || project.hidden === true) throw badRequest("请选择已启用的具体子项目。");
  return project;
}

function uniqueId(items, preferred) {
  const base = slugify(preferred) || "item";
  let id = base;
  let index = 2;
  const used = new Set(items.map((item) => item.id));
  while (used.has(id)) id = `${base}-${index++}`;
  return id;
}

function normalizeList(value, maxItems, maxLength) {
  const values = Array.isArray(value) ? value : String(value || "").split(/\r?\n|,/);
  return values.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanRoute(value) {
  const route = String(value || "").trim().slice(0, 300);
  if (!route) return "";
  if (route.startsWith("/") || /^https?:\/\//i.test(route)) return route;
  throw badRequest("入口地址必须是站内路径或 HTTP(S) 地址。");
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function timestampId(value) {
  return new Date(value).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function resolveCodexExecutable() {
  const explicitPath = String(process.env.CODEX_PATH || "").trim();
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) return "";
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  if (!fs.existsSync(binRoot)) return "";
  try {
    return fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || "";
  } catch {
    return "";
  }
}
