import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { normalizePsychologyPeerHit, importPsychologyPeerHits, listPsychologyPeerHits } from "./psychology-peer-hits-store.js";
import { handlePsychologyPeerHits, PSYCHOLOGY_PEER_API } from "./psychology-peer-hits.js";
import { pageFileFor } from "./pages.js";
import { SIDEBAR_MODULES, sidebarModuleIdsForRole } from "./sidebar.js";
import worker from "./index.js";
import { filterPhotoPageTexts } from "./photo-page-filter.js";
import { librarySource } from "./psychology-copy-source.js";
const BASE="https://factory.test";
const session={user:{id:"admin",role:"admin",sidebarModules:["psychology-peer-hits"]}};
const url = n => `https://www.tiktok.com/@example/video/${n}`;
function fixture(t) {
  const sqlite=new DatabaseSync(":memory:");t.after(()=>sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE factory_users(id TEXT PRIMARY KEY,username TEXT,role TEXT,active INTEGER); INSERT INTO factory_users VALUES('admin','admin','admin',1),('second','second','admin',1),('operator','operator','operator',1);");
  sqlite.exec(fs.readFileSync(new URL("../migrations/0022_psychology_peer_hits.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0025_psychology_peer_hit_media_type.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0026_psychology_peer_hit_voice_gender.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0027_psychology_peer_hit_media_type_lock.sql",import.meta.url),"utf8"));
  for(const name of ["0042_psychology_creative","0043_psychology_copy_library","0044_psychology_copy_library_future_only","0045_psychology_copy_variant_source","0047_psychology_copy_variant_delete","0049_psychology_copy_comparisons","0051_psychology_peer_enrichment"])
    sqlite.exec(fs.readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),"utf8"));
  sqlite.exec('CREATE TABLE psychology_publish_items(id TEXT PRIMARY KEY,source_id TEXT);');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0052_psychology_rewrite_model.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){const info=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(info.changes)}};}};},
    async batch(statements){sqlite.exec("BEGIN");try{const results=[];for(const stmt of statements)results.push(await stmt.all());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  return {db,sqlite};
}
async function call(db,path,method="GET",body,extra={},who=session) {
  const request=new Request(BASE+path,{method,headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return handlePsychologyPeerHits(request,{DB:db},new URL(request.url),who);
}
async function key(db,who=session){const response=await call(db,"/api/psychology-peer-hits/api-key","POST",undefined,{},who);assert.equal(response.status,201);return (await response.json()).apiKey;}

test("normalizes video identity, full metrics, aliases and timestamp units",async()=>{
  const now=Date.now();const item=await normalizePsychologyPeerHit({videoUrl:url("1234567890123456789")+"?utm_source=test",title:"<script>alert(1)</script>",accountName:"Example",views:"12.8万",likes:"1.2K",comments:0,favorites:30,shares:"50",durationSeconds:18.5,publishedAt:Math.floor((now-86400000)/1000),videoData:{language:"en"}});
  assert.equal(item.videoId,"1234567890123456789");assert.equal(item.platform,"tiktok");assert.equal(item.playCount,128000);assert.equal(item.likeCount,1200);assert.equal(item.commentCount,0);assert.equal(item.favoriteCount,30);assert.equal(item.shareCount,50);assert.ok(item.publishedAt>1e12);
  assert.equal(item.mediaType,"video");
  assert.equal(item.voiceGender,"male");
  assert.equal(item.id,(await normalizePsychologyPeerHit({videoUrl:url("1234567890123456789").replace('@example','@renamed')})).id);
  assert.equal(item.title,"<script>alert(1)</script>");
  const photo=await normalizePsychologyPeerHit({videoUrl:"https://www.tiktok.com/@example/photo/987654321",videoData:{postType:"photo"}});
  assert.equal(photo.mediaType,"photo");assert.equal(photo.videoId,"987654321");
  assert.equal((await normalizePsychologyPeerHit({videoUrl:url(7),voiceGender:"FEMALE"})).voiceGender,"female");
});

test("rejects unsafe URLs, invalid counts, unsafe IDs and invalid extended data",async()=>{
  for(const bad of [{videoUrl:"javascript:alert(1)"},{videoUrl:"https://user:pass@example.com/video"},{videoId:1234567890123456789},{playCount:-1},{likeCount:"many"},{shareCount:1e20},{durationSeconds:true},{videoData:[]},{collectedAt:"2026-01-01"},{videoId:"different"},{voiceGender:"other"}]){
    await assert.rejects(normalizePsychologyPeerHit({videoUrl:url(123),...bad}),error=>error.statusCode===400);
  }
});

test("upsert is idempotent, preserves omitted values and ignores older observations",async t=>{
  const {db}=fixture(t);const stamp=Date.now()-60000;
  const first={videoUrl:url(123),voiceGender:"female",title:"First title",source:"original",accountName:"Creator",playCount:100,likeCount:10,favoriteCount:8,collectedAt:stamp,videoData:{language:"en",hashtags:["psychology"]}};
  await importPsychologyPeerHits(db,first,"admin");
  const result=await importPsychologyPeerHits(db,{...first,playCount:200,likeCount:undefined,favoriteCount:0,collectedAt:stamp+10000,videoData:{retention:0.5}},"admin");
  assert.equal(result.accepted,1);assert.equal(result.items[0].status,"saved");
  const stale=await importPsychologyPeerHits(db,{videoUrl:url(123),playCount:3,title:"Old",collectedAt:stamp},"admin");assert.equal(stale.ignoredOlder,1);
  await importPsychologyPeerHits(db,{videoUrl:url(123),playCount:200,collectedAt:stamp+20000},"admin");
  const data=await listPsychologyPeerHits(db,new URLSearchParams());assert.equal(data.items[0].source,"original");assert.equal(data.total,1);const item=data.items[0];assert.equal(item.playCount,200);assert.equal(item.likeCount,10);assert.equal(item.favoriteCount,0);assert.equal(item.shareCount,null);assert.equal(item.title,"First title");assert.equal(item.voiceGender,"female");assert.equal(item.videoData.language,"en");assert.equal(item.videoData.retention,0.5);
});

test("batch validates before writing, handles repeats, and paginates all records",async t=>{
  const {db}=fixture(t);
  await assert.rejects(importPsychologyPeerHits(db,{items:[{videoUrl:url(1)},{videoUrl:"invalid"}]},"admin"));
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams())).total,0);
  await assert.rejects(importPsychologyPeerHits(db,{items:Array(101).fill({videoUrl:url(1)})},"admin"));
  await importPsychologyPeerHits(db,{items:Array.from({length:41},(_,n)=>({videoUrl:url(100+n),playCount:n,title:n===3?"needle":"test",accountName:"Example"}))},"admin");
  const second=await listPsychologyPeerHits(db,new URLSearchParams("page=2"));assert.equal(second.items.length,20);assert.equal(second.total,41);assert.equal(second.totalPages,3);assert.equal(second.items[0].playCount,20);
  const last=await listPsychologyPeerHits(db,new URLSearchParams("page=999"));assert.equal(last.page,3);assert.equal(last.items.length,1);
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("query=needle"))).total,1);
  const duplicate=await importPsychologyPeerHits(db,[{videoUrl:url(100),title:"Batch first"},{videoUrl:url(100),title:"Batch last"}],"admin");
  assert.equal(duplicate.accepted,2);assert.equal((await listPsychologyPeerHits(db,new URLSearchParams())).total,41);
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("query=Batch last"))).total,1);
  await assert.rejects(listPsychologyPeerHits(db,new URLSearchParams("sort=toString")),error=>error.statusCode===400);
});

test("skips non-English records without failing the rest of the batch",async t=>{
  const {db}=fixture(t);
  const result=await importPsychologyPeerHits(db,[
    {videoUrl:url(601),title:"Why do i always get attached so easy."},
    {videoUrl:url(602),title:"kadang kangen dia yang dulu #avoidant",videoData:{language:"id"}},
    {videoUrl:"https://www.tiktok.com/@example/photo/603",mediaType:"photo",title:"Keep English photo",videoData:{copy:"A complete psychology carousel source with enough detail to recreate."}}
  ],"admin");
  assert.equal(result.accepted,2);
  assert.equal(result.skippedNonEnglish,1);
  assert.equal(result.items.filter(item=>item.status==="skipped_non_english").length,1);
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("mediaType=video"))).total,1);
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("mediaType=photo"))).total,1);
});

test("video and photo tabs return separate records",async t=>{
  const {db}=fixture(t);
  await importPsychologyPeerHits(db,[
    {videoUrl:url(501),mediaType:"video",title:"Video hit"},
    {videoUrl:"https://www.tiktok.com/@example/photo/502",mediaType:"photo",title:"Photo hit",videoData:{copy:"A complete psychology carousel source with enough detail to recreate."}}
  ],"admin");
  const videos=await listPsychologyPeerHits(db,new URLSearchParams("mediaType=video"));
  const photos=await listPsychologyPeerHits(db,new URLSearchParams("mediaType=photo"));
  assert.equal(videos.total,1);assert.equal(videos.items[0].title,"Video hit");
  assert.equal(photos.total,1);assert.equal(photos.items[0].title,"Photo hit");
  await assert.rejects(listPsychologyPeerHits(db,new URLSearchParams("mediaType=audio")),error=>error.statusCode===400);
  await assert.rejects(normalizePsychologyPeerHit({videoUrl:"https://www.tiktok.com/@example/photo/503",mediaType:"video"}),error=>error.statusCode===400);
});

test("admins can delete a saved video and invalid ids are rejected",async t=>{
  const {db}=fixture(t);
  await importPsychologyPeerHits(db,{videoUrl:url(1),title:"Keep"},"admin");
  await importPsychologyPeerHits(db,{videoUrl:url(2),title:"Drop"},"admin");
  const drop=(await listPsychologyPeerHits(db,new URLSearchParams())).items.find(item=>item.title==="Drop");
  assert.equal((await call(db,`/api/psychology-peer-hits/${drop.id}`,"DELETE",undefined,{},null)).status,401);
  assert.equal((await call(db,`/api/psychology-peer-hits/${drop.id}`,"GET")).status,405);
  assert.equal((await call(db,`/api/psychology-peer-hits/${drop.id}`,"DELETE")).status,200);
  const remaining=await listPsychologyPeerHits(db,new URLSearchParams());
  assert.equal(remaining.total,1);assert.equal(remaining.items[0].title,"Keep");
  assert.equal((await call(db,`/api/psychology-peer-hits/${drop.id}`,"DELETE")).status,404);
  assert.equal((await call(db,"/api/psychology-peer-hits/not-valid","DELETE")).status,404);
});

test("admins can update voice gender and request guards protect the field",async t=>{
  const {db}=fixture(t);
  await importPsychologyPeerHits(db,{videoUrl:url(9),title:"Voice"},"admin");
  const item=(await listPsychologyPeerHits(db,new URLSearchParams())).items[0];
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{voiceGender:"female"}, {}, null)).status,401);
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{voiceGender:"female"},{Origin:"https://evil.test"})).status,403);
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{voiceGender:"other"})).status,400);
  const changed=await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{voiceGender:"female"});
  assert.equal(changed.status,200);assert.equal((await changed.json()).voiceGender,"female");
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams())).items[0].voiceGender,"female");
});

test("admins can move records between video and photo tabs and later imports preserve the manual type",async t=>{
  const {db}=fixture(t);
  await importPsychologyPeerHits(db,{videoUrl:url(10),title:"Wrong tab"},"admin");
  const item=(await listPsychologyPeerHits(db,new URLSearchParams("mediaType=video"))).items[0];
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{mediaType:"audio"})).status,400);
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{mediaType:"photo"}, {}, null)).status,401);
  const moved=await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{mediaType:"photo"});
  assert.equal(moved.status,200);assert.equal((await moved.json()).mediaType,"photo");
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("mediaType=video"))).total,0);
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("mediaType=photo"))).total,1);
  await importPsychologyPeerHits(db,{videoUrl:url(10),playCount:999},"admin");
  const preserved=(await listPsychologyPeerHits(db,new URLSearchParams("mediaType=photo"))).items[0];
  assert.equal(preserved.mediaType,"photo");assert.equal(preserved.playCount,999);
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{mediaType:"video"})).status,200);
  assert.equal((await listPsychologyPeerHits(db,new URLSearchParams("mediaType=video"))).total,1);
  assert.equal((await call(db,`/api/psychology-peer-hits/${item.id}`,"PATCH",{mediaType:"photo",voiceGender:"female"})).status,400);
});

const photoUrl=n=>`https://www.tiktok.com/@example/photo/${n}`;
const M={playCount:1200,likeCount:80,commentCount:0,favoriteCount:5,shareCount:0,publishedAt:"2026-09-01T00:00:00Z",accountUsername:"peer",topics:["anxious"],topComments:[]};
const rewrite=n=>({title:`Rewrite ${n}`,caption:`A full caption written for rewrite ${n}.`,pages:[`Cover ${n}`,`Page two ${n}`]});

test("grokbot page text completes a historical photo copy that auto-extraction skips",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);const auth={Authorization:"Bearer "+token};
  await importPsychologyPeerHits(db,{videoUrl:photoUrl(501),title:"Old post",collectedAt:Date.now()-60000},"admin");
  sqlite.prepare("UPDATE psychology_copy_library SET auto_extract=0").run(); // what migration 0044 did to the 09-18 backlog
  const before=await (await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:photoUrl(501),...M},auth,null)).json();
  assert.equal(before.items[0].copy,"needs_text");assert.match(before.items[0].copyNote,/pageTexts/);
  const response=await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:photoUrl(501),videoData:{pageTexts:["Signs you feel too much","You replay every text"]}},auth,null);
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.items[0].copy,"ready");
  const row=sqlite.prepare("SELECT status,provider,content_json,attempt FROM psychology_copy_library").get();
  assert.equal(row.status,"done");assert.equal(row.provider,"imported-text");
  assert.deepEqual(JSON.parse(row.content_json).pages.map(p=>p.text),["Signs you feel too much","You replay every text"]);
  // Later text never replaces a finished copy.
  await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:photoUrl(501),videoData:{pageTexts:["Different"]}},auth,null);
  assert.equal(JSON.parse(sqlite.prepare("SELECT content_json FROM psychology_copy_library").get().content_json).pages.length,2);
});

test("new posts with text are ready at once; without text they queue, and bad page text is reported",async t=>{
  const {db}=fixture(t);
  const result=await importPsychologyPeerHits(db,[
    {videoUrl:photoUrl(601),videoData:{pageTexts:["One page"]}},
    {videoUrl:photoUrl(602)},
    {videoUrl:photoUrl(603),videoData:{pageTexts:Array(7).fill("Too many")}},
  ],"admin");
  assert.deepEqual(result.items.map(i=>i.copy),["ready","extracting","extracting"]);
  assert.match(result.items[2].copyNote,/1–6/);
});

test("the grokbot API requires metrics, publish time and account; updates may rely on saved values",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);const auth={Authorization:"Bearer "+token};
  const post=async body=>{const r=await call(db,PSYCHOLOGY_PEER_API,"POST",body,auth,null);return {status:r.status,body:await r.json()};};
  const missing=await post({videoUrl:photoUrl(1301),playCount:10});
  assert.equal(missing.status,400);
  assert.match(missing.body.error,/第 1 条缺少必填字段：likeCount、commentCount、favoriteCount、shareCount、publishedAt、accountUsername/);
  assert.match((await post([{...M,videoUrl:photoUrl(1302)},{...M,videoUrl:photoUrl(1303),accountUsername:undefined}])).body.error,/第 2 条缺少必填字段：accountUsername/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_peer_hits").get().n,0);
  assert.equal((await post({...M,videoUrl:photoUrl(1304),likeCount:0,shareCount:"0"})).status,200); // zero counts are values
  assert.equal((await post({videoUrl:photoUrl(1304),videoData:{pageTexts:["Later page text"]}})).status,200); // saved row fills the gaps
  assert.equal((await post({...M,videoUrl:photoUrl(1305),accountUsername:undefined,accountName:"Peer Name"})).status,200);
  // The signed-in manual path keeps these fields optional.
  assert.equal((await importPsychologyPeerHits(db,{videoUrl:photoUrl(1306)},"admin")).accepted,1);
});

test("rewrites in the same import become enabled versions under the original and resends are no-ops",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);const auth={Authorization:"Bearer "+token};
  const payload={...M,videoUrl:photoUrl(701),videoData:{pageTexts:["Original cover","Original page"]},rewrites:[1,2,3,4,5].map(rewrite)};
  const first=await (await call(db,PSYCHOLOGY_PEER_API,"POST",payload,auth,null)).json();
  assert.deepEqual(first.rewrites,{created:5,duplicates:0,conflicts:0});assert.deepEqual(first.items[0].rewrites,{created:5,duplicates:0,conflicts:0});
  const rows=sqlite.prepare("SELECT * FROM psychology_copy_variants ORDER BY title").all();
  assert.equal(rows.length,5);assert.ok(rows.every(r=>r.enabled===1&&r.owner==="admin"&&r.source_key==="v1:tiktok:701"));
  assert.deepEqual(JSON.parse(rows[0].pages_json),["Cover 1","Page two 1"]);
  const again=await (await call(db,PSYCHOLOGY_PEER_API,"POST",payload,auth,null)).json();
  assert.deepEqual(again.rewrites,{created:0,duplicates:5,conflicts:0});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_copy_variants").get().n,5);
  // A reused explicit ID with new text is refused per version without dropping the rest of the batch.
  await importPsychologyPeerHits(db,{videoUrl:photoUrl(702),rewrites:[{...rewrite(9),externalId:"fixed-v1"}]},"admin");
  const conflict=await importPsychologyPeerHits(db,[{videoUrl:photoUrl(702),rewrites:[{...rewrite(10),externalId:"fixed-v1"}]},{videoUrl:photoUrl(703),rewrites:[rewrite(11)]}],"admin");
  assert.deepEqual(conflict.rewrites,{created:1,duplicates:0,conflicts:1});
  assert.equal(sqlite.prepare("SELECT title FROM psychology_copy_variants WHERE external_id='fixed-v1'").get().title,"Rewrite 9");
});

test("page numbers and long book-page screenshots are dropped from original photo text",async t=>{
  const {db,sqlite}=fixture(t);
  assert.deepEqual(filterPhotoPageTexts(["Hook line here","46"," 1/5 ","💔","x".repeat(501),"ok".repeat(250)]),["Hook line here","ok".repeat(250)]);
  const hook="you've been giving him the silent treatment for 2 hours because he chose a night with his friends over a night with you but then you remember page 46";
  const book="Just because your partner wants to see their friends doesn't mean they prefer them over you. "+"They text you to say they're going out with friends tonight. ".repeat(20);
  const kept=await importPsychologyPeerHits(db,{videoUrl:photoUrl(1201),title:"page 46",videoData:{pageTexts:[hook,"46",book]}},"admin");
  assert.equal(kept.items[0].copy,"ready");
  assert.deepEqual(JSON.parse(sqlite.prepare("SELECT content_json FROM psychology_copy_library").get().content_json).pages,[{index:1,text:hook}]);
  const none=await importPsychologyPeerHits(db,{videoUrl:photoUrl(1202),title:"only book",videoData:{pageTexts:["46",book]}},"admin");
  assert.deepEqual([none.items[0].copy,none.items[0].copyNote],["skipped","图片页都是页码或长段落截图，已跳过这篇。"]);
  const row=sqlite.prepare("SELECT * FROM psychology_copy_library WHERE source_url LIKE '%1202%'").get();
  assert.deepEqual([row.status,row.content_json],["failed","{}"]);
  // Older library rows are filtered when drawn, and refused when nothing usable is left.
  const old={id:"old",media_type:"photo",source_url:photoUrl(1203),title:"t",source_json:"{}",content_json:JSON.stringify({title:"t",caption:"c",pages:[{index:1,text:hook},{index:2,text:"46"},{index:3,text:book}]})};
  assert.deepEqual(librarySource(old,"photo").copyVariant.scenes.map(s=>s.originalText),[hook]);
  assert.throws(()=>librarySource({...old,content_json:JSON.stringify({pages:[{index:1,text:"46"},{index:2,text:book}]})},"photo"),/页码或长段落/);
});

test("rewrite quality gate refuses template, spliced and incomplete versions before any write",async t=>{
  const {db,sqlite}=fixture(t);
  const good={title:"When their silence gets loud",caption:"You are not too much for wanting a clear answer.",pages:["When their silence gets loud","A late reply is not a verdict on your worth"]};
  const post=(n,rw,extra={})=>({videoUrl:photoUrl(1000+n),videoData:{pageTexts:["Original cover line here","He left me on read for two whole days"]},rewrites:[rw],...extra});
  const refused=async(rw,pattern)=>{await assert.rejects(importPsychologyPeerHits(db,post(1,rw),"admin"),pattern);};
  await refused({...good,caption:""},/caption 不能为空/);
  await refused({...good,caption:"   "},/caption 不能为空/);
  // Short captions, hashtag-only captions, single-image posts and hashtags on pages are all allowed.
  const loose=await importPsychologyPeerHits(db,post(9,{title:"Me? #relatable",caption:"#fyp",pages:["Too real #anxiousattachment"]}),"admin");
  assert.equal(loose.rewrites.created,1);
  sqlite.prepare("DELETE FROM psychology_copy_variants").run();sqlite.prepare("DELETE FROM psychology_copy_library").run();sqlite.prepare("DELETE FROM psychology_peer_hits").run();
  await refused({...good,pages:[good.pages[0],"Read the full story, link in bio"]},/引流/);
  await refused({...good,pages:[good.pages[0],"He left me on read for two whole days"]},/第 2 页原样照抄了原文/);
  await refused({...good,pages:[good.pages[0],"Do they You track every delay in their reply?"]},/拼接痕迹/);
  await refused({...good,pages:[good.pages[0],"Closeness feels urgent — they Closeness then scary"]},/拼接痕迹/);
  await refused({...good,caption:"Kamu tidak sendirian, aku juga pernah merasakan ini",pages:["Kamu tidak sendirian","Aku juga pernah merasakan ini dengan dia"]},/必须是英文/);
  // The same body line on two different posts is a template, in one request or against the library.
  const template="They go warm, then scarce, without a clear reason";
  await assert.rejects(importPsychologyPeerHits(db,[post(2,{...good,pages:[good.pages[0],template]}),post(3,{...good,title:"Other",pages:["Another cover",template]})],"admin"),/第 2 条 rewrites 第 1 项.*本次提交里另一篇爆款/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_peer_hits").get().n,0);
  const first=await importPsychologyPeerHits(db,post(2,{...good,pages:[good.pages[0],template]}),"admin");
  assert.equal(first.rewrites.created,1);
  assert.equal((await importPsychologyPeerHits(db,post(2,{...good,pages:[good.pages[0],template]}),"admin")).rewrites.duplicates,1); // resending to the same post is fine
  await assert.rejects(importPsychologyPeerHits(db,post(3,{...good,title:"Other",pages:["Another cover",template.toUpperCase()]}),"admin"),/文案库里其他爆款的改写完全相同/);
  // Deleted versions still count, so a resubmitted template stays refused.
  sqlite.prepare("UPDATE psychology_copy_variants SET deleted_at=1,enabled=0").run();
  await assert.rejects(importPsychologyPeerHits(db,post(4,{...good,title:"Again",pages:["Third cover",template]}),"admin"),/其他爆款的改写完全相同/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_copy_variants").get().n,1);
});

test("invalid or oversized rewrites reject the whole batch before any write; non-English posts keep none",async t=>{
  const {db,sqlite}=fixture(t);
  await assert.rejects(importPsychologyPeerHits(db,[{videoUrl:photoUrl(801)},{videoUrl:photoUrl(802),rewrites:[{title:"Seven",pages:Array(7).fill("x")}]}],"admin"),/第 2 条：rewrites 第 1 项/);
  await assert.rejects(importPsychologyPeerHits(db,{videoUrl:photoUrl(803),rewrites:Array(11).fill(rewrite(1))},"admin"),/最多 10/);
  await assert.rejects(importPsychologyPeerHits(db,{items:Array.from({length:51},(_,n)=>({videoUrl:photoUrl(900+n),rewrites:Array.from({length:10},(_,v)=>rewrite(n*10+v))}))},"admin"),/最多 500/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_peer_hits").get().n,0);
  const skipped=await importPsychologyPeerHits(db,{videoUrl:photoUrl(804),videoData:{language:"id"},rewrites:[rewrite(1)]},"admin");
  assert.equal(skipped.items[0].status,"skipped_non_english");assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_copy_variants").get().n,0);
});

test("API keys are hashed, write-only, isolated by owner, rotatable and revocable",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);
  const stored=sqlite.prepare("SELECT * FROM psychology_peer_hit_keys").get();assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash.length,64);
  const metadata=await (await call(db,"/api/psychology-peer-hits/api-key")).json();assert.equal(metadata.configured,true);assert.equal(metadata.apiKey,undefined);assert.equal(JSON.stringify(metadata).includes(token),false);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(1)},{},null)).status,401);
  const auth={Authorization:"Bearer "+token};
  const written=await call(db,PSYCHOLOGY_PEER_API,"POST",{...M,videoUrl:url(1),title:"Bot",accountName:"Account",favoriteCount:10},auth,null);assert.equal(written.status,200);assert.equal((await written.json()).accepted,1);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"GET",undefined,auth,null)).status,200);
  assert.equal((await call(db,"/api/psychology-peer-hits","GET",undefined,auth,null)).status,401);
  const secondToken=await key(db,{user:{...session.user,id:"second"}});const replacement=await key(db);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(2)},auth,null)).status,401);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(2),...M},{Authorization:"Bearer "+replacement},null)).status,200);
  await call(db,"/api/psychology-peer-hits/api-key","DELETE");
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(3)},{Authorization:"Bearer "+replacement},null)).status,401);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(3),...M},{Authorization:"Bearer "+secondToken},null)).status,200);
  sqlite.prepare("UPDATE factory_users SET active=0 WHERE id='second'").run();
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(4)},{Authorization:"Bearer "+secondToken},null)).status,401);
});

test("permission and request guards protect key management and reject malformed batches",async t=>{
  const {db}=fixture(t);const keyPath="/api/psychology-peer-hits/api-key";
  assert.equal((await call(db,keyPath,"POST",undefined,{},null)).status,401);
  assert.equal((await call(db,keyPath,"POST",undefined,{}, {user:{id:"operator",role:"operator",sidebarModules:["psychology-peer-hits"]}})).status,403);
  assert.equal((await call(db,keyPath,"POST",undefined,{}, {user:{id:"admin",role:"admin",sidebarModules:[]}})).status,403);
  assert.equal((await call(db,keyPath,"POST",undefined,{Origin:"https://evil.test"})).status,403);
  const token=await key(db), auth={Authorization:"Bearer "+token};
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(1)},{...auth,"Content-Type":"text/plain"},null)).status,415);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{title:"x".repeat(1024*1024)},{...auth},null)).status,413);
  const req=new Request(BASE+PSYCHOLOGY_PEER_API,{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:"{"});
  assert.equal((await handlePsychologyPeerHits(req,{DB:db},new URL(req.url),null)).status,400);
});

test("public integration dispatch works without a login cookie and stays separate from novel hits",async t=>{
  const {db}=fixture(t);const token=await key(db);
  const req=new Request(BASE+PSYCHOLOGY_PEER_API,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({...M,videoUrl:url(100),playCount:100})});
  const response=await worker.fetch(req,{DB:db},{});assert.equal(response.status,200);assert.equal((await response.json()).accepted,1);
  assert.equal(pageFileFor("/psychology-peer-hits"),"psychology-peer-hits.html");
  const page=fs.readFileSync(new URL("../../public/psychology-copy-library.html",import.meta.url),"utf8");
  assert.match(page,/<th>播放 \/ 互动<\/th>/);
  assert.match(page,/data-media-type="video">视频爆款<\/button>/);
  assert.match(page,/data-media-type="photo">图文爆款<\/button>/);
  assert.match(page,/class="hits-header-tools"/);
  assert.match(page,/<summary>写入接口<\/summary>/);
  assert.doesNotMatch(page,/<summary>grokbot 写入接口<\/summary>/);
  assert.match(page,/<th>发布 \/ 导入时间<\/th><th>文案状态<\/th><th>改写版本<\/th>/);
  assert.doesNotMatch(page,/recreationVoice|配音声音/);
  assert.match(page,/<th>发布 \/ 导入时间<\/th>/);
  assert.doesNotMatch(page,/produceBtn|原帖复刻/);
  assert.doesNotMatch(page,/rewriteCopy/);
  assert.doesNotMatch(page,/id="moveSelectedBtn"/);
  assert.doesNotMatch(page,/北京时间/);
  assert.doesNotMatch(page,/采集时间/);
  assert.doesNotMatch(page,/最新采集/);
  const script=fs.readFileSync(new URL("../../public/psychology-peer-hits.js",import.meta.url),"utf8");
  assert.match(script,/videoData\?\.标题/);
  assert.match(script,/videoData\?\.文案/);
  assert.match(script,/hits-title" title=/);
  assert.match(script,/hits-copy" title=/);
  assert.doesNotMatch(script,/collectedAt/);
  assert.match(script,/time\(item\.createdAt\)/);
  assert.match(script,/hits-delete/);
  assert.doesNotMatch(script,/hits-move/);
  const productionScript=fs.readFileSync(new URL("../../public/psychology-peer-production.js",import.meta.url),"utf8");
  const boardScript=fs.readFileSync(new URL("../../public/psychology-production.js",import.meta.url),"utf8");
  const boardStyles=fs.readFileSync(new URL("../../public/psychology-production.css",import.meta.url),"utf8");
  assert.match(boardScript,/title="\$\{esc\(job\.title\)\}"/);
  assert.match(boardScript,/data-delete-job/);
  assert.match(boardScript,/method:'DELETE'/);
  assert.match(boardStyles,/-webkit-line-clamp:2/);
  assert.match(boardStyles,/\.queue-delete/);
  assert.match(boardStyles,/board-pagination button:disabled\{cursor:not-allowed\}/);
  const appStyles=fs.readFileSync(new URL("../../public/app.css",import.meta.url),"utf8");
  assert.match(appStyles,/button:disabled \{\s*opacity: 0.55;\s*cursor: not-allowed;/);
  assert.match(productionScript,/moveSelectedBtn/);
  assert.match(productionScript,/移动到图文爆款/);
  assert.match(productionScript,/移动到视频爆款/);
  assert.doesNotMatch(productionScript,/rewriteCopy/);
  assert.doesNotMatch(productionScript,/Z-Image 逐张/);
  assert.match(productionScript,/Promise\.allSettled/);
  assert.match(script,/voice-gender-select/);
  assert.equal(SIDEBAR_MODULES.find(m=>m.id==="psychology-peer-hits").group.id,"psychology");
  assert.equal(sidebarModuleIdsForRole("operator").includes("psychology-peer-hits"),false);
});

test("grokbot stores topics and liked comments, and the key reads watch/enrichment lists without weekly refresh",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);const auth={Authorization:"Bearer "+token};
  const photo="https://www.tiktok.com/@example/photo/8801";
  const saved=await call(db,PSYCHOLOGY_PEER_API,"POST",{...M,commentCount:2,videoUrl:photo,topics:["焦虑型依恋","breakup"],topComments:[{text:"why do I always apologize first",likes:12},{text:"this is literally me with my ex",likes:40}]},auth,null);
  assert.equal(saved.status,200);
  const row=sqlite.prepare("SELECT topics_json,comments_json,play_count,metrics_at FROM psychology_peer_hits").get();
  assert.deepEqual(JSON.parse(row.topics_json),["anxious","breakup"]);
  assert.equal(JSON.parse(row.comments_json)[0].text,"this is literally me with my ex");
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{...M,videoUrl:photo,topics:["nope"]},auth,null)).status,400);
  const again=await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:photo,playCount:5000,likeCount:80,commentCount:2,favoriteCount:5,shareCount:0},auth,null);
  assert.equal(again.status,200);
  const risen=sqlite.prepare("SELECT play_count,prev_play_count FROM psychology_peer_hits").get();
  assert.equal(risen.play_count,5000);assert.equal(risen.prev_play_count,null);
  sqlite.prepare("UPDATE psychology_peer_hits SET metrics_at=1").run();
  const added=await call(db,"/api/psychology-peer-hits/watch-accounts","POST",{username:"@Peer.Account",note:"附件"});
  assert.equal(added.status,201);
  const list=await (await call(db,PSYCHOLOGY_PEER_API,"GET",undefined,auth,null)).json();
  assert.deepEqual(list.watchAccounts,[{username:"peer.account",note:"附件"}]);
  assert.deepEqual(Object.keys(list).sort(),['enrich','watchAccounts']);
  assert.equal(list.enrich.length,0);
  const legacyPhoto="https://www.tiktok.com/@example/photo/8802";
  await importPsychologyPeerHits(db,{...M,videoUrl:legacyPhoto,topics:undefined,topComments:undefined,commentCount:1},"admin");
  const pending=await (await call(db,PSYCHOLOGY_PEER_API,"GET",undefined,auth,null)).json();
  assert.deepEqual(pending.enrich,[{videoUrl:legacyPhoto,accountUsername:M.accountUsername,missing:["topics","topComments"]}]);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:legacyPhoto,topics:["avoidant"],topComments:[{text:"I go quiet",likes:3}]},auth,null)).status,200);
  assert.equal((await (await call(db,PSYCHOLOGY_PEER_API,"GET",undefined,auth,null)).json()).enrich.length,0);
  const listed=await listPsychologyPeerHits(db,new URLSearchParams("mediaType=photo"));
  for(const item of listed.items)for(const field of ["rising","playDelta","prevPlayCount","metricsAt"])assert.equal(Object.hasOwn(item,field),false);
  assert.equal((await call(db,"/api/psychology-peer-hits/watch-accounts?username=peer.account","DELETE")).status,200);
});
