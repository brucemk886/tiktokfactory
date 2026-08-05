import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProjectHubService } from "./project-hub.js";

class FakeCodex {
  startThread(options) {
    assert.equal(options.sandboxMode, "read-only");
    return {
      run: async () => ({
        finalResponse: "## Status\nHealthy\n## Findings\nNone\n## Checks Performed\nStatic review\n## Blockers\nNone\n## Recommended Next Steps\nContinue\n## Handoff\nDone",
        usage: { inputTokens: 10, outputTokens: 20 }
      })
    };
  }
}

test("seeds concrete Local Factory subprojects and runs only the selected project's agents", async (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-root-"));
  const workDir = path.join(root, "work");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = createProjectHubService({ root, workDir, CodexClass: FakeCodex, maxConcurrent: 2 });
  const initial = service.getOverview();
  assert.equal(initial.projects.length, 5);
  assert.equal(initial.projects.filter((item) => item.kind === "local-subproject").length, 5);
  assert.equal(initial.agents.length, 5);
  assert.ok(initial.agents.every((agent) => initial.projects.some((project) => project.id === agent.projectId)));

  assert.throws(() => service.startAll({ objective: "Audit queue safety" }), (error) => error?.statusCode === 400);
  const runs = service.startAll({ projectId: "reddit-automation", objective: "Audit queue safety" });
  assert.equal(runs.length, 1);
  await waitFor(
    () => service.getOverview().runs.filter((item) => runs.some((run) => run.id === item.id)).every((item) => item.status === "completed"),
    3000,
    () => JSON.stringify(service.getOverview().runs.filter((item) => runs.some((run) => run.id === item.id)))
  );

  const result = service.getOverview();
  assert.equal(result.handoffs.length, 1);
  assert.ok(fs.readdirSync(path.join(root, "docs", "handoffs")).some((name) => name.endsWith(".md")));
});

test("migrates the legacy whole-factory project into concrete subprojects", (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-migrate-"));
  const workDir = path.join(root, "work");
  const hubDir = path.join(workDir, "project-hub");
  fs.mkdirSync(hubDir, { recursive: true });
  fs.writeFileSync(path.join(hubDir, "store.json"), JSON.stringify({
    version: 1,
    projects: [{ id: "local-factory", name: "Local Factory", path: root, active: true }],
    agents: [
      { id: "factory-quality", projectId: "local-factory", name: "Factory quality", role: "quality", active: true },
      { id: "factory-operations", projectId: "local-factory", name: "Factory operations", role: "operations", active: true }
    ],
    runs: [],
    handoffs: []
  }), "utf8");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = createProjectHubService({ root, workDir, CodexClass: FakeCodex });
  const overview = service.getOverview();
  assert.equal(overview.projects.length, 5);
  assert.ok(!overview.projects.some((item) => item.id === "local-factory"));
  assert.equal(overview.agents.find((item) => item.id === "factory-quality").projectId, "reddit-automation");
  assert.equal(overview.agents.find((item) => item.id === "factory-operations").projectId, "analytics-operations");
  assert.ok(overview.projects.every((project) => overview.agents.some((agent) => agent.projectId === project.id)));
});

test("prevents duplicate concurrent runs for one agent", async (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-duplicate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  class WaitingCodex {
    startThread() {
      return { run: async () => new Promise((resolve) => setTimeout(() => resolve({ finalResponse: "done" }), 80)) };
    }
  }
  const service = createProjectHubService({ root, workDir: path.join(root, "work"), CodexClass: WaitingCodex, maxConcurrent: 1 });
  const agentId = service.getOverview().agents[0].id;
  service.startRun({ agentId });
  assert.throws(() => service.startRun({ agentId }), (error) => error?.statusCode === 409);
});

test("rejects project directories outside the workspace", (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-hub-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createProjectHubService({ root, workDir: path.join(root, "work"), CodexClass: FakeCodex });
  assert.throws(() => service.createProject({ name: "Outside", path: path.dirname(root) }), (error) => error?.statusCode === 400);
});

async function waitFor(check, timeoutMs = 3000, describe = () => "") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for project hub state: ${describe()}`);
}
