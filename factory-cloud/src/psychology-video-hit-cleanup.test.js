import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import worker from './index.js';
import {toPublicUser} from './auth.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {handleVideoHitCleanup,collectVideoHitAssets,VIDEO_HIT_GRACE_MS} from './psychology-video-hit-cleanup.js';
import {handleVideoHitAssets} from './psychology-video-hit-assets.js';
import {readyVideo} from './psychology-video-hit-videos.js';
import {handleVideoHitProduction} from './psychology-video-hit-production.js';
import {insertAutoJob} from './psychology-auto-publish.js';
import {claimTypeFilter} from './jobs.js';
const HOUR=3600000;
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits','psychology-publish','factory-api']));
 f.user=toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());f.deleted=[];f.failDelete=new Set();f.store=new Map();
 f.env.ARCHIVE={async delete(key){if(f.failDelete.has(key))throw Error('synthetic storage failure');f.deleted.push(key);f.store.delete(key);},async get(key){return f.store.has(key)?{body:f.store.get(key)}:null;},async put(key,bytes){f.store.set(key,bytes);},async head(key){return f.store.has(key)?{}:null;}};
 f.call=async(path='',method='GET',body)=>{const r=new Request('https://factory.test/api/psychology-video-hits'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),url=new URL(r.url);return await handleVideoHitCleanup(r,f.env,url,{user:f.user})||await handleVideoHitProduction(r,f.env,url,{user:f.user})||handleVideoHits(r,f.env,url,{user:f.user});};
 f.write=(path,body,method='PUT')=>f.call(path,method,{requestId:crypto.randomUUID(),...body});
 f.source=async()=> (await (await f.write('',{externalId:crypto.randomUUID(),videoUrl:'https://www.tiktok.com/@source/video/123',title:'Source',script:'Original copy'},'POST')).json()).id;
 f.version=async(id,n=1,{published=false,video=''}={})=>{await f.write('/'+id+'/versions/'+n,{revision:0,title:'Version '+n,script:'Recreated copy',caption:'Recreated caption',...(video?{inputMode:'video',videoAssetId:video}:{} )});if(published)f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id=?,publish_state='published',published_at=? WHERE source_id=? AND version=?").run('publish-'+id+'-'+n,Date.now()-25*HOUR,id,n);};
 f.image=(age=25*HOUR)=>{const id=crypto.randomUUID(),key='psychology-video-hits/admin/'+id+'/digest',at=Date.now()-age;f.sqlite.prepare('INSERT INTO psychology_video_hit_assets(id,owner_id,r2_key,content_type,size,digest,created_at,last_touched_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'admin',key,'image/png',3,'digest',at,at);f.store.set(key,new Uint8Array([1,2,3]));return {id,key};};
 f.video=(age=25*HOUR)=>{const id=crypto.randomUUID(),key='psychology-video-hit-videos/admin/'+id+'/digest',at=Date.now()-age;f.sqlite.prepare('INSERT INTO psychology_video_hit_videos(id,owner_id,digest,file_name,content_type,size,r2_key,created_at,last_touched_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'admin','digest-'+id,'video.mp4','video/mp4',3,key,at,at);f.sqlite.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,file_size,r2_key,status,created_at,updated_at) VALUES(?,'admin','video.mp4',3,?,'ready',?,?)").run(id,key,at,at);f.store.set(key,new Uint8Array([1,2,3]));return {id,key};};
 f.frame=(source,n,a,index=1)=>f.sqlite.prepare('INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,asset_id,text,duration_seconds) VALUES(?,?,?,?,?,3)').run(source,n,index,a.id,'Frame copy');
 f.job=async({id=crypto.randomUUID(),type='psychology-video-remix',status='queued',payload={},workerId='',at=Date.now()}={})=>{await insertAutoJob(f.db,{id,type,title:'Synthetic',createdBy:'admin',payload},at).run();f.sqlite.prepare('UPDATE factory_jobs SET status=?,worker_id=?,updated_at=? WHERE id=?').run(status,workerId,at,id);return id;};
 f.worker=(path,workerId='w',body={},token='test-worker')=>worker.fetch(new Request('https://factory.test/api/worker/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'x-factory-worker':workerId,'Content-Type':'application/json'},body:JSON.stringify(body)}),f.env,{});
 return f;
}
test('only official published confirmation starts grace; submitted/failed/unknown and pre-deadline files survive',async t=>{
 const f=await setup(t),id=await f.source();await f.version(id);const a=f.image();f.frame(id,1,a);
 f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='receipt-job' WHERE source_id=?").run(id);
 const record={autoTaskId:'receipt-job',status:'submitted',shareLink:'https://www.tiktok.com/@alpha/video/1'};
 f.sqlite.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES(?,?,?)').run('receipt',Date.now(),JSON.stringify(record));
 for(const status of ['submitted','failed','unknown']){f.sqlite.prepare('UPDATE factory_publish_records SET value_json=?').run(JSON.stringify({...record,officialRemoteStatus:status}));await collectVideoHitAssets(f.env);assert.equal(f.deleted.length,0);assert.equal(f.sqlite.prepare('SELECT published_at FROM psychology_video_hit_versions').get().published_at,0);}
 f.sqlite.prepare('UPDATE factory_publish_records SET value_json=?').run(JSON.stringify({...record,officialRemoteStatus:'published'}));
 const v=f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions').get();assert.ok(v.published_at>0);await collectVideoHitAssets(f.env,{now:v.published_at+VIDEO_HIT_GRACE_MS-1});assert.equal(f.deleted.length,0);
 await collectVideoHitAssets(f.env,{now:v.published_at+VIDEO_HIT_GRACE_MS});const cleaned=f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions').get();assert.ok(cleaned.cleaned_at);assert.equal(cleaned.script,'');assert.equal(cleaned.caption,'');assert.equal(cleaned.cleaned_frame_count,1);assert.equal(cleaned.publish_item_id,'receipt-job');assert.equal(cleaned.published_url,record.shareLink);assert.deepEqual(f.deleted,[a.key]);
 await assert.rejects(f.write('/'+id+'/versions/1',{revision:1,title:'Reset'}),/不能修改/);await assert.rejects(f.write('/'+id+'/versions/1/publish',{revision:1},'POST'),/已提交发布|停用/);assert.equal(f.requests.length,0);
});
test('shared originals, another draft and active frozen nested jobs protect image references',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});await f.version(source,2);const original=f.image(),shared=f.image(),own=f.image();f.frame(source,0,original);f.frame(source,1,original);f.frame(source,1,shared,2);f.frame(source,1,own,3);f.frame(source,2,shared);
 const job=await f.job({payload:{generation:{videoRemix:{sourceId:source,version:1,frames:[{assetId:own.id}]}}},status:'running',workerId:'w'});
 assert.equal((await collectVideoHitAssets(f.env)).versions,0);f.sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id=?").run(job);const stats=await collectVideoHitAssets(f.env);assert.equal(stats.versions,1);assert.deepEqual(f.deleted,[own.key]);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames').get().n,2);
});
test('root automation identity protects legacy queued publication without source fields',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const v=f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions').get();await f.job({type:'official-publish',payload:{psychologyAutomation:{id:v.publish_item_id}}});assert.equal((await collectVideoHitAssets(f.env)).versions,0);
});
test('orphan grace and recent failed-job grace hold; trigger updates/removes frozen refs',async t=>{
 const f=await setup(t),recent=f.image(23*HOUR),old=f.image(),failed=f.image();const job=await f.job({status:'failed',payload:{generation:{frames:[{assetId:failed.id}]}}});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_job_assets').get().n,1);await collectVideoHitAssets(f.env);assert.deepEqual(f.deleted,[old.key]);assert.ok(f.store.has(recent.key)&&f.store.has(failed.key));
 f.sqlite.prepare('UPDATE factory_jobs SET updated_at=? WHERE id=?').run(Date.now()-8*86400000,job);await collectVideoHitAssets(f.env);assert.deepEqual(f.deleted,[old.key,failed.key]);f.sqlite.prepare("UPDATE factory_jobs SET payload_json='{}' WHERE id=?").run(job);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_job_assets').get().n,0);
 const kept=f.image();await f.job({payload:{assetId:kept.id}});await collectVideoHitAssets(f.env);assert.ok(f.store.has(kept.key));f.sqlite.prepare('DELETE FROM factory_jobs').run();assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_job_assets').get().n,0);
});
test('R2 delete failures retry the same object and cannot accept a new frame binding once claimed',async t=>{
 const f=await setup(t),id=await f.source(),a=f.image();f.failDelete.add(a.key);let stats=await collectVideoHitAssets(f.env);assert.equal(stats.retryPending,1);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets').get().cleanup_state,'deleting');
 await assert.rejects(f.write('/'+id+'/frames/0',{revision:1,frames:[{index:1,assetId:a.id}]}),/已清理|正在清理/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames').get().n,0);
 f.failDelete.clear();stats=await collectVideoHitAssets(f.env);assert.equal(stats.files,1);const row=f.sqlite.prepare('SELECT * FROM psychology_video_hit_assets').get();assert.equal(row.cleanup_state,'deleted');assert.equal(row.r2_key,a.key);assert.equal(row.cleanup_error,'');await collectVideoHitAssets(f.env);assert.equal(f.deleted.length,1);
 const r=new Request('https://factory.test/api/psychology-video-hits/assets/'+a.id+'/file');await assert.rejects(handleVideoHitAssets(r,f.env,new URL(r.url),{user:f.user}),/已清理/);
});
test('a reference committed between scan and GC claim wins and protects its bytes',async t=>{
 const f=await setup(t),id=await f.source(),a=f.image(),before=f.db.prepare.bind(f.db);let injected=false;
 f.db.prepare=sql=>{const statement=before(sql);if(sql.startsWith('UPDATE psychology_video_hit_assets AS a SET cleanup_state'))return {...statement,async run(){if(!injected){injected=true;await f.write('/'+id+'/frames/0',{revision:1,frames:[{index:1,assetId:a.id}]});}return statement.run.call(this);}};return statement;};
 await collectVideoHitAssets(f.env);assert.equal(f.deleted.length,0);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets').get().cleanup_state,'active');
});
test('invalid R2 prefix is quarantined for retry and never deletes another module',async t=>{
 const f=await setup(t),unsafe=f.image(),safe=f.image();f.sqlite.prepare("UPDATE psychology_video_hit_assets SET r2_key='other-module/private' WHERE id=?").run(unsafe.id);const stats=await collectVideoHitAssets(f.env);assert.equal(stats.retryPending,1);assert.deepEqual(f.deleted,[safe.key]);assert.match(f.sqlite.prepare('SELECT cleanup_error FROM psychology_video_hit_assets WHERE id=?').get(unsafe.id).cleanup_error,/目录/);
});
test('ready videos shared with drafts survive; mirrored manifests retry and digest quota persists',async t=>{
 const f=await setup(t),source=await f.source(),a=f.video();await f.version(source,1,{published:true,video:a.id});await f.version(source,2,{video:a.id});f.sqlite.prepare('UPDATE psychology_video_hit_videos SET last_touched_at=?').run(Date.now()-25*HOUR);f.sqlite.prepare('INSERT INTO psychology_video_hit_video_usage VALUES(?,?,?,?)').run('admin','digest-'+a.id,a.id,'item');await collectVideoHitAssets(f.env);assert.equal(f.deleted.length,0);
 f.sqlite.prepare("UPDATE psychology_video_hit_versions SET video_asset_id='' WHERE version=2").run();f.failDelete.add(a.key);await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_assets').get().cleanup_state,'deleting');
 // Simulate a lost mirror write during a previous attempt.
 f.sqlite.prepare("UPDATE psychology_video_assets SET cleanup_state='active'").run();f.failDelete.clear();await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_assets').get().cleanup_state,'deleted');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_video_usage').get().n,1);await assert.rejects(readyVideo(f.db,f.user,a.id),/已清理/);
});
test('archive retains original copy and images permanently; restore is scoped, revision guarded and idempotent',async t=>{
 const f=await setup(t),source=await f.source(),other=await f.source(),a=f.image(),unique=f.image(),remix=f.image();await f.version(source,1,{published:true});await f.version(source,2);f.frame(source,0,a);f.frame(other,0,a);f.frame(source,0,unique,2);f.frame(source,1,remix);
 await assert.rejects(f.write('/'+source+'/archive',{revision:1},'POST'),/全部/);f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='second',publish_state='published',published_at=? WHERE source_id=? AND version=2").run(Date.now()-25*HOUR,source);
 const body={requestId:crypto.randomUUID(),revision:1};const response=await (await f.call('/'+source+'/archive','POST',body)).json();assert.deepEqual(await (await f.call('/'+source+'/archive','POST',body)).json(),response);
 await assert.rejects(f.write('/'+source+'/versions/3',{revision:0,title:'New'}),/来源已结束/);await assert.rejects(f.write('/'+source,{revision:2,title:'Change'},'PATCH'),/来源已结束/);await assert.rejects(f.write('/'+source+'/frames/0',{revision:2,frames:[{index:1,assetId:a.id}]}),/来源已结束/);
 assert.equal((await (await f.call('')).json()).items.some(s=>s.id===source),false);assert.equal((await (await f.call('?scope=archived')).json()).items[0].id,source);
 const stats=await collectVideoHitAssets(f.env,{now:response.archivedAt+365*24*HOUR});assert.equal(stats.sources,0);assert.equal(stats.versions,2);
 const original=f.sqlite.prepare('SELECT * FROM psychology_video_hits WHERE id=?').get(source);assert.equal(original.originals_cleaned_at,0);assert.equal(original.script,'Original copy');assert.equal(original.title,'Source');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames WHERE source_id=? AND version=0').get(source).n,2);assert.deepEqual(f.deleted,[remix.key]);assert.ok(f.store.has(a.key)&&f.store.has(unique.key));
 await assert.rejects(f.write('/'+source+'/restore',{revision:1},'POST'),/revision/);
 const restore={requestId:crypto.randomUUID(),revision:2};const restored=await(await f.call('/'+source+'/restore','POST',restore)).json();assert.equal(restored.archivedAt,0);assert.equal(restored.revision,3);assert.deepEqual(await(await f.call('/'+source+'/restore','POST',restore)).json(),restored);
 assert.ok((await(await f.call('')).json()).items.some(s=>s.id===source));await f.version(source,3);await assert.rejects(f.write('/'+source+'/versions/1',{revision:1,title:'Reuse'}),/不能修改/);
 f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other',archived_at=1 WHERE id=?").run(source);f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();await assert.rejects(f.write('/'+source+'/restore',{revision:3},'POST'),/无权/);assert.equal(f.requests.length,0);
});
test('local MP4 cleanup is queued once for its original worker, holds active transfers, verifies identity and retries failure',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const renderId=await f.job({id:'vh-render-synthetic',status:'running',workerId:'w',payload:{module:'psychology',videoRemix:{sourceId:source,version:1}}});
 f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({results:[{fileName:renderId+'.mp4'}]}),renderId);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_local_files').get().n,1);
 const transfer=await f.job({type:'psychology-video-archive',payload:{sourceJobId:renderId}});await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE type='psychology-video-cleanup'").get().n,0);f.sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id=?").run(transfer);
 await collectVideoHitAssets(f.env);await collectVideoHitAssets(f.env);const clean=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-video-cleanup'").get();assert.equal(JSON.parse(clean.payload_json).targetWorkerId,'w');assert.match(claimTypeFilter({}).sql,/psychology-video-cleanup/);assert.doesNotMatch(claimTypeFilter({psychologyVideoCleanup:true}).sql,/type<>'psychology-video-cleanup'/);
 assert.equal((await f.worker('claim','other',{workerId:'other',types:['psychology-video-cleanup'],psychologyVideoCleanup:true})).status,200);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(clean.id).status,'queued');
 await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});assert.equal((await f.worker('psychology-video-hits/cleanup/'+clean.id,'other')).status,403);assert.equal((await f.worker('psychology-video-hits/cleanup/'+clean.id,'w',{},'wrong')).status,401);
 assert.equal((await f.worker('jobs/'+clean.id+'/complete','w',{result:{cleaned:true}})).status,409);
 const manifest=await (await f.worker('psychology-video-hits/cleanup/'+clean.id)).json();assert.equal(manifest.fileName,renderId+'.mp4');
 await f.worker('jobs/'+clean.id+'/complete','w',{error:'synthetic failure'});f.sqlite.prepare('UPDATE factory_jobs SET updated_at=? WHERE id=?').run(Date.now()-6*60000,clean.id);await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(clean.id).status,'queued');await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});
 await f.worker('psychology-video-hits/cleanup/'+clean.id+'/done');await f.worker('psychology-video-hits/cleanup/'+clean.id+'/done');assert.equal((await f.worker('jobs/'+clean.id+'/complete','w',{result:{cleaned:true}})).status,200);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(clean.id).status,'done');assert.equal(f.requests.length,0);
});
test('cleanup status requires owner module permission; no absent storage deletes',async t=>{
 const f=await setup(t),response=await (await f.call('/cleanup')).json();assert.equal(response.policy.graceHours,24);assert.equal(response.policy.intervalMinutes,5);f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();await assert.rejects(f.call('/cleanup'),/权限/);delete f.env.ARCHIVE;assert.equal((await collectVideoHitAssets(f.env)).skipped,'storage-unavailable');
});

test('multiple removed images and videos keep distinct immutable keys and all reach deleted state',async t=>{
 const f=await setup(t),images=Array.from({length:3},()=>f.image()),videos=Array.from({length:3},()=>f.video());await collectVideoHitAssets(f.env);assert.equal(f.deleted.length,6);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_video_hit_assets WHERE cleanup_state='deleted'").get().n,3);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_video_hit_videos WHERE cleanup_state='deleted'").get().n,3);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_video_assets WHERE cleanup_state='deleted'").get().n,3);await collectVideoHitAssets(f.env);assert.equal(f.deleted.length,6);
});

test('generated video previews are deleted only through hit provenance, with active archive transfers retained',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const asset=crypto.randomUUID(),other=crypto.randomUUID(),key='psychology-videos/admin/'+asset;
 for(const id of [asset,other])f.sqlite.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,r2_key,status,created_at,updated_at) VALUES(?,'admin','render.mp4',?,'ready',0,0)").run(id,'psychology-videos/admin/'+id);
 f.sqlite.prepare('INSERT INTO psychology_video_hit_render_assets VALUES(?,?,?,?)').run(asset,source,1,'admin');f.store.set(key,new Uint8Array([1]));const job=await f.job({type:'psychology-video-archive',payload:{assetId:asset},status:'running'});await collectVideoHitAssets(f.env);assert.ok(f.store.has(key));f.sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id=?").run(job);await collectVideoHitAssets(f.env);assert.deepEqual(f.deleted,[key]);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_assets WHERE id=?').get(other).cleanup_state,'active');
});
test('failed provisional uploads become collectible; GC-fenced late uploads cannot revive deleted media',async t=>{
 const f=await setup(t),asset=crypto.randomUUID(),png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'));
 const upload=()=>{const r=new Request('https://factory.test/api/psychology-video-hits/assets/'+asset,{method:'PUT',headers:{'Content-Type':'image/png'},body:png});return handleVideoHitAssets(r,f.env,new URL(r.url),{user:f.user});};
 f.env.ARCHIVE.put=async()=>{throw Error('synthetic upload outage');};await assert.rejects(upload(),/outage/);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets WHERE id=?').get(asset).cleanup_state,'uploading');f.sqlite.prepare('UPDATE psychology_video_hit_assets SET last_touched_at=? WHERE id=?').run(Date.now()-25*HOUR,asset);await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets WHERE id=?').get(asset).cleanup_state,'deleted');await assert.rejects(upload(),/已清理/);
 const late=crypto.randomUUID(),r=new Request('https://factory.test/api/psychology-video-hits/assets/'+late,{method:'PUT',headers:{'Content-Type':'image/png'},body:png});f.env.ARCHIVE.put=async(key,bytes)=>{f.store.set(key,bytes);f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='deleting' WHERE id=?").run(late);};await assert.rejects(handleVideoHitAssets(r,f.env,new URL(r.url),{user:f.user}),/上传已过期/);assert.equal(f.store.size,0);
});

test('a provisional ready-upload collision never changes another shared library asset',async t=>{
 const f=await setup(t),a=f.video();f.sqlite.prepare("UPDATE psychology_video_assets SET owner='someone',r2_key='other-module/private' WHERE id=?").run(a.id);await collectVideoHitAssets(f.env);const other=f.sqlite.prepare('SELECT * FROM psychology_video_assets WHERE id=?').get(a.id);assert.equal(other.cleanup_state,'active');assert.equal(other.r2_key,'other-module/private');assert.deepEqual(f.deleted,[a.key]);
});

test('completed heavy render/publish snapshots are compacted while lightweight file and publication identity remain',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const a=f.image(),payload={videoRemix:{sourceId:source,version:1,script:'heavy',caption:'heavy',frames:[{assetId:a.id}]},publish:{videoDesc:'caption'}};
 const render=await f.job({status:'done',payload});const publish=await f.job({type:'official-publish',status:'done',payload:{generation:payload,videoHitOrigin:{sourceId:source,version:1},videos:[{fileName:render+'.mp4',narration:'heavy'}],generatedVideos:[{fileName:render+'.mp4',narration:'heavy'}],publish:{videoDesc:'caption'}}});await collectVideoHitAssets(f.env);
 for(const id of [render,publish]){const data=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(id).payload_json);assert.equal(data.videoRemix?.frames,undefined);assert.equal(data.generation?.videoRemix?.script,undefined);assert.equal(data.generation?.publish?.videoDesc,undefined);assert.equal(data.videos?.[0]?.narration,undefined);assert.equal(data.generatedVideos?.[0]?.narration,undefined);if(id===publish)assert.equal(data.videos[0].fileName,render+'.mp4');}assert.deepEqual(f.deleted,[a.key]);
});


test('persistent R2 failures cannot starve later eligible images or videos in bounded batches',async t=>{
 const f=await setup(t);
 for(const create of [f.image,f.video]){
  const stuck=[create(30*HOUR),create(30*HOUR)],later=create();for(const a of stuck)f.failDelete.add(a.key);
  await collectVideoHitAssets(f.env,{limit:2});await collectVideoHitAssets(f.env,{limit:2,now:Date.now()+1000});assert.ok(!f.store.has(later.key));
 }
});
test('stale local cleanup resumes only cleanup work; acknowledged work can finish after lost completion',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});
 const render=await f.job({id:'stale-render',status:'running',workerId:'w',payload:{videoRemix:{sourceId:source,version:1}}});
 f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({results:[{fileName:render+'.mp4'}]}),render);
 await collectVideoHitAssets(f.env);const clean='vh-cleanup-'+render;const unrelated=await f.job({status:'running',workerId:'w',at:Date.now()-HOUR});
 await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});
 await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(clean).status,'running');
 f.sqlite.prepare('UPDATE factory_jobs SET updated_at=? WHERE id=?').run(Date.now()-HOUR,clean);
 await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(clean).status,'queued');assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(unrelated).status,'running');
 await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});await f.worker('psychology-video-hits/cleanup/'+clean+'/done');
 f.sqlite.prepare('UPDATE factory_jobs SET updated_at=? WHERE id=?').run(Date.now()-HOUR,clean);
 await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(clean).status,'done');
});
test('generated inventory hides all cleaned revisions and direct compose-publish renders by immutable source identity',async t=>{
 const {handleVideoLibrary}=await import('./psychology-video-library.js'),f=await setup(t),source=await f.source();await f.version(source,1,{published:true});await f.version(source,2);
 for(const [id,version] of [['old-render',1],['direct-publish-render',1],['draft-render',2]]){await f.job({id,status:'done',workerId:'w',payload:{videoRemix:{sourceId:source,version}}});f.sqlite.prepare('UPDATE factory_jobs SET result_json=? WHERE id=?').run(JSON.stringify({results:[{fileName:id+'.mp4'}]}),id);}
 await collectVideoHitAssets(f.env);const r=new Request('https://factory.test/api/psychology-video-library?source=generated');const data=await (await handleVideoLibrary(r,f.env,new URL(r.url),{user:f.user})).json();assert.deepEqual(data.videos.map(v=>v.sourceJobId),['draft-render']);
});
test('image upload refuses storage write if GC wins the pre-upload claim',async t=>{
 const f=await setup(t),id=crypto.randomUUID(),before=f.db.prepare.bind(f.db);let writes=0;
 f.db.prepare=sql=>{const statement=before(sql);if(sql.startsWith('UPDATE psychology_video_hit_assets SET last_touched_at'))return {...statement,async run(){f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='deleted' WHERE id=?").run(id);return statement.run.call(this);}};return statement;};
 f.env.ARCHIVE.put=async()=>{writes++;};
 const r=new Request('https://factory.test/api/psychology-video-hits/assets/'+id,{method:'PUT',headers:{'Content-Type':'image/png'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64')});
 await assert.rejects(handleVideoHitAssets(r,f.env,new URL(r.url),{user:f.user}));assert.equal(writes,0);
});
test('a late uploaded object remains retryable when compensation delete fails after a prior deleted receipt',async t=>{
 const f=await setup(t),id=crypto.randomUUID();let key;
 f.env.ARCHIVE.put=async(k,bytes)=>{key=k;f.store.set(k,bytes);f.sqlite.prepare("UPDATE psychology_video_hit_assets SET cleanup_state='deleted',cleaned_at=? WHERE id=?").run(Date.now(),id);f.failDelete.add(k);};
 const r=new Request('https://factory.test/api/psychology-video-hits/assets/'+id,{method:'PUT',headers:{'Content-Type':'image/png'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64')});
 await assert.rejects(handleVideoHitAssets(r,f.env,new URL(r.url),{user:f.user}));assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets WHERE id=?').get(id).cleanup_state,'deleting');
 f.failDelete.clear();await collectVideoHitAssets(f.env);assert.ok(!f.store.has(key));
});
test('local output location survives completed render job pruning',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const id=await f.job({id:'located-render',status:'running',workerId:'w',payload:{videoRemix:{sourceId:source,version:1}}});
 const outputPath='D:/previous-outputs/'+id+'.mp4';f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({results:[{fileName:id+'.mp4',outputPath}]}),id);f.sqlite.prepare('DELETE FROM factory_jobs WHERE id=?').run(id);
 await collectVideoHitAssets(f.env);await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});const manifest=await (await f.worker('psychology-video-hits/cleanup/vh-cleanup-'+id)).json();assert.equal(manifest.outputPath,outputPath);
});


test('stale GC acknowledgment cannot close a newer compensation retry',async t=>{
 const {discardExpiredVideoHitUpload}=await import('./psychology-video-hit-cleanup.js'),f=await setup(t),a=f.image();let first=true;
 f.env.ARCHIVE.delete=async key=>{if(!first)throw Error('compensation unavailable');first=false;f.store.delete(key);f.store.set(key,new Uint8Array([9]));await discardExpiredVideoHitUpload(f.env,{kind:'image',id:a.id,key,ownerId:'admin'});};
 await collectVideoHitAssets(f.env);const row=f.sqlite.prepare('SELECT * FROM psychology_video_hit_assets WHERE id=?').get(a.id);assert.equal(row.cleanup_state,'deleting');assert.equal(row.cleaned_at,0);assert.ok(f.store.has(a.key));
 f.env.ARCHIVE.delete=async key=>f.store.delete(key);await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets WHERE id=?').get(a.id).cleanup_state,'deleted');assert.ok(!f.store.has(a.key));
});
test('ready video late compensation is durable, preserves mirror ownership and retries storage failure',async t=>{
 const {handleVideoHitVideos}=await import('./psychology-video-hit-videos.js'),f=await setup(t),id=crypto.randomUUID(),bytes=Buffer.alloc(16);bytes.write('ftyp',4);const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');let key;
 f.env.ARCHIVE.put=async(k,stream)=>{await new Response(stream).arrayBuffer();key=k;f.store.set(k,bytes);f.sqlite.prepare("UPDATE psychology_video_hit_videos SET cleanup_state='deleted',cleaned_at=? WHERE id=?").run(Date.now(),id);f.failDelete.add(k);};
 const r=new Request('https://factory.test/api/psychology-video-hits/videos/'+id,{method:'PUT',headers:{'Content-Type':'video/mp4','X-File-Name':'ready.mp4','X-File-Size':String(bytes.length),'X-Content-SHA256':digest},body:bytes});await assert.rejects(handleVideoHitVideos(r,f.env,new URL(r.url),{user:f.user}));assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_videos WHERE id=?').get(id).cleanup_state,'deleting');f.failDelete.clear();await collectVideoHitAssets(f.env);assert.ok(!f.store.has(key));
});
test('heartbeat renewed between stale scan and requeue wins; local failure is visible to its owner',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const id=await f.job({id:'renewed-render',status:'running',workerId:'w',payload:{videoRemix:{sourceId:source,version:1}}});f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({results:[{fileName:id+'.mp4'}]}),id);await collectVideoHitAssets(f.env);const cleanup='vh-cleanup-'+id;
 await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});f.sqlite.prepare('UPDATE factory_jobs SET updated_at=? WHERE id=?').run(Date.now()-HOUR,cleanup);
 const before=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.sqlite.prepare('UPDATE factory_jobs SET updated_at=? WHERE id=?').run(Date.now(),cleanup);return before(statements);};await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(cleanup).status,'running');
 await f.worker('jobs/'+cleanup+'/complete','w',{error:'Original output disk unavailable'});const status=await (await f.call('/cleanup')).json();assert.ok(status.errors.some(e=>e.kind==='local'&&e.id===id&&e.error.includes('disk')));assert.equal(status.policy.localStaleMinutes,15);
});


test('legacy local path registration is original-worker scoped and immutable before deletion',async t=>{
 const f=await setup(t),source=await f.source();await f.version(source,1,{published:true});const id=await f.job({id:'legacy-render',status:'running',workerId:'w',payload:{videoRemix:{sourceId:source,version:1}}});f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({results:[{fileName:id+'.mp4'}]}),id);await collectVideoHitAssets(f.env);const endpoint='psychology-video-hits/cleanup/vh-cleanup-'+id;await f.worker('claim','w',{workerId:'w',types:['psychology-video-cleanup'],psychologyVideoCleanup:true});
 const outputPath='D:/original/'+id+'.mp4';assert.equal((await f.worker(endpoint,'other',{outputPath})).status,403);assert.equal((await f.worker(endpoint,'w',{outputPath:'D:/original/../'+id+'.mp4'})).status,400);assert.equal((await f.worker(endpoint,'w',{outputPath:'D:/original/other.mp4'})).status,400);
 assert.equal((await (await f.worker(endpoint,'w',{outputPath})).json()).outputPath,outputPath);assert.equal((await f.worker(endpoint,'w',{outputPath:'D:/changed/'+id+'.mp4'})).status,409);assert.equal((await (await f.worker(endpoint,'w')).json()).outputPath,outputPath);
});

test('twenty uncleared slots are atomic; publication alone keeps the slot, cleanup releases it without recycling identity',async t=>{
 const f=await setup(t),source=await f.source();for(let n=1;n<=20;n++)await f.version(source,n);
 await assert.rejects(f.write('/'+source+'/versions/21',{revision:0,title:'Full'}),/20个未清理/);
 await f.write('/'+source+'/versions/20',{revision:1,title:'Draft remains editable'});
 f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='once',publish_state='published',published_at=? WHERE source_id=? AND version=1").run(Date.now(),source);
 await assert.rejects(f.write('/'+source+'/versions/21',{revision:0,title:'Grace'}),/20个未清理/);
 f.sqlite.prepare('UPDATE psychology_video_hit_versions SET published_at=? WHERE source_id=? AND version=1').run(Date.now()-25*HOUR,source);assert.equal((await collectVideoHitAssets(f.env)).versions,1);
 let d=await(await f.call('/'+source)).json();assert.equal(d.nextVersion,21);assert.equal(d.activeVersionCount,19);assert.equal(d.versions.length,20);
 await f.version(source,21);await assert.rejects(f.write('/'+source+'/versions/1',{revision:1,title:'Reuse'}),/不能修改/);
 const a=f.image();await f.write('/'+source+'/frames/21',{revision:1,frames:[{index:1,assetId:a.id}]});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames WHERE version=21').get().n,1);
 assert.throws(()=>f.sqlite.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,created_at,updated_at) VALUES(?,22,'Race','Race',0,0)").run(source),/video_hit_active_limit/);
 d=await(await f.call('')).json();assert.equal(d.items[0].versionCount,21);assert.equal(d.items[0].activeVersionCount,20);assert.equal(d.items[0].cleanedVersionCount,1);assert.equal(f.requests.length,0);
});

test('manual delete removes unpublished imports and exclusive files without releasing published or shared material',async t=>{
 const f=await setup(t),source=await f.source(),other=await f.source();
 await f.version(source,1);await f.version(source,2);await f.version(other,1);
 const shared=f.image(),own=f.image(),original=f.image(),kept=f.image();
 f.frame(source,0,original);f.frame(source,1,shared);f.frame(source,1,own,2);f.frame(other,1,shared);f.frame(other,0,kept);
 const video=f.video();await f.version(source,3,{video:video.id});
 f.sqlite.prepare('INSERT INTO psychology_imported_photo_skips(owner,source_id,version,revision,retry_at,reason) VALUES(?,?,?,?,?,?)').run('admin',source,1,1,Date.now(),'test');
 const preview=crypto.randomUUID(),previewKey='psychology-videos/admin/'+preview+'/preview';
 f.sqlite.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,content_type,file_size,r2_key,status,created_at,updated_at) VALUES(?,'admin','preview.mp4','video/mp4',3,?,'ready',?,?)").run(preview,previewKey,Date.now(),Date.now());
 f.sqlite.prepare('INSERT INTO psychology_video_hit_render_assets(asset_id,source_id,version,owner_id) VALUES(?,?,1,?)').run(preview,source,'admin');f.store.set(previewKey,new Uint8Array([1]));
 const versionBody={requestId:crypto.randomUUID(),revision:1},removed=await(await f.call('/'+source+'/versions/1/delete','POST',versionBody)).json();
 assert.equal(removed.deleted,true);assert.equal(removed.version,1);assert.deepEqual(await(await f.call('/'+source+'/versions/1/delete','POST',versionBody)).json(),removed);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_versions WHERE source_id=? AND version=1').get(source).n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames WHERE source_id=? AND version=0').get(source).n,1);
 assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets WHERE id=?').get(own.id).cleanup_state,'deleting');
 assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_assets WHERE id=?').get(shared.id).cleanup_state,'active');
 assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_assets WHERE id=?').get(preview).cleanup_state,'deleting');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_render_assets WHERE asset_id=?').get(preview).n,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_imported_photo_skips WHERE source_id=?').get(source).n,0);
 f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='kept',publish_state='published',published_at=? WHERE source_id=? AND version=2").run(Date.now(),source);
 await assert.rejects(f.write('/'+source+'/delete',{revision:1},'POST'),/不能整条删除/);
 assert.equal(f.sqlite.prepare('SELECT id FROM psychology_video_hits WHERE id=?').get(source).id,source);
 const busy=await f.source();await f.version(busy,1);f.sqlite.prepare("UPDATE psychology_video_hit_versions SET render_state='running' WHERE source_id=?").run(busy);
 await assert.rejects(f.write('/'+busy+'/versions/1/delete',{revision:1},'POST'),/不能删除/);
 const used=await f.source(),clip=f.video();await f.version(used,1,{video:clip.id});
 f.sqlite.prepare('INSERT INTO psychology_video_hit_video_usage VALUES(?,?,?,?)').run('admin','digest-'+clip.id,clip.id,'item');
 await assert.rejects(f.write('/'+used+'/delete',{revision:1},'POST'),/不能整条删除/);
 const fresh=await(await f.write('',{externalId:'import-again',importSource:'gpt-dot',videoUrl:'https://www.tiktok.com/@source/video/123',title:'Imported'},'POST')).json();
 const clip2=f.video();await f.version(fresh.id,1,{video:clip2.id});
 const body={requestId:crypto.randomUUID(),revision:1};assert.equal((await(await f.call('/'+fresh.id+'/delete','POST',body)).json()).deleted,true);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hits WHERE id=?').get(fresh.id).n,0);
 assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_videos WHERE id=?').get(clip2.id).cleanup_state,'deleting');
 assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_assets WHERE id=?').get(clip2.id).cleanup_state,'deleting');
 const again=await(await f.write('',{externalId:'import-again',importSource:'gpt-dot',videoUrl:'https://www.tiktok.com/@source/video/123',title:'Imported again'},'POST')).json();
 assert.notEqual(again.id,fresh.id);
 await collectVideoHitAssets(f.env);
 assert.ok(f.deleted.includes(own.key)&&f.deleted.includes(previewKey)&&f.deleted.includes(clip2.key));
 assert.ok(f.store.has(shared.key)&&f.store.has(original.key)&&f.store.has(kept.key)&&f.store.has(video.key));
 f.sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES('member','member','operator','','','[\"psychology-video-hits\"]',0,0)").run();
 const member=toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='member'").get()),adminSource=await f.source(),memberSource=await f.source();
 f.sqlite.prepare('UPDATE psychology_video_hits SET owner_id=? WHERE id=?').run('member',memberSource);
 const previous=f.user;f.user=member;await assert.rejects(f.call('/'+adminSource+'/delete','POST',{requestId:crypto.randomUUID(),revision:1}),/无权/);
 assert.equal((await(await f.call('/'+memberSource+'/delete','POST',{requestId:crypto.randomUUID(),revision:1})).json()).deleted,true);f.user=previous;
 const another=await f.source();f.sqlite.prepare('UPDATE psychology_video_hits SET owner_id=? WHERE id=?').run('member',another);
 assert.equal((await(await f.call('/'+another+'/delete','POST',{requestId:crypto.randomUUID(),revision:1})).json()).deleted,true);
 assert.equal(f.requests.length,0);
});

test('database slot trigger fences a concurrent writer after the API capacity read',async t=>{
 const f=await setup(t),source=await f.source();for(let n=1;n<=19;n++)await f.version(source,n);
 const batch=f.db.batch.bind(f.db);let injected=false;f.db.batch=async rows=>{if(!injected){injected=true;f.sqlite.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,created_at,updated_at) VALUES(?,20,'Concurrent','Concurrent',0,0)").run(source);}return batch(rows);};
 await assert.rejects(f.write('/'+source+'/versions/21',{revision:0,title:'Racing'}),e=>e.statusCode===409&&/20个未清理/.test(e.message));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_versions').get().n,20);assert.equal(f.sqlite.prepare('SELECT version FROM psychology_video_hit_versions WHERE version=21').get(),undefined);assert.equal(f.requests.length,0);
});

test('continuous-version migration preserves populated rows, indexes, receipt/render triggers and foreign keys',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),fs=await import('node:fs'),db=new DatabaseSync(':memory:');
 try{
 const dir=new URL('../migrations/',import.meta.url);db.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0085').sort())db.exec(fs.readFileSync(new URL(name,dir),'utf8'));
 db.prepare("INSERT INTO psychology_video_hits(id,owner_id,external_id,video_url,title,caption,script,created_at,updated_at) VALUES('source','admin','source','https://example.test','Original','Original caption','Original script',1,2)").run();
 db.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,caption,script,enabled,revision,created_at,updated_at,input_mode,video_asset_id,render_job_id,render_revision,render_source_revision,publish_item_id,render_state,publish_state,published_url,published_at,cleaned_at,cleaned_frame_count) VALUES('source',1,'Version','Title','Caption','Script',1,8,100,200,'video','asset','render',6,7,'receipt','running','published','https://example.test/published',10,20,3)").run();
 db.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,publish_item_id,render_job_id,created_at,updated_at) VALUES('source',2,'Draft','Draft','next-receipt','next-render',3,4)").run();
 for(const n of [0,2])db.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,asset_id,text,duration_seconds) VALUES('source',?,1,'image','Frame',3.5)").run(n);
 const tables=['psychology_video_hits','psychology_video_hit_versions','psychology_video_hit_frames'],before=tables.map(n=>db.prepare('SELECT * FROM '+n).all());
 db.exec('BEGIN');db.exec(fs.readFileSync(new URL('0085_psychology_video_hit_continuous.sql',dir),'utf8'));db.exec('COMMIT');assert.deepEqual(tables.map(n=>db.prepare('SELECT * FROM '+n).all()),before);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 db.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES(?,?,?)').run('first',1,JSON.stringify({autoTaskId:'next-receipt',officialRemoteStatus:'submitted'}));assert.equal(db.prepare("SELECT publish_state FROM psychology_video_hit_versions WHERE version=2").get().publish_state,'');
 db.prepare('UPDATE factory_publish_records SET value_json=? WHERE id=?').run(JSON.stringify({autoTaskId:'next-receipt',officialRemoteStatus:'published',shareLink:'https://example.test/new'}),'first');const published=db.prepare('SELECT * FROM psychology_video_hit_versions WHERE version=2').get();assert.equal(published.publish_state,'published');assert.equal(published.published_url,'https://example.test/new');assert.ok(published.published_at>0);
 db.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,created_at,updated_at) VALUES('next-render','psychology-video-remix','queued','Test','admin',0,0)").run();db.prepare("UPDATE factory_jobs SET status='done' WHERE id='next-render'").run();assert.equal(db.prepare('SELECT render_state FROM psychology_video_hit_versions WHERE version=2').get().render_state,'done');
 db.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,created_at,updated_at) VALUES('source',21,'Continued','Continued',0,0)").run();db.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,text,duration_seconds) VALUES('source',21,1,'New frame',3)").run();assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const indexes=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='psychology_video_hit_versions'").all().map(x=>x.name);for(const name of ['psychology_video_hit_versions_cleanup','psychology_video_hit_versions_publish_item','psychology_video_hit_versions_active'])assert.ok(indexes.includes(name));
 }finally{db.close();}
});
