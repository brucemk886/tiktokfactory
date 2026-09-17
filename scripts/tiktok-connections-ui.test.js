import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pageFileFor } from "../factory-cloud/src/pages.js";
import { canAccessPath, moduleIdForPath } from "../factory-cloud/src/sidebar.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, "public", name), "utf8");

test("authorized account list is a view page with 20-account pagination", () => {
  const html = read("tiktok-connections.html");
  const script = read("tiktok-connections.js");
  assert.match(html, /data-connections-page="view"/);
  assert.match(html, /href="\/tiktok-connections-organize"/);
  assert.match(html, /新建项目 \/ 分组/);
  assert.match(html, /每页 20 个账号/);
  assert.match(html, /id="accountPager"/);
  assert.doesNotMatch(html, /id="createProjectBtn"/);
  assert.doesNotMatch(html, /id="createGroupBtn"/);
  assert.doesNotMatch(html, /id="newProjectName"/);
  assert.match(script, /const PAGE_SIZE = 20/);
  assert.match(script, /is-readonly/);
});

test("creating projects and groups happens on a separate organize page", () => {
  const html = read("tiktok-connections-organize.html");
  const access = read("access.js");
  assert.match(html, /data-connections-page="organize"/);
  assert.match(html, /<h1>新建项目与分组<\/h1>/);
  assert.match(html, /id="createProjectBtn"/);
  assert.match(html, /id="createGroupBtn"/);
  assert.match(html, /href="\/tiktok-connections"/);
  assert.match(html, /id="accountPager"/);
  assert.equal(pageFileFor("/tiktok-connections-organize"), "tiktok-connections-organize.html");
  assert.equal(moduleIdForPath("/tiktok-connections-organize"), "tiktok-connections");
  assert.equal(canAccessPath({ role: "admin", sidebarModules: ["tiktok-connections"] }, "/tiktok-connections-organize"), true);
  assert.match(access, /tiktok-connections-organize/);
});
