import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SIDEBAR_MODULES as CLOUD_SIDEBAR_MODULES } from "../factory-cloud/src/sidebar.js";
import { LOCAL_SIDEBAR_MODULE_IDS, SIDEBAR_MODULES, homePathForUser, shouldRedirectLocalPageToFactory, sidebarModuleIdsForRole } from "./sidebar-modules.js";

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
    SIDEBAR_MODULES.filter((item) => item.roles.includes("admin") && LOCAL_SIDEBAR_MODULE_IDS.includes(item.id)).map((item) => item.id)
  );
  assert.deepEqual(sidebarModuleIdsForRole("operator"), ["geelark-tasks", "analytics", "stats"]);
  assert.ok(!sidebarModuleIdsForRole("operator").includes("hub"));
  assert.deepEqual(sidebarModuleIdsForRole("admin"), [...LOCAL_SIDEBAR_MODULE_IDS]);
  for (const moduleId of ["local-queue", "operator-third-party", "geelark-tasks", "geelark-novel-effects", "accounts"]) {
    assert.ok(sidebarModuleIdsForRole("admin").includes(moduleId));
  }
  for (const moduleId of ["hub", "work-journal", "mid-video", "novel-library", "operator-official", "official-analytics"]) {
    assert.ok(!sidebarModuleIdsForRole("admin").includes(moduleId));
  }
  assert.ok(!sidebarModuleIdsForRole("admin").includes("novel-rewrite"));
  assert.ok(!sidebarModuleIdsForRole("admin").includes("rewrite-records"));
  assert.ok(!sidebarModuleIdsForRole("operator").includes("official-publish-records"));
  assert.ok(!sidebarModuleIdsForRole("operator").includes("official-analytics"));
  assert.ok(sidebarModuleIdsForRole("admin").includes("asset-usage"));
  assert.ok(!sidebarModuleIdsForRole("operator").includes("asset-usage"));
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-library")?.href, "/novel-library");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-peer-hits")?.href, "/novel-peer-hits");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-peer-hits")?.label, "同行爆款");
  assert.deepEqual(SIDEBAR_MODULES.find((item) => item.id === "novel-peer-hits")?.roles, ["admin"]);
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-effects")?.href, "/novel-effects");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-effects")?.label, "小说数据统计");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-ops-report")?.href, "/novel-ops-report");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "novel-ops-report")?.label, "数据概览");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "mid-video-effects")?.label, "数据概览");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "psychology-effects")?.label, "数据概览");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "work-journal")?.href, "/work-journal");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "work-journal")?.label, "工作记录");
  assert.equal(
    SIDEBAR_MODULES.map((item) => item.id).indexOf("work-journal"),
    SIDEBAR_MODULES.map((item) => item.id).indexOf("accounts") - 1
  );
});

test("business lines keep official and GeeLark navigation apart", () => {
  assert.deepEqual(
    SIDEBAR_MODULES.filter((item) => item.group?.id === "novel-promotion").map((item) => item.id),
    ["novel-strategy", "novel-library", "novel-peer-hits", "novel-ops-report", "novel-effects", "operator-official", "tasks", "asset-usage"]
  );
  assert.deepEqual(
    SIDEBAR_MODULES.filter((item) => item.group?.id === "mid-video").map((item) => item.id),
    ["mid-video", "schulte", "podcast", "ai", "mid-video-effects", "mid-video-ops-report", "mid-video-publish"]
  );
  assert.deepEqual(
    SIDEBAR_MODULES.filter((item) => item.group?.id === "psychology").map((item) => item.id),
    ["psychology-topics", "psychology", "psychology-effects", "psychology-ops-report", "psychology-publish"]
  );
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "operator-third-party")?.group?.id, "geelark-backup");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-profiles")?.group?.id, "geelark-backup");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-profiles")?.href, "/geelark-profiles");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-tasks")?.group?.id, "geelark-backup");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-tasks")?.href, "/geelark-tasks");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "tasks")?.group?.id, "novel-promotion");
  assert.deepEqual(SIDEBAR_MODULES.find((item) => item.id === "tasks")?.roles, ["admin"]);
  assert.deepEqual(SIDEBAR_MODULES.find((item) => item.id === "geelark-tasks")?.roles, ["admin", "operator"]);
  assert.deepEqual(SIDEBAR_MODULES.find((item) => item.id === "analytics")?.roles, ["admin", "operator"]);
  assert.deepEqual(SIDEBAR_MODULES.find((item) => item.id === "stats")?.roles, ["admin", "operator"]);
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-novel-effects")?.group?.id, "geelark-backup");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-novel-effects")?.href, "/geelark-novel-effects");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "official-analytics")?.group?.id, "official-channel");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "hub")?.href, "/");
  assert.deepEqual(SIDEBAR_MODULES.find((item) => item.id === "hub")?.roles, ["admin"]);
});

test("operator home is the first granted page", () => {
  assert.equal(homePathForUser({ role: "admin", sidebarModules: ["local-queue", "accounts"] }), "/local-queue");
  assert.equal(homePathForUser({ role: "operator", sidebarModules: ["tasks", "analytics", "stats"] }), "/analytics");
  assert.equal(homePathForUser({ role: "operator", sidebarModules: ["hub", "analytics", "stats"] }), "/analytics");
  assert.equal(homePathForUser({ role: "operator", sidebarModules: ["geelark-tasks"] }), "/geelark-tasks");
  assert.equal(homePathForUser({ role: "operator", sidebarModules: [] }), "");
});

test("retired local pages redirect to the online factory", () => {
  assert.equal(shouldRedirectLocalPageToFactory("/mid-video-effects"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/psychology-effects"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/novel-library"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/asset-usage"), false);
  assert.equal(shouldRedirectLocalPageToFactory("/novel-peer-hits"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/tasks"), false);
  assert.equal(shouldRedirectLocalPageToFactory("/work-journal"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/work-journal-mindmap"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/operator/official"), true);
  assert.equal(shouldRedirectLocalPageToFactory("/geelark-tasks"), false);
  assert.equal(shouldRedirectLocalPageToFactory("/geelark-profiles"), false);
  assert.equal(shouldRedirectLocalPageToFactory("/accounts"), false);
  assert.equal(shouldRedirectLocalPageToFactory("/local-queue"), false);
});

test("local reddit mix can refresh audio folders and push them to the factory", () => {
  const html = fs.readFileSync(path.join(publicDir, "tasks.html"), "utf8");
  const js = fs.readFileSync(path.join(publicDir, "tasks.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "scripts", "server.js"), "utf8");
  assert.match(html, /id="syncAudioGroupsBtn"/);
  assert.match(html, /id="syncAssetGroupsBtn"/);
  assert.match(html, /data-local-only/);
  assert.match(js, /\/api\/audio-groups\/sync/);
  assert.match(js, /kind === "legacy"/);
  assert.doesNotMatch(js, /kind === "legacy-bundle"/);
  assert.match(html, /音频文件夹/);
  assert.match(js, /\/api\/asset-groups\/sync/);
  assert.match(js, /item\.hidden = !isLocalWorkerPage/);
  assert.match(server, /\/api\/audio-groups\/sync/);
  assert.match(server, /\/api\/asset-groups\/sync/);
  assert.match(server, /pushAudioGroups/);
  assert.match(server, /pushAssetGroups/);
});

test("asset usage stays local and only syncs from the worker machine", () => {
  const html = fs.readFileSync(path.join(publicDir, "asset-usage.html"), "utf8");
  const js = fs.readFileSync(path.join(publicDir, "asset-usage.js"), "utf8");
  assert.match(html, /id="syncUsageBtn"/);
  assert.match(html, /data-local-only/);
  assert.match(js, /\/api\/asset-usage\/sync/);
  assert.match(js, /item\.hidden = !isLocalWorkerPage/);
});

test("every authenticated HTML sidebar loads the canonical renderer", () => {
  const missing = fs.readdirSync(publicDir)
    .filter((name) => name.endsWith(".html") && name !== "work-journal-mindmap.html")
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

test("novel effects keep official and GeeLark data on separate pages", () => {
  const official = fs.readFileSync(path.join(publicDir, "novel-effects.html"), "utf8");
  const geelark = fs.readFileSync(path.join(publicDir, "geelark-novel-effects.html"), "utf8");
  assert.match(official, /小说数据统计/);
  assert.match(official, /data-days="1"/);
  assert.match(official, /id="daysTabs"/);
  assert.match(official, /class="is-active" data-days="7"/);
  assert.doesNotMatch(official, /数据通路/);
  assert.doesNotMatch(official, /source-lock/);
  assert.match(official, /data-source="official_api"/);
  assert.match(official, /id="hotHits"/);
  assert.match(official, /当下爆款/);
  const effectsJs = fs.readFileSync(path.join(publicDir, "novel-effects.js"), "utf8");
  assert.match(effectsJs, /pageSize:\s*10/);
  assert.match(effectsJs, /tiktokWatchUrl/);
  assert.match(effectsJs, /renderVideoJumpList/);
  assert.doesNotMatch(effectsJs, /上榜小说/);
  assert.doesNotMatch(effectsJs, /\["发布视频"/);
  assert.doesNotMatch(official, /id="sourceTabs"/);
  assert.doesNotMatch(official, /data-source="third_party"/);
  assert.match(geelark, /data-source="third_party"/);
  assert.doesNotMatch(geelark, /data-source="official_api"/);
});

test("GeeLark pages are visibly distinguished from official TikTok pages", () => {
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "stats")?.label, "GeeLark · 发布记录");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "analytics")?.label, "GeeLark · 数据总览");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-novel-effects")?.label, "GeeLark · 小说效果");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "geelark-tasks")?.label, "GeeLark · Reddit 自动发布");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "tasks")?.label, "Reddit 混剪");
  assert.equal(SIDEBAR_MODULES.find((item) => item.id === "official-analytics")?.label, "授权账号数据");
  assert.ok(SIDEBAR_MODULES.findIndex((item) => item.id === "analytics") < SIDEBAR_MODULES.findIndex((item) => item.id === "stats"));
});

test("factory cloud keeps peer hits under novel promotion", () => {
  const item = CLOUD_SIDEBAR_MODULES.find((entry) => entry.id === "novel-peer-hits");
  assert.equal(item?.href, "/novel-peer-hits");
  assert.equal(item?.label, "同行爆款");
  assert.equal(item?.group?.id, "novel-promotion");
  assert.deepEqual(item?.roles, ["admin", "operator"]);
  assert.equal(CLOUD_SIDEBAR_MODULES.find((entry) => entry.id === "novel-ops-report")?.label, "数据概览");
  assert.equal(CLOUD_SIDEBAR_MODULES.find((entry) => entry.id === "novel-effects")?.label, "小说数据统计");
  assert.equal(CLOUD_SIDEBAR_MODULES.find((entry) => entry.id === "asset-usage")?.group?.id, "novel-promotion");
  assert.deepEqual(CLOUD_SIDEBAR_MODULES.find((entry) => entry.id === "asset-usage")?.roles, ["admin"]);
  assert.ok(
    CLOUD_SIDEBAR_MODULES.findIndex((entry) => entry.id === "novel-ops-report")
    < CLOUD_SIDEBAR_MODULES.findIndex((entry) => entry.id === "novel-effects")
  );
});
