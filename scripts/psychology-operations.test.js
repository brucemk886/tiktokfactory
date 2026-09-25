import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsReport, operationsWindow, mediaKind, publishOutcome } from "./psychology-operations.js";
import { handlePsychologyOperations } from "../factory-cloud/src/psychology-operations.js";
import { ensureModuleProjects } from "./official-account-group-store.js";
import { pageFileFor } from "../factory-cloud/src/pages.js";
const DAY=86400000,now=Date.parse("2026-09-18T12:00:00+08:00");
const window=operationsWindow(new URLSearchParams("period=7d"),now);
const accounts=[{schema:"tiktok:a",username:"alice",groupId:"g1",groupName:"G1"},{schema:"tiktok:b",username:"bob",groupId:"g2"}];
function report(extra={}){return buildOperationsReport({window,accounts:[accounts[0]],now,...extra});}
test("operations window uses Shanghai dates and a previous interval of equal length",()=>{
  assert.equal(window.from,"2026-09-12");assert.equal(window.to,"2026-09-18");
  assert.equal(window.previousFrom,"2026-09-05");assert.equal(window.previousTo,"2026-09-11");
  assert.equal(window.start-window.previousStart,window.end-window.start);
  assert.throws(()=>operationsWindow(new URLSearchParams("period=custom&from=2026-08-01&to=2026-09-18"),now));
  assert.throws(()=>operationsWindow(new URLSearchParams("period=custom&from=2026-09-19&to=2026-09-20"),now));
  assert.throws(()=>operationsWindow(new URLSearchParams("period=custom&from=2026-02-30&to=2026-03-01"),now));
});
test("fresh videos contribute totals but not mature high/zero rates and median",()=>{
  const videos=[
    {id:"1",views:0,createdAt:now-DAY,duration:10},
    {id:"2",views:400,createdAt:now-2*DAY,duration:10},
    {id:"3",views:2000,createdAt:now-DAY+1,duration:10},
    {id:"old",views:800,createdAt:window.start-1,duration:10},
    {id:"1",views:0,createdAt:now-DAY,duration:10},
  ];
  const r=report({videosByAccount:new Map([["tiktok:a",videos]])});
  assert.equal(r.summary.count,3);assert.equal(r.summary.fresh,1);assert.equal(r.summary.sample,2);
  assert.equal(r.summary.medianViews,200);assert.equal(r.summary.highRate,0);assert.equal(r.summary.zeroRate,.5);
  assert.equal(r.summary.views,2400);assert.equal(r.previous.count,1);
  assert.equal(r.daily.reduce((s,d)=>s+d.count,0),3);
});
test("publish success only includes confirmed final outcomes and rejects other-account records",()=>{
  const records=[
    {id:"ok",connectionId:"a",createdAt:now,status:"published"},
    {id:"bad",connectionId:"a",createdAt:now,status:"failed"},
    {id:"sent",connectionId:"a",createdAt:now,status:"done",videoId:"123"},
    {id:"other",connectionId:"b",username:"alice",createdAt:now,status:"published"},
  ];
  const r=report({records});
  assert.equal(r.summary.attempts,3);assert.equal(r.summary.published,1);
  assert.equal(r.summary.failed,1);assert.equal(r.summary.pending,1);assert.equal(r.summary.successRate,.5);
  assert.equal(publishOutcome({status:"submitted"}),"pending");
  assert.equal(report().summary.successRate,null);assert.equal(report().summary.medianViews,null);
});
test("media filters keep unknown types out and can identify photos from matching records",()=>{
  assert.equal(mediaKind({duration:0}),"unknown");assert.equal(mediaKind({duration:12}),"video");
  const videos=[{id:"p",views:300,createdAt:now-2*DAY},{id:"u",views:400,createdAt:now-2*DAY}];
  const r=report({media:"photo",videosByAccount:new Map([["tiktok:a",videos]]),
    records:[{id:"r",videoId:"p",connectionId:"a",mediaType:"photo",createdAt:now-2*DAY,status:"published"}]});
  assert.equal(r.summary.count,1);assert.equal(r.unknownMedia,1);assert.equal(r.summary.views,300);
});
test("batch funnel separates rendering, submission and final success and scopes every item",()=>{
  const base={batch_id:"b",connection_id:"a",created_at:now,config_json:JSON.stringify({name:"Batch",mediaType:"video"})};
  const items=[
    {...base,id:"i1",job_id:"i1-publish",type:"official-publish",status:"done"},
    {...base,id:"i2",job_id:"i2-publish",type:"official-publish",status:"done"},
    {...base,id:"i3",type:"psychology-collage",status:"failed",error:"generation failed"},
    {...base,id:"i4",type:"psychology-collage",status:"running"},
    {...base,id:"hidden",connection_id:"b",status:"failed",error:"private-other-group"},
  ];
  const r=report({items,records:[{id:"r1",connectionId:"a",autoTaskId:"i1",status:"published",createdAt:now}]});
  assert.deepEqual(r.funnel,{planned:4,generated:2,submitted:2,published:1,failed:1});
  assert.equal(r.batches[0].items[1].state,"submitted");
  assert.equal(JSON.stringify(r).includes("private-other-group"),false);
});
test("photo plan completion alone is not counted as rendered content",()=>{
  const base={batch_id:"b",connection_id:"a",created_at:now,config_json:JSON.stringify({mediaType:"photo"})};
  const r=report({items:[{...base,id:"plan",type:"psychology-photo-story",status:"done"},{...base,id:"render",type:"psychology",status:"done"}]});
  assert.equal(r.funnel.planned,2);assert.equal(r.funnel.generated,1);assert.equal(r.funnel.submitted,0);
});
function fixture(){
  const store=ensureModuleProjects({});
  store.groups=[{id:"g1",name:"Psych",projectId:"proj-psych"},{id:"g2",name:"Other",projectId:"proj-psych"},{id:"g3",name:"Novel",projectId:"proj-novel"}];
  const assigned=[{account_key:"a",group_id:"g1"},{account_key:"b",group_id:"g2"},{account_key:"c",group_id:"g3"}];
  const rows=["a","b","c"].map(id=>({account_key:"tiktok:"+id,label:id,profile_json:JSON.stringify({username:id}),synced_at:Date.now()}));
  const reads=[];
  const DB={prepare(sql){assert.match(sql.trim(),/^SELECT/);return{bind(){return this;},async first(){if(sql.includes("factory_kv"))return{value_json:JSON.stringify(store)};throw new Error(sql);},async all(){
    if(sql.includes("official_account_assignments"))return{results:assigned};
    if(sql.includes("official_accounts_latest"))return{results:rows};
    if(sql.includes("factory_publish_records"))return{results:rows.map(r=>({value_json:JSON.stringify({id:r.account_key,connectionId:r.account_key,createdAt:Date.now(),status:"published"})}))};
    if(sql.includes("psychology_publish_items"))return{results:[]};
    if(sql.includes("psychology_peer_hits"))return{results:[]};
    throw new Error(sql);
  }};}};
  const ARCHIVE={async get(key){reads.push(key);return{async json(){return{account_key:"tiktok:a",videos:[{id:"12345678901",createTime:Date.now()-2*DAY,views:400,duration:10}]};}};}};
  return{env:{DB,ARCHIVE},reads,assigned};
}
test("operations API is read-only and requires its existing sidebar permission",async()=>{
  const url=new URL("https://factory.test/api/psychology-operations");
  assert.equal((await handlePsychologyOperations(new Request(url),{},url,{user:{role:"admin",sidebarModules:[]}})).status,403);
  assert.equal((await handlePsychologyOperations(new Request(url,{method:"POST"}),{},url,{})).status,405);
});
test("operations API applies project and assigned-group scope before reading video packs",async()=>{
  const{env,reads}=fixture(),url=new URL("https://factory.test/api/psychology-operations?period=7d&module=novel-promotion");
  const user={role:"operator",sidebarModules:["psychology-ops-report"],allowedAccountGroups:["g1"]};
  const response=await handlePsychologyOperations(new Request(url),env,url,{user});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.deepEqual(body.groups.map(g=>g.id),["g1"]);assert.equal(body.framework.media,"photo");
  assert.equal(reads.length,1);assert.match(reads[0],/tiktok%3Aa/);
  url.searchParams.set("group","g2");
  assert.equal((await handlePsychologyOperations(new Request(url),env,url,{user})).status,403);
});
test("psychology operations has a separate page and overview remains unchanged",()=>{
  assert.equal(pageFileFor("/psychology-ops-report"),"psychology-operations.html");
  assert.equal(pageFileFor("/psychology-effects"),"official-group-report.html");
  assert.equal(pageFileFor("/novel-ops-report"),"official-group-report.html");
});

test("grouped video upload completion waits for an actual remote receipt",()=>{
  const base={batch_id:"b",connection_id:"a",created_at:now,publish_group_id:"g",config_json:JSON.stringify({mediaType:"video"})};
  const r=report({items:[{...base,id:"ready",type:"official-publish",status:"done"},{...base,id:"sent",type:"official-publish",status:"done",receipt_json:JSON.stringify({batchId:"remote"})}]});
  assert.equal(r.funnel.generated,2);assert.equal(r.funnel.submitted,1);
  assert.equal(r.batches[0].items.find(i=>i.id==="ready").state,"generated");
});

test('today is the default Beijing calendar day and compares yesterday across UTC midnight',()=>{
 const time=Date.parse('2026-09-24T17:15:00Z');
 for(const query of ['', 'period=today']){
  const w=operationsWindow(new URLSearchParams(query),time);
  assert.equal(w.period,'today');assert.equal(w.from,'2026-09-25');assert.equal(w.to,'2026-09-25');assert.equal(w.days,1);
  assert.equal(w.start,Date.parse('2026-09-24T16:00:00Z'));assert.equal(w.end-w.start,DAY);
  assert.equal(w.previousFrom,'2026-09-24');assert.equal(w.previousTo,'2026-09-24');
 }
 assert.equal(operationsWindow(new URLSearchParams('period=7d'),time).days,7);
 assert.equal(operationsWindow(new URLSearchParams('period=custom&from=2026-09-22&to=2026-09-23'),time).from,'2026-09-22');
});

test('overview skips heavy content but detail uses the same group permission checks',async()=>{
 const {env}=fixture(),user={role:'operator',sidebarModules:['psychology-ops-report'],allowedAccountGroups:['g1']};
 const call=async query=>{const u=new URL('https://factory.test/api/psychology-operations?'+query);return handlePsychologyOperations(new Request(u),env,u,{user});};
 const summary=await(await call('period=today')).json();assert.equal(summary.window.period,'today');assert.equal(summary.content,null);assert.ok(summary.framework);
 const detail=await(await call('period=today&details=1')).json();assert.ok(Array.isArray(detail.content.rows));assert.equal(detail.framework,undefined);
 assert.equal((await call('period=today&details=1&group=g2')).status,403);
});

test('report UI defaults today, loads details on demand and rejects stale detail responses',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const src=fs.readFileSync(new URL('../public/psychology-operations.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
 const nodes=new Map(),requests=[],rendered=[];let release;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='#period'?'today':'',hidden:true,open:false,textContent:'',innerHTML:'',listeners:{},classList:{toggle(){}},addEventListener(k,f){this.listeners[k]=f;},setAttribute(){},contains(){return false;},focus(){}});return nodes.get(s);};
 const data={groups:[],window:{from:'2026-09-25',to:'2026-09-25',previousFrom:'2026-09-24',previousTo:'2026-09-24'},framework:{},content:null};
 const context=vm.createContext({URL,URLSearchParams,AbortController,location:{search:'',href:'https://factory.test/psychology-ops-report'},history:{replaceState(){}},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},renderContentPerformance:v=>rendered.push(v),fetch:async(url,init)=>{requests.push({url,init});if(url.includes('details=1'))return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({content:{rows:[{id:'old'}]}})});});return {ok:true,json:async()=>data};}});
 vm.runInContext(src+'\nrender=()=>{};',context);await new Promise(r=>setImmediate(r));
 assert.match(requests[0].url,/period=today/);assert.equal(requests.length,1);
 node('#contentDetail').open=true;const detail=node('#contentDetail').listeners.toggle();await new Promise(r=>setImmediate(r));assert.match(requests[1].url,/details=1/);
 node('#period').value='7d';node('#period').listeners.change();await new Promise(r=>setImmediate(r));
 assert.equal(requests[1].init.signal.aborted,true);release();await detail;await new Promise(r=>setImmediate(r));assert.equal(rendered.length,0);
 assert.match(requests[2].url,/period=7d/);
});


test('autopilot same-day report counts all 360 tasks, nine groups and three strategies without an age gate',async()=>{
 const {buildAutopilotReport}=await import('./psychology-autopilot-report.js');
 const list=[],items=[],records=[],videosByAccount=new Map();
 for(let g=1;g<=9;g++)for(let a=0;a<20;a++){
  const account=`g${g}-a${a}`,schema='tiktok:'+account;list.push({schema});const videos=[];
  for(let n=0;n<2;n++){
   const id=`${account}-${n}`,videoId='v'+id;
   items.push({id,batch_id:'b'+g,pilot_id:'p'+g,group_id:'g'+g,group_name:'自动运营'+g,strategy:['evolve','original','rewrite'][Math.floor((g-1)/3)],connection_id:account,schedule_at:(now-3600000)/1000,media_type:'photo',variant_id:n?'rewrite':''});
   records.push({autoTaskId:id,autoBatchId:'b'+g,connectionId:account,videoId,officialRemoteStatus:'PUBLISHED',publishedAt:now-3600000});
   videos.push({id:videoId,createTime:(now-3600000)/1000,views:n?2000:0,likes:0});
  }videosByAccount.set(schema,videos);
 }
 const r=buildAutopilotReport({items:[...items,items[0]],records,accounts:list,videosByAccount,window,now});
 assert.equal(r.summary.planned,360);assert.equal(r.summary.published,360);assert.equal(r.summary.synced,360);assert.equal(r.summary.accounts,180);
 assert.equal(r.summary.views,360000);assert.equal(r.summary.averageViews,1000);assert.equal(r.summary.potentialRate,.5);
 assert.equal(r.groups.length,9);assert.ok(r.groups.every(g=>g.planned===40&&g.published===40));assert.deepEqual(r.strategies.map(s=>s.planned),[120,120,120]);
 assert.equal(r.summary.original,180);assert.equal(r.summary.rewrite,180);
});

test('autopilot joins exact account and task, distinguishes missing metrics from zero, and respects scheduled dates',async()=>{
 const {buildAutopilotReport}=await import('./psychology-autopilot-report.js');
 const base={batch_id:'b',pilot_id:'p',group_id:'g',group_name:'G',strategy:'original',connection_id:'a',schedule_at:now/1000,media_type:'photo'};
 const items=['zero','missing','remote-fail','local-fail','submitted','stopped','wrong-account','wrong-batch','queued'].map(id=>({...base,id}));
 items.find(i=>i.id==='local-fail').execution_status='failed';items.find(i=>i.id==='submitted').execution_status='failed';items.find(i=>i.id==='submitted').receipt_json='{"batchId":"remote"}';items.find(i=>i.id==='stopped').deleted_at=now;
 items.push({...base,id:'tomorrow',schedule_at:window.end/1000},{...base,id:'outside',connection_id:'outside'},{...base,id:'video',media_type:'video'});
 const records=[{autoTaskId:'zero',videoId:'v0',status:'published'},{autoTaskId:'missing',status:'published'},{autoTaskId:'remote-fail',status:'failed'},{autoTaskId:'wrong-account',connectionId:'b',status:'published'},{autoTaskId:'wrong-batch',autoBatchId:'other',status:'published'}];
 const r=buildAutopilotReport({items,records,accounts:[accounts[0]],videosByAccount:new Map([['tiktok:a',[{id:'v0',createTime:now/1000,views:0}]]]),window,now});
 assert.equal(r.summary.planned,9);assert.equal(r.summary.published,2);assert.equal(r.summary.failed,2);assert.equal(r.summary.stopped,1);assert.equal(r.summary.pending,4);
 assert.equal(r.summary.synced,1);assert.equal(r.summary.missingMetrics,1);assert.equal(r.summary.averageViews,0);assert.equal(r.summary.likes,null);
 const empty=buildAutopilotReport({items:[{...base,id:'missing'}],records,accounts,window,now});assert.equal(empty.summary.views,null);assert.equal(empty.summary.potentialRate,null);
});


test('a newly assigned unsynced account does not hide known archive timestamps',async()=>{
 const {env,assigned}=fixture();assigned.push({account_key:'unsynced',group_id:'g1'});
 const url=new URL('https://factory.test/api/psychology-operations');
 const response=await handlePsychologyOperations(new Request(url),env,url,{user:{role:'admin',sidebarModules:['psychology-ops-report']}});
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.ok(body.archiveAt>0);
});
