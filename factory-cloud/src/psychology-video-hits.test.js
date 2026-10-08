import {handleVideoTransfer,handleVideoLibrary} from './psychology-video-library.js';
import {createHash} from 'node:crypto';
import {handleVideoHitVideos} from './psychology-video-hit-videos.js';
import {pngCrc} from './topic-png.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import worker from './index.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {handleVideoHitProduction} from './psychology-video-hit-production.js';
import {handleVideoHitAssets} from './psychology-video-hit-assets.js';
import {handleFactoryApi} from './factory-api.js';
import {toPublicUser} from './auth.js';
import {claimTypeFilter,officialPublishFollowupPayload} from './jobs.js';
import {canAccessPath,moduleIdForPath} from './sidebar.js';
import {pageFileFor,isPublicPath} from './pages.js';
const root='https://factory.test';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'));
async function setup(t){
 const f=await fixture(t),files=new Map();
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits','psychology-publish','factory-api']));
 f.user=()=>toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 f.env.ARCHIVE={async put(k,b,options={}){const bytes=b instanceof ReadableStream?new Uint8Array(await new Response(b).arrayBuffer()):new Uint8Array(b);if(options.sha256&&createHash('sha256').update(bytes).digest('hex')!==options.sha256)throw Error('SHA256 mismatch');files.set(k,bytes);return {};},async get(k,options={}){if(!files.has(k))return null;const bytes=files.get(k),range=options.range?.get('range')?.match(/^bytes=(\d+)-(\d+)$/);if(range){const offset=Number(range[1]),length=Math.min(bytes.length-1,Number(range[2]))-offset+1;return {body:bytes.slice(offset,offset+length),size:bytes.length,range:{offset,length}};}return {body:bytes,size:bytes.length};},async delete(k){files.delete(k);},async head(k){return files.has(k)?{}:null;}};
 f.call=async(path='',method='GET',body,user=f.user())=>{
  const r=new Request(root+'/api/psychology-video-hits'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),url=new URL(r.url),session={user};
  return await handleVideoHitVideos(r,f.env,url,session)||await handleVideoHitAssets(r,f.env,url,session)||await handleVideoHitProduction(r,f.env,url,session)||handleVideoHits(r,f.env,url,session);
 };
 f.write=(path,body,method='PUT')=>f.call(path,method,{requestId:crypto.randomUUID(),...body});
 f.create=async()=> (await (await f.write('',{externalId:'source-'+crypto.randomUUID(),videoUrl:'https://www.tiktok.com/@source/video/123456789',title:'Source title',script:'Source narration',videoData:{playCount:5000}},'POST')).json()).id;
 f.ready=async()=>{
  const id=await f.create();await f.write('/'+id+'/frames/0',{revision:1,frames:[{index:1,imageUrl:'https://images.pexels.com/source.jpg',durationSeconds:3}]});
  await f.write('/'+id+'/versions/1',{revision:0,name:'Version 1',title:'Original recreation',caption:'Caption',script:'A complete new narration.'});
  await f.write('/'+id+'/frames/1',{revision:1,frames:[{index:1,imageUrl:'https://images.pexels.com/remix.jpg',text:'New frame',durationSeconds:3}]});
  await f.write('/'+id+'/versions/1',{revision:2,enabled:true});return id;
 };
 const req=new Request(root+'/api/factory-api/key',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});f.token=(await (await handleFactoryApi(req,f.env,new URL(req.url),{user:f.user()})).json()).apiKey;
 f.gateway=(action,params={},requestId)=>worker.fetch(new Request(root+'/api/v1/factory',{method:'POST',headers:{authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify({module:'psychology',action,params,...(requestId?{requestId}:{})})}),f.env,{});
 return {...f,files};
}
test('owner-scoped source/import is idempotent; gateway supports all frame/version operations',async t=>{
 const f=await setup(t),uuid=crypto.randomUUID(),params={body:{externalId:'source',videoUrl:'https://www.tiktok.com/@source/video/123456789',title:'Source',script:'Narration',videoData:{playCount:100}}};
 const first=await f.gateway('videoHits.create',params,uuid);assert.equal(first.status,200);const a=await first.json();
 assert.deepEqual(await (await f.gateway('videoHits.create',params,uuid)).json(),a);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hits').get().n,1);
 assert.equal((await f.gateway('videoHits.create',{body:{...params.body,title:'Changed'}},uuid)).status,409);
 const frames=await f.gateway('videoHits.frames.write',{id:a.id,version:'0',body:{revision:1,frames:[{index:1,imageUrl:'https://images.pexels.com/a.jpg'}]}},crypto.randomUUID());assert.equal(frames.status,200,await frames.clone().text());
 await f.gateway('videoHits.versions.write',{id:a.id,version:'20',body:{revision:0,title:'Version20',script:'New script'}},crypto.randomUUID());
 const d=await (await f.gateway('videoHits.get',{id:a.id})).json();assert.equal(d.versions[0].version,20);
 assert.equal((await f.gateway('videoHits.versions.write',{id:a.id,version:'21',body:{revision:0,title:'No'}},crypto.randomUUID())).status,400);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();assert.equal((await f.gateway('videoHits.get',{id:a.id})).status,403);
 assert.equal(canAccessPath({role:'operator',sidebarModules:['psychology-video-hits']},'/psychology-video-hits.html'),false);
});
test('revision conflicts roll back frame writes; incomplete versions cannot enable; original edits disable all versions',async t=>{
 const f=await setup(t),id=await f.create();
 await f.write('/'+id+'/versions/1',{revision:0,title:'New',script:'New script'});
 await assert.rejects(f.write('/'+id+'/versions/1',{revision:1,enabled:true}),/补齐/);
 await f.write('/'+id+'/frames/0',{revision:1,frames:[{index:1,imageUrl:'https://images.pexels.com/a.jpg'}]});
 await assert.rejects(f.write('/'+id+'/frames/0',{revision:1,frames:[{index:2,imageUrl:'https://images.pexels.com/b.jpg'}]}),/revision/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames').get().n,1);
 await f.write('/'+id+'/frames/1',{revision:2,frames:[{index:1,imageUrl:'https://images.pexels.com/b.jpg'}]});
 await f.write('/'+id+'/versions/1',{revision:3,enabled:true});
 await f.write('/'+id+'/frames/0',{revision:2,frames:[{index:2,imageUrl:'https://images.pexels.com/c.jpg'}]});
 const v=(await (await f.call('/'+id)).json()).versions[0];assert.equal(v.enabled,false);assert.equal(v.revision,5);
});
test('concurrent CAS rejects the loser before any dependent frames are written',async t=>{
 const f=await setup(t),id=await f.create(),before=f.db.batch;let injected=false;
 f.db.batch=async rows=>{if(!injected){injected=true;f.sqlite.prepare('UPDATE psychology_video_hits SET revision=2 WHERE id=?').run(id);}return before(rows);};
 await assert.rejects(f.write('/'+id+'/frames/0',{revision:1,frames:[{index:1,imageUrl:'https://images.pexels.com/a.jpg'}]}),/数据已变化/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames').get().n,0);
});
test('binary image upload reuses the project key, owns bytes, rejects mismatched files and UUID conflicts',async t=>{
 const f=await setup(t),id=crypto.randomUUID();
 const upload=(bytes=png,token=f.token,type='image/png')=>worker.fetch(new Request(root+'/api/integrations/psychology/video-hits/assets/'+id,{method:'PUT',headers:{authorization:'Bearer '+token,'Content-Type':type},body:bytes}),f.env,{});
 assert.equal((await upload()).status,201);assert.equal((await upload()).status,200);
 assert.equal(f.files.size,1);assert.equal((await upload(png.slice(0,12))).status,400);assert.equal((await upload(png,f.token,'image/jpeg')).status,400);assert.equal((await upload(png,'wrong')).status,401);
 const data=new TextEncoder().encode('note\0other'),chunk=new Uint8Array(12+data.length),view=new DataView(chunk.buffer);view.setUint32(0,data.length);chunk.set(new TextEncoder().encode('tEXt'),4);chunk.set(data,8);view.setUint32(8+data.length,pngCrc(chunk.slice(4,8+data.length)));const other=new Uint8Array(png.length+chunk.length);other.set(png.slice(0,-12));other.set(chunk,png.length-12);other.set(png.slice(-12),png.length-12+chunk.length);assert.equal((await upload(other)).status,409);
 const source=await f.create();await f.write('/'+source+'/frames/0',{revision:1,frames:[{index:1,assetId:id}]});
 const fake=crypto.randomUUID();await assert.rejects(f.write('/'+source+'/frames/0',{revision:2,frames:[{index:2,assetId:fake}]}),/素材不存在/);
 f.sqlite.prepare("UPDATE psychology_video_hit_assets SET owner_id='someone'").run();await assert.rejects(f.call('/assets/'+id+'/file'),/无权/);
});
test('render-only never publishes; snapshots survive edits; legacy workers cannot claim',async t=>{
 const f=await setup(t),id=await f.ready(),uuid=crypto.randomUUID(),body={requestId:uuid,revision:3,voiceGender:'female'};
 const result=await (await f.call('/'+id+'/versions/1/render','POST',body)).json();await f.call('/'+id+'/versions/1/render','POST',body);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE type='psychology-video-remix'").get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);
 const j=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(result.jobIds[0]),p=JSON.parse(j.payload_json);assert.equal(p.publish,undefined);assert.equal(p.videoRemix.frames[0].imageUrl,'https://images.pexels.com/remix.jpg');
 await f.write('/'+id+'/versions/1',{revision:3,script:'Changed later'});
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(j.id).payload_json).videoRemix.script,'A complete new narration.');
 assert.match(claimTypeFilter({}).sql,/type<>'psychology-video-remix'/);assert.doesNotMatch(claimTypeFilter({psychologyVideoRemix:true}).sql,/type<>'psychology-video-remix'/);assert.equal(f.requests.length,0);
});
test('explicit publish freezes authorized account/schedule/caption and same-account version nonreuse',async t=>{
 const f=await setup(t),id=await f.ready(),body={revision:3,connectionIds:['a'],scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true};
 const r=await (await f.write('/'+id+'/versions/1/publish',body,'POST')).json();
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(r.jobIds[0]),p=JSON.parse(job.payload_json);
 assert.equal(p.publish.videoDesc,'Caption');assert.equal(p.publish.isAiGenerated,true);assert.equal(p.psychologyAutomation.connectionId,'a');
 const followup=officialPublishFollowupPayload({...job,worker_id:'worker'}, {results:[{fileName:'test.mp4'}]});assert.equal(followup.publish.autoPublish,true);assert.equal(followup.renderWorkerId,'worker');
 await assert.rejects(f.write('/'+id+'/versions/1/publish',body,'POST'),/已提交发布/);
 await assert.rejects(f.write('/'+id+'/versions/1/publish',{...body,connectionIds:['b']},'POST'),/已提交发布/);
 const fresh=await f.ready();
 await assert.rejects(f.write('/'+fresh+'/versions/1/publish',{...body,connectionIds:['outside']},'POST'),/分配分组/);
 await assert.rejects(f.write('/'+fresh+'/versions/1/publish',{...body,scheduleAt:1},'POST'),/30分钟/);
 assert.equal(f.requests.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,1);
});
test('frame pagination uses frame number ranges so incomplete versions align with originals',async t=>{
 const f=await setup(t),id=await f.create();
 await f.write('/'+id+'/versions/1',{revision:0,title:'Version'});
 await f.write('/'+id+'/frames/1',{revision:1,frames:[{index:21,imageUrl:'https://images.pexels.com/a.jpg'}]});
 assert.equal((await (await f.call('/'+id+'/frames/1?page=1')).json()).frames.length,0);
 assert.equal((await (await f.call('/'+id+'/frames/1?page=2')).json()).frames[0].index,21);
});

test('worker claim, private frozen image and render completion feed the existing official publishing lane',async t=>{
 const f=await setup(t),source=await f.create(),asset=crypto.randomUUID();
 const imageRequest=new Request(root+'/api/integrations/psychology/video-hits/assets/'+asset,{method:'PUT',headers:{authorization:'Bearer '+f.token,'Content-Type':'image/png'},body:png});assert.equal((await worker.fetch(imageRequest,f.env,{})).status,201);
 await f.write('/'+source+'/frames/0',{revision:1,frames:[{index:1,assetId:asset}]});
 await f.write('/'+source+'/versions/1',{revision:0,title:'Integrated',script:'Narration',caption:'Integrated caption'});
 await f.write('/'+source+'/frames/1',{revision:1,frames:[{index:1,assetId:asset}]});await f.write('/'+source+'/versions/1',{revision:2,enabled:true});
 const created=await (await f.write('/'+source+'/versions/1/publish',{revision:3,connectionIds:['a'],scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true},'POST')).json();
 const call=(path,body,method='POST',workerId='w')=>worker.fetch(new Request(root+path,{method,headers:{Authorization:'Bearer test-worker','x-factory-worker':workerId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),f.env,{});
 const claim=await call('/api/worker/claim',{workerId:'w',types:['psychology-video-remix'],psychologyVideoRemix:true,psychologyBatchUpload:true});assert.equal(claim.status,200,await claim.clone().text());assert.equal((await claim.json()).job.id,created.jobIds[0]);
 const imagePath='/api/worker/psychology-video-hits/'+created.jobIds[0]+'/assets/'+asset;assert.equal((await call(imagePath,undefined,'GET')).status,200);assert.equal((await call(imagePath,undefined,'GET','other')).status,403);
 const done=await call('/api/worker/jobs/'+created.jobIds[0]+'/complete',{percent:100,result:{publishPending:true,results:[{fileName:'integrated.mp4',title:'Integrated'}]}});assert.equal(done.status,200,await done.clone().text());
 const publishJob=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='official-publish'").get(),p=JSON.parse(publishJob.payload_json);assert.equal(p.renderWorkerId,'w');assert.equal(p.publish.videoDesc,'Integrated caption');assert.equal(p.psychologyAutomation.submissionMode,'grouped');
 assert.equal(f.sqlite.prepare('SELECT job_id FROM psychology_publish_items WHERE id=?').get(created.jobIds[0]).job_id,publishJob.id);assert.equal(f.requests.length,0);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();assert.equal((await call(imagePath,undefined,'GET')).status,403);
});
test('all twenty versions are independently writable and owner boundaries hold for source, frames and jobs',async t=>{
 const f=await setup(t),id=await f.create();
 for(let version=1;version<=20;version++)await f.write('/'+id+'/versions/'+version,{revision:0,title:'Version '+version,script:'Script '+version});
 const detail=await (await f.call('/'+id)).json();assert.equal(detail.versions.length,20);
 f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other' WHERE id=?").run(id);
 await assert.rejects(f.call('/'+id),/无权/);await assert.rejects(f.call('/'+id+'/frames/0'),/无权/);await assert.rejects(f.call('/'+id+'/versions/1/jobs'),/无权/);
});

test('video-hit child pages retain the same administrator module grant',()=>{
 for(const path of ['/psychology-video-hits','/psychology-video-hits/recreations','/psychology-video-hits/detail']){
  assert.equal(pageFileFor(path),'psychology-video-hits.html');assert.equal(isPublicPath(path),false);assert.equal(moduleIdForPath(path),'psychology-video-hits');
  assert.equal(canAccessPath({role:'admin',sidebarModules:['psychology-video-hits']},path),true);
  assert.equal(canAccessPath({role:'admin',sidebarModules:[]},path),false);
  assert.equal(canAccessPath({role:'operator',sidebarModules:['psychology-video-hits']},path),false);
 }
});

const movie=Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
function uploadVideo(f,id=crypto.randomUUID(),bytes=movie,overrides={}){
 return worker.fetch(new Request(root+'/api/integrations/psychology/video-hits/videos/'+id,{method:'PUT',headers:{Authorization:'Bearer '+f.token,'Content-Type':'video/mp4','X-File-Name':'recreation.mp4','X-File-Size':String(bytes.length),'X-Content-SHA256':createHash('sha256').update(bytes).digest('hex'),...overrides},body:bytes}),f.env,{});
}
test('streamed ready-video upload verifies bytes, replays immutable UUID, private range preview and fresh permission',async t=>{
 const f=await setup(t),id=crypto.randomUUID();let response=await uploadVideo(f,id);assert.equal(response.status,201,await response.clone().text());assert.equal((await response.json()).videoAssetId,id);
 assert.equal((await uploadVideo(f,id)).status,200);assert.equal(f.files.size,1);
 assert.equal((await uploadVideo(f,id,movie,{'X-File-Name':'other.mp4'})).status,409);
 assert.equal((await uploadVideo(f,crypto.randomUUID(),movie,{'X-Content-SHA256':'f'.repeat(64)})).status,400);assert.equal(f.files.size,1);
 assert.equal((await uploadVideo(f,crypto.randomUUID(),movie.slice(0,8))).status,413);
 assert.equal((await uploadVideo(f,crypto.randomUUID(),movie,{'Content-Type':'image/png'})).status,400);
 assert.equal((await uploadVideo(f,crypto.randomUUID(),new Uint8Array(24))).status,400);
 const request=new Request(root+'/api/psychology-video-hits/videos/'+id+'/file',{headers:{range:'bytes=4-11'}}),range=await handleVideoHitVideos(request,f.env,new URL(request.url),{user:f.user()});assert.equal(range.status,206);assert.equal(range.headers.get('Content-Range'),'bytes 4-11/24');assert.deepEqual(new Uint8Array(await range.arrayBuffer()),movie.slice(4,12));
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();assert.equal((await uploadVideo(f,id)).status,403);
});
test('ready-video versions need no frames or script, publish once globally and survive pruning receipts',async t=>{
 const f=await setup(t),source=await f.create(),asset=crypto.randomUUID();assert.equal((await uploadVideo(f,asset)).status,201);
 await f.write('/'+source+'/versions/1',{revision:0,title:'Ready video',caption:'Ready caption',inputMode:'video',videoAssetId:asset,enabled:true});
 const version=(await (await f.call('/'+source)).json()).versions[0];assert.equal(version.inputMode,'video');assert.equal(version.enabled,true);assert.match(version.videoPreviewUrl,/videos/);
 await assert.rejects(f.write('/'+source+'/versions/1/render',{revision:1},'POST'),/无需合成/);
 await assert.rejects(f.write('/'+source+'/frames/1',{revision:1,frames:[{index:1,imageUrl:'https://images.pexels.com/a.jpg'}]}),/不能修改分镜/);
 const body={requestId:crypto.randomUUID(),revision:1,connectionIds:['a'],scheduleAt:Math.floor(Date.now()/1000)+600,isAiGenerated:true};
 const response=await f.call('/'+source+'/versions/1/publish','POST',body),result=await response.json();assert.equal(response.status,200);
 assert.deepEqual(await (await f.call('/'+source+'/versions/1/publish','POST',body)).json(),result);
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(result.jobIds[0]),payload=JSON.parse(job.payload_json);assert.equal(job.type,'psychology-selected-video');assert.equal(payload.assetId,asset);assert.equal(payload.videoRemix,undefined);assert.equal(payload.publish.videoDesc,'Ready caption');assert.equal(f.requests.length,0);
 await assert.rejects(f.write('/'+source+'/versions/1/publish',{...body,requestId:crypto.randomUUID(),connectionIds:['b']},'POST'),/已提交发布/);
 await assert.rejects(f.write('/'+source+'/versions/1',{revision:1,title:'Try to reset'}),/不能修改/);
 const record={autoTaskId:result.jobIds[0],status:'submitted',shareLink:'https://www.tiktok.com/@alpha/video/123'};
 f.sqlite.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES(?,?,?)').run('receipt',Date.now(),JSON.stringify(record));
 assert.equal((await (await f.call('/'+source+'/versions/1/jobs')).json()).publication.status,'queued');
 f.sqlite.prepare('UPDATE factory_publish_records SET value_json=? WHERE id=?').run(JSON.stringify({...record,officialRemoteStatus:'published'}),'receipt');
 f.sqlite.prepare('DELETE FROM factory_publish_records').run();f.sqlite.prepare('DELETE FROM factory_jobs').run();
 const status=(await (await f.call('/'+source+'/versions/1/jobs')).json()).publication;assert.equal(status.status,'published');assert.equal(status.postUrl,record.shareLink);
 await assert.rejects(f.write('/'+source+'/versions/1/publish',{...body,requestId:crypto.randomUUID()},'POST'),/已提交发布/);
});
test('render new UUIDs deduplicate the same frozen version and completed MP4 is reused for publication',async t=>{
 const f=await setup(t),source=await f.ready(),renderPath='/'+source+'/versions/1/render';
 const first=await (await f.write(renderPath,{revision:3},'POST')).json(),second=await (await f.write(renderPath,{revision:3},'POST')).json();assert.deepEqual(first.jobIds,second.jobIds);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,1);
 f.sqlite.prepare("UPDATE factory_jobs SET status='done',worker_id='w',result_json=? WHERE id=?").run(JSON.stringify({results:[{fileName:'ready.mp4'}]}),first.jobIds[0]);
 assert.equal((await (await f.call('/'+source)).json()).versions[0].renderState,'done');
 const publication=await (await f.write('/'+source+'/versions/1/publish',{revision:3,connectionIds:['a'],scheduleAt:Math.floor(Date.now()/1000)+600,isAiGenerated:true},'POST')).json();
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(publication.jobIds[0]),payload=JSON.parse(job.payload_json);assert.equal(job.type,'official-publish');assert.equal(payload.renderWorkerId,'w');assert.equal(payload.psychologyAutomation.id,publication.jobIds[0]);assert.equal(payload.videos[0].fileName,'ready.mp4');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE type='psychology-video-remix'").get().n,1);assert.equal(f.requests.length,0);
});

test('ready-video official transfer stages the original file, preserves current permission, and blocks library bypass',async t=>{
 const f=await setup(t),source=await f.create(),asset=crypto.randomUUID();await uploadVideo(f,asset);
 const metadata={revision:0,title:'Ready',caption:'Frozen caption',inputMode:'video',videoAssetId:asset,enabled:true};
 const written=await f.gateway('videoHits.versions.write',{id:source,version:'1',body:metadata},crypto.randomUUID());assert.equal(written.status,200,await written.clone().text());
 const result=await (await f.write('/'+source+'/versions/1/publish',{revision:1,connectionIds:['a'],scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true},'POST')).json();
 const id=result.jobIds[0];f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(id);
 const originalFetch=globalThis.fetch;let uploads=0;t.mock.method(globalThis,'fetch',async (url,init={})=>{if(String(url).endsWith('/api/v1/publish/assets')){uploads++;return Response.json({assetKey:crypto.randomUUID()+'.mp4'});}return originalFetch(url,init);});
 const request=new Request(root+'/api/worker/psychology-video-transfer/'+id,{method:'POST',headers:{'x-factory-worker':'w'}});
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-publish','factory-api']));await assert.rejects(handleVideoTransfer(request,f.env,new URL(request.url)),/视频爆款权限/);assert.equal(uploads,0);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits','psychology-publish','factory-api']));
 const transfer=await handleVideoTransfer(request,f.env,new URL(request.url));assert.equal(transfer.status,200);await handleVideoTransfer(request,f.env,new URL(request.url));assert.equal(uploads,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].items[0].postInfo.caption,'Frozen caption');assert.equal(f.requests[0].items[0].postInfo.isAiGenerated,true);
 const second=await f.create();await f.write('/'+second+'/versions/1',metadata);await assert.rejects(f.write('/'+second+'/versions/1/publish',{revision:1,connectionIds:['b'],scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true},'POST'),/不能重复使用同一视频/);
 const library=new Request(root+'/api/psychology-video-publish',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),items:[{assetId:asset,connectionId:'a',caption:'Bypass',scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true}],tiktokOne:{connectionId:'brand',accountId:'123',campaignId:'456'}})});
 await assert.rejects(handleVideoLibrary(library,f.env,new URL(library.url),{user:f.user()}),/视频爆款成片/);
});
test('concurrent version publication claim rolls back loser batch even with a new request UUID',async t=>{
 const f=await setup(t),id=await f.ready(),batch=f.db.batch;let injected=false;
 f.db.batch=async rows=>{if(!injected){injected=true;f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='winner' WHERE source_id=? AND version=1").run(id);}return batch(rows);};
 await assert.rejects(f.write('/'+id+'/versions/1/publish',{revision:3,connectionIds:['a'],scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true},'POST'),/数据已变化/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
});

test('legacy render identifiers are reused and generated preview import cannot bypass publication reservation after pruning',async t=>{
 const f=await setup(t),source=await f.ready(),first=await (await f.write('/'+source+'/versions/1/render',{revision:3},'POST')).json();
 f.sqlite.prepare("UPDATE factory_jobs SET id='vh-render-legacy' WHERE id=?").run(first.jobIds[0]);f.sqlite.prepare("UPDATE psychology_video_hit_versions SET render_job_id='vh-render-legacy' WHERE source_id=?").run(source);
 const replay=await (await f.write('/'+source+'/versions/1/render',{revision:3},'POST')).json();assert.deepEqual(replay.jobIds,['vh-render-legacy']);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,1);
 f.sqlite.prepare("UPDATE factory_jobs SET status='done',worker_id='w',result_json=? WHERE id='vh-render-legacy'").run(JSON.stringify({results:[{fileName:'preview.mp4'}]}));
 const request=new Request(root+'/api/psychology-video-library/import',{method:'POST',body:JSON.stringify({jobId:'vh-render-legacy',resultIndex:0})}),imported=await (await handleVideoLibrary(request,f.env,new URL(request.url),{user:f.user()})).json();
 assert.equal(f.sqlite.prepare('SELECT source_id FROM psychology_video_hit_render_assets WHERE asset_id=?').get(imported.assetId).source_id,source);
 f.sqlite.prepare("UPDATE psychology_video_assets SET status='ready' WHERE id=?").run(imported.assetId);f.sqlite.prepare("DELETE FROM factory_jobs WHERE id='vh-render-legacy'").run();
 await assert.rejects(f.write('/'+source+'/versions/1/render',{revision:3},'POST'),/已归档/);
 const publish=new Request(root+'/api/psychology-video-publish',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),items:[{assetId:imported.assetId,connectionId:'a',caption:'Bypass',scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true}],tiktokOne:{connectionId:'brand',accountId:'123',campaignId:'456'}})});
 await assert.rejects(handleVideoLibrary(publish,f.env,new URL(publish.url),{user:f.user()}),/视频爆款成片/);assert.equal(f.requests.length,0);
});
