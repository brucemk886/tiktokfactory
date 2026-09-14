import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePsychologyPeerHits } from './psychology-peer-hits.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { peerCopy, parsePhotoStory, peerProductionPayload } from '../../scripts/psychology-peer-production.js';
import { persistableJobResult, claimTypeFilter } from './jobs.js';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
import { importGeneratedPhoto } from './photo-publishing.js';

test('photo submission dispatches cloud workflow with stable IDs and retries failed dispatch without duplicate rows', async t => {
  const batches = []; let unavailable = true;
  const { db, sqlite, call, user } = fixture(t, { PEER_PHOTO_WORKFLOW: { async createBatch(items) { batches.push(items); if(unavailable) throw new Error('unavailable'); return []; } } });
  const imported = await importPsychologyPeerHits(db,[{videoUrl:'https://www.tiktok.com/@example/video/10',videoData:{copy:'A complete source about how silence changes the stories people tell themselves.'}}],user.id);
  const input = {ids:imported.items.map(item=>item.id),template:'psychology-photo-story',requestId:crypto.randomUUID()};
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
    async do(name, config, action) { if(cache.has(name))return structuredClone(cache.get(name)); const result=await action();cache.set(name,structuredClone(result));return result; },
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
  const user = { id:'admin', username:'admin', role:'admin', sidebarModules:['psychology-peer-hits','psychology-narrative','psychology-collage','psychology-photo'] };
  const call = async (method, body, actor=user, origin='https://factory.test') => {
    const request = new Request('https://factory.test/api/psychology-peer-hits/production', {method,headers:{origin,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
    return handlePsychologyPeerHits(request,{DB:db, KIE_API_KEY:'test-key', PEER_PHOTO_WORKFLOW:{createBatch:async()=>[]}, ...overrides},new URL(request.url),actor ? {user:actor} : null);
  };
  return { db, sqlite, user, call };
}

test('local workers cannot claim cloud photo jobs even if they request the type explicitly', () => {
  assert.ok(claimTypeFilter({workerId:'old-worker'}).excludeTypes.includes('psychology-photo-story'));
  assert.ok(claimTypeFilter({workerId:'updated-worker',types:['psychology-photo-story'],psychologyPhotoStory:true}).excludeTypes.includes('psychology-photo-story'));
});

test('peer production uses saved full copy and enqueues one source-linked job per selection, once', async t => {
  const { db, sqlite, call, user } = fixture(t);
  const imported = await importPsychologyPeerHits(db, [1,2].map(id => ({videoUrl:`https://www.tiktok.com/@example/video/${id}`,title:`Topic ${id}`,videoData:{文案:'When a friend goes quiet, notice what you assume before asking what happened.'}})),user.id);
  const input = { ids:imported.items.map(item=>item.id),template:'psychology-target-2',requestId:crypto.randomUUID() };
  assert.equal((await call('POST',input)).status,202);
  assert.equal((await call('POST',input)).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,2);
  const row=sqlite.prepare('SELECT * FROM factory_jobs LIMIT 1').get();
  const payload=JSON.parse(row.payload_json);
  assert.equal(payload.script,payload.peerSource.copy);
  assert.equal(payload.imageModel,'z-image'); assert.equal(payload.publish.autoPublish,false);
  assert.equal((await call('POST',{...input,template:'psychology-collage'})).status,409);
  const own=await (await call('GET')).json(); assert.equal(own.jobs.length,2);
  const other=await (await call('GET',undefined,{...user,username:'other'})).json(); assert.equal(other.jobs.length,0);
});

test('batch rejects absent copy, missing sources and unauthorized targets before creating jobs', async t => {
  const {db,sqlite,user,call}=fixture(t);
  const imported=await importPsychologyPeerHits(db,[{videoUrl:'https://www.tiktok.com/@example/video/5',title:'Only a title'},{videoUrl:'https://www.tiktok.com/@example/video/6',videoData:{transcript:'A complete reference transcript with specific relationship examples and a reflective ending.'}}],user.id);
  const input={ids:imported.items.map(item=>item.id),template:'psychology-photo-story',requestId:crypto.randomUUID()};
  assert.equal((await call('POST',input)).status,400);
  assert.equal((await call('POST',{...input,ids:['psy-'+'a'.repeat(32)]})).status,409);
  assert.equal((await call('POST',input,null)).status,401);
  assert.equal((await call('POST',input,{...user,role:'operator'})).status,403);
  assert.equal((await call('POST',input,{...user,sidebarModules:['psychology-peer-hits']})).status,403);
  assert.equal((await call('POST',input,user,'https://other.test')).status,403);
  assert.equal((await call('POST',{...input,ids:[]})).status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM factory_jobs').get().n,0);
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
