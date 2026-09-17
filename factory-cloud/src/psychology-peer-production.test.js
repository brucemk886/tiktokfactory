import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePsychologyPeerHits } from './psychology-peer-hits.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { PSYCHOLOGY_RECREATION_VOICE_ID, PSYCHOLOGY_RECREATION_VOICE_IDS } from './psychology-peer-production.js';
import { peerCopy, parsePhotoStory, peerProductionPayload } from '../../scripts/psychology-peer-production.js';
import { persistableJobResult, claimTypeFilter } from './jobs.js';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
import { importGeneratedPhoto } from './photo-publishing.js';
import { withProductionPatch, compactProduction } from '../../scripts/production-timeline.js';
import { syncPeerArtboardProgress } from '../../scripts/peer-progress-sync.js';

test('recreation submission dispatches cloud workflow with stable IDs and retries failed dispatch without duplicate rows', async t => {
  const batches = []; let unavailable = true;
  const { db, sqlite, call, user } = fixture(t, { PSYCHOLOGY_RECREATION_WORKFLOW: { async createBatch(items) { batches.push(items); if(unavailable) throw new Error('unavailable'); return []; } } });
  const imported = await importPsychologyPeerHits(db,[{videoUrl:'https://www.tiktok.com/@example/video/10',title:'Source video',videoData:{videoFileUrl:'https://v16.tiktokcdn.com/source.mp4'}}],user.id);
  const input = {ids:imported.items.map(item=>item.id),mediaType:'video',requestId:crypto.randomUUID()};
  assert.equal((await call('POST',input)).status,503);
  unavailable = false;
  const response = await call('POST',input);
  assert.equal(response.status,200);
  assert.equal((await response.json()).execution,'cloud');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,1);
  assert.deepEqual(batches[0],batches[1]);
  sqlite.prepare("UPDATE factory_jobs SET status='done'").run();
  await call('POST',input);
  assert.equal(batches.length,2);
});

const storyPlan = () => ({title:'A thoughtful pause', hooks:['Notice the pause','Space before another message','What are you assuming?'],scenes:Array.from({length:6},(_,i)=>({text:`Scene ${i}: Pause and notice what you need before sending another message.`,visualPrompt:`Scene ${i}: A person walks through a softly lit garden and considers a message on their phone.`}))});

function cloudFixture(t, failSecond = false) {
  const {db,sqlite} = fixture(t);
  sqlite.prepare("INSERT INTO factory_jobs(id,type,status,created_by,payload_json,result_json) VALUES('cloud-test','psychology-photo-story','queued','admin',?,'{}')").run(JSON.stringify({topic:'Silence',script:'Reflect on the assumptions you make when a friend goes quiet.'}));
  const plan = storyPlan(), submissions = [], cache = new Map(), sleeps = [];
  const step = {
    async do(name, config, action) { if(cache.has(name))return structuredClone(cache.get(name)); const result=await (action || config)();cache.set(name,structuredClone(result));return result; },
    async sleep(name) { sleeps.push(name); }
  };
  let reads=0;
  const env = {DB:db,KIE_API_KEY:'test-key',async fetch(url,init) {
    if(String(url).includes('/chat/completions')) return Response.json({choices:[{message:{content:JSON.stringify(plan)}}]});
    if(String(url).includes('/createTask')) {const input=JSON.parse(init.body);submissions.push(input);return Response.json({code:200,data:{taskId:String(submissions.length)}});}
    const id=new URL(url).searchParams.get('taskId'); reads++;
    return Response.json({code:200,data:{taskId:id,state:failSecond&&id==='2'?'fail':reads===1?'waiting':'success',failMsg:failSecond&&id==='2'?'Provider rejected second image':'',resultJson:JSON.stringify({resultUrls:[`https://images.example/${id}.webp`]})}});
  }};
  return {env,step,plan,submissions,sqlite,sleeps};
}

test('cloud workflow saves six paired captions and images, durably sleeps and replay does not submit images again', async t => {
  const f=cloudFixture(t);
  const result=await runPeerPhotoWorkflow(f.env,{payload:{jobId:'cloud-test'}},f.step);
  assert.equal(result.count,6);assert.equal(f.submissions.length,6);assert.equal(f.sleeps.length,1);
  assert.ok(f.submissions.every(item=>item.model==='z-image'));
  const row=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE id='cloud-test'").get();
  assert.equal(row.status,'done');assert.equal(row.worker_id,'cloud-photo');
  assert.deepEqual(JSON.parse(row.result_json).results.map(item=>item.title),f.plan.scenes.map(item=>item.text));
  await runPeerPhotoWorkflow(f.env,{payload:{jobId:'cloud-test'}},f.step);
  assert.equal(f.submissions.length,6);
});

test('cloud provider failure is recorded and keeps completed pages without claiming success', async t => {
  const f=cloudFixture(t,true);
  await assert.rejects(runPeerPhotoWorkflow(f.env,{payload:{jobId:'cloud-test'}},f.step),/Provider rejected/);
  const row=f.sqlite.prepare("SELECT * FROM factory_jobs WHERE id='cloud-test'").get();
  assert.equal(row.status,'failed');assert.match(row.error,/Provider rejected/);
  assert.equal(JSON.parse(row.result_json).results.length,1);assert.equal(f.submissions.length,2);
});

function fixture(t, overrides = {}) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec('CREATE TABLE factory_users(id TEXT PRIMARY KEY, role TEXT, active INTEGER);');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0022_psychology_peer_hits.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0025_psychology_peer_hit_media_type.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0026_psychology_peer_hit_voice_gender.sql', import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE factory_jobs(id TEXT PRIMARY KEY,type TEXT,status TEXT,title TEXT,percent INTEGER,message TEXT,payload_json TEXT,result_json TEXT,error TEXT,created_by TEXT,worker_id TEXT,claimed_at INTEGER,completed_at INTEGER,created_at INTEGER,updated_at INTEGER);');
  const db = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args=args; return this; },
        async first() { return sqlite.prepare(sql).get(...this.args) || null; },
        async all() { return { results:sqlite.prepare(sql).all(...this.args) }; },
        async run() { return { meta:{changes:Number(sqlite.prepare(sql).run(...this.args).changes)} }; },
      };
    },
    async batch(items) {
      sqlite.exec('BEGIN');
      try { const result=[]; for (const item of items) result.push(await item.all()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const user = { id:'admin', username:'admin', role:'admin', sidebarModules:['psychology-peer-hits','psychology','psychology-narrative','psychology-collage','psychology-photo'] };
  const call = async (method, body, actor=user, origin='https://factory.test', query='') => {
    const request = new Request('https://factory.test/api/psychology-peer-hits/production'+query, {method,headers:{origin,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
    return handlePsychologyPeerHits(request,{DB:db, GEMINI_API_KEY:'gemini-test', KIE_API_KEY:'kie-test', ELEVENLABS_API_KEY:'eleven-test', ARCHIVE:{}, PSYCHOLOGY_RECREATION_WORKFLOW:{createBatch:async()=>[]}, PEER_PHOTO_WORKFLOW:{createBatch:async()=>[]}, ...overrides},new URL(request.url),actor ? {user:actor} : null);
  };
  return { db, sqlite, user, call };
}

test('local workers cannot claim cloud photo jobs even if they request the type explicitly', () => {
  assert.ok(claimTypeFilter({workerId:'old-worker'}).excludeTypes.includes('psychology-photo-story'));
  assert.ok(claimTypeFilter({workerId:'updated-worker',types:['psychology-photo-story'],psychologyPhotoStory:true}).excludeTypes.includes('psychology-photo-story'));
  assert.ok(claimTypeFilter({workerId:'updated-worker',types:['psychology-recreation']}).excludeTypes.includes('psychology-recreation'));
});

test('peer recreation enqueues one source-linked cloud job per selection without requiring saved copy', async t => {
  const { db, sqlite, call, user } = fixture(t);
  const imported = await importPsychologyPeerHits(db, [1,2].map(id => ({videoUrl:`https://www.tiktok.com/@example/video/${id}`,title:`Topic ${id}`,videoData:{videoFileUrl:`https://v16.tiktokcdn.com/${id}.mp4`}})),user.id);
  const input = { ids:imported.items.map(item=>item.id),mediaType:'video',requestId:crypto.randomUUID() };
  assert.equal((await call('POST',input)).status,202);
  assert.equal((await call('POST',input)).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,2);
  const row=sqlite.prepare('SELECT * FROM factory_jobs LIMIT 1').get();
  const payload=JSON.parse(row.payload_json);
  assert.equal(row.type,'psychology-recreation');
  assert.equal(payload.voiceId,PSYCHOLOGY_RECREATION_VOICE_ID);
  assert.match(payload.peerSource.videoUrl,/tiktok\.com/);
  assert.equal(payload.peerSource.copy,undefined);
  assert.equal((await call('POST',{...input,voiceId:'differentVoice123'})).status,200);
  const own=await (await call('GET')).json(); assert.equal(own.jobs.length,2);
  const other=await (await call('GET',undefined,{...user,username:'other'})).json(); assert.equal(other.jobs.length,0);
});

test('peer recreation selects server-owned male and Lara female voices from each record', async t => {
  const {db,sqlite,call,user}=fixture(t);
  const imported=await importPsychologyPeerHits(db,[
    {videoUrl:'https://www.tiktok.com/@example/video/801',voiceGender:'male',videoData:{videoFileUrl:'https://v16.tiktokcdn.com/801.mp4'}},
    {videoUrl:'https://www.tiktok.com/@example/video/802',voiceGender:'female',videoData:{videoFileUrl:'https://v16.tiktokcdn.com/802.mp4'}}
  ],user.id);
  const response=await call('POST',{ids:imported.items.map(item=>item.id),mediaType:'video',requestId:crypto.randomUUID(),voiceId:'browser-supplied'});
  assert.equal(response.status,202);
  const payloads=sqlite.prepare('SELECT payload_json FROM factory_jobs ORDER BY id').all().map(row=>JSON.parse(row.payload_json));
  assert.deepEqual(payloads.map(payload=>payload.voiceGender).sort(),['female','male']);
  assert.deepEqual(payloads.map(payload=>payload.voiceId).sort(),Object.values(PSYCHOLOGY_RECREATION_VOICE_IDS).sort());
  assert.ok(payloads.every(payload=>payload.voiceId!=='browser-supplied'));
});

test('photo hit recreation creates a cloud photo-story job without video download or voice selection', async t => {
  const batches=[];
  const {db,sqlite,call,user}=fixture(t,{
    ARCHIVE:null,
    PSYCHOLOGY_RECREATION_WORKFLOW:null,
    ELEVENLABS_API_KEY:'',
    TIKHUB_API_KEY:'',
    PEER_PHOTO_WORKFLOW:{async createBatch(items){batches.push(items);return [];}}
  });
  const copy='When someone goes quiet, notice the story you create before deciding what their silence means.';
  const imported=await importPsychologyPeerHits(db,[{videoUrl:'https://www.tiktok.com/@example/photo/55',mediaType:'photo',title:'What silence brings up',videoData:{copy}}],user.id);
  const input={ids:imported.items.map(item=>item.id),mediaType:'photo',requestId:crypto.randomUUID()};
  const response=await call('POST',input);
  assert.equal(response.status,202);assert.equal(batches.length,1);
  const row=sqlite.prepare('SELECT * FROM factory_jobs').get();
  const payload=JSON.parse(row.payload_json);
  assert.equal(row.type,'psychology-photo-story');
  assert.equal(payload.voiceId,undefined);
  assert.equal(payload.script,copy);
  assert.equal(payload.peerSource.id,imported.items[0].id);
  const listed=await (await call('GET',undefined,user,'https://factory.test','?mediaType=photo')).json();
  assert.equal(listed.jobs.length,1);assert.equal(listed.jobs[0].type,'psychology-photo-story');
  const videos=await (await call('GET',undefined,user,'https://factory.test','?mediaType=video')).json();
  assert.equal(videos.jobs.length,0);
});

test('recreation batch rejects missing sources, invalid media types and unauthorized targets before creating jobs', async t => {
  const {db,sqlite,user,call}=fixture(t);
  const imported=await importPsychologyPeerHits(db,[{videoUrl:'https://www.tiktok.com/@example/video/5',title:'Only a title'}],user.id);
  const input={ids:imported.items.map(item=>item.id),mediaType:'video',requestId:crypto.randomUUID()};
  assert.equal((await call('POST',{...input,mediaType:'audio'})).status,400);
  assert.equal((await call('POST',{...input,ids:['psy-'+'a'.repeat(32)]})).status,409);
  assert.equal((await call('POST',input,null)).status,401);
  assert.equal((await call('POST',input,{...user,role:'operator'})).status,403);
  assert.equal((await call('POST',input,{...user,sidebarModules:[]})).status,403);
  assert.equal((await call('POST',input,user,'https://other.test')).status,403);
  assert.equal((await call('POST',{...input,ids:[]})).status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,0);
});

test('recreation assets are same-origin, owner-scoped and support audio range reads', async t => {
  const {db,sqlite,user}=fixture(t);
  sqlite.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,payload_json,result_json) VALUES('asset-job','psychology-recreation','done','Asset test','admin','{}','{}')").run();
  const bytes=new TextEncoder().encode('0123456789');
  const ARCHIVE={
    async get(key,options){
      assert.equal(key,'psychology-recreation/asset-job/scene-0.mp3');
      assert.ok(options?.range);
      return {body:bytes.slice(2,6),size:10,range:{offset:2,length:4},httpMetadata:{contentType:'audio/mpeg'},httpEtag:'etag'};
    }
  };
  const request=new Request('https://factory.test/api/psychology-peer-hits/production/asset-job/assets/audio/0',{headers:{range:'bytes=2-5'}});
  const response=await handlePsychologyPeerHits(request,{DB:db,ARCHIVE},new URL(request.url),{user});
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 2-5/10');
  assert.equal(await response.text(),'2345');
  const denied=await handlePsychologyPeerHits(request,{DB:db,ARCHIVE},new URL(request.url),{user:{...user,username:'other'}});
  assert.equal(denied.status,404);
});

test('photo storyboard requires distinct paired scene descriptions and persists generated images', () => {
  const scenes=Array.from({length:6},(_,index)=>({text:`Slide ${index}: reflect on your response when a friend goes quiet.`,visualPrompt:`Scene ${index}: An adult sits beside a window holding a phone in warm morning light, portrait composition.`}));
  const plan=parsePhotoStory(JSON.stringify({title:'What silence brings up',hooks:['What silence brings up','What does a late reply mean to you?','The story you tell yourself while waiting'],scenes}));
  assert.equal(plan.scenes.length,6);
  assert.throws(()=>parsePhotoStory({title:'test',scenes:[scenes[0]]}));
  assert.throws(()=>parsePhotoStory({title:'test',scenes:Array(6).fill(scenes[0])}));
  assert.equal(peerCopy({title:'Do not use a title as the complete source'}),'');
  assert.throws(()=>peerProductionPayload({videoData:{copy:'short'}},'psychology-collage'));
  const result={plan,results:[{template:'psychology-photo-story',imageUrl:'https://images.example/1.webp',imageModel:'z-image',sceneIndex:0,visualPrompt:scenes[0].visualPrompt,title:scenes[0].text}]};
  const persisted=persistableJobResult(result);
  assert.ok(JSON.stringify(persisted).includes('https://images.example/1.webp'));
});

test('photo import rejects other owners or unfinished production without fetching media', async t => {
  const {db,sqlite,user}=fixture(t);
  sqlite.prepare("INSERT INTO factory_jobs(id,type,status,created_by,result_json) VALUES('peer-test','psychology-photo-story','done','other',?)").run(JSON.stringify({results:[{imageUrl:'https://images.example/1.webp',imageModel:'z-image'}]}));
  const env={fetch(){throw new Error('Must not fetch another user media');}};
  await assert.rejects(importGeneratedPhoto(env,db,user,{peerJobId:'peer-test'}),error=>error.statusCode===404);
  sqlite.prepare("UPDATE factory_jobs SET created_by='admin',status='running'").run();
  await assert.rejects(importGeneratedPhoto(env,db,user,{peerJobId:'peer-test'}),error=>error.statusCode===404);
});

test('artboard pagination and individual detail remain scoped to the owner', async t => {
  const {sqlite,user,call}=fixture(t);
  const insert=sqlite.prepare('INSERT INTO factory_jobs(id,type,status,title,created_by,payload_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<32;i++)insert.run('board-'+i,'psychology',i===0?'running':'queued','Topic '+i,user.username,JSON.stringify({peerSource:{id:'source',copy:'Example source'}}),'{}',i);
  insert.run('private-board','psychology','done','Private','other',JSON.stringify({peerSource:{id:'source'}}),'{}',99);
  const first=await (await call('GET')).json();assert.equal(first.jobs.length,30);assert.equal(first.hasMore,true);assert.equal(first.counts.reduce((n,s)=>n+s.count,0),32);
  const second=await (await call('GET',undefined,user,'https://factory.test','?offset=30')).json();assert.equal(second.jobs.length,2);
  const detail=await (await call('GET',undefined,user,'https://factory.test','?jobId=board-0')).json();assert.equal(detail.jobs.length,1);assert.equal(detail.jobs[0].status,'running');
  assert.equal((await call('GET',undefined,user,'https://factory.test','?jobId=private-board')).status,404);
});

test('production timeline records actual transitions, retains completed scenes on failure and strips private fields', () => {
  let state=withProductionPatch({}, {productionStage:'script',message:'Draft'},100);
  state=withProductionPatch(state,{productionStage:'audio',productionAudio:{text:'A calm narration',provider:'test',apiKey:'must-not-persist'},productionScene:{index:0,audioText:'A calm narration',audioStatus:'running'}},200);
  state=withProductionPatch(state,{productionStage:'audio',productionScene:{index:0,audioStatus:'done',start:0,end:3.25,duration:3.25}},300);
  state=withProductionPatch(state,{productionStage:'images',productionScene:{index:0,imagePrompt:'A person looking out of a window',imageUrl:'https://images.example/1.png',imageStatus:'done',localPath:'D:/private/audio.mp3'}},400);
  state=withProductionPatch(state,{status:'failed',message:'Next image failed'},500);
  const production=compactProduction(state.production);
  assert.deepEqual(production.events.map(e=>e.stage),['script','audio','images','images']);
  assert.equal(production.events.at(-1).status,'failed');assert.equal(production.scenes[0].duration,3.25);assert.equal(production.scenes[0].audioText,'A calm narration');
  const persisted=persistableJobResult(state);assert.deepEqual(persisted.production,production);assert.ok(!JSON.stringify(persisted).includes('must-not-persist'));assert.ok(!JSON.stringify(persisted).includes('D:/private'));
});

test('worker progress retries transient failures, throttles writes, preserves metadata and skips unrelated or completed jobs', async () => {
  const job={id:'peer-test',payload:{peerSource:{id:'source'}}},state={at:0,version:0};
  const local={status:'running',updatedAt:100,percent:20,message:'Audio',production:{stage:'audio'}};
  let calls=0;const send=async(_,url,options)=>{calls++;assert.equal(url,'/api/worker/jobs/peer-test/progress');assert.deepEqual(options.body.result.production,local.production);if(calls===1)throw Error('temporary outage');};
  assert.equal(await syncPeerArtboardProgress({},job,local,state,send,10000),false);assert.equal(state.version,0);
  assert.equal(await syncPeerArtboardProgress({},job,local,state,send,11000),false);assert.equal(calls,1);
  assert.equal(await syncPeerArtboardProgress({},job,local,state,send,16000),true);assert.equal(state.version,100);
  await syncPeerArtboardProgress({},job,local,state,send,22000);assert.equal(calls,2);
  await syncPeerArtboardProgress({},job,{...local,status:'done',updatedAt:200},state,send,28000);assert.equal(calls,2);
  await syncPeerArtboardProgress({},{id:'unrelated',payload:{}},{...local,updatedAt:200},state,send,34000);assert.equal(calls,2);
});


test('page-only peer records require TikHub configuration before queueing or billing', async t => {
  const { db, sqlite, call, user } = fixture(t);
  const imported = await importPsychologyPeerHits(db, [{ videoUrl: 'https://www.tiktok.com/@example/video/70' }], user.id);
  const response = await call('POST', { ids: imported.items.map(item => item.id), voiceId: '21m00Tcm4TlvDq8ikWAM', requestId: crypto.randomUUID() });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /TikHub API Key/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n, 0);
});


test('TikHub configured page-only records queue without resolving or billing in the HTTP request', async t => {
  let paidRequests = 0;
  const { db, sqlite, call, user } = fixture(t, { TIKHUB_API_KEY: 'test', fetch: async () => { paidRequests++; throw new Error('Not in submission'); } });
  const imported = await importPsychologyPeerHits(db, [{ videoUrl: 'https://www.tiktok.com/@example/video/70' }], user.id);
  const input = { ids: imported.items.map(item => item.id), voiceId: '21m00Tcm4TlvDq8ikWAM', requestId: crypto.randomUUID() };
  assert.equal((await call('POST', input)).status, 202);
  assert.equal((await call('POST', input)).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n, 1);
  assert.equal(paidRequests, 0);
  assert.equal(JSON.parse(sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json).peerSource.videoFileUrl, '');
});


test('recreation submission uses Kie without requiring a Google key', async t => {
  const { db, call, user } = fixture(t, { GEMINI_API_KEY: '', TIKHUB_API_KEY: 'tikhub-test' });
  const imported = await importPsychologyPeerHits(db, [{ videoUrl: 'https://www.tiktok.com/@example/video/777', title: 'Kie direct' }], user.id);
  const response = await call('POST', { ids: imported.items.map(item => item.id), voiceId: 'voice-test-123', requestId: crypto.randomUUID() });
  assert.equal(response.status, 202);
});
