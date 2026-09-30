import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { kvSet } from './kv.js';
import { loadGroupStore } from './official.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { runAutopilot, runAutopilots, handlePsychologyAutopilot } from './psychology-autopilot.js';
import { taskAssignmentsFor, handleTaskGroups } from './psychology-task-groups.js';
import { taskSlotAccounts, taskPublishContext, sameDeliveryDay, reconcileTaskExecutors } from './psychology-task-group-execution.js';
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
