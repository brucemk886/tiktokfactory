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
test('concurrent consumers serialize one owner but allow another owner to run',async t=>{
 const f=await setup(t),blocked=msg(f.w.id);let ran=false;
 f.sqlite.prepare("INSERT INTO psychology_schedule_work(id,owner,kind,window_at,status,lease_token,lease_until,created_at,updated_at) VALUES('blocker','admin','slot',?,'running','active',?,?,?)").run(f.now,f.now+60000,f.now,f.now);
 await processScheduleMessage(f.env,blocked,{now:f.now,step:async()=>{ran=true;}});
 assert.equal(ran,false);assert.equal(blocked.acked,true);assert.equal(blocked.retried,undefined);
 assert.deepEqual(f.env.SCHEDULE_QUEUE.messages.at(-1),{id:f.w.id});
 assert.equal(f.sqlite.prepare('SELECT status FROM psychology_schedule_work WHERE id=?').get(f.w.id).status,'queued');

 f.sqlite.prepare("UPDATE psychology_schedule_work SET owner='other',kind='maintenance' WHERE id='blocker'").run();
 ran=false;const maintenanceBlocked=msg(f.w.id);
 await processScheduleMessage(f.env,maintenanceBlocked,{now:f.now,step:async()=>{ran=true;}});
 assert.equal(ran,false);assert.equal(maintenanceBlocked.acked,true);

 f.sqlite.prepare("UPDATE psychology_schedule_work SET kind='slot' WHERE id='blocker'").run();
 const allowed=msg(f.w.id);
 await processScheduleMessage(f.env,allowed,{now:f.now,step:async(env,w)=>{
  ran=true;
  await env.DB.prepare("UPDATE psychology_schedule_work SET status='done',lease_token='',lease_until=0 WHERE id=? AND lease_token=?").bind(w.id,w.lease_token).run();
 }});
 assert.equal(ran,true);assert.equal(allowed.acked,true);
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

test('a paused account in the middle preserves every remaining account stagger',async t=>{
 const f=await setup(t);
 for(const id of ['d','e','f']){
  f.directory.push({id,connectionId:id,username:id,scopes:['video.publish']});
  f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,'g');f.registry(id);f.snapshot(id);
  for(let j=0;j<6;j++)f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,?,'photo',?,?,?,'','classic','old','published',600,0.2)").run('history-'+id+j,'history','tiktok:'+id,f.now-5*86400000,f.now-5*86400000,'old-'+j);
 }
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 f.sqlite.prepare("UPDATE psychology_autopilot_accounts SET status='paused' WHERE connection_id='b'").run();
 assert.equal((await drain(f)).status,'done');
 const items=f.sqlite.prepare('SELECT connection_id,schedule_at FROM psychology_publish_items ORDER BY schedule_at').all();
 assert.equal(items.length,4);
 assert.equal(items.find(i=>i.connection_id==='d').schedule_at,f.w.slot_at/1000+2*45);
 assert.equal(items.find(i=>i.connection_id==='f').schedule_at,f.w.slot_at/1000+4*45);
});

test('matching reads compact reservations even when archived submission payloads are large',async t=>{
 const f=await setup(t);await drain(f);
 const blob='x'.repeat(2*1024*1024),large=JSON.stringify({media:blob});
 f.sqlite.prepare('UPDATE psychology_publish_groups SET request_json=?').run(large);
 f.sqlite.prepare('UPDATE psychology_publish_items SET ready_json=?,photo_backups_json=?').run(large,large);
 f.sqlite.prepare('UPDATE factory_jobs SET result_json=?').run(JSON.stringify({large:blob,publishFailed:false}));
 for(const i of f.sqlite.prepare('SELECT id,batch_id FROM psychology_publish_items').all())f.sqlite.prepare('INSERT INTO factory_publish_records(id,value_json) VALUES(?,?)').run('record-'+i.id,JSON.stringify({autoTaskId:i.id,autoBatchId:i.batch_id,status:'published',batchId:'remote',updatedAt:f.now,media:blob}));
 let maxBytes=0;const prepare=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{const stmt=prepare(sql),all=stmt.all;stmt.all=async function(){const r=await all.call(this);maxBytes=Math.max(maxBytes,JSON.stringify(r.results).length);return r;};return stmt;};
 const {loadPoolReservations}=await import('./psychology-pool-matching.js');
 const {loadTestState}=await import('./psychology-copy-testing.js');
 const reservations=await loadPoolReservations(f.db,'admin',starts,f.now),state=await loadTestState(f.db,'admin',f.now);
 assert.equal([...reservations.occupied.values()].reduce((n,r)=>n+r.posts,0),2);
 assert.equal([...state.stats.values()].reduce((n,r)=>n+r.posts,0),2);
 assert.ok(maxBytes<20000,'large media/request/backup blobs must stay in D1; got '+maxBytes);
});

test('partial chunks are owned immediately so stop-pending can cancel them before round completion',async t=>{
 const f=await setup(t);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 assert.equal(f.sqlite.prepare('SELECT status FROM psychology_schedule_work WHERE id=?').get(f.w.id).status,'queued');
 const slot=f.sqlite.prepare('SELECT batch_id FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').get(f.w.pilot_id,f.w.slot_at);
 assert.ok(slot.batch_id,'published batch ownership must be atomic with the chunk');
 const {stopPending}=await import('./psychology-autopilot-execution.js');
 assert.equal(await stopPending(f.db,f.w.pilot_id,'a',f.now),1);
 await drain(f);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id='a'").get().n,1);
 assert.ok(f.sqlite.prepare("SELECT deleted_at FROM psychology_publish_items WHERE connection_id='a'").get().deleted_at);
});

import {stopPending} from './psychology-autopilot-execution.js';
import {handlePsychologyAutopilot,dueSlots,pilotReadyPreparationAt,pilotContentModeAt} from './psychology-autopilot.js';
async function readyCampaignFixture(t,media='video') {
 const f=await taskFixture(t),now=at('2026-10-12','23:20'),slot=at('2026-10-13','00:30');f.setNow(now);
 f.sqlite.exec("UPDATE psychology_task_group_policies SET enabled=0; UPDATE psychology_autopilots SET status='ended'");
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-publish','psychology-autopilot','psychology-video-hits']));
 f.env.ARCHIVE={async head(){return {size:8};},async get(){return null;},async delete(){}};
 f.env.PHOTO_BROWSER={};f.env.PHOTO_QUEUE={async send(){}};f.env.SCHEDULE_QUEUE={async send(){}};
 for(const id of ['a','b','c'])f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+id,JSON.stringify({username:id,followers:1500}),now);
 f.sqlite.prepare('INSERT INTO psychology_imported_photo_settings(owner,revision,config_json) VALUES(?,?,?)').run('admin',1,JSON.stringify({receivers:[{connectionId:'c',username:'c',linkReady:true}],cta:{mention:'Visit {account} and take the test.',self:'Visit my bio.'}}));
 for(let n=0;n<2;n++){
  const source='vh-'+String(n+1).padStart(32,'0'),asset='asset-'+n;
  f.sqlite.prepare('INSERT INTO psychology_video_hits(id,owner_id,external_id,video_url,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(source,'admin',source,'https://example.test/video','Source',now,now);
  f.sqlite.prepare('INSERT INTO psychology_video_hit_versions(source_id,version,name,title,caption,enabled,input_mode,video_asset_id,created_at,updated_at) VALUES(?,1,?,?,?,1,?,?,?,?)').run(source,'Version','Ready title','Saved ready caption',media==='video'?'video':'frames',media==='video'?asset:'',now,now);
  if(media==='video'){
   f.sqlite.prepare('INSERT INTO psychology_video_assets(id,owner,r2_key,file_name,file_size,content_type,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)').run(asset,'admin','key-'+n,'clip.mp4',8,'video/mp4','ready',now,now);
   f.sqlite.prepare('INSERT INTO psychology_video_hit_videos(id,owner_id,digest,file_name,content_type,size,r2_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(asset,'admin','digest-'+n,'clip.mp4','video/mp4',8,'key-'+n,now);
  }else f.sqlite.prepare('INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,image_url,text,duration_seconds) VALUES(?,1,1,?,?,5)').run(source,'https://images.example.test/1.jpg','Saved image text');
 }
 const pilot=f.pilot({current_strategy:'evolve',task_group_policy_id:'',content_source:'video-hits',mention_receivers:1,start_now:1,created_at:now,updated_at:now,ends_at:slot+30*60000,slots_json:JSON.stringify([{hour:0,minute:30}]),campaign_slots_json:JSON.stringify([slot]),content_schedule_json:JSON.stringify([media==='video'?'video-hits-video':'video-hits-photo']),account_ids_json:JSON.stringify(['a'])});
 await ensureScheduleWindow(f.env,now,{owner:'admin',pilotId:pilot.id});
 f.sqlite.exec("UPDATE psychology_schedule_work SET status='done',phase=1 WHERE kind='owner'");
 const w=f.sqlite.prepare('SELECT * FROM psychology_schedule_work WHERE pilot_id=?').get(pilot.id);
 return {...f,w,now,pilot,slot};
}
for(const media of ['video','photo'])test('durable ready '+media+' uses saved material, freezes CTA, owns partial batches and cancels safely',async t=>{
 const f=await readyCampaignFixture(t,media),done=await drain(f);
 assert.equal(done.status,'done',done.detail);
 const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items').all();assert.equal(items.length,1);assert.equal(items[0].connection_id,'a','fixed roster excludes b');
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(items[0].job_id),payload=JSON.parse(job.payload_json);
 assert.equal(payload.psychologyAutomation.photoReceiver.username,'c');
 assert.equal(media==='video'?payload.publish.videoDesc:payload.plan.caption,'Saved ready caption\n\nVisit @c and take the test.');
 const batch=JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches').get().config_json);assert.equal(batch.sourceType,'video-hits');assert.equal(batch.mentionReceiver,true);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_schedule_commits').get().n,1);
 const linked=f.sqlite.prepare('SELECT batch_id FROM psychology_autopilot_slots WHERE autopilot_id=?').get(f.pilot.id).batch_id;assert.equal(linked,items[0].batch_id);
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,1);
 assert.equal(await stopPending(f.db,f.pilot.id),1);assert.ok(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items').get().deleted_at>0);assert.equal(f.requests.length,0);
});
test('ready reservations roll back when a plan pauses during the final atomic commit',async t=>{
 const f=await readyCampaignFixture(t,'video');await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.sqlite.prepare("UPDATE psychology_autopilots SET status='paused' WHERE id=?").run(f.pilot.id);return batch(statements);};
 await processScheduleMessage(f.env,msg(f.w.id),{now:f.now});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_video_hit_versions WHERE publish_item_id<>''").get().n,0);assert.equal(f.requests.length,0);
});
test('a six-round campaign has no extra midnight round and later material preparation waits for exactly two hours',()=>{
 const created=at('2026-10-12','23:20'),exact=[at('2026-10-13','00:30'),at('2026-10-13','01:30'),at('2026-10-13','23:30'),at('2026-10-14','00:30'),at('2026-10-14','23:30'),at('2026-10-15','00:30')];
 const p={created_at:created,ends_at:exact.at(-1)+20*60000,campaign_slots_json:JSON.stringify(exact),slots_json:'[]',start_now:1,content_source:'video-hits',schedule_timezone:'Asia/Shanghai',content_schedule_json:JSON.stringify(['video-hits-video','video-hits-video','video-hits-video','video-hits-video','video-hits-video','video-hits-photo'])};
 assert.deepEqual(dueSlots(p,created),exact.slice(0,4));
 assert.equal(pilotReadyPreparationAt(p,exact[0]),created);assert.equal(pilotReadyPreparationAt(p,exact[2]),exact[2]-2*HOUR);assert.equal(pilotReadyPreparationAt(p,exact[4]),exact[4]-2*HOUR);assert.equal(pilotContentModeAt(p,exact[5]),'video-hits-photo');
 assert.deepEqual(dueSlots(p,at('2026-10-15','02:00')),[]);
});
test('paused campaign creation saves the fixed roster and source, and retries return the same plan',async t=>{
 const f=await readyCampaignFixture(t),freshActor={...actor,sidebarModules:['psychology-publish','psychology-autopilot','psychology-video-hits']};
 f.sqlite.prepare("UPDATE psychology_autopilots SET status='ended' WHERE group_id='g'").run();
 const url=new URL('https://factory.test/api/psychology-autopilot'),body={requestId:crypto.randomUUID(),groupId:'g',strategy:'evolve',days:3,startNow:true,deferStart:true,contentSource:'video-hits',mentionReceivers:true,connectionIds:['a'],campaignSlots:[f.slot],contentSchedule:['video-hits-video'],slots:[{hour:0,minute:30}]};
 const create=b=>handlePsychologyAutopilot(new Request(url,{method:'POST',body:JSON.stringify(b)}),f.env,url,{user:freshActor});
 const saved=await(await create(body)).json(),row=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(saved.id);assert.equal(row.status,'paused');assert.equal(row.content_source,'video-hits');assert.equal(row.mention_receivers,1);assert.deepEqual(JSON.parse(row.account_ids_json),['a']);
 const again=await(await create(body)).json();assert.equal(again.id,saved.id);assert.equal(again.duplicate,true);
 await assert.rejects(create({...body,mentionReceivers:false}),/requestId/);
 await assert.rejects(create({...body,requestId:crypto.randomUUID(),connectionIds:['outside']}),/分组/);
});
