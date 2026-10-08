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
test('explicit selection freezes mapping, project, caption and schedule and replays once',async t=>{
 const f=await setup(t),v=await f.upload(),body=config(v.id);const result=await (await f.submit(body)).json();await f.submit(body);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,1);assert.equal(f.counts().joins,1);
 const job=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-selected-video'").get(),p=JSON.parse(job.payload_json);assert.equal(p.publish.videoDesc,'Reviewed caption');assert.equal(p.psychologyAutomation.scheduleAt,body.items[0].scheduleAt);
 await assert.rejects(f.submit({...body,items:[{...body.items[0],caption:'changed'}]}),/其他配置/);
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(job.id);await f.transfer(job.id,'POST');await f.transfer(job.id,'POST');
 assert.equal(f.counts().uploads,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].items[0].postInfo.isAiGenerated,true);assert.equal(f.requests[0].tiktokOne.campaignId,project.campaignId);assert.equal(result.accepted,true);
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
