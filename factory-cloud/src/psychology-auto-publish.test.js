import { summarizeOfficialPublishRecords, collectOfficialLiveBatchIds } from '../../scripts/official-publish-records.js';
import { stagePublishItem, dispatchPublishGroup, handleAutoVideoStage } from './psychology-publish-groups.js';
import { claimTypeFilter } from './jobs.js';
import { handlePsychologyTopicBank, topicCounts, selectTopicSources, topicUsageStatement } from './psychology-topic-bank.js';
import { normalizeTopic } from '../../scripts/psychology-topic-bank.js';
import { parseTopicImport } from '../../public/psychology-topic-import.js';
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
  const db={prepare(sql){return {args:[],bind(...args){return {...this,args};},
    async first(){return sqlite.prepare(sql).get(...this.args)||null;},
    async all(){const before=sqlite.prepare('SELECT total_changes() n').get().n;const results=sqlite.prepare(sql).all(...this.args);return {results,meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};},
    async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...this.args).changes)}};}};},
    async batch(items){sqlite.exec('BEGIN');try{const rows=[];for(const item of items)rows.push(await item.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES ('admin','admin','admin','','',?,0,0)").run(JSON.stringify(user.sidebarModules));
  await kvSet(db,'official-account-groups',{projects:[{id:'proj-psych',name:'心理学',moduleKey:'psychology'},{id:'proj-novel',name:'小说推文',moduleKey:'novel-promotion'}],
    groups:[{id:'g',name:'心理学账号',projectId:'proj-psych'},{id:'other',name:'小说',projectId:'proj-novel'}],assignments:{a:'g',b:'g',outside:'other'}});
  const requests=[],instances=new Map();
  t.mock.method(globalThis,'fetch',async (url,init={})=>{
    const address=String(url);
    if(address.includes('/api/v1/accounts')) return Response.json({accounts:[{id:'a',username:'alpha',scopes:['video.publish']},{id:'b',scopes:['video.publish']},{id:'outside',scopes:['video.publish']},{id:'read-only',scopes:['user.info.basic']}]});
    if(address.endsWith('/api/v1/publish/batches')) { requests.push(JSON.parse(init.body)); const request=JSON.parse(init.body),batchId=request.externalId.includes('-group-')?'remote-'+request.externalId:'remote-batch';return Response.json({batch:{id:batchId,tasks:request.items.map((item,index)=>({id:batchId+'-task-'+index,externalRef:item.externalRef}))}}); }
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
  for(const changes of [{mediaType:'toString'},{mediaType:'photo'},{count:0},{count:2.2},{count:101},{count:1},{connectionIds:[]},{scheduleAt:1},{intervalMinutes:0},{selection:'sql;drop'}])
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
test('legacy photo publishes only complete ordered images, refuses wrong worker and records stable receipt',async t=>{
  const {call,env,sqlite,requests}=await fixture(t);await call('POST',input({mediaType:'photo',template:'photo-original',count:2,musicIds:['7488400397962508280','7363314575675541521']}));
  sqlite.prepare("UPDATE psychology_publish_items SET publish_group_id=''").run();
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
  assert.match(page,/task-list-panel/);
  assert.match(page,/id="queuedCount"/);
  assert.match(browser,/class="auto-task-item"/);
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
  // Rewrite/music live in a collapsible panel that starts hidden and collapsed.
  assert.match(page,/<details[^>]*id="photoOptions"[^>]*hidden>/);
  assert.doesNotMatch(page,/<details[^>]*id="photoOptions"[^>]*open/);
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

test('topic bank permissions, template isolation, validation, deduplication and import replay',async t=>{
  const {env,db,sqlite}=await fixture(t),actor={...user,sidebarModules:[...user.sidebarModules,'psychology-topic-bank']};
  const call=async(method,body,path='/api/psychology-template-topics',who=actor)=>{
    const req=new Request(BASE+path,{method,...(body?{body:JSON.stringify(body)}:{})});
    return handlePsychologyTopicBank(req,env,new URL(req.url),{user:who});
  };
  assert.equal((await call('GET',null,undefined,user)).status,403);
  const body={requestId:crypto.randomUUID(),template:'psychology',items:[{title:'Question',content:'Answer',priority:80},{title:'Question',content:'Answer',priority:70}]};
  const result=await(await call('POST',body,'/api/psychology-template-topics/import')).json();
  assert.deepEqual(result,{received:2,created:1,skipped:1});
  assert.equal((await(await call('POST',body,'/api/psychology-template-topics/import')).json()).duplicate,true);
  assert.equal((await call('POST',{...body,items:[{title:'Changed'}]},'/api/psychology-template-topics/import')).status,409);
  const bad={...body,requestId:crypto.randomUUID(),items:[{title:'Valid'},{title:''}]};
  assert.equal((await call('POST',bad,'/api/psychology-template-topics/import')).status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
  for(const template of ['psychology-collage','psychology-target-2'])assert.equal((await call('POST',{...body,template,requestId:crypto.randomUUID()},'/api/psychology-template-topics/import')).status,201);
  const page=await(await call('GET')).json();assert.equal(page.total,1);assert.equal(page.counts['psychology-collage'].total,1);
  const topic=page.items[0];
  assert.equal((await call('PATCH',{title:'Edited',revision:topic.revision},'/api/psychology-template-topics/'+topic.id)).status,200);
  assert.equal((await call('DELETE',{revision:topic.revision},'/api/psychology-template-topics/'+topic.id)).status,409);
  assert.equal((await call('DELETE',{revision:topic.revision+1},'/api/psychology-template-topics/'+topic.id)).status,200);
  assert.equal((await(await call('GET')).json()).total,0);
  assert.equal((await topicCounts(db))['psychology-collage'].total,1);
});
async function seedBank(env,template,items){
  const req=new Request(BASE+'/api/psychology-template-topics/import',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),template,items})});
  const r=await handlePsychologyTopicBank(req,env,new URL(req.url),{user:{...user,sidebarModules:[...user.sidebarModules,'psychology-topic-bank']}});
  assert.equal(r.status,201);
}
test('template batches draw exact template, freeze content, count once and refuse shortages',async t=>{
  const{env,sqlite,call}=await fixture(t),actor={...user,sidebarModules:[...user.sidebarModules,'psychology-topic-bank']};
  await seedBank(env,'psychology',[{title:'Low',priority:10},{title:'High',content:'Interpretation',priority:90},{title:'Disabled',enabled:false}]);
  await seedBank(env,'psychology-collage',[{title:'Other',priority:100}]);
  const body=input({count:2,sourceType:'topic-bank',selection:'priority'});
  await assert.rejects(call('POST',body,undefined,user),e=>e.statusCode===403);
  assert.equal((await call('POST',body,undefined,actor)).status,202);
  assert.equal((await call('POST',body,undefined,actor)).status,200);
  const jobs=sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all();
  assert.deepEqual(jobs.map(j=>j.title),['High','Low']);
  const payload=JSON.parse(jobs[0].payload_json);assert.equal(payload.script,'Interpretation');assert.equal(payload.answerGuide,'Interpretation');
  assert.equal(payload.peerSource,undefined);assert.equal(payload.topicSource.template,'psychology');
  assert.equal(sqlite.prepare('SELECT SUM(usage_count) n FROM psychology_template_topics').get().n,2);
  await assert.rejects(call('POST',{...body,requestId:crypto.randomUUID()},undefined,actor),/只有 0/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,2);
  sqlite.prepare("UPDATE psychology_template_topics SET title='Edited',content='Different' WHERE id=?").run(payload.topicSource.id);
  assert.equal(JSON.parse(sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(jobs[0].id).payload_json).topicSource.title,'High');
  assert.equal((await call('POST',{...body,onlyUnused:false,requestId:crypto.randomUUID(),selection:'least-used'},undefined,actor)).status,202);
});
test('topic rules exclude disabled/deleted sources and support category search',async t=>{
  const{env,db,sqlite}=await fixture(t);
  await seedBank(env,'psychology-target-2',[{title:'Old',category:'Relationship',priority:99},{title:'New',priority:1},{title:'Off',enabled:false}]);
  sqlite.prepare("UPDATE psychology_template_topics SET created_at=100,usage_count=3,last_used_at=200 WHERE title='Old'").run();
  sqlite.prepare("UPDATE psychology_template_topics SET created_at=300 WHERE title='New'").run();
  const config={template:'psychology-target-2',query:'',count:10,onlyUnused:false,selection:'recent'};
  assert.deepEqual((await selectTopicSources(db,config)).map(t=>t.title),['New','Old']);
  assert.deepEqual((await selectTopicSources(db,{...config,selection:'priority'})).map(t=>t.title),['Old','New']);
  assert.deepEqual((await selectTopicSources(db,{...config,selection:'least-used'})).map(t=>t.title),['New','Old']);
  assert.deepEqual((await selectTopicSources(db,{...config,query:'Relationship'})).map(t=>t.title),['Old']);
  assert.equal((await selectTopicSources(db,{...config,onlyUnused:true})).length,1);
  sqlite.prepare("UPDATE psychology_template_topics SET deleted_at=1 WHERE title='New'").run();
  assert.equal((await selectTopicSources(db,{...config,onlyUnused:true})).length,0);
});
test('concurrent unused draws and stale topic revisions roll back the complete batch',async t=>{
  const{env,db,sqlite}=await fixture(t);
  await seedBank(env,'psychology',[{title:'One'},{title:'Two'}]);
  const config={template:'psychology',query:'',count:2,onlyUnused:true,selection:'priority'};
  const topics=await selectTopicSources(db,config);
  await db.batch([topicUsageStatement(db,topics[1],'winner','winner-item',config,1)]);
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES ('loser','admin','{}',0)"),
    topicUsageStatement(db,topics[0],'loser','loser-0',config,2),
    topicUsageStatement(db,topics[1],'loser','loser-1',config,2),
  ]),/TOPIC_ALREADY_USED/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_batches WHERE id='loser'").get().n,0);
  assert.equal(sqlite.prepare('SELECT usage_count FROM psychology_template_topics WHERE id=?').get(topics[0].id).usage_count,0);
  sqlite.prepare('UPDATE psychology_template_topics SET revision=revision+1 WHERE id=?').run(topics[0].id);
  await assert.rejects(db.batch([topicUsageStatement(db,topics[0],'stale','stale-0',config,2)]),/TOPIC_CHANGED/);
});
test('legacy batch configs remain replayable without topic or music fields',async t=>{
  const{call,sqlite}=await fixture(t),body=input();await call('POST',body);
  const row=sqlite.prepare('SELECT * FROM psychology_publish_batches').get(),old=JSON.parse(row.config_json);
  delete old.sourceType;delete old.onlyUnused;delete old.musicIds;
  sqlite.prepare('UPDATE psychology_publish_batches SET config_json=? WHERE id=?').run(JSON.stringify(old),row.id);
  assert.equal((await call('POST',body)).status,200);
});
test('CSV/JSON import preserves quoted multiline text and rejects malformed input',()=>{
  assert.deepEqual(parseTopicImport('\uFEFF题目,内容,分类,优先级,启用\r\n"题,目","第一行\n第二行 ""引用""",关系,,是'),[{title:'题,目',content:'第一行\n第二行 "引用"',category:'关系',priority:'',enabled:'是'}]);
  assert.equal(normalizeTopic(parseTopicImport('题目,优先级\n问题,')[0],'psychology').priority,50);
  assert.equal(parseTopicImport('[{"title":"Test"}]')[0].title,'Test');
  for(const text of ['','{}','题目\n"unclosed','题目,题目\na,b','题目,内容\nx','未知\nx'])assert.throws(()=>parseTopicImport(text));
  assert.throws(()=>normalizeTopic({title:'Test',template:'psychology-collage'},'psychology'));
  assert.throws(()=>normalizeAutoPublish(input({sourceType:'topic-bank',selection:'popular'})));
  assert.throws(()=>normalizeAutoPublish(input({sourceType:'topic-bank',mediaType:'photo',template:'photo-text'})));
});

const groupedUser={...user,sidebarModules:[...user.sidebarModules,'psychology-topic-bank']};
async function groupedFixture(t,count){
  const f=await fixture(t);
  await seedBank(f.env,'psychology',Array.from({length:count},(_,i)=>({title:'Group topic '+i})));
  await f.call('POST',input({count,sourceType:'topic-bank',selection:'priority'}),undefined,groupedUser);
  f.items=()=>f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all();
  return f;
}
function readyVideo(item){return{mediaType:'video',title:item.id,item:{assetKey:'temporary--'+crypto.randomUUID()+'.mp4',fileName:item.id+'.mp4',contentType:'video/mp4',fileSize:1000,postInfo:{caption:item.id}}};}
test('100 items create five fixed groups; account and schedule remain attached to each item',async t=>{
  const f=await groupedFixture(t,100),groups=f.sqlite.prepare('SELECT * FROM psychology_publish_groups ORDER BY ordinal').all();
  assert.equal(groups.length,5);assert.ok(groups.every(g=>g.expected_count===20));
  assert.equal(f.items().length,100);assert.equal(f.requests.length,0);
  const jobs=f.sqlite.prepare('SELECT payload_json FROM factory_jobs').all().map(r=>JSON.parse(r.payload_json));
  assert.ok(jobs.every(p=>p.psychologyAutomation.submissionMode==='grouped'));
  const old=claimTypeFilter({workerId:'w'}),updated=claimTypeFilter({workerId:'w',psychologyBatchUpload:true});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE status='queued'"+old.sql).get(...old.binds).n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE status='queued'"+updated.sql).get(...updated.binds).n,100);
});
test('50 videos submit as 20 + 20 + 10, independent groups, one receipt per item and no duplicate submit',async t=>{
  const f=await groupedFixture(t,50),items=f.items();
  for(const item of items.slice(0,19))await stagePublishItem(f.env,item,readyVideo(item));
  for(const item of items.slice(20,39))await stagePublishItem(f.env,item,readyVideo(item));
  assert.equal(f.requests.length,0);
  // Another group's failed/unfinished member never blocks a complete group.
  for(const item of items.slice(40))await stagePublishItem(f.env,item,readyVideo(item));
  assert.deepEqual(f.requests.map(r=>r.items.length),[10]);
  await stagePublishItem(f.env,items[19],readyVideo(items[19]));
  await stagePublishItem(f.env,items[39],readyVideo(items[39]));
  assert.deepEqual(f.requests.map(r=>r.items.length),[10,20,20]);
  assert.equal(new Set(f.requests.map(r=>r.externalId)).size,3);
  assert.equal(new Set(f.requests.flatMap(r=>r.items.map(i=>i.externalRef))).size,50);
  for(const request of f.requests)for(const item of request.items){
    const original=items.find(i=>i.id===item.externalRef);
    assert.equal(item.connectionId,original.connection_id);assert.equal(item.scheduleAt,original.schedule_at*1000);
  }
  await dispatchPublishGroup(f.env,items[0].publish_group_id);
  await stagePublishItem(f.env,items[0],readyVideo(items[0]));
  assert.equal(f.requests.length,3);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_publish_records').get().n,50);
  const records=f.sqlite.prepare('SELECT value_json FROM factory_publish_records').all().map(r=>JSON.parse(r.value_json));
  assert.equal(summarizeOfficialPublishRecords(records,{range:'all'}).summary.batchCount,3);
  assert.equal(collectOfficialLiveBatchIds([{...records[0],batchId:'11111111-1111-4111-8111-111111111111',officialBatchIds:['22222222-2222-4222-8222-222222222222']}]).length,1);
  const listing=await(await f.call()).json();assert.equal(listing.batches[0].groups.length,3);
  assert.ok(listing.batches[0].items.every(i=>i.status==='submitted'));
});
test('group submission retries a lost response with identical frozen body and preserves uploaded assets',async t=>{
  const f=await groupedFixture(t,3),items=f.items(),bodies=[];
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url).endsWith('/api/v1/publish/batches')){
      bodies.push(init.body);
      if(bodies.length===1)throw new Error('lost response after remote accepted');
    }
    return originalFetch(url,init);
  });
  await stagePublishItem(f.env,items[0],readyVideo(items[0]));
  await stagePublishItem(f.env,items[1],readyVideo(items[1]));
  await assert.rejects(stagePublishItem(f.env,items[2],readyVideo(items[2])),/lost response/);
  assert.equal(f.sqlite.prepare('SELECT status FROM psychology_publish_groups').get().status,'failed');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_items WHERE ready_json<>'{}'").get().n,3);
  const retryPath='/api/psychology-auto-publish/groups/'+items[0].publish_group_id+'/retry';
  await assert.rejects(f.call('POST',{},retryPath,{...user,username:'other'}),e=>e.statusCode===404);
  await f.call('POST',{},retryPath);
  await dispatchPublishGroup(f.env,items[0].publish_group_id);
  assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
  await f.call('POST',{},retryPath);assert.equal(bodies.length,2);
});
test('group lease excludes concurrent submit and cached remote receipt recovers local write failure',async t=>{
  const f=await groupedFixture(t,2),items=f.items();
  for(const item of items)f.sqlite.prepare('UPDATE psychology_publish_items SET ready_json=? WHERE id=?').run(JSON.stringify(readyVideo(item)),item.id);
  f.sqlite.prepare("UPDATE psychology_publish_groups SET status='submitting',updated_at=?").run(Date.now());
  await dispatchPublishGroup(f.env,items[0].publish_group_id);assert.equal(f.requests.length,0);
  f.sqlite.prepare("UPDATE psychology_publish_groups SET updated_at=0").run();
  const originalBatch=f.db.batch;let failOnce=true;
  f.db.batch=async statements=>{
    if(failOnce){failOnce=false;throw new Error('record write outage');}
    return originalBatch(statements);
  };
  await assert.rejects(dispatchPublishGroup(f.env,items[0].publish_group_id),/outage/);
  assert.equal(f.requests.length,1);
  await dispatchPublishGroup(f.env,items[0].publish_group_id);
  assert.equal(f.requests.length,1);assert.equal(f.sqlite.prepare('SELECT status FROM psychology_publish_groups').get().status,'submitted');
});
test('video readiness validates worker ownership; done uploads are not counted as submitted',async t=>{
  const f=await groupedFixture(t,2),item=f.items()[0],job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(item.job_id);
  await enqueueAutoVideoPublish(f.db,job,officialPublishFollowupPayload(job,{results:[{fileName:'one.mp4'}]}));
  const publishId=item.id+'-publish';f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(publishId);
  const call=async(worker,body)=>{const req=new Request(BASE+'/api/worker/psychology-video/'+publishId+'/ready',{method:'POST',headers:{'x-factory-worker':worker},body:JSON.stringify(body)});return handleAutoVideoStage(req,f.env,new URL(req.url));};
  await assert.rejects(call('wrong',{asset:{}}),e=>e.statusCode===409);
  await assert.rejects(call('w',{asset:{}}),/素材无效/);
  const staged=await(await call('w',{asset:{assetKey:'temporary--'+crypto.randomUUID()+'.mp4',contentType:'video/mp4',fileSize:123}})).json();
  assert.equal(staged.waiting,true);assert.equal(f.requests.length,0);
  f.sqlite.prepare("UPDATE factory_jobs SET status='done' WHERE id=?").run(publishId);
  const listing=await(await f.call()).json();assert.equal(listing.batches[0].items[0].status,'ready');
  f.sqlite.prepare("UPDATE factory_users SET active=0").run();
  const second=f.items()[1];await assert.rejects(stagePublishItem(f.env,second,readyVideo(second)),e=>e.statusCode===403);
  assert.equal(f.requests.length,0);
});
test('three complete photo posts submit one remote batch with music, cover and schedule intact',async t=>{
  const f=await fixture(t);await f.call('POST',input({count:3,mediaType:'photo',template:'photo-text',musicIds:['12345']}));
  const jobs=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE type='psychology-photo-story' ORDER BY id").all();
  for(const [index,source]of jobs.entries()){
    f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify({plan:{title:'Post '+index,caption:'Copy '+index},results:[{template:'cover',title:'Cover'},{template:'content',title:'Content'}]}),source.id);
    const {jobId}=await enqueueAutoPhotoRender(f.env,source.id);
    f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(jobId);
    const assets=Object.fromEntries([0,1].map(i=>[i,{assetKey:'temporary--'+crypto.randomUUID()+'.jpg',fileName:i+'.jpg',fileSize:2000,contentType:'image/jpeg'}]));
    f.sqlite.prepare('UPDATE psychology_publish_items SET photo_assets_json=? WHERE id=?').run(JSON.stringify(assets),source.id);
    const req=new Request(BASE+'/api/worker/psychology-auto/'+jobId+'/publish',{method:'POST',headers:{'x-factory-worker':'w'},body:'{}'});
    const response=await(await handleAutoPhotoWorker(req,f.env,new URL(req.url))).json();
    if(index<2){assert.equal(response.waiting,true);assert.equal(f.requests.length,0);}
    else assert.ok(response.batchId);
  }
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].items.length,3);
  assert.ok(f.requests[0].items.every(i=>i.photoAssetKeys.length===2&&i.postInfo.musicSoundId==='12345'&&i.postInfo.autoAddMusic===false&&i.postInfo.photoCoverIndex===0));
});

test('deleting a legacy failed item hides it, blocks retry, and preserves successful siblings',async t=>{
  const f=await groupedFixture(t,3),items=f.items(),item=items[0];
  f.sqlite.prepare("UPDATE psychology_publish_items SET publish_group_id=''").run();
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(item.job_id);
  f.sqlite.prepare('UPDATE psychology_publish_items SET receipt_json=? WHERE id=?').run('{"batchId":"already-published"}',items[1].id);
  const path='/api/psychology-auto-publish/'+item.id;
  await assert.rejects(f.call('DELETE',undefined,path,{...user,username:'another'}),e=>e.statusCode===404);
  await assert.rejects(f.call('DELETE',undefined,path,{...user,role:'operator'}),e=>e.statusCode===403);
  assert.equal((await f.call('DELETE',undefined,path)).status,200);
  assert.equal((await f.call('DELETE',undefined,path)).status,200);
  const batch=(await(await f.call()).json()).batches[0];
  assert.equal(batch.items.length,2);assert.equal(batch.deletedCount,1);
  assert.equal(batch.items[0].status,'submitted');
  assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(item.job_id).status,'cancelled');
  await assert.rejects(f.call('POST',{},path+'/retry'),e=>e.statusCode===404);
  assert.equal(f.requests.length,0);
});

test('deleting a failed group member leaves ready siblings available for one smaller submission',async t=>{
  const f=await groupedFixture(t,3),items=f.items(),item=items[0];
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(item.job_id);
  for(const sibling of items.slice(1))await stagePublishItem(f.env,sibling,readyVideo(sibling));
  assert.equal(f.requests.length,0);
  await f.call('DELETE',undefined,'/api/psychology-auto-publish/'+item.id);
  const batch=(await(await f.call()).json()).batches[0];
  assert.equal(batch.groups[0].count,2);assert.equal(batch.groups[0].canRetry,true);
  assert.equal(f.requests.length,0,'deletion itself does not publish');
  await f.call('POST',{},'/api/psychology-auto-publish/groups/'+item.publish_group_id+'/retry');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].items.length,2);
  assert.deepEqual(f.requests[0].items.map(i=>i.externalRef),items.slice(1).map(i=>i.id));
});

test('active, staged, submitted and frozen-request members cannot be deleted',async t=>{
  const f=await groupedFixture(t,2),item=f.items()[0],path='/api/psychology-auto-publish/'+item.id;
  for(const status of ['queued','running','done']){
    f.sqlite.prepare('UPDATE factory_jobs SET status=? WHERE id=?').run(status,item.job_id);
    await assert.rejects(f.call('DELETE',undefined,path),e=>e.statusCode===409);
  }
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(item.job_id);
  for(const field of ['ready_json','receipt_json']){
    f.sqlite.prepare('UPDATE psychology_publish_items SET '+field+'=? WHERE id=?').run('{"batchId":"existing"}',item.id);
    await assert.rejects(f.call('DELETE',undefined,path),e=>e.statusCode===409);
    f.sqlite.prepare('UPDATE psychology_publish_items SET '+field+"='{}' WHERE id=?").run(item.id);
  }
  f.sqlite.prepare("UPDATE psychology_publish_groups SET status='failed',request_json=?").run('{"items":[]}');
  await assert.rejects(f.call('DELETE',undefined,path),e=>e.statusCode===409);
  assert.equal(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items WHERE id=?').get(item.id).deleted_at,0);
});

test('removing every failure leaves a cancelled empty group and no remote submission',async t=>{
  const f=await groupedFixture(t,2),items=f.items();
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed'").run();
  for(const item of items)await f.call('DELETE',undefined,'/api/psychology-auto-publish/'+item.id);
  const batch=(await(await f.call()).json()).batches[0];
  assert.equal(batch.items.length,0);assert.equal(batch.groups[0].status,'cancelled');assert.equal(batch.groups[0].canRetry,false);
  await dispatchPublishGroup(f.env,items[0].publish_group_id);assert.equal(f.requests.length,0);
  const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(items[0].job_id);
  await enqueueAutoVideoPublish(f.db,job,officialPublishFollowupPayload(job,{results:[{fileName:'old.mp4'}]}));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE type='official-publish'").get().n,0);
});

async function workerCall(f,path,body,worker='w'){
 const req=new Request(BASE+path,{method:'POST',headers:{Authorization:'Bearer test-worker','x-factory-worker':worker},body:JSON.stringify(body)});
 return handleJobs(req,f.env,new URL(req.url),null);
}
test('publish failures retry twice off the lane, skip delayed work, retain one failure record and diagnose each attempt',async t=>{
 const f=await groupedFixture(t,2),[item,other]=f.items();
 const original=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(item.job_id),p=JSON.parse(original.payload_json);
 p.photoAutomation=true;
 f.sqlite.prepare("UPDATE factory_jobs SET payload_json=?,status='running',worker_id='w' WHERE id=?").run(JSON.stringify(p),item.job_id);
 const complete='/api/worker/jobs/'+item.job_id+'/complete';
 for(let attempt=0;attempt<3;attempt++){
   const before=Date.now();
   await workerCall(f,complete,{error:'图片上传失败（ECONNRESET）：fetch failed',result:{},percent:85});
   const job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(item.job_id);
   assert.equal(job.status,attempt<2?'queued':'failed');
   assert.equal(job.auto_retry_count,Math.min(attempt+1,2));
   assert.equal(JSON.parse(job.retry_history_json).length,attempt+1);
   if(attempt<2)assert.ok(job.available_at>=before+(attempt===0?30000:60000));
   else assert.equal(job.available_at,0);
   // Duplicate completion after requeue must not consume another retry.
   await workerCall(f,complete,{error:'duplicate'});
   assert.equal(JSON.parse(f.sqlite.prepare('SELECT retry_history_json FROM factory_jobs WHERE id=?').get(item.job_id).retry_history_json).length,attempt+1);
   if(attempt===0){
     const claimed=await(await workerCall(f,'/api/worker/claim',{workerId:'w',psychologyBatchUpload:true,psychologyPublishRetry:true,types:['psychology']})).json();
     assert.equal(claimed.job.id,other.job_id,'the next task runs while this one waits');
   }
   if(attempt<2)f.sqlite.prepare("UPDATE factory_jobs SET status='running' WHERE id=?").run(item.job_id);
 }
 const records=f.sqlite.prepare('SELECT value_json FROM factory_publish_records').all().map(r=>JSON.parse(r.value_json));
 assert.equal(records.length,1);assert.equal(records[0].status,'failed');assert.equal(records[0].autoRetryCount,2);
 assert.match(records[0].error,/ECONNRESET/);assert.equal(records[0].nextRetryAt,0);
 assert.equal(records[0].batchId||'','');assert.equal(f.requests.length,0);
});

test('group failures use a separate submission job with exactly two retries and identical remote request',async t=>{
 const f=await groupedFixture(t,2),items=f.items(),native=globalThis.fetch,bodies=[];
 let fail=true;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).endsWith('/api/v1/publish/batches')){bodies.push(init.body);if(fail)throw new Error('remote unavailable');}
  return native(url,init);
 });
 await stagePublishItem(f.env,items[0],readyVideo(items[0]));
 await assert.rejects(stagePublishItem(f.env,items[1],readyVideo(items[1])),/remote unavailable/);
 const id=items[0].publish_group_id+'-submit';
 let job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(id);
 assert.equal(job.status,'queued');assert.equal(job.auto_retry_count,1);assert.ok(job.available_at>Date.now());
 // Another uploader cannot bypass the group's scheduled retry.
 await stagePublishItem(f.env,items[0],readyVideo(items[0]));assert.equal(bodies.length,1);
 for(let retry=1;retry<=2;retry++){
  f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(id);
  await assert.rejects(workerCall(f,'/api/worker/psychology-publish-groups/'+id+'/submit',{}),/remote unavailable/);
  await workerCall(f,'/api/worker/jobs/'+id+'/complete',{error:'remote unavailable'});
  job=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(id);
  assert.equal(job.status,retry===1?'queued':'failed');
 }
 assert.equal(bodies.length,3);assert.ok(bodies.every(b=>b===bodies[0]));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_publish_records').get().n,2);
 // A subsequent explicit manual retry can succeed and updates those same records.
 fail=false;await f.call('POST',{},'/api/psychology-auto-publish/groups/'+items[0].publish_group_id+'/retry');
 f.sqlite.prepare("UPDATE factory_jobs SET status='running',worker_id='w' WHERE id=?").run(id);
 await workerCall(f,'/api/worker/psychology-publish-groups/'+id+'/submit',{});
 await workerCall(f,'/api/worker/jobs/'+id+'/complete',{result:{},percent:100});
 const records=f.sqlite.prepare('SELECT value_json FROM factory_publish_records').all().map(r=>JSON.parse(r.value_json));
 assert.equal(records.length,2);assert.ok(records.every(r=>r.status!=='failed'&&r.batchId&&r.error===''&&r.nextRetryAt===0));
});

test('migration backfills missing legacy submission failures without requeueing or duplicating records',async t=>{
 const f=await groupedFixture(t,2),items=f.items();
 for(const item of items){
  const p=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(item.job_id).payload_json);p.photoAutomation=true;
  f.sqlite.prepare("UPDATE factory_jobs SET payload_json=?,status='failed',error='historical failure' WHERE id=?").run(JSON.stringify(p),item.job_id);
 }
 f.sqlite.prepare('UPDATE psychology_publish_items SET receipt_json=? WHERE id=?').run('{"batchId":"existing"}',items[1].id);
 const sql=fs.readFileSync(new URL('../migrations/0032_psychology_publish_retries.sql',import.meta.url),'utf8').split('-- Backfill')[1];
 const insert=sql.slice(sql.indexOf('INSERT OR IGNORE'));
 f.sqlite.exec(insert);f.sqlite.exec(insert);
 const records=f.sqlite.prepare('SELECT value_json FROM factory_publish_records').all().map(r=>JSON.parse(r.value_json));
 assert.equal(records.length,1);assert.equal(records[0].autoTaskId,items[0].id);assert.equal(records[0].status,'failed');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE status='queued'").get().n,0);
});
