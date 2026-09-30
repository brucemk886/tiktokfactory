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
const taskFixture=()=>({policy:null,effectiveAt:Date.parse('2026-10-02T00:00:00+08:00'),groups:taskRoles.map(role=>({id:role,role,label:role==='review'?'内容评审组':role,action:'保持资格校验',accounts:role==='review'?60:0,active:role==='review'?58:0,paused:role==='review'?2:0})),totals:{eligible:175,enrolled:175,excluded:5,blocked:2},candidates:[{id:'p1',groupId:'g1',groupName:'<第一组>',status:'active',poolReady:true},{id:'p2',groupId:'g2',groupName:'第二组',status:'paused',poolReady:true},{id:'p3',groupId:'g3',groupName:'非匹配组',status:'active',poolReady:false}]});
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

test('enabling task groups requires a preview with selected eligible plans and saves the exact revision-bound body',async()=>{
 const task=taskFixture();let saved;
 const h=harness({},null,null,async(_path,init)=>{
  if(init.method==='GET')return taskReply(task);
  if(init.method==='POST')return taskReply({...task,policy:taskPolicy(init.body),preview:true});
  saved=init.body;return taskReply({...task,policy:taskPolicy(init.body,1),effectiveAt:Date.parse('2026-10-03T00:00:00+08:00')});
 });await tick();await h.node('#openTaskGroupConfig').onclick();
 assert.equal(h.node('#taskGroupEnabled').checked,true);assert.equal(h.node('#taskGroupAdmitNew').checked,true);assert.equal(h.node('#taskGroupReviewTarget').value,60);
 assert.match(h.node('#taskGroupPilotChoices').innerHTML,/&lt;第一组&gt;/);assert.match(h.node('#taskGroupPilotChoices').innerHTML,/data-task-pilot="p3" disabled/);
 await h.node('#saveTaskGroups').onclick();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,0);
 await h.node('#previewTaskGroups').onclick();const preview=h.requests.find(r=>r.path.endsWith('/task-groups/preview'));
 assert.deepEqual(preview.body,{revision:0,enabled:true,sourcePilotIds:['p1','p2'],reviewTarget:60,admitNewAccounts:true});
 assert.match(h.node('#taskGroupPreview').innerHTML,/纳入 175 个账号.*排除 5 个账号.*待处理 2 个账号/);assert.equal(h.node('#saveTaskGroups').disabled,false);
 await h.node('#saveTaskGroups').onclick();assert.deepEqual(saved,preview.body);assert.match(h.node('#taskGroupConfigStatus').textContent,/已保存：10\/03/);assert.match(h.node('#taskGroupPreview').innerHTML,/已保存的实际配置/);assert.equal(h.node('#saveTaskGroups').disabled,true);
 assert.equal(h.requests.filter(r=>r.method==='POST').length,1,'the preview never creates a publishing plan');
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
test('existing task policy selections and revision are preserved; source edits and a newer revision require another preview',async()=>{
 let task=taskFixture();task.policy=taskPolicy({revision:6,enabled:true,sourcePilotIds:['p2'],reviewTarget:50,admitNewAccounts:false});
 const h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:taskPolicy(init.body),preview:true}));await tick();await h.node('#openTaskGroupConfig').onclick();
 assert.equal(h.node('#taskGroupReviewTarget').value,50);assert.equal(h.node('#taskGroupAdmitNew').checked,false);assert.equal(h.run('[...selectedTaskPilots].join()'),'p2');
 await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.at(-1).body.revision,6);
 h.node('#taskGroupPilotChoices').listeners.change({target:{dataset:{taskPilot:'p2'},checked:false,matches:()=>true}});assert.equal(h.node('#saveTaskGroups').disabled,true);
 const before=h.requests.length;await h.node('#previewTaskGroups').onclick();assert.equal(h.requests.length,before);assert.match(h.node('#taskGroupConfigStatus').textContent,/至少选择/);
 h.node('#taskGroupSelectAll').onclick();await h.node('#previewTaskGroups').onclick();assert.deepEqual(h.requests.at(-1).body.sourcePilotIds,['p1','p2']);
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
 assert.match(h.node('#taskGroupStatus').textContent,/本轮已结束/);assert.doesNotMatch(h.node('#taskGroupStatus').textContent,/已启用/);assert.match(h.node('#taskGroupStatus').textContent,/展示已保存的下一次生效分组.*具体账号以生效时间为准/);
 assert.match(h.node('#compare').innerHTML,/运行中/);assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
});

test('disabling task-group management previews and patches only task policy, with clear original-plan pause guidance',async()=>{
 const task=taskFixture();task.policy={...taskPolicy({revision:3,enabled:true,sourcePilotIds:['p1'],reviewTarget:60,admitNewAccounts:true}),endsAt:Date.now()+7*86400000};
 const h=harness({},null,null,async(_path,init)=>taskReply(init.method==='GET'?task:{...task,policy:{...task.policy,...init.body,revision:init.method==='PATCH'?4:3}}));await tick();await h.node('#openTaskGroupConfig').onclick();
 h.node('#taskGroupEnabled').checked=false;h.node('#taskGroupEnabled').listeners.change();await h.node('#previewTaskGroups').onclick();await h.node('#saveTaskGroups').onclick();
 const mutations=h.requests.filter(r=>r.method!=='GET');assert.deepEqual(mutations.map(r=>r.path),['/api/psychology-autopilot/task-groups/preview','/api/psychology-autopilot/task-groups']);assert.ok(mutations.every(r=>r.body.enabled===false));
 assert.match(h.node('#taskGroupStatus').textContent,/未启用/);assert.match(h.node('#compare').innerHTML,/运行中/);
 const html=fs.readFileSync(new URL('../public/psychology-autopilot.html',import.meta.url),'utf8');assert.match(html,/id="taskGroupEnabled"[^>]*aria-describedby="taskGroupEnableHelp"/);assert.match(html,/关闭任务组不会暂停原发布计划；停发请使用计划或账号的暂停操作/);
});