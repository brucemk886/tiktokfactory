import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 3;

const LOCAL_SUBPROJECTS = [
  {
    id: "reddit-automation",
    name: "Reddit 自动发布",
    route: "/tasks",
    objective: "批量混剪小说内容，安全排期并通过 GeeLark 发布。",
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
    name: "小说 AI 自运营",
    route: "/operator",
    objective: "汇总小说矩阵发布数据，由 DeepSeek 归纳全量证据、SOL 决策下一轮 Reddit 混剪实验。",
    modules: ["scripts/tiktok-analytics.js", "scripts/operation-brain.js", "public/operator.js"],
    kind: "local-subproject"
  }
];

export function createProjectHubService({ root, workDir, now = () => Date.now() }) {
  const hubDir = path.join(workDir, "project-hub");
  const storePath = path.join(hubDir, "store.json");
  const handoffDir = path.join(root, "docs", "handoffs");

  fs.mkdirSync(hubDir, { recursive: true });
  fs.mkdirSync(handoffDir, { recursive: true });
  initializeStore();

  function getOverview() {
    const store = readStore();
    const projects = visibleProjects(store.projects);
    const projectIds = new Set(projects.map((item) => item.id));
    const handoffs = store.handoffs
      .filter((item) => projectIds.has(item.projectId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      settings: {
        mode: "project-memory",
        safetyMode: "read-only-context"
      },
      projects,
      handoffs: handoffs.slice(0, 80),
      summary: {
        projects: projects.length,
        activeProjects: projects.filter((item) => item.active !== false).length,
        handoffs: handoffs.length,
        attention: projects.filter((item) => item.active === false).length
      }
    };
  }

  function getContext(projectId = "") {
    const store = readStore();
    const projects = projectId
      ? visibleProjects(store.projects).filter((item) => item.id === projectId)
      : visibleProjects(store.projects).filter((item) => item.active !== false);
    if (projectId && !projects.length) throw notFound("子项目不存在。");
    const projectIds = new Set(projects.map((item) => item.id));
    return {
      generatedAt: new Date(now()).toISOString(),
      projects,
      recentHandoffs: store.handoffs
        .filter((item) => projectIds.has(item.projectId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 24)
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
    const project = visibleProjects(store.projects).find((item) => item.id === String(id));
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

  function initializeStore() {
    const raw = readRawStore();
    const store = normalizeStore(raw);
    const changed = migrateStore(store, root, now())
      || raw.version !== STORE_VERSION
      || Object.hasOwn(raw, "agents")
      || Object.hasOwn(raw, "runs");
    if (changed || !fs.existsSync(storePath)) writeStore(store);
  }

  function readRawStore() {
    try {
      return JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch {
      return {};
    }
  }

  function readStore() {
    return normalizeStore(readRawStore());
  }

  function writeStore(store) {
    const persisted = {
      version: STORE_VERSION,
      projects: Array.isArray(store.projects) ? store.projects : [],
      handoffs: Array.isArray(store.handoffs) ? store.handoffs : []
    };
    const tempPath = `${storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(persisted, null, 2), "utf8");
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

  return { getOverview, getContext, createProject, updateProject, addHandoff };
}

function normalizeStore(raw = {}) {
  return {
    version: STORE_VERSION,
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    handoffs: Array.isArray(raw.handoffs) ? raw.handoffs : []
  };
}

function migrateStore(store, root, timestamp) {
  const before = JSON.stringify(store);
  store.version = STORE_VERSION;
  store.projects = store.projects.filter((item) => item?.id !== "local-factory" && item?.hidden !== true);
  for (const definition of LOCAL_SUBPROJECTS) {
    const existing = store.projects.find((item) => item.id === definition.id);
    if (existing) {
      Object.assign(existing, definition, {
        path: root,
        active: existing.active !== false,
        updatedAt: timestamp
      });
    } else {
      store.projects.push({
        ...definition,
        path: root,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }
  return before !== JSON.stringify(store);
}

function visibleProjects(projects) {
  return projects.filter((item) => item.hidden !== true);
}

function requireProject(store, id) {
  const project = visibleProjects(store.projects).find((item) => item.id === String(id || ""));
  if (!project) throw notFound("子项目不存在。");
  return project;
}

function writeHandoffMarkdown(directory, project, handoff) {
  const date = new Date(handoff.createdAt).toISOString().slice(0, 10);
  const fileName = `${date}-${slugify(project.name) || project.id}-${handoff.id.slice(-6)}.md`;
  const sections = [
    `# ${project.name} 交接记录`,
    "",
    `- 时间：${new Date(handoff.createdAt).toISOString()}`,
    `- 来源：${handoff.source}`,
    "",
    "## Goal",
    project.objective || "未填写",
    "",
    "## Summary",
    handoff.summary,
    ...markdownList("Decisions", handoff.decisions),
    ...markdownList("Files changed", handoff.filesChanged),
    ...markdownList("Tests performed", handoff.tests),
    ...markdownList("Recommended next step", handoff.nextSteps),
    ""
  ];
  fs.writeFileSync(path.join(directory, fileName), sections.join("\n"), "utf8");
}

function markdownList(title, values) {
  if (!values?.length) return [];
  return ["", `## ${title}`, ...values.map((item) => `- ${item}`)];
}

function uniqueId(items, preferred) {
  const base = slugify(preferred) || "item";
  let candidate = base;
  let index = 2;
  while (items.some((item) => item.id === candidate)) candidate = `${base}-${index++}`;
  return candidate;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeList(value, maxItems, maxLength) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return source.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function cleanRoute(value) {
  const route = cleanText(value, 300);
  if (!route) return "";
  if (/^https?:\/\//i.test(route)) return route;
  return route.startsWith("/") ? route : `/${route}`;
}

function timestampId(value) {
  return new Date(value).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function badRequest(message) {
  return statusError(400, message);
}

function notFound(message) {
  return statusError(404, message);
}
