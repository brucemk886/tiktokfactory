import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/psychology-transition-day.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){return {date:'2026-10-01',timeZone:'America/Los_Angeles',enabled:false,canEnable:true,canRun:false,transition:null,preview:{eligible:116,review:60,normal:56,excluded:[]},formal:{revision:3},rounds:[{round:1,label:'午间',slotAt:Date.parse('2026-10-01T18:30:00Z'),generationStartAt:null,created:0,planned:116,published:0,skipped:0,states:{},status:'pending'},{round:2,label:'晚间',slotAt:Date.parse('2026-10-02T03:00:00Z'),generationStartAt:null,created:0,planned:116,published:0,skipped:0,states:{},status:'pending'}],...overrides};}
function harness(route){
 const requests=[],intervals=[],host={innerHTML:'',attrs:{},listeners:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.listeners[k]=fn;}},reload={listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}},document={hidden:false,querySelector:s=>s==='#transitionDay'?host:s==='#reload'?reload:null};
 const context=vm.createContext({document,Date,fetch:async(path,init)=>{requests.push({path,...init,body:init.body?JSON.parse(init.body):null});const data=route?await route(requests.at(-1),requests.length):fixture();return data?.response||{ok:true,json:async()=>data};},setInterval(fn,ms){intervals.push({fn,ms});}});
 vm.runInContext(source,context);
 function click(action){host.listeners.click({target:{closest:()=>({dataset:{transitionAction:action}})}});}
 return {requests,host,reload,document,intervals,click};
}
test('historical bridge is preserved inside collapsed execution details and remains independent of traffic dashboard',()=>{assert.match(html,/id="poolDashboard"[\s\S]*<details id="executionDetails"[\s\S]*id="transitionDay"/);assert.doesNotMatch(html,/<details id="executionDetails"[^>]*\bopen(?:\s|=|>)/);assert.match(html,/<script type="module" src="\/psychology-transition-day.js"><\/script>/);assert.doesNotMatch(source,/psychology-autopilot\/dashboard|confirm\(/);});
test('visits, polling and refresh only read authenticated bridge status every 30 seconds',async()=>{const h=harness();await tick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'GET');assert.equal(h.requests[0].credentials,'same-origin');assert.equal(h.requests[0].cache,'no-store');assert.equal(h.intervals[0].ms,30000);h.intervals[0].fn();await tick();h.reload.listeners.click();await tick();assert.equal(h.requests.length,3);assert.ok(h.requests.every(r=>r.method==='GET'));h.document.hidden=true;h.intervals[0].fn();assert.equal(h.requests.length,3);});
test('native enable submits explicit date and fresh policy revision, never automatically runs',async()=>{let enabled=false;const h=harness(r=>{if(r.method==='POST')enabled=true;return fixture({enabled,canEnable:!enabled,canRun:enabled});});await tick();assert.match(h.host.innerHTML,/id="enableTransitionDay"/);h.click('enable');await tick();assert.deepEqual(h.requests.find(r=>r.method==='POST').body,{date:'2026-10-01',revision:3});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.doesNotMatch(h.host.innerHTML,/id="enableTransitionDay"/);assert.match(h.host.innerHTML,/id="runTransitionDay"/);h.click('run');await tick();assert.equal(h.requests.filter(r=>r.method==='POST').at(-1).path,'/api/psychology-autopilot/transition-day/run');assert.deepEqual(h.requests.filter(r=>r.method==='POST').at(-1).body,{date:'2026-10-01'});});
test('server eligibility gates prevent stale or fabricated buttons from mutating',async()=>{const h=harness(()=>fixture({canEnable:false,canRun:false}));await tick();h.click('enable');h.click('run');await tick();assert.ok(h.requests.every(r=>r.method==='GET'));assert.doesNotMatch(h.host.innerHTML,/id="enableTransitionDay"|id="runTransitionDay"/);});
test('publishing remains distinct from generation completion, escaping data and showing cross-day zones',async()=>{const h=harness(()=>fixture({enabled:true,preview:{eligible:116,review:60,normal:56,excluded:[{reason:'<img src=x onerror=alert(1)>'}]},rounds:[{round:1,label:'午间 <script>',slotAt:Date.parse('2026-10-01T18:30:00Z'),generationStartAt:Date.parse('2026-10-01T16:30:00Z'),created:116,published:0,skipped:2,states:{done:100,queued:16},status:'created',detail:'等待 <unsafe>'}]}));await tick();assert.match(h.host.innerHTML,/>116<\/strong><small>已创建任务/);assert.match(h.host.innerHTML,/>0<\/strong><small>已发布/);assert.doesNotMatch(h.host.innerHTML,/已生成|生成中/);assert.doesNotMatch(h.host.innerHTML,/10\/01 11:30/);assert.match(h.host.innerHTML,/10\/02 02:30/);assert.match(h.host.innerHTML,/10\/02 00:30/);assert.match(h.host.innerHTML,/午间 &lt;script&gt;/);assert.match(h.host.innerHTML,/等待 &lt;unsafe&gt;/);assert.match(h.host.innerHTML,/&lt;img src=x/);assert.match(h.host.innerHTML,/（1个账号）/);assert.doesNotMatch(h.host.innerHTML,/<script>|<img src=x|<unsafe>/);});
test('double mutation, refresh and polling during pending enable do not duplicate requests',async()=>{let release;const gate=new Promise(resolve=>release=resolve);const h=harness(async r=>{if(r.method==='POST'){await gate;return fixture({enabled:true,canRun:true});}return fixture();});await tick();h.click('enable');await tick();h.click('enable');h.click('run');h.click('refresh');h.intervals[0].fn();assert.equal(h.requests.length,2);assert.match(h.host.innerHTML,/id="enableTransitionDay"[^>]*disabled/);release();await tick();assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(h.host.attrs['aria-busy'],'false');});
test('failed refresh retains last truthful data and escaping of server mutation error',async()=>{let fail=false;const h=harness(r=>{if(r.method==='POST')return {response:{ok:false,json:async()=>({error:'<unsafe> no permission'})}};if(fail)throw Error('offline');return fixture();});await tick();h.click('enable');await tick();assert.match(h.host.innerHTML,/操作尚未确认全部成功：&lt;unsafe&gt; no permission/);fail=true;h.click('refresh');await tick();assert.match(h.host.innerHTML,/保留上次状态；读取失败：offline/);assert.match(h.host.innerHTML,/符合过渡条件 116 个账号/);});

test('one explicit run completes eighteen bounded serial calls with visible progress and no extra mutation from polling',async()=>{
 let posted=0,active=0,max=0,release;const gate=new Promise(resolve=>release=resolve);
 const h=harness(async r=>{if(r.method==='POST'){active++;max=Math.max(max,active);posted++;if(posted===3)await gate;active--;return fixture({enabled:true,canRun:posted<18,rounds:fixture().rounds.map(round=>({...round,status:posted<18?'pending':'created'})),runResult:{processed:1,remaining:18-posted,errors:[],busy:false}});}return fixture({enabled:true,canRun:posted<18,rounds:fixture().rounds.map(round=>({...round,status:posted<18?'pending':'created'}))});});
 await tick();h.click('run');await tick();assert.equal(posted,3);assert.match(h.host.innerHTML,/已检查 2 个排期，剩余 16 个/);assert.equal(h.host.attrs['aria-busy'],'true');
 h.click('run');h.click('enable');h.click('refresh');h.intervals[0].fn();assert.equal(posted,3);
 release();await tick();assert.equal(posted,18);assert.equal(max,1);assert.equal(h.host.attrs['aria-busy'],'false');assert.match(h.host.innerHTML,/两轮过渡排期检查完成/);assert.ok(h.requests.filter(r=>r.method==='POST').every(r=>r.path.endsWith('/transition-day/run')));
});
test('business failure stops continuation immediately and retains the partial server result',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;return fixture({enabled:true,canRun:true,rounds:[{label:'午间',status:'failed',created:74,published:0,skipped:0}],runResult:{processed:0,remaining:14,errors:['<unsafe> 内容不足'],busy:false}});}return fixture({enabled:true,canRun:true});});
 await tick();h.click('run');await tick();assert.equal(posted,1);assert.match(h.host.innerHTML,/排期暂停：&lt;unsafe&gt; 内容不足/);assert.match(h.host.innerHTML,/>74<\/strong><small>已创建任务/);assert.equal(h.host.attrs['aria-busy'],'false');
});
test('server processing lease stops requests with its actual busy reason',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;return fixture({enabled:true,canRun:true,runResult:{processed:0,remaining:14,errors:[],busy:true}});}return fixture({enabled:true,canRun:true});});
 await tick();h.click('run');await tick();assert.equal(posted,1);assert.match(h.host.innerHTML,/已有过渡排期正在处理，剩余 14 个排期/);
});
test('lost network response never automatically retries and retains previously confirmed progress',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;if(posted===2)throw Error('network offline');return fixture({enabled:true,canRun:true,runResult:{processed:1,remaining:13,errors:[],busy:false}});}return fixture({enabled:true,canRun:true});});
 await tick();h.click('run');await tick();assert.equal(posted,2);assert.match(h.host.innerHTML,/network offline/);assert.equal(h.host.attrs['aria-busy'],'false');assert.equal(h.requests.filter(r=>r.method==='GET').length,1,'error does not trigger an automatic retry/read reset');
});
test('HTML platform errors are friendly and never expose JSON parser messages or trigger retries',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;return {response:{ok:false,status:500,json:async()=>{throw SyntaxError('Unexpected token < in JSON at position 0');}}};}return fixture({enabled:true,canRun:true});});
 await tick();h.click('run');await tick();assert.equal(posted,1);assert.match(h.host.innerHTML,/服务暂未返回有效状态（HTTP 500）/);assert.match(h.host.innerHTML,/已保存的任务保留/);assert.doesNotMatch(h.host.innerHTML,/Unexpected token|SyntaxError/);
});
test('bounded continuation stops at twenty-four requests even if remaining counts never settle',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;return fixture({enabled:true,canRun:true,runResult:{processed:1,remaining:1,errors:[],busy:false}});}return fixture({enabled:true,canRun:true});});
 await tick();h.click('run');await tick();assert.equal(posted,24);assert.match(h.host.innerHTML,/本次已检查 24 次，剩余 1 个排期/);assert.equal(h.host.attrs['aria-busy'],'false');
});
test('window or permission closure stops remaining calls and pending rounds display the scheduling state',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;return fixture({enabled:true,canRun:false,runResult:{processed:1,remaining:2,errors:[],busy:false}});}return fixture({enabled:true,canRun:true});});
 await tick();assert.match(h.host.innerHTML,/待排期/);assert.doesNotMatch(h.host.innerHTML,/待启用/);h.click('run');await tick();assert.equal(posted,1);assert.match(h.host.innerHTML,/当前不能继续创建，剩余 2 个排期/);assert.doesNotMatch(h.host.innerHTML,/id="runTransitionDay"/);
});
test('zero remaining does not claim success when a missed or uncreated round still exists',async()=>{
 let posted=0;const h=harness(r=>{if(r.method==='POST'){posted++;return fixture({enabled:true,canRun:false,runResult:{processed:1,remaining:0,errors:[],busy:false}});}return fixture({enabled:true,canRun:true});});
 await tick();h.click('run');await tick();assert.equal(posted,1);assert.match(h.host.innerHTML,/两轮尚未全部完成/);assert.doesNotMatch(h.host.innerHTML,/两轮过渡排期检查完成/);
});
test('completed round shows actual publish-item range including forty-five-second account staggering',async()=>{
 const h=harness(()=>fixture({enabled:true,rounds:[{label:'午间',status:'created',slotAt:Date.parse('2026-10-01T18:30:00Z'),lastSlotAt:Date.parse('2026-10-01T19:50:00Z'),publicationStartAt:Date.parse('2026-10-01T18:30:00Z'),publicationEndAt:Date.parse('2026-10-01T19:57:30Z'),created:115,published:0,skipped:0}]}));
 await tick();assert.doesNotMatch(h.host.innerHTML,/10\/01 11:30:00/);assert.match(h.host.innerHTML,/10\/02 02:30:00 – 10\/02 03:57:30/);assert.doesNotMatch(h.host.innerHTML,/03:50/);
});
test('incomplete round keeps planned base range instead of presenting partial items as complete bounds',async()=>{
 const h=harness(()=>fixture({enabled:true,rounds:[{label:'午间',status:'pending',slotAt:Date.parse('2026-10-01T18:30:00Z'),lastSlotAt:Date.parse('2026-10-01T19:50:00Z'),publicationStartAt:Date.parse('2026-10-01T18:30:00Z'),publicationEndAt:Date.parse('2026-10-01T19:57:30Z'),created:74,published:0,skipped:0}]}));
 await tick();assert.match(h.host.innerHTML,/10\/02 02:30 – 10\/02 03:50/);assert.doesNotMatch(h.host.innerHTML,/03:57:30/);
});
