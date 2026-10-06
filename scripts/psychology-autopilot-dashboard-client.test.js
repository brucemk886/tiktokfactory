import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const clientSource = fs.readFileSync(new URL('../public/psychology-autopilot-dashboard.js', import.meta.url), 'utf8');
const anchor = Date.parse('2026-10-01T07:00:00Z');
class DashboardDate extends Date { static now() { return anchor; } }
const accountRow = () => ({account:'account/A & B',name:'心理学 <img src=x onerror=alert(1)>',pool:'rescue-content',trafficTier:'weak',traffic:{published:5,synced:5,views:0,medianViews:null},followers:1000,conversionCandidate:true,profileTraffic:{views:0,days:1},currentRole:'normal',futureRole:'review',effectiveAt:anchor+86400000,eligibleAt:anchor,stats:{n:0,medianViews:null,potentialRate:null,completion:0}});
const contentRow = () => ({source:'source/A & B',variant:'version/?2',style:'style/<A>',copyHash:'copy + & /',styleRevision:3,title:'边界感 <script>bad()</script>',pool:'explore',published:5,distinctAccounts:3,reserved:null,waiting:0,missingMetrics:0,stats:{n:3,medianViews:null,completion:0},reason:'不足5个不同账号 <unsafe>'});
function fixture(view='overview',overrides={}) {
 return {
  asOf:anchor,timeZone:'America/Los_Angeles',operatingDate:'2026-10-01',
  summary:{projectAccounts:188,today:{published:0,planned:350},mature:{n:1048},winnerVersions:0,eligibleWinnerVersions:0},
  trafficSummary:{published:350,synced:200,views:0,conversionCandidates:15,followersKnown:30,profileViews:null,profileCoveredAccounts:0},
  trafficPolicy:{from:'2026-09-25',to:'2026-10-01',strongViews:500,normalViews:200,minimumSamples:5,profileFrom:'2026-09-25',profileTo:'2026-10-01'},
  trafficTiers:[{id:'strong',accounts:8},{id:'normal',accounts:108},{id:'weak',accounts:34},{id:'observing',accounts:38}],
  accountPools:[{id:'strong',accounts:8},{id:'normal',accounts:108},{id:'rescue-content',accounts:34},{id:'observing',accounts:38}],
  contentPools:[{id:'winner',versions:0},{id:'explore',versions:128},{id:'revise',versions:4}],
  contentProgress:{reserved:null,waiting:0,missingMetrics:0,mature:3},
  trend:[{date:'2026-09-24',n:1,medianViews:0,potentialRate:0},{date:'2026-09-25',n:0,medianViews:null,potentialRate:null},{date:'2026-09-26',n:5,medianViews:283,potentialRate:.04}],
  details:{rows:view==='accounts'?[accountRow()]:view==='content'?[contentRow()]:[],total:view==='overview'?0:31,page:1,pages:4},
  ...overrides
 };
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function harness(route) {
 const nodes=new Map(),requests=[],intervals=[];
 let context;
 const document={hidden:false,activeElement:null};
 function node(selector) {
  if(!nodes.has(selector)) {
   const entry={selector,innerHTML:'',textContent:'',value:'',dataset:{},attrs:{},listeners:{},open:false,tabIndex:0,
    setAttribute(name,value){this.attrs[name]=String(value);},
    getAttribute(name){return this.attrs[name]??null;},
    hasAttribute(name){return Object.hasOwn(this.attrs,name);},
    addEventListener(name,fn){this.listeners[name]=fn;},
    querySelector(selector){return selector==='input'?node('#dashSearchInput'):null;},
    showModal(){this.open=true;},close(){this.open=false;},
    focus(){document.activeElement=this;},
    closest(selector){if(selector==='[role="tab"]'&&this.dataset.dashView)return this;if(selector==='#dashSearch'&&this.selector==='#dashSearchInput')return node('#dashSearch');return null;}
   };
   if(selector.startsWith('#dash-tab-'))entry.dataset.dashView=selector.slice('#dash-tab-'.length);
   nodes.set(selector,entry);
  }
  return nodes.get(selector);
 }
 document.querySelector=selector=>{
  if(selector==='dialog[open]')return node('#dashDialog').open?node('#dashDialog'):null;
  if(selector==='#dashSearch')return node('#dashBody').innerHTML.includes('id="dashSearch"')?node(selector):null;
  return node(selector);
 };
 document.querySelectorAll=selector=>selector==='[data-dash-view][role="tab"]'?['overview','accounts','content'].map(id=>node('#dash-tab-'+id)):[];
 const injectionAt=clientSource.lastIndexOf('\n void load();');
 assert.ok(injectionAt>=0,'client boot call exists for test-only closure capture');
 const instrumented=clientSource.slice(0,injectionAt)+'\n globalThis.dashboardTest={state,load,select,show,paint,paramsFor};'+clientSource.slice(injectionAt);
 context=vm.createContext({document,URL,URLSearchParams,AbortController,Date:DashboardDate,setInterval(fn){intervals.push(fn);},fetch:async(path,init)=>{
  const request={path,init,params:new URL(path,'https://factory.test').searchParams};
  requests.push(request);
  const body=route?await route(request,requests.length):fixture(request.params.get('view')||'overview');
  if(body?.response)return body.response;
  return {ok:true,json:async()=>body};
 }});
 vm.runInContext(instrumented,context);
 function click(dataset,scope='#poolDashboard',attrs={}) {
  const button={dataset,hasAttribute:name=>Object.hasOwn(attrs,name)};
  return node(scope).listeners.click({target:{closest:()=>button}});
 }
 function key(key,view='overview') {
  let prevented=false;
  node('#poolDashboard').listeners.keydown({key,target:node('#dash-tab-'+view),preventDefault(){prevented=true;}});
  return prevented;
 }
 return {node,document,requests,click,key,interval:()=>intervals[0](),api:context.dashboardTest,run:code=>vm.runInContext(code,context)};
}

test('dashboard boot and refresh use authenticated read-only local requests, preserving zero and missing evidence',async()=>{
 const h=harness();await tick();
 assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].init.method,'GET');
 assert.equal(h.requests[0].init.credentials,'same-origin');
 assert.equal(h.requests[0].init.cache,'no-store');
 assert.match(h.requests[0].path,/^\/api\/psychology-autopilot\/dashboard\?/);
 assert.equal(h.node('#poolDashboard').getAttribute('aria-busy'),'false');
 const body=h.node('#dashBody').innerHTML;
 assert.match(body,/近7天总播放<\/span><strong[^>]*>0<\/strong>/);
 assert.match(body,/千粉承接候选<\/span><strong[^>]*>15<\/strong>/);
 assert.match(body,/主页访问 —/);
 assert.match(body,/无72小时|不等满72小时/);
 assert.doesNotMatch(body,/首图救援池|内页救援池|起号 \/ 救援/);
 assert.match(h.node('#dashFreshness').textContent,/近7个美西发布日.*无72小时门槛/);
 h.node('#reload').listeners.click();await tick();
 assert.equal(h.requests.length,2);
 assert.ok(h.requests.every(r=>r.init.method==='GET'));
 assert.ok(h.requests.every(r=>!r.path.includes('/publish')&&!r.path.includes('refreshGroups')));
});

test('list rendering escapes server-controlled fields while null metrics remain distinct from measured zeros',async()=>{
 const h=harness();await tick();h.click({dashView:'accounts'});await tick();
 const body=h.node('#dashBody').innerHTML;
 assert.match(body,/心理学 &lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(body,/<img src=x/);
 assert.match(body,/<td>0<\/td><td>—<\/td><td>5<small>有播放数据 5/);
 assert.match(body,/可承接转化/);assert.match(body,/主页访问/);
 assert.doesNotMatch(body,/中号产出|内容评审|首图救援|内页救援/);
 h.click({dashView:'content'});await tick();
 assert.match(h.node('#dashBody').innerHTML,/边界感 &lt;script&gt;bad\(\)&lt;\/script&gt;/);
 assert.match(h.node('#dashBody').innerHTML,/style\/&lt;A&gt;/);
 assert.match(h.node('#dashBody').innerHTML,/不足5个不同账号 &lt;unsafe&gt;/);
 assert.doesNotMatch(h.node('#dashBody').innerHTML,/<script>|<unsafe>/);
 assert.match(h.node('#dashBody').innerHTML,/<td>0 \/ 0<\/td><td>—<\/td>/);
});

test('delegated pool, page, search and tab actions issue complete filters and retain each pool view state',async()=>{
 const h=harness();await tick();
 h.api.state.q.accounts='old';h.api.state.page.accounts=4;
 h.click({dashView:'accounts',dashPool:'weak'});await tick();
 let p=h.requests.at(-1).params;
 assert.equal(p.get('view'),'accounts');assert.equal(p.get('trafficTier'),'weak');
 assert.equal(p.get('page'),'1');assert.equal(p.has('q'),false);
 h.click({dashPage:'1'});await tick();assert.equal(h.requests.at(-1).params.get('page'),'2');
 h.node('#dashSearchInput').value='  A & B / 新号  ';
 let prevented=false;
 h.node('#dashSearch').listeners.submit({preventDefault(){prevented=true;}});await tick();
 assert.ok(prevented);p=h.requests.at(-1).params;
 assert.equal(p.get('q'),'A & B / 新号');assert.equal(p.get('page'),'1');assert.equal(p.get('trafficTier'),'weak');
 h.click({dashView:'content',dashPool:'explore'});await tick();
 assert.equal(h.requests.at(-1).params.get('contentPool'),'explore');
 assert.equal(h.requests.at(-1).params.has('trafficTier'),false);
 h.click({dashView:'accounts'});await tick();
 p=h.requests.at(-1).params;assert.equal(p.get('q'),'A & B / 新号');assert.equal(p.get('trafficTier'),'weak');
 h.click({dashView:'accounts',dashPool:''});await tick();
 assert.equal(h.requests.at(-1).params.has('q'),false);assert.equal(h.requests.at(-1).params.has('trafficTier'),false);
 h.click({dashPage:'-1'});await tick();assert.equal(h.requests.at(-1).params.get('page'),'1');
});

test('stale list responses are aborted and discarded; a later read failure retains the visible snapshot',async()=>{
 const old=deferred(),fresh=deferred();let fail=false;
 const h=harness((r,n)=>{if(fail)throw Error('offline <unsafe>');if(n===2)return old.promise;if(n===3)return fresh.promise;return fixture();});
 await tick();
 h.click({dashView:'accounts'});await tick();
 h.click({dashView:'content'});await tick();
 assert.equal(h.requests[1].init.signal.aborted,true);
 assert.equal(h.node('#poolDashboard').getAttribute('aria-busy'),'true');
 fresh.resolve(fixture('content'));await tick();const good=h.node('#dashBody').innerHTML,stamp=h.node('#dashFreshness').textContent;
 old.resolve(fixture('accounts'));await tick();
 assert.equal(h.node('#dashBody').innerHTML,good);assert.equal(h.api.state.view,'content');
 assert.equal(h.node('#dash-tab-content').getAttribute('aria-selected'),'true');
 assert.equal(h.node('#dash-tab-accounts').getAttribute('aria-selected'),'false');
 assert.equal(h.node('#poolDashboard').getAttribute('aria-busy'),'false');
 fail=true;await h.api.load();
 assert.equal(h.node('#dashBody').innerHTML,good);assert.equal(h.node('#dashFreshness').textContent,stamp);
 assert.match(h.node('#dashStatus').textContent,/保留上次数据.*offline <unsafe>/);
 assert.equal(h.api.state.busy,false);
 assert.equal(h.node('#poolDashboard').getAttribute('aria-busy'),'false');
});

test('content evidence requests exact text/style revisions and linked buttons navigate to the corresponding account and version',async()=>{
 const row=contentRow(),account=accountRow();
 const h=harness(r=>{
  const view=r.params.get('view')||'overview';
  if(view==='content'&&r.params.has('source'))return fixture('content',{linkedAccounts:[account]});
  if(view==='accounts'&&r.params.has('account'))return fixture('accounts',{matchedVersions:[row]});
  return fixture(view);
 });
 await tick();h.click({dashView:'content'});await tick();h.click({dashRow:'0'});await tick();
 let p=h.requests.at(-1).params;
 assert.equal(h.node('#dashDialog').open,true);
 assert.equal(p.get('view'),'content');
 assert.equal(p.get('source'),row.source);assert.equal(p.get('variant'),row.variant);
 assert.equal(p.get('style'),row.style);assert.equal(p.get('copyHash'),row.copyHash);assert.equal(p.get('styleRevision'),'3');
 assert.match(h.node('#dashDialog').innerHTML,/<strong>—<\/strong><small>尚未发布占位/);
 assert.match(h.node('#dashDialog').innerHTML,/<strong>0<\/strong><small>已发布待满72h/);
 assert.match(h.node('#dashDialog').innerHTML,/关联测试账号/);
 assert.match(h.node('#dashDialog').innerHTML,/心理学 &lt;img/);
 h.click({dashLinked:'0'},'#dashDialog');await tick();
 p=h.requests.at(-1).params;
 assert.equal(p.get('view'),'accounts');assert.equal(p.get('account'),account.account);
 assert.equal(p.has('source'),false);
 assert.match(h.node('#dashDialog').innerHTML,/执行详情与历史角色/);
 assert.match(h.node('#dashDialog').innerHTML,/已匹配的具体版本/);
 h.click({dashLinked:'0'},'#dashDialog');await tick();
 assert.equal(h.requests.at(-1).params.get('copyHash'),row.copyHash);
 assert.equal(h.requests.at(-1).params.get('styleRevision'),'3');
 h.click({},'#dashDialog',{'data-dash-close':''});
 assert.equal(h.node('#dashDialog').open,false);
 assert.ok(h.requests.every(r=>r.init.method==='GET'));
});

test('pending modal evidence cannot overwrite a newer selection or revive a closed dialog',async()=>{
 const stale=deferred();let details=0;
 const h=harness(r=>{
  if(r.params.has('source')){details++;if(details===1)return stale.promise;return fixture('content',{details:{rows:[{...contentRow(),title:'第二个版本'}],total:1,page:1,pages:1},linkedAccounts:[]});}
  return fixture(r.params.get('view')||'overview');
 });
 await tick();h.click({dashView:'content'});await tick();h.click({dashRow:'0'});await tick();
 await h.api.show({...contentRow(),title:'第二个版本'},'content');
 const latest=h.node('#dashDialog').innerHTML;assert.match(latest,/第二个版本/);
 stale.resolve(fixture('content',{details:{rows:[{...contentRow(),title:'过期的版本'}]},linkedAccounts:[]}));await tick();
 assert.equal(h.node('#dashDialog').innerHTML,latest);
 const closed=deferred();
 const h2=harness(r=>r.params.has('source')?closed.promise:fixture(r.params.get('view')||'overview'));
 await tick();h2.click({dashView:'content'});await tick();h2.click({dashRow:'0'});await tick();
 h2.click({},'#dashDialog',{'data-dash-close':''});
 const snapshot=h2.node('#dashDialog').innerHTML;
 closed.resolve(fixture('content',{linkedAccounts:[accountRow()]}));await tick();
 assert.equal(h2.node('#dashDialog').open,false);assert.equal(h2.node('#dashDialog').innerHTML,snapshot);
});

test('detail HTTP errors leave the evidence summary visible and use safe status text',async()=>{
 const h=harness(r=>r.params.has('source')?{response:{ok:false,json:async()=>({error:'拒绝读取 <img>'})}}:fixture(r.params.get('view')||'overview'));
 await tick();h.click({dashView:'content'});await tick();h.click({dashRow:'0'});await tick();
 assert.equal(h.node('#dashDialog').open,true);
 assert.match(h.node('#dashDialog').innerHTML,/边界感 &lt;script&gt;/);
 assert.match(h.node('#dashDetailStatus').textContent,/关联记录读取失败：拒绝读取 <img>/);
 assert.doesNotMatch(h.node('#dashDialog').innerHTML,/<img>|<script>/);
});

test('quiet polling pauses for hidden pages, editing, open dialogs and a pending read, then resumes',async()=>{
 const gate=deferred();let block=false;
 const h=harness(r=>block?gate.promise:fixture(r.params.get('view')||'overview'));await tick();
 const initial=h.requests.length;
 h.document.hidden=true;h.interval();await tick();assert.equal(h.requests.length,initial);
 h.document.hidden=false;h.node('#dashDialog').showModal();h.interval();await tick();assert.equal(h.requests.length,initial);
 h.node('#dashDialog').close();h.document.activeElement=h.node('#dashSearchInput');h.interval();await tick();assert.equal(h.requests.length,initial);
 h.document.activeElement=null;h.interval();await tick();assert.equal(h.requests.length,initial+1);
 block=true;const loading=h.api.load();await tick();const pendingCount=h.requests.length;
 h.interval();await tick();assert.equal(h.requests.length,pendingCount);
 gate.resolve(fixture());await loading;block=false;
 h.interval();await tick();assert.equal(h.requests.length,pendingCount+1);
 assert.ok(h.requests.every(r=>r.init.method==='GET'));
});

test('keyboard tabs move focus, update aria state and preserve separate search and pool filters',async()=>{
 const h=harness();await tick();
 h.api.state.pool.content='explore';h.api.state.q.content='版本 & 一';
 assert.equal(h.key('End'),true);await tick();
 assert.equal(h.document.activeElement,h.node('#dash-tab-content'));
 assert.equal(h.api.state.view,'content');assert.equal(h.requests.at(-1).params.get('contentPool'),'explore');
 assert.equal(h.requests.at(-1).params.get('q'),'版本 & 一');
 assert.equal(h.node('#dash-tab-content').tabIndex,0);assert.equal(h.node('#dash-tab-overview').tabIndex,-1);
 assert.equal(h.key('ArrowRight','content'),true);await tick();assert.equal(h.api.state.view,'overview');
 assert.equal(h.node('#dashBody').getAttribute('aria-labelledby'),'dash-tab-overview');
 assert.equal(h.key('ArrowLeft','overview'),true);await tick();assert.equal(h.api.state.view,'content');
 assert.equal(h.key('Home','content'),true);await tick();assert.equal(h.api.state.view,'overview');
 assert.equal(h.key('Enter','overview'),false);
});


test('visible account rows, search and paging keep their rendered view while another tab is still loading',async()=>{
 const pending=[];
 const h=harness(r=>{
  const view=r.params.get('view')||'overview';
  if(view==='content'&&!r.params.has('source')){const gate=deferred();pending.push(gate);return gate.promise;}
  return fixture(view);
 });
 await tick();h.click({dashView:'accounts'});await tick();
 h.click({dashView:'content'});await tick();
 h.click({dashRow:'0'});await tick();
 assert.equal(h.requests.at(-1).params.get('view'),'accounts','the still-visible account row cannot be sent as a content version');
 assert.equal(h.requests.at(-1).params.get('account'),accountRow().account);
 h.click({},'#dashDialog',{'data-dash-close':''});
 h.node('#dashSearchInput').value='visible account search';
 h.node('#dashSearch').listeners.submit({preventDefault(){}});await tick();
 assert.equal(h.requests.at(-1).params.get('view'),'accounts');
 assert.equal(h.requests.at(-1).params.get('q'),'visible account search');
 assert.equal(h.api.state.q.accounts,'visible account search');assert.equal(h.api.state.q.content,'');
 pending[0].resolve(fixture('content'));await tick();
 assert.equal(h.api.state.view,'accounts');
 h.click({dashView:'content'});await tick();h.click({dashPage:'1'});await tick();
 assert.equal(h.requests.at(-1).params.get('view'),'accounts');
 assert.equal(h.requests.at(-1).params.get('page'),'2');
 pending[1].resolve(fixture('content'));await tick();
 assert.equal(h.api.state.view,'accounts');assert.match(h.node('#dashBody').innerHTML,/心理学 &lt;img/);
});

test('failed tab changes restore the displayed view so retained rows and later queries stay aligned',async()=>{
 const h=harness(r=>{if(r.params.get('view')==='content')throw Error('content offline');return fixture(r.params.get('view')||'overview');});
 await tick();h.click({dashView:'accounts'});await tick();const visible=h.node('#dashBody').innerHTML;
 h.click({dashView:'content'});await tick();
 assert.equal(h.api.state.view,'accounts');assert.equal(h.api.state.renderedView,'accounts');
 assert.equal(h.node('#dashBody').innerHTML,visible);
 assert.equal(h.node('#dash-tab-accounts').getAttribute('aria-selected'),'true');
 assert.equal(h.node('#dashBody').getAttribute('aria-labelledby'),'dash-tab-accounts');
 assert.match(h.node('#dashStatus').textContent,/保留上次数据.*content offline/);
 h.click({dashPage:'1'});await tick();assert.equal(h.requests.at(-1).params.get('view'),'accounts');
});

test('backend version and futureEffectiveAt contract is retained in titles and exact evidence queries',async()=>{
 const row={...contentRow(),version:'rewrite-backend-version'};delete row.variant;
 const future={...accountRow(),futureEffectiveAt:anchor+86400000};delete future.effectiveAt;
 const h=harness(r=>fixture(r.params.get('view')||'overview',{details:{rows:r.params.get('view')==='accounts'?[future]:[row],total:1,page:1,pages:1}}));
 await tick();h.click({dashView:'content'});await tick();assert.match(h.node('#dashBody').innerHTML,/rewrite-backend-version/);
 h.click({dashRow:'0'});await tick();assert.equal(h.requests.at(-1).params.get('variant'),'rewrite-backend-version');
 h.click({},'#dashDialog',{'data-dash-close':''});h.click({dashView:'accounts'});await tick();
 assert.doesNotMatch(h.node('#dashBody').innerHTML,/未来：内容评审/);
 h.click({dashRow:'0'});await tick();assert.match(h.node('#dashDialog').innerHTML,/未来：内容评审 · 10\/02/);
});
test('publication provider zero highRate is visible and pool deltas require two real observation days',async()=>{
 const h=harness();await tick();
 const chart=h.run("dashChart({rows:[{date:'2026-09-24',n:1,medianViews:0,highRate:0}]})");
 assert.match(chart,/千播率 0\.0%/);assert.match(chart,/fill="#10b981"/);
 const initial=h.run("dashMovement({poolTrend:{rows:[{date:'2026-09-29',observedAt:1,accounts:10,pools:{strong:2,normal:8}}]}})");
 assert.match(initial,/有两个运营日的记录后/);
 const actual=h.run("dashMovement({poolTrend:{rows:[{date:'2026-09-29',observedAt:1,accounts:10,pools:{strong:2,normal:8}},{date:'2026-09-30',observedAt:2,accounts:12,pools:{strong:3,normal:9}}]}})");
 assert.match(actual,/项目账号 \+2，强号 \+1，中号 \+1/);
});



test('account traffic keeps unknown followers and missing profile days distinct from measured zero',async()=>{
 const h=harness(r=>fixture(r.params.get('view')||'overview',{details:{rows:[{...accountRow(),followers:null,conversionCandidate:null,traffic:{published:0,synced:0,views:null,medianViews:null},profileTraffic:{views:null,days:0},trafficTier:'observing'}],total:1,page:1,pages:1}}));
 await tick();h.click({dashView:'accounts'});await tick();
 const body=h.node('#dashBody').innerHTML;assert.match(body,/粉丝待同步/);assert.match(body,/待观察/);
 assert.match(body,/<td>—<\/td><td>—<\/td>/);assert.match(body,/0 \/ 7天 · UTC/);assert.doesNotMatch(body,/可承接转化/);
 h.click({dashRow:'0'});await tick();assert.match(h.node('#dashDialog').innerHTML,/主页访问不是站内转化/);
 assert.match(h.node('#dashDialog').innerHTML,/<details class="dash-account-execution"><summary>执行详情与历史角色/);
});


test('every content pool lists clickable work URLs and keeps exact identity while paging evidence',async()=>{
 for(const pool of ['winner','optimize','potential','explore','revise']){
  const row={...contentRow(),pool};
  const h=harness(r=>fixture(r.params.get('view')||'overview',{
   details:{rows:[row],total:1,page:1,pages:1},evidence:r.params.has('source')?{rows:[{id:'post',name:'Alpha <unsafe>',url:'https://www.tiktok.com/@alpha/photo/123?x=1&y=2',views:0,completion:0,publishedAt:anchor-86400000,status:'mature'},{id:'missing',name:'Beta',url:'javascript:alert(1)',views:null,status:'missingMetrics'},{id:'pending',name:'Gamma',url:null,status:'reserved'}],total:11,page:Number(r.params.get('evidencePage')||1),pages:2}:undefined
  }));
  await tick();h.click({dashView:'content',dashPool:pool});await tick();h.click({dashRow:'0'});await tick();
  let html=h.node('#dashDialog').innerHTML;
  assert.match(html,/<h3>具体作品链接<\/h3>/);
  assert.match(html,/<a href="https:\/\/www.tiktok.com\/@alpha\/photo\/123\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">/);
  assert.match(html,/Alpha &lt;unsafe&gt;/);assert.match(html,/播放量 0/);assert.match(html,/完成率 0.0%/);
  assert.match(html,/作品链接待同步/);assert.match(html,/尚未发布，暂无作品链接/);assert.doesNotMatch(html,/javascript:/);
  h.click({dashEvidencePage:'1'},'#dashDialog');await tick();
  const p=h.requests.at(-1).params;
  assert.equal(p.get('evidencePage'),'2');assert.equal(p.get('copyHash'),row.copyHash);assert.equal(p.get('styleRevision'),'3');assert.equal(p.has('page'),false);
  assert.match(h.node('#dashDialog').innerHTML,/第 2 \/ 2 页/);
  h.click({dashEvidencePage:'-1'},'#dashDialog');await tick();assert.equal(h.requests.at(-1).params.get('evidencePage'),'1');
  assert.ok(h.requests.every(r=>r.init.method==='GET'));
 }
});


test('account names open TikTok profiles through native links while the detail button retains local analytics',async()=>{
 for(const pool of ['strong','normal','weak','observing']){
  const row={...accountRow(),profileUrl:'https://www.tiktok.com/@Alpha_name.12'};
  const h=harness(r=>fixture(r.params.get('view')||'overview',{details:{rows:[row],total:1,page:1,pages:1}}));
  await tick();h.click({dashView:'accounts',dashPool:pool});await tick();
  const html=h.node('#dashBody').innerHTML;
  assert.match(html,/<a class="dash-text-action" data-dash-profile href="https:\/\/www\.tiktok\.com\/@Alpha_name\.12" target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/心理学 &lt;img src=x onerror=alert\(1\)&gt;<\/a>/);
  assert.match(html,/<button class="dash-text-action" data-dash-row="0">查看详情<\/button>/);
  const before=h.requests.length;
  h.node('#poolDashboard').listeners.click({target:{closest:()=>null}});
  assert.equal(h.requests.length,before,'native profile anchor must not request a local modal');assert.equal(h.node('#dashDialog').open,false);
  h.click({dashRow:'0'});await tick();assert.equal(h.node('#dashDialog').open,true);assert.equal(h.requests.at(-1).params.get('account'),row.account);
 }
 const h=harness();await tick();
 for(const profileUrl of [null,'javascript:alert(1)','https://www.tiktok.com.evil/@alpha','https://www.tiktok.com/@alpha?next=evil','https://evil.example/@alpha']){
  const html=h.run('dashAccountName('+JSON.stringify({...accountRow(),profileUrl})+')');
  assert.doesNotMatch(html,/<a /);assert.match(html,/账号主页链接待同步/);
 }
});
