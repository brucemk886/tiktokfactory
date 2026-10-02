import {fixture as cloudFixture} from '../factory-cloud/src/psychology-cloud-test-fixture.js';
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
async function fixture(t){
 const f=await cloudFixture(t),store=ensureModuleProjects({});
 store.groups=[{id:'g1',name:'Psych',projectId:'proj-psych'},{id:'g2',name:'Other',projectId:'proj-psych'},{id:'g3',name:'Novel',projectId:'proj-novel'}];
 f.sqlite.prepare("UPDATE factory_kv SET value_json=? WHERE key='official-account-groups'").run(JSON.stringify(store));
 for(const [account,group]of [['a','g1'],['b','g2'],['c','g3']]){f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES (?,?)').run(account,group);f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,label,synced_at) VALUES (?,?,?)').run('tiktok:'+account,account,Date.now());}
 const reads=[];f.env.ARCHIVE={async get(k){reads.push(k);throw new Error('Report must not fetch archives');}};return {...f,reads};
}
test("operations API is read-only and requires its existing sidebar permission",async()=>{
  const url=new URL("https://factory.test/api/psychology-operations");
  assert.equal((await handlePsychologyOperations(new Request(url),{},url,{user:{role:"admin",sidebarModules:[]}})).status,403);
  assert.equal((await handlePsychologyOperations(new Request(url,{method:"POST"}),{},url,{})).status,405);
});
test("operations API applies project and assigned-group scope without reading video packs",async t=>{
  const{env,reads}=await fixture(t),url=new URL("https://factory.test/api/psychology-operations?period=7d&module=novel-promotion");
  const user={role:"operator",sidebarModules:["psychology-ops-report"],allowedAccountGroups:["g1"]};
  const response=await handlePsychologyOperations(new Request(url),env,url,{user});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.deepEqual(body.groups.map(g=>g.id),["g1"]);assert.equal(body.framework.media,"photo");
  assert.equal(reads.length,0);
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

test('overview skips heavy content but detail uses the same group permission checks',async t=>{
 const {env}=await fixture(t),user={role:'operator',sidebarModules:['psychology-ops-report'],allowedAccountGroups:['g1']};
 const call=async query=>{const u=new URL('https://factory.test/api/psychology-operations?'+query);return handlePsychologyOperations(new Request(u),env,u,{user});};
 const summary=await(await call('period=today')).json();assert.equal(summary.window.period,'today');assert.equal(summary.content,undefined);assert.ok(summary.framework);
 const detail=await(await call('period=today&details=1')).json();assert.ok(Array.isArray(detail.comparisons));assert.equal(detail.framework,undefined);
 assert.equal((await call('period=today&details=1&group=g2')).status,403);
});

test('report UI retains an explicit today filter, loads details on demand and rejects stale detail responses',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const src=fs.readFileSync(new URL('../public/psychology-operations.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
 const nodes=new Map(),requests=[],rendered=[];let release;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='#period'?'today':'',hidden:true,open:false,textContent:'',innerHTML:'',listeners:{},classList:{toggle(){}},addEventListener(k,f){this.listeners[k]=f;},setAttribute(){},contains(){return false;},focus(){}});return nodes.get(s);};
 const data={groups:[],window:{from:'2026-09-25',to:'2026-09-25',previousFrom:'2026-09-24',previousTo:'2026-09-24'},framework:{},content:null,progress:{ready:true,pending:0}};
 const context=vm.createContext({URL,URLSearchParams,AbortController,location:{search:'?period=today',href:'https://factory.test/psychology-ops-report?period=today'},history:{replaceState(){}},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},renderContentPerformance:v=>rendered.push(v),fetch:async(url,init)=>{requests.push({url,init});if(url.includes('panel=details'))return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({content:{rows:[{id:'old'}]}})});});return {ok:true,json:async()=>data};}});
 vm.runInContext(src+'\nrender=()=>{};',context);await new Promise(r=>setImmediate(r));
 assert.match(requests[0].url,/period=today/);assert.equal(requests.length,1);
 node('#contentDetail').open=true;const detail=node('#contentDetail').listeners.toggle();await new Promise(r=>setImmediate(r));assert.match(requests[1].url,/panel=details/);
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
 assert.equal(r.groups.length,9);assert.ok(r.groups.every(g=>g.planned===40&&g.published===40));assert.deepEqual(Object.fromEntries(r.strategies.map(s=>[s.id,s.planned])),{pools:0,evolve:120,original:120,rewrite:120});
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


test('a newly assigned unsynced account does not hide known archive timestamps',async t=>{
 const {env,sqlite}=await fixture(t);sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('unsynced','g1')").run();
 const url=new URL('https://factory.test/api/psychology-operations');
 const response=await handlePsychologyOperations(new Request(url),env,url,{user:{role:'admin',sidebarModules:['psychology-ops-report']}});
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.ok(body.archiveAt>0);
});


function poolBrowser(fetchPool,{search='?period=7d&group=g1'}={}){
 const fs=globalThis.process.getBuiltinModule('fs'),vm=globalThis.process.getBuiltinModule('vm');
 const src=fs.readFileSync(new URL('../public/psychology-operations.js',import.meta.url),'utf8');
 const nodes=new Map(),requests=[],urls=[];
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='#period'?'7d':'',hidden:false,open:false,textContent:'',innerHTML:'',dataset:{},listeners:{},attributes:{},classList:{toggle(){}},addEventListener(k,f){this.listeners[k]=f;},setAttribute(k,v){this.attributes[k]=v;},querySelector:q=>node(s+' '+q),querySelectorAll:()=>[],contains(target){return target?.container===this;},focus(options){this.focused=true;this.focusOptions=options;},scrollIntoView(options){this.scrollOptions=options;}});return nodes.get(s);};
 const tabs=['overview','accounts','content','strategy'].map(id=>{const button=node('[data-tab="'+id+'"]');button.dataset.tab=id;return button;});
 const data={groups:[{id:'g1',name:'G1'}],window:{from:'2026-09-24',to:'2026-09-30',previousFrom:'2026-09-17',previousTo:'2026-09-23'},framework:{},progress:{ready:true}};
 const location={search,href:'https://factory.test/psychology-ops-report'+search};
 const context=vm.createContext({URL,URLSearchParams,AbortController,location,history:{replaceState(_state,_title,url){const next=new URL(url,location.href);location.href=next.href;location.search=next.search;urls.push(next);}},document:{querySelector:node,querySelectorAll:s=>s==='[data-tab]'?tabs:[],addEventListener(){}},fetch:async(url,init)=>{const q=new URL(url,'https://factory.test').searchParams;requests.push({url,q,init});return q.get('panel')==='pools'?fetchPool(q,init):{ok:true,json:async()=>data};}});
 vm.runInContext(src+'\nrender=()=>{};',context);
 return {node,requests,tabs,urls,run:code=>vm.runInContext(code,context),clickPool(id,{nested=false,inside=true}={}){const card={dataset:{accountPool:id},container:inside?node('#poolSummary'):null,closest:s=>s==='[data-account-pool]'?card:null};return node('#poolSummary').listeners.click({target:nested?{closest:s=>card.closest(s)}:card});}};
}
const poolTick=()=>new Promise(r=>setImmediate(r));
const poolMatching=()=>({
 accountPools:[{id:'strong',label:'强号池',action:'保持产出',accounts:1,quota:{winner:12,optimize:1,explore:1,total:14}},{id:'rescue-hook',label:'低号救援 · 首图',action:'测试首图',accounts:1,quota:{winner:11,optimize:3,explore:0,total:14}}],
 contentPools:[{id:'winner',label:'优胜池',action:'基准',versions:1}],coverage:{published:3,synced:2,missingMetrics:1,matureSynced:1,observingAccounts:0,unknownVersions:0,unknownStyles:0},
 overview:{current:{n:2,views:1000,medianViews:500,potentialRate:0,completion:null},mature:{n:1,views:0,medianViews:0,potentialRate:0,completion:0}},recovery:{improved:0,declined:0,stable:0,comparable:0,insufficient:2},matrix:{rows:[]}
});
test('pool summary distinguishes fresh cumulative observations, mature zero metrics and missing metrics',async()=>{
 const m={...poolMatching(),readiness:{status:'warming',winnerVersions:0,readyVersions:1,nextStep:'<固定样式补测>'}},h=poolBrowser(async()=>({ok:true,json:async()=>({matching:m})}));await poolTick();await h.run("loadPools('summary')");
 const html=h.node('#poolSummary').innerHTML;assert.match(html,/已同步累计（含新发布）/);assert.match(html,/已满72h可评估/);assert.match(html,/1,000/);assert.match(html,/>0</);assert.match(html,/—/);assert.match(html,/待同步 1/);assert.match(html,/优胜版本补测中/);assert.match(html,/&lt;固定样式补测&gt;/);assert.doesNotMatch(html,/<固定样式补测>/);
 assert.match(h.node('#poolMatrix').innerHTML,/暂无满72小时/);assert.match(h.node('#poolAllocation').innerHTML,/尚无账号池匹配的新排期/);assert.doesNotMatch(h.node('#poolPolicy').innerHTML,/total/);
 assert.equal(h.requests.at(-1).q.get('group'),'g1');assert.equal(h.requests.at(-1).q.get('media'),'photo');assert.equal(h.requests.at(-1).q.get('period'),'7d');
});
test('pool account pagination keeps scope and filters, exposes missing values and escapes user content',async()=>{
 const m=poolMatching(),h=poolBrowser(async q=>({ok:true,json:async()=>({matching:{...m,accounts:{page:Number(q.get('page')),pages:2,total:12,rows:[{name:'<unsafe>',group:'G1',pool:'rescue-hook',previousPool:'strong',comparable:true,improved:false,stats:{n:6,medianViews:100,avgViews:200,completion:null},previousStats:{medianViews:700},medianDelta:-600,recommendation:'<check>'}]}}})}));await poolTick();
 h.node('#poolAccountFilter').value='rescue-hook';const next={dataset:{poolStep:'1'}},prev={dataset:{poolStep:'-1'}};
 h.node('#poolAccountPager').querySelectorAll=s=>s==='[data-pool-step]'?[prev,next]:[];
 await h.run("loadPools('accounts')");assert.match(h.node('#poolAccountTable').innerHTML,/&lt;unsafe&gt;|&lt;check&gt;/);assert.doesNotMatch(h.node('#poolAccountTable').innerHTML,/<unsafe>|<check>/);assert.match(h.node('#poolAccountTable').innerHTML,/流量下滑/);assert.match(h.node('#poolAccountTable').innerHTML,/—/);
 assert.match(h.node('#poolAccountPager').innerHTML,/aria-label="下一页"/);await next.onclick();const q=h.requests.at(-1).q;assert.equal(q.get('page'),'2');assert.equal(q.get('accountPool'),'rescue-hook');assert.equal(q.get('group'),'g1');assert.equal(q.get('media'),'photo');
});
test('pool read failures stay isolated and obsolete same-panel responses cannot overwrite new results',async()=>{
 let release,phase=0;const m=poolMatching(),h=poolBrowser(async()=>{phase++;if(phase===1)return new Promise(r=>{release=r;});if(phase===2)return {ok:true,json:async()=>({matching:{...m,accounts:{page:1,pages:1,total:0,rows:[]}}})};return {ok:false,json:async()=>({error:'<offline>'})};});await poolTick();
 const old=h.run("loadPools('accounts')");await poolTick();await h.run("loadPools('accounts')");const html=h.node('#poolAccountTable').innerHTML;assert.match(html,/没有符合条件/);assert.equal(h.requests[1].init.signal.aborted,true);
 release({ok:true,json:async()=>({matching:{...m,accounts:{page:1,pages:1,total:1,rows:[{name:'old',stats:{}}]}}})});await old;assert.equal(h.node('#poolAccountTable').innerHTML,html);
 h.node('#autopilotMetrics').innerHTML='execution survives';await h.run("loadPools('accounts')");assert.match(h.node('#poolAccountTable').innerHTML,/role="alert".*&lt;offline&gt;/);assert.equal(h.node('#autopilotMetrics').innerHTML,'execution survives');assert.equal(h.node('#poolAccountTable').attributes['aria-busy'],'false');
});
test('content pool rendering separates original from unknown identities and retains version/style details',async()=>{
 const m=poolMatching(),h=poolBrowser(async()=>({ok:true,json:async()=>({matching:{...m,content:{page:1,pages:1,total:2,rows:[{source:'a',title:'<title>',version:'',versionKnown:true,style:'paper',styleKnown:true,styleRevision:2,copyHash:'abcdef12',pool:'winner',accounts:5,stats:{n:5,medianViews:600},cumulativeStats:{n:7}},{source:'b',title:'unknown',version:'',versionKnown:false,style:'',styleKnown:false,pool:'winner',accounts:0,stats:{n:0}}]}}})}));await poolTick();await h.run("loadPools('content')");const html=h.node('#poolContentTable').innerHTML;
 assert.match(html,/原版 · paper · 样式第 2 版/);assert.match(html,/版本身份未知 · 样式未知/);assert.match(html,/&lt;title&gt;/);assert.doesNotMatch(html,/abcdef12/);assert.match(h.node('#poolContentPager').innerHTML,/共 2 条/);
});

test('actual allocation displays frozen decisions and execution counts separately from retrospective metrics',async()=>{
 const m={...poolMatching(),allocation:{total:3,basis:'排期时冻结的分池',rows:[{accountPool:'strong',contentPool:'winner',planned:3,published:1,pending:1,failed:1,stopped:0,synced:0,views:null,medianViews:null,warmup:2}]}};
 const h=poolBrowser(async()=>({ok:true,json:async()=>({matching:m})}));await poolTick();await h.run("loadPools('summary')");
 const html=h.node('#poolAllocation').innerHTML;assert.match(html,/排期时账号池/);assert.match(html,/3 \/ 1/);assert.match(html,/— \/ —/);assert.match(html,/基线补测/);assert.match(html,/排期时冻结的分池/);assert.doesNotMatch(h.node('#poolMatrix').innerHTML,/3 \/ 1/);
});


test('account pool cards are native controls that open scoped page-one accounts including empty pools',async()=>{
 const m=poolMatching();m.accountPools[0].accounts=0;
 const h=poolBrowser(async q=>({ok:true,json:async()=>({matching:{...m,...(q.get('mode')==='accounts'?{accounts:{page:Number(q.get('page')),pages:q.get('accountPool')==='strong'?1:3,total:q.get('accountPool')==='strong'?0:21,rows:[]}}:{})}})}),{search:'?period=custom&from=2026-09-24&to=2026-09-30&group=g1&media=video'});
 await poolTick();await h.run("loadPools('summary')");
 const html=h.node('#poolSummary').innerHTML,buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(b=>/data-account-pool=/.test(b[1]));
 assert.equal(buttons.length,m.accountPools.length);
 for(const [i,button]of buttons.entries()){
  assert.match(button[1],/type="button"/);assert.match(button[1],/aria-controls="accounts"/);assert.match(button[1],new RegExp('data-account-pool="'+m.accountPools[i].id+'"'));
  assert.match(button[1],new RegExp('aria-label="查看'+m.accountPools[i].label+'的'+m.accountPools[i].accounts+'个账号"'));assert.doesNotMatch(button[1],/disabled|tabindex="-1"/);
 }
 assert.match(html,/<article class="ops-pool-card"><span>优胜池<\/span>/);
 h.node('#poolAccountFilter').value='rescue-hook';await h.run("loadPools('accounts',3)");
 const before=h.requests.length;await h.clickPool('missing');await h.clickPool('strong',{inside:false});assert.equal(h.requests.length,before);
 await h.clickPool('strong',{nested:true});await poolTick();
 const q=h.requests.at(-1).q;
 assert.equal(q.get('panel'),'pools');assert.equal(q.get('mode'),'accounts');assert.equal(q.get('accountPool'),'strong');assert.equal(q.get('page'),'1');
 for(const [key,value]of Object.entries({period:'custom',from:'2026-09-24',to:'2026-09-30',group:'g1',media:'video'}))assert.equal(q.get(key),value);
 assert.equal(h.node('#poolAccountFilter').value,'strong');assert.match(h.node('#poolAccountTable').innerHTML,/没有符合条件的账号/);
 for(const tab of h.tabs){const active=tab.dataset.tab==='accounts';assert.equal(tab.attributes['aria-selected'],String(active));assert.equal(tab.tabIndex,active?0:-1);assert.equal(h.node('#'+tab.dataset.tab).hidden,!active);}
 assert.equal(h.urls.at(-1).searchParams.get('tab'),'accounts');assert.equal(h.urls.at(-1).searchParams.get('group'),'g1');assert.equal(h.urls.at(-1).searchParams.get('media'),'video');
 assert.equal(h.node('#accounts').scrollOptions?.block,'start');assert.equal(h.node('#poolAccountFilter').focused,true);assert.equal(h.node('#poolAccountFilter').focusOptions?.preventScroll,true);
});

test('successive pool-card clicks reject stale accounts and retain the tab selected while they load',async()=>{
 const m=poolMatching();let release;
 const response=name=>({ok:true,json:async()=>({matching:{...m,accounts:{page:1,pages:1,total:1,rows:[{name,group:'G1',pool:name==='current'?'rescue-hook':'strong',stats:{}}]}}})});
 const h=poolBrowser(async q=>q.get('mode')!=='accounts'?{ok:true,json:async()=>({matching:m})}:q.get('accountPool')==='strong'?new Promise(resolve=>{release=resolve;}):response('current'));
 await poolTick();await h.run("loadPools('summary')");
 const old=h.clickPool('strong');await poolTick();const oldRequest=h.requests.at(-1);assert.equal(oldRequest.q.get('accountPool'),'strong');
 h.tabs.find(tab=>tab.dataset.tab==='overview').listeners.click();assert.equal(h.node('#overview').hidden,false);
 await h.clickPool('rescue-hook');await poolTick();
 assert.equal(oldRequest.init.signal.aborted,true);assert.equal(h.requests.at(-1).q.get('accountPool'),'rescue-hook');assert.equal(h.requests.at(-1).q.get('page'),'1');
 const html=h.node('#poolAccountTable').innerHTML;assert.match(html,/@current/);assert.equal(h.node('#poolAccountFilter').value,'rescue-hook');assert.equal(h.node('#accounts').hidden,false);
 h.tabs.find(tab=>tab.dataset.tab==='content').listeners.click();await poolTick();
 release(response('obsolete'));await old;await poolTick();
 assert.equal(h.node('#poolAccountTable').innerHTML,html);assert.doesNotMatch(h.node('#poolAccountTable').innerHTML,/obsolete/);assert.equal(h.node('#poolAccountTable').attributes['aria-busy'],'false');
 assert.equal(h.node('#poolAccountFilter').value,'rescue-hook');assert.equal(h.node('#content').hidden,false);assert.equal(h.node('#accounts').hidden,true);assert.equal(h.urls.at(-1).searchParams.get('tab'),'content');
});

// Dashboard presentation uses full server aggregates and scoped lazy reads.
test('compact report KPIs keep global current totals, previous values and the zero/missing distinction',async()=>{
 const h=poolBrowser(async()=>({ok:true,json:async()=>({matching:poolMatching()})}));await poolTick();
 h.run("renderReportMetrics({overview:{current:{n:301,views:24000,medianViews:0,avgViews:0,potentialRate:0,completion:null},previous:{n:250,views:12000,medianViews:null,potentialRate:null,completion:0},observing:2}})");
 const html=h.node('#reportKpis').innerHTML;
 assert.equal((html.match(/class="ops-report-kpi(?: ops-report-kpi-primary)?"/g)||[]).length,5);
 assert.match(html,/ops-report-kpi-primary[\s\S]*?累计播放量<\/span><strong>24,000<\/strong>/);assert.match(html,/上期 12,000 · \+12,000（\+100\.0%）/);assert.ok(html.indexOf("累计播放量")<html.indexOf("已同步作品"));
 assert.match(html,/已同步作品<\/span><strong>301<\/strong>/);assert.match(html,/上期 250 · 待同步 2 条/);
 assert.match(html,/中位播放<\/span><strong>0<\/strong>/);assert.match(html,/上期 — · 当前累计 · 平均 0/);
 assert.match(html,/破千率<\/span><strong>0\.0%<\/strong>/);assert.match(html,/完播率<\/span><strong>—<\/strong>/);assert.match(html,/上期 0\.0%/);
 assert.equal(h.requests.length,1,'rendering aggregate cards must not fetch details or sum page rows');
});

test('paired pool overview shortcuts open only the selected lazy panel while retaining date, media and group scope',async()=>{
 const m=poolMatching(),h=poolBrowser(async q=>({ok:true,json:async()=>({matching:{...m,...(q.get('mode')==='content'?{content:{page:1,pages:1,total:0,rows:[]}}:{})}})}),{search:'?period=custom&from=2026-09-24&to=2026-09-30&group=g1&media=video'});
 await poolTick();await h.run("loadPools('summary')");const before=h.requests.length,html=h.node('#poolSummary').innerHTML;
 assert.match(html,/class="ops-report-pools"/);assert.match(html,/data-pool-view="accounts"/);assert.match(html,/data-pool-view="content"/);assert.match(html,/历史表现分层/);assert.match(html,/不能代替当前可用库存资格/);
 const view={dataset:{poolView:'content'},container:h.node('#poolSummary'),closest:s=>s==='[data-pool-view]'?view:null};
 h.node('#poolSummary').listeners.click({target:view});await poolTick();
 assert.equal(h.requests.length,before+1);const q=h.requests.at(-1).q;
 assert.equal(q.get('mode'),'content');assert.equal(q.get('page'),'1');
 for(const [key,value]of Object.entries({period:'custom',from:'2026-09-24',to:'2026-09-30',group:'g1',media:'video'}))assert.equal(q.get(key),value);
 assert.equal(h.node('#content').hidden,false);assert.equal(h.node('#overview').hidden,true);assert.match(h.node('#poolContentTable').innerHTML,/没有已观察内容版本/);
});

test('responsive trend leaves a gap for missing values, renders real zero and escapes dates outside the SVG',async()=>{
 const h=poolBrowser(async()=>({ok:true,json:async()=>({matching:poolMatching()})}));await poolTick();h.node('#trendMetric').value='potentialRate';h.node('#trendMetric').selectedOptions=[{text:'破千率'}];
 h.run("state.data.framework={overview:{daily:[{date:'2026-09-24',potentialRate:0},{date:'2026-09-25',potentialRate:null},{date:'2026-09-26',potentialRate:.25},{date:'2026-09-27<unsafe>',potentialRate:.5}]}};renderTrend()");
 const html=h.node('#trendChart').innerHTML;
 assert.equal((html.match(/class="line"/g)||[]).length,1);assert.equal((html.match(/<circle /g)||[]).length,3);
 assert.match(html,/class="ops-trend-axis"/);assert.match(html,/0\.0%/);assert.match(html,/class="ops-trend-days"/);assert.doesNotMatch(html,/<text\b/);assert.match(html,/09-27&lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>/);
 h.run("state.data.framework.overview.daily=[{date:'2026-09-24',potentialRate:null}];renderTrend()");assert.match(h.node('#trendChart').innerHTML,/暂无已同步播放/);assert.doesNotMatch(h.node('#trendChart').innerHTML,/<circle/);
 h.run("state.data.framework.overview.daily=[{date:'2026-09-24',potentialRate:0}];renderTrend()");assert.match(h.node('#trendChart').innerHTML,/cx="500"/);assert.match(h.node('#trendChart').innerHTML,/0\.0%/);
});

test('report promotes the current cumulative trend and keeps the presentation isolated from automatic operations',()=>{
 const fs=globalThis.process.getBuiltinModule('fs'),html=fs.readFileSync(new URL('../public/psychology-operations.html',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../public/psychology-operations.css',import.meta.url),'utf8'),js=fs.readFileSync(new URL('../public/psychology-operations.js',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'query and lazy-panel IDs remain unique');
 assert.ok(html.indexOf('id="trendChart"')<html.indexOf('id="poolSummary"'));assert.ok(html.indexOf('id="trendChart"')<html.indexOf('id="legacyOverviewDetails"'));
 assert.match(html,/按北京时间实际发布日分组，含新发布作品/);assert.match(html,/不是每日新增流量/);assert.match(html,/排期时冻结的账号池与内容池/);assert.match(html,/历史关联 · 非真实决策/);
 assert.doesNotMatch(html+css+js,/演示数据|设计预览|ops-preview-|demoRates|previousRows|合成样本/);
 const scoped=css.split('/* Report presentation is scoped: automatic operations also imports this file. */')[1];assert.ok(scoped);
 for(const rule of scoped.matchAll(/([^{}]+)\{/g)){const selector=rule[1].replace(/\/\*[\s\S]*?\*\//g,'').trim();if(selector.startsWith('@media'))continue;assert.ok(selector.replace(/:is\([^)]*\)/g,'').split(',').every(s=>s.trim().startsWith('.ops-report-page')),selector);}
});

test('cumulative views keep zero distinct from unavailable totals and avoid growth percentages over a zero baseline',async()=>{
 const h=poolBrowser(async()=>({ok:true,json:async()=>({matching:poolMatching()})}));await poolTick();
 const render=(current,previous)=>h.run(`renderReportMetrics({overview:{current:{n:0,views:${current}},previous:{n:0,views:${previous}},observing:3}})`);
 render(0,'null');assert.match(h.node('#reportKpis').innerHTML,/累计播放量<\/span><strong>0<\/strong>/);assert.match(h.node('#reportKpis').innerHTML,/上期 — · 变化 —/);
 render('null',0);assert.match(h.node('#reportKpis').innerHTML,/累计播放量<\/span><strong>—<\/strong>/);assert.match(h.node('#reportKpis').innerHTML,/上期 0 · 变化 —/);
 render(15,0);assert.match(h.node('#reportKpis').innerHTML,/上期 0 · \+15 ·/);assert.doesNotMatch(h.node('#reportKpis').innerHTML,/Infinity|NaN/);
});

test('cumulative playback is the default publication-cohort trend and daily totals retain missing gaps and real zeros',async()=>{
 const fs=globalThis.process.getBuiltinModule('fs'),html=fs.readFileSync(new URL('../public/psychology-operations.html',import.meta.url),'utf8');
 assert.match(html,/<select id="trendMetric"><option value="views">累计播放量<\/option>/);assert.match(html,/不是所选日期内新增播放/);
 const h=poolBrowser(async()=>({ok:true,json:async()=>({matching:poolMatching()})}));await poolTick();
 h.node('#trendMetric').value='views';h.node('#trendMetric').selectedOptions=[{text:'累计播放量'}];
 h.run("state.data.framework={overview:{daily:[{date:'2026-09-24',views:1200},{date:'2026-09-25',views:null},{date:'2026-09-26',views:0},{date:'2026-09-27',views:300}]}};renderTrend()");
 const chart=h.node('#trendChart').innerHTML;assert.match(chart,/累计播放量趋势/);assert.match(chart,/2026-09-24：1,200/);assert.match(chart,/2026-09-26：0/);assert.equal((chart.match(/<circle /g)||[]).length,3);assert.equal((chart.match(/class="line"/g)||[]).length,1);
 const cells=JSON.parse(h.run('JSON.stringify(summaryCells({n:2,views:1234,medianViews:7,avgViews:999}))'));assert.equal(cells[1],'1,234');assert.match(h.run('summaryHeaders().join("|")'),/作品数\|累计播放量\|中位播放/);
});

test('account and content pool playback show exact mature sums separately from all synchronized content observations',async()=>{
 const h=poolBrowser(async()=>({ok:true,json:async()=>({matching:poolMatching()})}));await poolTick();
 h.run("renderPoolAccounts({accounts:{page:1,pages:1,total:1,rows:[{name:'account',pool:'strong',previousPool:'strong',stats:{n:2,views:1234,avgViews:9999,medianViews:7},previousStats:{medianViews:7}}]}})");
 const accounts=h.node('#poolAccountTable').innerHTML;assert.match(accounts,/成熟样本累计播放量/);assert.match(accounts,/<td>1,234<\/td>/);assert.doesNotMatch(accounts,/>19,998</);
 h.run("renderPoolContent({content:{page:1,pages:1,total:2,rows:[{title:'fresh',pool:'explore',accounts:0,stats:{n:0,views:null},cumulativeStats:{n:2,views:4321}},{title:'zero',pool:'explore',accounts:1,stats:{n:1,views:0},cumulativeStats:{n:1,views:0}}]}})");
 const content=h.node('#poolContentTable').innerHTML;assert.match(content,/已同步累计播放量/);assert.match(content,/成熟样本累计播放量/);assert.match(content,/<td>4,321<\/td><td>0<\/td><td>—<\/td>/);assert.match(content,/<td>0<\/td><td>1<\/td><td>0<\/td>/);
});
