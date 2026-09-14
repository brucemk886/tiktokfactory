import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePsychologyPeerHits } from './psychology-peer-hits.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { peerCopy, parsePhotoStory, peerProductionPayload, runPhotoStoryProduction } from '../../scripts/psychology-peer-production.js';
import { persistableJobResult } from './jobs.js';
import { importGeneratedPhoto } from './photo-publishing.js';

function fixture(t) {
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
    return handlePsychologyPeerHits(request,{DB:db},new URL(request.url),actor ? {user:actor} : null);
  };
  return { db, sqlite, user, call };
}

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

test('photo generation pairs all six scene captions with their own image prompts and outputs', async () => {
  const plan={title:'A quieter interpretation',hooks:['Try another interpretation','What silence brings up','Before you send another text'],scenes:Array.from({length:6},(_,i)=>({text:`Scene ${i}: Give yourself time to reflect before deciding what silence means.`,visualPrompt:`Scene ${i}: A thoughtful adult sets down a phone beside a window, natural warm light, portrait framing.`}))};
  const imageCalls=[]; const updates=[];
  const kie={async createTask(input){
    if(input.kind==='chat')return {resultText:JSON.stringify(plan)};
    imageCalls.push(input);return {id:String(imageCalls.length),status:'waiting'};
  },async refreshTask(id){return {id,status:'success',resultUrls:[`https://images.example/${id}.webp`]};}};
  const result=await runPhotoStoryProduction({topic:plan.title,script:'Source copy for the original story.'},{kie,update(value){updates.push(structuredClone(value));},sleep:async()=>{}});
  assert.equal(imageCalls.length,6);
  assert.deepEqual(imageCalls.map(item=>item.prompt),plan.scenes.map(scene=>scene.visualPrompt));
  assert.ok(imageCalls.every(item=>item.imageModel==='z-image'&&item.aspectRatio==='9:16'));
  assert.deepEqual(result.results.map(item=>item.title),plan.scenes.map(scene=>scene.text));
  assert.equal(updates.at(-1).status,'done');
  assert.equal(updates.at(-1).results.length,6);
});

test('failed photo generation retains completed pages without reporting a finished story', async () => {
  const plan={title:'A thoughtful pause',hooks:['Notice the pause','Space before another message','What are you assuming?'],scenes:Array.from({length:6},(_,i)=>({text:`Scene ${i}: Pause and notice what you need before sending another message.`,visualPrompt:`Scene ${i}: A person walks through a softly lit garden and considers a message on their phone.`}))};
  const updates=[];let images=0;
  const kie={async createTask(input){
    if(input.kind==='chat')return {resultText:JSON.stringify(plan)};
    images++;return images===2?{status:'fail',error:'Provider rejected second image'}:{status:'success',resultUrls:['https://images.example/first.webp']};
  }};
  await assert.rejects(runPhotoStoryProduction({topic:plan.title,script:'Source copy.'},{kie,update(value){updates.push(structuredClone(value));}}),/Provider rejected/);
  assert.equal(updates.at(-1).results.length,1);
  assert.ok(!updates.some(update=>update.status==='done'));
  assert.equal(images,2);
});
