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
import {canAccessPath} from './sidebar.js';
const root='https://factory.test';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'));
async function setup(t){
 const f=await fixture(t),files=new Map();
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits','psychology-publish','factory-api']));
 f.user=()=>toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 f.env.ARCHIVE={async put(k,b){files.set(k,new Uint8Array(b));},async get(k){return files.has(k)?{body:files.get(k)}:null;},async delete(k){files.delete(k);},async head(k){return files.has(k)?{}:null;}};
 f.call=async(path='',method='GET',body,user=f.user())=>{
  const r=new Request(root+'/api/psychology-video-hits'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),url=new URL(r.url),session={user};
  return await handleVideoHitAssets(r,f.env,url,session)||await handleVideoHitProduction(r,f.env,url,session)||handleVideoHits(r,f.env,url,session);
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
 await assert.rejects(f.write('/'+id+'/versions/1/publish',body,'POST'),/数据已变化/);
 await assert.rejects(f.write('/'+id+'/versions/1/publish',{...body,connectionIds:['outside']},'POST'),/分配分组/);
 await assert.rejects(f.write('/'+id+'/versions/1/publish',{...body,scheduleAt:1},'POST'),/30分钟/);
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
