import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { collectTopicWriteItems } from "../../scripts/psychology-topic-bank.js";
import { handlePsychologyTopicBank, PSYCHOLOGY_TOPIC_API, writeIntegrationTopics } from "./psychology-topic-bank.js";
import { handleJobs } from "./jobs.js";
import worker from "./index.js";
import { pageFileFor } from "./pages.js";

const BASE="https://factory.test";
const session={user:{id:"admin",username:"admin",role:"admin",sidebarModules:["psychology-topic-bank"]}};

function fixture(t){
  const sqlite=new DatabaseSync(":memory:");t.after(()=>sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE factory_users(id TEXT PRIMARY KEY,role TEXT,active INTEGER); INSERT INTO factory_users VALUES('admin','admin',1),('second','admin',1),('operator','operator',1);");
  sqlite.exec(fs.readFileSync(new URL("../migrations/0029_psychology_template_topics.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0033_psychology_template_topic_keys.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0036_psychology_scheduled_comments.sql",import.meta.url),"utf8"));
  sqlite.exec(fs.readFileSync(new URL("../migrations/0040_psychology_auto_replies.sql",import.meta.url),"utf8"));
  for(const name of ["0065_factory_mcp.sql","0066_topic_image_assets.sql"])sqlite.exec(fs.readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
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

test("API keys are hashed, read/write capable, isolated by owner, rotatable and revocable",async t=>{
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
  assert.equal((await call(db,PSYCHOLOGY_TOPIC_API,"GET",undefined,auth,null)).status,200);
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
  assert.match(page,/<summary>读写接口<\/summary>/);
  assert.doesNotMatch(page,/<summary>grokbot 写入接口<\/summary>/);
  assert.match(page,/id="createKeyBtn"/);
  assert.match(page,/psychology-collage（02 拼贴）/);
  assert.match(script,/\/api\/integrations\/psychology\/template-topics/);
  assert.match(script,/function loadKey\(/);
  assert.match(page,/id="fourChoiceFields"/);
  assert.match(page,/id="singleImageFields"/);
  assert.match(script,/collectChoices/);
  assert.match(script,/collectSingleImage/);
});

test("four-image topics upload to archive and serve admin plus worker reads", async t => {
  const {db}=fixture(t);
  const store=new Map();
  const env={DB:db,WORKER_TOKEN:"test-worker",ARCHIVE:{
    async put(key,bytes){const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);store.set(key,{body:data,size:data.byteLength});},
    async get(key){return store.get(key)||null;},
  }};
  const uploaded=await handlePsychologyTopicBank(new Request(BASE+"/api/psychology-template-topics/assets",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageBase64:"data:image/jpeg;base64,/9j/2Q=="}),
  }),env,new URL(BASE+"/api/psychology-template-topics/assets"),session);
  assert.equal(uploaded.status,201);
  const asset=await uploaded.json();
  assert.match(asset.key,/^psychology-topics\/[0-9a-f-]{36}\.jpg$/);
  const preview=await handlePsychologyTopicBank(new Request(BASE+asset.url),env,new URL(BASE+asset.url),session);
  assert.equal(preview.status,200);
  assert.equal(preview.headers.get("content-type"),"image/jpeg");
  const choices=["Moon","Flame","River","Forest"].map((copy,index)=>({
    copy,
    ...(index?{imageUrl:"https://images.unsplash.com/photo-"+index}:{imageKey:asset.key}),
  }));
  const saved=await handlePsychologyTopicBank(new Request(BASE+"/api/psychology-template-topics/import",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),template:"psychology",items:[{title:"Which symbol",choices}]}),
  }),env,new URL(BASE+"/api/psychology-template-topics/import"),session);
  assert.equal(saved.status,201);
  const page=await (await handlePsychologyTopicBank(new Request(BASE+"/api/psychology-template-topics?template=psychology"),env,new URL(BASE+"/api/psychology-template-topics?template=psychology"),session)).json();
  assert.equal(page.items[0].choices[0].copy,"Moon");
  assert.match(page.items[0].choices[0].previewUrl,/assets\?key=/);
  const workerReq=new Request(BASE+"/api/worker/psychology-topic-images/"+asset.key.slice("psychology-topics/".length),{headers:{Authorization:"Bearer test-worker"}});
  const workerRes=await handleJobs(workerReq,env,new URL(workerReq.url),null,{});
  assert.equal(workerRes.status,200);
  assert.equal((await handlePsychologyTopicBank(new Request(BASE+"/api/psychology-template-topics/import",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),template:"psychology",items:[{title:"Missing",choices:[{copy:"A"},{copy:"B"},{copy:"C"},{copy:"D"}]}]}),
  }),env,new URL(BASE+"/api/psychology-template-topics/import"),session)).status,400);
});

test("single-image quiz topics store one image and four option copies", async t => {
  const {db}=fixture(t);
  const saved=await call(db,"/api/psychology-template-topics/import","POST",{
    requestId:crypto.randomUUID(),
    template:"psychology-target-2",
    items:[{
      title:"What this scene says",
      imageUrl:"https://images.unsplash.com/photo-1524504388940-b1c1722653e1",
      choices:[{copy:"stay close"},{copy:"need space"},{copy:"overthink it"},{copy:"walk away"}],
    }],
  });
  assert.equal(saved.status,201);
  const page=await (await call(db,"/api/psychology-template-topics?template=psychology-target-2")).json();
  assert.equal(page.items[0].choices[0].copy,"stay close");
  assert.match(page.items[0].image.imageUrl,/unsplash/);
  assert.equal((await call(db,"/api/psychology-template-topics/import","POST",{
    requestId:crypto.randomUUID(),
    template:"psychology-target-2",
    items:[{title:"Incomplete",choices:[{copy:"A"},{copy:"B"},{copy:"C"},{copy:"D"}]}],
  })).status,400);
  const titleOnly=await call(db,PSYCHOLOGY_TOPIC_API,"POST",{template:"psychology-target-2",title:"Grokbot title only"},{Authorization:"Bearer "+await key(db)},null);
  assert.equal(titleOnly.status,200);
});

test('external topic reads include all shared banks, filters, stable pagination and protected images',async t=>{
 const {db,sqlite}=fixture(t),auth={Authorization:'Bearer '+await key(db)};
 await writeIntegrationTopics(db,{items:Array.from({length:23},(_,i)=>({template:i%2?'psychology-collage':'psychology',title:'Shared '+i,enabled:i!==0,content:'Body '+i}))},'second');
 let data=await (await call(db,PSYCHOLOGY_TOPIC_API+'?pageSize=10','GET',undefined,auth,null)).json();assert.equal(data.total,23);assert.equal(data.items.length,10);assert.equal(data.hasMore,true);
 const second=await (await call(db,PSYCHOLOGY_TOPIC_API+'?pageSize=10&page=2','GET',undefined,auth,null)).json();assert.ok(second.items.every(item=>!data.items.some(first=>first.id===item.id)));
 data=await (await call(db,PSYCHOLOGY_TOPIC_API+'?enabled=inactive','GET',undefined,auth,null)).json();assert.equal(data.total,1);
 assert.equal((await call(db,PSYCHOLOGY_TOPIC_API+'?template=bogus','GET',undefined,auth,null)).status,400);
 assert.equal((await call(db,PSYCHOLOGY_TOPIC_API+'?pageSize=101','GET',undefined,auth,null)).status,400);
 const uploaded='psychology-topics/11111111-1111-1111-1111-111111111111.jpg';
 const saved=await writeIntegrationTopics(db,{template:'psychology-target-2',title:'Image test',imageKey:uploaded,choices:['Stay','Go','Wait','Ask'].map(copy=>({copy}))},'admin');
 const path=PSYCHOLOGY_TOPIC_API+'/'+saved.items[0].id;
 const item=(await (await call(db,path,'GET',undefined,auth,null)).json()).item;
 assert.equal(item.choices.length,4);assert.ok(item.image.previewUrl.startsWith(BASE+PSYCHOLOGY_TOPIC_API+'/assets?key='));
 const req=new Request(item.image.previewUrl,{headers:auth});
 const res=await worker.fetch(req,{DB:db,ARCHIVE:{async get(key){assert.equal(key,uploaded);return {body:new Uint8Array([255,216,255])};}}},{});assert.equal(res.status,200);
 assert.equal((await call(db,PSYCHOLOGY_TOPIC_API+'/assets?key='+encodeURIComponent(uploaded),'GET',undefined,{},null)).status,401);
 sqlite.prepare('UPDATE psychology_template_topics SET deleted_at=1 WHERE id=?').run(item.id);
 assert.equal((await call(db,path,'GET',undefined,auth,null)).status,404);
});

test('topic PATCH preserves omitted fields, merges replies and uses revision guard without a cookie',async t=>{
 const {db,sqlite}=fixture(t),auth={Authorization:'Bearer '+await key(db)};
 const saved=await writeIntegrationTopics(db,{template:'psychology-target-2',title:'Editable',imageUrl:'https://example.com/first.jpg',choices:['Stay','Go','Wait','Ask'].map(copy=>({copy})),revealComment:'Reveal',replyOptions:{A:'Reply A',B:'Reply B'}},'admin');
 const path=PSYCHOLOGY_TOPIC_API+'/'+saved.items[0].id;
 let item=(await (await call(db,path,'GET',undefined,auth,null)).json()).item;
 const old=item.revision;
 const req=new Request(BASE+path,{method:'PATCH',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({revision:old,replyOptions:{A:'Updated'},choices:['Stay close','Go','Wait','Ask'].map(copy=>({copy}))})});
 let res=await worker.fetch(req,{DB:db},{});assert.equal(res.status,200,await res.clone().text());item=(await res.json()).item;
 assert.equal(item.revision,old+1);assert.equal(item.replyOptions.A,'Updated');assert.equal(item.replyOptions.B,'Reply B');assert.equal(item.revealComment,'Reveal');assert.equal(item.image.imageUrl,'https://example.com/first.jpg');assert.equal(item.choices[0].copy,'Stay close');
 assert.equal((await call(db,path,'PATCH',{revision:old,title:'Stale'},auth,null)).status,409);
 assert.equal((await call(db,path,'PATCH',{title:'No revision'},auth,null)).status,409);
 assert.equal((await call(db,path,'PATCH',{revision:item.revision,template:'psychology'},auth,null)).status,400);
 assert.equal((await call(db,path,'DELETE',{revision:item.revision},auth,null)).status,405);
 assert.equal((await call(db,PSYCHOLOGY_TOPIC_API+'/api-key','POST',{},auth,null)).status,405);
 res=await call(db,path,'PATCH',{revision:item.revision,imageUrl:'https://example.com/new.jpg',enabled:false},auth,null);assert.equal(res.status,200);item=(await res.json()).item;assert.equal(item.image.imageUrl,'https://example.com/new.jpg');assert.equal(item.enabled,false);
 assert.equal(sqlite.prepare('SELECT usage_count FROM psychology_template_topics WHERE id=?').get(item.id).usage_count,0);
});
