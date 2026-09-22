import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from './psychology-cloud-test-fixture.js';
import {importPsychologyPeerHits,updatePsychologyPeerHitMediaType} from './psychology-peer-hits-store.js';
import {dispatchCopyExtractions,handlePsychologyCopyLibrary,COPY_EXTRACTION_CONCURRENCY} from './psychology-copy-library.js';
import {runCopyExtraction,parseVideoCopy} from './psychology-copy-workflow.js';
import {photoCopySnapshot,photoCopyKey} from './peer-photo-copy-cache.js';
const actor={username:'admin',role:'admin',sidebarModules:['psychology-copy-library']};
const post=(id,type='video',videoData={})=>({videoUrl:`https://www.tiktok.com/@example/${type}/${id}`,title:'A pause can feel personal',videoData});
const steps=()=>({async do(name,options,fn){return (typeof options==='function'?options:fn)();},async sleep(){}});
async function setup(t){const f=await fixture(t);f.sqlite.exec('DELETE FROM psychology_peer_hits; DELETE FROM psychology_copy_library;');f.created=[];f.workflows=new Map();
 f.env.PSYCHOLOGY_COPY_WORKFLOW={async create({id,params}){if(f.workflows.has(id))throw new Error('already exists');f.created.push(params);f.workflows.set(id,'running');return {id};},async get(id){if(!f.workflows.has(id))throw new Error('not found');return {async status(){return {status:f.workflows.get(id)};}};}};
 return f;
}
function api(f,query='',method='GET',user=actor){const url=new URL('https://factory.test/api/psychology-copy-library'+query);return handlePsychologyCopyLibrary(new Request(url,{method}),f.env,url,{user});}

test('imports atomically create typed originals, metric refreshes preserve extraction and reclassification invalidates old attempts',async t=>{
 const f=await setup(t);const data=post(123);const first=await importPsychologyPeerHits(f.db,data,'admin');
 let row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();assert.equal(row.media_type,'video');assert.equal(row.status,'queued');assert.equal(row.owner,'admin');
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=?").run('{"transcript":"Original words"}');
 await importPsychologyPeerHits(f.db,{...data,playCount:100},'admin');row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();
 assert.equal(row.status,'done');assert.equal(JSON.parse(row.content_json).transcript,'Original words');assert.equal(row.attempt,0);
 await updatePsychologyPeerHitMediaType(f.db,first.items[0].id,'photo');row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();
 assert.equal(row.status,'queued');assert.equal(row.media_type,'photo');assert.equal(row.attempt,1);assert.equal(row.content_json,'{}');
 await assert.rejects(importPsychologyPeerHits(f.db,[post(124),{videoUrl:'invalid'}],'admin'));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_library').get().n,1);
});

test('library pagination, type/status/search and permissions do not label captions as extracted content',async t=>{
 const f=await setup(t);await importPsychologyPeerHits(f.db,Array.from({length:25},(_,n)=>post(100+n,n%2?'photo':'video',{caption:'caption only'})),'admin');
 const all=await (await api(f)).json();assert.equal(all.items.length,20);assert.equal(all.total,25);assert.ok(all.items.every(r=>r.status==='queued'&&!r.content.transcript&&!r.content.pages));
 assert.equal((await (await api(f,'?page=2')).json()).items.length,5);
 const photos=await (await api(f,'?mediaType=photo&status=queued')).json();assert.equal(photos.total,12);assert.ok(photos.items.every(r=>r.media_type==='photo'));
 assert.equal((await (await api(f,'?q=missing')).json()).total,0);
 assert.equal((await api(f,'','GET',{...actor,role:'operator'})).status,403);
 assert.equal((await api(f,'','GET',{...actor,sidebarModules:[]})).status,403);
});

test('cache and supplied original text avoid providers; three durable workers cap dispatch across concurrent ticks',async t=>{
 const f=await setup(t);await importPsychologyPeerHits(f.db,[post(201,'photo',{pageTexts:['page one','page two']}),post(202,'video',{transcript:'Original spoken words'}),...Array.from({length:8},(_,n)=>post(300+n))],'admin');
 await Promise.all([dispatchCopyExtractions(f.env),dispatchCopyExtractions(f.env)]);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_copy_library WHERE status='done'").get().n,2);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_copy_library WHERE status='running'").get().n,COPY_EXTRACTION_CONCURRENCY);
 assert.equal(f.created.length,3);assert.equal(new Set(f.created.map(r=>r.jobId)).size,3);
 await dispatchCopyExtractions(f.env);assert.equal(f.created.length,3);
 const first=f.created[0];f.sqlite.prepare("UPDATE psychology_copy_library SET status='failed',error='test failure' WHERE id=?").run(first.copyId);
 const retry=await api(f,'/'+first.copyId+'/retry','POST');assert.equal(retry.status,200);
 assert.equal((await runCopyExtraction(f.env,{payload:first},steps())).skipped,true);
 await dispatchCopyExtractions(f.env);assert.equal(f.created.length,4);assert.notEqual(f.created[3].jobId,first.jobId);
});

test('unknown dispatch outcome recovers the same instance instead of starting paid work twice',async t=>{
 const f=await setup(t);await importPsychologyPeerHits(f.db,post(411),'admin');
 const create=f.env.PSYCHOLOGY_COPY_WORKFLOW.create;f.env.PSYCHOLOGY_COPY_WORKFLOW.create=async input=>{await create(input);throw new Error('lost response');};
 await dispatchCopyExtractions(f.env);assert.equal(f.created.length,1);
 await dispatchCopyExtractions(f.env);assert.equal(f.created.length,1);assert.ok(f.sqlite.prepare('SELECT dispatch_at FROM psychology_copy_library').get().dispatch_at);
});

function cachedPhoto(){return photoCopySnapshot({title:'Title',hooks:['A','B','C'],caption:'caption',scenes:[{template:'stock',stockQuery:'sunset quiet room',title:'Words on photo',originalText:'The complete original words on this photo.'}]},{topic:'Original title',script:'Original caption'},1);}

test('a completed photo cache is copied into the library without creating a workflow',async t=>{
 const f=await setup(t);const p=post(510,'photo');await importPsychologyPeerHits(f.db,p,'admin');
 f.sqlite.prepare('INSERT INTO psychology_photo_copy_cache(owner,source_key,copy_json) VALUES(?,?,?)').run('admin',photoCopyKey(p.videoUrl),JSON.stringify(cachedPhoto()));
 await dispatchCopyExtractions(f.env);assert.equal(f.created.length,0);const row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();assert.equal(row.status,'done');assert.equal(JSON.parse(row.content_json).pages[0].text,'The complete original words on this photo.');
});

test('photo extraction-only path saves original text and skips stock search, rendering and publishing',async t=>{
 const f=await setup(t);const p=post(511,'photo');await importPsychologyPeerHits(f.db,p,'admin');await dispatchCopyExtractions(f.env);
 f.sqlite.prepare('INSERT INTO psychology_photo_copy_cache(owner,source_key,copy_json) VALUES(?,?,?)').run('admin',photoCopyKey(p.videoUrl),JSON.stringify(cachedPhoto()));
 f.env.DEEPSEEK_API_KEY='test';f.env.fetch=async()=>{throw new Error('Cached original must not call external providers');};
 await runCopyExtraction(f.env,{payload:f.created[0]},steps());const row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();
 assert.equal(row.status,'done');assert.equal(JSON.parse(row.content_json).pages[0].text,'The complete original words on this photo.');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);assert.equal(f.requests.length,0);
});

for(const fails of [false,true])test('video original extraction '+(fails?'records provider failure':'stores transcript and overlay text')+' and deletes temporary media',async t=>{
 const f=await setup(t);await importPsychologyPeerHits(f.db,post(600,'video',{videoFileUrl:'https://v16.tiktokcdn.com/source.mp4',caption:'Original caption'}),'admin');await dispatchCopyExtractions(f.env);
 const objects=new Map();f.env.ARCHIVE={async put(k,b){const bytes=new Uint8Array(await new Response(b).arrayBuffer());objects.set(k,bytes);return {size:bytes.length};},async delete(k){objects.delete(k);}};
 let calls=0;f.env.fetch=async(url,init)=>{
  if(String(url)==='https://v16.tiktokcdn.com/source.mp4'){const bytes=new Uint8Array(2048);bytes.set([0,0,0,24,102,116,121,112,105,115,111,109]);return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':'2048'}});}
  if(String(url).includes('/gemini-3-8-flash-openai/v1/chat/completions')){calls++;assert.match(init.body,/Transcribe speech verbatim/);return fails?Response.json({code:422,msg:'Unsupported media'}):Response.json({choices:[{message:{content:JSON.stringify({transcript:'I need a little space.',onScreenText:['Space is not rejection.'],notes:''})}}],credits_consumed:0.3});}
  throw new Error('Unexpected provider '+url);
 };
 if(fails)await assert.rejects(runCopyExtraction(f.env,{payload:f.created[0]},steps()),/Unsupported media/);else await runCopyExtraction(f.env,{payload:f.created[0]},steps());
 const row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();assert.equal(row.status,fails?'failed':'done');assert.equal(calls,1);assert.equal(objects.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
 if(!fails){const c=JSON.parse(row.content_json);assert.equal(c.transcript,'I need a little space.');assert.deepEqual(c.onScreenText,['Space is not rejection.']);assert.equal(c.caption,'Original caption');assert.equal(f.sqlite.prepare('SELECT provider_credits FROM factory_video_analyses').get().provider_credits,0.3);}
});

test('video parser rejects malformed extraction and separate pages keep reviewed tools out of styles',()=>{
 assert.throws(()=>parseVideoCopy('{"transcript":null,"onScreenText":[]}',{}));
 const read=name=>fs.readFileSync(new URL('../../public/'+name,import.meta.url),'utf8');
 assert.doesNotMatch(read('psychology-creative.html'),/id="copies"|copyFile|importForm/);
 assert.match(read('psychology-copy-library.html'),/originalMedia/);assert.match(read('psychology-copy-library.html'),/id="copies"/);
 assert.match(read('psychology-auto-publish.html'),/psychology-copy-library#copies/);
});


test('first photo extraction preserves indexed originals, shares its cache and cleans temporary images without producing assets',async t=>{
 const f=await setup(t);const imageUrls=['https://p16.tiktokcdn.com/one.jpeg','https://p16.tiktokcdn.com/two.jpeg'];
 await importPsychologyPeerHits(f.db,post(710,'photo',{imageUrls,caption:'Original post caption'}),'admin');await dispatchCopyExtractions(f.env);
 const objects=new Map();f.env.ARCHIVE={
  async put(k,b){objects.set(k,new Uint8Array(await new Response(b).arrayBuffer()));},
  async get(k){const b=objects.get(k);return b?{body:b,size:b.length}:null;},
  async delete(k){objects.delete(k);}
 };
 f.env.DEEPSEEK_API_KEY='test';let modelCalls=0;
 const words=['When closeness feels too much','Needing space does not mean you stopped caring.'];
 f.env.fetch=async(url,init)=>{
  if(imageUrls.includes(String(url))){const b=new Uint8Array(16);b.set([255,216,255,224]);return new Response(b,{headers:{'content-type':'image/jpeg'}});}
  if(String(url)==='https://api.deepseek.com/chat/completions'){
   modelCalls++;const body=JSON.parse(init.body);assert.match(body.messages[0].content[0].text,/COMPLETE verbatim visible text/);
   assert.equal(body.messages[0].content.filter(p=>p.type==='image_url').length,2);
   return Response.json({choices:[{message:{content:JSON.stringify({title:'Title',caption:'caption',hooks:['A','B','C'],scenes:words.map((text,i)=>({template:'stock',stockQuery:'sunset quiet room',sourceIndex:i+1,title:text,originalText:text}))})}}]});
  }
  throw new Error('Copy extraction must not generate or publish: '+url);
 };
 await runCopyExtraction(f.env,{payload:f.created[0]},steps());
 const row=f.sqlite.prepare('SELECT * FROM psychology_copy_library').get();assert.equal(row.status,'done');
 const content=JSON.parse(row.content_json);assert.deepEqual(content.pages,words.map((text,i)=>({index:i+1,text})));assert.equal(content.caption,'Original post caption');
 assert.equal(modelCalls,1);assert.equal(objects.size,0);assert.equal(f.requests.length,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
 const cache=JSON.parse(f.sqlite.prepare('SELECT copy_json FROM psychology_photo_copy_cache').get().copy_json);
 assert.deepEqual(cache.plan.scenes.map(s=>s.originalText),words);
});
