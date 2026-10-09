import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,input as autoInput} from './psychology-cloud-test-fixture.js';
import {toPublicUser} from './auth.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {handleVideoHitAssets,handleVideoHitWorkerAsset} from './psychology-video-hit-assets.js';
import {handleVideoHitVideos} from './psychology-video-hit-videos.js';
import {handleVideoHitProduction} from './psychology-video-hit-production.js';
import {handleVideoHitCleanup} from './psychology-video-hit-cleanup.js';
import {handleVideoLibrary,handleVideoTransfer} from './psychology-video-library.js';
import {loadHitPhotoImage} from './psychology-video-hit-photos.js';
import {assertAutoJobAccess} from './psychology-auto-publish.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const movie=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
async function setup(t){
 const f=await fixture(t),files=new Map(),grants=['psychology-video-hits','psychology-publish'];
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(grants));
 for(const name of ['bot1','bot2'])f.sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES(?,?,'operator','','',?,0,0)").run(name,name,JSON.stringify(['psychology-video-hits']));
 const actor=name=>toPublicUser(f.sqlite.prepare('SELECT * FROM factory_users WHERE id=?').get(name));
 f.env.ARCHIVE={async put(k,b){files.set(k,Buffer.from(await new Response(b).arrayBuffer()));},async get(k){return files.has(k)?{body:files.get(k),size:files.get(k).length}:null;},async head(k){return files.has(k)?{size:files.get(k).length}:null;},async delete(k){files.delete(k);}};
 f.env.PHOTO_BROWSER={};f.env.PHOTO_QUEUE={async send(){}};
 const raw=async(path,method='GET',body,name='admin',headers={})=>{const r=new Request('https://factory.test'+path,{method,headers,...(body!==undefined?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})}),url=new URL(r.url),session={user:actor(name)};
 return await handleVideoHitAssets(r,f.env,url,session)||await handleVideoHitVideos(r,f.env,url,session)||await handleVideoHitProduction(r,f.env,url,session)||await handleVideoHitCleanup(r,f.env,url,session)||await handleVideoHits(r,f.env,url,session)||await handleVideoLibrary(r,f.env,url,session);};
 const call=(path='',method='GET',body,name='admin')=>raw('/api/psychology-video-hits'+path,method,body,name,{'Content-Type':'application/json'});
 const write=(path,body,name='admin',method='PUT')=>call(path,method,{requestId:crypto.randomUUID(),...body},name);
 const upload=async(name='bot1')=>{const id=crypto.randomUUID();await raw('/api/psychology-video-hits/assets/'+id,'PUT',png,name,{'Content-Type':'image/png'});return id;};
 const source=async(name='bot1')=>(await(await write('',{externalId:crypto.randomUUID(),title:'Original '+name,caption:'Original caption',videoUrl:'https://www.tiktok.com/@source/video/123',importSource:'gpt-dot'},name,'POST')).json()).id;
 const ready=async()=>{const id=await source(),assetId=await upload();await write('/'+id+'/frames/0',{revision:1,frames:[{index:1,assetId,text:'Original copy'}]},'bot1');await write('/'+id+'/versions/1',{revision:0,title:'Recreation',caption:'Saved caption',script:'A complete narration'},'bot1');await write('/'+id+'/frames/1',{revision:1,frames:[{index:1,assetId,text:'Recreated copy'}]},'bot1');await write('/'+id+'/versions/1',{revision:2,enabled:true});return {sourceId:id,version:1,revision:3,assetId};};
 return {...f,callAuto:f.call,files,actor,raw,call,write,upload,source,ready};
}
test('administrator manages all member sources while owners, receipts and member isolation persist',async t=>{
 const f=await setup(t),one=await f.source(),two=await f.source('bot2');
 assert.equal((await(await f.call()).json()).total,2);assert.equal((await(await f.call('','GET',undefined,'bot1')).json()).total,1);
 let data=await(await f.call('/'+one)).json();assert.equal(data.source.ownerUsername,'bot1');assert.equal(data.source.importSource,'gpt-dot');
 await f.write('/'+one,{revision:1,title:'Admin edited'},'admin','PATCH');data=await(await f.call('/'+one,'GET',undefined,'bot1')).json();assert.equal(data.source.title,'Admin edited');assert.equal(data.source.ownerId,'bot1');
 await assert.rejects(f.call('/'+one,'GET',undefined,'bot2'),/无权/);await assert.rejects(f.write('/'+two,{revision:1,title:'Attempt'},'bot1','PATCH'),/无权/);
 const image=await f.upload('admin');await f.write('/'+one+'/frames/0',{revision:2,frames:[{index:1,assetId:image,text:'Paired copy'}]});assert.equal((await f.call('/assets/'+image+'/file','GET',undefined,'bot1')).status,200);await assert.rejects(f.call('/assets/'+image+'/file','GET',undefined,'bot2'),/无权/);
 await f.write('/'+one+'/versions/1',{revision:0,title:'Done'});f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_state='published',published_at=1 WHERE source_id=?").run(one);
 await f.write('/'+one+'/archive',{revision:3},'admin','POST');await f.write('/'+one+'/restore',{revision:4},'admin','POST');assert.equal((await(await f.call('/'+one)).json()).source.ownerId,'bot1');
 assert.equal((await(await f.call('/cleanup')).json()).images[0].count,1);
 f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();await assert.rejects(f.call('/'+one),/无权/);assert.equal((await(await f.call()).json()).total,0);
 f.sqlite.prepare("UPDATE factory_users SET role='admin',sidebar_modules_json='[]' WHERE id='admin'").run();await assert.rejects(f.call(),/权限/);
});
test('admin photo publishing uses admin account authorization and reads member images; demotion stops queued access',async t=>{
 const f=await setup(t),ref=await f.ready(),config=autoInput({mediaType:'photo',template:'selected-photo',sourceType:'video-hits',photoVersions:[ref],count:1,connectionIds:['a'],isAiGenerated:false});
 const inventory=await(await f.call('/photo-library')).json();assert.equal(inventory.total,1);assert.equal(inventory.items[0].eligible,true);
 await assert.rejects(f.call('/'+ref.sourceId+'/versions/1/publish','POST',{requestId:crypto.randomUUID(),revision:3,connectionIds:['outside'],scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:false}),/分配分组/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
 assert.equal((await f.callAuto('POST',config)).status,202);
 const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE json_extract(payload_json,'$.hitPhoto')=1").get();assert.equal(job.created_by,'admin');assert.equal((await loadHitPhotoImage(f.env,job,0)).status,200);assert.equal(f.sqlite.prepare('SELECT owner_id FROM psychology_video_hit_assets WHERE id=?').get(ref.assetId).owner_id,'bot1');
 await assertAutoJobAccess(f.env,job);f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();await assert.rejects(assertAutoJobAccess(f.env,job),/无权/);await assert.rejects(loadHitPhotoImage(f.env,job,0),/无权/);assert.equal(f.requests.length,0);
});
test('administrator renders member images and reuses the same render; worker reads stay frozen and role checked',async t=>{
 const f=await setup(t),ref=await f.ready();const render=await(await f.write('/'+ref.sourceId+'/versions/1/render',{revision:3},'admin','POST')).json(),jobId=render.jobIds[0];
 assert.equal(f.sqlite.prepare('SELECT created_by FROM factory_jobs WHERE id=?').get(jobId).created_by,'admin');assert.equal((await(await f.write('/'+ref.sourceId+'/versions/1/render',{revision:3},'admin','POST')).json()).jobIds[0],jobId);
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(jobId);
 const read=async asset=>{const r=new Request('https://factory.test/api/worker/psychology-video-hits/'+jobId+'/assets/'+asset,{headers:{'x-factory-worker':'w'}});return handleVideoHitWorkerAsset(r,f.env,new URL(r.url));};
 assert.equal((await read(ref.assetId)).status,200);await assert.rejects(read(await f.upload('bot2')),/不属于当前任务/);
 const jobs=await(await f.call('/'+ref.sourceId+'/versions/1/jobs','GET',undefined,'bot1')).json();assert.equal(jobs.jobs[0].id,jobId);
 f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();await assert.rejects(read(ref.assetId),/无权/);
});
test('admin selects member ready videos; reservation uses asset owner and transfer uses admin publishing scope',async t=>{
 const f=await setup(t),sourceId=await f.source(),assetId=crypto.randomUUID();
 await f.raw('/api/psychology-video-hits/videos/'+assetId,'PUT',movie,'bot1',{'Content-Type':'video/mp4','X-File-Name':'sample.mp4','X-File-Size':String(movie.length),'X-Content-SHA256':createHash('sha256').update(movie).digest('hex')});
 await f.write('/'+sourceId+'/versions/1',{revision:0,title:'Ready',caption:'Saved caption',inputMode:'video',videoAssetId:assetId,enabled:true},'bot1');
 const list=await(await f.raw('/api/psychology-video-library?source=video-hits')).json();assert.equal(list.videos.length,1);assert.equal((await f.raw(list.videos[0].previewUrl)).status,200);
 const config=autoInput({sourceType:'video-hits',template:'selected-video',count:1,connectionIds:['a'],isAiGenerated:false});assert.equal((await f.callAuto('POST',config)).status,202);
 const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-selected-video'").get();assert.equal(job.created_by,'admin');assert.equal(f.sqlite.prepare('SELECT owner_id FROM psychology_video_hit_video_usage').get().owner_id,'bot1');assert.equal(f.sqlite.prepare('SELECT owner FROM psychology_video_assets WHERE id=?').get(assetId).owner,'bot1');
 const again=await f.source();await f.write('/'+again+'/versions/1',{revision:0,title:'Same file',inputMode:'video',videoAssetId:assetId,enabled:true},'bot1');assert.equal((await(await f.raw('/api/psychology-video-library?source=video-hits')).json()).videos.length,0,'digest cannot be reused by changing publisher or source');
 const prior=globalThis.fetch;let uploads=0;t.mock.method(globalThis,'fetch',async(url,init)=>{if(String(url).endsWith('/api/v1/publish/assets')){uploads++;return Response.json({assetKey:'temporary--'+crypto.randomUUID()+'.mp4'});}return prior(url,init);});
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(job.id);const r=new Request('https://factory.test/api/worker/psychology-video-transfer/'+job.id,{method:'POST',headers:{'x-factory-worker':'w'}});assert.equal((await handleVideoTransfer(r,f.env,new URL(r.url))).status,200);assert.equal(uploads,1);assert.equal(f.requests.length,1);
});

for(const mode of ['one-selection','version-publish'])test('member video can be published by admin through '+mode+' with stable replay',async t=>{
 const f=await setup(t),id=await f.source(),assetId=crypto.randomUUID();await f.raw('/api/psychology-video-hits/videos/'+assetId,'PUT',movie,'bot1',{'Content-Type':'video/mp4','X-File-Name':'sample.mp4','X-File-Size':String(movie.length),'X-Content-SHA256':createHash('sha256').update(movie).digest('hex')});
 await f.write('/'+id+'/versions/1',{revision:0,title:'Ready',caption:'Caption',inputMode:'video',videoAssetId:assetId,enabled:true},'bot1');
 f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:a',JSON.stringify({followers:1000}),Date.now());
 const prior=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,init)=>String(url).includes('/api/v1/tiktok-one')?Response.json({joined:true}):prior(url,init));
 const requestId=crypto.randomUUID(),scheduleAt=Math.floor(Date.now()/1000)+7200,project={connectionId:'brand',accountId:'1',campaignId:'7693454687705595917'};
 const submit=mode==='one-selection'?()=>f.raw('/api/psychology-video-publish','POST',{requestId,tiktokOne:project,items:[{assetId,videoHit:{sourceId:id,version:1,revision:1},connectionId:'a',caption:'Reviewed',scheduleAt,isAiGenerated:false}]}):()=>f.call('/'+id+'/versions/1/publish','POST',{requestId,revision:1,connectionIds:['a'],scheduleAt,isAiGenerated:false});
 assert.ok([200,202].includes((await submit()).status));await submit();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,1);assert.equal(f.sqlite.prepare('SELECT created_by FROM psychology_publish_batches').get().created_by,'admin');assert.equal(f.sqlite.prepare('SELECT owner_id FROM psychology_video_hit_video_usage').get().owner_id,'bot1');assert.equal(f.requests.length,0);
});
