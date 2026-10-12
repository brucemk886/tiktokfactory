import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {handleVideoHitCleanup} from './psychology-video-hit-cleanup.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {handleVideoHitReady} from './psychology-video-hit-ready.js';
import {collectVideoHitAssets,handleVideoHitWorkerCleanup} from './psychology-video-hit-cleanup.js';
import {resolveHitVideo} from './psychology-video-hit-publishing.js';
import {insertAutoJob} from './psychology-auto-publish.js';
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json=?").run(JSON.stringify(['psychology-video-hits','psychology-publish']));
 f.env.PHOTO_BROWSER={};f.env.PHOTO_QUEUE={async send(){}};const actor={id:'admin',username:'admin'},deleted=[];f.env.ARCHIVE={head:async()=>({}),delete:async key=>deleted.push(key)};
 const add=(mode='frames',sourceId='vh-'+crypto.randomUUID().replaceAll('-',''),version=1)=>{
  const at=Date.now()-2*86400000;
  f.sqlite.prepare("INSERT OR IGNORE INTO psychology_video_hits(id,owner_id,external_id,video_url,title,created_at,updated_at) VALUES(?,'admin',?,'https://example.com/video','Original',?,?)").run(sourceId,sourceId,at,at);
  f.sqlite.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,caption,script,enabled,input_mode,created_at,updated_at) VALUES(?,?,'Version','Recreated title','Caption','Script',1,?,?,?)").run(sourceId,version,mode,at,at);
  if(mode==='frames')f.sqlite.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,image_url,text,duration_seconds) VALUES(?,?,1,'https://example.com/image.png','Copy',3)").run(sourceId,version);
  else {const id=crypto.randomUUID(),key='psychology-video-hit-videos/admin/'+id+'/digest';f.sqlite.prepare("INSERT INTO psychology_video_hit_videos(id,owner_id,digest,file_name,content_type,size,r2_key,created_at,last_touched_at) VALUES(?,'admin',?,'clip.mp4','video/mp4',3,?,?,?)").run(id,id,key,at,at);f.sqlite.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,r2_key,status,created_at,updated_at) VALUES(?,'admin','clip.mp4',?,'ready',?,?)").run(id,key,at,at);f.sqlite.prepare('UPDATE psychology_video_hit_versions SET video_asset_id=? WHERE source_id=? AND version=?').run(id,sourceId,version);}
  return {sourceId,version,revision:1};
 };
 const remove=async(items,extra={},headers={},method='POST')=>{const body={requestId:crypto.randomUUID(),items,...extra},url=new URL('https://factory.test/api/psychology-video-hits/versions/delete'),r=new Request(url,{method,headers:{'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});return handleVideoHitCleanup(r,f.env,url,{user:actor});};
 const read=async(path)=>{const url=new URL('https://factory.test/api/psychology-video-hits'+path),r=new Request(url);return (await (handleVideoHitReady(r,f.env,url,{user:actor}).then(x=>x||handleVideoHits(r,f.env,url,{user:actor})))).json();};
 const write=async(path,body)=>{const url=new URL('https://factory.test/api/psychology-video-hits'+path),r=new Request(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...body})});return handleVideoHits(r,f.env,url,{user:actor});};
 const row=r=>f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions WHERE source_id=? AND version=?').get(r.sourceId,r.version);
 return {...f,actor,add,remove,read,write,row,deleted};
}
test('batch deletion removes selected recreations, preserves originals and refreshes IDs, totals and search',async t=>{
 const f=await setup(t),a=f.add(),b=f.add('video',a.sourceId,2),keep=f.add();
 f.sqlite.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,image_url,text,duration_seconds) VALUES(?,0,1,'https://example.com/original.png','Original copy',3)").run(a.sourceId);
 const materialId=b.sourceId+':v2';assert.equal((await f.read('/ready?q='+materialId)).total,1);assert.equal((await f.read('/ready?q='+materialId)).items[0].materialId,materialId);
 const result=await(await f.remove([a,b])).json();assert.equal(result.deleted,2);assert.equal(f.row(a),undefined);assert.equal(f.row(b),undefined);assert.ok(f.row(keep));assert.equal((await f.read('/ready')).total,1);
 const detail=await f.read('/'+a.sourceId);assert.equal(detail.source.title,'Original');assert.equal(detail.frameCount,1);assert.equal(detail.activeVersionCount,0);assert.deepEqual(detail.versions,[]);
 const sources=(await f.read('')).items.find(s=>s.id===a.sourceId);assert.equal(sources.versionCount,0);assert.equal(sources.videoVersionCount,0);assert.equal(sources.frameVersionCount,0);assert.equal((await f.read('?inputMode=video')).total,0);
 await assert.rejects(f.read('/'+a.sourceId+'/versions/1'),e=>e.statusCode===404);await assert.rejects(f.write('/'+a.sourceId+'/versions/1',{revision:2,title:'Old edit',enabled:true}),e=>e.statusCode===409);
 assert.equal(f.requests.length,0);
});
test('same request recovers committed deletion; changed input cannot reuse it',async t=>{
 const f=await setup(t),a=f.add(),b=f.add(),requestId=crypto.randomUUID();const first=await(await f.remove([a],{requestId})).json(),second=await f.remove([a],{requestId});assert.equal(second.headers.get('X-Idempotent-Replay'),'true');assert.deepEqual(await second.json(),first);await assert.rejects(f.remove([b],{requestId}),e=>e.statusCode===409);assert.equal(Boolean(f.row(b)),true);
});
test('validation and stale/held selections leave every selected version intact',async t=>{
 const f=await setup(t),a=f.add(),b=f.add();
 for(const rows of [[],Array(101).fill(a),[a,a],[{...a,version:0}],[{...a,revision:0}],[{...a,sourceId:'bad'}]])await assert.rejects(f.remove(rows));
 await assert.rejects(f.remove([a,{...b,revision:2}]),/已修改/);assert.equal(Boolean(f.row(a)),true);
 for(const state of ["publish_item_id='task'","publish_state='published'","published_at=123"]){f.sqlite.prepare('UPDATE psychology_video_hit_versions SET '+state+' WHERE source_id=?').run(b.sourceId);await assert.rejects(f.remove([a,b]),/生成或发布流程/);assert.equal(Boolean(f.row(a)),true);f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='',publish_state='',published_at=0 WHERE source_id=?").run(b.sourceId);}
 await assert.rejects(f.remove([a],{}, {origin:'https://other.test'}),e=>e.statusCode===403);await assert.rejects(f.remove([a],{}, {'sec-fetch-site':'cross-site'}),e=>e.statusCode===403);await assert.rejects(f.remove([a],{}, {},'GET'),e=>e.statusCode===405);
});
test('member ownership and latest module permissions apply to the whole batch; admins retain cross-creator management',async t=>{
 const f=await setup(t),a=f.add(),b=f.add();f.sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('other','other','operator','','',0,0)").run();f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other' WHERE id=?").run(b.sourceId);
 f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();await assert.rejects(f.remove([a,b]),e=>e.statusCode===404);assert.equal(Boolean(f.row(a)),true);
 f.sqlite.prepare("UPDATE factory_users SET role='admin' WHERE id='admin'").run();assert.equal((await(await f.remove([b])).json()).deleted,1);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]' WHERE id='admin'").run();await assert.rejects(f.remove([a]),e=>e.statusCode===403);assert.equal(Boolean(f.row(a)),true);
});
test('active rendering and historical publication ownership block deletion without cancelling jobs',async t=>{
 const f=await setup(t),a=f.add(),b=f.add();await insertAutoJob(f.db,{id:'render',type:'psychology-video-remix',title:'render',createdBy:'admin',payload:{videoRemix:{sourceId:b.sourceId,version:1}}},Date.now()).run();
 await assert.rejects(f.remove([a,b]),/生成或发布流程/);assert.equal(Boolean(f.row(a)),true);assert.equal(f.sqlite.prepare("SELECT status FROM factory_jobs WHERE id='render'").get().status,'queued');
 f.sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id='render'").run();f.sqlite.prepare("INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES(?,'a','old-item')").run(b.sourceId+':v1');await assert.rejects(f.remove([a,b]),/生成或发布流程/);
});
test('publication, editing, rendering and authorization races roll back the complete deletion transaction',async t=>{
 for(const race of ['publish','edit','render','grant','role']){
  const f=await setup(t),a=f.add(),b=f.add(),batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{
   if(race==='publish')f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='concurrent-task' WHERE source_id=?").run(b.sourceId);
   if(race==='edit')f.sqlite.prepare('UPDATE psychology_video_hit_versions SET revision=revision+1 WHERE source_id=?').run(b.sourceId);
   if(race==='render')await insertAutoJob(f.db,{id:'racing-render',type:'psychology-video-remix',title:'render',createdBy:'admin',payload:{videoRemix:{sourceId:b.sourceId,version:1}}},Date.now()).run();
   if(race==='grant')f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]' WHERE id='admin'").run();
   if(race==='role'){f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='another' WHERE id=?").run(b.sourceId);}
   return batch(statements);
  };
  await assert.rejects(f.remove([a,b]),e=>e.statusCode===409);assert.equal(Boolean(f.row(a)),true,race);assert.equal(Boolean(f.row(b)),true,race);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames WHERE source_id=?').get(a.sourceId).n,1);
 }
});
test('deleted refs cannot enter normal video or photo publication, including stale prepared selections',async t=>{
 const f=await setup(t),a=f.add(),b=f.add('video');await f.remove([a,b]);
 await assert.rejects(f.call('POST',input({mediaType:'photo',template:'selected-photo',sourceType:'video-hits',connectionIds:['a'],count:1,photoVersions:[a],isAiGenerated:false})),e=>[404,409,410].includes(e.statusCode));
 await assert.rejects(resolveHitVideo(f.env,{id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-video-hits','psychology-publish']},b));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);assert.equal(f.requests.length,0);
});
test('collector frees deleted unshared assets and keeps originals, shared video files and live task state',async t=>{
 const f=await setup(t),a=f.add(),b=f.add('video'),c=f.add('video');const video=f.row(b).video_asset_id,otherVideo=f.row(c).video_asset_id;
 f.sqlite.prepare('UPDATE psychology_video_hit_versions SET video_asset_id=? WHERE source_id=?').run(video,c.sourceId);
 const image=crypto.randomUUID(),key='psychology-video-hits/admin/'+image+'/digest',at=Date.now()-2*86400000;
 f.sqlite.prepare("INSERT INTO psychology_video_hit_assets(id,owner_id,r2_key,content_type,size,digest,created_at,last_touched_at) VALUES(?,'admin',?,'image/png',3,'digest',?,?)").run(image,key,at,at);
 f.sqlite.prepare("UPDATE psychology_video_hit_frames SET asset_id=?,image_url='' WHERE source_id=?").run(image,a.sourceId);
 f.sqlite.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,asset_id,text,duration_seconds) VALUES(?,0,1,?,'Original',3)").run(a.sourceId,image);
 await f.remove([a,b]);await collectVideoHitAssets(f.env);assert.ok(!f.deleted.includes(key));assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_videos WHERE id=?').get(video).cleanup_state,'active');
 assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_videos WHERE id=?').get(otherVideo).cleanup_state,'deleted');
 await f.remove([c]);await collectVideoHitAssets(f.env);assert.equal(f.sqlite.prepare('SELECT cleanup_state FROM psychology_video_hit_videos WHERE id=?').get(video).cleanup_state,'deleted');assert.ok(!f.deleted.includes(key));
});

test('one hundred selected materials delete in a bounded twelve-statement transaction',async t=>{
 const f=await setup(t),rows=Array.from({length:100},()=>f.add()),batch=f.db.batch.bind(f.db);let size;
 f.db.batch=async statements=>{size=statements.length;return batch(statements);};
 assert.equal((await(await f.remove(rows)).json()).deleted,100);assert.equal(size,12);assert.equal((await f.read('/ready')).total,0);
});
