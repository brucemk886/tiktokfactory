import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {enqueueAutoPhotoRender} from './psychology-auto-publish.js';
import {claimTypeFilter,handleJobs} from './jobs.js';
import {dispatchCloudPhotos,processCloudMessage,runCloudPhoto} from './psychology-cloud-queue.js';
import {enqueueGroupRetry} from './psychology-publish-retries.js';
const pages=Array.from({length:6},(_,i)=>({template:i?'content':'cover',title:'A small pause',body:'Notice your feelings.'}));
const message=id=>({body:{jobId:id},acked:0,retried:[],ack(){this.acked++;},retry(options){this.retried.push(options);}});
async function prepared(t,cloud=true){
  const f=await fixture(t),sent=[];
  f.env.PHOTO_BROWSER={};f.env.PSYCHOLOGY_CLOUD_PHOTO=String(cloud);f.env.PHOTO_QUEUE={async send(body){sent.push(body);}};
  const response=await f.call('POST',input({mediaType:'photo',template:'photo-original',count:1,connectionIds:['a']}));
  assert.equal(response.status,202);
  const source=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-photo-story'").get();
  f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({plan:{title:'QA',caption:'QA'},results:pages}),source.id);
  await enqueueAutoPhotoRender(f.env,source.id);
  return {...f,sent,id:source.id+'-render',sourceId:source.id};
}
test('new cloud photos are dispatched once and are never claimable by local workers',async t=>{
  const f=await prepared(t);assert.equal(f.sent.length,1);
  await enqueueAutoPhotoRender(f.env,f.sourceId);assert.equal(f.sent.length,1);
  const filter=claimTypeFilter({psychologyBatchUpload:true,psychologyPublishRetry:true,types:['psychology']});
  assert.equal(f.sqlite.prepare("SELECT id FROM factory_jobs WHERE status='queued'"+filter.sql).all(...filter.binds).length,0);
});
test('old source snapshots stay local after enabling cloud default',async t=>{
  const f=await prepared(t,false);f.env.PSYCHOLOGY_CLOUD_PHOTO='true';
  await enqueueAutoPhotoRender(f.env,f.sourceId);assert.equal(f.sent.length,0);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(f.id).payload_json).cloudPhotoRender,false);
});
test('duplicate queue delivery never renders twice',async t=>{
  const f=await prepared(t);let calls=0,release;
  const gate=new Promise(resolve=>release=resolve),deps={assertAccess:async()=>{},runPhoto:async()=>{calls++;await gate;return {groupReady:true};}};
  const first=processCloudMessage(f.env,message(f.id),deps);
  while(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(f.id).status!=='running')await new Promise(r=>setTimeout(r,1));
  const duplicate=message(f.id);await processCloudMessage(f.env,duplicate,deps);release();await first;
  await processCloudMessage(f.env,message(f.id),deps);assert.equal(calls,1);assert.equal(duplicate.acked,1);
});
test('upload failure retries twice, persists official failures, then releases queue',async t=>{
  const f=await prepared(t),deps={assertAccess:async()=>{},runPhoto:async()=>{throw new Error('synthetic upload 503');}};
  for(let attempt=0;attempt<3;attempt++){
    f.sqlite.prepare('UPDATE factory_jobs SET available_at=0 WHERE id=?').run(f.id);
    const msg=message(f.id);await processCloudMessage(f.env,msg,deps);
    const row=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(f.id);
    assert.equal(row.status,attempt<2?'queued':'failed');assert.equal(row.cloud_lease_until,0);
    assert.equal(msg.retried.length,attempt<2?1:0);assert.equal(JSON.parse(row.retry_history_json).length,attempt+1);
  }
});
test('future retry delivery does not claim a browser',async t=>{
  const f=await prepared(t);f.sqlite.prepare('UPDATE factory_jobs SET available_at=? WHERE id=?').run(Date.now()+60000,f.id);
  const msg=message(f.id);await processCloudMessage(f.env,msg,{runPhoto:()=>assert.fail('too early')});assert.equal(msg.retried.length,1);
});
test('cancelled jobs and a stale consumer completion cannot revive work',async t=>{
  const f=await prepared(t);await processCloudMessage(f.env,message(f.id),{assertAccess:async()=>{},runPhoto:async()=>{
    f.sqlite.prepare("UPDATE factory_jobs SET status='cancelled' WHERE id=?").run(f.id);return {};
  }});
  assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(f.id).status,'cancelled');
  await processCloudMessage(f.env,message(f.id),{runPhoto:()=>assert.fail('cancelled')});
});
test('watchdog recovers expired cloud leases but leaves active local work alone',async t=>{
  const f=await prepared(t);
  f.sqlite.prepare("UPDATE factory_jobs SET status='running',cloud_lease_until=1,worker_id='old' WHERE id=?").run(f.id);
  await dispatchCloudPhotos(f.env);
  const row=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(f.id);
  assert.equal(row.status,'queued');assert.equal(row.auto_retry_count,1);assert.equal(row.cloud_lease_until,0);
});
test('queue send failure resets dispatch marker for watchdog retry',async t=>{
  const f=await prepared(t);f.sqlite.prepare('UPDATE factory_jobs SET cloud_dispatch_at=0 WHERE id=?').run(f.id);
  f.env.PHOTO_QUEUE.send=async()=>{throw new Error('queue down');};await assert.rejects(dispatchCloudPhotos(f.env),/queue down/);
  assert.equal(f.sqlite.prepare('SELECT cloud_dispatch_at FROM factory_jobs WHERE id=?').get(f.id).cloud_dispatch_at,0);
});
test('cloud group submission retries inherit cloud ownership and run without local workers',async t=>{
  const f=await prepared(t),group=f.sqlite.prepare('SELECT g.*,b.created_by,b.config_json FROM psychology_publish_groups g JOIN psychology_publish_batches b ON b.id=g.batch_id').get();
  await enqueueGroupRetry(f.db,group,new Error('synthetic timeout'));
  const id=group.id+'-submit',row=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(id);
  assert.equal(JSON.parse(row.payload_json).cloudPhotoRender,true);
  f.sqlite.prepare('UPDATE factory_jobs SET available_at=0 WHERE id=?').run(id);
  let calls=0;await processCloudMessage(f.env,message(id),{dispatchGroup:async()=>{calls++;return {batch:{id:'mock'}};}});assert.equal(calls,1);
});
test('rendering checkpoints close Chrome before upload and resume without rerender',async t=>{
  const f=await prepared(t);f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='test' WHERE id=?").run(f.id);
  const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(f.id),events=[];
  await runCloudPhoto(f.env,job,{call:async action=>{events.push(action);return action==='state'?{assets:{0:{}},receipt:{}}:{waiting:true};},
    loadModules:async()=>[],openRenderer:async()=>({renderBatch:async entries=>entries.map(({index})=>{events.push('render-'+index);return 'jpeg';}),close:async()=>{events.push('close');return 20;}}),
    backup:async(e,item,i)=>events.push('backup-'+i)});
  assert.equal(events.filter(e=>e.startsWith('render')).length,5);assert.equal(events.includes('render-0'),false);
  assert.ok(events.indexOf('backup-1')>events.indexOf('close'));assert.ok(events.lastIndexOf('state')>events.indexOf('close'));assert.ok(events.indexOf('publish')>events.indexOf('close'));
  await runCloudPhoto(f.env,job,{call:async action=>action==='state'?{assets:Object.fromEntries(pages.map((_,i)=>[i,{}])),receipt:{}}:{waiting:true},openRenderer:()=>assert.fail('already checkpointed')});
});
test('browser closes on failed backup and no partial album is published',async t=>{
  const f=await prepared(t);f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='test' WHERE id=?").run(f.id);
  let closed=0;await assert.rejects(runCloudPhoto(f.env,f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(f.id),{
    call:async action=>{assert.notEqual(action,'publish');return {assets:{},receipt:{}};},loadModules:async()=>[],
    openRenderer:async()=>({renderBatch:async entries=>entries.map(()=>''),close:async()=>{closed++;return 0;}}),backup:async()=>{throw new Error('R2 down');}
  }),/R2 down/);assert.equal(closed,1);
});
test('probe requires worker authentication and queue config caps concurrency at two',async t=>{
  const f=await fixture(t),url=new URL('https://factory.test/api/worker/psychology-cloud-photo/probe');
  assert.equal((await handleJobs(new Request(url,{method:'POST'}),f.env,url,null)).status,401);
  const cfg=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url)));
  assert.equal(cfg.queues.consumers[0].max_concurrency,2);assert.equal(cfg.queues.consumers[0].max_batch_size,1);
});

test('six checkpointed images traverse real cloud upload and grouped submission with mocked hub',async t=>{
  const f=await prepared(t),objects=new Map();let uploads=0,closed=false;
  f.env.ARCHIVE={async put(k,b){objects.set(k,Uint8Array.from(b));},async get(k){const b=objects.get(k);return b?{arrayBuffer:async()=>b.buffer}:null;},async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])objects.delete(k);}};
  const previous=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url).endsWith('/api/v1/publish/assets')){assert.equal(closed,true);uploads++;return Response.json({assetKey:crypto.randomUUID()+'.jpg',contentType:'image/jpeg',fileSize:100});}
    return previous(url,init);
  });
  await processCloudMessage(f.env,message(f.id),{runPhoto:(env,job)=>runCloudPhoto(env,job,{
    loadModules:async()=>[],openRenderer:async()=>({renderBatch:async entries=>entries.map(()=> 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='),close:async()=>{closed=true;return 99;}})
  })});
  const row=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(f.id);
  assert.equal(row.status,'done',row.error);assert.equal(uploads,6);assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].items[0].photoAssetKeys.length,6);assert.equal(objects.size,0);
  await processCloudMessage(f.env,message(f.id));assert.equal(uploads,6);assert.equal(f.requests.length,1);
});
test('a temporarily leased submission stays queued instead of being marked done',async t=>{
  const f=await prepared(t),group=f.sqlite.prepare('SELECT g.*,b.created_by,b.config_json FROM psychology_publish_groups g JOIN psychology_publish_batches b ON b.id=g.batch_id').get();
  await enqueueGroupRetry(f.db,group,new Error('synthetic'));const id=group.id+'-submit';
  f.sqlite.prepare('UPDATE factory_jobs SET available_at=0 WHERE id=?').run(id);
  const msg=message(id);await processCloudMessage(f.env,msg,{dispatchGroup:async()=>({waiting:true})});
  assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(id).status,'queued');assert.equal(msg.retried.length,1);
});
