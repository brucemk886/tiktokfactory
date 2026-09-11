import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { publicPsychologySettings } from "./compat.js";
import { persistableJobResult, publicJob } from "./jobs.js";
import { pageFileFor } from "./pages.js";
import { getSession } from "./auth.js";
import { SIDEBAR_MODULES, moduleIdForPath, canAccessPath, sidebarModuleIdsForRole } from "./sidebar.js";

test("psychology templates have independent entries in the psychology group", () => {
  assert.equal(pageFileFor("/psychology-collage"), "psychology-collage.html");
  assert.equal(pageFileFor("/psychology-target-2"), "psychology-narrative.html");
  assert.equal(pageFileFor("/psychology-narrative"), "psychology-narrative.html");
  assert.equal(moduleIdForPath("/psychology-collage"), "psychology-collage");
  assert.equal(moduleIdForPath("/psychology-target-2"), "psychology-narrative");
  const module = SIDEBAR_MODULES.find((item) => item.id === "psychology-narrative");
  assert.equal(module?.href, "/psychology-target-2");
  assert.equal(module?.group?.id, "psychology");
  assert.deepEqual(module?.roles, ["admin"]);
  const templates = SIDEBAR_MODULES.filter(item => ["psychology", "psychology-collage", "psychology-narrative"].includes(item.id));
  assert.deepEqual(templates.map(item => item.label), ["四图测试模板", "纸张拼贴模板", "互动测试模板"]);
  assert.ok(templates.every(item => item.group.id === "psychology"));
  assert.equal(SIDEBAR_MODULES.some(item => item.group?.id === "mid-video" && item.id.startsWith("psychology")), false);
  assert.equal(moduleIdForPath("/psychology-narrative"), "psychology-narrative");
  assert.equal(sidebarModuleIdsForRole("operator").includes("psychology-collage"), false);
  assert.equal(canAccessPath({role:"operator",sidebarModules:["psychology"]}, "/psychology-collage"), false);
  assert.equal(canAccessPath({role:"operator",sidebarModules:["psychology"]}, "/psychology"), true);
});

test("psychology settings expose readiness without returning API keys", () => {
  const settings = publicPsychologySettings({
    kieApiKey: "kie-secret",
    elevenLabsApiKey: "eleven-secret",
    elevenLabsVoiceId: "voice-1",
    elevenLabsModelId: "eleven_multilingual_v2",
  });
  assert.equal(settings.configured, true);
  assert.equal(settings.kieConfigured, true);
  assert.equal(settings.elevenLabsConfigured, true);
  assert.equal(settings.elevenLabsVoiceId, "voice-1");
  assert.equal("kieApiKey" in settings, false);
  assert.equal("elevenLabsApiKey" in settings, false);
});

test("cloud queue and local worker dispatch both psychology target types", () => {
  const jobs = fs.readFileSync(new URL("./jobs.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../../scripts/factory-cloud-worker.js", import.meta.url), "utf8");
  const auth = fs.readFileSync(new URL("./auth.js", import.meta.url), "utf8");
  assert.match(jobs, /\/api\\\/psychology-collage\\\/start/);
  assert.match(jobs, /\/api\\\/psychology-narrative\\\/start/);
  assert.match(jobs, /type: "psychology-collage"/);
  assert.match(jobs, /type: "psychology-target-2"/);
  assert.match(worker, /"psychology-collage": "psychology-collage-job\.js"/);
  assert.match(worker, /"psychology-target-2": "psychology-narrative-job\.js"/);
  assert.match(auth, /insertModuleAfter\(modules, "psychology-collage", "psychology-narrative"\)/);
});

test("psychology result metadata remains available to the existing progress pages", () => {
  const stored = persistableJobResult({
    score: { score: 96, passed: true },
    plan: { title: "Choose the position that feels safest" },
    captionTimings: [{ zh: "Choose one.", en: "", start: 0, end: 1.2 }],
    results: [{
      fileName: "psychology.mp4",
      videoUrl: "/outputs/psychology.mp4",
      contactSheetFileName: "psychology.jpg",
      contactSheetUrl: "/outputs/psychology.jpg",
      title: "Choose the position that feels safest",
      template: "psychology-target-2",
      templateLabel: "心理学 · 目标2",
      quizType: "position-choice",
      language: "en",
      ttsProvider: "kokoro",
      duration: 15.1,
      score: 96,
    }],
  });
  const job = publicJob({
    id: "psychology-target-2-1",
    type: "psychology-target-2",
    status: "done",
    percent: 100,
    message: "done",
    error: "",
    result_json: JSON.stringify(stored),
    created_at: 1,
    updated_at: 2,
  });
  assert.equal(job.results[0].title, "Choose the position that feels safest");
  assert.equal(job.results[0].duration, 15.1);
  assert.equal(job.score.score, 96);
  assert.equal(job.captionTimings[0].end, 1.2);
});


test("existing sessions get the separated template entries without a database rewrite", async () => {
  const readUser = async (role, modules) => {
    const row = {id:"test-user",username:"tester",role,active:1,sidebar_modules_json:JSON.stringify(modules)};
    const db = {prepare(sql){return {bind(){return this;},async first(){return sql.includes("factory_sessions") ? {user_id:row.id,expires_at:Date.now()+60000} : row;}};}};
    return (await getSession(new Request("https://example.test/",{headers:{cookie:"lf_session=test-session"}}),db)).user;
  };
  const admin = await readUser("admin",["psychology","psychology-narrative","schulte"]);
  for (const path of ["/psychology","/psychology-collage","/psychology-target-2","/psychology-narrative"]) assert.equal(canAccessPath(admin,path),true);
  assert.equal(admin.sidebarModules.filter(id=>id==="psychology-collage").length,1);
  const operator = await readUser("operator",["psychology"]);
  assert.equal(canAccessPath(operator,"/psychology"),true);
  assert.equal(canAccessPath(operator,"/psychology-collage"),false);
  assert.equal(canAccessPath(operator,"/psychology-target-2"),false);
});

test("mid-video cards no longer link psychology templates and titles match their entries", () => {
  const html = name => fs.readFileSync(new URL("../../public/"+name,import.meta.url),"utf8");
  assert.doesNotMatch(html("mid-video.html"), /href="\/psychology/);
  for (const [file,title] of [["psychology.html","四图测试模板"],["psychology-collage.html","纸张拼贴模板"],["psychology-narrative.html","互动测试模板"]]) {
    assert.ok(html(file).includes("<h1>"+title+"</h1>"));
    assert.ok(html(file).includes('src="/access.js"'));
  }
});
