import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProjectHubService } from "./project-hub.js";

test("seeds concrete Local Factory projects without subproject agents", (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-root-"));
  const workDir = path.join(root, "work");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = createProjectHubService({ root, workDir });
  const overview = service.getOverview();
  assert.equal(overview.projects.length, 5);
  assert.equal(overview.projects.filter((item) => item.kind === "local-subproject").length, 5);
  assert.equal(overview.projects.find((item) => item.id === "analytics-operations").name, "小说 AI 自运营");
  assert.equal("agents" in overview, false);
  assert.equal("runs" in overview, false);
  assert.equal(overview.settings.mode, "project-memory");
});

test("migrates legacy agent stores by preserving projects and handoffs only", (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-migrate-"));
  const workDir = path.join(root, "work");
  const hubDir = path.join(workDir, "project-hub");
  fs.mkdirSync(hubDir, { recursive: true });
  fs.writeFileSync(path.join(hubDir, "store.json"), JSON.stringify({
    version: 2,
    projects: [{ id: "local-factory", name: "Local Factory", path: root, active: true }],
    agents: [{ id: "factory-quality", projectId: "local-factory", active: true }],
    runs: [{ id: "run-1", projectId: "local-factory", status: "running" }],
    handoffs: [{ id: "handoff-old", projectId: "reddit-automation", summary: "保留的交接", createdAt: 1 }]
  }), "utf8");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = createProjectHubService({ root, workDir });
  const overview = service.getOverview();
  assert.equal(overview.projects.length, 5);
  assert.ok(!overview.projects.some((item) => item.id === "local-factory"));
  assert.equal(overview.handoffs[0].summary, "保留的交接");
  const persisted = JSON.parse(fs.readFileSync(path.join(hubDir, "store.json"), "utf8"));
  assert.equal(persisted.version, 3);
  assert.equal("agents" in persisted, false);
  assert.equal("runs" in persisted, false);
});

test("creates projects, updates state and writes shared handoffs", (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createProjectHubService({ root, workDir: path.join(root, "work"), now: () => Date.UTC(2026, 7, 5, 12) });

  const project = service.createProject({ name: "Novel Lab", path: root, objective: "验证小说音频" });
  assert.equal(project.active, true);
  assert.equal(service.updateProject(project.id, { active: false }).active, false);
  const handoff = service.addHandoff({ projectId: project.id, summary: "完成第一轮素材验证。", nextSteps: ["检查发布数据"] });
  assert.equal(handoff.projectId, project.id);
  assert.equal(service.getContext(project.id).recentHandoffs.length, 1);
  assert.ok(fs.readdirSync(path.join(root, "docs", "handoffs")).some((name) => name.endsWith(".md")));
});

test("rejects project directories outside the workspace", (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createProjectHubService({ root, workDir: path.join(root, "work") });
  assert.throws(() => service.createProject({ name: "Outside", path: path.dirname(root) }), (error) => error?.statusCode === 400);
});
