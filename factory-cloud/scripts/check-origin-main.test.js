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
    base: "aaa"
  }), { ok: true, reason: "up-to-date" });
});

test("deploy is allowed when local has unpushed commits on top of main", () => {
  assert.deepEqual(evaluateDeployAlignment({
    head: "bbb",
    remote: "aaa",
    base: "aaa"
  }), { ok: true, reason: "ahead" });
});

test("deploy is refused when local is behind or diverged from main", () => {
  assert.deepEqual(evaluateDeployAlignment({
    head: "aaa",
    remote: "ccc",
    base: "aaa"
  }), { ok: false, reason: "behind-or-diverged" });
  assert.deepEqual(evaluateDeployAlignment({
    head: "bbb",
    remote: "ccc",
    base: "aaa"
  }), { ok: false, reason: "behind-or-diverged" });
});

test("factory-cloud resolves the parent tiktokfactory git root", () => {
  const root = findGitRoot();
  assert.ok(root);
  assert.notEqual(root.replace(/\\/g, "/"), here.replace(/\\/g, "/"));
});
