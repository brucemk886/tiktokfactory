import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDeployAlignment, findGitRoot } from "./check-origin-main.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("deploy is allowed when local matches origin/main", () => {
  assert.deepEqual(evaluateDeployAlignment({
    head: "aaa",
    remote: "aaa",
    branch: "main",
    dirty: false
  }), { ok: true, reason: "up-to-date" });
});

test("deploy is refused when local has unpushed commits", () => {
  assert.deepEqual(evaluateDeployAlignment({
    head: "bbb",
    remote: "aaa",
    branch: "main",
    dirty: false
  }), { ok: false, reason: "not-synchronized" });
});

test("deploy is refused when local is behind or diverged from main", () => {
  assert.deepEqual(evaluateDeployAlignment({
    head: "aaa",
    remote: "ccc",
    branch: "main",
    dirty: false
  }), { ok: false, reason: "not-synchronized" });
  assert.deepEqual(evaluateDeployAlignment({
    head: "bbb",
    remote: "ccc",
    branch: "main",
    dirty: false
  }), { ok: false, reason: "not-synchronized" });
});

test("deploy is refused outside main or with a dirty worktree", () => {
  assert.deepEqual(evaluateDeployAlignment({
    head: "aaa",
    remote: "aaa",
    branch: "agent/hook-engine",
    dirty: false
  }), { ok: false, reason: "non-main" });
  assert.deepEqual(evaluateDeployAlignment({
    head: "aaa",
    remote: "aaa",
    branch: "main",
    dirty: true
  }), { ok: false, reason: "dirty" });
});

test("factory-cloud resolves the parent tiktokfactory git root", () => {
  const root = findGitRoot();
  assert.ok(root);
  assert.notEqual(root.replace(/\\/g, "/"), here.replace(/\\/g, "/"));
});
