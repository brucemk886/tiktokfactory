import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { kvSet } from './kv.js';
import { loadGroupStore } from './official.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { runAutopilot, runAutopilots, handlePsychologyAutopilot, recoverAutopilotSlot } from './psychology-autopilot.js';
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

export async function taskFixture(t) {
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


export {at,starts,actor};
