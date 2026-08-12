import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SIDEBAR_MODULES, sidebarModuleIdsForRole } from "./sidebar-modules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

test("sidebar catalog has unique ids and routes", () => {
  assert.equal(new Set(SIDEBAR_MODULES.map((item) => item.id)).size, SIDEBAR_MODULES.length);
  assert.equal(new Set(SIDEBAR_MODULES.map((item) => item.href)).size, SIDEBAR_MODULES.length);
  assert.ok(SIDEBAR_MODULES.every((item) => item.id && item.href.startsWith("/") && item.label));
});

test("role defaults are derived from the canonical sidebar catalog", () => {
  assert.deepEqual(
    sidebarModuleIdsForRole("admin"),
    SIDEBAR_MODULES.filter((item) => item.roles.includes("admin")).map((item) => item.id)
  );
  assert.deepEqual(sidebarModuleIdsForRole("operator"), ["tasks", "stats", "analytics"]);
  assert.ok(sidebarModuleIdsForRole("admin").includes("novel-library"));
  assert.ok(sidebarModuleIdsForRole("admin").includes("official-publish-records"));
  assert.ok(sidebarModuleIdsForRole("admin").includes("official-analytics"));
  assert.ok(!sidebarModuleIdsForRole("operator").includes("official-publish-records"));
  assert.ok(!sidebarModuleIdsForRole("operator").includes("official-analytics"));
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-library")?.href, "/novel-library");
});

test("every authenticated HTML sidebar loads the canonical renderer", () => {
  const missing = fs.readdirSync(publicDir)
    .filter((name) => name.endsWith(".html"))
    .filter((name) => {
      const source = fs.readFileSync(path.join(publicDir, name), "utf8");
      return /class="(?:tasks-nav|side-tabs)/.test(source) && !source.includes('src="/access.js"');
    });
  assert.deepEqual(missing, []);
});

test("browser modules do not duplicate the sidebar catalog", () => {
  for (const name of ["access.js", "accounts.js"]) {
    const source = fs.readFileSync(path.join(publicDir, name), "utf8");
    assert.doesNotMatch(source, /const\s+SIDEBAR_(?:ITEMS|MODULES)\s*=/);
  }
});
