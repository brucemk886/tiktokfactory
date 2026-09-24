import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/psychology-autopilot.js',import.meta.url),'utf8');
function harness(overrides={},post){
 const nodes=new Map(),events={},requests=[];let poll,failRead=false;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='[name="pauseMode"]:checked'?'planning':'',options:[],innerHTML:'',textContent:'',listeners:{},classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){},addEventListener(k,fn){this.listeners[k]=fn;}});return nodes.get(s);};
 const pilot={id:'pilot-test',groupId:'g',groupName:'<unsafe>',status:'active',accounts:[],today:{planned:2,published:1,failed:1},schedule:[{slotAt:1,status:'created',counts:{planned:2,published:1,failed:1}}],attention:[],logs:[],lastRunAt:1};
 const data={pilots:[pilot],groups:[],strategies:{evolve:'A'},rules:{slots:[],staggerSeconds:45,lowPosts:5,lowViews:200,failStreak:3},fetchedAt:2,...overrides};
 const document={hidden:false,querySelector:s=>s==='dialog[open]'?[...nodes.values()].find(n=>n.open):node(s),querySelectorAll:()=>[],getElementById:id=>node('#'+id),addEventListener(k,fn){events[k]=fn;}};
 const context=vm.createContext({document,confirm:()=>true,setInterval(fn){poll=fn;},fetch:async(path,init)=>{requests.push({path,...init,body:init.body?JSON.parse(init.body):null});if(failRead&&init.method==='GET')throw Error('offline');if(init.method==='POST'&&post)return {ok:true,json:async()=>post(JSON.parse(init.body))};return {ok:true,json:async()=>path.includes('/impact')?{stoppable:2,protected:1}:init.method==='PATCH'?{ok:true,stopped:2}:data};}});
 vm.runInContext(source,context);
 return {node,events,requests,document,run:code=>vm.runInContext(code,context),poll:()=>poll(),fail:()=>{failRead=true;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('overview escapes account/group data and preserves visible data on failed refresh',async()=>{
 const h=harness();await tick();assert.match(h.node('#compare').innerHTML,/&lt;unsafe&gt;/);assert.doesNotMatch(h.node('#compare').innerHTML,/<unsafe>/);
 const old=h.node('#overview').innerHTML;h.fail();await h.node('#reload').onclick();assert.equal(h.node('#overview').innerHTML,old);assert.match(h.node('#status').textContent,/保留上次数据.*offline/);
});
test('pause requires impact preview and explicit scope, with polling suspended in modal',async()=>{
 const h=harness();await tick();await h.run("openPause('pilot-test')");assert.match(h.node('#pauseImpact').textContent,/2 条.*1 条/);
 const before=h.requests.length;h.poll();await tick();assert.equal(h.requests.length,before);
 h.node('[name="pauseMode"]:checked').value='pending';await h.node('#confirmPause').onclick();
 assert.deepEqual(h.requests.find(r=>r.method==='PATCH').body,{status:'paused',stopPending:true});
 assert.equal(h.node('#pauseDialog').open,false);
});
test('planning-only pause does not request cancellation, and account pause remains account scoped',async()=>{
 const h=harness();await tick();await h.run("openPause('pilot-test')");await h.node('#confirmPause').onclick();assert.equal(h.requests.find(r=>r.method==='PATCH').body.stopPending,false);
 await h.run("openPause('pilot-test','account/a')");await h.node('#confirmPause').onclick();const last=h.requests.filter(r=>r.method==='PATCH').at(-1);assert.match(last.path,/accounts\/account%2Fa$/);assert.equal(last.body.stopPending,true);
});

test('initial visit, explicit refresh and opening creation refresh all groups; quiet polling reads cache',async()=>{
 const h=harness();await tick();assert.match(h.requests[0].path,/refreshGroups=1/);
 await h.node('#reload').onclick();assert.match(h.requests.at(-1).path,/refreshGroups=1/);
 h.poll();await tick();assert.equal(h.requests.at(-1).path,'/api/psychology-autopilot');
 h.node('#openCreate').onclick();await tick();assert.equal(h.node('#createDialog').open,true);assert.match(h.requests.at(-1).path,/refreshGroups=1/);
 await h.node('#refreshGroups').onclick();assert.match(h.requests.at(-1).path,/refreshGroups=1/);
});


test('strategy selection changes its own rules immediately, keeps common rules and selection on refresh',async()=>{
 const h=harness({strategies:{evolve:'A',original:'B',rewrite:'C'},strategyRules:{
  evolve:{summary:'先原版再比较',rules:['A 专属规则']},original:{summary:'只发原版',rules:['B 专属规则']},rewrite:{summary:'改写优先',rules:['C 专属规则 <unsafe>']}
 }});await tick();
 assert.match(h.node('#strategyRules').innerHTML,/A 专属规则/);
 const common=h.node('#rules').innerHTML, reads=h.requests.length;
 for(const [value,text] of [['original','B 专属规则'],['rewrite','C 专属规则']]){
  h.node('#strategy').value=value;h.node('#strategy').listeners.change();
  assert.ok(h.node('#strategyRules').innerHTML.includes(text));assert.equal(h.node('#rules').innerHTML,common);
 }
 assert.equal(h.requests.length,reads);assert.match(h.node('#strategyRules').innerHTML,/&lt;unsafe&gt;/);
 assert.doesNotMatch(h.node('#strategyRules').innerHTML,/A 专属规则|B 专属规则|<unsafe>/);
 await h.node('#reload').onclick();assert.equal(h.node('#strategy').value,'rewrite');assert.match(h.node('#strategyRules').innerHTML,/C 专属规则/);
});

const batchGroups=Array.from({length:9},(_,i)=>({id:'g'+i,name:'测试组 '+(i+1),accounts:20}));
function choose(h,id,checked=true){h.node('#groupChoices').listeners.change({target:{value:id,checked,matches:()=>true}});}
function submit(h){return h.node('#createForm').listeners.submit({preventDefault(){}});}
function settings(h){h.node('#strategy').value='evolve';h.node('#days').value='7';}
test('bulk selection excludes managed and empty groups, preserves selection on refresh and supports clear',async()=>{
 const h=harness({groups:[...batchGroups,{id:'g',name:'已托管',accounts:20},{id:'empty',name:'空',accounts:0}]});await tick();
 h.node('#selectAllGroups').onclick();assert.equal(h.run('selectedGroups.size'),9);assert.match(h.node('#groupSelectionCount').textContent,/9 个分组.*180 个账号/);
 assert.match(h.node('#groupChoices').innerHTML,/value="g"[^>]*disabled/);assert.match(h.node('#groupChoices').innerHTML,/value="empty"[^>]*disabled/);
 await h.node('#reload').onclick();assert.equal(h.run('selectedGroups.size'),9);
 choose(h,'g0',false);assert.equal(h.run('selectedGroups.size'),8);
 h.node('#clearGroups').onclick();assert.equal(h.run('selectedGroups.size'),0);assert.equal(h.node('#createButton').disabled,true);
});
test('one submit creates nine independent groups with identical frozen strategy/days and retains per-group results',async()=>{
 const bodies=[];const h=harness({pilots:[],groups:batchGroups},async body=>{bodies.push(body);return {id:body.groupId,run:{batches:[1],errors:[]}};});await tick();settings(h);
 h.node('#selectAllGroups').onclick();await submit(h);
 assert.equal(bodies.length,9);assert.equal(new Set(bodies.map(b=>b.groupId)).size,9);assert.ok(bodies.every(b=>b.strategy==='evolve'&&b.days===7));
 assert.match(h.node('#createStatus').textContent,/已创建 9\/9/);assert.equal(h.run('selectedGroups.size'),0);assert.equal(h.node('#createButton').disabled,true);
 assert.equal((h.node('#createResults').innerHTML.match(/已创建/g)||[]).length,9);
 h.node('#selectAllGroups').onclick();assert.equal(h.run('selectedGroups.size'),0,'successful groups stay disabled even if a stale GET omits them');
});
test('bulk creation is serial, blocks duplicate submits/refresh/closing and freezes form settings',async()=>{
 let release,active=0,max=0;const gate=new Promise(r=>release=r);
 const h=harness({pilots:[],groups:batchGroups.slice(0,2)},async body=>{active++;max=Math.max(max,active);if(body.groupId==='g0')await gate;active--;return {run:{batches:[],errors:[]}};});await tick();settings(h);h.node('#selectAllGroups').onclick();
 const running=submit(h);await tick();assert.equal(h.node('#strategy').disabled,true);assert.equal(h.node('#days').disabled,true);
 const before=h.requests.length;await submit(h);await h.node('#reload').onclick();assert.equal(h.requests.length,before);
 let cancelled=false;h.node('#createDialog').listeners.cancel({preventDefault(){cancelled=true;}});assert.equal(cancelled,true);
 h.node('#strategy').value='rewrite';h.node('#days').value='12';release();await running;
 assert.equal(max,1);assert.ok(h.requests.filter(r=>r.method==='POST').every(r=>r.body.strategy==='evolve'&&r.body.days===7));assert.equal(h.node('#strategy').disabled,false);
});
test('partial failure does not stop other groups; only failed groups remain selectable and schedule warnings stay successful',async()=>{
 const h=harness({pilots:[],groups:batchGroups.slice(0,3)},async body=>{if(body.groupId==='g1')throw Error('<offline>');return {run:{batches:[],errors:body.groupId==='g2'?['文案不足']:[]}};});await tick();settings(h);h.node('#selectAllGroups').onclick();await submit(h);
 assert.equal(h.requests.filter(r=>r.method==='POST').length,3);assert.match(h.node('#createStatus').textContent,/已创建 2\/3.*1 个未确认成功.*1 个排期需处理/);
 assert.equal(h.run('[...selectedGroups].join()'),'g1');assert.match(h.node('#createResults').innerHTML,/&lt;offline&gt;/);assert.match(h.node('#createResults').innerHTML,/排期需处理：文案不足/);
 await submit(h);assert.deepEqual(h.requests.filter(r=>r.method==='POST').map(r=>r.body.groupId),['g0','g1','g2','g1']);
});
test('refresh prunes unavailable selection; empty or invalid settings never submit',async()=>{
 const groups=[...batchGroups.slice(0,2)];const h=harness({pilots:[],groups});await tick();settings(h);h.node('#selectAllGroups').onclick();groups[0]={...groups[0],accounts:0};await h.node('#reload').onclick();assert.equal(h.run('[...selectedGroups].join()'),'g1');
 h.node('#days').value='31';await submit(h);assert.match(h.node('#createStatus').textContent,/1–30/);
 h.node('#clearGroups').onclick();await submit(h);assert.match(h.node('#createStatus').textContent,/至少选择/);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});

test('per-group counts/times and stagger are frozen independently in batch requests',async()=>{
 const h=harness({pilots:[],groups:batchGroups.slice(0,3)},async()=>({run:{batches:[],errors:[]}}));await tick();settings(h);h.node('#selectAllGroups').onclick();
 h.node('#defaultDailyCount').listeners.change({target:{value:'1'}});h.node('#groupOffset').value='15';h.node('#staggerGroups').onclick();
 assert.equal(h.run("groupSchedules.get('g0').join()"),'08:00');assert.equal(h.run("groupSchedules.get('g2').join()"),'08:30');
 h.events.change({target:{dataset:{groupCount:'g1'},value:'2'}});
 h.events.change({target:{dataset:{timeScope:'g1',timeIndex:'1'},value:'19:20'}});
 await submit(h);const bodies=h.requests.filter(r=>r.method==='POST').map(r=>r.body);
 assert.deepEqual(bodies.map(b=>b.slots),[[{hour:8,minute:0}],[{hour:8,minute:15},{hour:19,minute:20}],[{hour:8,minute:30}]]);
});
test('duplicate times and cross-day stagger do not create any groups or partially overwrite settings',async()=>{
 const h=harness({pilots:[],groups:batchGroups.slice(0,2)});await tick();settings(h);h.node('#selectAllGroups').onclick();
 h.run("groupSchedules.set('g0',['08:00','08:00'])");await submit(h);assert.match(h.node('#createStatus').textContent,/重复/);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
 h.run("defaultTimes=['23:40']");h.node('#groupOffset').value='30';h.node('#staggerGroups').onclick();assert.match(h.node('#createStatus').textContent,/超过当天/);assert.equal(h.run("groupSchedules.get('g0').join()"),'08:00,08:00');
});


test('immediate first-day preparation is explicit and frozen across group creation',async()=>{
 const bodies=[];const h=harness({pilots:[],groups:batchGroups},async body=>{bodies.push(body);h.node('#startNow').checked=false;return {id:body.groupId,run:{batches:[1],errors:[]}};});await tick();settings(h);
 h.node('#startNow').checked=true;h.node('#selectAllGroups').onclick();await submit(h);
 assert.equal(bodies.length,9);assert.ok(bodies.every(b=>b.startNow===true));
});
