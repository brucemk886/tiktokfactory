import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input } from './psychology-cloud-test-fixture.js';
import { handlePsychologyAutoPublish,dispatchPhotoBatch } from './psychology-auto-publish.js';
import { makeProductionPlan,generationPlanStatement,recalculateAdaptiveProduction,dispatchAdaptiveProduction,beginAdaptiveProduction } from './psychology-adaptive-production.js';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
const HOUR=3600000,now=Date.parse('2026-10-02T10:00:00Z');
function seed(f,id='x',at=now+4*HOUR){
 const plan=makeProductionPlan({policy:'adaptive-v1',leadMs:2*HOUR,requiredLeadMs:2*HOUR},at,now);
 f.sqlite.prepare("INSERT OR IGNORE INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES('b','admin','{}',?)").run(now);
 f.sqlite.prepare("INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) VALUES(?,'b',?,1)").run('g-'+id,f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_groups').get().n);
 const payload={psychologyAutomation:{id,cloudPhotoRender:true,scheduleAt:at/1000,generateAt:plan.generationAt,productionPlan:plan}};
 f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,created_by,payload_json,created_at,updated_at,available_at) VALUES(?,'psychology-photo-story','queued','admin',?,?,?,?)").run(id,JSON.stringify(payload),now,now,plan.generationAt);
 f.sqlite.prepare("INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,publish_group_id) VALUES(?,'b','source',?,'a',?,?)").run(id,id,at/1000,'g-'+id);
 return f.db.batch([generationPlanStatement(f.db,id,plan,now)]);
}
const context=(accounts=500)=>({load:{jobs:[],sampleMs:[],accountCounts:{admin:accounts}},owners:new Map([['admin',{accountCount:accounts}]])});
const planRow=f=>f.sqlite.prepare("SELECT * FROM psychology_generation_plans WHERE job_id='x'").get();

test('adaptive creation is atomic and defers workflow; public body cannot enable internal production policy',async t=>{
 const f=await fixture(t),body=input({mediaType:'photo',template:'photo-text',count:2,scheduleAt:Math.floor(Date.now()/1000)+5*3600});
 const req=new Request('https://factory.test/api/psychology-auto-publish',{method:'POST',body:JSON.stringify(body)});
 const actor={user:{id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']}};
 const res=await handlePsychologyAutoPublish(req,f.env,new URL(req.url),actor,{productionLeadMs:3*HOUR,productionPlan:{policy:'adaptive-v1',leadMs:3*HOUR,requiredLeadMs:4*HOUR}});
 assert.equal(res.status,202);const created=await res.json();assert.equal(f.instances.size,0);assert.equal(f.requests.length,0);
 const rows=f.sqlite.prepare('SELECT gp.*,j.available_at,j.payload_json,i.schedule_at FROM psychology_generation_plans gp JOIN factory_jobs j ON j.id=gp.job_id JOIN psychology_publish_items i ON i.id=j.id').all();
 assert.equal(rows.length,2);for(const row of rows){assert.equal(row.generation_at,row.schedule_at*1000-3*HOUR);assert.equal(row.available_at,row.generation_at);assert.equal(JSON.parse(row.plan_json).capacityRisk,true);}
 await dispatchPhotoBatch(f.env,created.batchId);assert.equal(f.instances.size,0);
 const external=await f.call('POST',input({mediaType:'photo',template:'photo-text',count:2,productionPlan:{policy:'adaptive-v1',leadMs:3*HOUR}}));assert.equal(external.status,202);assert.equal(f.instances.size,2);
});

test('backlog advances untouched work no earlier than 3h; lower load cannot delay it or change frozen publish/content fields',async t=>{
 const f=await fixture(t);await seed(f);
 const before=f.sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE id='x'").get().payload_json;
 assert.equal((await recalculateAdaptiveProduction(f.env,now,context())).advanced,1);
 assert.equal(planRow(f).generation_at,now+HOUR);assert.equal(planRow(f).lead_ms,3*HOUR);assert.equal(JSON.parse(planRow(f).plan_json).capacityRisk,true);
 await recalculateAdaptiveProduction(f.env,now+60000,context(1));assert.equal(planRow(f).generation_at,now+HOUR);
 assert.equal(f.sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE id='x'").get().payload_json,before);
 assert.equal(f.sqlite.prepare("SELECT schedule_at FROM psychology_publish_items WHERE id='x'").get().schedule_at,(now+4*HOUR)/1000);
 assert.equal(f.requests.length,0);
});

test('running, dispatched, retry, rendered, cancelled and submitted work never gets retimed or dispatched',async t=>{
 const f=await fixture(t);for(const id of ['running','dispatched','retry','rendered','cancelled','submitted','child','lease','started'])await seed(f,id,now+HOUR);
 f.sqlite.exec("UPDATE factory_jobs SET status='running' WHERE id='running'; UPDATE psychology_generation_plans SET dispatch_at=1 WHERE job_id='dispatched'; UPDATE factory_jobs SET auto_retry_count=1 WHERE id='retry'; UPDATE psychology_publish_items SET ready_json='{\"images\":[]}' WHERE id='rendered'; UPDATE factory_jobs SET status='cancelled' WHERE id='cancelled'; UPDATE psychology_publish_groups SET request_json='{\"externalId\":\"frozen\"}' WHERE id='g-submitted'; UPDATE psychology_publish_items SET job_id='child-render' WHERE id='child'; UPDATE psychology_generation_plans SET started_at=1 WHERE job_id='started'");
 f.sqlite.prepare("UPDATE psychology_generation_plans SET dispatch_lease_until=? WHERE job_id='lease'").run(now+60000);
 const before=f.sqlite.prepare('SELECT * FROM psychology_generation_plans ORDER BY job_id').all();
 assert.equal((await recalculateAdaptiveProduction(f.env,now,context())).evaluated,0);
 assert.equal((await dispatchAdaptiveProduction(f.env,now)).dispatched,0);assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_generation_plans ORDER BY job_id').all(),before);
});

test('lost dispatch response retries stable ids after lease and never restarts workflows',async t=>{
 const f=await fixture(t);await seed(f,'x',now+HOUR);let calls=0;const ids=new Set();
 f.env.PEER_PHOTO_WORKFLOW.createBatch=async batch=>{calls++;for(const item of batch)ids.add(item.id);if(calls===1)throw new Error('lost reply');return [];};
 await assert.rejects(dispatchAdaptiveProduction(f.env,now),/lost reply/);assert.equal((await dispatchAdaptiveProduction(f.env,now+60000)).dispatched,0);
 assert.equal((await dispatchAdaptiveProduction(f.env,now+120000)).dispatched,1);assert.equal(ids.size,1);assert.equal(calls,2);
 assert.equal((await dispatchAdaptiveProduction(f.env,now+180000)).dispatched,0);assert.equal(f.requests.length,0);
});

test('dispatch limit is 100 and overlapping ticks do not duplicate leased work',async t=>{
 const f=await fixture(t);for(let i=0;i<101;i++)await seed(f,'x'+i,now+HOUR);
 let calls=0;f.env.PEER_PHOTO_WORKFLOW.createBatch=async batch=>{calls++;assert.ok(batch.length<=100);};
 const results=await Promise.all([dispatchAdaptiveProduction(f.env,now),dispatchAdaptiveProduction(f.env,now)]);
 assert.equal(results.reduce((sum,r)=>sum+r.dispatched,0),100);assert.equal(calls,1);
 assert.equal((await dispatchAdaptiveProduction(f.env,now+60000)).dispatched,1);
});

test('adaptive workflow rejects early start and skips cancelled work before any provider call',async t=>{
 const f=await fixture(t);await seed(f,'x',now+4*HOUR);
 await assert.rejects(beginAdaptiveProduction(f.db,'x',now),/尚未到/);
 f.sqlite.exec("UPDATE factory_jobs SET status='cancelled' WHERE id='x'");
 const step={do:async(name,config,action)=>(action||config)(),sleep:async()=>assert.fail('no legacy sleep')};
 assert.deepEqual(await runPeerPhotoWorkflow(f.env,{payload:{jobId:'x'}},step),{skipped:true});assert.equal(f.requests.length,0);
});

test('cancellation between gate read and claim cannot revive queued source work',async t=>{
 const f=await fixture(t);await seed(f,'x',now+HOUR);const batch=f.db.batch;
 f.db.batch=async items=>{f.sqlite.exec("UPDATE factory_jobs SET status='cancelled' WHERE id='x'");return batch(items);};
 assert.equal(await beginAdaptiveProduction(f.db,'x',now),false);assert.equal(planRow(f).started_at,0);
 assert.equal(f.sqlite.prepare("SELECT status FROM factory_jobs WHERE id='x'").get().status,'cancelled');
});

test('begin claims once and due dispatch does not recalculate saved plans',async t=>{
 const f=await fixture(t);await seed(f,'x',now+HOUR);
 const result=await dispatchAdaptiveProduction(f.env,now+60000);assert.equal(result.dispatched,1);
 assert.equal(await beginAdaptiveProduction(f.db,'x',now+60000),true);assert.equal(planRow(f).started_at,now+60000);
 assert.equal(await beginAdaptiveProduction(f.db,'x',now+120000),true);assert.equal(planRow(f).started_at,now+60000);
 assert.equal((await recalculateAdaptiveProduction(f.env,now+120000,context())).evaluated,0);
});

function seedProductionRegistry(f,owner,total) {
 const id='registry-'+owner;
 f.sqlite.prepare("INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,starts_at,ends_at,next_review_at,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?)")
  .run(id,id,owner,now,now+7*24*HOUR,now+3*24*HOUR,now,now);
 const add=f.sqlite.prepare("INSERT INTO psychology_task_group_accounts(policy_id,connection_id,first_seen_at,enrolled,updated_at) VALUES(?,?,?,1,?)");
 for(let i=0;i<total;i++)add.run(id,owner+'-'+i,now,now);
 return id;
}

test('new registry members increase a waiting plan even before directory forecasts or executors exist',async t=>{
 const f=await fixture(t);await seed(f);const policy=seedProductionRegistry(f,'admin',187);
 const stale={load:{jobs:[],sampleMs:[],forecasts:[]},owners:new Map()};
 assert.equal((await recalculateAdaptiveProduction(f.env,now,stale)).advanced,1);
 let plan=JSON.parse(planRow(f).plan_json);assert.equal(plan.accountCount,187);assert.equal(plan.forecastJobs,187);assert.equal(plan.leadMs,2.5*HOUR);
 const add=f.sqlite.prepare("INSERT INTO psychology_task_group_accounts(policy_id,connection_id,first_seen_at,enrolled,updated_at) VALUES(?,?,?,1,?)");
 for(let i=187;i<287;i++)add.run(policy,'admin-'+i,now,now);
 assert.equal((await recalculateAdaptiveProduction(f.env,now+60000,stale)).advanced,1);
 plan=JSON.parse(planRow(f).plan_json);assert.equal(plan.accountCount,287);assert.equal(plan.forecastJobs,287);
 assert.equal(plan.leadMs,3*HOUR);assert.equal(plan.requiredLeadMs,3.25*HOUR);assert.equal(plan.capacityRisk,true);
 assert.equal(f.instances.size,0);assert.equal(f.requests.length,0);
});

test('other owners newly enrolled capacity is added only up to its missing forecast count',async t=>{
 const f=await fixture(t);await seed(f);seedProductionRegistry(f,'admin',20);seedProductionRegistry(f,'other',187);
 const load={jobs:[],sampleMs:[],forecasts:[{owner:'admin',slotAt:now+4*HOUR,accountCount:20},{owner:'other',slotAt:now+4*HOUR,accountCount:10}]};
 await recalculateAdaptiveProduction(f.env,now,{load,owners:new Map([['admin',{accountCount:20}]])});
 const plan=JSON.parse(planRow(f).plan_json);
 assert.equal(plan.accountCount,20);assert.equal(plan.forecastJobs,207);assert.equal(plan.leadMs,2.5*HOUR);
 assert.equal(load.forecasts.length,2,'shared forecasting snapshot is immutable');
});

test('a lost begin result can replay started running work without replacing its original start',async t=>{
 const f=await fixture(t);await seed(f,'x',now+HOUR);
 assert.equal(await beginAdaptiveProduction(f.db,'x',now),true);
 const first=planRow(f).started_at;assert.equal(first,now);
 assert.equal(f.sqlite.prepare("SELECT status FROM factory_jobs WHERE id='x'").get().status,'running');
 assert.equal(await beginAdaptiveProduction(f.db,'x',now+1),true);
 assert.equal(planRow(f).started_at,first);
 assert.equal((await dispatchAdaptiveProduction(f.env,now+60000)).dispatched,0);
 assert.equal(f.instances.size,0);assert.equal(f.requests.length,0);
});

test('explicit operator retry restarts the original failed adaptive workflow and is not blocked by its start history',async t=>{
 const f=await fixture(t);await seed(f,'x',now+HOUR);
 f.sqlite.exec("UPDATE factory_jobs SET payload_json=json_set(payload_json,'$.psychologyAutomation.connectionId','a') WHERE id='x'");
 assert.equal(await beginAdaptiveProduction(f.db,'x',now),true);
 f.sqlite.exec("UPDATE factory_jobs SET status='failed',error='synthetic provider failure',result_json='{\"production\":{\"stage\":\"script\"}}' WHERE id='x'");
 f.instances.set('x',1);
 const result=await f.call('POST',{},'/api/psychology-auto-publish/x/retry');assert.equal(result.status,200);
 assert.equal(f.instances.get('x'),2);
 assert.equal(f.sqlite.prepare("SELECT status FROM factory_jobs WHERE id='x'").get().status,'queued');
 assert.equal(await beginAdaptiveProduction(f.db,'x',now+60000),true);
 assert.equal(planRow(f).started_at,now);
 assert.equal(f.sqlite.prepare("SELECT status FROM factory_jobs WHERE id='x'").get().status,'running');
 assert.equal(f.requests.length,0);
});
