import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/psychology-autopilot.js',import.meta.url),'utf8');
function harness(overrides={},post,patch,taskRoute){
 const nodes=new Map(),events={},requests=[];let poll,failRead=false;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='[name="pauseMode"]:checked'?'planning':'',options:[],innerHTML:'',textContent:'',listeners:{},classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){},contains(target){return target?.container===this;},addEventListener(k,fn){this.listeners[k]=fn;}});return nodes.get(s);};
 const pilot={id:'pilot-test',groupId:'g',groupName:'<unsafe>',status:'active',accounts:[],today:{planned:2,published:1,failed:1},schedule:[{slotAt:1,status:'created',counts:{planned:2,published:1,failed:1}}],attention:[],logs:[],lastRunAt:1};
 const data={pilots:[pilot],groups:[],strategies:{evolve:'A'},rules:{slots:[],staggerSeconds:45,lowPosts:5,lowViews:200,failStreak:3},fetchedAt:2,...overrides};
 const document={hidden:false,querySelector:s=>s==='dialog[open]'?[...nodes.values()].find(n=>n.open):node(s),querySelectorAll:()=>[],getElementById:id=>node('#'+id),addEventListener(k,fn){events[k]=fn;}};
 const context=vm.createContext({document,confirm:()=>true,setInterval(fn){poll=fn;},fetch:async(path,init)=>{requests.push({path,...init,body:init.body?JSON.parse(init.body):null});if(path.startsWith('/api/psychology-autopilot/task-groups'))return taskRoute?taskRoute(path,{...init,body:init.body?JSON.parse(init.body):null}):{ok:true,json:async()=>({policy:null,groups:[],totals:{enrolled:0,excluded:0,eligible:0,blocked:0},candidates:[]})};if(failRead&&init.method==='GET')throw Error('offline');if(init.method==='PATCH'&&patch)return {ok:true,json:async()=>patch(JSON.parse(init.body),path)};if(init.method==='POST'&&post)return {ok:true,json:async()=>post(JSON.parse(init.body))};return {ok:true,json:async()=>path.includes('/impact')?{stoppable:2,protected:1}:init.method==='PATCH'?{ok:true,stopped:2}:data};}});
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

test('initial visit and status refresh read cache; opening creation and group refresh revalidate directory',async()=>{
 const h=harness();await tick();assert.equal(h.requests[0].path,'/api/psychology-autopilot');
 await h.node('#reload').onclick();assert.equal(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,'/api/psychology-autopilot');
 h.poll();await tick();assert.equal(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,'/api/psychology-autopilot');
 h.node('#openCreate').onclick();await tick();assert.equal(h.node('#createDialog').open,true);assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,/refreshGroups=1/);
 await h.node('#refreshGroups').onclick();assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,/refreshGroups=1/);
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


test('period defaults today and is retained for status refresh, polling and group refresh',async()=>{
 const h=harness();await tick();assert.equal(h.node('#period').value,'today');
 for(const period of ['yesterday','7d']){
  h.node('#period').value=period;h.node('#period').listeners.change();await tick();assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,new RegExp('period='+period));
  await h.node('#reload').onclick();assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,new RegExp('period='+period));
  h.poll();await tick();assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,new RegExp('period='+period));
 }
 await h.node('#refreshGroups').onclick();assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,/period=7d&refreshGroups=1/);
});

test('switching period during a pending refresh discards old response and requests latest selection',async()=>{
 const h=harness();await tick();
 h.run('const originalFetch=fetch;let unblock;let gateOnce=true;fetch=async(...args)=>{if(gateOnce){gateOnce=false;await new Promise(resolve=>unblock=resolve);}return originalFetch(...args);};');
 const pending=h.node('#reload').onclick();await tick();
 h.node('#period').value='yesterday';h.node('#period').listeners.change();
 h.node('#period').value='7d';h.node('#period').listeners.change();
 h.run('unblock()');await pending;await tick();
 assert.match(h.requests.filter(r=>!r.path.includes('/task-groups')).at(-1).path,/period=7d/);assert.equal(h.run('selectedPeriod'),'7d');assert.equal(h.run('loading'),false);
});

test('comparison uses selected-period performance and never substitutes historical strategy analysis',async()=>{
 const h=harness({pilots:[{id:'p',groupId:'g',groupName:'G',strategyLabel:'A',status:'active',accounts:[],schedule:[],logs:[],today:{planned:40},latest:{overview:{n:14,medianViews:495,potentialRate:0.071}},performance:{n:0,medianViews:null,potentialRate:null}}],window:{period:'today',from:'2026-09-26',to:'2026-09-26'}});await tick();
 assert.match(h.node('#compare').innerHTML,/今天已同步作品/);assert.match(h.node('#compare').innerHTML,/— \/ —/);assert.doesNotMatch(h.node('#compare').innerHTML,/495|7\.1%/);
});


test('new automation defaults to pool matching and two daily posts while preserving explicit strategy choices',async()=>{
 const h=harness({pilots:[],groups:batchGroups.slice(0,1),strategies:{evolve:'A',pools:'账号池匹配'},strategyRules:{pools:{summary:'按账号池匹配',rules:['72小时']}}},async()=>({run:{batches:[],errors:[]}}));await tick();
 assert.equal(h.node('#strategy').value,'pools');assert.equal(h.node('#poolQuotaGuide').hidden,false);assert.equal(h.run('defaultTimes.length'),2);
 h.node('#days').value='7';h.node('#selectAllGroups').onclick();await submit(h);const request=h.requests.find(r=>r.method==='POST');assert.equal(request.body.strategy,'pools');assert.equal(request.body.slots.length,2);
});
test('future pool switch is serial, revision guarded, preserves pause state and disables saved groups for retry',async()=>{
 const pilots=[{id:'p1',groupId:'g1',groupName:'One',status:'active',revision:8,slots:[],accounts:[],schedule:[],attention:[],logs:[]},{id:'p2',groupId:'g2',groupName:'<Two>',status:'paused',revision:9,slots:[],accounts:[],schedule:[],attention:[],logs:[]}];
 const h=harness({pilots,strategies:{pools:'账号池匹配'}},null,async(body,path)=>{if(path.includes('/p2/'))throw Error('<conflict>');return {effectiveAt:Date.parse('2026-10-02T00:00:00+08:00'),endsAt:Date.parse('2026-10-09T00:00:00+08:00')};});await tick();
 h.node('#openPoolSwitch').onclick();assert.match(h.node('#poolSwitchChoices').innerHTML,/&lt;Two&gt;/);
 const choices=pilots.map(p=>({dataset:{poolPilot:p.id},checked:true,disabled:false}));h.document.querySelectorAll=s=>s==='[data-pool-pilot]:checked'?choices.filter(c=>c.checked):s==='[data-pool-pilot]'?choices:[];
 await h.node('#confirmPoolSwitch').onclick();const patches=h.requests.filter(r=>r.method==='PATCH');assert.equal(patches.length,2);assert.deepEqual(patches.map(r=>r.body),[{strategy:'pools',days:7,revision:8},{strategy:'pools',days:7,revision:9}]);assert.ok(patches.every(r=>r.path.endsWith('/strategy')));
 assert.equal(choices[0].disabled,true);assert.equal(choices[0].checked,false);assert.equal(choices[1].checked,true);assert.match(h.node('#poolSwitchResults').innerHTML,/未保存.*&lt;conflict&gt;/);assert.doesNotMatch(h.node('#poolSwitchResults').innerHTML,/<conflict>/);
 await h.node('#confirmPoolSwitch').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH'&&r.path.includes('/p1/')).length,1);assert.equal(pilots[1].status,'paused');
});

const taskReply=(body,ok=true)=>({ok,json:async()=>body});
const taskRoles=['review','strong','normal','rescue-hook','rescue-content','diagnostic','observing','launch'];
const taskFixture=()=>({project:{id:'psychology-project',name:'心理学'},policy:null,effectiveAt:Date.parse('2026-10-02T00:00:00+08:00'),groups:taskRoles.map(role=>({id:role,role,label:role==='review'?'内容评审组':role,action:'保持资格校验',accounts:role==='review'?60:0,active:role==='review'?58:0,paused:role==='review'?2:0})),totals:{eligible:175,enrolled:175,excluded:5,blocked:2},candidates:[{id:'p1',groupId:'g1',groupName:'<第一组>',status:'active',poolReady:true},{id:'p2',groupId:'g2',groupName:'第二组',status:'paused',poolReady:true},{id:'p3',groupId:'g3',groupName:'非匹配组',status:'active',poolReady:false}]});
function clickTaskRole(h,role){const card={dataset:{taskRole:role},container:h.node('#taskGroupCards')};return h.node('#taskGroupCards').listeners.click({target:{closest:()=>card}});}
function taskPolicy(body,revision=body.revision){return {...body,revision,startsAt:Date.parse('2026-10-02T00:00:00+08:00'),endsAt:Date.parse('2026-10-09T00:00:00+08:00'),cycleDays:7,reviewDays:3};}

test('task groups show eight native role cards, blocked totals and independent current scope',async()=>{
 const task=taskFixture();task.groups[0].action='<unsafe>';
 const h=harness({},null,null,async()=>taskReply(task));await tick();
 const cards=h.node('#taskGroupCards').innerHTML;
 assert.equal((cards.match(/data-task-role=/g)||[]).length,8);assert.equal((cards.match(/<button type="button"/g)||[]).length,8);
 assert.match(cards,/aria-controls="taskGroupAccounts"/);assert.match(cards,/data-task-role="launch"/);assert.match(cards,/&lt;unsafe&gt;/);assert.doesNotMatch(cards,/<unsafe>/);
 assert.match(h.node('#taskGroupSummary').innerHTML,/待处理账号<\/span><strong>2/);assert.match(h.node('#taskGroupStatus').textContent,/尚未配置/);
 assert.match(h.node('#compare').innerHTML,/发布执行组 \/ 策略/);
 h.node('#period').value='yesterday';h.node('#period').listeners.change();await tick();
 assert.ok(h.requests.filter(r=>r.path.includes('/task-groups')).every(r=>!r.path.includes('period=')));
 assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');
 assert.match(html,/7天为一个周期，每3天复评/);assert.match(html,/降为低号立即停止冷测/);assert.match(html,/无正式优胜内容时等待基准/);
});

test('role cards load twenty-account pages, preserve role and escape member content including blocked accounts',async()=>{
 const task=taskFixture(),h=harness({},null,null,async path=>{
  const q=new URL(path,'https://factory.test').searchParams;
  return taskReply(q.has('group')?{...task,membership:{page:Number(q.get('page')),total:21,totalPages:2,rows:[{connectionId:'a',name:'<name>',groupName:'<group>',role:q.get('group'),accountPool:'normal',paused:false,blocked:true,reason:'<conflicting plan>',effectiveAt:task.effectiveAt}]}}:task);
 });await tick();clickTaskRole(h,'review');await tick();
 assert.equal(h.node('#taskGroupAccounts').hidden,false);assert.match(h.node('#taskGroupMemberPage').textContent,/第 1 \/ 2 页.*共 21 个账号.*每页20条/);
 assert.match(h.node('#taskGroupMemberTable').innerHTML,/&lt;name&gt;.*&lt;group&gt;.*待处理.*&lt;conflicting plan&gt;/);assert.doesNotMatch(h.node('#taskGroupMemberTable').innerHTML,/<name>|<group>|可参与未来分配/);
 assert.equal(h.node('#taskGroupPrev').disabled,true);assert.equal(h.node('#taskGroupNext').disabled,false);
 await h.node('#taskGroupNext').onclick();const last=h.requests.at(-1);assert.match(last.path,/group=review&page=2/);assert.equal(h.node('#taskGroupNext').disabled,true);
 await h.node('#taskGroupPrev').onclick();assert.match(h.requests.at(-1).path,/group=review&page=1/);
 const before=h.requests.length;clickTaskRole(h,'invalid');await tick();assert.equal(h.requests.length,before);
});

test('obsolete member and summary reads cannot replace newer task-group results; member failures retry locally',async()=>{
 const task=taskFixture();let releaseMember,releaseSummary,summaryReads=0,failMember=false;
 const h=harness({},null,null,async path=>{
  const q=new URL(path,'https://factory.test').searchParams;
  if(!q.has('group')){if(++summaryReads===2)return new Promise(resolve=>releaseSummary=resolve);return taskReply(task);}
  if(q.get('group')==='review')return new Promise(resolve=>releaseMember=resolve);
  if(failMember)return taskReply({error:'<offline>'},false);
  return taskReply({...task,membership:{page:1,total:0,totalPages:1,rows:[]}});
 });await tick();
 clickTaskRole(h,'review');await tick();clickTaskRole(h,'strong');await tick();
 const members=h.node('#taskGroupMemberTable').innerHTML;assert.match(members,/暂无账号/);
 releaseMember(taskReply({...task,membership:{page:1,total:1,totalPages:1,rows:[{name:'obsolete'}]}}));await tick();assert.equal(h.node('#taskGroupMemberTable').innerHTML,members);
 const old=h.run('loadTaskGroups()');await tick();await h.run('loadTaskGroups()');const summary=h.node('#taskGroupSummary').innerHTML;
 releaseSummary(taskReply({...task,totals:{enrolled:999}}));await old;assert.equal(h.node('#taskGroupSummary').innerHTML,summary);
 failMember=true;clickTaskRole(h,'normal');await tick();assert.match(h.node('#taskGroupMemberStatus').textContent,/读取失败.*<offline>/);assert.equal(h.node('#taskGroupMembersRetry').hidden,false);
 failMember=false;await h.node('#taskGroupMembersRetry').onclick();assert.equal(h.node('#taskGroupMembersRetry').hidden,true);assert.match(h.requests.at(-1).path,/group=normal&page=1/);
});

test('project automatic enrollment requires preview and works without source plans before an exact revision-bound save',async()=>{
 const task=taskFixture();task.candidates=[];let saved;
 const h=harness({pilots:[],groups:[]},null,null,async(_path,init)=>{
  if(init.method==='GET')return taskReply(task);
  if(init.method==='POST')return taskReply({...task,policy:taskPolicy(init.body),preview:true});
  saved=init.body;return taskReply({...task,policy:taskPolicy(init.body,1),effectiveAt:Date.parse('2026-10-03T00:00:00+08:00')});
 });await tick();await h.node('#openTaskGroupConfig').onclick();
 assert.equal(h.node('#taskGroupEnabled').checked,true);assert.equal(h.node('#taskGroupAdmitNew').checked,true);assert.equal(h.node('#taskGroupReviewTarget').value,60);
 assert.match(h.node('#taskGroupProject').textContent,/绑定项目：心理学.*无需选择原发布计划/);
 await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,0);
 await h.node('#previewTaskGroups').onclick();const preview=h.requests.find(r=>r.path.endsWith('/task-groups/preview'));
 assert.deepEqual(preview.body,{revision:0,enabled:true,enrollmentMode:'project',projectId:'psychology-project',timeZone:'America/Los_Angeles',reviewTarget:60,admitNewAccounts:true});
 assert.match(h.node('#taskGroupPreview').innerHTML,/绑定项目：心理学.*每日目标3条/);assert.match(h.node('#taskGroupPreview').innerHTML,/纳入 175 个账号.*排除 5 个账号.*待处理 2 个账号/);assert.equal(h.node('#saveTaskGroups').disabled,false);
 await h.node('#saveTaskGroups').onclick();assert.deepEqual(saved,preview.body);assert.match(h.node('#taskGroupConfigStatus').textContent,/已保存：.*10\/03/);assert.match(h.node('#taskGroupPreview').innerHTML,/已保存的实际配置/);assert.equal(h.node('#saveTaskGroups').disabled,true);
 assert.equal(h.requests.filter(r=>r.method==='POST').length,1,'the preview never creates an original publishing plan');
 assert.match(h.node('#taskGroupProjectSummary').textContent,/项目账号按数据自动纳入与分层/);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');assert.doesNotMatch(html,/taskGroupPilotChoices|taskGroupSelectAll|data-task-pilot/);assert.match(html,/原发布计划与历史/);
});
test('changing any task configuration invalidates preview and in-flight changes cannot become saveable',async()=>{
 const task=taskFixture();let releasePreview,slow=false;
 const h=harness({},null,null,async(_path,init)=>{
  if(init.method==='GET')return taskReply(task);
  if(slow)return new Promise(resolve=>releasePreview=()=>resolve(taskReply({...task,policy:taskPolicy(init.body)})));
  return taskReply({...task,policy:taskPolicy(init.body)});
 });await tick();await h.node('#openTaskGroupConfig').onclick();await h.node('#previewTaskGroups').onclick();
 h.node('#taskGroupAdmitNew').checked=false;h.node('#taskGroupAdmitNew').listeners.change();assert.equal(h.node('#saveTaskGroups').disabled,true);await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,0);
 await h.node('#previewTaskGroups').onclick();h.node('#taskGroupReviewTarget').value=59;await h.node('#saveTaskGroups').onclick();assert.match(h.node('#taskGroupConfigStatus').textContent,/重新预览/);assert.equal(h.requests.filter(r=>r.method==='PATCH').length,0);
 slow=true;const pending=h.node('#previewTaskGroups').onclick();await tick();const reads=h.requests.length;await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.length,reads);
 let prevented=false;h.node('#taskGroupDialog').listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 h.node('#taskGroupReviewTarget').value=58;releasePreview();await pending;assert.match(h.node('#taskGroupConfigStatus').textContent,/预览失败.*配置已更改/);assert.equal(h.node('#saveTaskGroups').disabled,true);
 h.node('#taskGroupReviewTarget').value=4;await h.node('#previewTaskGroups').onclick();assert.match(h.node('#taskGroupConfigStatus').textContent,/5–60/);
});

test('task-group configuration read, preview and save failures remain isolated and require fresh preview',async()=>{
 const task=taskFixture();let failRead=true,failPreview=true,failSave=true;
 const h=harness({},null,null,async(_path,init)=>{
  if(init.method==='GET')return failRead?taskReply({error:'<read failed>'},false):taskReply(task);
  if(init.method==='POST')return failPreview?taskReply({error:'<preview failed>'},false):taskReply({...task,policy:taskPolicy(init.body)});
  return failSave?taskReply({error:'revision conflict'},false):taskReply({...task,policy:taskPolicy(init.body,1)});
 });await tick();const overview=h.node('#overview').innerHTML;assert.match(h.node('#taskGroupStatus').textContent,/读取失败/);
 await h.node('#openTaskGroupConfig').onclick();assert.equal(h.node('#previewTaskGroups').disabled,true);assert.equal(h.node('#retryTaskGroupConfig').hidden,false);
 failRead=false;await h.node('#retryTaskGroupConfig').onclick();await h.node('#previewTaskGroups').onclick();assert.match(h.node('#taskGroupConfigStatus').textContent,/预览失败.*<preview failed>/);assert.equal(h.node('#saveTaskGroups').disabled,true);
 failPreview=false;await h.node('#previewTaskGroups').onclick();await h.node('#saveTaskGroups').onclick();assert.match(h.node('#taskGroupConfigStatus').textContent,/保存失败.*revision conflict/);assert.equal(h.node('#saveTaskGroups').disabled,true);
 failSave=false;await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);await h.node('#previewTaskGroups').onclick();await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,2);
 assert.equal(h.node('#overview').innerHTML,overview);assert.equal(h.node('#taskGroupDialog').open,true);
});
test('legacy policy settings migrate to project scope and changed settings or a newer revision require another preview',async()=>{
 let task=taskFixture();task.policy=taskPolicy({revision:6,enabled:true,enrollmentMode:'selected',sourcePilotIds:['p2'],reviewTarget:50,admitNewAccounts:false});
 const h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:taskPolicy(init.body),preview:true}));await tick();await h.node('#openTaskGroupConfig').onclick();
 assert.equal(h.node('#taskGroupReviewTarget').value,50);assert.equal(h.node('#taskGroupAdmitNew').checked,false);assert.match(h.node('#taskGroupProjectSummary').textContent,/当前沿用原计划范围/);
 await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.revision,6);assert.equal(h.requests.at(-1).body.enrollmentMode,'project');assert.equal(h.requests.at(-1).body.projectId,'psychology-project');assert.equal('sourcePilotIds' in h.requests.at(-1).body,false);
 h.node('#taskGroupReviewTarget').value=51;h.node('#taskGroupReviewTarget').listeners.input();assert.equal(h.node('#saveTaskGroups').disabled,true);await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.reviewTarget,51);
 h.node('#taskGroupEnabled').checked=false;h.node('#taskGroupEnabled').listeners.change();assert.equal(h.node('#saveTaskGroups').disabled,true);await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.enabled,false);
 task={...task,policy:{...task.policy,revision:7}};await h.run('loadTaskGroups()');await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,0);assert.match(h.node('#taskGroupConfigStatus').textContent,/版本已变化/);
});
test('task-group summaries refresh even if the parallel execution report read fails',async()=>{
 const task=taskFixture(),h=harness({},null,null,async()=>taskReply(task));await tick();const execution=h.node('#overview').innerHTML;
 task.totals={...task.totals,enrolled:160};h.fail();await h.node('#reload').onclick();await tick();
 assert.equal(h.node('#overview').innerHTML,execution);assert.match(h.node('#status').textContent,/保留上次数据/);assert.match(h.node('#taskGroupSummary').innerHTML,/纳入账号<\/span><strong>160/);assert.doesNotMatch(h.node('#taskGroupStatus').textContent,/读取失败/);
});
test('expired task cycles show ended state and future membership scope without changing execution-plan status',async()=>{
 const task=taskFixture();task.policy={...taskPolicy({revision:3,enabled:true,sourcePilotIds:['p1'],reviewTarget:60,admitNewAccounts:true}),startsAt:1,endsAt:2};
 const h=harness({},null,null,async()=>taskReply(task));await tick();
 assert.match(h.node('#taskGroupStatus').textContent,/本轮已结束/);assert.doesNotMatch(h.node('#taskGroupStatus').textContent,/已启用/);assert.match(h.node('#taskGroupStatus').textContent,/展示已保存的下一次生效账号分层.*具体账号以生效时间为准/);
 assert.match(h.node('#compare').innerHTML,/运行中/);assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
});

test('disabling task-group management previews and patches only task policy, with clear original-plan pause guidance',async()=>{
 const task=taskFixture();task.policy={...taskPolicy({revision:3,enabled:true,sourcePilotIds:['p1'],reviewTarget:60,admitNewAccounts:true}),endsAt:Date.now()+7*86400000};
 const h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:{...task.policy,...init.body,revision:init.method==='PATCH'?4:3}}));await tick();await h.node('#openTaskGroupConfig').onclick();
 h.node('#taskGroupEnabled').checked=false;h.node('#taskGroupEnabled').listeners.change();await h.node('#previewTaskGroups').onclick();await h.node('#saveTaskGroups').onclick();
 const mutations=h.requests.filter(r=>r.method!=='GET');assert.deepEqual(mutations.map(r=>r.path),['/api/psychology-autopilot/task-groups/preview','/api/psychology-autopilot/task-groups']);assert.ok(mutations.every(r=>r.body.enabled===false));
 assert.match(h.node('#taskGroupStatus').textContent,/未启用/);assert.match(h.node('#compare').innerHTML,/运行中/);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');assert.match(html,/id="taskGroupEnabled"[^>]*aria-describedby="taskGroupEnableHelp"/);assert.match(html,/关闭项目自动运营不会暂停原发布计划；停发请使用计划或账号的暂停操作/);
});
test('missing project authorization cannot be previewed or saved and can be retried without affecting original plans',async()=>{
 const task=taskFixture();task.project=null;const h=harness({},null,null,async()=>taskReply(task));await tick();const plans=h.node('#compare').innerHTML;
 await h.node('#openTaskGroupConfig').onclick();assert.match(h.node('#taskGroupConfigStatus').textContent,/绑定项目不可用/);assert.equal(h.node('#previewTaskGroups').disabled,true);assert.equal(h.node('#retryTaskGroupConfig').hidden,false);
 await h.node('#previewTaskGroups').onclick();await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
 task.project={id:'psychology-project',name:'<心理学>'};await h.node('#retryTaskGroupConfig').onclick();await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.projectId,'psychology-project');assert.match(h.node('#taskGroupPreview').innerHTML,/&lt;心理学&gt;/);assert.doesNotMatch(h.node('#taskGroupPreview').innerHTML,/<心理学>/);assert.equal(h.node('#compare').innerHTML,plans);
});

test('Pacific dates use DST-aware PDT and PST with Beijing comparison, including repeated fall-back hours',async()=>{
 const h=harness();await tick();
 const summer=h.run("zonedTime(Date.parse('2026-07-15T15:00:00Z'),'America/Los_Angeles')");
 const winter=h.run("zonedTime(Date.parse('2026-01-15T16:00:00Z'),'America/Los_Angeles')");
 assert.match(summer,/07\/15 08:00.*PDT.*07\/15 23:00 北京时间/);assert.match(winter,/01\/15 08:00.*PST.*01\/16 00:00 北京时间/);
 const first=h.run("zonedTime(Date.parse('2026-11-01T08:30:00Z'),'America/Los_Angeles')"),second=h.run("zonedTime(Date.parse('2026-11-01T09:30:00Z'),'America/Los_Angeles')");
 assert.match(first,/11\/01 01:30.*PDT.*16:30 北京时间/);assert.match(second,/11\/01 01:30.*PST.*17:30 北京时间/);
 assert.equal(h.run("zonedTime(null,'America/Los_Angeles')"),'—');
});

test('stored Beijing policy remains Beijing until Pacific selection invalidates preview and freezes the new save body',async()=>{
 const task=taskFixture();task.policy={...taskPolicy({revision:4,enabled:true,enrollmentMode:'project',projectId:task.project.id,reviewTarget:60,admitNewAccounts:true}),timeZone:'Asia/Shanghai'};
 const h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:{...task.policy,...init.body,startsAt:Date.parse('2026-10-02T07:00:00Z'),endsAt:Date.parse('2026-10-09T07:00:00Z'),nextReviewAt:Date.parse('2026-10-05T07:00:00Z')},effectiveAt:Date.parse('2026-10-02T07:00:00Z')}));await tick();await h.node('#openTaskGroupConfig').onclick();
 assert.equal(h.node('#taskGroupTimeZone').value,'Asia/Shanghai');await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.timeZone,'Asia/Shanghai');
 h.node('#taskGroupTimeZone').value='America/Los_Angeles';h.node('#taskGroupTimeZone').listeners.change();assert.equal(h.node('#saveTaskGroups').disabled,true);await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,0);
 assert.match(h.node('#taskGroupTimeZoneHint').textContent,/08:00 \/ 11:30 \/ 20:00.*PDT\/PST/);assert.doesNotMatch(h.node('#taskGroupTimeZoneHint').textContent,/13:00/);
 await h.node('#previewTaskGroups').onclick();const preview=h.requests.at(-1);assert.equal(preview.body.timeZone,'America/Los_Angeles');assert.match(h.node('#taskGroupPreview').innerHTML,/08:00 \/ 11:30 \/ 20:00/);assert.match(h.node('#taskGroupPreview').innerHTML,/10\/02 00:00.*PDT.*10\/02 15:00 北京时间/);
 await h.node('#saveTaskGroups').onclick();assert.deepEqual(h.requests.filter(r=>r.method==='PATCH')[0].body,preview.body);assert.match(h.node('#taskGroupStatus').textContent,/10\/05 00:00.*10\/05 15:00 北京时间/);assert.match(h.node('#taskGroupConfigStatus').textContent,/10\/02 00:00.*PDT.*15:00 北京时间/);
});

test('Pacific role membership shows its individual effective date in Pacific and Beijing',async()=>{
 const task=taskFixture();task.policy={...taskPolicy({revision:4,enabled:true}),timeZone:'America/Los_Angeles'};
 const h=harness({},null,null,async path=>taskReply(path.includes('?')?{...task,membership:{page:1,total:1,totalPages:1,rows:[{name:'member',role:'launch',accountPool:'observing',effectiveAt:Date.parse('2026-10-03T07:00:00Z'),paused:true,reason:'preserved pause'}]}}:task));await tick();clickTaskRole(h,'launch');await tick();
 assert.match(h.node('#taskGroupMemberTable').innerHTML,/10\/03 00:00.*PDT.*10\/03 15:00 北京时间/);assert.match(h.node('#taskGroupMemberTable').innerHTML,/已暂停.*preserved pause/);
});

test('manual schedule editor uses pending timezone and submits local clocks plus timezone while reports retain Beijing dates',async()=>{
 const slots=[{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}],effectiveAt=Date.parse('2026-10-02T07:00:00Z');
 const pilot={id:'p',groupId:'g',groupName:'Group',status:'active',accounts:[],schedule:[{slotAt:Date.parse('2026-10-03T15:00:00Z'),status:'created',counts:{}}],attention:[],logs:[],slots:[{hour:8,minute:0},{hour:14,minute:0},{hour:20,minute:0}],pendingSlots:slots,timeZone:'Asia/Shanghai',pendingTimeZone:'America/Los_Angeles',scheduleEffectiveAt:effectiveAt,endsAt:Date.parse('2026-10-09T07:00:00Z')};
 const h=harness({pilots:[pilot]},null,async body=>({slots:body.slots,timeZone:body.timeZone,effectiveAt}));await tick();
 assert.match(h.node('#pilots').innerHTML,/08:00 \/ 14:00 \/ 20:00（北京时间）/);assert.match(h.node('#pilots').innerHTML,/08:00 \/ 11:30 \/ 20:00（美国太平洋时间）/);assert.match(h.node('#pilots').innerHTML,/10\/03 08:00.*PDT.*10\/03 23:00 北京时间/);assert.match(h.node('#pilots').innerHTML,/统计日期按北京时间/);
 h.run("openSchedule('p')");assert.equal(h.node('#editTimeZone').value,'America/Los_Angeles');await h.node('#scheduleForm').listeners.submit({preventDefault(){}});
 assert.deepEqual(h.requests.find(r=>r.method==='PATCH').body,{slots,timeZone:'America/Los_Angeles'});assert.match(h.node('#scheduleStatus').textContent,/10\/02 00:00.*PDT.*15:00 北京时间/);assert.match(h.node('#scheduleZoneHint').textContent,/项目自动运营期间须保持项目时区及每天3条/);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');assert.match(html,/统计时间（北京时间）/);
});

test('new manual plans freeze an explicit Pacific timezone and 11:30 lunch rather than converting local input to Beijing',async()=>{
 const h=harness({pilots:[],groups:batchGroups.slice(0,1)},async()=>({run:{batches:[],errors:[]}}));await tick();settings(h);h.node('#createTimeZone').value='America/Los_Angeles';h.node('#defaultDailyCount').listeners.change({target:{value:'3'}});
 for(const [index,value] of ['08:00','11:30','20:00'].entries())h.events.change({target:{dataset:{timeScope:'default',timeIndex:String(index)},value}});
 h.node('#selectAllGroups').onclick();h.node('#applySchedule').onclick();await submit(h);const body=h.requests.find(r=>r.method==='POST').body;
 assert.equal(body.timeZone,'America/Los_Angeles');assert.deepEqual(body.slots,[{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}]);
});


test('failed schedule save restores timezone and local inputs for editing and retry',async()=>{
 const slots=[{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}],effectiveAt=Date.parse('2026-10-02T07:00:00Z');
 const pilot={id:'p',groupId:'g',groupName:'Group',status:'active',accounts:[],schedule:[],attention:[],logs:[],slots,timeZone:'America/Los_Angeles'};
 let release,attempts=0;const gate=new Promise(resolve=>release=resolve);
 const h=harness({pilots:[pilot]},null,async body=>{if(++attempts===1){await gate;throw Error('项目自动运营期间须保持项目时区及每天3条，请在项目设置中统一调整时区。');}return {slots:body.slots,timeZone:body.timeZone,effectiveAt};});await tick();
 const inputs=[h.node('#editDailyCount'),h.node('#editLocalTime')],zone=h.node('#editTimeZone');
 h.document.querySelectorAll=selector=>selector==='#scheduleForm input, #scheduleForm select'?[...inputs,zone]:selector==='#scheduleForm input'?inputs:[];
 h.run("openSchedule('p')");const pending=h.node('#scheduleForm').listeners.submit({preventDefault(){}});await tick();
 assert.ok([...inputs,zone].every(input=>input.disabled));assert.equal(h.node('#saveSchedule').disabled,true);
 release();await pending;assert.match(h.node('#scheduleStatus').textContent,/项目自动运营期间须保持项目时区/);
 assert.ok([...inputs,zone].every(input=>input.disabled===false));assert.equal(h.node('#saveSchedule').disabled,false);
 zone.value='Asia/Shanghai';zone.listeners.change();await h.node('#scheduleForm').listeners.submit({preventDefault(){}});
 const patches=h.requests.filter(request=>request.method==='PATCH');assert.equal(patches.length,2);assert.deepEqual(patches.map(request=>request.body.timeZone),['America/Los_Angeles','Asia/Shanghai']);assert.deepEqual(patches[1].body.slots,slots);
 assert.match(h.node('#scheduleStatus').textContent,/已保存/);assert.ok([...inputs,zone].every(input=>input.disabled===false));
 h.run("openSchedule('p')");assert.equal(zone.disabled,false);
});


test('saving project Pacific settings immediately refreshes original-plan pending timezone and 11:30 slots',async()=>{
 const oldSlots=[{hour:8,minute:0},{hour:14,minute:0},{hour:20,minute:0}],newSlots=[{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}],effectiveAt=Date.parse('2026-10-02T07:00:00Z');
 const pilots=[{id:'p',groupId:'g',groupName:'Group',status:'active',accounts:[],schedule:[],attention:[],logs:[],slots:oldSlots,pendingSlots:oldSlots,timeZone:'Asia/Shanghai',pendingTimeZone:'Asia/Shanghai',scheduleEffectiveAt:Date.parse('2026-10-02T00:00:00+08:00')}];
 const task=taskFixture();task.policy={...taskPolicy({revision:2,enabled:true,enrollmentMode:'project',projectId:task.project.id,reviewTarget:60,admitNewAccounts:true}),timeZone:'Asia/Shanghai'};
 const h=harness({pilots},null,null,async(_path,init)=>{
  if(init.method==='GET')return taskReply(task);
  const result={...task,policy:{...taskPolicy(init.body,init.method==='PATCH'?3:2),timeZone:'America/Los_Angeles',startsAt:effectiveAt},effectiveAt};
  if(init.method==='PATCH')pilots[0]={...pilots[0],pendingSlots:newSlots,pendingTimeZone:'America/Los_Angeles',scheduleEffectiveAt:effectiveAt};
  return taskReply(result);
 });await tick();h.node('#period').value='7d';h.node('#period').listeners.change();await tick();
 await h.node('#openTaskGroupConfig').onclick();h.node('#taskGroupTimeZone').value='America/Los_Angeles';h.node('#taskGroupTimeZone').listeners.change();await h.node('#previewTaskGroups').onclick();
 const before=h.requests.length;await h.node('#saveTaskGroups').onclick();
 assert.deepEqual(h.requests.slice(before).map(request=>[request.method,request.path]),[['PATCH','/api/psychology-autopilot/task-groups'],['GET','/api/psychology-autopilot?period=7d']]);
 assert.equal(h.run('data.pilots[0].pendingTimeZone'),'America/Los_Angeles');assert.ok(h.node('#pilots').innerHTML.includes('新设置：每天 3 条 · 08:00 / 11:30 / 20:00（美国太平洋时间）'));assert.ok(h.node('#pilots').innerHTML.includes('08:00 / 14:00 / 20:00（北京时间）'));
 assert.match(h.node('#taskGroupConfigStatus').textContent,/^已保存：/);assert.match(h.node('#taskGroupPreview').innerHTML,/已保存的实际配置/);assert.equal(h.run('taskGroupsData.policy.revision'),3);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');assert.match(html,/统计日期按北京时间；排期同时标注运营时区/);assert.doesNotMatch(html,/日期均为北京时间/);
});

test('original-plan refresh failure after saving preserves the successful project setting and last plan data',async()=>{
 const task=taskFixture(),h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:taskPolicy(init.body,init.method==='PATCH'?3:0)}));await tick();
 const plans=h.node('#pilots').innerHTML;await h.node('#openTaskGroupConfig').onclick();await h.node('#previewTaskGroups').onclick();h.fail();await h.node('#saveTaskGroups').onclick();
 assert.match(h.node('#taskGroupConfigStatus').textContent,/^已保存：/);assert.doesNotMatch(h.node('#taskGroupConfigStatus').textContent,/保存失败/);assert.match(h.node('#taskGroupPreview').innerHTML,/已保存的实际配置/);assert.equal(h.run('taskGroupsData.policy.revision'),3);
 assert.equal(h.node('#pilots').innerHTML,plans);assert.match(h.node('#status').textContent,/更新失败，保留上次数据：offline/);assert.equal(h.node('#saveTaskGroups').disabled,true);assert.equal(h.run('taskConfigBusy'),false);
 assert.equal(h.requests.filter(request=>request.method==='PATCH').length,1);assert.equal(h.requests.at(-1).path,'/api/psychology-autopilot');
});


const capacityFixture=overrides=>({policy:'adaptive-v1',asOf:Date.parse('2026-09-30T01:00:00Z'),leadMs:2*3600000,requiredLeadMs:2*3600000,forecastJobs:861,backlogJobs:45,accountCount:287,sampleCount:0,serviceMs:5*60000,capacityRisk:false,shortLead:false,reason:'样本不足，采用保守估算',...overrides});

test('missing generation-capacity fields preserve the legacy UI without inventing an estimate or extra reads',async()=>{
 const h=harness();await tick();assert.equal(h.node('#productionCapacity').hidden,true);assert.equal(h.node('#productionCapacity').innerHTML,'');
 assert.equal(h.requests.length,2);assert.ok(h.requests.every(request=>request.method==='GET'));assert.match(h.node('#overview').innerHTML,/今天已排/);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');assert.match(html,/id="productionCapacity"[^>]*role="status"/);assert.doesNotMatch(html,/每条提前 2 小时|生成提前 2 小时|距当前 2 小时/);assert.doesNotMatch(h.node('#rules').innerHTML,/每条提前 2 小时/);
});

test('adaptive generation shows the current account and shared-backlog estimate with a conservative prior',async()=>{
 const h=harness({productionCapacity:capacityFixture(),window:{period:'yesterday',from:'2026-09-29',to:'2026-09-29'}});await tick();
 const html=h.node('#productionCapacity').innerHTML;assert.equal(h.node('#productionCapacity').hidden,false);assert.match(html,/最近检查预计提前 2 小时/);assert.match(html,/参与账号 287 个.*同窗口预估任务 861 条.*共享积压 45 条/);
 assert.match(html,/完成样本不足20条，采用保守估算.*至少5分钟/);assert.match(html,/完成样本 0 条/);assert.doesNotMatch(html,/P95|不能保证准时/);assert.match(html,/最近检查估算与所选统计日期无关/);assert.match(html,/每天检查3次.*美西05:00.*08:30.*17:00.*只提前、不推迟.*任务按保存的生成时间执行/);
 assert.equal(h.requests.length,2);assert.ok(h.requests.every(request=>request.method==='GET'));
});

test('capacity and short-window risks escape server reasons and refresh from the existing status GET',async()=>{
 const capacity=capacityFixture({leadMs:3*3600000,requiredLeadMs:13*3600000,sampleCount:20,serviceMs:6*60000,capacityRisk:true,shortLead:true,reason:'<img src=x onerror=alert(1)> queue'}),h=harness({productionCapacity:capacity});await tick();
 let html=h.node('#productionCapacity').innerHTML;assert.match(html,/最近检查预计提前 3 小时/);assert.match(html,/最近7天P95单条耗时 6 分钟参考/);assert.doesNotMatch(html,/样本不足20条/);assert.match(html,/积压风险.*临近排期准备时间偏短.*估算所需 13 小时.*上限3小时.*不能保证准时/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt; queue/);assert.doesNotMatch(html,/<img/);
 Object.assign(capacity,{leadMs:2.5*3600000,requiredLeadMs:2.5*3600000,capacityRisk:false,shortLead:false,reason:'队列已更新'});await h.node('#reload').onclick();html=h.node('#productionCapacity').innerHTML;
 assert.match(html,/最近检查预计提前 2\.5 小时/);assert.match(html,/队列已更新/);assert.doesNotMatch(html,/积压风险|临近排期准备时间偏短|&lt;img/);
 assert.deepEqual(h.requests.map(request=>request.path),['/api/psychology-autopilot','/api/psychology-autopilot/task-groups','/api/psychology-autopilot','/api/psychology-autopilot/task-groups']);assert.ok(h.requests.every(request=>request.method==='GET'));
});

test('slot detail shows each saved generation start across DST independently of the current capacity estimate',async()=>{
 const slot=Date.parse('2026-11-01T11:00:00Z'),items=[
  {account:'first',title:'A',version:'原版',scheduleAt:slot,generationStartAt:Date.parse('2026-11-01T08:30:00Z'),productionLeadMs:2.5*3600000,productionPolicy:'adaptive-v1',productionRisk:true,state:'queued'},
  {account:'second',title:'B',version:'原版',scheduleAt:slot,generationStartAt:Date.parse('2026-11-01T09:30:00Z'),productionLeadMs:1.5*3600000,productionPolicy:'adaptive-v1',productionRisk:false,state:'queued'},
  {account:'historical',title:'C',version:'原版',scheduleAt:slot,generationStartAt:null,productionLeadMs:2*3600000,productionPolicy:'adaptive-v1',state:'published'}
 ];
 const pilots=[{id:'p',groupId:'g',groupName:'Group',status:'active',accounts:[],schedule:[],attention:[],logs:[],timeZone:'Asia/Shanghai',pendingTimeZone:'America/Los_Angeles',scheduleEffectiveAt:Date.parse('2026-10-02T07:00:00Z')}];
 const h=harness({pilots,items,productionCapacity:capacityFixture()});await tick();await h.run("detail('p',"+slot+")");
 const html=h.node('#body-p-'+slot).innerHTML;assert.match(html,/<th scope="col">计划开始生成<\/th>/);assert.match(html,/等待中可安全提前，发布时间保持原计划/);
 const rows=html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>.*?<\/tr>/g),cells=rows.map(row=>[...row.matchAll(/<td>(.*?)<\/td>/g)].map(match=>match[1]));
 assert.match(cells[0][2],/11\/01 03:00.*PST.*11\/01 19:00 北京时间/);assert.match(cells[0][3],/11\/01 01:30.*PDT.*11\/01 16:30 北京时间/);assert.match(cells[0][3],/计划提前 2\.5 小时.*动态估算.*准备时间可能不足/);
 assert.match(cells[1][3],/11\/01 01:30.*PST.*11\/01 17:30 北京时间/);assert.doesNotMatch(cells[1][3],/准备时间可能不足/);assert.equal(cells[2][3],'—');assert.match(h.node('#productionCapacity').innerHTML,/最近检查预计提前 2 小时/);
 assert.equal(h.requests.length,3);assert.equal(h.requests.at(-1).path,'/api/psychology-autopilot/p/slots/'+slot);assert.ok(h.requests.every(request=>request.method==='GET'));
});


test('project preview explains next-local-day admission and respects turning new-account admission off',async()=>{
 const task=taskFixture(),h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:taskPolicy(init.body),preview:true}));await tick();await h.node('#openTaskGroupConfig').onclick();await h.node('#previewTaskGroups').onclick();
 assert.equal(h.requests.at(-1).body.admitNewAccounts,true);assert.match(h.node('#taskGroupPreview').innerHTML,/新授权账号默认从美国太平洋时间次日的新一期排期开始参与，不插入当天任务/);
 h.node('#taskGroupAdmitNew').checked=false;h.node('#taskGroupAdmitNew').listeners.change();await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.admitNewAccounts,false);assert.match(h.node('#taskGroupPreview').innerHTML,/暂不自动纳入新授权账号/);assert.doesNotMatch(h.node('#taskGroupPreview').innerHTML,/新授权账号默认从.*次日/);
 assert.equal(h.requests.filter(request=>request.method==='PATCH').length,0);
});


test('a missing saved capacity snapshot explains the three daily Pacific checks without a live estimate',async()=>{
 const h=harness({productionCapacity:null});await tick();assert.equal(h.node('#productionCapacity').hidden,false);assert.match(h.node('#productionCapacity').innerHTML,/尚未完成生成准备检查；每天美西05:00.*08:30.*17:00更新/);assert.doesNotMatch(h.node('#productionCapacity').innerHTML,/预计提前|每分钟|每5分钟/);assert.equal(h.requests.length,2);assert.ok(h.requests.every(request=>request.method==='GET'));
});
