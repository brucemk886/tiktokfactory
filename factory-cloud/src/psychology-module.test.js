import { psychologyPublishPayload } from "../../scripts/psychology-publish-policy.js";
import { psychologyImagePayload } from "../../scripts/psychology-image-policy.js";
import { buildKieImageTaskInput } from "../../scripts/kie-image-models.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { handleCompat, publicPsychologySettings } from "./compat.js";
import { enqueueJob, handleJobs, persistableJobResult, publicJob } from "./jobs.js";
import { pageFileFor } from "./pages.js";
import { getSession } from "./auth.js";
import { buildPexelsSearchQuery, buildPhotoBatchRequest, buildPhotoPublishRecord, decodeRenderedPhoto, isAllowedStockPhotoUrl, normalizePhotoPublishPayload, photoLooksLikePeople, searchStockPhotos } from "./photo-publishing.js";
import { COVER_BACKDROPS, enabledCoverBackdropIds, formatBackdropDate, pickCoverBackdrop } from "../../public/psychology-cover-backdrops.js";
import { buildPerImageCopySlides, buildStockOverlaySlides, buildTextCardSlides, formatCoverQuote, mergeTextCardSets, planCenteredBlock, smashCardWords, stripListMarker } from "../../public/psychology-text-card.js";
import { SIDEBAR_MODULES, moduleIdForPath, canAccessPath, sidebarModuleIdsForRole } from "./sidebar.js";

test("psychology workbench groups template navigation while preserving child permissions", () => {
  assert.equal(pageFileFor("/psychology-collage"), "psychology-collage.html");
  assert.equal(pageFileFor("/psychology-target-2"), "psychology-narrative.html");
  assert.equal(pageFileFor("/psychology-narrative"), "psychology-narrative.html");
  assert.equal(pageFileFor("/psychology-photo"), "psychology-photo.html");
  assert.equal(moduleIdForPath("/psychology-collage"), "psychology-collage");
  assert.equal(moduleIdForPath("/psychology-target-2"), "psychology-narrative");
  assert.equal(moduleIdForPath("/psychology-photo"), "psychology-photo");
  const module = SIDEBAR_MODULES.find((item) => item.id === "psychology-narrative");
  assert.equal(module?.href, "/psychology-target-2");
  assert.equal(module?.group?.id, "psychology");
  assert.deepEqual(module?.roles, ["admin"]);
  const templates = SIDEBAR_MODULES.filter(item => ["psychology", "psychology-collage", "psychology-narrative", "psychology-photo"].includes(item.id));
  assert.deepEqual(templates.map(item => item.label), ["模板工作台", "纸张拼贴模板", "互动测试模板", "图文发布模板"]);
  assert.ok(templates.every(item => item.group.id === "psychology"));
  assert.equal(pageFileFor("/psychology-templates"), "psychology-templates.html");
  assert.equal(moduleIdForPath("/psychology-templates"), "psychology");
  assert.equal(moduleIdForPath("/psychology"), "psychology");
  assert.equal(canAccessPath({role:"operator",sidebarModules:[]}, "/psychology-templates"), false);
  assert.deepEqual(templates.filter(item => !item.navigationParent).map(item => item.label), ["模板工作台"]);
  assert.ok(templates.slice(1).every(item => item.navigationParent === "psychology"));
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
  assert.match(auth, /insertModuleAfter\(modules, "psychology-narrative", "psychology-photo"\)/);
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
  for (const path of ["/psychology","/psychology-collage","/psychology-target-2","/psychology-narrative","/psychology-photo"]) assert.equal(canAccessPath(admin,path),true);
  assert.equal(admin.sidebarModules.filter(id=>id==="psychology-collage").length,1);
  const operator = await readUser("operator",["psychology"]);
  assert.equal(canAccessPath(operator,"/psychology"),true);
  assert.equal(canAccessPath(operator,"/psychology-collage"),false);
  assert.equal(canAccessPath(operator,"/psychology-target-2"),false);
  assert.equal(canAccessPath(operator,"/psychology-photo"),false);
});

test("admins can hide GeeLark backup without the session rewriting it back", async () => {
  const readUser = async (modules) => {
    const row = {id:"test-user",username:"tester",role:"admin",active:1,sidebar_modules_json:JSON.stringify(modules)};
    const db = {prepare(sql){return {bind(){return this;},async first(){return sql.includes("factory_sessions") ? {user_id:row.id,expires_at:Date.now()+60000} : row;}};}};
    return (await getSession(new Request("https://example.test/",{headers:{cookie:"lf_session=test-session"}}),db)).user;
  };
  const hidden = await readUser(["hub","accounts"]);
  assert.equal(hidden.sidebarModules.includes("geelark-profiles"), false);
  assert.equal(hidden.sidebarModules.includes("geelark-tasks"), false);
  const kept = await readUser(["analytics-settings","accounts"]);
  assert.equal(kept.sidebarModules.includes("geelark-profiles"), true);
});

test("mid-video cards no longer link psychology templates and titles match their entries", () => {
  const html = name => fs.readFileSync(new URL("../../public/"+name,import.meta.url),"utf8");
  assert.doesNotMatch(html("mid-video.html"), /href="\/psychology/);
  for (const [file,title] of [["psychology.html","四图测试模板"],["psychology-collage.html","纸张拼贴模板"],["psychology-narrative.html","互动测试模板"],["psychology-photo.html","图文发布模板"]]) {
    assert.ok(html(file).includes("<h1>"+title+"</h1>"));
    assert.ok(html(file).includes('src="/access.js"'));
  }
});


test("all psychology jobs override stale image choices at enqueue and worker delivery", async () => {
  for (const type of ["psychology", "psychology-collage", "psychology-target-2", "psychology-narrative"]) {
    const original={imageModel:"grok",imageModels:["nano-banana","grok"],topic:"A test",totalVideos:3,generation:{question:"Choose a picture",imageModels:["grok"]}};
    const normalized=psychologyImagePayload(type,original);
    assert.equal(normalized.imageModel,"z-image");assert.deepEqual(normalized.imageModels,["z-image"]);
    assert.deepEqual(normalized.generation.imageModels,["z-image"]);assert.equal(normalized.totalVideos,3);
    assert.equal(original.imageModel,"grok");
    assert.equal(buildKieImageTaskInput({imageModel:normalized.imageModel,prompt:"Photo",aspectRatio:"16:9"}).model,"z-image");
    let inserted;
    const db={prepare(){return {bind(...args){inserted=args;return this;},async run(){return {meta:{changes:1}};}};}};
    await enqueueJob(db,{type,payload:original,createdBy:"test"});
    assert.equal(JSON.parse(inserted[4]).imageModel,"z-image");
    const row={id:"old-job",type,status:"queued",payload_json:JSON.stringify(original)};
    const readDb={prepare(){return {bind(){return this;},async first(){return row;}};}};
    const req=new Request("https://example.test/api/worker/jobs/old-job",{headers:{authorization:"Bearer test-worker"}});
    const response=await handleJobs(req,{DB:readDb,WORKER_TOKEN:"test-worker"},new URL(req.url),null,{});
    assert.equal(response.status,200);assert.equal((await response.json()).job.payload.imageModel,"z-image");
  }
  const other={imageModel:"grok"};assert.equal(psychologyImagePayload("quiz",other),other);
});

test("saved psychology settings cannot restore a retired model", async () => {
  const stale={kieApiKey:"test-key",elevenLabsApiKey:"test-voice-key",elevenLabsVoiceId:"voice",imageModel:"grok",imageModels:["nano-banana"],totalVideos:3};
  assert.deepEqual(publicPsychologySettings(stale).imageModels,["z-image"]);
  let saved;
  const db={prepare(){return {bind(...args){this.args=args;return this;},async first(){return {value_json:JSON.stringify(stale)};},async run(){saved=JSON.parse(this.args[1]);return {};}};}};
  const req=new Request("https://example.test/api/psychology/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({imageModel:"nano-banana",imageModels:["grok"]})});
  const response=await handleCompat(req,{DB:db},new URL(req.url),{user:{role:"admin"}});
  assert.equal(response.status,200);assert.equal(saved.imageModel,"z-image");assert.deepEqual(saved.imageModels,["z-image"]);assert.equal(saved.elevenLabsVoiceId,"voice");assert.equal(saved.totalVideos,3);
});

test("retired psychology topic UI and APIs are no longer used", async () => {
  assert.equal(SIDEBAR_MODULES.some(item=>item.id==="psychology-topics"),false);
  assert.equal(sidebarModuleIdsForRole("admin").includes("psychology-topics"),false);
  assert.equal(pageFileFor("/psychology-topics"),"");
  for(const suffix of ["", "/settings", "/sync", "/old-topic"]){
    const req=new Request("https://example.test/api/psychology-topics"+suffix,{method:suffix==="/sync"?"POST":"GET"});
    const res=await handleCompat(req,{DB:{}},new URL(req.url),{user:{role:"admin"}});assert.equal(res.status,410);
  }
  const source=fs.readFileSync(new URL("../../public/psychology.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/psychology-topics|selectedBatchTopicIds|initTopicSelection/);
  assert.match(source,/Gemini 3\.8 Flash/);
  assert.doesNotMatch(source,/Gemini 3\.5 Flash/);
  for(const name of ["psychology.html","psychology-collage.html","psychology-narrative.html"]){
    const html=fs.readFileSync(new URL("../../public/"+name,import.meta.url),"utf8");
    assert.doesNotMatch(html,/value="(?:nano-banana|grok)"|href="\/psychology-topics"/);
    assert.match(html,/value="z-image" checked disabled/);
  }
});


test("psychology defaults to portrait once, and preserves newly saved landscape preference", async () => {
  assert.equal(publicPsychologySettings({}).aspectRatio, "9:16");
  assert.equal(publicPsychologySettings({aspectRatio:"16:9"}).aspectRatio, "9:16");
  let saved={aspectRatio:"16:9"};
  const db={prepare(){return {bind(...args){this.args=args;return this;},async first(){return {value_json:JSON.stringify(saved)};},async run(){saved=JSON.parse(this.args[1]);return {};}};}};
  for (const aspectRatio of ["16:9", "9:16"]) {
    const req=new Request("https://example.test/api/psychology/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({aspectRatio})});
    const response=await handleCompat(req,{DB:db},new URL(req.url),{user:{role:"admin"}});
    assert.equal(response.status,200);assert.equal(saved.aspectRatioPreferenceVersion,1);
    assert.equal(publicPsychologySettings(saved).aspectRatio,aspectRatio);
  }
});

test("psychology queue and old worker delivery disable legacy publishing without reusing accounts", async () => {
  for (const type of ["psychology","psychology-collage","psychology-target-2","psychology-narrative"]) {
    const old={module:"mid-video",publish:{autoPublish:true,provider:"geelark",envIds:["old-phone"],accounts:[{id:"old-phone"}],connectionIds:["wrong"],officialAccounts:[{id:"wrong"}]}};
    const normalized=psychologyPublishPayload(type,old);
    assert.equal(normalized.module,"psychology");assert.equal(normalized.publish.provider,"official");assert.equal(normalized.publish.autoPublish,false);
    for (const key of ["envIds","accounts","connectionIds","officialAccounts"]) assert.deepEqual(normalized.publish[key],[]);
    assert.equal(old.publish.provider,"geelark");
    let inserted;
    const db={prepare(){return {bind(...args){inserted=args;return this;},async run(){return {};}};}};
    await enqueueJob(db,{type,payload:old,createdBy:"test"});assert.equal(JSON.parse(inserted[4]).publish.autoPublish,false);
    const row={id:"old-job",type,status:"queued",payload_json:JSON.stringify(old)};
    const readDb={prepare(){return {bind(){return this;},async first(){return row;}};}};
    const req=new Request("https://example.test/api/worker/jobs/old-job",{headers:{authorization:"Bearer test-worker"}});
    const response=await handleJobs(req,{DB:readDb,WORKER_TOKEN:"test-worker"},new URL(req.url),null,{});
    const delivered=(await response.json()).job.payload;assert.equal(delivered.publish.autoPublish,false);assert.deepEqual(delivered.publish.envIds,[]);
    const official=psychologyPublishPayload(type,{publish:{provider:"official",autoPublish:true,connectionIds:["allowed"],envIds:["legacy"]}});
    assert.equal(official.publish.autoPublish,true);assert.deepEqual(official.publish.connectionIds,["allowed"]);assert.deepEqual(official.publish.envIds,[]);
  }
  const other={publish:{provider:"geelark",autoPublish:true}};
  assert.equal(psychologyPublishPayload("reddit-mix",other),other);
});

test("psychology API records generation-only official tasks and rejects legacy publish retry", async () => {
  const statements=[];
  const db={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return null;},async run(){statements.push({sql,args:this.args});return {};}};}};
  const request=new Request("https://example.test/api/auto-tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({taskType:"psychology",module:"mid-video",generation:{question:"Choose",totalVideos:1},publish:{provider:"geelark",autoPublish:true,envIds:["phone"]}})});
  const response=await handleCompat(request,{DB:db},new URL(request.url),{user:{role:"admin",username:"test"}});
  assert.equal(response.status,201);const task=(await response.json()).task;
  assert.equal(task.publish.provider,"official");assert.equal(task.publish.autoPublish,false);
  const job=statements.find(row=>row.sql.includes("INSERT INTO factory_jobs"));assert.equal(JSON.parse(job.args[4]).module,"psychology");
  const oldTask={id:"old",taskType:"psychology",publish:{provider:"geelark",envIds:["phone"]}};
  const retryDb={prepare(){return {bind(){return this;},async first(){return {value_json:JSON.stringify(oldTask)};}};}};
  const retry=new Request("https://example.test/api/auto-tasks/old/retry-publish",{method:"POST"});
  const result=await handleCompat(retry,{DB:retryDb},new URL(retry.url),{user:{role:"admin"}});assert.equal(result.status,400);
});

test("psychology photo publishing preserves image order, cover and TikTok settings", () => {
  const now = Date.now();
  const first = {assetKey:"temporary--11111111-1111-1111-1111-111111111111.jpg",fileName:"one.jpg",contentType:"image/jpeg",fileSize:1200};
  const second = {assetKey:"temporary--22222222-2222-2222-2222-222222222222.webp",fileName:"two.webp",contentType:"image/webp",fileSize:3400};
  const payload = normalizePhotoPublishPayload({
    requestId:"33333333-3333-4333-8333-333333333333",
    module:"psychology",
    connectionId:"account-1",
    assets:[first,second],
    title:"Attachment styles",
    caption:"Choose the image that feels safest.",
    privacyLevel:"PUBLIC_TO_EVERYONE",
    photoCoverIndex:1,
    musicSoundId:"7450012345678901234",
    autoAddMusic:true,
    disableComment:false,
    scheduleAt:now+60_000,
  }, now);
  const batch = buildPhotoBatchRequest(payload);
  const record = buildPhotoPublishRecord(payload, { batch: { id: "batch-photo-1", tasks: [{ id: "task-photo-1", accountDisplayName: "bchquyn485", username: "bchquyn485" }] } }, now);
  assert.equal(batch.items.length,1);
  assert.deepEqual(batch.items[0].photoAssetKeys,[first.assetKey,second.assetKey]);
  assert.equal(batch.items[0].assetKey,first.assetKey);
  assert.equal(batch.items[0].postInfo.photoCoverIndex,1);
  assert.equal(batch.items[0].postInfo.musicSoundId,"7450012345678901234");
  assert.equal(batch.items[0].postInfo.autoAddMusic,false);
  assert.equal(batch.items[0].postInfo.privacyLevel,"PUBLIC_TO_EVERYONE");
  assert.equal(batch.items[0].fileSize,4600);
  assert.equal(record.id, "photo:33333333-3333-4333-8333-333333333333");
  assert.equal(record.externalRef, "33333333-3333-4333-8333-333333333333:0");
  assert.equal(record.remoteTaskId, "task-photo-1");
  assert.equal(record.batchId, "batch-photo-1");
  assert.equal(record.mediaType, "photo");
  assert.equal(record.photoCount, 2);
  assert.equal(record.autoTaskId, "psychology-photo");
  assert.equal(record.status, "submitted");
  assert.throws(()=>normalizePhotoPublishPayload({requestId:"33333333-3333-4333-8333-333333333333",connectionId:"account-1",assets:[first,first]},now),/不能重复/);
  assert.throws(()=>normalizePhotoPublishPayload({requestId:"33333333-3333-4333-8333-333333333333",connectionId:"account-1",assets:[{...first,assetKey:first.assetKey.replace(".jpg",".png"),contentType:"image/png"}]},now),/1–6/);
  assert.throws(()=>normalizePhotoPublishPayload({requestId:"33333333-3333-4333-8333-333333333333",connectionId:"account-1",assets:Array.from({length:7},(_,index)=>({...first,assetKey:`temporary--11111111-1111-1111-1111-11111111111${index}.jpg`}))},now),/1–6/);
});

test("psychology photo template is an online Z-Image to official photo publishing flow", () => {
  const html=fs.readFileSync(new URL("../../public/psychology-photo.html",import.meta.url),"utf8");
  const styles=fs.readFileSync(new URL("../../public/psychology-photo.css",import.meta.url),"utf8");
  const workbench=fs.readFileSync(new URL("../../public/psychology-templates.html",import.meta.url),"utf8");
  const browser=fs.readFileSync(new URL("../../public/psychology-photo.js",import.meta.url),"utf8");
  const records=fs.readFileSync(new URL("../../public/official-publish-records.js",import.meta.url),"utf8");
  const cloud=fs.readFileSync(new URL("./photo-publishing.js",import.meta.url),"utf8");
  assert.match(html,/图文发布模板/);
  assert.doesNotMatch(html,/三种出图方式|用 Z-Image 生成|官方图文接口，第一张作为封面/);
  assert.doesNotMatch(html,/选择图片与封面|selectedPhotos|photoCount|<option>8<\/option>/);
  assert.match(html,/id="publishTime"[\s\S]*id="musicSoundId"[\s\S]*id="privacyLevel"/);
  assert.match(html,/id="imagePrompt" class="photo-compact-textarea" rows="3"/);
  assert.match(html,/id="imageCopy"/);
  assert.match(html,/id="stockBody"/);
  assert.match(html,/id="cardBody"/);
  assert.match(html,/>生成这张</);
  assert.match(html,/id="clearAlbumBtn"/);
  assert.doesNotMatch(html,/空一行换下一张|imageCopyList|stockCopyList|cardCopyList|imageCount|stockCount|cardCount|几张图几个文案框/);
  assert.match(html,/id="publishCaption" class="photo-compact-textarea" rows="3"/);
  assert.match(html,/id="noImageText" type="checkbox"/);
  assert.doesNotMatch(html,/id="noImageText"[^>]*checked/);
  assert.match(html,/class="photo-layout"/);
  assert.match(styles,/max-width: 1180px/);
  assert.match(styles,/\.photo-layout[^}]*margin: 0/);
  assert.match(html,/data-photo-mode="zimage"[\s\S]*data-photo-mode="stock"[\s\S]*data-photo-mode="text"/);
  assert.match(html,/>AI生图</);
  assert.match(html,/>素材库图片</);
  assert.match(html,/>文案图片</);
  assert.match(html,/id="cardAspect"><option value="9:16" selected>/);
  assert.match(html,/id="stockAspect"><option value="9:16" selected>/);
  assert.match(html,/>内容模板</);
  assert.match(html,/id="coverBackdropGrid"/);
  assert.match(html,/>全部保留</);
  assert.match(html,/>内容标题</);
  assert.match(html,/>这张正文</);
  assert.doesNotMatch(html,/内容页数量|不含封面/);
  assert.doesNotMatch(html,/点缀词|去掉空格|smashWords|stockSmash|cardAccent/);
  assert.match(workbench,/AI生图、素材库图片或文案图片/);
  assert.match(html,/id="renderCardBtn"/);
  assert.match(html,/id="renderStockBtn"/);
  assert.match(html,/id="photoLightbox"/);
  assert.match(html,/从 Pexels 只取竖版/);
  assert.doesNotMatch(html,/从 Unsplash/);
  assert.match(cloud,/api\.pexels\.com/);
  assert.match(cloud,/PEXELS_API_KEY/);
  assert.match(cloud,/orientation", "portrait"/);
  assert.match(browser,/imageModel: "z-image"/);
  assert.match(browser,/function publicationPhotos\(\)/);
  assert.match(browser,/mergeTextCardSets/);
  assert.match(browser,/function renderRecreationAlbum\(/);
  assert.match(browser,/recreationCards/);
  assert.match(browser,/imageModel === "stock"/);
  assert.match(browser,/function clearCurrentAlbum\(/);
  assert.match(browser,/每次只生成 1 张/);
  const page = buildTextCardSlides({
    title: "Signs",
    copies: ["card one\nmore"],
    template: "content",
  });
  assert.equal(page.length, 1);
  assert.equal(page[0].title, "Signs");
  assert.deepEqual(page[0].bullets, ["card one", "more"]);
  assert.deepEqual(buildTextCardSlides({
    title: "Signs of a Disorganized Attachment Style",
    copies: ["• Always wanting alone time, but then feeling lonely\n• Changing your personality depending on who you're with"],
    template: "content",
  })[0].bullets, [
    "Always wanting alone time, but then feeling lonely",
    "Changing your personality depending on who you're with",
  ]);
  assert.equal(stripListMarker("• • Thriving in chaos"), "Thriving in chaos");
  assert.equal(COVER_BACKDROPS.length, 30);
  assert.deepEqual(enabledCoverBackdropIds(["cream-marks", "missing"]), ["cream-marks"]);
  assert.equal(pickCoverBackdrop({ allowedIds: ["cream-marks"], random: 0.9 }).id, "cream-marks");
  const nextPage = buildTextCardSlides({
    title: "Another",
    copies: ["only this page"],
    template: "content",
  });
  assert.equal(nextPage[0].title, "Another");
  assert.deepEqual(nextPage[0].bullets, ["only this page"]);
  assert.match(browser,/pickCoverBackdrop/);
  assert.match(browser,/renderCoverBackdropPicker/);
  assert.match(browser,/allowedIds: savedCoverBackdropIds/);
  assert.match(browser,/function toggleGeneratedPhoto\(/);
  assert.match(browser,/smash: false/);
  assert.doesNotMatch(browser,/smashWords|stockSmash|cardAccent/);
  assert.match(browser,/function openPhotoPreview\(/);
  assert.match(browser,/photoCoverIndex: 0/);
  assert.doesNotMatch(browser,/coverKey|changeSelectedPhoto|state\.selectedPhotos/);
  assert.match(browser,/\/api\/official-tiktok\/photo-assets\/import/);
  assert.match(browser,/\/api\/official-tiktok\/photo-assets\/upload/);
  assert.match(browser,/\/api\/official-tiktok\/photo-publish/);
  assert.match(browser,/overlayGeneratedPhotos/);
  assert.match(browser,/generated-photos\/file/);
  assert.match(browser,/zimage-copy:\$\{photo\.generationId\}:\$\{photo\.resultIndex\}/);
  assert.match(cloud,/\/api\/official-tiktok\/stock-photos/);
  assert.match(cloud,/generated-photos\/file/);
  assert.match(cloud,/loadGeneratedPhoto/);
  assert.match(cloud,/\/api\/v1\/publish\/assets/);
  assert.match(cloud,/photoAssetKeys/);
  assert.match(cloud,/mergeAndStorePublishRecords/);
  assert.match(cloud,/buildPhotoPublishRecord/);
  assert.match(records,/打开图文/);
  assert.match(records,/\(\?:video\|photo\)/);
  assert.doesNotMatch(browser,/local-worker|localhost|127\.0\.0\.1/);
});

test("psychology text cards and stock overlays do not need generated images", () => {
  assert.equal(smashCardWords("Always wanting alone time"), "Alwayswantingalonetime");
  const cards = buildTextCardSlides({ title: "Signs of a Disorganized Attachment Style", body: "- Always wanting alone time\n- Thriving in chaos", count: 1, smash: true, accent: "herher" });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, "content");
  assert.equal(cards[0].title, "SignsofaDisorganizedAttachmentStyle");
  assert.equal(cards[0].accent, "herher");
  assert.equal(cards[0].bullets[0], "Alwayswantingalonetime");
  assert.equal(formatCoverQuote("i can fix her"), "“i can fix her”");
  const cover = buildTextCardSlides({ title: "i can fix her", smash: true, template: "cover" });
  assert.equal(cover.length, 1);
  assert.equal(cover[0].kind, "cover");
  assert.equal(cover[0].title, "“icanfixher”");
  assert.throws(() => buildTextCardSlides({ template: "cover" }), /封面文案/);
  const kept = mergeTextCardSets(
    [{ key: "cover-1", template: "cover" }, { key: "old-content", template: "content" }],
    [{ key: "new-content", template: "content" }],
    "content"
  );
  assert.deepEqual(kept.cards.map((card) => card.key), ["cover-1", "old-content", "new-content"]);
  assert.deepEqual(kept.removed.map((card) => card.key), []);
  assert.equal(planCenteredBlock(200, 1080, 80) > 300, true);
  assert.equal(planCenteredBlock(200, 1080, 80) < 500, true);
  assert.equal(planCenteredBlock(1000, 1080, 80), 80);
  const overlays = buildStockOverlaySlides({
    title: "how to know your attachment style",
    subtitle: "(this explains 90%)",
    copies: [
      "2. they text\nA) search for meaning\nB) enjoy distance",
      "3. they go quiet\nA) panic\nB) wait",
      "",
    ],
    count: 3,
    smash: true,
  });
  assert.equal(overlays.length, 3);
  assert.equal(overlays[0].kind, "cover");
  assert.equal(overlays[0].title, "howtoknowyourattachmentstyle");
  assert.equal(overlays[0].lines[0], "2.theytext");
  assert.equal(overlays[0].lines[1], "A)searchformeaning");
  assert.equal(overlays[1].lines[0], "3.theygoquiet");
  assert.deepEqual(overlays[2].lines, []);
  const perImage = buildPerImageCopySlides({
    copies: ["first card\nmore on first", "second card", "third card"],
    count: 3,
  });
  assert.equal(perImage.length, 3);
  assert.deepEqual(perImage[0].lines, ["first card", "more on first"]);
  assert.deepEqual(perImage[1].lines, ["second card"]);
  assert.deepEqual(perImage[2].lines, ["third card"]);
  assert.equal(isAllowedStockPhotoUrl("https://images.pexels.com/photos/1.jpeg"), true);
  assert.equal(isAllowedStockPhotoUrl("https://images.unsplash.com/photo-abc"), true);
  assert.equal(isAllowedStockPhotoUrl("https://evil.example/photo.jpg"), false);
  assert.match(buildPexelsSearchQuery("couple beach"), /cinematic establishing shot empty scene/);
  assert.doesNotMatch(buildPexelsSearchQuery("couple beach"), /\bcouple\b/);
  assert.equal(photoLooksLikePeople("A couple walking on the beach"), true);
  assert.equal(photoLooksLikePeople("Empty foggy forest road at dawn"), false);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  const encoded = Buffer.from(jpeg).toString("base64");
  const decoded = decodeRenderedPhoto({ imageBase64: `data:image/jpeg;base64,${encoded}`, contentType: "image/jpeg" });
  assert.equal(decoded.contentType, "image/jpeg");
  assert.throws(() => decodeRenderedPhoto({ imageBase64: "not-an-image", contentType: "image/jpeg" }), /损坏|无效/);
});

test("cover backdrops are a 30-template English pool that can be picked at random", () => {
  assert.equal(COVER_BACKDROPS.length, 30);
  assert.equal(new Set(COVER_BACKDROPS.map((item) => item.id)).size, 30);
  const chinese = /[\u4e00-\u9fff]/;
  for (const item of COVER_BACKDROPS) {
    assert.equal(chinese.test(JSON.stringify(item)), false);
    assert.ok(item.ink && item.bg && item.kind);
  }
  assert.equal(pickCoverBackdrop({ random: 0 }).id, COVER_BACKDROPS[0].id);
  assert.notEqual(pickCoverBackdrop({ excludeId: COVER_BACKDROPS[0].id, random: 0 }).id, COVER_BACKDROPS[0].id);
  assert.equal(pickCoverBackdrop({ allowedIds: ["cream-marks", "ink-navy"], random: 0.9 }).id, "ink-navy");
  const date = formatBackdropDate(new Date("2026-09-18T12:00:00+08:00"));
  assert.equal(chinese.test(date.weekday + date.monthDay), false);
  assert.match(date.monthDay, /September/);
});

test("pexels stock search stays portrait and drops photos that look like people", async () => {
  const missing = await searchStockPhotos({}, new URLSearchParams("q=fog"));
  assert.equal(missing.configured, false);
  const requested = [];
  const result = await searchStockPhotos({
    PEXELS_API_KEY: "test-pexels-key",
    fetch: async (url, init) => {
      requested.push({ href: String(url), auth: init.headers.Authorization });
      return {
        ok: true,
        json: async () => ({
          photos: [
            {
              id: 1,
              alt: "A couple walking on the beach",
              photographer: "Ada",
              url: "https://www.pexels.com/photo/couple",
              src: { portrait: "https://images.pexels.com/photos/1.jpeg" },
            },
            {
              id: 2,
              alt: "Empty foggy forest road at dawn",
              photographer: "Lee",
              url: "https://www.pexels.com/photo/forest-road",
              src: { portrait: "https://images.pexels.com/photos/2.jpeg", medium: "https://images.pexels.com/photos/2-m.jpeg" },
            },
          ],
        }),
      };
    },
  }, new URLSearchParams("q=couple beach&count=12"));
  assert.equal(result.configured, true);
  assert.equal(result.photos.length, 1);
  assert.equal(result.photos[0].id, "2");
  assert.match(requested[0].href, /orientation=portrait/);
  assert.match(requested[0].href, /no(\+|%20)people/);
  assert.equal(requested[0].auth, "test-pexels-key");
});
