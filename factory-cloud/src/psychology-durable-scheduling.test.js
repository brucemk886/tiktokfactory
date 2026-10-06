import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture,at,starts,actor } from './psychology-schedule-test-fixture.js';
import {ensureScheduleWindow,dispatchScheduleWork,processScheduleMessage,SCHEDULE_POLICY} from './psychology-durable-scheduling.js';
import {readScheduleHealth,checkScheduleHealth,scheduleIncident} from './psychology-schedule-health.js';
const HOUR=3600000;
const msg=id=>({body:{id},ack(){this.acked=true;},retry(value){this.retried=value;}});
async function setup(t){
 const f=await taskFixture(t);const now=at('2026-10-02','05:00');f.setNow(now);
 f.env.SCHEDULE_QUEUE={messages:[],async send(body){this.messages.push(body);}};
 await ensureScheduleWindow(f.env,now,{owner:'admin'});
 // A successful owner preparation is a prerequisite; isolate slot delivery here.
 f.sqlite.exec("UPDATE psychology_schedule_work SET status='done',phase=1 WHERE kind='owner'");
 const w=f.sqlite.prepare("SELECT * FROM psychology_schedule_work WHERE kind='slot' ORDER BY slot_at LIMIT 1").get();
 return {...f,w,now};
}
async function drain(f,limit=12){
 for(let n=0;n<limit;n++){
  const w=f.sqlite.prepare('SELECT * FROM psychology_schedule_work WHERE id=?').get(f.w.id);
  if(['done','failed'].includes(w.status))return w;
  await processScheduleMessage(f.env,msg(w.id),{now:f.now});
 }
 throw new Error('did not complete');
}
test('watchdog creates missed planning window idempotently and dispatcher isolates owners',async t=>{
 const f=await setup(t);
 const count=f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_schedule_work').get().n;
 await ensureScheduleWindow(f.env,f.now+20*60000,{owner:'admin'});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_schedule_work').get().n,count);
 f.sqlite.prepare("INSERT INTO psychology_schedule_work(id,owner,kind,window_at,created_at,updated_at) VALUES('other','other','owner',?,?,?)").run(f.now,f.now,f.now);
 await dispatchScheduleWork(f.env,f.now,'admin');
 assert.ok(f.env.SCHEDULE_QUEUE.messages.length>0);
 assert.ok(f.env.SCHEDULE_QUEUE.messages.every(m=>m.id!=='other'));
});
test('slot resumes after committed progress and duplicate delivery creates no extra tasks',async t=>{
 const f=await setup(t);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 assert.equal(f.sqlite.prepare('SELECT phase FROM psychology_schedule_work WHERE id=?').get(f.w.id).phase,1);
 const done=await drain(f);assert.equal(done.status,'done',done.detail);
 const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items').all();
 assert.equal(items.length,2);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_schedule_members WHERE status='created'").get().n,2);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,2);
 assert.equal(f.requests.length,0,'planning must not call publishing APIs');
 const health=await readScheduleHealth(f.env,actor,null,f.now);
 assert.equal(health.rounds[0].counts.created,2);assert.equal(health.rounds[0].counts.submitted,0);assert.equal(health.rounds[0].counts.ready,0);
});
test('expired leases resume while obsolete tokens cannot commit jobs',async t=>{
 const f=await setup(t);
 f.sqlite.prepare("UPDATE psychology_schedule_work SET status='running',lease_token='old',lease_until=? WHERE id=?").run(f.now-1,f.w.id);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 assert.equal(f.sqlite.prepare('SELECT phase FROM psychology_schedule_work WHERE id=?').get(f.w.id).phase,1);
 assert.throws(()=>f.sqlite.prepare('INSERT INTO psychology_schedule_commits VALUES(?,?,?,?)').run('bad',f.w.id,'old',f.now),/SCHEDULER_LEASE_LOST/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);
});
test('a crash after atomic creation is reconciled without replaying the publish batch',async t=>{
 const f=await setup(t);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 const count=f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n;assert.equal(count,2);
 f.sqlite.prepare("UPDATE psychology_schedule_work SET status='running',lease_token='lost-response',lease_until=? WHERE id=?").run(f.now-1,f.w.id);
 const done=await drain(f);assert.equal(done.status,'done');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,count);
});
test('revoked permissions, pauses and next-day admission do not create same-day jobs',async t=>{
 const f=await setup(t);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 f.sqlite.prepare("UPDATE psychology_autopilot_accounts SET status='paused' WHERE connection_id='a'").run();
 f.sqlite.prepare("UPDATE psychology_task_group_snapshots SET effective_at=? WHERE connection_id='b'").run(starts+86400000);
 const done=await drain(f);assert.equal(done.status,'done');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_schedule_members WHERE status='skipped'").get().n,2);
});
test('five failed attempts stop only that work and report a persistent incident',async t=>{
 const f=await setup(t);
 let now=f.now;
 for(let n=0;n<5;n++){
  await processScheduleMessage(f.env,msg(f.w.id),{now,step:async()=>{throw new Error('mock resource limit');}});
  now=f.sqlite.prepare('SELECT available_at FROM psychology_schedule_work WHERE id=?').get(f.w.id).available_at;
 }
 const w=f.sqlite.prepare('SELECT * FROM psychology_schedule_work WHERE id=?').get(f.w.id);assert.equal(w.status,'failed');
 assert.equal(scheduleIncident(w,{},now).level,'critical');
 await checkScheduleHealth(f.env,now);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_schedule_alerts WHERE work_id=? AND resolved_at=0").get(w.id).n,1);
 assert.ok(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_schedule_work WHERE kind='slot' AND status='queued'").get().n>0);
});
test('material readiness, acceptance and publication are distinct monitor stages',()=>{
 const now=Date.now(),w={kind:'slot',phase:1,status:'done',slot_at:now+25*60000,created_at:now-HOUR};
 assert.match(scheduleIncident(w,{unready:3},now).message,/素材尚未就绪/);
 assert.equal(scheduleIncident(w,{unready:0},now),null);
 assert.match(scheduleIncident({...w,slot_at:now-HOUR},{unconfirmed:2},now).message,/尚未确认发布/);
 assert.equal(SCHEDULE_POLICY.chunkSize,5);
});

test('one hundred additional accounts remain bounded and every account has a durable outcome',async t=>{
 const f=await setup(t);
 for(let n=0;n<100;n++){
  const id='extra-'+String(n).padStart(3,'0');f.directory.push({id,connectionId:id,username:id,scopes:['video.publish']});
  f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,'g');
  f.registry(id);f.snapshot(id);
  for(let j=0;j<6;j++)f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,?,'photo',?,?,?,'','classic','old','published',600,0.2)").run('h-'+id+j,'history','tiktok:'+id,f.now-5*86400000,f.now-5*86400000,'history-'+j);
 }
 const done=await drain(f,60);assert.equal(done.status,'done',done.detail);
 const counts=f.sqlite.prepare("SELECT COUNT(*) n,SUM(status='pending') pending,SUM(status IN ('created','skipped')) completed FROM psychology_schedule_members WHERE work_id=?").get(f.w.id);
 assert.equal(counts.n,102);assert.equal(counts.pending,0);assert.equal(counts.completed,102);
 assert.ok(f.sqlite.prepare('SELECT MAX(n) n FROM (SELECT COUNT(*) n FROM psychology_publish_items GROUP BY batch_id)').get().n<=5);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM (SELECT connection_id,COUNT(*) c FROM psychology_publish_items GROUP BY connection_id HAVING c>1)').get().n,0);
 assert.equal(f.requests.length,0);
});
test('an abandoned empty creating slot is repaired and a later account is admitted only to its effective day',async t=>{
 const f=await setup(t);
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)").run(f.w.pilot_id,f.w.slot_at,f.now-86400000);
 assert.equal((await drain(f)).status,'done');
 const before=f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n;
 f.directory.push({id:'new',connectionId:'new',username:'new',scopes:['video.publish']});
 f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run('new','g');
 f.registry('new');f.snapshot('new',{effectiveAt:starts+86400000});
 f.sqlite.prepare("UPDATE psychology_schedule_work SET phase=0,status='queued' WHERE id=?").run(f.w.id);
 assert.equal((await drain(f)).status,'done');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,before);
});
test('revoked account is hidden from health details and cannot enter another owner recovery',async t=>{
 const f=await setup(t);await drain(f);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
 const health=await readScheduleHealth(f.env,actor,null,f.now);
 assert.ok(health.rounds.every(r=>r.details.every(d=>d.account!=='a')));
 assert.equal(health.rounds.find(r=>r.counts.created).counts.created,1);
});

test('migration survives the deployed Wrangler SQL splitter before reaching D1',async t=>{
 const fs=await import('node:fs'),vm=await import('node:vm'),{DatabaseSync}=await import('node:sqlite');
 const cli=fs.readFileSync(new URL('../node_modules/wrangler/wrangler-dist/cli.js',import.meta.url),'utf8');
 const start=cli.indexOf('function splitSqlIntoStatements('),end=cli.indexOf('var init_splitter',start);
 const split=vm.runInNewContext(cli.slice(start,end)+';splitSqlIntoStatements;');
 const sql=fs.readFileSync(new URL('../migrations/0078_psychology_durable_scheduling.sql',import.meta.url),'utf8');
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE psychology_autopilots(id TEXT PRIMARY KEY,status TEXT,ends_at INTEGER)');
 for(const statement of split(sql))db.exec(statement);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='psychology_schedule_commit_fence'").get());
});
