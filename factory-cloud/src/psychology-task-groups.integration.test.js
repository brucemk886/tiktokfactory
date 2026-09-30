import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { kvSet } from './kv.js';
import { loadGroupStore } from './official.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { runAutopilot, runAutopilots, handlePsychologyAutopilot } from './psychology-autopilot.js';
import { taskAssignmentsFor, handleTaskGroups, reconcileTaskGroups } from './psychology-task-groups.js';
import { taskSlotAccounts, taskPublishContext, sameDeliveryDay, reconcileTaskExecutors } from './psychology-task-group-execution.js';
import { PACIFIC_TIME_ZONE, zonedEpoch, zonedDate } from '../../scripts/psychology-schedule-time.js';
import { POOL_POLICY } from '../../scripts/psychology-pool-policy.js';

const DAY = 86400000, HOUR = 3600000;
const at = (date,time='00:00') => Date.parse(date+'T'+time+':00+08:00');
const created = at('2026-09-30'), starts = at('2026-10-02'), ends = starts + 7*DAY;
const policyId = 'task-policy';
const actor = {id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-autopilot']};
const slots = [{hour:8,minute:0},{hour:14,minute:0},{hour:20,minute:0}];

async function taskFixture(t) {
  let clock = created;
  t.mock.method(Date,'now',()=>clock);
  const f = await fixture(t);
  f.env.ARCHIVE = {async get(){return null;},async put(){},async delete(){}};
  f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=? WHERE id=?').run(JSON.stringify(actor.sidebarModules),'admin');
  await kvSet(f.db,'official-account-groups',{
    projects:[{id:'proj-psych',name:'Psychology',moduleKey:'psychology'},{id:'proj-novel',name:'Novel',moduleKey:'novel-promotion'}],
    groups:[{id:'g',name:'Selected',projectId:'proj-psych'},{id:'spare',name:'Unselected',projectId:'proj-psych'},
      {id:'new-group',name:'New group',projectId:'proj-psych'},{id:'other',name:'Novel',projectId:'proj-novel'}],
  });
  f.sqlite.exec('DELETE FROM official_account_assignments');
  for (const [id,group] of [['a','g'],['b','g'],['c','spare'],['outside','other']]) {
    f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,group);
  }
  await loadGroupStore(f.db);
  const directory = ['a','b','c','outside'].map(id=>({id,connectionId:id,username:id,scopes:['video.publish']}));
  let directoryReads = 0;
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(new URL(url).pathname,'/api/v1/accounts','tests only read a local mock directory');
    directoryReads++;
    return Response.json({accounts:directory});
  });
  await importPsychologyPeerHits(f.db,Array.from({length:15},(_,n)=>({
    videoUrl:'https://www.tiktok.com/@example/photo/'+(500+n),title:'Eligible source '+n,
    videoData:{pageTexts:['A specific cover '+n,'A concrete useful action before the next conversation.']},
  })),actor.id);
  for (const row of f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE media_type='photo'").all()) {
    f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(
      JSON.stringify({title:'Source '+row.id,pages:[{text:'A concrete question for source '+row.id},{text:'Choose one specific action before asking what happens next.'}]}),row.id);
  }
  for (const id of ['a','b']) for (let n=0;n<6;n++) {
    f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,?,'photo',?,?,?,'','classic','historical-copy','published',600,0.2)").run(
      'history-'+id+n,'history','tiktok:'+id,created-4*DAY,created-4*DAY,'history-source-'+n);
  }
  function pilot(overrides={}) {
    const value={id:'pilot-'+crypto.randomUUID(),owner:'admin',group_id:'g',group_name:'Selected',strategy:'evolve',
      current_strategy:'pools',strategy_started_at:starts,slots_json:JSON.stringify(slots),status:'active',
      ends_at:ends,created_at:created,updated_at:created,task_group_policy_id:policyId,task_group_managed:0,...overrides};
    const keys=Object.keys(value);
    f.sqlite.prepare('INSERT INTO psychology_autopilots('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>value[key]));
    return f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(value.id);
  }
  const sourcePilot = pilot();
  f.sqlite.prepare("INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,revision,starts_at,ends_at,next_review_at,source_pilot_ids_json,created_at,updated_at) VALUES(?,'proj-psych','admin',1,1,?,?,?,?,?,?)").run(
    policyId,starts,ends,starts+3*DAY,JSON.stringify([sourcePilot.id]),created,created);
  f.sqlite.prepare('INSERT INTO psychology_task_group_revisions(policy_id,revision,created_at) VALUES(?,1,?)').run(policyId,created);
  f.sqlite.prepare('INSERT INTO psychology_task_group_cycles(policy_id,revision,starts_at,ends_at) VALUES(?,1,?,?)').run(policyId,starts,ends);
  function registry(id,{enrolled=1,excluded=0,paused=0,group='g',firstSeen=created}={}) {
    f.sqlite.prepare('INSERT INTO psychology_task_group_accounts(policy_id,connection_id,first_seen_at,enrolled,excluded,is_new,paused,group_id,name,updated_at) VALUES(?,?,?,?,?,0,?,?,?,?)')
      .run(policyId,id,firstSeen,enrolled,excluded,paused,group,id,created);
  }
  function snapshot(id,{effectiveAt=starts,revision=1,role='review',pool='strong',group='g',paused=0}={}) {
    f.sqlite.prepare('INSERT INTO psychology_task_group_snapshots(policy_id,connection_id,effective_at,revision,role,account_pool,group_id,name,paused) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(policyId,id,effectiveAt,revision,role,pool,group,id,paused);
  }
  for (const id of ['a','b']) {registry(id);snapshot(id);}
  registry('c',{enrolled:0,excluded:1,group:'spare'});
  function setNow(value) {clock=value;}
  function body(round,overrides={}) {
    const slot=at('2026-10-02',['08:00','14:00','20:00'][round]);
    return {requestId:crypto.randomUUID(),name:'Task integration',mediaType:'photo',template:'photo-text',sourceType:'library',
      libraryStrategy:'pools',libraryTestPolicy:POOL_POLICY.version,connectionIds:['a','b'],count:2,
      scheduleAt:Math.floor(slot/1000),intervalMinutes:60,staggerSeconds:45,
      poolContext:{cycleStartAt:starts,postsPerDay:3,dayIndex:0,round,asOf:clock},...overrides};
  }
  async function dispatch(input,slot=input.scheduleAt*1000) {
    const url=new URL('https://factory.test/api/psychology-auto-publish');
    return handlePsychologyAutoPublish(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),
      f.env,url,{user:actor},{productionLeadMs:2*HOUR,taskGroupPolicyId:policyId,taskSlotAt:slot});
  }
  return {...f,directory,sourcePilot,pilot,registry,snapshot,body,dispatch,setNow,get directoryReads(){return directoryReads;}};
}

test('task slot filtering uses future membership and fresh physical grants without changing old slots',async t=>{
  const f=await taskFixture(t),slot=at('2026-10-02','08:00');
  f.sqlite.prepare("DELETE FROM psychology_task_group_snapshots WHERE connection_id='b'").run();
  f.snapshot('b',{effectiveAt:starts+DAY,role:'launch'});
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a','b','c'],slot),['a']);
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a','b'],slot+DAY),['a','b']);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],starts-1)).size,0);
  assert.deepEqual(await taskPublishContext(f.db,f.sourcePilot,starts-1),{});
  assert.deepEqual(await taskPublishContext(f.db,f.sourcePilot,starts),{taskGroupPolicyId:policyId,taskSlotAt:starts});
  assert.deepEqual(await taskPublishContext(f.db,f.sourcePilot,ends),{});

  f.sqlite.prepare("UPDATE psychology_task_group_accounts SET paused=1 WHERE connection_id='a'").run();
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a'],slot),[]);
  f.sqlite.prepare("UPDATE psychology_task_group_accounts SET paused=0 WHERE connection_id='a'").run();
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a'],slot),[]);

  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='spare' WHERE account_key='a'").run();
  const moved=f.pilot({group_id:'spare',group_name:'Unselected',task_group_managed:1});
  assert.deepEqual(await taskSlotAccounts(f.db,moved,['a'],slot),[]);
  f.snapshot('a',{effectiveAt:starts+DAY,revision:2,group:'spare'});
  assert.deepEqual(await taskSlotAccounts(f.db,moved,['a'],slot+DAY),['a']);
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a'],slot+DAY),[]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);
  assert.equal(f.requests.length,0);
});

test('three daily rounds commit exact claims with jobs and conflicting requests roll back everything',async t=>{
  const f=await taskFixture(t);f.setNow(starts);
  for(let round=0;round<3;round++) {
    const input=f.body(round),response=await f.dispatch(input);
    assert.equal(response.status,202);
    const created=await response.json();assert.equal(created.count,2);
    const duplicate=await(await f.dispatch(input)).json();assert.equal(duplicate.duplicate,true);
  }
  const claims=f.sqlite.prepare('SELECT connection_id,beijing_date,round,item_id FROM psychology_task_group_allocations ORDER BY connection_id,round').all();
  assert.equal(claims.length,6);
  for(const id of ['a','b'])assert.deepEqual(claims.filter(row=>row.connection_id===id).map(row=>[row.beijing_date,row.round]),
    [['2026-10-02',0],['2026-10-02',1],['2026-10-02',2]]);
  const tables=['psychology_publish_batches','psychology_publish_items','factory_jobs','psychology_pool_matches',
    'psychology_task_group_allocations','psychology_creative_snapshots','psychology_peer_account_usage','psychology_copy_test_allocations'];
  const counts=()=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n]));
  const before=counts();
  await assert.rejects(f.dispatch(f.body(0)),error=>error.statusCode===409);
  assert.deepEqual(counts(),before);
  const fourth=f.body(2,{scheduleAt:at('2026-10-02','21:00')/1000,
    poolContext:{cycleStartAt:starts,postsPerDay:4,dayIndex:0,round:3}});
  await assert.rejects(f.dispatch(fourth),error=>error.statusCode===409||/CHECK constraint failed.*round/.test(error.message));
  assert.deepEqual(counts(),before);
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a','b'],at('2026-10-02','08:00')),[]);
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(claims[0].item_id);
  assert.deepEqual(await taskSlotAccounts(f.db,f.sourcePilot,['a'],at('2026-10-02','08:00')),[]);
  assert.deepEqual(counts(),before);
  assert.equal(f.requests.length,0);
});

test('managed plans obey pause, disabled policy and exact end without cancelling frozen work',async t=>{
  const f=await taskFixture(t);f.setNow(starts);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES(?,'a','paused','operator pause',?)").run(f.sourcePilot.id,created);
  const run=await runAutopilot(f.env,f.sourcePilot,starts);
  assert.deepEqual(run.errors,[]);
  const items=f.sqlite.prepare('SELECT connection_id,schedule_at FROM psychology_publish_items ORDER BY schedule_at').all();
  assert.equal(items.length,3);
  assert.ok(items.every(item=>item.connection_id==='b'));
  const frozen=JSON.stringify(f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all());
  f.sqlite.prepare("UPDATE psychology_autopilots SET status='paused' WHERE id=?").run(f.sourcePilot.id);
  assert.deepEqual((await runAutopilot(f.env,f.sourcePilot,starts)).batches,[]);
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all()),frozen);

  const managed={...f.sourcePilot,task_group_managed:1};
  f.sqlite.prepare('UPDATE psychology_task_group_policies SET enabled=0').run();
  assert.deepEqual(await taskSlotAccounts(f.db,managed,['a','b'],at('2026-10-03','08:00')),[]);
  assert.deepEqual(await taskPublishContext(f.db,managed,at('2026-10-03','08:00')),{});
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all()),frozen);
  f.sqlite.prepare('UPDATE psychology_task_group_policies SET enabled=1').run();
  assert.deepEqual(await taskSlotAccounts(f.db,managed,['a','b'],ends),[]);
  assert.equal(f.requests.length,0);
});

test('supplemental delivery rejects midnight and cycle-end spillover',()=>{
  const last=at('2026-10-08','23:59');
  assert.equal(sameDeliveryDay(last,(ends-1000)/1000,ends),true);
  assert.equal(sameDeliveryDay(last,ends/1000,ends),false);
  assert.equal(sameDeliveryDay(at('2026-10-07','23:59'),at('2026-10-08')/1000,ends),false);
});

test('new publishing accounts get one executor with working run, pause, account and detail routes',async t=>{
  const f=await taskFixture(t);f.setNow(created+HOUR);
  for(const id of ['d','e']) {
    f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,'new-group');
    f.directory.push({id,connectionId:id,username:id,scopes:['video.publish']});
  }
  const directory={accounts:f.directory};
  await reconcileTaskExecutors(f.env,actor,directory,created+HOUR);
  await reconcileTaskExecutors(f.env,actor,directory,created+HOUR+60000);
  const executors=f.sqlite.prepare("SELECT * FROM psychology_autopilots WHERE group_id='new-group'").all();
  assert.equal(executors.length,1);
  const pilot=executors[0];
  assert.match(pilot.id,/^pilot-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(pilot.task_group_managed,1);
  assert.equal(pilot.task_group_policy_id,policyId);
  assert.equal(pilot.ends_at,ends);
  assert.equal(f.sqlite.prepare("SELECT excluded FROM psychology_task_group_accounts WHERE connection_id='c'").get().excluded,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_task_group_accounts WHERE connection_id='outside'").get().n,0);
  async function route(method,suffix,body) {
    const url=new URL('https://factory.test/api/psychology-autopilot/'+pilot.id+suffix);
    return handlePsychologyAutopilot(new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),f.env,url,{user:actor});
  }
  assert.equal((await route('POST','/run')).status,200);
  assert.equal((await route('PATCH','/accounts/d',{status:'paused'})).status,200);
  assert.equal(f.sqlite.prepare("SELECT status FROM psychology_autopilot_accounts WHERE autopilot_id=? AND connection_id='d'").get(pilot.id).status,'paused');
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'created',?)").run(pilot.id,at('2026-10-02','08:00'),created+HOUR);
  assert.deepEqual(await(await route('GET','/slots/'+at('2026-10-02','08:00'))).json(),{items:[]});
  assert.equal((await route('PATCH','',{status:'paused'})).status,200);
  assert.equal(f.sqlite.prepare('SELECT status FROM psychology_autopilots WHERE id=?').get(pilot.id).status,'paused');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);
  assert.equal(f.requests.length,0);
});

test('new account conflicts remain visible and cannot bypass an unselected paused delivery plan',async t=>{
  const f=await taskFixture(t);f.setNow(created+HOUR);
  const old=f.pilot({group_id:'spare',group_name:'Unselected',status:'paused',task_group_policy_id:'',task_group_managed:0});
  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('d','spare')").run();
  f.directory.push({id:'d',connectionId:'d',username:'d',scopes:['video.publish']});
  const result=await reconcileTaskExecutors(f.env,actor,{accounts:f.directory},created+HOUR);
  assert.equal(result.totals.blocked,1);
  assert.deepEqual(result.newExecutorGroups,[]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='spare'").get().n,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM psychology_autopilots WHERE id=?').get(old.id).status,'paused');
  assert.deepEqual(await taskSlotAccounts(f.db,old,['c','d'],at('2026-10-02','08:00')),['c']);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['d'],at('2026-10-02','08:00'))).size,0);
  const url=new URL('https://factory.test/api/psychology-autopilot/task-groups?group=launch');
  const report=await(await handleTaskGroups(new Request(url),f.env,url,actor,{directory:{accounts:f.directory},now:created+HOUR})).json();
  const blocked=report.membership.rows.find(account=>account.connectionId==='d');
  assert.ok(blocked);
  assert.equal(blocked.blocked,true);
  assert.match(blocked.reason,/现有发布计划未纳入任务组/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);
  assert.equal(f.requests.length,0);
});

test('a new executor inherits only the matching account pause and leaves frozen old jobs untouched',async t=>{
  const f=await taskFixture(t);f.setNow(starts+DAY);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES(?,'a','paused','operator pause',?)").run(f.sourcePilot.id,created);
  for(const id of ['a','b']) {
    f.sqlite.prepare("UPDATE official_account_assignments SET group_id='new-group' WHERE account_key=?").run(id);
    f.sqlite.prepare("UPDATE psychology_task_group_accounts SET group_id='new-group' WHERE connection_id=?").run(id);
    f.snapshot(id,{effectiveAt:starts+DAY,revision:2,group:'new-group'});
  }
  const moved=f.pilot({group_id:'new-group',group_name:'New group',task_group_managed:1});
  const result=await runAutopilot(f.env,moved,starts+DAY);
  assert.deepEqual(result.errors,[]);
  const states=f.sqlite.prepare('SELECT connection_id,status,reason FROM psychology_autopilot_accounts WHERE autopilot_id=? ORDER BY connection_id').all(moved.id);
  assert.deepEqual(states.map(state=>[state.connection_id,state.status]),[['a','paused'],['b','active']]);
  assert.match(states[0].reason,/保留既有暂停/);
  const items=f.sqlite.prepare('SELECT connection_id FROM psychology_publish_items').all();
  assert.equal(items.length,3);
  assert.ok(items.every(item=>item.connection_id==='b'));
  assert.equal(f.sqlite.prepare("SELECT status FROM psychology_autopilot_accounts WHERE autopilot_id=? AND connection_id='a'").get(f.sourcePilot.id).status,'paused');
  assert.equal(f.requests.length,0);
});

test('cron visits active executors past twenty without publishing or skipping their run state',async t=>{
  const f=await taskFixture(t);f.setNow(starts);
  f.sqlite.prepare("UPDATE psychology_autopilots SET status='paused' WHERE id=?").run(f.sourcePilot.id);
  f.sqlite.prepare('UPDATE psychology_task_group_policies SET enabled=0').run();
  const pilots=Array.from({length:21},(_,n)=>f.pilot({group_id:'empty-'+n,group_name:'Empty '+n,task_group_policy_id:'',task_group_managed:0}));
  const results=await runAutopilots(f.env,starts);
  assert.equal(Object.keys(results).length,21);
  for(const pilot of pilots) {
    assert.ok(Object.hasOwn(results,pilot.id));
    assert.deepEqual(results[pilot.id].errors,[]);
    assert.equal(f.sqlite.prepare('SELECT last_run_at FROM psychology_autopilots WHERE id=?').get(pilot.id).last_run_at,starts);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);
  assert.equal(f.requests.length,0);
});

test('policy and membership races abort the complete publishing allocation transaction',async t=>{
  for(const change of ['disable','membership']) await t.test(change,async t=>{
    const f=await taskFixture(t);f.setNow(starts);
    const batch=f.db.batch;
    let injected=false;
    f.db.batch=async statements=>{
      if(!injected) {
        injected=true;
        if(change==='disable')f.sqlite.prepare('UPDATE psychology_task_group_policies SET enabled=0').run();
        else f.sqlite.prepare("UPDATE psychology_task_group_snapshots SET revision=revision+1 WHERE connection_id='a'").run();
      }
      return batch(statements);
    };
    await assert.rejects(f.dispatch(f.body(0)),error=>error.statusCode===409);
    assert.equal(injected,true);
    for(const table of ['psychology_publish_batches','psychology_publish_items','factory_jobs','psychology_pool_matches',
      'psychology_task_group_allocations','psychology_creative_snapshots','psychology_peer_account_usage']) {
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table+' rolled back');
    }
    assert.equal(f.requests.length,0);
  });
});

test('live-cycle arrivals expose blocked future membership before it becomes dispatchable',async t=>{
  const f=await taskFixture(t);f.setNow(starts+DAY+HOUR);
  const reserved=at('2026-10-04','20:00');
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,detail,updated_at) VALUES(?,?,'created','frozen old reservation',?)").run(f.sourcePilot.id,reserved,created);
  const before=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=?').get(f.sourcePilot.id);
  f.pilot({group_id:'spare',group_name:'Unselected',status:'paused',task_group_policy_id:'',task_group_managed:0});
  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('d','spare')").run();
  f.directory.push({id:'d',connectionId:'d',username:'d',scopes:['video.publish']});
  const now=starts+DAY+HOUR,directory={accounts:f.directory};
  const result=await reconcileTaskExecutors(f.env,actor,directory,now);
  assert.equal(result.effectiveAt,starts+3*DAY);
  assert.equal(result.totals.blocked,1);
  const url=new URL('https://factory.test/api/psychology-autopilot/task-groups?group=launch');
  const report=await(await handleTaskGroups(new Request(url),f.env,url,actor,{directory,now})).json();
  assert.equal(report.totals.blocked,1);
  const waiting=report.membership.rows.find(account=>account.connectionId==='d');
  assert.ok(waiting,'future new member remains visible while waiting');
  assert.equal(waiting.blocked,true);
  assert.equal(waiting.effectiveAt,starts+3*DAY);
  assert.ok(waiting.effectiveAt>now);
  assert.match(waiting.reason,/现有发布计划未纳入任务组/);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['d'],at('2026-10-03','08:00'))).size,0);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=?').get(f.sourcePilot.id),before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);
  assert.equal(f.requests.length,0);
});

function clearTaskPolicy(f,{pilots=false}={}) {
  for(const table of ['psychology_task_group_allocations','psychology_task_group_snapshots','psychology_task_group_accounts',
    'psychology_task_group_cycles','psychology_task_group_revisions','psychology_task_group_policies']) {
    f.sqlite.prepare('DELETE FROM '+table).run();
  }
  if(pilots)for(const table of ['psychology_autopilot_accounts','psychology_autopilot_slots','psychology_autopilot_log','psychology_autopilots']) {
    f.sqlite.prepare('DELETE FROM '+table).run();
  }
}
async function bindProject(f,now=created,overrides={}) {
  f.setNow(now);
  const current=f.sqlite.prepare('SELECT revision FROM psychology_task_group_policies').get();
  const body={revision:current?.revision||0,enabled:true,enrollmentMode:'project',projectId:'proj-psych',
    reviewTarget:5,admitNewAccounts:true,...overrides};
  const url=new URL('https://factory.test/api/psychology-autopilot/task-groups');
  const response=await handleTaskGroups(new Request(url,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),
    f.env,url,actor,{directory:{accounts:f.directory},now});
  const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  assert.equal(data.policy.enrollmentMode,'project');
  assert.equal(data.policy.projectId,'proj-psych');
  return data;
}
function permissionFingerprint(f) {
  return JSON.stringify({
    groups:f.sqlite.prepare("SELECT value_json FROM factory_kv WHERE key='official-account-groups'").get(),
    assignments:f.sqlite.prepare('SELECT * FROM official_account_assignments ORDER BY account_key').all(),
  });
}

test('project controller bootstraps without any manual plans and admits all current and future eligible accounts',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  const permissions=permissionFingerprint(f),bound=await bindProject(f);
  assert.equal(bound.totals.enrolled,3);
  assert.equal(bound.totals.excluded,0);
  assert.deepEqual(bound.policy.sourcePilotIds,[]);
  assert.deepEqual(new Set(f.sqlite.prepare('SELECT connection_id FROM psychology_task_group_accounts WHERE enrolled=1').all().map(row=>row.connection_id)),
    new Set(['a','b','c']));
  const start=bound.policy.startsAt;f.setNow(start);
  const result=await runAutopilots(f.env,start);
  assert.ok(Object.keys(result).some(key=>key.startsWith('pilot-')));
  const executors=f.sqlite.prepare("SELECT * FROM psychology_autopilots WHERE status='active'").all();
  assert.deepEqual(new Set(executors.map(pilot=>pilot.group_id)),new Set(['g','spare']));
  assert.ok(executors.every(pilot=>pilot.task_group_policy_id===bound.policy.id&&pilot.task_group_managed===1));
  assert.equal(bound.policy.timeZone,PACIFIC_TIME_ZONE);
  assert.ok(executors.every(pilot=>pilot.schedule_timezone===PACIFIC_TIME_ZONE));
  for(const pilot of executors){const times=JSON.parse(pilot.slots_json).map(s=>s.hour*60+s.minute);assert.equal(times[1]-times[0],210);assert.equal(times[2]-times[0],720);}
  for(const id of ['a','b'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_task_group_allocations WHERE connection_id=?').get(id).n,3);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_task_group_accounts WHERE connection_id='outside'").get().n,0);

  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('d','new-group')").run();
  f.directory.push({id:'d',connectionId:'d',username:'d',scopes:['video.publish']});
  const arrival=start+HOUR;f.setNow(arrival);
  await runAutopilots(f.env,arrival);
  const admitted=f.sqlite.prepare("SELECT * FROM psychology_task_group_accounts WHERE connection_id='d'").get();
  assert.equal(admitted.enrolled,1);
  assert.equal(admitted.excluded,0);
  const membership=f.sqlite.prepare("SELECT effective_at FROM psychology_task_group_snapshots WHERE connection_id='d' ORDER BY effective_at DESC LIMIT 1").get();
  assert.ok(membership.effective_at>arrival);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['d'],arrival)).size,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='new-group' AND status<>'ended'").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id='d' AND schedule_at*1000<?").get(membership.effective_at).n,0);
  f.sqlite.prepare("DELETE FROM official_account_assignments WHERE account_key='d'").run();
  assert.equal(permissionFingerprint(f),permissions);
  assert.equal(f.requests.length,0);
});

test('project binding restores excluded accounts and auto-binds compatible plans without filling prestart reservations',async t=>{
  const f=await taskFixture(t);
  f.sqlite.prepare("UPDATE psychology_task_group_accounts SET legacy_member=1 WHERE enrolled=1 AND excluded=0").run();
  const spare=f.pilot({group_id:'spare',group_name:'Unselected',task_group_policy_id:'',task_group_managed:0});
  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('legacy-spare','spare')").run();
  f.directory.push({id:'legacy-spare',connectionId:'legacy-spare',username:'legacy-spare',scopes:['video.publish']});
  f.registry('legacy-spare',{enrolled:0,excluded:1,group:'spare'});
  const oldInput={requestId:crypto.randomUUID(),name:'Frozen legacy work',mediaType:'photo',template:'photo-text',sourceType:'library',
    libraryStrategy:'original',count:1,connectionIds:['legacy-spare'],scheduleAt:at('2026-10-01','08:00')/1000,intervalMinutes:60};
  const oldBatch=await(await f.call('POST',oldInput)).json();
  assert.ok(oldBatch.batchId);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,detail,updated_at) VALUES(?,?,'created',?,'frozen legacy',?)")
    .run(spare.id,at('2026-10-01','08:00'),oldBatch.batchId,created);
  const tables=['psychology_publish_batches','psychology_publish_items','factory_jobs','psychology_autopilot_slots'];
  const frozen=()=>Object.fromEntries(tables.map(table=>[table,JSON.stringify(f.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())]));
  const before=frozen(),permissions=permissionFingerprint(f);
  const binding=await bindProject(f,created+HOUR);
  assert.equal(binding.totals.excluded,0);
  assert.equal(binding.totals.enrolled,4);
  assert.ok(binding.policy.sourcePilotIds.includes(spare.id));
  const adopted=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(spare.id);
  assert.equal(adopted.task_group_policy_id,policyId);
  assert.equal(adopted.status,spare.status);
  assert.equal(adopted.slots_json,spare.slots_json);
  assert.equal(adopted.current_strategy,spare.current_strategy);
  assert.equal(f.sqlite.prepare("SELECT legacy_member FROM psychology_task_group_accounts WHERE connection_id='c'").get().legacy_member,0);
  assert.deepEqual(await taskSlotAccounts(f.db,adopted,['c','legacy-spare'],at('2026-10-01','08:00')),[]);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['c'],binding.effectiveAt-1)).size,0);
  assert.deepEqual(frozen(),before);
  assert.equal(permissionFingerprint(f),permissions);
  assert.equal(f.requests.length,0);
});

test('project-created executors keep ended historical pauses while a later explicit resume wins',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  for(const id of ['a','b'])f.sqlite.prepare("UPDATE official_account_assignments SET group_id='new-group' WHERE account_key=?").run(id);
  const stopped=f.pilot({group_id:'new-group',status:'ended',task_group_policy_id:'',task_group_managed:0,ends_at:created-2*HOUR,updated_at:created-HOUR});
  const resumed=f.pilot({group_id:'new-group',status:'ended',task_group_policy_id:'',task_group_managed:0,ends_at:created-2*HOUR,updated_at:created-60000});
  for(const id of ['a','b'])f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES(?,?,'paused','explicit old pause',?)").run(stopped.id,id,created-HOUR);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES(?,'b','active','explicit later resume',?)").run(resumed.id,created-60000);
  const bound=await bindProject(f);
  f.setNow(bound.policy.startsAt);
  await runAutopilots(f.env,bound.policy.startsAt);
  const current=f.sqlite.prepare("SELECT * FROM psychology_autopilots WHERE group_id='new-group' AND status='active'").get();
  assert.ok(current);
  const states=f.sqlite.prepare('SELECT connection_id,status FROM psychology_autopilot_accounts WHERE autopilot_id=? ORDER BY connection_id').all(current.id);
  assert.deepEqual(states.map(state=>[state.connection_id,state.status]),[['a','paused'],['b','active']]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id='a'").get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id='b'").get().n,3);
  assert.equal(f.sqlite.prepare("SELECT status FROM psychology_autopilot_accounts WHERE autopilot_id=? AND connection_id='a'").get(stopped.id).status,'paused');
  assert.equal(f.requests.length,0);
});

test('project grant restoration and one ended executor do not stop other enrollment or renew the bounded cycle',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  const bound=await bindProject(f),start=bound.policy.startsAt,end=bound.policy.endsAt;
  f.setNow(start);await runAutopilots(f.env,start);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
  assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],start+DAY+8*HOUR)).size,0);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='g' WHERE account_key='a'").run();
  assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],start+DAY+8*HOUR)).size,1);
  const prior=f.sqlite.prepare("SELECT * FROM psychology_task_group_accounts WHERE connection_id='a'").get();
  f.sqlite.prepare("UPDATE psychology_autopilots SET status='ended',ends_at=? WHERE group_id='g'").run(start+DAY);
  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('d','new-group')").run();
  f.directory.push({id:'d',connectionId:'d',username:'d',scopes:['video.publish']});
  const now=start+DAY+HOUR;f.setNow(now);
  const reconciled=await reconcileTaskExecutors(f.env,actor,{accounts:f.directory},now);
  assert.equal(reconciled.policy.enabled,true);
  assert.equal(reconciled.policy.endsAt,end);
  assert.equal(f.sqlite.prepare("SELECT enrolled FROM psychology_task_group_accounts WHERE connection_id='d'").get().enrolled,1);
  assert.equal(f.sqlite.prepare("SELECT first_seen_at FROM psychology_task_group_accounts WHERE connection_id='a'").get().first_seen_at,prior.first_seen_at);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='new-group' AND status<>'ended'").get().n,1);

  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('e','new-group')").run();
  f.directory.push({id:'e',connectionId:'e',username:'e',scopes:['video.publish']});
  f.setNow(end+HOUR);await runAutopilots(f.env,end+HOUR);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_task_group_accounts WHERE connection_id='e'").get().n,0);
  assert.equal(f.sqlite.prepare('SELECT ends_at FROM psychology_task_group_policies').get().ends_at,end);
  const renewed=await bindProject(f,end+HOUR);
  assert.ok(renewed.policy.startsAt>end);
  assert.equal(renewed.policy.endsAt-renewed.policy.startsAt,7*DAY);
  assert.equal(f.sqlite.prepare("SELECT enrolled FROM psychology_task_group_accounts WHERE connection_id='e'").get().enrolled,1);
  assert.equal(f.requests.length,0);
});

test('other-owner and incompatible plans block only their physical groups in project mode',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  const foreign=f.pilot({owner:'other-owner',group_id:'spare',group_name:'Foreign',task_group_policy_id:'',task_group_managed:0});
  const incompatible=f.pilot({group_id:'new-group',group_name:'Two posts',slots_json:JSON.stringify(slots.slice(0,2)),
    current_strategy:'original',task_group_policy_id:'',task_group_managed:0});
  f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id) VALUES('d','new-group')").run();
  f.directory.push({id:'d',connectionId:'d',username:'d',scopes:['video.publish']});
  const before=JSON.stringify([foreign,incompatible]),permissions=permissionFingerprint(f);
  const bound=await bindProject(f);
  assert.equal(bound.totals.enrolled,4);
  assert.equal(bound.totals.blocked,2);
  await reconcileTaskExecutors(f.env,actor,{accounts:f.directory},created+HOUR);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='g' AND status<>'ended'").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='spare' AND status<>'ended'").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='new-group' AND status<>'ended'").get().n,1);
  assert.equal(JSON.stringify([f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(foreign.id),
    f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(incompatible.id)]),before);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['c','d'],bound.policy.startsAt+8*HOUR)).size,0);
  assert.equal(permissionFingerprint(f),permissions);
  assert.equal(f.requests.length,0);
});

test('a manually ended current-cycle group stays stopped while other project groups continue',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  const permissions=permissionFingerprint(f);
  for(let n=0;n<6;n++)f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,'tiktok:c','photo',?,?,?,'','classic','historical-copy','published',600,0.2)")
    .run('history-c'+n,'history',created-4*DAY,created-4*DAY,'history-c-source-'+n);
  const bound=await bindProject(f);
  await reconcileTaskExecutors(f.env,actor,{accounts:f.directory},created+HOUR);
  const executor=f.sqlite.prepare("SELECT * FROM psychology_autopilots WHERE group_id='g' AND status='active'").get();
  assert.ok(executor);
  f.sqlite.prepare("UPDATE psychology_autopilots SET status='ended',updated_at=? WHERE id=?").run(created+2*HOUR,executor.id);
  const stopped=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(executor.id),before=JSON.stringify(stopped);
  const status=await reconcileTaskExecutors(f.env,actor,{accounts:f.directory},created+2*HOUR);
  assert.equal(status.totals.enrolled,3);
  assert.equal(status.totals.blocked,2);
  f.setNow(bound.policy.startsAt);
  await runAutopilots(f.env,bound.policy.startsAt);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='g' AND status<>'ended'").get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='spare' AND status='active'").get().n,1);
  const items=f.sqlite.prepare('SELECT connection_id FROM psychology_publish_items').all();
  assert.equal(items.length,3);
  assert.ok(items.every(item=>item.connection_id==='c'));
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(stopped.id)),before);
  assert.equal(permissionFingerprint(f),permissions);
  assert.equal(f.requests.length,0);
});

test('expired legacy reservations follow a moved account and delay only its new executor through the reserved Beijing day',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  const historical=f.pilot({status:'ended',task_group_policy_id:'',task_group_managed:0,ends_at:created-DAY,updated_at:created-HOUR});
  const reserved=at('2026-10-01','08:00');
  const legacy={requestId:crypto.randomUUID(),name:'Frozen ended reservation',mediaType:'photo',template:'photo-text',sourceType:'library',
    libraryStrategy:'original',count:1,connectionIds:['a'],scheduleAt:reserved/1000,intervalMinutes:60};
  const response=await f.call('POST',legacy),batch=await response.json();
  assert.equal(response.status,202);
  assert.ok(batch.batchId);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,detail,updated_at) VALUES(?,?,'created',?,'frozen after end',?)")
    .run(historical.id,reserved,batch.batchId,created);
  const frozen=()=>JSON.stringify({
    pilot:f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(historical.id),
    slot:f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=?').all(historical.id),
    batch:f.sqlite.prepare('SELECT * FROM psychology_publish_batches WHERE id=?').get(batch.batchId),
    items:f.sqlite.prepare('SELECT * FROM psychology_publish_items WHERE batch_id=? ORDER BY id').all(batch.batchId),
    jobs:f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id IN(SELECT job_id FROM psychology_publish_items WHERE batch_id=?) ORDER BY id').all(batch.batchId),
  });
  const before=frozen();
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='new-group' WHERE account_key='a'").run();
  for(let n=0;n<6;n++)f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,'tiktok:c','photo',?,?,?,'','classic','historical-copy','published',600,0.2)")
    .run('reserved-c'+n,'history',created-4*DAY,created-4*DAY,'reserved-c-source-'+n);
  const permissions=permissionFingerprint(f),bound=await bindProject(f,created,{timeZone:'Asia/Shanghai'});
  assert.equal(bound.policy.startsAt,at('2026-10-01'));
  assert.equal(bound.totals.enrolled,3);
  assert.equal(bound.totals.blocked,1);
  assert.equal(frozen(),before);
  const start=bound.policy.startsAt;
  f.setNow(start);await runAutopilots(f.env,start);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],reserved)).size,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id='a' AND batch_id<>? AND schedule_at<?").get(batch.batchId,(start+DAY)/1000).n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_task_group_allocations WHERE connection_id='a' AND beijing_date='2026-10-01'").get().n,0);
  for(const id of ['b','c'])assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_task_group_allocations WHERE connection_id=? AND beijing_date='2026-10-01'").get(id).n,3);
  assert.equal(frozen(),before);

  f.setNow(start+DAY);await runAutopilots(f.env,start+DAY);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_task_group_allocations WHERE connection_id='a' AND beijing_date='2026-10-02'").get().n,3);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilots WHERE group_id='new-group' AND status='active'").get().n,1);
  assert.equal(frozen(),before);
  assert.equal(permissionFingerprint(f),permissions);
  assert.equal(f.requests.length,0);
});

test('frozen reservations from another owner still protect a currently authorized moved connection',async t=>{
  const f=await taskFixture(t);clearTaskPolicy(f,{pilots:true});
  const prior=f.pilot({owner:'other-owner',status:'ended',task_group_policy_id:'',task_group_managed:0,ends_at:created-DAY});
  const reserved=at('2026-10-01','20:00');
  const response=await f.call('POST',{requestId:crypto.randomUUID(),name:'Foreign frozen reservation',mediaType:'photo',template:'photo-text',
    sourceType:'library',libraryStrategy:'original',count:1,connectionIds:['a'],scheduleAt:reserved/1000,intervalMinutes:60});
  const batch=await response.json();assert.equal(response.status,202);assert.ok(batch.batchId);
  f.sqlite.prepare("UPDATE psychology_publish_batches SET created_by='other-owner' WHERE id=?").run(batch.batchId);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,detail,updated_at) VALUES(?,?,'created',?,'foreign frozen',?)")
    .run(prior.id,reserved,batch.batchId,created);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='new-group' WHERE account_key='a'").run();
  const before=JSON.stringify(f.sqlite.prepare('SELECT * FROM psychology_publish_items WHERE batch_id=?').all(batch.batchId));
  const bound=await bindProject(f);
  assert.equal(bound.totals.enrolled,3);
  assert.equal(bound.totals.blocked,1);
  f.setNow(bound.policy.startsAt);await runAutopilots(f.env,bound.policy.startsAt);
  assert.equal((await taskAssignmentsFor(f.db,'admin',['a'],reserved)).size,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id='a' AND batch_id<>? AND schedule_at<?").get(batch.batchId,(bound.policy.startsAt+DAY)/1000).n,0);
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM psychology_publish_items WHERE batch_id=?').all(batch.batchId)),before);
  assert.equal(f.sqlite.prepare('SELECT created_by FROM psychology_publish_batches WHERE id=?').get(batch.batchId).created_by,'other-owner');
  assert.equal(f.sqlite.prepare('SELECT owner FROM psychology_autopilots WHERE id=?').get(prior.id).owner,'other-owner');
  assert.equal(f.requests.length,0);
});


test('Pacific rounds share one local-day cap across two Beijing dates and freeze their timezone',async t=>{
 const f=await taskFixture(t),zone=PACIFIC_TIME_ZONE,start=zonedEpoch('2026-10-02',0,0,zone),end=zonedEpoch('2026-10-09',0,0,zone);
 const times=[{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}];
 f.sqlite.prepare('UPDATE psychology_task_group_policies SET time_zone=?,starts_at=?,ends_at=?,enrollment_mode=?').run(zone,start,end,'project');
 f.sqlite.prepare('UPDATE psychology_task_group_snapshots SET effective_at=?').run(start);
 f.sqlite.prepare('UPDATE psychology_autopilots SET schedule_timezone=?,slots_json=?,ends_at=?,strategy_started_at=?').run(zone,JSON.stringify(times),end,start);
 const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(f.sourcePilot.id);f.setNow(start);
 for(let round=0;round<3;round++){
  const {hour,minute}=times[round],slot=zonedEpoch('2026-10-02',hour,minute,zone);
  assert.deepEqual(await taskSlotAccounts(f.db,pilot,['a','b'],slot),['a','b']);
  const input=f.body(round,{scheduleAt:slot/1000,poolContext:{cycleStartAt:start,postsPerDay:3,round,dayIndex:0,timeZone:zone}});
  const response=await f.dispatch(input,slot);assert.equal(response.status,202);assert.equal((await response.json()).count,2);
 }
 const claims=f.sqlite.prepare('SELECT * FROM psychology_task_group_allocations ORDER BY connection_id,round').all();
 assert.equal(claims.length,6);assert.ok(claims.every(c=>c.beijing_date==='2026-10-02'&&c.time_zone===zone));
 const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY schedule_at').all();
 assert.equal(new Set(items.map(i=>zonedDate(i.schedule_at*1000,'Asia/Shanghai'))).size,2);
 const jobs=f.sqlite.prepare('SELECT payload_json FROM factory_jobs').all().map(j=>JSON.parse(j.payload_json));
 assert.ok(jobs.every(j=>j.psychologyAutomation.poolMatch.timeZone===zone&&j.psychologyAutomation.poolMatch.taskGroup.timeZone===zone));
 const finalSlot=zonedEpoch('2026-10-02',20,0,zone);
 assert.deepEqual(await taskSlotAccounts(f.db,pilot,['a','b'],finalSlot),[]);
 await assert.rejects(f.dispatch(f.body(2,{scheduleAt:finalSlot/1000,poolContext:{cycleStartAt:start,postsPerDay:3,round:2,dayIndex:0,timeZone:zone}})),error=>error.statusCode===409);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_task_group_allocations').get().n,6);assert.equal(f.requests.length,0);
});

test('Pacific delivery-day boundaries remain local over autumn DST and reject next-local-day spillover',()=>{
 const zone=PACIFIC_TIME_ZONE,end=zonedEpoch('2026-11-03',0,0,zone),slot=zonedEpoch('2026-11-01',8,0,zone);
 assert.equal(sameDeliveryDay(slot,zonedEpoch('2026-11-01',23,59,zone)/1000,end,zone),true);
 assert.equal(sameDeliveryDay(slot,zonedEpoch('2026-11-02',0,0,zone)/1000,end,zone),false);
 const previous=zonedEpoch('2026-10-31',23,59,zone);
 assert.equal(sameDeliveryDay(previous,zonedEpoch('2026-11-01',0,0,zone)/1000,end,zone),false);
});


test('prestart Pacific transition closes the legacy schedule gap without changing frozen old tasks',async t=>{
 const f=await taskFixture(t);f.sqlite.prepare('UPDATE psychology_task_group_accounts SET legacy_member=1 WHERE enrolled=1').run();
 const oldSlot=at('2026-10-01','08:00');
 f.sqlite.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES (?,?,?,?)').run('gap-old','admin','{}',created);
 f.sqlite.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES (?,?,?,?,?,?)').run('gap-item','gap-old','source','job','a',oldSlot/1000);
 const before=JSON.stringify(f.sqlite.prepare("SELECT * FROM psychology_publish_items WHERE id='gap-item'").get());
 const bound=await bindProject(f,created,{timeZone:PACIFIC_TIME_ZONE});
 const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(f.sourcePilot.id);
 assert.equal(bound.policy.prestartCutoffAt,starts);
 assert.deepEqual(await taskSlotAccounts(f.db,pilot,['a','b'],oldSlot),['a','b']);
 assert.deepEqual(await taskSlotAccounts(f.db,pilot,['a','b'],starts+2*HOUR),[]);
 assert.deepEqual(await taskSlotAccounts(f.db,pilot,['a','b'],zonedEpoch('2026-10-02',8,0,PACIFIC_TIME_ZONE)),['a','b']);
 assert.equal(JSON.stringify(f.sqlite.prepare("SELECT * FROM psychology_publish_items WHERE id='gap-item'").get()),before);
 assert.equal(f.requests.length,0);
});


function configurePacificAdmissionCycle(f,date='2026-10-02',endDate='2026-10-09') {
 const zone=PACIFIC_TIME_ZONE,start=zonedEpoch(date,0,0,zone),end=zonedEpoch(endDate,0,0,zone);
 f.sqlite.prepare("UPDATE psychology_task_group_policies SET enrollment_mode='project',time_zone=?,starts_at=?,ends_at=?,next_review_at=?").run(zone,start,end,end);
 f.sqlite.prepare('UPDATE psychology_task_group_snapshots SET effective_at=?').run(start);
 f.sqlite.prepare('UPDATE psychology_autopilots SET schedule_timezone=?,slots_json=?,ends_at=?,strategy_started_at=?').run(zone,JSON.stringify([{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}]),end,start);
 return {zone,start,end,pilot:f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(f.sourcePilot.id)};
}
function addBoundProjectAccount(f,id,boundAt,{history=true,group='g'}={}) {
 f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id,updated_at) VALUES(?,?,?)').run(id,group,boundAt);
 f.directory.push({id,connectionId:id,username:id,scopes:['video.publish']});
 if(history)for(let n=0;n<6;n++)f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,?,'photo',?,?,?,'','classic','historical-copy','published',600,0.2)")
  .run('admission-'+id+n,'history','tiktok:'+id,created-4*DAY,created-4*DAY,'admission-source-'+n);
}

test('late Pacific binding joins next day and supplements reserved slots without repeating existing accounts',async t=>{
 const f=await taskFixture(t),{zone,pilot}=configurePacificAdmissionCycle(f);
 const prepare=zonedEpoch('2026-10-02',16,0,zone);f.setNow(prepare);
 const first=await runAutopilot(f.env,pilot,prepare);assert.ok(first.batches.length,JSON.stringify(first.errors));
 const frozenItems=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all();
 const frozenJobs=f.sqlite.prepare('SELECT id,payload_json,available_at FROM factory_jobs ORDER BY id').all();
 // A later reservation for existing accounts must not defer the new member.
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,updated_at) VALUES(?,?,'created','',?)").run(pilot.id,zonedEpoch('2026-10-04',20,0,zone),prepare);
 const bound=zonedEpoch('2026-10-02',23,59,zone),tomorrow=zonedEpoch('2026-10-03',0,0,zone);f.setNow(bound);
 addBoundProjectAccount(f,'new-next-day',bound);
 await reconcileTaskExecutors(f.env,actor,{accounts:f.directory},bound);
 const member=f.sqlite.prepare("SELECT * FROM psychology_task_group_snapshots WHERE connection_id='new-next-day' ORDER BY effective_at LIMIT 1").get();
 assert.equal(member.effective_at,tomorrow);
 assert.equal(f.sqlite.prepare("SELECT first_seen_at FROM psychology_task_group_accounts WHERE connection_id='new-next-day'").get().first_seen_at,bound);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['new-next-day'],bound)).size,0);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['new-next-day'],tomorrow+8*HOUR)).size,1);
 const result=await runAutopilot(f.env,f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(pilot.id),bound);
 assert.deepEqual(result.errors,[]);
 const claims=f.sqlite.prepare("SELECT * FROM psychology_task_group_allocations WHERE connection_id='new-next-day' ORDER BY round").all();
 assert.deepEqual(claims.map(c=>[c.beijing_date,c.round]),[['2026-10-03',0],['2026-10-03',1],['2026-10-03',2]]);
 const beforeCounts=f.sqlite.prepare('SELECT connection_id,schedule_at,count(*) n FROM psychology_publish_items WHERE deleted_at=0 GROUP BY connection_id,schedule_at ORDER BY connection_id,schedule_at').all();
 await runAutopilot(f.env,f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(pilot.id),bound);
 assert.deepEqual(f.sqlite.prepare('SELECT connection_id,schedule_at,count(*) n FROM psychology_publish_items WHERE deleted_at=0 GROUP BY connection_id,schedule_at ORDER BY connection_id,schedule_at').all(),beforeCounts);
 assert.ok(beforeCounts.every(c=>c.n===1));
 for(const item of frozenItems)assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_publish_items WHERE id=?').get(item.id),item);
 for(const job of frozenJobs)assert.deepEqual(f.sqlite.prepare('SELECT id,payload_json,available_at FROM factory_jobs WHERE id=?').get(job.id),job);
 assert.equal(f.requests.length,0);
});

test('a binding saved before Pacific midnight stays next-day eligible when its directory is observed after midnight',async t=>{
 const f=await taskFixture(t),{zone}=configurePacificAdmissionCycle(f);
 const bound=zonedEpoch('2026-10-02',23,59,zone),observed=zonedEpoch('2026-10-03',0,1,zone);f.setNow(observed);
 addBoundProjectAccount(f,'delayed-discovery',bound);
 addBoundProjectAccount(f,'legacy-undated',0);
 await reconcileTaskGroups(f.env,actor,{accounts:f.directory},observed);
 const read=id=>f.sqlite.prepare('SELECT effective_at FROM psychology_task_group_snapshots WHERE connection_id=? ORDER BY effective_at LIMIT 1').get(id).effective_at;
 assert.equal(read('delayed-discovery'),zonedEpoch('2026-10-03',0,0,zone));
 assert.equal(read('legacy-undated'),zonedEpoch('2026-10-04',0,0,zone));
 assert.equal((await taskAssignmentsFor(f.db,'admin',['delayed-discovery'],zonedEpoch('2026-10-02',23,59,zone))).size,0);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['delayed-discovery'],zonedEpoch('2026-10-03',8,0,zone))).size,1);
 // first_seen_at records actual observation, not an invented binding date.
 assert.equal(f.sqlite.prepare("SELECT first_seen_at FROM psychology_task_group_accounts WHERE connection_id='delayed-discovery'").get().first_seen_at,observed);
 assert.equal(f.requests.length,0);
});

test('fully reserved final days still admit new members on their own next Pacific day',async t=>{
 const f=await taskFixture(t),{zone,pilot,end}=configurePacificAdmissionCycle(f);
 const bound=zonedEpoch('2026-10-07',12,0,zone);f.setNow(bound);
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,updated_at) VALUES(?,?,'created','',?)").run(pilot.id,zonedEpoch('2026-10-08',20,0,zone),bound);
 const before=f.sqlite.prepare("SELECT * FROM psychology_task_group_snapshots WHERE connection_id IN ('a','b') ORDER BY connection_id,effective_at").all();
 addBoundProjectAccount(f,'final-day',bound);
 const result=await reconcileTaskGroups(f.env,actor,{accounts:f.directory},bound);
 assert.equal(result.warning,undefined);assert.equal(result.policy.endsAt,end);
 const effective=f.sqlite.prepare("SELECT effective_at FROM psychology_task_group_snapshots WHERE connection_id='final-day'").get().effective_at;
 assert.equal(effective,zonedEpoch('2026-10-08',0,0,zone));
 assert.deepEqual(f.sqlite.prepare("SELECT * FROM psychology_task_group_snapshots WHERE connection_id IN ('a','b') ORDER BY connection_id,effective_at").all(),before);
 assert.equal((await taskAssignmentsFor(f.db,'admin',['final-day'],zonedEpoch('2026-10-08',8,0,zone))).size,1);
 assert.equal(f.requests.length,0);
});

test('new-member admission respects its own frozen task and Pacific calendar dates across DST',async t=>{
 const f=await taskFixture(t),{zone}=configurePacificAdmissionCycle(f,'2026-10-31','2026-11-07');
 const bound=zonedEpoch('2026-10-31',23,59,zone);f.setNow(bound);
 addBoundProjectAccount(f,'dst-new',bound,{history:false});addBoundProjectAccount(f,'reserved-new',bound,{history:false});
 f.sqlite.prepare("INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES('own-frozen','admin','{}',?)").run(bound);
 f.sqlite.prepare("INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES('own-frozen-item','own-frozen','source','job','reserved-new',?)").run(zonedEpoch('2026-11-01',20,0,zone)/1000);
 const before=f.sqlite.prepare("SELECT * FROM psychology_publish_items WHERE id='own-frozen-item'").get();
 await reconcileTaskGroups(f.env,actor,{accounts:f.directory},bound);
 const read=id=>f.sqlite.prepare('SELECT effective_at FROM psychology_task_group_snapshots WHERE connection_id=? ORDER BY effective_at LIMIT 1').get(id).effective_at;
 assert.equal(read('dst-new'),zonedEpoch('2026-11-01',0,0,zone));
 assert.equal(read('reserved-new'),zonedEpoch('2026-11-02',0,0,zone));
 assert.equal(read('reserved-new')-read('dst-new'),25*HOUR);
 assert.deepEqual(f.sqlite.prepare("SELECT * FROM psychology_publish_items WHERE id='own-frozen-item'").get(),before);
 assert.equal(f.requests.length,0);
});
