import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { kvSet } from './kv.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { handleTransitionDay, runTransitionDays } from './psychology-transition-day.js';
import { runProductionCheck } from './psychology-production-checks.js';
import { dispatchAdaptiveProduction } from './psychology-adaptive-production.js';
import { handlePsychologyAutoPublish } from './psychology-auto-publish.js';

const HOUR=3600000, DAY=24*HOUR, zone='America/Los_Angeles';
const policyId='transition-test-policy';
const created=Date.parse('2026-09-30T00:00:00-07:00');
const now=Date.parse('2026-10-01T08:30:00-07:00');
const starts=Date.parse('2026-10-02T00:00:00-07:00'), ends=Date.parse('2026-10-09T00:00:00-07:00');
const actor={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-autopilot']};
const path='/api/psychology-autopilot/transition-day';

async function transitionFixture(t){
 let clock=now; t.mock.method(Date,'now',()=>clock);
 const f=await fixture(t);
 f.env.ARCHIVE={async get(){return null;},async put(){},async delete(){}};
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=? WHERE id=?').run(JSON.stringify(actor.sidebarModules),'admin');
 await kvSet(f.db,'official-account-groups',{projects:[{id:'proj-psych',name:'Psychology',moduleKey:'psychology'},{id:'proj-novel',name:'Novel',moduleKey:'novel-promotion'}],groups:[{id:'g',name:'Eligible psychology',projectId:'proj-psych'},{id:'other',name:'Other project',projectId:'proj-novel'}]});
 f.sqlite.exec('DELETE FROM official_account_assignments');
 const ids=['a','b','bound-today','paused','weak','unsampled','outside'];
 for(const id of ids)f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id,updated_at) VALUES(?,?,?)').run(id,id==='outside'?'other':'g',id==='bound-today'?Date.parse('2026-10-01T01:00:00-07:00'):created);
 const directory=ids.map(id=>({id,connectionId:id,username:id,scopes:['video.publish']}));
 let directoryReads=0;
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(new URL(String(url)).pathname,'/api/v1/accounts','test must not call any live provider or publishing endpoint');directoryReads++;return Response.json({accounts:directory});});
 await kvSet(f.db,'psychology-autopilot-account-directory-v1',{updatedAt:now,accounts:directory});
 f.sqlite.prepare(`INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at,task_group_policy_id,pending_strategy,strategy_effective_at,pending_slots_json,pending_schedule_timezone,slots_effective_at,schedule_timezone) VALUES('old-pilot','admin','g','Eligible psychology','evolve',?,'active',?,?,?,?, 'pools',?,?,?,?,?)`).run(JSON.stringify([{hour:1,minute:45},{hour:2,minute:15}]),ends,created,created,policyId,starts,JSON.stringify([{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}]),zone,starts,'Asia/Shanghai');
 f.sqlite.prepare(`INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,revision,starts_at,ends_at,next_review_at,source_pilot_ids_json,created_at,updated_at,enrollment_mode,time_zone,prestart_cutoff_at) VALUES(?,'proj-psych','admin',1,3,?,?,?,?,?,?,'project',?,?)`).run(policyId,starts,ends,starts+3*DAY,JSON.stringify(['old-pilot']),created,created,zone,Date.parse('2026-10-02T00:00:00+08:00'));
 for(const id of ids.filter(id=>id!=='outside')){
  f.sqlite.prepare(`INSERT INTO psychology_task_group_accounts(policy_id,connection_id,first_seen_at,enrolled,excluded,is_new,paused,group_id,name,updated_at,legacy_member) VALUES(?,?,?,1,0,?,?, 'g',?,?,1)`).run(policyId,id,id==='bound-today'?now:created,Number(id==='bound-today'),Number(id==='paused'),id,created);
  f.sqlite.prepare(`INSERT INTO psychology_task_group_snapshots(policy_id,connection_id,effective_at,revision,role,account_pool,group_id,name,paused) VALUES(?,?,?,3,?,?,'g',?,?)`).run(policyId,id,starts,id==='a'?'review':id==='b'?'normal':'strong',id==='b'?'normal':'strong',id,Number(id==='paused'));
  f.sqlite.prepare(`INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES('old-pilot',?,?,?,?)`).run(id,id==='paused'?'paused':'active',id==='paused'?'operator pause':'',created);
 }
 for(const id of ids.filter(id=>id!=='unsampled'))for(let n=0;n<6;n++)f.sqlite.prepare(`INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,?,'photo',?,?,?,'','classic','history-copy','published',?,0.2)`).run('history-'+id+'-'+n,'history','tiktok:'+id,now-4*DAY,now-4*DAY,'history-source-'+n,id==='weak'?100:id==='b'?300:600);
 await importPsychologyPeerHits(f.db,Array.from({length:20},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/photo/'+(1000+n),title:'Transition source '+n,videoData:{pageTexts:['A specific opening question '+n,'Choose one concrete action before the next conversation.']}})),actor.id);
 for(const row of f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE media_type='photo'").all())f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(JSON.stringify({title:'Source '+row.id,pages:[{text:'A concrete question for source '+row.id},{text:'Choose one specific action before asking what happens next.'}]}),row.id);
 f.sqlite.prepare(`INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,detail,updated_at) VALUES('old-pilot',?,'skipped','没有可发布的账号',?)`).run(Date.parse('2026-10-02T01:45:00+08:00'),created);
 f.sqlite.prepare(`INSERT INTO factory_jobs(id,type,status,created_by,payload_json,created_at,updated_at) VALUES('existing-job','psychology-photo-story','running','admin','{"frozen":true}',?,?)`).run(created,created);
 function frozen(){return {policy:f.sqlite.prepare('SELECT * FROM psychology_task_group_policies').all(),pilots:f.sqlite.prepare('SELECT * FROM psychology_autopilots').all(),snapshots:f.sqlite.prepare('SELECT * FROM psychology_task_group_snapshots').all(),oldSlots:f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots').all(),job:f.sqlite.prepare("SELECT * FROM factory_jobs WHERE id='existing-job'").get()};}
 async function call(method='GET',body,suffix='',user=actor){const url=new URL('https://factory.test'+path+suffix);return handleTransitionDay(new Request(url,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),f.env,url,user?{user}:null,{now:clock});}
 return {...f,call,frozen,directory,setNow:value=>{clock=value;},get directoryReads(){return directoryReads;}};
}

test('transition preview uses current project ownership, previous-day binding and fresh mature account pools',async t=>{
 const f=await transitionFixture(t),before=f.frozen();
 const response=await f.call(); assert.equal(response.status,200);
 const data=await response.json(); assert.equal(data.canEnable,true);
 assert.equal(data.preview.eligible,2);
 assert.equal(data.preview.review,1); assert.equal(data.preview.normal,1);
 const excluded=new Map(data.preview.excluded.map(row=>[row.connectionId,row.reason]));
 assert.match(excluded.get('bound-today'),/新绑定|次日/);
 assert.match(excluded.get('paused'),/暂停/);
 assert.match(excluded.get('weak'),/中强/);
 assert.match(excluded.get('unsampled'),/中强/);
 assert.equal(excluded.has('outside'),false,'other project accounts are outside the preview');
 assert.deepEqual(data.formal,{startsAt:starts,endsAt:ends,nextReviewAt:starts+3*DAY,revision:3});
 assert.deepEqual(f.frozen(),before); assert.equal(f.requests.length,0); assert.equal(f.instances.size,0);
 f.sqlite.prepare("UPDATE psychology_task_group_policies SET owner='other-controller'").run();
 const other=await f.call(); assert.equal((await other.json()).canEnable,false);
});

test('transition activation is revision guarded and does not change formal policy, old skips or running work',async t=>{
 const f=await transitionFixture(t),before=f.frozen();
 await assert.rejects(f.call('POST',{date:'2026-10-01',revision:2}),e=>e.statusCode===409);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_days').get().n,0);
 const enabled=await f.call('POST',{date:'2026-10-01',revision:3}); assert.ok(enabled.ok);
 const retry=await f.call('POST',{date:'2026-10-01',revision:3}); assert.ok(retry.ok);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_days').get().n,1);
 const members=f.sqlite.prepare('SELECT connection_id FROM psychology_transition_members ORDER BY connection_id').all();
 assert.deepEqual(members.map(row=>row.connection_id),['a','b']);
 const slots=f.sqlite.prepare('SELECT round,slot_at FROM psychology_transition_slots ORDER BY round').all();
 assert.deepEqual(slots.map(row=>[row.round,row.slot_at]),[[1,Date.parse('2026-10-01T11:30:00-07:00')],[2,Date.parse('2026-10-01T20:00:00-07:00')]]);
 assert.deepEqual(f.frozen(),before); assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,0);
 assert.equal(f.requests.length,0); assert.equal(f.instances.size,0);
});

test('two bridge rounds atomically claim distinct content with deferred production while leaving formal cycle frozen',async t=>{
 const f=await transitionFixture(t),before=f.frozen();
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 const run=await runTransitionDays(f.env,now); assert.deepEqual(run.errors,[]);
 const claims=f.sqlite.prepare('SELECT * FROM psychology_transition_claims ORDER BY connection_id,round').all();
 assert.equal(claims.length,4);
 for(const id of ['a','b']){const own=claims.filter(row=>row.connection_id===id);assert.deepEqual(own.map(row=>row.round),[1,2]);assert.equal(new Set(own.map(row=>row.source_key)).size,2);assert.ok(own.every(row=>row.operating_date==='2026-10-01'));}
 const jobs=f.sqlite.prepare('SELECT i.id,i.schedule_at,g.generation_at,g.started_at,g.dispatch_at,j.available_at FROM psychology_publish_items i JOIN psychology_generation_plans g ON g.job_id=i.id JOIN factory_jobs j ON j.id=i.id ORDER BY i.schedule_at').all();
 assert.equal(jobs.length,4);
 for(const row of jobs){const scheduled=row.schedule_at*1000;assert.ok(row.generation_at>=scheduled-3*HOUR);assert.ok(row.generation_at<=scheduled-2*HOUR);assert.equal(row.available_at,row.generation_at);assert.equal(row.started_at,0);assert.equal(row.dispatch_at,0);}
 assert.equal(f.instances.size,0); assert.equal((await dispatchAdaptiveProduction(f.env,now)).dispatched,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_task_group_allocations').get().n,0,'bridge has isolated day claims');
 assert.deepEqual(f.frozen(),before);
 await runTransitionDays(f.env,now+60000);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,4);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,4);
 assert.equal(f.requests.length,0); assert.equal(f.instances.size,0);
});

test('ordinary minute and winter clocks do not add account scans or run the expired transition',async t=>{
 const noDB={DB:{prepare(){assert.fail('out-of-window minute must not scan database');}}};
 for(const at of ['2026-10-01T16:00:00Z','2026-10-02T11:00:00Z','2026-11-02T12:00:00Z'])assert.deepEqual(await runProductionCheck(noDB,Date.parse(at)),{skipped:true});
 const f=await transitionFixture(t);
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 f.setNow(starts);await runTransitionDays(f.env,starts);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,0);
 f.setNow(Date.parse('2026-11-02T05:00:00-08:00'));await runTransitionDays(f.env,Date.now());
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,0);assert.equal(f.requests.length,0);
});



test('simultaneous bridge runners retain one lease and at most two claims per account',async t=>{
 const f=await transitionFixture(t);
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 const results=await Promise.all([runTransitionDays(f.env,now),runTransitionDays(f.env,now)]);
 assert.ok(results.every(result=>result.errors.every(error=>/测试名额刚被其他分组更新/.test(error))),JSON.stringify(results));
 await runTransitionDays(f.env,now+60000);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,4);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,4);
 assert.ok(f.sqlite.prepare('SELECT connection_id,count(*) n FROM psychology_transition_claims GROUP BY connection_id').all().every(row=>row.n===2));
 assert.equal(f.requests.length,0);assert.equal(f.instances.size,0);
});

test('conflicting transition round rolls back its new batch, jobs, exact content reservations and items',async t=>{
 const f=await transitionFixture(t);
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 const captured=[];
 const actions={publish:async(req,env,url,session,internal)=>{captured.push({input:await req.clone().json(),env,url,session,internal});return handlePsychologyAutoPublish(req,env,url,session,internal);}};
 const result=await runTransitionDays(f.env,now,null,actions);assert.deepEqual(result.errors,[]);assert.equal(captured.length,2);
 const tables=['psychology_publish_batches','psychology_publish_items','factory_jobs','psychology_generation_plans','psychology_pool_matches','psychology_transition_claims','psychology_creative_snapshots','psychology_peer_account_usage','psychology_copy_test_allocations'];
 const counts=()=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n]));
 const before=counts(),call=captured[0],body={...call.input,requestId:crypto.randomUUID()};
 await assert.rejects(handlePsychologyAutoPublish(new Request(call.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),call.env,call.url,call.session,call.internal),error=>error.statusCode===409||/psychology_transition_claims/.test(error.message));
 assert.deepEqual(counts(),before);assert.equal(f.requests.length,0);assert.equal(f.instances.size,0);
});

test('fresh account downgrade and project removal exclude frozen bridge members before execution',async t=>{
 const f=await transitionFixture(t);
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 f.sqlite.prepare("UPDATE ops_task_facts SET views=100 WHERE account_key='tiktok:b'").run();
 let result=await runTransitionDays(f.env,now);assert.deepEqual(result.errors,[]);
 assert.deepEqual(f.sqlite.prepare('SELECT DISTINCT connection_id FROM psychology_transition_claims').all().map(row=>row.connection_id),['a']);
 const slots=f.sqlite.prepare('SELECT detail_json FROM psychology_transition_slots').all();
 assert.ok(slots.every(row=>JSON.parse(row.detail_json).skipped.some(skip=>skip.connectionId==='b'&&/中强/.test(skip.reason))));
 assert.equal(f.requests.length,0);
});

test('revoked current publishing modules stop approved bridge without touching running jobs',async t=>{
 const f=await transitionFixture(t),before=f.frozen();
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]' WHERE id='admin'").run();
 await assert.rejects(f.call(),error=>error.statusCode===403||/权限/.test(error.message));
 await runTransitionDays(f.env,now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,0);
 assert.deepEqual(f.frozen(),before);assert.equal(f.requests.length,0);
});



test('moving an approved account out of psychology removes it from bridge tasks',async t=>{
 const f=await transitionFixture(t);
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other',updated_at=? WHERE account_key='b'").run(now);
 const result=await runTransitionDays(f.env,now);assert.deepEqual(result.errors,[]);
 assert.deepEqual(f.sqlite.prepare('SELECT DISTINCT connection_id FROM psychology_transition_claims').all().map(row=>row.connection_id),['a']);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,2);assert.equal(f.requests.length,0);
});

test('policy revision and date guard prevent unintended extra days and disable a stale manual run',async t=>{
 const f=await transitionFixture(t),before=f.frozen();
 await assert.rejects(f.call('POST',{date:'2026-10-02',revision:3}),error=>error.statusCode===400);
 assert.deepEqual(f.frozen(),before);
 assert.ok((await f.call('POST',{date:'2026-10-01',revision:3})).ok);
 f.sqlite.prepare('UPDATE psychology_task_group_policies SET revision=4').run();
 const view=await(await f.call()).json();assert.equal(view.canRun,false);
 await assert.rejects(f.call('POST',{date:'2026-10-01'},'/run'),error=>error.statusCode===409);
 await runTransitionDays(f.env,now);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_transition_claims').get().n,0);
 assert.deepEqual(await runTransitionDays({DB:{prepare(){assert.fail('expired bridge must not query');}}},starts),{skipped:true});
 assert.equal(f.requests.length,0);
});
