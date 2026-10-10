import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {kvSet} from './kv.js';
import {handlePsychologyOneReport} from './psychology-one-report.js';
import {refreshReportFacts,reportVideoFactWrite} from './psychology-report-facts.js';
const actor={role:'admin',sidebarModules:['psychology-effects','psychology-ops-report']};
async function read(f,q='',user=actor,method='GET'){
 const url=new URL('https://factory.test/api/psychology-one-report?'+(q.includes('period=')?'':'period=7d&')+q),r=await handlePsychologyOneReport(new Request(url,{method}),f.env,url,{user});return {status:r.status,data:await r.json()};
}
async function seed(t){const f=await fixture(t);const now=Date.now()-60000;
 await kvSet(f.db,'official-account-groups',{projects:[{id:'p',moduleKey:'psychology',name:'心理学'},{id:'n',moduleKey:'novel-promotion',name:'小说'}],groups:[{id:'g',projectId:'p',name:'授权分组'},{id:'outside',projectId:'n',name:'其他'}],aliases:{alpha:'a',beta:'b'}});
 f.sqlite.exec("INSERT INTO official_account_assignments(account_key,group_id) VALUES('a','g'),('b','g'),('outsider','outside')");
 const add=(id,{account='a',one=true,campaign='111',published=false,videoId=id,schedule=now,publishedAt=now,receipt=false}={})=>{
  f.sqlite.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').run('b'+id,'admin',JSON.stringify({mediaType:'video',...(one?{tiktokOne:{connectionId:'brand',accountId:'222',campaignId:campaign}}:{})}),now);
  f.sqlite.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,receipt_json) VALUES(?,?,?,?,?,?,?)').run(id,'b'+id,'source','missing',account,Math.floor(schedule/1000),JSON.stringify(receipt?{batchId:'remote'}:{}));
  if(published)f.sqlite.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES(?,?,?)').run('psychology:'+id,now,JSON.stringify({autoTaskId:id,autoBatchId:'b'+id,connectionId:account,status:'published',videoId,publishedAt}));
 };return {...f,now,add};
}
test('task report isolates exact One tasks, sums once, keeps missing values and 20-row paging',async t=>{
 const f=await seed(t);for(let n=0;n<23;n++)f.add('v'+n,{published:n<3,receipt:n===3});
 f.add('ordinary',{one:false,published:true});f.add('outside',{account:'outsider',published:true,campaign:'999'});
 f.add('duplicate',{published:true,videoId:'v0'});
 await f.db.batch([reportVideoFactWrite(f.db,'a',f.now,[{id:'v0',createTime:f.now,views:0,likes:0},{id:'v1',createTime:f.now,views:2000,likes:4},{id:'ordinary',createTime:f.now,views:999999}])]);await refreshReportFacts(f.db);
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n,r=await read(f,'source=tasks');assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.summary.total,24);assert.equal(r.data.summary.views,2000);assert.equal(r.data.summary.synced,2);assert.equal(r.data.summary.averageViews,1000);assert.equal(r.data.summary.thousandRate,.5);assert.equal(r.data.summary.submitted,1);assert.equal(r.data.rows.length,20);assert.equal(r.data.pagination.pages,2);assert.deepEqual(r.data.projects.map(p=>p.campaignId),['111']);
 assert.equal((await read(f,'source=tasks&page=999')).data.pagination.page,2);
 const a=(await read(f,'source=tasks&view=accounts')).data;assert.equal(a.rows[0].views,2000);assert.equal(a.rows.length,1);
 assert.equal((await read(f,'source=tasks&campaign=777')).data.summary.views,null);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.requests.length,0);
});
test('date basis distinguishes planned tasks from actual publication across Beijing midnight',async t=>{
 const f=await seed(t),today=new Date(Date.now()+28800000).toISOString().slice(0,10),mid=Date.parse(today+'T00:00:00+08:00');f.add('cross',{published:true,schedule:mid-1000,publishedAt:mid+1000});await refreshReportFacts(f.db);
 assert.equal((await read(f,'source=tasks&period=today')).data.summary.total,0);
 assert.equal((await read(f,'source=tasks&period=today&basis=published')).data.summary.total,1);
});
test('all surfaces enforce module, canonical current group and explicit filters without writes',async t=>{
 const f=await seed(t);f.add('v');
 assert.equal((await read(f,'source=tasks', {...actor,sidebarModules:[]})).status,403);
 assert.equal((await read(f,'surface=operations&source=tasks',{...actor,sidebarModules:['psychology-effects']})).status,403);
 assert.equal((await read(f,'source=tasks&group=outside')).status,403);assert.equal((await read(f,'source=tasks&basis=wrong')).status,400);assert.equal((await read(f,'source=tasks',actor,'POST')).status,405);
 const viewer={role:'operator',sidebarModules:['psychology-effects'],allowedAccountGroups:[]};assert.equal((await read(f,'source=tasks',viewer)).data.summary.total,0);
 f.sqlite.exec("UPDATE official_account_assignments SET group_id='outside' WHERE account_key='a';INSERT INTO official_account_assignments(account_key,group_id) VALUES('alpha','g')");
 assert.equal((await read(f,'source=tasks')).data.summary.total,0);assert.equal(f.requests.length,0);
});
test('official pages are scoped, deduplicated, null-aware and freshly permission-checked even from cache',async t=>{
 const f=await seed(t);f.add('local',{published:true,videoId:'known'});f.add('bctx',{account:'b'});f.add('denied',{account:'outsider',published:true,videoId:'excluded'});await refreshReportFacts(f.db);
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const q=new URL(url).searchParams;calls.push(q.get('page'));assert.equal(init.method,'GET');assert.equal(q.get('resource'),'report');assert.equal(q.get('campaignId'),'111');return Response.json({videos:q.get('page')==='1'?[{videoId:'known',creator:'renamed',views:100,likes:0,anchorViews:100,anchorClicks:2},{videoId:'excluded',creator:'alpha',views:99999},{videoId:'unknown-outsider',creator:'outsider',views:99999}]:[{videoId:'known',creator:'renamed',views:100,anchorViews:100,anchorClicks:2},{videoId:'new',creator:'alpha',views:0,anchorViews:null,anchorClicks:90},{videoId:'missing',creator:'beta',views:null}],page_info:{total_page:2,total_number:6},fetchedAt:f.now,dateRange:{start_date:'2026-10-01',end_date:'2026-10-09'},requestId:'mock-'+q.get('page')});});
 const r=await read(f);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.source,'official');assert.deepEqual(calls,['1','2']);assert.equal(r.data.summary.total,3);assert.equal(r.data.summary.views,100);assert.equal(r.data.summary.synced,2);assert.equal(r.data.summary.anchorClicks,92);assert.equal(r.data.summary.anchorCtr,.02);assert.equal(r.data.summary.paidViews,null);assert.equal(r.data.rows.find(r=>r.videoId==='missing').views,null);assert.equal(r.data.rows.some(r=>r.videoId==='excluded'),false);
 const a=(await read(f,'view=accounts')).data;assert.equal(a.cached,true);assert.equal(a.rows.length,2);assert.equal(calls.length,2);
 f.sqlite.exec("UPDATE official_account_assignments SET group_id='outside' WHERE account_key='a'");
 const after=await read(f);assert.equal(after.status,200);assert.equal(after.data.cached,true);assert.deepEqual(after.data.rows.map(r=>r.videoId),['missing']);assert.equal(calls.length,2);
});
test('empty scope does not call provider; invalid project is denied; partial and errors stay explicit',async t=>{
 const f=await seed(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({videos:[],page_info:{total_page:21,total_number:525},fetchedAt:f.now});});
 assert.equal((await read(f)).data.summary.total,0);assert.equal(calls,0);f.add('v');
 assert.equal((await read(f,'campaign=999')).status,403);assert.equal(calls,0);
 const partial=await read(f);assert.equal(partial.data.partial,true);assert.equal(calls,20);
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'official unavailable'},{status:502}));
 const fail=await read(f,'refresh=1');assert.equal(fail.status,502);assert.match(fail.data.error,/unavailable/);
});
