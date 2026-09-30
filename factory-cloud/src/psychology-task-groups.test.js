import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { kvSet } from './kv.js';
import { handleTaskGroups,reconcileTaskGroups,taskAssignmentsFor } from './psychology-task-groups.js';

const DAY=86400000,at=(date,time='00:00')=>Date.parse(date+'T'+time+':00+08:00');
const now=at('2026-09-30','12:00'),starts=at('2026-10-02'),slots=[{hour:8,minute:0},{hour:14,minute:0},{hour:20,minute:0}];
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-autopilot','psychology-publish']};
const base='/api/psychology-autopilot/task-groups';
async function setup(t){
 const f=await fixture(t);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=? WHERE username=?').run(JSON.stringify(user.sidebarModules),'admin');
 await kvSet(f.db,'official-account-groups',{projects:[{id:'proj-psych',name:'Psych',moduleKey:'psychology'},{id:'proj-novel',name:'Novel',moduleKey:'novel-promotion'}],
  groups:[{id:'g',name:'Selected',projectId:'proj-psych'},{id:'spare',name:'Spare',projectId:'proj-psych'},{id:'new-group',name:'New group',projectId:'proj-psych'},{id:'other',name:'Novel',projectId:'proj-novel'}],aliases:{alpha:'a'}});
 for(const [id,group] of [['a','g'],['b','g'],['c','spare'],['outside','other']])f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES (?,?)').run(id,group);
 const directory={accounts:['a','b','c','outside','alpha'].map(id=>({id,scopes:['video.publish']}))};
 function pilot(id='source',group='g',extra={}){const row={id,owner:'admin',group_id:group,group_name:group,strategy:'evolve',current_strategy:'pools',strategy_started_at:starts,slots_json:JSON.stringify(slots),status:'active',ends_at:starts+7*DAY,created_at:now,updated_at:now,...extra};
  const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO psychology_autopilots(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));return row;}
 pilot();
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES ('source',?,'created',0)").run(at('2026-10-01','20:00'));
 function sample(id,n,views=600){for(let i=0;i<n;i++)f.sqlite.prepare(`INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion)
  VALUES(?,?,?,'photo',?,?,?,'','classic','fixed-copy','published',?,0.2)`).run('fact-'+id+'-'+i,'history','tiktok:'+id,now-4*DAY,now-4*DAY,'source-'+i,views);}
 sample('a',6);sample('b',3);
 async function call(method='GET',body,path=base,time=now,actor=user){const request=new Request('https://factory.test'+path,{method,...(body?{body:JSON.stringify(body)}:{})});const response=await handleTaskGroups(request,f.env,new URL(request.url),actor,{directory,now:time});return {status:response.status,data:await response.json()};}
 const config={revision:0,enabled:true,sourcePilotIds:['source'],reviewTarget:60,admitNewAccounts:true};
 async function activate(){const result=await call('PATCH',config);assert.equal(result.status,200,JSON.stringify(result));return result.data;}
 function add(id,group='new-group'){f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES (?,?)').run(id,group);directory.accounts.push({id,scopes:['video.publish']});}
 return {...f,directory,call,config,activate,add,pilot,sample};
}

test('preview is read-only, bootstrap scopes exact accounts and retains frozen execution and pause',async t=>{
 const f=await setup(t);f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES ('source','a','paused','manual',?)").run(now);
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const preview=await f.call('POST',f.config,base+'/preview');assert.equal(preview.status,200);assert.equal(preview.data.preview,true);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
 assert.equal(preview.data.policy.revision,0);assert.equal(preview.data.policy.startsAt,starts);assert.equal(preview.data.policy.endsAt,starts+7*DAY);
 assert.deepEqual(preview.data.totals,{enrolled:2,excluded:1,eligible:3,blocked:0});
 const saved=await f.activate();assert.equal(saved.policy.revision,1);assert.equal(saved.groups.find(g=>g.role==='observing').accounts,1);
 assert.equal(saved.groups.find(g=>g.role==='strong').paused,1);
 const registry=f.sqlite.prepare('SELECT * FROM psychology_task_group_accounts ORDER BY connection_id').all();
 assert.deepEqual(registry.map(r=>r.connection_id),['a','b','c']);assert.ok(registry.every(r=>r.first_seen_at===now));
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_autopilot_slots WHERE autopilot_id='source'").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT status FROM psychology_autopilot_accounts WHERE connection_id='a'").get().status,'paused');
 assert.equal(f.sqlite.prepare("SELECT task_group_policy_id FROM psychology_autopilots WHERE id='source'").get().task_group_policy_id,saved.policy.id);
 assert.equal(f.requests.length,0);
});

test('CAS, current-cycle source removal and three-slot guard reject without partial writes',async t=>{
 const f=await setup(t),saved=await f.activate();
 assert.equal((await f.call('PATCH',f.config)).status,409);
 const removed=await f.call('PATCH',{...f.config,revision:1,sourcePilotIds:[]});assert.equal(removed.status,409);assert.match(removed.data.error,/不能移除/);
 f.sqlite.prepare("UPDATE psychology_autopilots SET slots_json=? WHERE id='source'").run(JSON.stringify(slots.slice(0,2)));
 const short=await f.call('PATCH',{...f.config,revision:1});assert.equal(short.status,409);assert.match(short.data.error,/每天发布3条/);
 assert.equal(f.sqlite.prepare('SELECT revision FROM psychology_task_group_policies').get().revision,saved.policy.revision);
});

test('new connections are future enrolled, initial exclusions stay excluded, conflict groups report blocked',async t=>{
 const f=await setup(t),saved=await f.activate();f.add('d');f.add('e','spare');f.pilot('unselected','spare');
 const result=await reconcileTaskGroups(f.env,user,f.directory,now+3600000);
 assert.equal(result.policy.id,saved.policy.id);assert.deepEqual(result.newExecutorGroups.map(g=>g.connectionIds),[['d']]);
 assert.equal(result.totals.enrolled,4);assert.equal(result.totals.excluded,1);assert.equal(result.totals.blocked,1);
 const d=f.sqlite.prepare("SELECT * FROM psychology_task_group_accounts WHERE connection_id='d'").get();assert.ok(d.first_seen_at>now);assert.equal(d.is_new,1);
 assert.equal(f.sqlite.prepare("SELECT excluded FROM psychology_task_group_accounts WHERE connection_id='c'").get().excluded,1);
 const e=f.sqlite.prepare("SELECT reason FROM psychology_task_group_accounts WHERE connection_id='e'").get();assert.match(e.reason,/未纳入任务组/);
 const group=await f.call('GET',null,base+'?group=launch',now+3600000);assert.equal(group.data.membership.total,2);assert.equal(group.data.groups.find(g=>g.role==='launch').accounts,2);
 assert.equal(group.data.membership.rows.find(r=>r.connectionId==='e').blocked,true);
 assert.deepEqual([...await taskAssignmentsFor(f.db,'admin',['d','e'],starts)],[]);
});

test('slot-time role snapshots respect physical movement, pause resume, disable and exact cycle end',async t=>{
 const f=await setup(t),saved=await f.activate();
 assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts-1)).size,0);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts)).get('a').role,'review');
 f.sqlite.prepare("UPDATE psychology_task_group_accounts SET paused=1 WHERE connection_id='a'").run();assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts)).size,0);
 f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,updated_at) VALUES ('source','a','active',?)").run(now+1);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts)).size,1);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='new-group' WHERE account_key='a'").run();assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts)).size,0);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='g' WHERE account_key='a'").run();
 assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],saved.policy.endsAt)).size,0);
 const disabled=await f.call('PATCH',{...f.config,revision:saved.policy.revision,enabled:false});assert.equal(disabled.status,200);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts)).size,0);
 assert.equal(f.sqlite.prepare("SELECT status FROM psychology_autopilots WHERE id='source'").get().status,'active');
});

test('three-day review preserves cycle and future review roles during later enrollment',async t=>{
 const f=await setup(t),saved=await f.activate();
 f.sqlite.prepare("UPDATE ops_task_facts SET views=10 WHERE account_key='tiktok:a'").run();
 const review=await reconcileTaskGroups(f.env,user,f.directory,starts+3*DAY+1000);
 assert.equal(review.policy.startsAt,saved.policy.startsAt);assert.equal(review.policy.endsAt,saved.policy.endsAt);assert.equal(review.policy.lastReviewAt,starts+3*DAY+1000);
 const changed=f.sqlite.prepare("SELECT * FROM psychology_task_group_snapshots WHERE connection_id='a' ORDER BY effective_at DESC LIMIT 1").get();assert.equal(changed.role,'diagnostic');assert.ok(changed.effective_at>starts+3*DAY);
 f.add('d');await reconcileTaskGroups(f.env,user,f.directory,starts+3*DAY+2000);
 assert.equal(f.sqlite.prepare("SELECT role FROM psychology_task_group_snapshots WHERE connection_id='a' ORDER BY effective_at DESC LIMIT 1").get().role,'diagnostic');
 const noop=await reconcileTaskGroups(f.env,user,f.directory,saved.policy.endsAt-1000);assert.equal(noop.policy.endsAt,saved.policy.endsAt);
});

test('configuration changes do not renew the active seven-day cycle; expired cycle requires explicit PATCH',async t=>{
 const f=await setup(t),saved=await f.activate();
 const update=await f.call('PATCH',{...f.config,revision:1,reviewTarget:5},base,starts+DAY);
 assert.equal(update.status,200);assert.equal(update.data.policy.startsAt,saved.policy.startsAt);assert.equal(update.data.policy.endsAt,saved.policy.endsAt);
 f.add('late');const ended=await reconcileTaskGroups(f.env,user,f.directory,saved.policy.endsAt);assert.deepEqual(ended.newExecutorGroups,[]);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_task_group_accounts WHERE connection_id='late'").get().n,0);
});

for(const mutation of ['reserved slot','pilot revision'])test('commit fails closed if '+mutation+' changes after preview reads',async t=>{
 const f=await setup(t),original=f.db.batch.bind(f.db);
 f.db.batch=async statements=>{if(mutation==='reserved slot')f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES ('source',?,'creating',0)").run(starts+8*3600000);
  else f.sqlite.prepare("UPDATE psychology_autopilots SET updated_at=updated_at+1 WHERE id='source'").run();return original(statements);};
 const result=await f.call('PATCH',f.config);assert.equal(result.status,409,JSON.stringify(result));
 for(const table of ['psychology_task_group_policies','psychology_task_group_revisions','psychology_task_group_accounts','psychology_task_group_snapshots'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
 assert.equal(f.sqlite.prepare("SELECT task_group_policy_id FROM psychology_autopilots WHERE id='source'").get().task_group_policy_id,'');
});

test('fresh owner permissions and project singleton cannot be bypassed by stale actor',async t=>{
 const f=await setup(t);f.sqlite.prepare("UPDATE factory_users SET active=0 WHERE username='admin'").run();assert.equal((await f.call('PATCH',f.config)).status,403);
 f.sqlite.prepare("UPDATE factory_users SET active=1 WHERE username='admin'").run();await f.activate();
 f.sqlite.prepare("UPDATE psychology_task_group_policies SET owner='someone-else'").run();assert.equal((await f.call()).status,403);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts)).size,0);
});
test('explicitly selecting a source admits its existing accounts but background discovery never does',async t=>{
 const f=await setup(t);f.pilot('spare-source','spare');
 const first=await f.call('PATCH',{...f.config,enabled:false,sourcePilotIds:[]});assert.equal(first.status,200);assert.equal(first.data.totals.enrolled,0);
 const enabled=await f.call('PATCH',{...f.config,revision:1});assert.equal(enabled.status,200);assert.equal(enabled.data.totals.enrolled,2);assert.equal(enabled.data.totals.excluded,1);
 await reconcileTaskGroups(f.env,user,f.directory,now+1000);assert.equal(f.sqlite.prepare("SELECT excluded FROM psychology_task_group_accounts WHERE connection_id='c'").get().excluded,1);
 const selected=await f.call('PATCH',{...f.config,revision:2,sourcePilotIds:['source','spare-source']});assert.equal(selected.status,200,JSON.stringify(selected));
 assert.equal(selected.data.totals.enrolled,3);assert.equal(f.sqlite.prepare("SELECT excluded FROM psychology_task_group_accounts WHERE connection_id='c'").get().excluded,0);
 assert.equal(f.sqlite.prepare("SELECT task_group_policy_id FROM psychology_autopilots WHERE id='spare-source'").get().task_group_policy_id,selected.data.policy.id);
});

test('disabled or expired policy never admits new accounts and round allocation cannot exceed three',async t=>{
 const f=await setup(t),saved=await f.activate();await f.call('PATCH',{...f.config,revision:1,enabled:false});f.add('d');
 await reconcileTaskGroups(f.env,user,f.directory,now+1000);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_task_group_accounts WHERE connection_id='d'").get().n,0);
 for(let round=0;round<3;round++)f.sqlite.prepare('INSERT INTO psychology_task_group_allocations(policy_id,connection_id,beijing_date,round,item_id,created_at) VALUES (?,?,?,?,?,?)').run(saved.policy.id,'a','2026-10-02',round,'item-'+round,now);
 assert.throws(()=>f.sqlite.prepare('INSERT INTO psychology_task_group_allocations(policy_id,connection_id,beijing_date,round,item_id,created_at) VALUES (?,?,?,?,?,?)').run(saved.policy.id,'a','2026-10-02',3,'item-3',now),/CHECK constraint/);
 assert.throws(()=>f.sqlite.prepare('INSERT INTO psychology_task_group_allocations(policy_id,connection_id,beijing_date,round,item_id,created_at) VALUES (?,?,?,?,?,?)').run(saved.policy.id,'a','2026-10-02',0,'item-other',now),/UNIQUE constraint/);
});
