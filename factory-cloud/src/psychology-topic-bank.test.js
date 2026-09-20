import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { collectTopicWriteItems } from "../../scripts/psychology-topic-bank.js";
import { handlePsychologyTopicBank, PSYCHOLOGY_TOPIC_API, writeIntegrationTopics } from "./psychology-topic-bank.js";
import worker from "./index.js";
import { pageFileFor } from "./pages.js";

const BASE="https://factory.test";
const session={user:{id:"admin",username:"admin",role:"admin",sidebarModules:["psychology-topic-bank"]}};

function fixture(t){
  const sqlite=new DatabaseSync(":memory:");t.after(()=>sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE factory_users(id TEXT PRIMARY KEY,role TEXT,active INTEGER); INSERT INTO factory_users VALUES('admin','admin',1),('second','admin',1),('operator','operator',1);");
  sqlite.exec(fs.readFileSync(new URL("../migrations/0029_psychology_template_topics.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0033_psychology_template_topic_keys.sql",import.meta.url),"utf8"));
  const db={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
    async first(){return sqlite.prepare(sql).get(...this.args)||null;},
    async all(){
      if(/^\s*select/i.test(sql))return {results:sqlite.prepare(sql).all(...this.args),meta:{changes:0}};
      const info=sqlite.prepare(sql).run(...this.args);
      return {results:[],meta:{changes:Number(info.changes)}};
    },
    async run(){const info=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(info.changes)}};}};},
    async batch(statements){sqlite.exec("BEGIN");try{const results=[];for(const stmt of statements)results.push(await stmt.all());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  return {db,sqlite};
}
async function call(db,path,method="GET",body,extra={},who=session){
  const request=new Request(BASE+path,{method,headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return handlePsychologyTopicBank(request,{DB:db},new URL(request.url),who);
}
async function key(db,who=session){
  const response=await call(db,"/api/psychology-template-topics/api-key","POST",undefined,{},who);
  assert.equal(response.status,201);
  return (await response.json()).apiKey;
}

test("collectTopicWriteItems accepts mixed templates, batch fallback and rejects bad rows before write",()=>{
  const mixed=collectTopicWriteItems({items:[
    {template:"psychology",title:"One",content:"A"},
    {template:"psychology-target-2",title:"Two",priority:90},
  ]});
  assert.equal(mixed[0].template,"psychology");
  assert.equal(mixed[1].template,"psychology-target-2");
  assert.equal(mixed[1].priority,90);
  const fallback=collectTopicWriteItems({template:"psychology-collage",items:[{title:"Theme"}]});
  assert.equal(fallback[0].template,"psychology-collage");
  const single=collectTopicWriteItems({template:"psychology",title:"Solo"});
  assert.equal(single.length,1);
  assert.throws(()=>collectTopicWriteItems({items:[{title:"No template"}]}),/所属模板/);
  assert.throws(()=>collectTopicWriteItems({template:"psychology",items:[{title:"Ok"},{title:""}]}),/第2条/);
  assert.throws(()=>collectTopicWriteItems({template:"psychology",items:[]}),/1–100/);
  assert.throws(()=>collectTopicWriteItems({items:"x"}),/数组/);
});

test("grokbot write skips duplicates, isolates templates and rejects invalid batches",async t=>{
  const {db,sqlite}=fixture(t);
  const first=await writeIntegrationTopics(db,{template:"psychology",items:[{title:"Shared",content:"A"},{title:"Shared",content:"A"}]},"admin");
  assert.equal(first.accepted,2);assert.equal(first.created,1);assert.equal(first.skipped,1);
  const again=await writeIntegrationTopics(db,{template:"psychology",items:[{title:"Shared",content:"A"}]},"admin");
  assert.equal(again.created,0);assert.equal(again.skipped,1);
  await writeIntegrationTopics(db,{items:[{template:"psychology-collage",title:"Shared",content:"A"}]},"admin");
  assert.equal(sqlite.prepare("SELECT template,COUNT(*) n FROM psychology_template_topics WHERE deleted_at=0 GROUP BY template").all().length,2);
  await assert.rejects(writeIntegrationTopics(db,{items:[{template:"psychology",title:"Good"},{title:"Missing template"}]},"admin"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_template_topics WHERE title='Good'").get().n,0);
});

test("API keys are hashed, write-only, isolated by owner, rotatable and revocable",async t=>{
  const {db,sqlite}=fixture(t);const token=await key(db);
  const stored=sqlite.prepare("SELECT * FROM psychology_template_topic_keys").get();
  assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash.length,64);
  const metadata=await (await call(db,"/api/psychology-template-topics/api-key")).json();
  assert.equal(metadata.configured,true);assert.equal(metadata.apiKey,undefined);assert.equal(JSON.stringify(metadata).includes(token),false);
  assert.equal(metadata.endpoint,PSYCHOLOGY_TOPIC_API);
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",title:"Bot"},{},null)).status,401);
  const auth={Authorization:"Bearer "+token};
  const written=await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",title:"Bot",content:"Guide"},auth,null);
  assert.equal(written.status,200);
  const body=await written.json();assert.equal(body.accepted,1);assert.equal(body.created,1);assert.equal(body.items[0].status,"created");
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"GET",undefined,auth,null)).status,405);
  assert.equal((await call(db,"/api/psychology-template-topics","GET",undefined,auth,null)).status,401);
  const secondToken=await key(db,{user:{...session.user,id:"second"}});
  const replacement=await key(db);
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",title:"After rotate"},auth,null)).status,401);
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",title:"After rotate"},{Authorization:"Bearer "+replacement},null)).status,200);
  await call(db,"/api/psychology-template-topics/api-key","DELETE");
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",title:"Revoked"},{Authorization:"Bearer "+replacement},null)).status,401);
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology-target-2",title:"Second owner"},{Authorization:"Bearer "+secondToken},null)).status,200);
  sqlite.prepare("UPDATE factory_users SET active=0 WHERE id='second'").run();
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology-target-2",title:"Inactive"},{Authorization:"Bearer "+secondToken},null)).status,401);
});

test("permission and request guards protect topic-bank keys and reject malformed batches",async t=>{
  const {db}=fixture(t);const keyPath="/api/psychology-template-topics/api-key";
  assert.equal((await call(db,keyPath,"POST",undefined,{},null)).status,401);
  assert.equal((await call(db,keyPath,"POST",undefined,{},{user:{id:"operator",role:"operator",sidebarModules:["psychology-topic-bank"]}})).status,403);
  assert.equal((await call(db,keyPath,"POST",undefined,{},{user:{id:"admin",role:"admin",sidebarModules:[]}})).status,403);
  assert.equal((await call(db,keyPath,"POST",undefined,{Origin:"https://evil.test"})).status,403);
  const token=await key(db),auth={Authorization:"Bearer "+token};
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",title:"x"},{...auth,"Content-Type":"text/plain"},null)).status,415);
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{title:"x".repeat(1024*1024)},{...auth},null)).status,413);
  const req=new Request(BASE+PSYCHOLOGY_TOPIC_API,{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:"{"});
  assert.equal((await handlePsychologyTopicBank(req,{DB:db},new URL(req.url),null)).status,400);
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology",items:[{title:"Ok"},{title:""}]},auth,null)).status,400);
});

test("public integration dispatch works without a login cookie and stays on the topic-bank page",async t=>{
  const {db}=fixture(t);const token=await key(db);
  const req=new Request(BASE+PSYCHOLOGY_TOPIC_API,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({template:"psychology",title:"From grokbot",content:"Options"})});
  const response=await worker.fetch(req,{DB:db},{});
  assert.equal(response.status,200);assert.equal((await response.json()).created,1);
  assert.equal(pageFileFor("/psychology-topic-bank"),"psychology-topic-bank.html");
  const page=fs.readFileSync(new URL("../../public/psychology-topic-bank.html",import.meta.url),"utf8");
  const script=fs.readFileSync(new URL("../../public/psychology-topic-bank.js",import.meta.url),"utf8");
  assert.match(page,/<summary>写入接口<\/summary>/);
  assert.doesNotMatch(page,/<summary>grokbot 写入接口<\/summary>/);
  assert.match(page,/id="createKeyBtn"/);
  assert.match(page,/psychology-collage（02 拼贴）/);
  assert.match(script,/\/api\/integrations\/psychology\/template-topics/);
  assert.match(script,/function loadKey\(/);
});
