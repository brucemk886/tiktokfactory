import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {handlePhotoFactory,importCopy,getDirection,assertNoLegacyConflict,report} from './photo-factory.js';
import {directionConfig,copyContent,pilotConfig,periodRange,renderEntries,rewritePrompt,DAY,HOUR} from './photo-factory-domain.js';
import {planPhotoSlot,selectCopy,runPhotoFactoryWorkflow,remoteOutcome,tickPhotoFactory} from './photo-factory-execution.js';
import {kvSet} from './kv.js';
const actor={id:'admin',username:'admin',role:'admin',active:true,sidebarModules:['photo-factory','psychology-publish']};
const content=(n=0)=>({externalId:'copy-'+n,title:'A hook '+n,caption:'A caption',pages:['A concrete cover '+n,'A useful closing'],tags:[]});
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(actor.sidebarModules));
 f.api=async(path,method='GET',body,user=actor,token='')=>{const req=new Request('https://factory.test'+path,{method,headers:token?{authorization:'Bearer '+token}:{},...(body?{body:JSON.stringify(body)}:{})});try{return await handlePhotoFactory(req,f.env,new URL(req.url),user?{user}:null);}catch(e){return Response.json({error:e.message},{status:e.statusCode||500});}};
 f.dir=async(slug='zodiac',owner=actor)=>{const result=await f.api('/api/photo-factory/directions','POST',{name:slug,slug,config:directionConfig()},owner);assert.equal(result.status,201);return (await result.json()).id;};
 f.seed=async(id,n=1)=>{const direction=await getDirection(f.db,'admin',id);const copies=[];for(let i=0;i<n;i++)copies.push(await importCopy(f.db,'admin',direction,content(i)));return copies;};
 f.pilot=async(id,extra={})=>{const response=await f.api('/api/photo-factory/pilots?directionId='+id,'POST',{groupId:'g',times:['12:00','12:30'],days:7,...extra});assert.ok([200,201].includes(response.status),await response.clone().text());const pilotId=(await response.json()).id;return f.db.prepare('SELECT * FROM photo_pilots WHERE id=?').bind(pilotId).first();};
 f.start=async(id,p)=>{const r=await f.api('/api/photo-factory/pilot?directionId='+id,'PATCH',{id:p.id,status:'active'});assert.equal(r.status,200,await r.clone().text());return f.db.prepare('SELECT * FROM photo_pilots WHERE id=?').bind(p.id).first();};
 return f;
}
test('direction config and Beijing schedules enforce photo-only constraints',()=>{
 assert.equal(directionConfig().aspect,'9:16');assert.throws(()=>directionConfig({maxPages:8}));assert.throws(()=>directionConfig({styleIds:['unknown']}));
 assert.throws(()=>copyContent({...content(),pages:['x'.repeat(401)]},directionConfig()));
 assert.throws(()=>pilotConfig({times:['23:50','00:10']}));assert.throws(()=>pilotConfig({times:['12:00','12:00']}));
 const now=Date.parse('2026-09-26T00:15:00+08:00');assert.equal(periodRange('today',now).start,Date.parse('2026-09-26T00:00:00+08:00'));assert.equal(periodRange('7d',now).end-periodRange('7d',now).start,7*DAY);
 assert.match(rewritePrompt(directionConfig({audience:'zodiac readers',rewriteRules:'Use zodiac examples'}),content()),/zodiac readers/);
 assert.equal(renderEntries({copy:content(),styleId:'classic',config:{aspect:'9:16'}})[0].aspectRatio,'9:16');
});
test('new routes deny operators and missing grants, direction reads create no legacy data',async t=>{
 const f=await setup(t),before=f.sqlite.prepare('SELECT count(*) n FROM psychology_copy_library').get().n;
 assert.equal((await f.api('/api/photo-factory/directions','GET',null,{...actor,role:'operator'})).status,403);
 assert.equal((await f.api('/api/photo-factory/directions','GET',null,{...actor,sidebarModules:[]})).status,403);
 const d=await f.dir();assert.equal((await f.api('/api/photo-factory/directions')).status,200);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_copy_library').get().n,before);assert.equal(f.requests.length,0);
 assert.equal((await f.api('/api/photo-factory/copies?directionId='+d,'GET',null,{...actor,username:'other'})).status,404);
});
test('originals and rewrites are direction scoped, idempotent, and cannot change an existing source',async t=>{
 const f=await setup(t),a=await f.dir(),b=await f.dir('mbti'),[source]=await f.seed(a);
 const da=await getDirection(f.db,'admin',a),db=await getDirection(f.db,'admin',b);
 assert.equal((await importCopy(f.db,'admin',da,content())).duplicate,true);
 await assert.rejects(importCopy(f.db,'admin',da,{...content(),title:'different'}),/不同内容/);
 await assert.rejects(importCopy(f.db,'admin',db,{...content(),kind:'rewrite',sourceId:source.id}),/当前方向/);
 const rw=await importCopy(f.db,'admin',da,{...content(2),kind:'rewrite',sourceId:source.id,enabled:false});
 const rows=await (await f.api('/api/photo-factory/copies?directionId='+a)).json();assert.equal(rows.total,2);assert.equal(rows.items.find(c=>c.id===rw.id).enabled,0);
 assert.equal((await (await f.api('/api/photo-factory/copies?directionId='+b)).json()).total,0);
});
test('import keys bind one direction and cannot control pilots; revocation and rotation invalidate access',async t=>{
 const f=await setup(t),a=await f.dir(),b=await f.dir('emotion');
 const key=await (await f.api('/api/photo-factory/key?directionId='+a,'POST',{})).json();
 let r=await f.api('/api/integrations/photo-factory/copies?directionId='+b,'POST',{items:[content()]},null,key.key);assert.equal((await r.json()).results[0].ok,true);
 assert.equal(f.sqlite.prepare('SELECT direction_id FROM photo_copies').get().direction_id,a);
 assert.equal((await f.api('/api/photo-factory/pilots?directionId='+a,'POST',{},null,key.key)).status,403);
 const next=await (await f.api('/api/photo-factory/key?directionId='+a,'POST',{})).json();assert.notEqual(next.key,key.key);
 assert.equal((await f.api('/api/integrations/photo-factory/copies','GET',null,null,key.key)).status,401);
 await f.api('/api/photo-factory/key?directionId='+a,'DELETE');assert.equal((await f.api('/api/integrations/photo-factory/copies','GET',null,null,next.key)).status,401);
});
test('direction revision protects edits and disabled directions reject new imports',async t=>{
 const f=await setup(t),id=await f.dir();assert.equal((await f.api('/api/photo-factory/direction?directionId='+id,'PATCH',{revision:1,name:'new',enabled:false})).status,200);
 assert.equal((await f.api('/api/photo-factory/direction?directionId='+id,'PATCH',{revision:1,name:'stale'})).status,409);
 assert.equal((await f.api('/api/photo-factory/copies?directionId='+id,'POST',content())).status,409);
});
test('new tests start as drafts and cannot occupy a legacy active group or account',async t=>{
 const f=await setup(t),id=await f.dir(),p=await f.pilot(id);assert.equal(p.status,'draft');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_jobs').get().n,0);
 f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES('old','admin','g','original','[]','active',?,0,0)").run(Date.now()+DAY);
 assert.equal((await f.api('/api/photo-factory/pilot?directionId='+id,'PATCH',{id:p.id,status:'active'})).status,409);
 await assert.rejects(assertNoLegacyConflict(f.db,'g',['a']),/现有心理学/);
 assert.equal(f.sqlite.prepare("SELECT status FROM psychology_autopilots WHERE id='old'").get().status,'active');
});
test('slot allocation is atomic, source-account deduplicated, snapshots immutable and old tables untouched',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,5);const p=await f.start(id,await f.pilot(id)),d=await getDirection(f.db,'admin',id),slot=Date.now()+HOUR;
 const legacy=f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n;
 assert.equal((await planPhotoSlot(f.env,p,d,slot)).count,2);assert.equal((await planPhotoSlot(f.env,p,d,slot)).duplicate,true);
 await planPhotoSlot(f.env,p,d,slot+HOUR);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_jobs').get().n,4);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,legacy);assert.equal(f.requests.length,0);
 const snap=f.sqlite.prepare('SELECT snapshot_json FROM photo_jobs LIMIT 1').get().snapshot_json;
 await f.api('/api/photo-factory/direction?directionId='+id,'PATCH',{revision:1,config:{...d.config,aspect:'3:4'}});
 assert.equal(f.sqlite.prepare('SELECT snapshot_json FROM photo_jobs LIMIT 1').get().snapshot_json,snap);
});
test('insufficient originals creates no partial slot and disabled rewrites are never drawn',async t=>{
 const f=await setup(t),id=await f.dir();const [source]=await f.seed(id);const p=await f.start(id,await f.pilot(id,{strategy:'rewrite'})),d=await getDirection(f.db,'admin',id);
 await importCopy(f.db,'admin',d,{...content(2),kind:'rewrite',sourceId:source.id,enabled:false});
 await assert.rejects(planPhotoSlot(f.env,p,d,Date.now()+HOUR),/文案不足/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_jobs').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_slots').get().n,0);
});
test('new pilots sharing accounts cannot both run; pause stops only not-yet-submitted jobs',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,4);const p=await f.start(id,await f.pilot(id)),other=await f.pilot(id);
 assert.equal((await f.api('/api/photo-factory/pilot?directionId='+id,'PATCH',{id:other.id,status:'active'})).status,409);
 await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 const jobs=f.sqlite.prepare('SELECT id FROM photo_jobs ORDER BY id').all();f.sqlite.prepare("UPDATE photo_jobs SET state='submitting',request_json='{}' WHERE id=?").run(jobs[0].id);
 await f.api('/api/photo-factory/pilot?directionId='+id,'PATCH',{id:p.id,status:'paused'});
 assert.equal(f.sqlite.prepare('SELECT state FROM photo_jobs WHERE id=?').get(jobs[0].id).state,'submitting');assert.equal(f.sqlite.prepare('SELECT state FROM photo_jobs WHERE id=?').get(jobs[1].id).state,'stopped');
});
test('report uses exact own post identities, real zero, actual publication time and SQL pagination',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,4);const p=await f.start(id,await f.pilot(id));await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 const job=f.sqlite.prepare('SELECT * FROM photo_jobs LIMIT 1').get();f.sqlite.prepare("UPDATE photo_jobs SET video_id='v1',state='published' WHERE id=?").run(job.id);
 const now=Date.now();f.sqlite.prepare('INSERT INTO ops_video_facts(account_key,video_id,published_at,synced_at,views) VALUES(?,?,?,?,?)').run('tiktok:'+job.connection_id,'v1',now,now,0);
 f.sqlite.prepare('INSERT INTO ops_video_facts(account_key,video_id,published_at,synced_at,views) VALUES(?,?,?,?,?)').run('tiktok:foreign','v1',now,now,999999);
 const data=await report(f.db,'admin',{id},new URLSearchParams({period:'today'}));assert.equal(data.effects.samples,1);assert.equal(data.effects.views,0);assert.equal(data.total,2);
 const copies=await (await f.api('/api/photo-factory/copies?directionId='+id+'&sort=views')).json();assert.equal(copies.items[0].highest_views,0);assert.equal(f.requests.length,0);
});
test('workflow replay uses one frozen external ID and marks only submitted, not published',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,3);const p=await f.start(id,await f.pilot(id));await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 const job=f.sqlite.prepare('SELECT * FROM photo_jobs LIMIT 1').get();f.sqlite.prepare("UPDATE photo_jobs SET state='dispatching' WHERE id=?").run(job.id);
 const store=new Map();f.env.ARCHIVE={async head(k){return store.has(k)?{}:null;},async put(k,v){store.set(k,v);},async get(k){const v=store.get(k);return v?{arrayBuffer:async()=>v.buffer}:null;}};
 f.env.ASSETS={fetch:async()=>new Response('export {};')};
 const cache=new Map(),step={async do(name,...args){if(cache.has(name))return cache.get(name);const result=await args.at(-1)();cache.set(name,result);return result;}};
 const submissions=[];let first=true;
 const deps={openRenderer:async()=>({renderBatch:async entries=>entries.map(()=> 'data:image/jpeg;base64,/9j/2Q=='),close:async()=>{}}),upload:async()=>({assetKey:crypto.randomUUID()+'.jpg',fileSize:4,contentType:'image/jpeg'}),submit:async(_env,_db,_url,{body})=>{submissions.push(body);if(first){first=false;throw new Error('uncertain network');}return {batch:{id:'remote',tasks:[{id:'task',externalRef:job.id}]}};}};
 await assert.rejects(runPhotoFactoryWorkflow(f.env,{payload:{jobId:job.id}},step,deps),/uncertain/);
 assert.equal(f.sqlite.prepare('SELECT state FROM photo_jobs WHERE id=?').get(job.id).state,'submitting');
 await runPhotoFactoryWorkflow(f.env,{payload:{jobId:job.id}},step,deps);
 assert.deepEqual(submissions[0],submissions[1]);assert.equal(submissions[0].externalId,'photo-factory-'+job.id);
 assert.equal(f.sqlite.prepare('SELECT state FROM photo_jobs WHERE id=?').get(job.id).state,'submitted');
});
test('paused job performs no paid rendering, uploads or publication',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id);const p=await f.start(id,await f.pilot(id));await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 await f.api('/api/photo-factory/pilot?directionId='+id,'PATCH',{id:p.id,status:'paused'});const job=f.sqlite.prepare('SELECT id FROM photo_jobs LIMIT 1').get();
 const result=await runPhotoFactoryWorkflow(f.env,{payload:{jobId:job.id}},{do:async(_n,...args)=>args.at(-1)()},{openRenderer:()=>{throw Error('must not render');}});assert.equal(result.skipped,true);assert.equal(f.requests.length,0);
});
test('dispatcher is inert without workflow binding and published-without-id remains distinct',async t=>{
 const f=await setup(t);assert.deepEqual(await tickPhotoFactory(f.env),{disabled:true});
 assert.deepEqual(remoteOutcome({status:'published'}),{state:'published',videoId:'',publishedAt:0,error:''});assert.equal(remoteOutcome({status:'processing'}).state,'submitted');
});
test('dispatcher caps new rendering at two, cannot plan drafts, and never dispatches old jobs',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,6);
 const p=await f.start(id,await f.pilot(id));await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 const instances=new Set();f.env.PHOTO_FACTORY_WORKFLOW={async create({id}){instances.add(id);return {id};},async get(id){if(!instances.has(id))throw Error('not found');return {status:async()=>({status:'queued'})};}};
 await tickPhotoFactory(f.env);assert.equal(instances.size,2);assert.ok([...instances].every(i=>i.startsWith('photo-')));
 await tickPhotoFactory(f.env,Date.now()+1000);assert.equal(instances.size,2);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});
test('provisional sample caps select other copies instead of failing a larger group',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,3);const p=await f.start(id,await f.pilot(id));
 const accounts=Array.from({length:7},(_,i)=>({id:'test-'+i,username:'test-'+i}));f.sqlite.prepare('UPDATE photo_pilots SET accounts_json=? WHERE id=?').run(JSON.stringify(accounts),p.id);p.accounts_json=JSON.stringify(accounts);
 await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_jobs').get().n,7);
 assert.ok(f.sqlite.prepare('SELECT count(*) n FROM photo_jobs GROUP BY copy_id').all().every(r=>r.n<=3));
});
test('draft creation request ID is idempotent and cross-origin session writes are rejected',async t=>{
 const f=await setup(t),id=await f.dir(),requestId=crypto.randomUUID(),p=await f.pilot(id,{requestId}),same=await f.pilot(id,{requestId});assert.equal(p.id,same.id);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_pilots').get().n,1);
 const request=new Request('https://factory.test/api/photo-factory/directions',{method:'POST',headers:{origin:'https://other.test'},body:'{}'});
 await assert.rejects(handlePhotoFactory(request,f.env,new URL(request.url),{user:actor}),/跨站/);
});
test('legacy renderer keeps 3:4 while new jobs opt into 9:16',async t=>{
 const {renderAutomationCard}=await import('../../public/psychology-card-runtime.js');const aspects=[];
 const previous=globalThis.window;t.after(()=>{globalThis.window=previous;});
 globalThis.window={cards:{buildTextCardSlides:()=>[{}]},renderer:{renderTextCard:(_s,aspect)=>{aspects.push(aspect);return {toDataURL:()=>''};}}};
 await renderAutomationCard({source:{title:'legacy'},index:0,template:'photo-text'});
 await renderAutomationCard({source:{title:'new'},index:0,template:'photo-text',aspectRatio:'9:16'});
 assert.deepEqual(aspects,['3:4','9:16']);
});
test('photo handler never intercepts legacy uploads, even large or cross-origin requests',async t=>{
 const f=await setup(t);const req=new Request('https://factory.test/api/worker/upload',{method:'POST',headers:{origin:'https://elsewhere.test','content-length':'50000000'},body:'x'});
 assert.equal(await handlePhotoFactory(req,f.env,new URL(req.url),{user:actor}),null);
});
test('group effects include today posts even if their planned date was yesterday',async t=>{
 const f=await setup(t),id=await f.dir();await f.seed(id,3);const p=await f.start(id,await f.pilot(id));await planPhotoSlot(f.env,p,await getDirection(f.db,'admin',id),Date.now()+HOUR);
 const job=f.sqlite.prepare('SELECT * FROM photo_jobs LIMIT 1').get(),now=Date.now();f.sqlite.prepare("UPDATE photo_jobs SET schedule_at=?,video_id='late',state='published' WHERE id=?").run(periodRange('today').start-1000,job.id);
 f.sqlite.prepare('INSERT INTO ops_video_facts(account_key,video_id,published_at,synced_at,views) VALUES(?,?,?,?,?)').run('tiktok:'+job.connection_id,'late',now,now,1234);
 const data=await report(f.db,'admin',{id},new URLSearchParams({period:'today'}));assert.equal(data.effects.samples,1);assert.equal(data.groups[0].samples,1);assert.equal(data.groups[0].highest,1234);
});
