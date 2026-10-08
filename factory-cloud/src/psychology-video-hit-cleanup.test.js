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
test('archive requires every created version published, freezes writers and cleans only unshared originals after grace',async t=>{
 const f=await setup(t),source=await f.source(),other=await f.source(),a=f.image();await f.version(source,1,{published:true});await f.version(source,2);f.frame(source,0,a);f.frame(other,0,a);
 await assert.rejects(f.write('/'+source+'/archive',{revision:1},'POST'),/全部/);f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='second',publish_state='published',published_at=? WHERE source_id=? AND version=2").run(Date.now()-25*HOUR,source);
 const uuid=crypto.randomUUID(),body={requestId:uuid,revision:1};const response=await (await f.call('/'+source+'/archive','POST',body)).json();assert.deepEqual(await (await f.call('/'+source+'/archive','POST',body)).json(),response);
 await assert.rejects(f.write('/'+source+'/versions/3',{revision:0,title:'New'}),/来源已结束/);await assert.rejects(f.write('/'+source,{revision:2,title:'Change'},'PATCH'),/来源已结束/);await assert.rejects(f.write('/'+source+'/frames/0',{revision:2,frames:[{index:1,assetId:a.id}]}),/来源已结束/);
 assert.equal((await (await f.call('')).json()).items.some(s=>s.id===source),false);assert.equal((await (await f.call('?scope=archived')).json()).items[0].id,source);
 await collectVideoHitAssets(f.env,{now:response.archivedAt+VIDEO_HIT_GRACE_MS-1});assert.equal(f.sqlite.prepare('SELECT originals_cleaned_at FROM psychology_video_hits WHERE id=?').get(source).originals_cleaned_at,0);
 await collectVideoHitAssets(f.env,{now:response.archivedAt+VIDEO_HIT_GRACE_MS});assert.ok(f.sqlite.prepare('SELECT originals_cleaned_at FROM psychology_video_hits WHERE id=?').get(source).originals_cleaned_at);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames WHERE source_id=?').get(source).n,0);assert.equal(f.deleted.length,0);assert.equal(f.requests.length,0);
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
