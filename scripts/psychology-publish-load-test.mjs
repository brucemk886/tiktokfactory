// Isolated business-flow load test: no real AI, media uploads, or publishing.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { handlePsychologyAutoPublish, enqueueAutoPhotoRender } from '../factory-cloud/src/psychology-auto-publish.js';
import { handleAutoPhotoWorker } from '../factory-cloud/src/psychology-auto-photo.js';
import { clearPublishAccountDirectory } from '../factory-cloud/src/psychology-account-access.js';
import { handleJobs } from '../factory-cloud/src/jobs.js';
import { dispatchPublishGroup } from '../factory-cloud/src/psychology-publish-groups.js';
import { finishPsychologyPublishAttempt } from '../factory-cloud/src/psychology-publish-retries.js';
import { importPsychologyPeerHits } from '../factory-cloud/src/psychology-peer-hits-store.js';
import { kvSet } from '../factory-cloud/src/kv.js';
const user={id:'load-admin',username:'load-admin',role:'admin',sidebarModules:['psychology-publish']};
const accounts=Array.from({length:200},(_,i)=>({id:'account-'+i,username:'test'+i,scopes:['video.publish']}));
const realFetch=globalThis.fetch;
let active;
globalThis.fetch=async(url,init={})=>{
 const u=new URL(String(url));
 assert.equal(u.origin,'https://hub.invalid','Network blocked: only synthetic hub allowed');
 const f=active;
 if(u.pathname==='/api/v1/accounts'){f.count.accounts++;if(f.accountFailure)return Response.json({error:'synthetic directory outage'},{status:503});return Response.json({accounts});}
 if(u.pathname==='/api/v1/publish/assets'){f.count.uploads++;const a={assetKey:'temporary--'+crypto.randomUUID()+'.jpg',fileName:'fixture.jpg',fileSize:4,contentType:'image/jpeg'};f.assets.add(a.assetKey);return Response.json(a);}
 if(u.pathname==='/api/v1/publish/batches'){
  f.count.submissions++;const p=JSON.parse(init.body);if(f.remote.has(p.externalId))return Response.json(f.remote.get(p.externalId));
  if(p.items.some(i=>i.photoAssetKeys.some(k=>!f.assets.has(k))))return Response.json({error:'One or more photo assets are missing or expired.'},{status:400});
  const r={batch:{id:crypto.randomUUID(),tasks:p.items.map(i=>({id:crypto.randomUUID(),externalRef:i.externalRef,status:'queued'}))}};
  f.remote.set(p.externalId,r);if(f.loseResponse){f.loseResponse=false;throw new TypeError('synthetic response lost after commit');}return Response.json(r);
 }
 throw new Error('Unexpected synthetic endpoint '+u.pathname);
};
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 const dir=new URL('../factory-cloud/migrations/',import.meta.url);
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL(file,dir),'utf8'));
 const f={sqlite,count:{queries:0,accounts:0,uploads:0,submissions:0,maxBindings:0},assets:new Set(),remote:new Map(),instances:new Set()};active=f;
 const db={prepare(sql){return {args:[],bind(...args){f.count.maxBindings=Math.max(f.count.maxBindings,args.length);assert.ok(args.length<=100,'D1 binding limit');return {...this,args};},async first(){f.count.queries++;return sqlite.prepare(sql).get(...this.args)||null;},async all(){f.count.queries++;const before=sqlite.prepare('SELECT total_changes() n').get().n;const results=sqlite.prepare(sql).all(...this.args);return {results,meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};},async run(){f.count.queries++;return {meta:{changes:Number(sqlite.prepare(sql).run(...this.args).changes)}};}};},async batch(items){sqlite.exec('BEGIN');try{const rows=[];for(const i of items)rows.push(await i.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 sqlite.prepare('INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES (?,?,?,?,?,?,0,0)').run(user.id,user.username,'admin','','',JSON.stringify(user.sidebarModules));
 await kvSet(db,'official-account-groups',{projects:[{id:'p',name:'Psychology',moduleKey:'psychology'}],groups:[{id:'g',name:'Test',projectId:'p'}],assignments:Object.fromEntries(accounts.map(a=>[a.id,'g']))});
 const backups=new Map();
 const archive={async put(key,bytes,meta){backups.set(key,{bytes,meta});},async get(key){const o=backups.get(key);return o?{async arrayBuffer(){return o.bytes;}}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])backups.delete(key);}};
 const env={DB:db,SIGNAL_DESK_BASE_URL:'https://hub.invalid',SIGNAL_DESK_BRIDGE_KEY:'fake',WORKER_TOKEN:'fake',KIE_API_KEY:'fake',ARCHIVE:archive,PEER_PHOTO_WORKFLOW:{async get(id){if(!f.instances.has(id))throw Error('not found');return {async status(){return {status:'queued'};}};},async create({id}){f.instances.add(id);return {id};}}};
 for(let offset=0;offset<216;offset+=100)await importPsychologyPeerHits(db,Array.from({length:Math.min(100,216-offset)},(_,n)=>{const i=offset+n;return ({videoUrl:'https://www.tiktok.com/@synthetic/photo/'+(90000+i),title:'Synthetic idea '+i,playCount:1000+i});}),user.id);
 const call=async(method,body,path='/api/psychology-auto-publish')=>{const r=new Request('https://factory.invalid'+path,{method,...(body?{body:JSON.stringify(body)}:{})});return handlePsychologyAutoPublish(r,env,new URL(r.url),{user});};
 const worker=async(job,action,body)=>{const r=new Request('https://factory.invalid/api/worker/psychology-auto/'+job+'/'+action,{method:body?'POST':'GET',headers:{'x-factory-worker':'load-worker'},...(body?{body:JSON.stringify(body)}:{})});return handleAutoPhotoWorker(r,env,new URL(r.url));};
 const create=async(count=20,ids=accounts.slice(0,20).map(a=>a.id))=>call('POST',{requestId:crypto.randomUUID(),name:'Synthetic load',mediaType:'photo',template:'photo-original',count,connectionIds:ids,scheduleAt:Math.floor(Date.now()/1000)+7200,intervalMinutes:60,selection:'popular'});
 const prepare=async()=>{for(const source of sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-photo-story' AND status<>'done'").all()){
  sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({plan:{title:'Synthetic',caption:'Test'},results:Array.from({length:6},(_,i)=>({template:i?'content':'cover',title:'Synthetic page '+i,body:'Fixture copy'}))}),source.id);await enqueueAutoPhotoRender(env,source.id);
 }};
 const process=async(job)=>{
  // Actual claim access check is measured separately; this setup isolates upload/group handlers.
  sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='load-worker' WHERE id=?").run(job.id);
  await worker(job.id,'state');for(let i=0;i<6;i++)await worker(job.id,'upload',{index:i,dataUrl:'data:image/jpeg;base64,/9j/2Q=='});
  const r=await worker(job.id,'publish',{});sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id=?").run(job.id);return r.json();
 };
 return Object.assign(f,{db,env,call,worker,create,prepare,process,jobs:()=>sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology'").all()});
}
const result={scope:'In-memory real factory handlers; synthetic AI plans, 4-byte JPEG markers, mocked hub. No real network/AI/media throughput claims.',scenarios:{}};
try{
 let f; if(!process.argv.includes('--faults-only')){f=await fixture();const start=performance.now();
 await assert.rejects(f.create(600,accounts.map(a=>a.id)));result.scenarios.single600Request='rejected';
 for(let b=0;b<10;b++)assert.equal((await f.create(60,accounts.slice(b*20,b*20+20).map(a=>a.id))).status,202);
 await f.prepare();assert.equal(f.jobs().length,600);
 let processed=0;for(const job of f.jobs()){await f.process(job);if(++processed%100===0)console.error('Processed '+processed+'/600 synthetic posts');}
 const distribution=f.sqlite.prepare('SELECT connection_id,COUNT(*) n FROM psychology_publish_items GROUP BY connection_id').all();assert.equal(distribution.length,200);assert.ok(distribution.every(r=>r.n===3));
 assert.equal(f.remote.size,30);assert.equal(f.count.uploads,3600);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE receipt_json<>'{}'").get().n,600);
 const sources=f.sqlite.prepare("SELECT payload_json FROM factory_jobs WHERE type='psychology-photo-story'").all().map(r=>JSON.parse(r.payload_json).peerSource.id);
 const before=f.count.queries;const page=await (await f.call('GET')).text();
 result.scenarios.daily600={...f.count,accountDirectoryRequests:f.count.accounts,milliseconds:Math.round(performance.now()-start),accounts:200,posts:600,images:3600,remoteBatches:f.remote.size,uniqueSources:new Set(sources).size,listQueries:f.count.queries-before,listBytes:Buffer.byteLength(page)};f.sqlite.close();console.error('Daily 600 assertions passed: '+JSON.stringify(result.scenarios.daily600));}

 f=await fixture();await f.create();await f.prepare();const jobs=f.jobs();for(const job of jobs.slice(1))await f.process(job);
 f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(jobs[0].id);
 const group=f.sqlite.prepare('SELECT id FROM psychology_publish_groups').get().id;
 await dispatchPublishGroup(f.env,group);assert.equal(f.remote.size,1);
 assert.equal([...f.remote.values()][0].batch.tasks.length,19);
 result.scenarios.oneFailedMember={submittedHealthy:19,isolatedFailures:1,remoteBatches:1};f.sqlite.close();
 f=await fixture();await f.create();await f.prepare();const photos=f.jobs();
 for(const job of photos.slice(0,19))await f.process(job);f.assets.clear();
 await f.process(photos[19]);assert.equal(f.remote.size,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE type='psychology' AND status='queued'").get().n,19);
 // The real worker complete handler ignores a completion after recovery requeued it.
 // This harness's direct status write sets that last item done; process explicitly below.
 for(const job of photos)await f.process(job);
 assert.equal(f.remote.size,1);assert.equal(f.count.uploads,240);
 result.scenarios.expiredAssets={recoveryUploads:120,totalUploads:f.count.uploads,remoteBatches:f.remote.size,submittedPosts:20};f.sqlite.close();
 f=await fixture();await f.create();await f.prepare();f.loseResponse=true;for(const job of f.jobs().slice(0,19))await f.process(job);await assert.rejects(f.process(f.jobs()[19]),/response lost/);await dispatchPublishGroup(f.env,f.sqlite.prepare('SELECT id FROM psychology_publish_groups').get().id);assert.equal(f.remote.size,1);
 result.scenarios.lostResponse={submitCalls:f.count.submissions,uniqueRemoteBatches:f.remote.size};f.sqlite.close();
 f=await fixture();await f.create();await f.prepare();f.accountFailure=true;clearPublishAccountDirectory(f.db);
 const req=new Request('https://factory.invalid/api/worker/claim',{method:'POST',headers:{Authorization:'Bearer fake'},body:JSON.stringify({workerId:'load-worker',types:['psychology'],psychologyBatchUpload:true,psychologyPublishRetry:true})});
 const claim=await handleJobs(req,f.env,new URL(req.url),null);assert.equal(claim.status,200);
 const failed=f.sqlite.prepare("SELECT status,auto_retry_count,message FROM factory_jobs WHERE type='psychology' AND auto_retry_count=1").all();assert.equal(failed.length,1);assert.equal(failed[0].status,'queued');
 result.scenarios.accountDirectory503={delayedJobs:failed.length,...failed[0]};f.sqlite.close();
 console.log(JSON.stringify(result,null,2));
 const output=process.argv.slice(2).find(a=>!a.startsWith('--'));if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
}finally{globalThis.fetch=realFetch;}
