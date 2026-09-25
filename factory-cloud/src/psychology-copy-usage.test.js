import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {handlePsychologyCopyLibrary} from './psychology-copy-library.js';
import {copyUsageWindow} from './psychology-copy-usage.js';
import {photoCopyKey} from './peer-photo-copy-cache.js';
const actor={username:'admin',role:'admin',sidebarModules:['psychology-copy-library']};
const now=Date.parse('2026-09-25T16:30:00Z'),yesterday=now-86400000;
async function setup(t){const f=await fixture(t);f.sqlite.exec("UPDATE psychology_copy_library SET status='done',content_json='{\"transcript\":\"Original text\"}'");const c=f.sqlite.prepare("SELECT * FROM psychology_copy_library WHERE media_type='photo' ORDER BY id LIMIT 1").get();f.copy=c;f.key=photoCopyKey(c.source_url);
 f.sqlite.prepare("INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,enabled,created_at,rewrite_model) VALUES ('rewrite','admin','rewrite-external',?,'Rewrite title','caption','[\"Page one\"]','hash',1,?,'claude-sonnet-5')").run(f.key,now);
 f.event=(id,{owner='admin',variant='',drawn=now,published=now,views=null,completion=null,snapshot=true,deleted=0}={})=>{
  f.sqlite.prepare("INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES (?,?,?,?)").run('batch-'+id,owner,'{}',drawn);
  f.sqlite.prepare("INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,deleted_at) VALUES (?,?,?,?,?,?,?)").run(id,'batch-'+id,variant?'rewrite':c.id,'job-'+id,'account-private',published/1000,deleted);
  if(snapshot)f.sqlite.prepare("INSERT INTO psychology_creative_snapshots(item_id,source_key,variant_id) VALUES (?,?,?)").run(id,f.key,variant);
  f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,state,views,completion,synced_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,'batch-'+id,'tiktok:account-private','photo',published,published,f.key,variant,'published',views,completion,now,now);
 };
 f.api=async(query='',user=actor,method='GET')=>{const url=new URL('https://factory.test/api/psychology-copy-library/usage'+query);return handlePsychologyCopyLibrary(new Request(url,{method}),f.env,url,{user});};return f;}

test('inventory, immutable draws and observed outcomes have separate clocks; zero is a sample',async t=>{
 const f=await setup(t);f.event('zero',{views:0,completion:0});f.event('thousand',{views:1000,completion:.5});f.event('rewrite',{variant:'rewrite-external',views:10000});f.event('missing');
 f.event('old-draw',{drawn:yesterday,views:2000});f.event('future-observation',{published:now+86400000});f.event('other-owner',{owner:'other',views:999999});
 const r=await f.api('?period=custom&from=2026-09-26&to=2026-09-26');assert.equal(r.status,200);const d=await r.json();
 assert.equal(d.inventory.originals,8);assert.equal(d.inventory.rewrites,1);assert.equal(d.inventory.usable,9);assert.equal(d.usage.draws,5);assert.equal(d.usage.used,1);assert.equal(d.usage.unused,7);
 assert.equal(d.effects.samples,4);assert.equal(d.effects.medianViews,1500);assert.equal(d.effects.potentialRate,.75);assert.equal(d.effects.hitRate,.25);assert.equal(d.effects.completion,.25);assert.equal(d.effects.completionSamples,2);
 const row=d.items.find(r=>r.id===f.copy.id);assert.equal(row.original.samples,3);assert.equal(row.rewrite.samples,1);assert.equal(row.rewrite.medianViews,10000);
 assert.equal(f.requests.length,0);assert.ok(!JSON.stringify(d).includes('account-private'));assert.ok(!JSON.stringify(d).includes('batch-'));
});

test('legacy original and rewrite IDs resolve correctly, removed usage remains history, versions and text are scoped',async t=>{
 const f=await setup(t);f.event('original',{snapshot:false,views:10,deleted:now});f.event('legacy-rewrite',{snapshot:false,variant:'rewrite-external',views:20});f.event('snapshot-id',{variant:'rewrite',views:30});
 let d=await (await f.api('?copy='+f.copy.id)).json();assert.equal(d.total,2);assert.equal(d.items.find(v=>v.kind==='original').draws,1);assert.equal(d.items.find(v=>v.kind==='rewrite').draws,2);
 const body=await (await f.api('?copy='+f.copy.id+'&text=rewrite-external')).json();assert.equal(body.content.pages[0],'Page one');assert.equal(body.model,'Claude Sonnet 5');
 f.sqlite.exec("UPDATE psychology_copy_variants SET deleted_at=1,enabled=0");
 d=await (await f.api()).json();assert.equal(d.inventory.rewrites,0);assert.equal(d.usage.draws,3);
 d=await (await f.api('?copy='+f.copy.id)).json();assert.equal(d.items.find(v=>v.kind==='rewrite').status,'deleted');
 assert.equal((await f.api('?copy='+f.copy.id+'&text=rewrite-external',{...actor,username:'other'})).status,404);
});

test('empty stats, inventory review states, filtering, pagination and validation',async t=>{
 const f=await setup(t);f.sqlite.exec("UPDATE psychology_copy_variants SET enabled=0,review_status='pending'");
 let d=await (await f.api('?media=photo')).json();assert.equal(d.inventory.originals,3);assert.equal(d.inventory.pending,1);assert.equal(d.inventory.usable,3);assert.equal(d.effects.samples,0);assert.equal(d.effects.medianViews,null);
 assert.equal((await (await f.api('?usage=data')).json()).total,0);assert.equal((await (await f.api('?q=not-found')).json()).inventory.originals,0);
 for(let i=0;i<25;i++)f.sqlite.prepare("INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,status,created_at,updated_at) VALUES (?,'admin','video',?,?,'{}','done',?,?)").run('copy-'+i,'unique '+i,'https://www.tiktok.com/@x/video/'+(500+i),now+i,now);
 d=await (await f.api('?page=2')).json();assert.equal(d.total,33);assert.equal(d.items.length,13);assert.equal(d.pages,2);
 assert.equal((await f.api('?period=oops')).status,400);assert.equal((await f.api('?media=oops')).status,400);assert.equal((await f.api('?copy=missing')).status,404);
 assert.equal((await f.api('',{...actor,sidebarModules:['psychology-publish']})).status,403);assert.equal((await f.api('',actor,'POST')).status,405);
});

test('Beijing dates include yesterday and reject invalid calendar values',()=>{
 assert.equal(copyUsageWindow(new URLSearchParams('period=today'),now).start,Date.parse('2026-09-25T16:00:00Z'));
 assert.equal(copyUsageWindow(new URLSearchParams('period=yesterday'),now).to,'2026-09-25');
 assert.throws(()=>copyUsageWindow(new URLSearchParams('period=custom&from=2026-02-30&to=2026-03-02'),now));
});

test('SQL aggregates beyond old 20,000 row limits and uses exact even median',async t=>{
 const f=await setup(t);f.sqlite.prepare("INSERT INTO psychology_publish_batches VALUES ('bulk','admin','{}',?)").run(now);
 const insert=f.sqlite.prepare("INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES (?,'bulk',?,'','private',?)");
 const fact=f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,state,views,updated_at) VALUES (?,'bulk','tiktok:private','photo',?,?,'published',?,?)");
 f.sqlite.exec('BEGIN');for(let i=0;i<20002;i++){insert.run('bulk-'+i,f.copy.id,now/1000);fact.run('bulk-'+i,now,now,i,now);}f.sqlite.exec('COMMIT');
 const d=await (await f.api()).json();assert.equal(d.usage.draws,20002);assert.equal(d.effects.samples,20002);assert.equal(d.effects.medianViews,10000.5);
});
