import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {handleVideoHitProduction} from './psychology-video-hit-production.js';
import {hitPhotoInventory,loadHitPhotoImage} from './psychology-video-hit-photos.js';
import {resolveHitVideo} from './psychology-video-hit-publishing.js';
import {runCloudPhoto,dispatchCloudPhotos} from './psychology-cloud-queue.js';
import {handleAutoPhotoWorker} from './psychology-auto-photo.js';
import {collectVideoHitAssets,VIDEO_HIT_GRACE_MS} from './psychology-video-hit-cleanup.js';
import {normalizeAutoPublish} from '../../scripts/psychology-auto-publish.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const jpg=jpeg.encode({width:1,height:1,data:Buffer.from([32,120,240,255])},85).data;
const actor={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-video-hits']};
const photoInput=(refs,extra={})=>input({mediaType:'photo',template:'selected-photo',sourceType:'video-hits',isAiGenerated:true,connectionIds:['a'],count:refs.length,photoVersions:refs,...extra});
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(actor.sidebarModules));
 const files=new Map();f.files=files;f.sent=[];f.env.PHOTO_BROWSER={};f.env.PHOTO_QUEUE={async send(x){f.sent.push(x);}};
 f.env.ARCHIVE={async put(k,b){files.set(k,new Uint8Array(b));},async get(k){const b=files.get(k);return b?{body:b,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;},async head(k){return files.has(k)?{}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}};
 const originalFetch=globalThis.fetch;f.uploads=[];f.failUploadAt=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).endsWith('/api/v1/publish/assets')){const index=f.uploads.length;if(f.failUploadAt===index+1){f.failUploadAt=0;throw Error('synthetic upload failure');}const asset={assetKey:crypto.randomUUID()+'.jpg',contentType:'image/jpeg',fileName:decodeURIComponent(options.headers['X-File-Name']),fileSize:options.body.byteLength};f.uploads.push({asset,bytes:Buffer.from(options.body)});return Response.json(asset);}return originalFetch(url,options);});
 f.write=async(path,body,method='PUT')=>{const request=new Request('https://factory.test/api/psychology-video-hits'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...body})});return handleVideoHits(request,f.env,new URL(request.url),{user:actor});};
 f.ready=async(count=8,{privateImages=false,type='image/jpeg'}={})=>{const sourceId=(await(await f.write('',{externalId:crypto.randomUUID(),videoUrl:'https://www.tiktok.com/@qa/video/1',title:'Source title',script:'Original script'},'POST')).json()).id;
 await f.write('/'+sourceId+'/frames/0',{revision:1,frames:Array.from({length:count},(_,i)=>({index:i+1,imageUrl:'https://images.example.com/original-'+i+'.jpg'}))});
 await f.write('/'+sourceId+'/versions/1',{revision:0,title:'Saved title',caption:'Saved caption with #psychology',script:'Existing narration'});
 const frames=Array.from({length:count},(_,i)=>{if(!privateImages)return {index:i+1,imageUrl:'https://images.example.com/frame-'+i+'.jpg'};const id=crypto.randomUUID(),key='psychology-video-hits/admin/'+id+'/test',bytes=type==='image/png'?png:jpg;f.sqlite.prepare('INSERT INTO psychology_video_hit_assets(id,owner_id,r2_key,content_type,size,digest,created_at,last_touched_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'admin',key,type,bytes.length,id,Date.now(),Date.now());files.set(key,bytes);return {index:i+1,assetId:id};});
 await f.write('/'+sourceId+'/frames/1',{revision:1,frames});await f.write('/'+sourceId+'/versions/1',{revision:2,enabled:true});return {sourceId,version:1,revision:3};};
 f.inventory=async()=> (await hitPhotoInventory(f.env,actor,new URL('https://factory.test/api/psychology-video-hits/photo-library'))).json();
 f.job=()=>f.sqlite.prepare("SELECT * FROM factory_jobs WHERE json_extract(payload_json,'$.hitPhoto')=1 ORDER BY id").get();
 f.claim=()=>{const job=f.job();f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='cloud:test' WHERE id=?").run(job.id);return f.job();};
 return f;
}
test('photo library exposes ordered saved frames and disables over-limit versions; filtering and permissions apply',async t=>{
 const f=await setup(t),a=await f.ready(12),b=await f.ready(16);let library=await f.inventory();assert.equal(library.total,2);const valid=library.items.find(v=>v.ref.sourceId===a.sourceId);assert.equal(valid.frameCount,12);assert.equal(valid.eligible,true);assert.deepEqual(valid.frames.map(f=>f.index),[1,2,3,4,5,6,7,8,9,10,11,12]);assert.match(library.items.find(v=>v.ref.sourceId===b.sourceId).reason,/1–15/);
 f.sqlite.prepare('UPDATE psychology_video_hit_versions SET enabled=0 WHERE source_id=?').run(b.sourceId);assert.equal((await f.inventory()).total,1);
 const request=new Request('https://factory.test/api/psychology-video-hits/photo-library');assert.equal((await handleVideoHitProduction(request,f.env,new URL(request.url),{user:actor})).status,200);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();await assert.rejects(f.inventory(),e=>e.statusCode===403);
});
test('direct photo batch freezes saved copy and all frames, uses cloud queue, and replays without duplicate reservation',async t=>{
 const f=await setup(t),ref=await f.ready(8,{privateImages:true}),body=photoInput([ref]);assert.equal((await f.call('POST',body)).status,202);const job=f.job(),payload=JSON.parse(job.payload_json);assert.equal(job.type,'psychology');assert.equal(payload.plan.caption,'Saved caption with #psychology');assert.equal(payload.pages.length,8);assert.deepEqual(payload.pages.map(x=>x.index),[1,2,3,4,5,6,7,8]);assert.equal(payload.psychologyAutomation.isAiGenerated,true);assert.equal(f.instances.size,0);assert.equal(f.sent.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_job_assets').get().n,8);
 assert.equal((await(await f.call('POST',body)).json()).duplicate,true);assert.equal(f.sent.length,1);assert.equal((await f.inventory()).total,0);
 await assert.rejects(f.call('POST',{...body,name:'Different'}),e=>e.statusCode===409);await assert.rejects(f.call('POST',photoInput([ref])),/已修改|提交/);await assert.rejects(resolveHitVideo(f.env,actor,ref),/已被提交/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,1);assert.equal(f.requests.length,0);
});
test('stale and already-video-reserved versions reject entire selection without partial jobs',async t=>{
 const f=await setup(t),a=await f.ready(),b=await f.ready();await assert.rejects(f.call('POST',photoInput([a,{...b,revision:2}])),/刷新/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_video_hit_versions WHERE publish_item_id<>''").get().n,0);
 f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='video-job',publish_state='reserved' WHERE source_id=?").run(b.sourceId);await assert.rejects(f.call('POST',photoInput([a,b])),/刷新/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
});
test('atomic reservation fences a source update between reads and transaction',async t=>{
 const f=await setup(t),ref=await f.ready(),batch=f.db.batch.bind(f.db);f.db.batch=async rows=>{f.sqlite.prepare('UPDATE psychology_video_hits SET revision=revision+1 WHERE id=?').run(ref.sourceId);return batch(rows);};await assert.rejects(f.call('POST',photoInput([ref])),e=>e.statusCode===409);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);assert.equal(f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions').get().publish_item_id,'');
});
test('missing or foreign private assets cannot be selected, and collector races roll back pins',async t=>{
 const f=await setup(t),ref=await f.ready(1,{privateImages:true});f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='deleted'").run();assert.equal((await f.inventory()).items[0].eligible,false);await assert.rejects(f.call('POST',photoInput([ref])),e=>e.statusCode===410);
 f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='active'").run();const batch=f.db.batch.bind(f.db);f.db.batch=async rows=>{f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='deleting'").run();return batch(rows);};await assert.rejects(f.call('POST',photoInput([ref])),e=>e.statusCode===409);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
});
test('normalizer requires exact unique refs, AI choice and no rewriting; max 15 enforced before reservation',async t=>{
 const f=await setup(t),ref=await f.ready(16);await assert.rejects(f.call('POST',photoInput([ref])),/1–15/);for(const extra of [{photoVersions:[ref,ref],count:2},{rewriteCopy:true},{isAiGenerated:undefined},{allowPeerReuse:true},{tiktokOne:{connectionId:'brand',accountId:'1',campaignId:'2'}}])assert.throws(()=>normalizeAutoPublish(photoInput([ref],extra)));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
});
test('queue send failure leaves committed batch recoverable by dispatcher',async t=>{
 const f=await setup(t),ref=await f.ready();f.env.PHOTO_QUEUE.send=async()=>{throw Error('queue temporarily down');};assert.equal((await f.call('POST',photoInput([ref]))).status,202);assert.equal(f.job().cloud_dispatch_at,0);f.env.PHOTO_QUEUE.send=async x=>f.sent.push(x);await dispatchCloudPhotos(f.env);assert.equal(f.sent.length,1);
});
test('eight saved JPEGs publish in order through existing grouped Hub path with caption and AI flag; replay sends once',async t=>{
 const f=await setup(t),ref=await f.ready(8,{privateImages:true});await f.call('POST',photoInput([ref]));const job=f.claim();const result=await runCloudPhoto(f.env,job,{openConverter:()=>assert.fail('JPEG needs no browser')});assert.ok(result.publishSummary.batchId);assert.equal(f.requests.length,1);const item=f.requests[0].items[0];assert.equal(item.photoAssetKeys.length,8);assert.deepEqual(item.photoAssetKeys,f.uploads.map(x=>x.asset.assetKey));assert.equal(item.postInfo.title,'Saved title');assert.equal(item.postInfo.caption,'Saved caption with #psychology');assert.equal(item.postInfo.isAiGenerated,true);assert.equal(f.uploads.every(x=>x.bytes.equals(jpg)),true);await runCloudPhoto(f.env,job);assert.equal(f.requests.length,1);assert.equal(f.uploads.length,8);
});
test('PNG converts once, failures retain checkpoints and never submit partial albums; retry resumes',async t=>{
 const f=await setup(t),ref=await f.ready(8,{privateImages:true,type:'image/png'});await f.call('POST',photoInput([ref]));const job=f.claim();let opened=0,closed=0,converted=0;const deps={openConverter:async()=>{opened++;return {async convert(url){assert.match(url,/^data:image\/png/);converted++;return 'data:image/jpeg;base64,'+jpg.toString('base64');},async close(){closed++;return 2;}};}};
 f.failUploadAt=3;await assert.rejects(runCloudPhoto(f.env,job,deps),/synthetic upload failure/);assert.equal(f.uploads.length,2);assert.equal(f.requests.length,0);assert.equal(closed,1);await runCloudPhoto(f.env,job,deps);assert.equal(f.uploads.length,8);assert.equal(f.requests.length,1);assert.equal(opened,2);assert.equal(closed,2);assert.equal(converted,8,'failed upload restored from durable backup rather than fetched/reconverted');
});
test('worker access is rechecked and private image read respects owner/deleted state',async t=>{
 const f=await setup(t),ref=await f.ready(1,{privateImages:true});await f.call('POST',photoInput([ref]));const job=f.claim();const request=new Request('https://factory.test/api/worker/psychology-auto/'+job.id+'/image/0',{headers:{'x-factory-worker':'other'}});await assert.rejects(handleAutoPhotoWorker(request,f.env,new URL(request.url)),e=>e.statusCode===409);f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[\"psychology-publish\"]'").run();await assert.rejects(runCloudPhoto(f.env,job),e=>e.statusCode===403);await assert.rejects(loadHitPhotoImage(f.env,{...job,created_by:'other'},0),e=>e.statusCode===404);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(actor.sidebarModules));f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='deleted'").run();await assert.rejects(loadHitPhotoImage(f.env,job,0),e=>e.statusCode===404);assert.equal(f.uploads.length,0);
});
test('external image loader follows safe redirects but rejects private targets and oversized bytes',async t=>{
 const f=await setup(t),ref=await f.ready(1);await f.call('POST',photoInput([ref]));const job=f.claim();f.env.fetch=async()=>Response.redirect('https://127.0.0.1/private',302);await assert.rejects(loadHitPhotoImage(f.env,job,0),/公网|公开|内网|IP|地址/);f.env.fetch=async()=>new Response(new Uint8Array(8*1024*1024+1),{headers:{'content-type':'image/jpeg'}});await assert.rejects(loadHitPhotoImage(f.env,job,0),e=>e.statusCode===413);f.env.fetch=async()=>new Response(jpg,{headers:{'content-type':'image/jpeg'}});assert.deepEqual(Buffer.from(await(await loadHitPhotoImage(f.env,job,0)).arrayBuffer()),jpg);
});
test('confirmed publication plus 24h cleans frozen photo copies and private files; active jobs delay cleanup',async t=>{
 const f=await setup(t),ref=await f.ready(8,{privateImages:true});await f.call('POST',photoInput([ref]));const job=f.claim();await runCloudPhoto(f.env,job);assert.equal((await collectVideoHitAssets(f.env,{now:Date.now()+2*VIDEO_HIT_GRACE_MS})).versions,0);f.sqlite.prepare("UPDATE factory_publish_records SET value_json=json_set(value_json,'$.officialRemoteStatus','published')").run();const v=f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions').get();assert.ok(v.published_at>0);const now=v.published_at+VIDEO_HIT_GRACE_MS+1000;assert.equal((await collectVideoHitAssets(f.env,{now})).versions,0);f.sqlite.prepare("UPDATE factory_jobs SET status='done'").run();assert.equal((await collectVideoHitAssets(f.env,{now:v.published_at+VIDEO_HIT_GRACE_MS-1})).versions,0);assert.equal((await collectVideoHitAssets(f.env,{now})).versions,1);const payload=JSON.parse(f.job().payload_json);assert.equal(payload.pages,undefined);assert.equal(payload.plan.caption,undefined);assert.equal(f.files.size,0);assert.equal(f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions').get().publish_item_id,job.id);assert.equal((await f.inventory()).total,0);
});
test('15-image album and another version share one group, frozen order and per-account schedule',async t=>{
 const f=await setup(t),first=await f.ready(15,{privateImages:true}),second=await f.ready(1,{privateImages:true});const body=photoInput([first,second],{connectionIds:['a','b'],staggerSeconds:60,musicIds:['123','456']});await f.call('POST',body);const jobs=f.sqlite.prepare("SELECT * FROM factory_jobs ORDER BY id").all();for(const j of jobs)f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='cloud:test' WHERE id=?").run(j.id);
 const waiting=await runCloudPhoto(f.env,{...jobs[0],status:'running',worker_id:'cloud:test'});assert.equal(waiting.groupReady,true);assert.equal(f.requests.length,0);await runCloudPhoto(f.env,{...jobs[1],status:'running',worker_id:'cloud:test'});assert.equal(f.requests.length,1);const items=f.requests[0].items;assert.equal(items[0].photoAssetKeys.length,15);assert.equal(items[1].photoAssetKeys.length,1);assert.deepEqual(items.map(i=>i.connectionId),['a','b']);assert.equal(items[1].scheduleAt-items[0].scheduleAt,60000);assert.deepEqual(items.map(i=>i.postInfo.musicSoundId),['123','456']);assert.equal(f.instances.size,0);
});
test('already frozen 35-image jobs remain publishable after new admission is capped at 15',async t=>{
 const f=await setup(t),ref=await f.ready(15,{privateImages:true});await f.call('POST',photoInput([ref]));const job=f.claim(),payload=JSON.parse(job.payload_json);payload.pages=Array.from({length:35},(_,i)=>({...payload.pages[i%15],index:i+1}));f.sqlite.prepare('UPDATE factory_jobs SET payload_json=? WHERE id=?').run(JSON.stringify(payload),job.id);await runCloudPhoto(f.env,f.job());assert.equal(f.requests.length,1);assert.equal(f.requests[0].items[0].photoAssetKeys.length,35);
});

test('continued photo version 21 uses saved images and the same once-only queue reservation',async t=>{
 const f=await setup(t),old=await f.ready(12,{privateImages:true});f.sqlite.prepare('UPDATE psychology_video_hit_versions SET version=21 WHERE source_id=?').run(old.sourceId);f.sqlite.prepare('UPDATE psychology_video_hit_frames SET version=21 WHERE source_id=? AND version=1').run(old.sourceId);
 const ref={...old,version:21};assert.equal((await f.inventory()).items[0].ref.version,21);assert.equal((await f.call('POST',photoInput([ref]))).status,202);assert.equal(JSON.parse(f.job().payload_json).pages.length,12);await assert.rejects(f.call('POST',photoInput([ref])),/已修改|提交/);assert.equal(f.requests.length,0);
});
