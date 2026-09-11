import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { normalizePsychologyPeerHit, importPsychologyPeerHits, listPsychologyPeerHits } from "./psychology-peer-hits-store.js";
import { handlePsychologyPeerHits, PSYCHOLOGY_PEER_API } from "./psychology-peer-hits.js";
import { pageFileFor } from "./pages.js";
import { SIDEBAR_MODULES, sidebarModuleIdsForRole } from "./sidebar.js";
import worker from "./index.js";
const BASE="https://factory.test";
const session={user:{id:"admin",role:"admin",sidebarModules:["psychology-peer-hits"]}};
const url = n => `https://www.tiktok.com/@example/video/${n}`;
function fixture(t) {
  const sqlite=new DatabaseSync(":memory:");t.after(()=>sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE factory_users(id TEXT PRIMARY KEY,role TEXT,active INTEGER); INSERT INTO factory_users VALUES('admin','admin',1),('second','admin',1),('operator','operator',1);");
  sqlite.exec(fs.readFileSync(new URL("../migrations/0022_psychology_peer_hits.sql",import.meta.url),"utf8"));
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
  assert.equal(item.id,(await normalizePsychologyPeerHit({videoUrl:url("1234567890123456789").replace('@example','@renamed')})).id);
  assert.equal(item.title,"<script>alert(1)</script>");
});

test("rejects unsafe URLs, invalid counts, unsafe IDs and invalid extended data",async()=>{
  for(const bad of [{videoUrl:"javascript:alert(1)"},{videoUrl:"https://user:pass@example.com/video"},{videoId:1234567890123456789},{playCount:-1},{likeCount:"many"},{shareCount:1e20},{durationSeconds:true},{videoData:[]},{collectedAt:"2026-01-01"},{videoId:"different"}]){
    await assert.rejects(normalizePsychologyPeerHit({videoUrl:url(123),...bad}),error=>error.statusCode===400);
  }
});

test("upsert is idempotent, preserves omitted values and ignores older observations",async t=>{
  const {db}=fixture(t);const stamp=Date.now()-60000;
  const first={videoUrl:url(123),title:"First title",source:"original",accountName:"Creator",playCount:100,likeCount:10,favoriteCount:8,collectedAt:stamp,videoData:{language:"en",hashtags:["psychology"]}};
  await importPsychologyPeerHits(db,first,"admin");
  const result=await importPsychologyPeerHits(db,{...first,playCount:200,likeCount:undefined,favoriteCount:0,collectedAt:stamp+10000,videoData:{retention:0.5}},"admin");
  assert.equal(result.accepted,1);assert.equal(result.items[0].status,"saved");
  const stale=await importPsychologyPeerHits(db,{videoUrl:url(123),playCount:3,title:"Old",collectedAt:stamp},"admin");assert.equal(stale.ignoredOlder,1);
  await importPsychologyPeerHits(db,{videoUrl:url(123),playCount:200,collectedAt:stamp+20000},"admin");
  const data=await listPsychologyPeerHits(db,new URLSearchParams());assert.equal(data.items[0].source,"original");assert.equal(data.total,1);const item=data.items[0];assert.equal(item.playCount,200);assert.equal(item.likeCount,10);assert.equal(item.favoriteCount,0);assert.equal(item.shareCount,null);assert.equal(item.title,"First title");assert.equal(item.videoData.language,"en");assert.equal(item.videoData.retention,0.5);
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

test("API keys are hashed, write-only, isolated by owner, rotatable and revocable",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);
  const stored=sqlite.prepare("SELECT * FROM psychology_peer_hit_keys").get();assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash.length,64);
  const metadata=await (await call(db,"/api/psychology-peer-hits/api-key")).json();assert.equal(metadata.configured,true);assert.equal(metadata.apiKey,undefined);assert.equal(JSON.stringify(metadata).includes(token),false);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(1)},{},null)).status,401);
  const auth={Authorization:"Bearer "+token};
  const written=await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(1),title:"Bot",accountName:"Account",favoriteCount:10},auth,null);assert.equal(written.status,200);assert.equal((await written.json()).accepted,1);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"GET",undefined,auth,null)).status,405);
  assert.equal((await call(db,"/api/psychology-peer-hits","GET",undefined,auth,null)).status,401);
  const secondToken=await key(db,{user:{...session.user,id:"second"}});const replacement=await key(db);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(2)},auth,null)).status,401);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(2)},{Authorization:"Bearer "+replacement},null)).status,200);
  await call(db,"/api/psychology-peer-hits/api-key","DELETE");
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(3)},{Authorization:"Bearer "+replacement},null)).status,401);
  assert.equal((await call(db,PSYCHOLOGY_PEER_API,"POST",{videoUrl:url(3)},{Authorization:"Bearer "+secondToken},null)).status,200);
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
  const req=new Request(BASE+PSYCHOLOGY_PEER_API,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({videoUrl:url(100),playCount:100})});
  const response=await worker.fetch(req,{DB:db},{});assert.equal(response.status,200);assert.equal((await response.json()).accepted,1);
  assert.equal(pageFileFor("/psychology-peer-hits"),"psychology-peer-hits.html");
  assert.equal(SIDEBAR_MODULES.find(m=>m.id==="psychology-peer-hits").group.id,"psychology");
  assert.equal(sidebarModuleIdsForRole("operator").includes("psychology-peer-hits"),false);
});
