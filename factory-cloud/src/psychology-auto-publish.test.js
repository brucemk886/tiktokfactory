import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { normalizeAutoPublish, assignments } from '../../scripts/psychology-auto-publish.js';
import { handlePsychologyAutoPublish, enqueueAutoPhotoRender, enqueueAutoVideoPublish, assertAutoJobAccess } from './psychology-auto-publish.js';
import { handleJobs, officialPublishFollowupPayload } from './jobs.js';
import { handleAutoPhotoWorker } from './psychology-auto-photo.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { kvSet } from './kv.js';

const BASE='https://factory.test';
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']};
function input(overrides={}) {return {requestId:crypto.randomUUID(),name:'Test batch',mediaType:'video',template:'psychology',count:3,
  connectionIds:['a','b'],scheduleAt:Math.floor(Date.now()/1000)+7200,intervalMinutes:60,selection:'popular',...overrides};}
async function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  const dir=new URL('../migrations/',import.meta.url);
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(new URL(file,dir),'utf8'));
  const db={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
    async first(){return sqlite.prepare(sql).get(...this.args)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...this.args)};},
    async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...this.args).changes)}};}};},
    async batch(items){sqlite.exec('BEGIN');try{const rows=[];for(const item of items)rows.push(await item.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES ('admin','admin','admin','','',?,0,0)").run(JSON.stringify(user.sidebarModules));
  await kvSet(db,'official-account-groups',{projects:[{id:'proj-psych',name:'心理学',moduleKey:'psychology'},{id:'proj-novel',name:'小说推文',moduleKey:'novel-promotion'}],
    groups:[{id:'g',name:'心理学账号',projectId:'proj-psych'},{id:'other',name:'小说',projectId:'proj-novel'}],assignments:{a:'g',b:'g',outside:'other'}});
  const requests=[],instances=new Map();
  t.mock.method(globalThis,'fetch',async (url,init={})=>{
    const address=String(url);
    if(address.includes('/api/v1/accounts')) return Response.json({accounts:[{id:'a',username:'alpha',scopes:['video.publish']},{id:'b',scopes:['video.publish']},{id:'outside',scopes:['video.publish']},{id:'read-only',scopes:['user.info.basic']}]});
    if(address.endsWith('/api/v1/publish/batches')) { requests.push(JSON.parse(init.body)); return Response.json({batch:{id:'remote-batch',tasks:[{id:'remote-task'}]}}); }
    throw new Error('Unexpected network call '+address);
  });
  const env={DB:db,SIGNAL_DESK_BRIDGE_KEY:'test',WORKER_TOKEN:'test-worker',KIE_API_KEY:'test',ARCHIVE:{},
    PEER_PHOTO_WORKFLOW:{async get(id){if(!instances.has(id))throw new Error('not found');return {async status(){return {status:'queued'};},async restart(){instances.set(id,2);}};},
      async create({id}){instances.set(id,1);return {id};}}};
  await importPsychologyPeerHits(db,Array.from({length:5},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/video/'+(100+n),title:'Video idea '+n,playCount:100+n})),user.id);
  await importPsychologyPeerHits(db,Array.from({length:3},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/photo/'+(200+n),title:'Photo idea '+n,playCount:500+n})),user.id);
  async function call(method='GET',body,path='/api/psychology-auto-publish',actor=user) {
    const req=new Request(BASE+path,{method,...(body?{body:JSON.stringify(body)}:{})});
    return handlePsychologyAutoPublish(req,env,new URL(req.url),actor?{user:actor}:null);
  }
  return {db,sqlite,env,call,instances,requests};
}
test('strict type/template/count/account and complete schedule validation',()=>{
  const raw=input(); const config=normalizeAutoPublish(raw);
  assert.equal(config.count,3);
  assert.equal(config.rewriteCopy,false);
  assert.equal(normalizeAutoPublish({...raw,rewriteCopy:true}).rewriteCopy,true);
  assert.deepEqual(config.musicIds,[]);
  // Music pools only apply to photo batches and must be plain numeric IDs.
  assert.deepEqual(normalizeAutoPublish({...raw,musicIds:['123','123',' 456 ']}).musicIds,[]);
  assert.deepEqual(normalizeAutoPublish({...raw,mediaType:'photo',template:'photo-text',musicIds:['123','123',' 456 ']}).musicIds,['123','456']);
  assert.throws(()=>normalizeAutoPublish({...raw,mediaType:'photo',template:'photo-text',musicIds:['12a']}),/音乐 ID/);
  assert.throws(()=>normalizeAutoPublish({...raw,mediaType:'photo',template:'photo-text',musicIds:Array.from({length:101},(_,i)=>String(i+1))}),/音乐 ID/);
  const plan=assignments(config,[{id:1},{id:2},{id:3}]);
  assert.deepEqual(plan.map(p=>p.connectionId),['a','b','a']);
  assert.deepEqual(plan.map(p=>p.scheduleAt),[raw.scheduleAt,raw.scheduleAt,raw.scheduleAt+3600]);
  for(const changes of [{mediaType:'toString'},{mediaType:'photo'},{count:0},{count:2.2},{count:51},{count:1},{connectionIds:[]},{scheduleAt:1},{intervalMinutes:0},{selection:'sql;drop'}])
    assert.throws(()=>normalizeAutoPublish({...raw,...changes}),e=>e.statusCode===400);
  assert.throws(()=>normalizeAutoPublish({...raw,count:50,connectionIds:['a'],intervalMinutes:10080}),/14 天/);
  assert.throws(()=>assignments(config,[{id:1}]),/只有 1/);
});
test('batch draws correct media, unique sources, creates exact jobs and stable account assignments',async t=>{
  const {call,sqlite,requests}=await fixture(t);const body=input();
  assert.equal((await call('POST',body)).status,202);
  assert.equal((await call('POST',body)).status,200);
  const jobs=sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all();
  assert.equal(jobs.length,3);assert.ok(jobs.every(j=>j.type==='psychology'));
  const payloads=jobs.map(j=>JSON.parse(j.payload_json));
  assert.equal(new Set(payloads.map(p=>p.peerSource.id)).size,3);
  assert.deepEqual(payloads.map(p=>p.peerSource.title),['Video idea 4','Video idea 3','Video idea 2']);
  assert.deepEqual(payloads.map(p=>p.publish.connectionIds),[['a'],['b'],['a']]);
  assert.ok(payloads.every(p=>p.imageModel==='z-image'&&p.publish.autoPublish&&p.totalVideos===1));
  assert.equal(requests.length,0);
  await assert.rejects(call('POST',{...body,count:4}),e=>e.statusCode===409);
  const page=await (await call()).json();assert.equal(page.batches[0].items.length,3);
});
test('unauthorized users and accounts cannot create paid jobs; insufficient matching sources writes nothing',async t=>{
  const {call,sqlite}=await fixture(t);
  await assert.rejects(call('POST',input(),'/api/psychology-auto-publish',{...user,role:'operator'}),e=>e.statusCode===403);
  await assert.rejects(call('POST',input({connectionIds:['outside']})),e=>e.statusCode===403);
  await assert.rejects(call('POST',input({connectionIds:['read-only']})),e=>e.statusCode===403);
  await assert.rejects(call('POST',input({query:'no matching result'})),/只有 0/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,0);
});
test('photo workflow dispatch resumes after HTTP failure and the render handoff is idempotent',async t=>{
  const {call,env,db,sqlite,instances}=await fixture(t);const body=input({mediaType:'photo',template:'photo-text',count:2});
  const create=env.PEER_PHOTO_WORKFLOW.create;
  env.PEER_PHOTO_WORKFLOW.create=async()=>{throw new Error('temporary dispatch outage');};
  await assert.rejects(call('POST',body),e=>e.statusCode===503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,2);
  env.PEER_PHOTO_WORKFLOW.create=create;
  const response=await (await call('POST',body)).json();assert.equal(instances.size,2);
  await call('POST',body);assert.equal(instances.size,2);
  const source=sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id LIMIT 1').get();
  const result={plan:{title:'A pause',caption:'Take a moment'},results:[{template:'cover',title:'Pause before you reply',textKind:'cover'},{template:'content',title:'Notice',body:'What story are you telling yourself?'}]};
  sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify(result),source.id);
  await enqueueAutoPhotoRender(env,source.id);await enqueueAutoPhotoRender(env,source.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,3);
  const item=sqlite.prepare('SELECT * FROM psychology_publish_items WHERE id=?').get(source.id);
  assert.equal(item.job_id,source.id+'-render');
  const render=sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(item.job_id);
  assert.equal(JSON.parse(render.payload_json).photoAutomation,true);
  assert.equal(JSON.parse(render.payload_json).publish.autoPublish,false);
  assert.equal(response.batchId,JSON.parse(render.payload_json).psychologyAutomation.batchId);
});
test('video follow-up is deterministic and revoked permissions stop a queued publish',async t=>{
  const {call,env,db,sqlite}=await fixture(t);await call('POST',input());
  const job=sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id LIMIT 1').get();
  const result={results:[{fileName:'example.mp4'}]};
  await enqueueAutoVideoPublish(db,job,officialPublishFollowupPayload(job,result));
  await enqueueAutoVideoPublish(db,job,officialPublishFollowupPayload(job,result));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE type='official-publish'").get().n,1);
  const publish=sqlite.prepare("SELECT * FROM factory_jobs WHERE type='official-publish'").get();
  await assertAutoJobAccess(env,publish);
  sqlite.prepare("UPDATE factory_users SET active=0 WHERE username='admin'").run();
  await assert.rejects(assertAutoJobAccess(env,publish),e=>e.statusCode===403);
});
test('photo publishes only complete ordered images, refuses wrong worker and records stable receipt',async t=>{
  const {call,env,sqlite,requests}=await fixture(t);await call('POST',input({mediaType:'photo',template:'photo-original',count:2,musicIds:['7488400397962508280','7363314575675541521']}));
  const source=sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id LIMIT 1').get();
  sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({plan:{title:'Slow down',caption:'Listen to yourself'},results:[{template:'cover',title:'Listen'},{template:'content',title:'Notice',body:'Pause first'}]}),source.id);
  const {jobId}=await enqueueAutoPhotoRender(env,source.id);
  sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='worker-a' WHERE id=?").run(jobId);
  const request=(method,action,worker='worker-a',token='test-worker')=>new Request(BASE+'/api/worker/psychology-auto/'+jobId+'/'+action,{method,headers:{Authorization:'Bearer '+token,'x-factory-worker':worker},...(method==='POST'?{body:'{}'}:{})});
  const unauthorized=request('POST','publish','worker-a','wrong');
  assert.equal((await handleJobs(unauthorized,env,new URL(unauthorized.url),null)).status,401);
  const wrong=request('POST','publish','worker-b');
  await assert.rejects(handleAutoPhotoWorker(wrong,env,new URL(wrong.url)),e=>e.statusCode===409);
  const incomplete=request('POST','publish');
  await assert.rejects(handleAutoPhotoWorker(incomplete,env,new URL(incomplete.url)),/尚未全部上传/);
  assert.equal(requests.length,0);
  const assets=Object.fromEntries([0,1].map(i=>[i,{assetKey:'temporary--11111111-1111-1111-1111-11111111111'+i+'.jpg',fileName:i+'.jpg',fileSize:2000,contentType:'image/jpeg'}]));
  sqlite.prepare('UPDATE psychology_publish_items SET photo_assets_json=? WHERE id=?').run(JSON.stringify(assets),source.id);
  const req=request('POST','publish');
  const receipt=await (await handleAutoPhotoWorker(req,env,new URL(req.url))).json();
  assert.equal(receipt.batchId,'remote-batch');assert.equal(requests.length,1);
  assert.deepEqual(requests[0].items[0].photoAssetKeys,[assets[0].assetKey,assets[1].assetKey]);
  assert.equal(requests[0].items[0].scheduleAt,JSON.parse(source.payload_json).psychologyAutomation.scheduleAt*1000);
  // The song drawn at batch creation rides the payload into the middle platform and disables auto music.
  const drawn=JSON.parse(source.payload_json).psychologyAutomation.musicSoundId;
  assert.ok(['7488400397962508280','7363314575675541521'].includes(drawn));
  assert.equal(requests[0].items[0].postInfo.musicSoundId,drawn);
  assert.equal(requests[0].items[0].postInfo.autoAddMusic,false);
  const again=request('POST','publish');
  await handleAutoPhotoWorker(again,env,new URL(again.url));
  assert.equal(requests.length,1);
  const listing=await (await call()).json();assert.equal(listing.batches[0].items[0].status,'submitted');
});
test('photo batches keep original copy unless rewrite is explicitly enabled',async t=>{
  const {call,sqlite}=await fixture(t);
  const page=fs.readFileSync(new URL('../../public/psychology-auto-publish.html',import.meta.url),'utf8');
  const browser=fs.readFileSync(new URL('../../public/psychology-auto-publish.js',import.meta.url),'utf8');
  assert.match(page,/id="rewriteCopy"/);
  assert.doesNotMatch(page,/id="rewriteCopy"[^>]*checked/);
  assert.match(browser,/rewriteCopy:state\.mediaType==='photo'&&\$\('#rewriteCopy'\)\?\.checked===true/);
  await call('POST',input({mediaType:'photo',template:'photo-original',count:2}));
  const jobs=sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE type='psychology-photo-story'").all();
  assert.equal(jobs.length,2);
  assert.ok(jobs.every(row=>JSON.parse(row.payload_json).rewriteCopy===false));
  const rewrite=input({mediaType:'photo',template:'photo-original',count:2,rewriteCopy:true});
  await call('POST',rewrite);
  const all=sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE type='psychology-photo-story'").all().map(row=>JSON.parse(row.payload_json).rewriteCopy);
  assert.equal(all.filter(value=>value===false).length,2);
  assert.equal(all.filter(value=>value===true).length,2);
});
test('music pool is saved as reusable config and posts without a pool keep auto music',async t=>{
  const {call,sqlite}=await fixture(t);
  const page=fs.readFileSync(new URL('../../public/psychology-auto-publish.html',import.meta.url),'utf8');
  assert.match(page,/id="musicIds"/);
  await call('POST',input({mediaType:'photo',template:'photo-original',count:2}));
  const plain=sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE type='psychology-photo-story'").all();
  assert.ok(plain.every(row=>JSON.parse(row.payload_json).psychologyAutomation.musicSoundId===undefined));
  assert.deepEqual((await (await call('GET',undefined,'/api/psychology-auto-publish/options')).json()).musicPool,[]);
  await call('POST',input({mediaType:'photo',template:'photo-text',count:2,musicIds:['111','222','333']}));
  const pooled=sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE json_extract(payload_json,'$.psychologyAutomation.musicSoundId') IS NOT NULL").all();
  assert.equal(pooled.length,2);
  assert.ok(pooled.every(row=>['111','222','333'].includes(JSON.parse(row.payload_json).psychologyAutomation.musicSoundId)));
  assert.deepEqual((await (await call('GET',undefined,'/api/psychology-auto-publish/options')).json()).musicPool,['111','222','333']);
});
