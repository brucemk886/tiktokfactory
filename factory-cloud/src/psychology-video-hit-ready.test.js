import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {toPublicUser} from './auth.js';
import {handleVideoHitReady} from './psychology-video-hit-ready.js';
import {normalizeAutoPublish} from '../../scripts/psychology-auto-publish.js';
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits','psychology-publish']));
 f.env.ARCHIVE={async head(){return {};}};
 const actor=()=>toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 const read=async(query={},user=actor())=>{const url=new URL('https://factory.test/api/psychology-video-hits/ready?'+new URLSearchParams(query));return (await handleVideoHitReady(new Request(url),f.env,url,{user})).json();};
 const add=(mode='frames',owner='admin')=>{
  const id='vh-'+crypto.randomUUID().replaceAll('-',''),stamp=Date.now();
  f.sqlite.prepare("INSERT INTO psychology_video_hits(id,owner_id,external_id,video_url,title,import_source,created_at,updated_at) VALUES(?,?,?,'https://www.tiktok.com/@sample/video/123','Original','gpt-dot',?,?)").run(id,owner,id,stamp,stamp);
  f.sqlite.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,caption,enabled,input_mode,created_at,updated_at) VALUES(?,1,'Version 1',?,'Saved caption',1,?,?,?)").run(id,'Title '+id,mode,stamp,stamp);
  if(mode==='frames')for(const n of [1,2])f.sqlite.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,image_url,text,duration_seconds) VALUES(?,1,?,'https://images.pexels.com/test.jpg',?,3)").run(id,n,'Copy '+n);
  else{
   const asset=crypto.randomUUID();f.sqlite.prepare("INSERT INTO psychology_video_hit_videos(id,owner_id,digest,file_name,content_type,size,r2_key,created_at) VALUES(?,? ,?,'clip.mp4','video/mp4',24,?,?)").run(asset,owner,asset,asset,stamp);
   f.sqlite.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,r2_key,status,created_at,updated_at) VALUES(? ,?,'clip.mp4',?,'ready',?,?)").run(asset,owner,asset,stamp,stamp);
   f.sqlite.prepare('UPDATE psychology_video_hit_versions SET video_asset_id=? WHERE source_id=?').run(asset,id);
  }
  return {sourceId:id,version:1,revision:1};
 };
 return {...f,actor,read,add};
}
test('ready inventory filters reserved, published without video IDs, disabled, incomplete and unavailable before pagination',async t=>{
 const f=await setup(t);const visible=Array.from({length:14},()=>f.add());const hidden=[];
 for(const sql of ["enabled=0","publish_item_id='pending-no-tiktok-id',publish_state='reserved'","publish_state='published'","published_at=123","cleaned_at=123"]){const ref=f.add();hidden.push(ref);f.sqlite.prepare('UPDATE psychology_video_hit_versions SET '+sql+' WHERE source_id=?').run(ref.sourceId);}
 const archived=f.add();f.sqlite.prepare('UPDATE psychology_video_hits SET archived_at=1 WHERE id=?').run(archived.sourceId);
 const gap=f.add();f.sqlite.prepare('DELETE FROM psychology_video_hit_frames WHERE source_id=? AND frame_index=1').run(gap.sourceId);
 const unavailable=f.add();f.sqlite.prepare("UPDATE psychology_video_hit_frames SET asset_id='missing' WHERE source_id=?").run(unavailable.sourceId);
 const used=f.add();f.sqlite.prepare("INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES(?,'a','old-record')").run(used.sourceId+':v1');
 const tooLong=f.add();for(let i=3;i<=16;i++)f.sqlite.prepare("INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,image_url,duration_seconds) VALUES(?,1,?,'https://images.pexels.com/x.jpg',3)").run(tooLong.sourceId,i);
 const video=f.add('video'),digestUsed=f.add('video');const asset=f.sqlite.prepare('SELECT video_asset_id id FROM psychology_video_hit_versions WHERE source_id=?').get(digestUsed.sourceId).id;f.sqlite.prepare("INSERT INTO psychology_video_hit_video_usage VALUES('admin',?,?,'used-video')").run(asset,asset);
 const a=await f.read();assert.deepEqual(a.counts,{total:15,photos:14,videos:1});assert.equal(a.items.length,12);assert.equal(a.hasMore,true);assert.equal(a.canPublish,true);
 const b=await f.read({page:2});assert.equal(b.items.length,3);assert.equal(b.hasMore,false);const ids=[...a.items,...b.items].map(i=>i.ref.sourceId);assert.equal(new Set(ids).size,15);for(const ref of hidden)assert.ok(!ids.includes(ref.sourceId));
 const photos=await f.read({mediaType:'photo'});assert.equal(photos.total,14);assert.ok(photos.items.every(x=>x.canPhoto&&x.frames.length===2));assert.equal((await f.read({mediaType:'video'})).items[0].ref.sourceId,video.sourceId);
 assert.equal((await f.read({q:visible[0].sourceId,importSource:'gpt-dot'})).total,1);assert.equal((await f.read({importSource:'grokbot'})).total,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);assert.equal(f.requests.length,0);
});
test('ready selection requires exact current revision, fresh grants and creator scope',async t=>{
 const f=await setup(t),one=f.add();const query={sourceId:one.sourceId,version:1,revision:1,mediaType:'photo'};assert.equal((await f.read(query)).items[0].ref.sourceId,one.sourceId);
 f.sqlite.prepare('UPDATE psychology_video_hit_versions SET revision=2 WHERE source_id=?').run(one.sourceId);await assert.rejects(f.read(query),/已修改/);
 f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other' WHERE id=?").run(one.sourceId);assert.equal((await f.read()).total,1);
 f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE id='admin'").run();assert.equal((await f.read()).total,0);await assert.rejects(f.read({...query,revision:2}),/已修改/);
 f.sqlite.prepare("UPDATE factory_users SET role='admin',sidebar_modules_json='[\"psychology-video-hits\"]' WHERE id='admin'").run();assert.equal((await f.read()).canPublish,false);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]' WHERE id='admin'").run();await assert.rejects(f.read(),/权限/);
});
test('normal explicit video selection publishes only the chosen version and rejects stale replay input',async t=>{
 const f=await setup(t),other=f.add('video'),chosen=f.add('video');const config=input({sourceType:'video-hits',template:'selected-video',count:1,connectionIds:['a'],isAiGenerated:false,videoVersions:[chosen]});
 const normalized=normalizeAutoPublish(config);assert.deepEqual(normalized.videoVersions,[chosen]);assert.throws(()=>normalizeAutoPublish({...config,videoVersions:[]}),/条数一致/);
 assert.throws(()=>normalizeAutoPublish({...config,count:2,videoVersions:[chosen,chosen]}),/重复选择/);
 const response=await f.call('POST',config);assert.equal(response.status,202);const result=await response.json();const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items WHERE batch_id=?').all(result.batchId);assert.equal(items.length,1);assert.equal(items[0].source_id,chosen.sourceId+':v1');
 assert.equal(f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions WHERE source_id=?').get(other.sourceId).publish_item_id,'');assert.equal((await f.read()).total,1);
 assert.equal((await f.call('POST',config)).status,200,'unchanged retry recovers original batch');
 await assert.rejects(f.call('POST',{...config,requestId:crypto.randomUUID()}),/已被提交/);assert.equal(f.requests.length,0);
});

test('current completed renders count as video once; stale or pending preview copies are excluded',async t=>{
 const f=await setup(t),ref=f.add(),db=f.sqlite;
 db.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,worker_id,payload_json,result_json,created_at,updated_at) VALUES('render','psychology-video-remix','done','Render','admin','worker','{}',?,1,1)").run(JSON.stringify({results:[{fileName:'made.mp4'}]}));
 db.prepare("UPDATE psychology_video_hit_versions SET render_job_id='render',render_revision=1,render_source_revision=1 WHERE source_id=?").run(ref.sourceId);
 for(const [id,status,owner] of [['preview','ready','admin'],['extra','ready','another'],['pending','pending','third']]){
  db.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,r2_key,status,source_job_id,created_at,updated_at) VALUES(?,?,'made.mp4',?,?,'render',1,1)").run(id,owner,id,status);
  db.prepare('INSERT INTO psychology_video_hit_render_assets VALUES(?,?,1,?)').run(id,ref.sourceId,owner);
 }
 assert.deepEqual((await f.read()).counts,{total:1,photos:1,videos:1});
 db.prepare('UPDATE psychology_video_hits SET revision=2 WHERE id=?').run(ref.sourceId);assert.deepEqual((await f.read()).counts,{total:1,photos:1,videos:0});
 db.prepare('UPDATE psychology_video_hits SET revision=1 WHERE id=?').run(ref.sourceId);db.prepare("UPDATE psychology_video_assets SET status='pending'").run();assert.equal((await f.read({mediaType:'video'})).total,0);
});
test('ready previews require source access but not publishing rights and retain byte-range privacy',async t=>{
 const f=await setup(t),ref=f.add('video');f.sqlite.prepare("UPDATE factory_users SET role='operator',sidebar_modules_json='[\"psychology-video-hits\"]' WHERE id='admin'").run();
 const item=(await f.read()).items[0];assert.equal((await f.read()).canPublish,false);
 f.env.ARCHIVE.get=async()=>({body:new Uint8Array([1,2]),size:10,range:{offset:2,length:2}});
 const read=async()=>{const url=new URL('https://factory.test'+item.previewUrl);return handleVideoHitReady(new Request(url,{headers:{range:'bytes=2-3'}}),f.env,url,{user:f.actor()});};
 const response=await read();assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 2-3/10');assert.match(response.headers.get('Cache-Control'),/private/);
 f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other' WHERE id=?").run(ref.sourceId);f.sqlite.prepare("UPDATE psychology_video_hit_videos SET owner_id='other'").run();f.sqlite.prepare("UPDATE psychology_video_assets SET owner='other'").run();await assert.rejects(read(),/无权/);
});
