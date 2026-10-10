import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {kvSet} from './kv.js';
import {handlePsychologyOneReport} from './psychology-one-report.js';
import {refreshReportFacts,reportVideoFactWrite} from './psychology-report-facts.js';
const actor={role:'admin',sidebarModules:['psychology-effects','psychology-ops-report']};
async function read(f,q='',user=actor,method='GET'){
 const url=new URL('https://factory.test/api/psychology-one-report?'+(q.includes('period=')?'':q.includes('source=tasks')?'period=7d&':'period=all&')+q),r=await handlePsychologyOneReport(new Request(url,{method}),f.env,url,{user});return {status:r.status,data:await r.json()};
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
 const r=await read(f);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.source,'official');assert.deepEqual(calls,['1','2']);assert.equal(r.data.summary.total,3);assert.equal(r.data.summary.views,100);assert.equal(r.data.summary.synced,2);assert.equal(r.data.summary.anchorClicks,92);assert.equal(r.data.summary.anchorCtr,.02);assert.equal(Object.hasOwn(r.data.summary,'paidViews'),false);assert.equal(r.data.rows.find(r=>r.videoId==='missing').views,null);assert.equal(r.data.rows.some(r=>r.videoId==='excluded'),false);
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

test('official dates reconcile exact video IDs across Beijing midnight and never guess a timezone',async t=>{
 const f=await seed(t),today=new Date(Date.now()+28800000).toISOString().slice(0,10),mid=Date.parse(today+'T00:00:00+08:00');
 f.add('new',{published:true,publishedAt:mid-1000});f.add('receipt',{published:true,publishedAt:mid+1000});
 await f.db.batch([reportVideoFactWrite(f.db,'a',f.now,[{id:'new',createTime:mid+1000,views:10},{id:'old',createTime:mid-1000,views:50}])]);await refreshReportFacts(f.db);
 t.mock.method(globalThis,'fetch',async url=>{const q=new URL(url).searchParams;assert.equal(q.has('startDate'),false,'publication day must not constrain provider metric dates');return Response.json({videos:[
  {videoId:'new',creator:'alpha',publishedAt:'2020-01-01 00:00:00',views:10},
  {videoId:'old',creator:'alpha',publishedAt:today+' 05:00:00',views:50},
  {videoId:'receipt',creator:'alpha',views:1},{videoId:'no-date',creator:'alpha',publishedAt:today+' 05:00:00',views:80},
  {videoId:'explicit',creator:'alpha',publishedAt:new Date(mid+2000).toISOString(),views:2},
  {videoId:'end',creator:'alpha',publishedAt:new Date(mid+86400000).toISOString(),views:100}
 ],page_info:{total_page:1,total_number:6},fetchedAt:f.now});});
 const all=await read(f);assert.equal(all.data.summary.total,6);assert.equal(all.data.unknownDates,1);
 const recent=await read(f,'period=today');assert.equal(recent.data.summary.total,3);assert.equal(recent.data.summary.views,13);
 assert.equal(recent.data.rows.find(r=>r.videoId==='new').publishedAt,mid+1000);assert.equal(recent.data.rows.find(r=>r.videoId==='new').timeSource,'video');assert.equal(recent.data.rows.find(r=>r.videoId==='receipt').timeSource,'receipt');
 assert.equal(recent.data.displayTimeZone,'Asia/Shanghai');assert.equal(recent.data.unknownDates,1);
});

test('official detail returns all non-ad fields, preserves missing points and excludes unauthorized details',async t=>{
 const f=await seed(t);f.add('v');f.add('other',{account:'b'});
 const input={metrics:{video_views:10,reach:0,engagement_count:0,engagement_rate:0,likes:0,comments:0,shares:0,favorites:0,video_completion_rate:null,total_play_time:0,average_view_time:0,two_seconds_views:.2,six_seconds_views:.1,video_views_organic:10,reach_organic:0,average_view_time_organic:0,organic_two_seconds_views:.2,organic_six_seconds_views:.1,ad_cost:99,video_views_paid:10,paid_two_seconds_views:.8,secret:'do-not-expose'},audience:{countries:[{label:'US',value:.8},{label:'GB',value:.2}],genders:[{label:'FEMALE',value:0}],age:[{label:'2',value:1}],device:[{label:'ios',value:1}],language:[{label:'us',value:1}],locale:[{label:'Region',value:.5}],interest:[{label:'label',value:.1}],secret:[{label:'hidden',value:1}]},sources:[{label:'for_you',value:0},{label:'search',value:10},{label:'token',value:999}],retention:[1,null,.2],daily:[{date:'2026-10-09',views:0,likes:0,ad_cost:50,video_views_paid:999},{date:'2026-10-08',views:8,video_views_organic:8,likes:null}]};
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({videos:[{videoId:'123',creator:'alpha',views:10,analysis:input,anchorId:'333',anchorViews:0,anchorClicks:0,anchorUniqueViews:0,anchorUniqueClicks:0,thumbnailUrl:'javascript:alert(1)',embedUrl:'https://cdn.example.test/video.mp4'},{videoId:'456',creator:'beta',analysis:{metrics:{reach:20}}},{videoId:'789',creator:'outsider',analysis:input}],page_info:{total_page:1,total_number:3},fetchedAt:f.now});});
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const list=await read(f);assert.equal(list.data.summary.availability.audience,1);assert.equal(list.data.rows[0].analysis,undefined);assert.equal(list.data.rows[0].thumbnailUrl,undefined);
 const r=await read(f,'videoId=123');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(calls,1);assert.equal(r.data.rows.length,0);assert.equal(r.data.detail.thumbnailUrl,'');assert.equal(r.data.detail.embedUrl,'https://cdn.example.test/video.mp4');assert.equal(r.data.detail.anchorUniqueClicks,0);
 const a=r.data.detail.analysis;assert.equal(a.metrics.reach,0);assert.equal(a.metrics.video_completion_rate,null);assert.deepEqual(a.retention,[1,null,.2]);assert.deepEqual(a.sources,[{label:'for_you',value:0},{label:'search',value:10}]);assert.equal(a.audience.locale.length,1);assert.equal(a.audience.interest.length,1);assert.deepEqual(a.daily.map(d=>d.date),['2026-10-08','2026-10-09']);assert.equal(a.daily[0].likes,null);assert.equal(a.daily[1].likes,0);
 assert.doesNotMatch(JSON.stringify(r.data),/ad_cost|_paid|paid_|secret|token|do-not-expose/);
 assert.equal((await read(f,'videoId=789')).status,404);assert.equal((await read(f,'videoId=123&source=tasks&period=7d')).status,400);assert.equal((await read(f,'videoId=abc')).status,400);
 assert.equal((await read(f,'surface=operations&videoId=123',{...actor,sidebarModules:['psychology-effects']})).status,403);
 f.sqlite.exec("UPDATE official_account_assignments SET group_id='outside' WHERE account_key='a'");
 const revoked=await read(f,'videoId=123');assert.equal(revoked.status,404);assert.equal(calls,1);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before+1,'only explicit test revocation wrote');
});

test('detail respects project and publication-date selection without leaking a scoped-out video',async t=>{
 const f=await seed(t);f.add('v');t.mock.method(globalThis,'fetch',async()=>Response.json({videos:[{videoId:'123',creator:'alpha',publishedAt:'2020-01-01 00:00:00',analysis:{}}],page_info:{total_page:1,total_number:1}}));
 assert.equal((await read(f,'videoId=123&period=today')).status,404);assert.equal((await read(f,'videoId=123&campaign=999')).status,403);
 const r=await read(f,'videoId=123');assert.equal(r.status,200);assert.deepEqual(r.data.detail.available,{audience:false,retention:false,daily:false,sources:false,watch:false});assert.deepEqual(r.data.detail.analysis.retention,[]);assert.equal(r.data.detail.analysis.metrics.reach,null);
});
