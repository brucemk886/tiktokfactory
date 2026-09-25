import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {refreshReportFacts,reportVideoFactWrite,backfillReportFacts} from './psychology-report-facts.js';
import {handleScalableOperations} from './psychology-report-query.js';
const actor={role:'admin',sidebarModules:['psychology-ops-report']};
async function read(f,q='',user=actor){const url=new URL('https://factory.test/api/psychology-operations?'+q);const res=await handleScalableOperations(new Request(url),f.env,url,{user});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;}
function seed(f,n=12){const now=Date.now()-60000;
 f.sqlite.exec("INSERT INTO official_account_assignments(account_key,group_id) VALUES('a','g'),('b','g');INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES('p','admin','g','组1','original','[]','active',0,0,0)");
 f.sqlite.prepare("INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES('b','admin',?,?)").run(JSON.stringify({mediaType:'photo'}),now);
 for(let i=0;i<n;i++){
 f.sqlite.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES(?,?,?,?,?,?)').run('i'+i,'b','v1:tiktok:200','missing','a',Math.floor(now/1000));
 f.sqlite.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES(?,?,?)').run('psychology:i'+i,now,JSON.stringify({autoTaskId:'i'+i,autoBatchId:'b',connectionId:'a',status:'published',videoId:'v'+i,publishedAt:now}));
 }
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,updated_at) VALUES('p',?,'created','b',?)").run(now,now);return now;
}
test('SQL reports: every panel, long-term metrics, delta correction, pagination and permission revocation',async t=>{
 const f=await fixture(t),now=seed(f);
 await f.db.batch([reportVideoFactWrite(f.db,'a',now,Array.from({length:12},(_,i)=>({id:'v'+i,createTime:now,views:i*1000,fullWatchRate:0.5,likes:0}))) ]);
 await refreshReportFacts(f.db);
 const first=await read(f);assert.equal(first.autopilot.summary.planned,12);assert.equal(first.autopilot.summary.synced,12);assert.equal(first.autopilot.summary.views,66000);assert.equal(first.autopilot.summary.medianViews,5500);assert.equal(first.framework.overview.current.n,12);
 for(const panel of ['accounts','content','strategy','details','batches','groups']){const data=await read(f,'panel='+panel);assert.equal(data.panel,panel);}
 f.sqlite.exec("UPDATE ops_task_facts SET title='Readable test title',copy_hash='internal-hash'");
 assert.equal((await read(f,'panel=details&mode=copy')).comparisons[0].label,'Readable test title');
 assert.equal((await read(f,'panel=details&mode=copy')).comparisons[0].key,'internal-hash');
 const details=await read(f,'panel=details&key=v1:tiktok:200');assert.equal(details.items.length,10);assert.equal(details.pagination.total,12);assert.equal((await read(f,'panel=details&key=v1:tiktok:200&page=2')).items.length,2);
 await f.db.batch([reportVideoFactWrite(f.db,'a',now+1,[{id:'v0',createTime:now,views:1234}])]);
 assert.equal((await read(f)).autopilot.summary.views,67234);
 await f.db.batch([reportVideoFactWrite(f.db,'a',now+1,[{id:'v0',createTime:now,views:1234}])]);assert.equal((await read(f)).autopilot.summary.views,67234);
 await f.db.batch([reportVideoFactWrite(f.db,'a',now-1,[{id:'v0',createTime:now,views:9000}])]);assert.equal((await read(f)).autopilot.summary.views,67234);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ops_video_facts').get().n,12);
 f.sqlite.exec('DELETE FROM official_account_assignments');assert.equal((await read(f)).autopilot.summary.planned,0);
 assert.equal(f.requests.length,0);
});
test('bounded background backfill is resumable and idempotent',async t=>{const f=await fixture(t);seed(f,3);await backfillReportFacts(f.env);await backfillReportFacts(f.env);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ops_task_facts').get().n,3);assert.equal((await read(f)).autopilot.summary.planned,3);});

test('dirty versions survive concurrent changes, including delete/reinsert ABA',async t=>{
 const f=await fixture(t);seed(f,1);const original=f.db.batch.bind(f.db);let once=true;
 f.db.batch=async statements=>{if(once){once=false;await refreshReportFacts(f.db);f.sqlite.prepare("UPDATE factory_publish_records SET value_json=? WHERE id='psychology:i0'").run(JSON.stringify({autoTaskId:'i0',autoBatchId:'b',connectionId:'a',status:'failed'}));}return original(statements);};
 await refreshReportFacts(f.db);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ops_task_dirty').get().n,1);
 await refreshReportFacts(f.db);assert.equal(f.sqlite.prepare("SELECT state FROM ops_task_facts WHERE id='i0'").get().state,'failed');assert.equal((await read(f)).autopilot.summary.failed,1);
});
test('duplicate video receipts count executions separately but metrics only once; sync racing reconciliation stays latest',async t=>{
 const f=await fixture(t),now=seed(f,2);
 f.sqlite.prepare("UPDATE factory_publish_records SET value_json=? WHERE id='psychology:i1'").run(JSON.stringify({autoTaskId:'i1',autoBatchId:'b',connectionId:'a',status:'published',videoId:'v0',publishedAt:now}));
 const original=f.db.batch.bind(f.db);let once=true;f.db.batch=async statements=>{if(once){once=false;await original([reportVideoFactWrite(f.db,'a',now,[{id:'v0',createTime:now,views:77}])]);}return original(statements);};
 await refreshReportFacts(f.db);let r=await read(f);assert.equal(r.autopilot.summary.planned,2);assert.equal(r.autopilot.summary.published,2);assert.equal(r.autopilot.summary.synced,1);assert.equal(r.autopilot.summary.views,77);
 await original([reportVideoFactWrite(f.db,'a',now+1,[{id:'v0',createTime:now,views:11}])]);r=await read(f);assert.equal(r.autopilot.summary.views,11);assert.equal(r.framework.overview.current.n,1);
});
test('publication time and scheduled day are independent, and terminal facts survive source cleanup',async t=>{
 const f=await fixture(t),now=seed(f,1);await refreshReportFacts(f.db);
 const day=Date.parse(new Date(Date.now()+28800000).toISOString().slice(0,10)+'T00:00:00+08:00');
 await f.db.batch([reportVideoFactWrite(f.db,'a',now,[{id:'v0',createTime:day-60000,views:0,likes:0}])]);let r=await read(f);assert.equal(r.autopilot.summary.synced,1);assert.equal(r.autopilot.summary.views,0);assert.equal(r.framework.overview.current.n,0);assert.equal(r.framework.overview.previous.n,1);
 f.sqlite.exec("DELETE FROM factory_publish_records;INSERT INTO ops_task_dirty(item_id) VALUES('i0')");await refreshReportFacts(f.db);r=await read(f);assert.equal(r.autopilot.summary.published,1);assert.equal(r.autopilot.summary.synced,1);
});
test('weighted median is exact for repeated values and odd/even populations; current permissions protect all panels',async t=>{
 const f=await fixture(t),now=seed(f,5);await f.db.batch([reportVideoFactWrite(f.db,'a',now,[1,1,1,9,99].map((views,i)=>({id:'v'+i,createTime:now,views}))) ]);await refreshReportFacts(f.db);
 assert.equal((await read(f)).framework.overview.current.medianViews,1);
 await f.db.batch([reportVideoFactWrite(f.db,'a',now+1,[{id:'v2',createTime:now,views:null}])]);assert.equal((await read(f)).framework.overview.current.medianViews,5);
 for(const panel of ['overview','accounts','content','strategy','details','batches','groups']){const r=await read(f,'panel='+panel,{...actor,role:'member',allowedAccountGroups:['other']});assert.ok(!JSON.stringify(r).includes('v1:tiktok:200'));if(r.autopilot)assert.equal(r.autopilot.summary.planned,0);if(r.pagination)assert.equal(r.pagination.total,0);}
 assert.equal(f.requests.length,0);
});
