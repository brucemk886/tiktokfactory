import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {handleVideoLibrary,handleVideoTransfer,normalizeSelectedPublish} from './psychology-video-library.js';
import {claimTypeFilter} from './jobs.js';
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']},BASE='https://factory.test/api/psychology-video-library';
const project={connectionId:'brand',accountId:'1',campaignId:'7693454687705595917'};
async function setup(t){
 const f=await fixture(t),files=new Map();f.env.ARCHIVE={async put(key,stream){files.set(key,new Uint8Array(await new Response(stream).arrayBuffer()));},async head(key){return files.has(key)?{size:files.get(key).length}:null;},async get(key){const b=files.get(key);return b?{body:new Response(b).body,size:b.length}:null;},async delete(key){files.delete(key);}};
 const prior=globalThis.fetch;let joins=0,uploads=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/api/v1/tiktok-one')){joins++;return Response.json({joined:true});}
  if(String(url).endsWith('/api/v1/publish/assets')){uploads++;return Response.json({assetKey:'temporary--'+crypto.randomUUID()+'.mp4'});}
  return prior(url,init);
 });
 for(const id of ['a','b'])f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+id,JSON.stringify({followers:1000}),Date.now());
 const call=(path='',method='GET',body,headers={},actor=user)=>{const r=new Request(BASE+path,{method,headers,...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});return handleVideoLibrary(r,f.env,new URL(r.url),{user:actor});};
 const upload=async()=>{const r=await call('/upload','POST','fake-mp4',{'X-File-Name':'sample.mp4','X-File-Size':'8'});return (await r.json()).video;};
 const submit=body=>{const r=new Request('https://factory.test/api/psychology-video-publish',{method:'POST',body:JSON.stringify(body)});return handleVideoLibrary(r,f.env,new URL(r.url),{user});};
 const transfer=(job,method,body,worker='w')=>{const r=new Request('https://factory.test/api/worker/psychology-video-transfer/'+job,{method,headers:{'x-factory-worker':worker,'X-File-Size':'8'},body:body||'{}'});return handleVideoTransfer(r,f.env,new URL(r.url));};
 return {...f,files,call,upload,submit,transfer,counts:()=>({joins,uploads})};
}
const config=assetId=>({requestId:crypto.randomUUID(),tiktokOne:project,items:[{assetId,connectionId:'a',caption:'Reviewed caption',scheduleAt:Math.floor(Date.now()/1000)+7200,isAiGenerated:true}]});
test('upload/preview are private and never create publication work',async t=>{
 const f=await setup(t),v=await f.upload();assert.equal(v.status,'ready');assert.equal((await f.call('/'+v.id+'/file')).status,200);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,0);assert.deepEqual(f.counts(),{joins:0,uploads:0});
 f.sqlite.prepare("UPDATE psychology_video_assets SET owner='elsewhere' WHERE id=?").run(v.id);
 await assert.rejects(f.call('/'+v.id+'/file'),/无权/);
 await assert.rejects(f.call('/upload','POST','x',{'X-File-Name':'..%2Fx.mp4','X-File-Size':'1'}),/文件名/);
 await assert.rejects(f.call('/upload','POST','x',{'X-File-Name':'x.mp4','X-File-Size':'99614721'}),/95MB/);
 await assert.rejects(f.call('/upload','POST','x',{'Origin':'https://evil.test','X-File-Name':'x.mp4','X-File-Size':'1'}),/来源/);
});
test('generated inventory paginates psychology results; import only queues pinned preview transfer',async t=>{
 const f=await setup(t);f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,worker_id,payload_json,result_json,created_at,updated_at) VALUES('render','psychology','done','Demo','admin','w','{}',?,1,1)").run(JSON.stringify({results:[{fileName:'made.mp4'}]}));
 const list=await (await f.call('?source=generated')).json();assert.equal(list.videos[0].fileName,'made.mp4');assert.equal(list.videos[0].status,'local');
 const imported=await (await f.call('/import','POST',{jobId:'render',resultIndex:0})).json();await f.call('/import','POST',{jobId:'render',resultIndex:0});
 const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-video-archive'").get();assert.equal(JSON.parse(job.payload_json).targetWorkerId,'w');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM factory_jobs WHERE type='psychology-video-archive'").get().n,1);
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(job.id);
 await assert.rejects(f.transfer(job.id,'PUT','fake-mp4','other'),/当前工人/);await f.transfer(job.id,'PUT','fake-mp4');
 assert.equal((await (await f.call('/'+imported.assetId+'/file')).text()),'fake-mp4');assert.deepEqual(f.counts(),{joins:0,uploads:0});
});
for(const aiFlag of [false,true])test('explicit selection freezes mapping, project, caption and schedule and replays once (AI=' + aiFlag + ')',async t=>{
 const f=await setup(t),v=await f.upload(),body=config(v.id);body.items[0].isAiGenerated=aiFlag;const result=await (await f.submit(body)).json();await f.submit(body);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,1);assert.equal(f.counts().joins,1);
 const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-selected-video'").get(),p=JSON.parse(job.payload_json);assert.equal(p.publish.videoDesc,'Reviewed caption');assert.equal(p.publish.isAiGenerated,aiFlag);assert.equal(p.psychologyAutomation.scheduleAt,body.items[0].scheduleAt);
 await assert.rejects(f.submit({...body,items:[{...body.items[0],caption:'changed'}]}),/其他配置/);
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(job.id);await f.transfer(job.id,'POST');await f.transfer(job.id,'POST');
 assert.equal(f.counts().uploads,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].items[0].postInfo.isAiGenerated,aiFlag);assert.equal(f.requests[0].tiktokOne.campaignId,project.campaignId);assert.equal(result.accepted,true);
});
test('missing followers, wrong account, foreign asset and revoked permission fail closed',async t=>{
 const f=await setup(t),v=await f.upload(),body=config(v.id);f.sqlite.prepare("UPDATE official_accounts_latest SET profile_json='{}' WHERE account_key='tiktok:a'").run();await assert.rejects(f.submit(body),/粉丝待同步/);
 f.sqlite.prepare("UPDATE official_accounts_latest SET profile_json='{\"followers\":1000}' WHERE account_key='tiktok:a'").run();
 await assert.rejects(f.submit({...body,items:[{...body.items[0],connectionId:'outside'}]}),/分配分组/);
 f.sqlite.prepare("UPDATE psychology_video_assets SET owner='elsewhere'").run();await assert.rejects(f.submit(body),/无权/);assert.equal(f.counts().joins,0);
 f.sqlite.prepare("UPDATE psychology_video_assets SET owner='admin'").run();await f.submit(body);const job=f.sqlite.prepare("SELECT id FROM factory_jobs WHERE type='psychology-selected-video'").get();
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(job.id);f.sqlite.prepare("UPDATE factory_users SET active=0 WHERE username='admin'").run();await assert.rejects(f.transfer(job.id,'POST'),/权限/);assert.equal(f.counts().uploads,0);
});
test('old workers cannot claim transfer jobs; capable workers can and invalid review is rejected',()=>{
 assert.match(claimTypeFilter({}).sql,/psychology-selected-video/);assert.doesNotMatch(claimTypeFilter({psychologyVideoTransfer:true}).sql,/psychology-selected-video/);
 const c=config('asset');assert.throws(()=>normalizeSelectedPublish({...c,items:[{...c.items[0],scheduleAt:1}]}),/发布时间/);assert.throws(()=>normalizeSelectedPublish({...c,items:[c.items[0],c.items[0]]}),/重复/);
 assert.equal(normalizeSelectedPublish(c).minFollowers,1000);
});

import {psychologyItemStatus} from './psychology-item-status.js';
test('selected-video uploads report publishing and upload failure accurately',()=>{assert.equal(psychologyItemStatus({type:'psychology-selected-video',status:'running'}).displayStatus,'publishing');assert.equal(psychologyItemStatus({type:'psychology-selected-video',status:'failed',error:'upload failed'}).displayStatus,'publish_failed');});

import {handlePsychologyAutoPublish} from './psychology-auto-publish.js';
import {handleVideoHitProduction} from './psychology-video-hit-production.js';
import {collectVideoHitAssets,VIDEO_HIT_GRACE_MS} from './psychology-video-hit-cleanup.js';
import {input as autoInput} from './psychology-cloud-test-fixture.js';
async function hitFixture(f,{digest,version=1,sourceId,enabled=1}={}){
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-publish','psychology-video-hits']));
 const asset=await f.upload(),row=f.sqlite.prepare('SELECT * FROM psychology_video_assets WHERE id=?').get(asset.id);
 const id=sourceId||'vh-'+crypto.randomUUID().replaceAll('-',''),key='psychology-video-hit-videos/admin/'+asset.id+'/digest';
 f.files.set(key,f.files.get(row.r2_key));f.files.delete(row.r2_key);f.sqlite.prepare('UPDATE psychology_video_assets SET r2_key=? WHERE id=?').run(key,asset.id);
 f.sqlite.prepare('INSERT INTO psychology_video_hit_videos(id,owner_id,digest,file_name,content_type,size,r2_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(asset.id,'admin',digest||asset.id,'sample.mp4','video/mp4',8,key,Date.now());
 if(!sourceId)f.sqlite.prepare('INSERT INTO psychology_video_hits(id,owner_id,external_id,video_url,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'admin',id,'https://example.test/video','Source',Date.now(),Date.now());
 f.sqlite.prepare("INSERT INTO psychology_video_hit_versions(source_id,version,name,title,caption,enabled,input_mode,video_asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'video',?,?,?)").run(id,version,'Version '+version,'Hit title '+version,'Saved hit caption '+version,enabled,asset.id,Date.now(),Date.now());
 return {asset,ref:{sourceId:id,version,revision:1},key};
}
const oneHit=h=>{const c=config(h.asset.id);c.items[0].videoHit=h.ref;return c;};
const normalHit=(f,overrides={})=>{const body=autoInput({sourceType:'video-hits',template:'selected-video',count:1,connectionIds:['a'],isAiGenerated:true,...overrides}),r=new Request('https://factory.test/api/psychology-auto-publish',{method:'POST',body:JSON.stringify(body)});return handlePsychologyAutoPublish(r,f.env,new URL(r.url),{user});};
test('hit picker carries saved caption and version identity, excludes reserved/disabled/foreign/cleaned versions',async t=>{
 const f=await setup(t),h=await hitFixture(f);await hitFixture(f,{enabled:0});const foreign=await hitFixture(f);f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other' WHERE id=?").run(foreign.ref.sourceId);
 let list=await (await f.call('?source=video-hits')).json();assert.equal(list.videos.length,2,'administrator sees member sources too');list.videos=list.videos.filter(v=>v.videoHit.sourceId===h.ref.sourceId);f.sqlite.prepare('UPDATE psychology_video_hit_versions SET enabled=0 WHERE source_id=?').run(foreign.ref.sourceId);assert.equal(list.videos[0].caption,'Saved hit caption 1');assert.deepEqual(list.videos[0].videoHit,h.ref);assert.equal(list.videos[0].assetId,h.asset.id);assert.ok(list.videos[0].previewUrl);
 assert.equal(f.requests.length,0);await f.submit(oneHit(h));list=await (await f.call('?source=video-hits')).json();assert.equal(list.videos.length,0);
 await assert.rejects(normalHit(f),/只有 0/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,1);
});
test('manual One freezes edited caption, reserves version and digest, is replayable and preserves cleanup',async t=>{
 const f=await setup(t),h=await hitFixture(f),body=oneHit(h),response=await(await f.submit(body)).json();
 assert.equal((await(await f.submit(body)).json()).duplicate,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,1);
 const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-selected-video'").get(),payload=JSON.parse(job.payload_json);assert.deepEqual(payload.videoHitOrigin,h.ref);assert.equal(payload.publish.videoDesc,'Reviewed caption');assert.equal(payload.assetId,h.asset.id);
 const version=f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions').get();assert.equal(version.publish_item_id,job.id);assert.equal(version.publish_state,'reserved');assert.equal(version.cleaned_at,0);
 assert.equal(f.sqlite.prepare('SELECT item_id FROM psychology_video_hit_video_usage').get().item_id,job.id);
 const batch=f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches').get().config_json;assert.ok(!batch.includes('Reviewed caption'));assert.match(batch,/captionDigest/);
 const r=new Request('https://factory.test/api/psychology-video-hits/'+h.ref.sourceId+'/versions/1/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),revision:1,connectionIds:['a'],scheduleAt:body.items[0].scheduleAt,isAiGenerated:true})});await assert.rejects(handleVideoHitProduction(r,f.env,new URL(r.url),{user}),/已提交发布/);
 f.sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id=?").run(job.id);
 f.sqlite.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES(?,?,?)').run('receipt',Date.now(),JSON.stringify({autoTaskId:job.id,status:'published'}));
 const published=f.sqlite.prepare('SELECT published_at FROM psychology_video_hit_versions').get().published_at;assert.ok(published>0);
 await collectVideoHitAssets(f.env,{now:published+VIDEO_HIT_GRACE_MS-1});assert.ok(f.files.has(h.key));
 await collectVideoHitAssets(f.env,{now:published+VIDEO_HIT_GRACE_MS+2000});assert.equal(f.files.has(h.key),false);assert.equal(f.sqlite.prepare('SELECT caption FROM psychology_video_hit_versions').get().caption,'');assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(job.id).payload_json).publish.videoDesc,undefined);
 assert.equal((await(await f.submit(body)).json()).batchId,response.batchId);assert.equal(f.requests.length,0);
});
test('normal source draws saved videos and captions without rendering or project requests',async t=>{
 const f=await setup(t),a=await hitFixture(f),b=await hitFixture(f),requestId=crypto.randomUUID();
 const result=await(await normalHit(f,{count:2,connectionIds:['a','b'],requestId,selection:'recent'})).json();assert.equal(result.count,2);
 const jobs=f.sqlite.prepare('SELECT type,payload_json FROM factory_jobs ORDER BY id').all();assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.type==='psychology-selected-video'));
 assert.deepEqual(jobs.map(j=>JSON.parse(j.payload_json).psychologyAutomation.connectionId),['a','b']);assert.ok(jobs.every(j=>JSON.parse(j.payload_json).publish.videoDesc==='Saved hit caption 1'));
 assert.deepEqual(f.counts(),{joins:0,uploads:0});assert.equal(f.requests.length,0);assert.equal((await(await normalHit(f,{count:2,connectionIds:['a','b'],requestId,selection:'recent'})).json()).duplicate,true);
 await assert.rejects(f.submit(oneHit(a)),/已被提交/);await assert.rejects(f.submit(oneHit(b)),/已被提交/);
});
test('same file in two recreations cannot reserve twice; batch rollback and shortage leave no partial jobs',async t=>{
 const f=await setup(t),a=await hitFixture(f,{digest:'same'}),b=await hitFixture(f,{digest:'same'});
 await assert.rejects(normalHit(f,{count:2}),/只有 1/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,0);
 const body=oneHit(a);body.items.push({...oneHit(b).items[0],connectionId:'b'});await assert.rejects(f.submit(body),/其他任务占用/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_video_hit_versions WHERE publish_item_id<>''").get().n,0);
 await normalHit(f);assert.equal((await(await f.call('?source=video-hits')).json()).videos.length,0);
});
test('stale revision, asset substitution, duplicate version and permission revocation fail before reservation',async t=>{
 const f=await setup(t),a=await hitFixture(f),b=await hitFixture(f);
 await assert.rejects(f.submit({...oneHit(a),items:[{...oneHit(a).items[0],videoHit:{...a.ref,revision:2}}]}),/修改/);
 await assert.rejects(f.submit({...oneHit(a),items:[{...oneHit(a).items[0],assetId:b.asset.id}]}),/成片已变化/);
 const c=oneHit(a);c.items.push({...c.items[0],connectionId:'b'});await assert.rejects(f.submit(c),/只能选择一次/);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[\"psychology-publish\"]'").run();await assert.rejects(f.call('?source=video-hits'),/权限/);await assert.rejects(normalHit(f),/权限/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);assert.equal(f.counts().joins,0);
});
test('concurrent version edit before commit rolls back whole selected batch',async t=>{
 const f=await setup(t),h=await hitFixture(f),before=f.db.batch;let injected=false;
 f.db.batch=async statements=>{if(!injected&&String(statements[0]?.args?.[0]).startsWith('psy-select-')){injected=true;f.sqlite.prepare('UPDATE psychology_video_hit_versions SET revision=revision+1').run();}return before(statements);};
 await assert.rejects(f.submit(oneHit(h)),/其他任务占用/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_video_hit_video_usage').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});
test('local completed recreation is eligible only while source and render revisions match; normal uses existing render',async t=>{
 const f=await setup(t),h=await hitFixture(f),render='render-hit';
 f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,worker_id,payload_json,result_json,created_at,updated_at) VALUES(?,'psychology-video-remix','done','Composed','admin','worker-original',?,?,1,1)").run(render,JSON.stringify({module:'psychology',videoRemix:{sourceId:h.ref.sourceId,version:1,revision:1,sourceRevision:1}}),JSON.stringify({results:[{fileName:'render-hit.mp4',videoPath:'D:/factory/render-hit.mp4'}]}));
 f.sqlite.prepare("UPDATE psychology_video_hit_versions SET input_mode='frames',video_asset_id='',render_job_id=?,render_revision=1,render_source_revision=1").run(render);
 let list=await(await f.call('?source=video-hits')).json();assert.equal(list.videos.length,1);assert.equal(list.videos[0].previewUrl,'');assert.equal(list.videos[0].canPrepare,true);
 f.sqlite.prepare('UPDATE psychology_video_hits SET revision=2').run();assert.equal((await(await f.call('?source=video-hits')).json()).videos.length,0);f.sqlite.prepare('UPDATE psychology_video_hits SET revision=1').run();
 await normalHit(f);const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='official-publish'").get();assert.ok(job);const p=JSON.parse(job.payload_json);assert.deepEqual(p.videoHitOrigin,h.ref);assert.equal(p.renderWorkerId,'worker-original');assert.equal(p.publish.videoDesc,'Saved hit caption 1');assert.equal(f.requests.length,0);
});

test('render identity changed before commit rejects instead of freezing an older local file',async t=>{
 const f=await setup(t),h=await hitFixture(f),before=f.db.batch;let changed=false;
 f.db.batch=async statements=>{if(!changed&&String(statements[0]?.args?.[0]).startsWith('psy-select-')){changed=true;f.sqlite.prepare("UPDATE psychology_video_hit_versions SET render_job_id='new-render'").run();}return before(statements);};
 await assert.rejects(f.submit(oneHit(h)),/其他任务占用/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});
test('all three video inventories return twenty per page with no skipped or duplicate records',async t=>{
 const f=await setup(t);
 for(let i=0;i<21;i++){
  await f.upload();await hitFixture(f);
  f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,worker_id,payload_json,result_json,created_at,updated_at) VALUES(?,'psychology','done','Generated','admin','w','{}',?,?,?)").run('page-generated-'+i,JSON.stringify({results:[{fileName:'generated-'+i+'.mp4'}]}),Date.now()+i,Date.now());
 }
 for(const source of ['uploaded','generated','video-hits']){
  const first=await(await f.call('?source='+source+'&page=1')).json(),second=await(await f.call('?source='+source+'&page=2')).json(),third=await(await f.call('?source='+source+'&page=3')).json();
  assert.equal(first.pageSize,20);assert.equal(first.videos.length,20);assert.equal(first.hasMore,true);assert.equal(second.videos.length,1);assert.equal(second.hasMore,false);assert.equal(third.videos.length,0);assert.equal(third.hasMore,false);
  assert.equal(new Set([...first.videos,...second.videos].map(v=>v.id||v.sourceJobId+':'+v.resultIndex)).size,21);
 }
 assert.equal(f.requests.length,0);assert.deepEqual(f.counts(),{joins:0,uploads:0});
});

test('continued video version 21 is selectable and reserves once with saved identity',async t=>{
 const f=await setup(t),h=await hitFixture(f,{version:21}),body=config(h.asset.id);body.items[0].videoHit=h.ref;assert.equal((await f.submit(body)).status,202);const v=f.sqlite.prepare('SELECT * FROM psychology_video_hit_versions WHERE version=21').get();assert.ok(v.publish_item_id);assert.equal(v.publish_state,'reserved');assert.equal((await f.submit(body)).status,200);await assert.rejects(f.submit({...body,requestId:crypto.randomUUID()}),/提交|停用|修改/);assert.equal(f.requests.length,0);
});
