import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { capturePoolObservations, readPublicationTrend, readPoolObservationTrend, observationDates } from './psychology-pool-observations.js';
import { runProductionCheck } from './psychology-production-checks.js';
const DAY=86400000,stamp=s=>Date.parse(s);
function assign(f,keys,group='g'){for(const key of keys)f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(key,group);}
function fact(f,id,overrides={}){
 const row={id,batch_id:'batch',account_key:'tiktok:a',media:'photo',schedule_at:0,published_at:stamp('2026-10-29T12:00:00Z'),state:'published',views:100,completion:0.2,...overrides},keys=Object.keys(row);
 f.sqlite.prepare('INSERT INTO ops_task_facts('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));
}
function policy(f){
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[\"psychology-autopilot\"]' WHERE username='admin'").run();
 f.sqlite.prepare("INSERT INTO psychology_task_group_policies(id,project_key,owner,starts_at,ends_at,next_review_at,created_at,updated_at,time_zone) VALUES('p','proj-psych','admin',0,9999999999999,0,0,0,'America/Los_Angeles')").run();
}
const changes=f=>f.sqlite.prepare('SELECT total_changes() n').get().n;

test('seven publication cohorts use Pacific DST boundaries and exact mature medians, not today traffic',async t=>{
 const f=await fixture(t),now=stamp('2026-11-04T20:00:00Z');assign(f,['a','b']);assign(f,['outside'],'other');
 const days=observationDates(now),fallback=days.find(d=>d.date==='2026-11-01');
 assert.equal(fallback.end-fallback.start,25*3600000);assert.equal(days.length,7);
 [0,2000].forEach((views,i)=>fact(f,'valid'+i,{views,published_at:days[0].start+i*1000}));
 fact(f,'missing',{views:null,completion:null,published_at:days[0].start+2000});
 fact(f,'outside',{account_key:'tiktok:outside',views:99999,published_at:days[0].start});
 fact(f,'foreign-pilot',{pilot_id:'foreign',group_id:'other',views:99999,published_at:days[0].start});
 fact(f,'video',{media:'video',views:99999,published_at:days[0].start});
 fact(f,'pending',{state:'pending',views:99999,published_at:days[0].start});
 fact(f,'before-Pacific-midnight',{views:99999,published_at:days[0].start-1});
 fact(f,'exact-72h',{views:0,published_at:now-3*DAY});
 fact(f,'not-yet-72h',{views:9999,published_at:now-3*DAY+1});
 fact(f,'fresh',{views:9000,published_at:now-1000});
 const before=changes(f),result=await readPublicationTrend(f.db,{groupIds:['g'],now});
 assert.equal(changes(f),before);assert.equal(f.requests.length,0);
 assert.equal(result.kind,'publication-cohort');assert.match(result.basis,/最新累计/);
 const first=result.rows[0];assert.equal(first.date,'2026-10-29');
 assert.equal(first.published,3);assert.equal(first.synced,2);assert.equal(first.missingMetrics,1);assert.equal(first.n,2);
 assert.equal(first.medianViews,1000);assert.equal(first.highRate,0.5);
 const exact=result.rows.find(r=>r.date==='2026-11-01');assert.equal(exact.published,2);assert.equal(exact.n,1);assert.equal(exact.views,0);assert.equal(exact.medianViews,0);assert.equal(exact.highRate,0);
 const today=result.rows.at(-1);assert.equal(today.published,1);assert.equal(today.n,0);assert.equal(today.medianViews,null);assert.equal(today.highRate,null);
 const empty=result.rows[1];assert.equal(empty.n,0);assert.equal(empty.views,null);assert.equal(empty.medianViews,null);
});

test('repeated view frequencies yield true median, nullable completion, and revoked canonical aliases stay excluded',async t=>{
 const f=await fixture(t),now=stamp('2026-11-04T20:00:00Z');assign(f,['a','b']);assign(f,['alpha'],'g');
 f.sqlite.prepare("INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES('tiktok:a','@alpha','{\"username\":\"alpha\"}',1)").run();
 [1,1,1,9,99].forEach((views,i)=>fact(f,'b'+i,{account_key:'tiktok:b',views,completion:[0,null,0.2,2,0.6][i]}));
 fact(f,'alias-leak',{account_key:'tiktok:a',views:9999});
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
 const result=await readPublicationTrend(f.db,{groupIds:['g'],now}),row=result.rows[0];
 assert.equal(row.n,5);assert.equal(row.medianViews,1);assert.equal(row.views,111);assert.equal(row.completionN,3);
 assert.ok(Math.abs(row.completion-0.8/3)<1e-12);assert.equal(row.highRate,0);
});

test('operating-check snapshots are atomic, immutable, include unsynced accounts, and retain missing days',async t=>{
 const f=await fixture(t),now=stamp('2026-11-04T20:00:00Z');policy(f);assign(f,['a','b']);
 Array.from({length:5},(_,i)=>fact(f,'m'+i,{views:600,published_at:now-4*DAY}));
 await capturePoolObservations(f.env,now,{key:'check-1'});
 let trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now});
 assert.equal(trend.rows[0].accounts,null);assert.equal(trend.rows[0].pools,null);
 const last=trend.rows.at(-1);assert.equal(last.accounts,2);assert.equal(last.pools.strong,1);assert.equal(last.pools.observing,1);
 f.sqlite.prepare('UPDATE ops_task_facts SET views=0').run();
 const duplicate=await capturePoolObservations(f.env,now+60000,{key:'check-1'});assert.equal(duplicate.checks,0);
 assign(f,['c']);await capturePoolObservations(f.env,now,{key:'check-1'});
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_account_observations WHERE check_key='check-1'").get().n,2);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_pool_observation_checks').get().n,1);
 trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now:now+60000});
 assert.equal(trend.rows.at(-1).pools.strong,1);
 await capturePoolObservations(f.env,now+120000,{key:'check-2'});
 trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now:now+120000});
 assert.equal(trend.rows.at(-1).pools.diagnostic,1);assert.equal(trend.rows.at(-1).pools.strong,0);
 const before=changes(f);await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now:now+120000});assert.equal(changes(f),before);assert.equal(f.requests.length,0);
});

test('snapshot reads apply current authorization, captured grant coverage, and distinguish actual empty checks from no observation',async t=>{
 const f=await fixture(t),now=stamp('2026-11-04T20:00:00Z');policy(f);assign(f,['a']);
 await capturePoolObservations(f.env,now,{key:'real-empty-later'});
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
 let trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now});
 assert.equal(trend.rows.at(-1).accounts,0);assert.equal(trend.rows.at(-1).pools.observing,0);
 trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g','new-group'],now});
 assert.equal(trend.rows.at(-1).accounts,null);
 trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:[],now});
 assert.equal(trend.rows.at(-1).accounts,null);
 await capturePoolObservations(f.env,now+1000,{key:'empty'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_account_observations WHERE check_key=?').get('empty').n,0);
 trend=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now:now+1000});
 assert.equal(trend.rows.at(-1).accounts,0);assert.notEqual(trend.rows.at(-1).observedAt,null);
});

test('observation failure is isolated from publishing and observations only run in the three claimed daily checks',async t=>{
 const f=await fixture(t);let observations=0,plans=0;
 const actions={runPlans:async()=>{plans++;return {};},recalculate:async()=>({}),refreshCapacity:async()=>0,
  captureObservations:async()=>{observations++;throw new Error('synthetic observation failure');}};
 t.mock.method(console,'error',()=>{});
 const now=stamp('2026-10-02T12:00:00Z'),result=await runProductionCheck(f.env,now,actions);
 assert.equal(result.status,'done');assert.equal(result.errors,0);assert.match(result.observationError,/synthetic/);
 await runProductionCheck(f.env,now+60000,actions);await runProductionCheck(f.env,now+3600000,actions);
 assert.equal(observations,1);assert.equal(plans,1);assert.equal(f.requests.length,0);
});

test('a failed snapshot transaction cannot leave a zero-population check behind',async t=>{
 const f=await fixture(t),now=stamp('2026-11-04T20:00:00Z');policy(f);assign(f,['a']);
 const batch=f.db.batch.bind(f.db);
 t.mock.method(f.db,'batch',async items=>batch([items[0],f.db.prepare('SELECT missing_column FROM psychology_account_observations')]));
 await assert.rejects(()=>capturePoolObservations(f.env,now,{key:'failed'}),/missing_column/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_pool_observation_checks').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_account_observations').get().n,0);
});

test('observations retain fourteen days and only prune the current project during scheduled capture',async t=>{
 const f=await fixture(t),now=stamp('2026-11-04T20:00:00Z');policy(f);assign(f,['a']);
 await capturePoolObservations(f.env,now-15*DAY,{key:'old'});
 await capturePoolObservations(f.env,now-14*DAY,{key:'boundary'});
 f.sqlite.prepare('INSERT INTO psychology_pool_observation_checks(project_key,check_key,observed_at,operating_date,time_zone,group_ids_json,capture_token) VALUES(?,?,?,?,?,?,?)')
  .run('other-project','other',now-15*DAY,'2026-10-20','America/Los_Angeles','[]','other-token');
 await capturePoolObservations(f.env,now,{key:'current'});
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_pool_observation_checks WHERE project_key='proj-psych'").get().n,2);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_account_observations WHERE check_key='old'").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_pool_observation_checks WHERE project_key='other-project'").get().n,1);
});
test('Pacific snapshots remain available when reporting by Beijing days, rebucketed by capture instant without writes',async t=>{
 const f=await fixture(t);policy(f);assign(f,['a']);
 const beforeMidnight=stamp('2026-10-09T15:59:59Z'),afterMidnight=stamp('2026-10-09T16:00:01Z');
 await capturePoolObservations(f.env,beforeMidnight,{key:'before'});
 await capturePoolObservations(f.env,afterMidnight,{key:'after'});
 const before=changes(f),result=await readPoolObservationTrend(f.db,{projectId:'proj-psych',groupIds:['g'],now:afterMidnight,timeZone:'Asia/Shanghai'});
 assert.equal(result.rows.at(-1).date,'2026-10-10');assert.equal(result.rows.at(-1).observedAt,afterMidnight);
 assert.equal(result.rows.at(-2).date,'2026-10-09');assert.equal(result.rows.at(-2).observedAt,beforeMidnight);
 assert.equal(changes(f),before);assert.equal(f.requests.length,0);
});
