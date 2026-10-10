import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {receivingFixture,now,at} from './psychology-receiving-test-fixture.js';
import {insertAutoJob} from './psychology-auto-publish.js';

test('daily receiver report deduplicates receiver traffic across publishers and canonical video receipts',async t=>{
 const f=await receivingFixture(t);f.photo('p1');f.photo('p2',{publisher:'c',views:300});f.photo('duplicate',{video:'p1'});
 f.sqlite.exec("INSERT INTO ops_video_owners VALUES('tiktok:a','p1','p1')");
 f.photo('pending',{state:'pending'});f.photo('video',{media:'video'});f.photo('unmapped',{mapped:false});
 f.click('a');f.click('b',{arrived:null});f.click('bot',{excluded:1});
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n,siteBefore=f.site.prepare('SELECT total_changes() n').get().n;
 const {data:d,status,headers}=await f.read();assert.equal(status,200,JSON.stringify(d));
 assert.equal(d.summary.posts,2);assert.equal(d.summary.views,1500);assert.equal(d.summary.publishers,2);assert.equal(d.summary.profileViews,50);assert.equal(d.summary.clicks,2);assert.equal(d.summary.arrived,1);assert.equal(d.summary.losses.arrival.conversion,.5);
 assert.equal(d.summary.unmappedPosts,1);assert.equal(d.summary.profileClickRate,null);assert.equal(d.receivers.length,1);assert.equal(d.receivers[0].sourceAccounts.length,2);assert.equal(d.details.length,2);assert.equal(d.daily[0].day,'2026-10-10');
 assert.equal(d.summary.profileComplete,false);assert.equal(d.profileWindow.timeZone,'UTC');assert.equal(d.window.timeZone,'Asia/Shanghai');
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.site.prepare('SELECT total_changes() n').get().n,siteBefore);assert.equal(f.requests.length,0);assert.equal(headers.get('Cache-Control'),'private, no-store');
});

test('Beijing boundaries and click-day cohorts preserve late arrivals without daily overcounting',async t=>{
 const f=await receivingFixture(t);f.photo('before',{publishedAt:at-1});f.photo('after',{publishedAt:at});f.click('before',{when:at-1,arrived:at+1000});f.click('after',{when:at});f.click('end',{when:at+86400000});
 const {data:d}=await f.read('period=range&from=2026-10-09&to=2026-10-10');
 assert.deepEqual(d.daily.map(r=>[r.day,r.posts,r.summary.clicks]),[['2026-10-10',1,1],['2026-10-09',1,1]]);assert.equal(d.summary.accounts,1);assert.equal(d.summary.profileAccounts,1);assert.equal(d.receivers[0].summary.accounts,1);assert.equal(d.summary.profileViews,150);assert.equal(d.summary.clicks,2);assert.equal(d.summary.arrived,2);
 assert.equal((await f.read('period=range&from=2026-02-30&to=2026-03-01')).status,400);
});

test('missing, zero and partially tracked metrics remain distinct',async t=>{
 const f=await receivingFixture(t);f.photo('null',{views:null});f.sqlite.prepare('UPDATE official_accounts_latest SET profile_json=? WHERE account_key=?').run(JSON.stringify({username:'receiver',followers:1500}),'tiktok:b');
 let {data:d}=await f.read();assert.equal(d.summary.views,null);assert.equal(d.summary.profileViews,null);assert.equal(d.summary.clicks,0);assert.equal(d.summary.losses.arrival.conversion,null);
 f.photo('zero',{views:0});f.sqlite.prepare('UPDATE psychology_website_links SET created_at=?').run(at+1000);
 ({data:d}=await f.read());assert.equal(d.summary.views,0);assert.equal(d.summary.synced,1);assert.equal(d.summary.coverageComplete,false);
 f.sqlite.exec('DELETE FROM psychology_website_link_aliases;DELETE FROM psychology_website_links');({data:d}=await f.read());assert.equal(d.summary.clicks,null);assert.equal(d.receivers[0].tracking,'no-link');
});

test('site outages keep photo/profile values and mark site unavailable',async t=>{
 const f=await receivingFixture(t);f.photo('x');f.env.DEEP_PERSONA_DB.batch=async()=>{throw Error('offline');};
 const {data:d,status}=await f.read();assert.equal(status,200);assert.equal(d.summary.views,1200);assert.equal(d.summary.profileViews,50);assert.equal(d.summary.clicks,null);assert.equal(d.siteError,true);
});

test('fresh permissions intersect both publishers and receivers, deny forged receivers and inactive modules',async t=>{
 const f=await receivingFixture(t);f.photo('in');f.photo('hidden-publisher',{publisher:'outside'});f.photo('hidden-receiver',{receiver:'outside'});
 assert.equal((await f.read()).data.summary.posts,1);assert.equal((await f.read('receiver=outside')).status,403);
 f.sqlite.exec("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'");assert.equal((await f.read()).data.summary.posts,0);
 f.sqlite.exec("UPDATE factory_users SET sidebar_modules_json='[]' WHERE username='admin'");assert.equal((await f.read()).status,403);
 assert.equal((await f.read('',null)).status,401);assert.equal((await f.read('',{username:'admin'},'POST')).status,405);
});

test('current settings never reroute published history; receiver filter and 20-row detail pages agree',async t=>{
 const f=await receivingFixture(t);for(let i=0;i<23;i++)f.photo('p'+i,{views:10});f.photo('other',{receiver:'c'});
 let {data:d}=await f.read('period=today&receiver=b&page=2');assert.equal(d.summary.posts,23);assert.equal(d.details.length,3);assert.equal(d.pagination.pages,2);assert.equal(d.summary.views,230);assert.equal(d.choices.length,2);
 f.sqlite.exec("DELETE FROM factory_jobs;DELETE FROM psychology_imported_photo_settings");({data:d}=await f.read());assert.equal(d.summary.posts,24);assert.equal(d.receivers.length,2);
});

test('receiver snapshots freeze all three job sources and survive cleanup and job deletion',async t=>{
 const f=await receivingFixture(t);
 for(const [i,extra] of [{psychologyAutomation:{photoReceiver:{receiverConnectionId:'b',username:'old',cta:'@old'}}},{importedPhotoConversion:{receiverConnectionId:'b',username:'old',cta:'@old'}},{psychologyAutomation:{conversion:{receiverConnectionId:'b',username:'old',cta:'@old'}}}].entries()){
  const payload={...extra,plan:{caption:'Original @old'},psychologyAutomation:{...extra.psychologyAutomation,id:'job'+i,connectionId:'a',mediaType:'photo'}};
  await insertAutoJob(f.db,{id:'job'+i,type:'psychology',title:'Photo',payload,createdBy:'admin'},now).run();
  payload.psychologyAutomation.photoReceiver={receiverConnectionId:'c',username:'new'};
  f.sqlite.prepare('UPDATE factory_jobs SET payload_json=? WHERE id=?').run(JSON.stringify(payload),'job'+i);
 }
 assert.deepEqual(f.sqlite.prepare('SELECT receiver_key,receiver_username FROM ops_photo_receivers').all().map(r=>[r.receiver_key,r.receiver_username]),Array(3).fill(['tiktok:b','old']));
 f.sqlite.exec("UPDATE factory_jobs SET payload_json=json_remove(payload_json,'$.plan.caption');DELETE FROM factory_jobs");assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ops_photo_receivers').get().n,3);
});

test('migration backfills frozen jobs and old allocations, including self-bio, without changing jobs',async t=>{
 const f=await receivingFixture(t);f.sqlite.exec('DROP TRIGGER ops_photo_receiver_job_insert;DROP TRIGGER ops_photo_receiver_job_update;DROP TABLE ops_photo_receivers');
 await insertAutoJob(f.db,{id:'job',type:'psychology',title:'Photo',payload:{psychologyAutomation:{id:'job',connectionId:'a',mediaType:'photo',photoReceiver:{receiverConnectionId:'b',username:'receiver'}}},createdBy:'admin'},now).run();
 f.sqlite.prepare('INSERT INTO psychology_conversion_allocations(item_id,project_key,revision,connection_id,receiver_connection_id,schedule_at,route_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run('pruned','proj-psych',1,'b','b',at,'{"username":"receiver"}',now);
 const before=f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json;
 f.sqlite.exec(fs.readFileSync(new URL('../migrations/0089_psychology_receiving_report.sql',import.meta.url),'utf8'));
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ops_photo_receivers').get().n,2);assert.equal(f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json,before);
 assert.equal(f.sqlite.prepare("SELECT receiver_key=publisher_key self FROM ops_photo_receivers WHERE item_id='pruned'").get().self,1);
});
