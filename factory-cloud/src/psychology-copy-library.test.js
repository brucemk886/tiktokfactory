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

test('library only returns completed originals with type/search pagination and permissions',async t=>{
 const f=await setup(t);await importPsychologyPeerHits(f.db,Array.from({length:25},(_,n)=>post(100+n,n%2?'photo':'video',{caption:'caption only'})),'admin');
 const pending=await (await api(f)).json();assert.equal(pending.total,0);assert.deepEqual(pending.items,[]);
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=?").run(JSON.stringify({mediaType:'video',title:'Extracted',caption:'caption',pages:[],transcript:'Original words',onScreenText:[]}));
 const all=await (await api(f)).json();assert.equal(all.items.length,20);assert.equal(all.total,25);assert.ok(all.items.every(r=>r.status==='done'&&r.content.transcript==='Original words'));
 assert.equal((await (await api(f,'?page=2')).json()).items.length,5);
 const photos=await (await api(f,'?mediaType=photo')).json();assert.equal(photos.total,12);assert.ok(photos.items.every(r=>r.media_type==='photo'));
 assert.equal((await (await api(f,'?q=missing')).json()).total,0);
 assert.equal((await api(f,'','GET',{...actor,role:'operator'})).status,403);
 assert.equal((await api(f,'','GET',{...actor,sidebarModules:[]})).status,403);
});

test('historical rows opted out of extraction stay hidden and cannot occupy the future-import lane',async t=>{
 const f=await setup(t);await importPsychologyPeerHits(f.db,post(801),'admin');
 f.sqlite.prepare("UPDATE psychology_copy_library SET auto_extract=0,status='running'").run();
 await importPsychologyPeerHits(f.db,post(802),'admin');await dispatchCopyExtractions(f.env);
 assert.equal(f.created.length,1);
 const old=f.sqlite.prepare("SELECT status FROM psychology_copy_library WHERE source_url LIKE '%/801'").get();assert.equal(old.status,'running');
 const active=f.sqlite.prepare("SELECT source_url FROM psychology_copy_library WHERE status='running' AND auto_extract=1").get();assert.match(active.source_url,/\/802$/);
 assert.equal((await (await api(f)).json()).total,0);
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
 assert.match(read('psychology-copy-library.html'),/videoHitsTab/);assert.match(read('psychology-copy-library.html'),/id="copies"/);
 assert.match(read('psychology-copy-library.html'),/id="hitRows"/);assert.match(read('psychology-copy-library.html'),/id="copyPreviewDialog"/);
 assert.match(read('psychology-peer-hits.js'),/data-view-original/);assert.match(read('psychology-copy-library.css'),/copy-table-wrap/);
 assert.match(read('psychology-copy-library.html'),/id="libraryStatus"><option value="done">已提取文案/);
 assert.match(read('psychology-copy-library.html'),/id="bulkImportButton"/);
 assert.match(read('psychology-auto-publish.html'),/psychology-copy-library/);
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


test('unified records join exact source metrics, sort/filter/search, and retain copy after source removal',async t=>{
 const f=await setup(t);
 await importPsychologyPeerHits(f.db,[{...post(900,'photo',{pageTexts:['First original']}),playCount:80,accountUsername:'@alpha'},{...post(901,'photo',{pageTexts:['Second original']}),playCount:1000,accountUsername:'@beta'},post(902,'video'),post(903,'photo'),post(904,'video')],'admin');
 await dispatchCopyExtractions(f.env);
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='failed',error='Provider declined' WHERE source_url LIKE '%/903'").run();
 f.sqlite.prepare("UPDATE psychology_copy_library SET auto_extract=0,status='queued' WHERE source_url LIKE '%/904'").run();
 const ready=await (await api(f,'?mediaType=photo&sort=plays')).json();assert.equal(ready.total,2);assert.equal(ready.items[0].peer.playCount,1000);assert.equal(ready.items[0].content.pages[0].text,'Second original');assert.equal(ready.canManageSources,false);
 const all=await (await api(f,'?status=all')).json();assert.equal(all.total,5);assert.equal(new Set(all.items.map(r=>r.id)).size,5);
 assert.equal((await (await api(f,'?q=@beta')).json()).total,1);
 assert.equal((await (await api(f,'?status=failed')).json()).items[0].error,'Provider declined');
 assert.equal((await (await api(f,'?status=historical')).json()).total,1);
 assert.equal((await (await api(f,'?status=queued')).json()).total,0);
 assert.equal((await api(f,'?sort=invalid')).status,400);assert.equal((await api(f,'?status=invalid')).status,400);
 const row=ready.items[0];f.sqlite.prepare('DELETE FROM psychology_peer_hits WHERE id=?').run(row.id);
 const retained=(await (await api(f,'?mediaType=photo')).json()).items.find(r=>r.id===row.id);assert.equal(retained.peer,null);assert.equal(retained.content.pages[0].text,'Second original');
 assert.equal(f.requests.length,0);
});

test('unified copy access preserves source-management permissions and admin-only boundaries',async t=>{
 const f=await setup(t);const peerUser={...actor,id:'admin',sidebarModules:['psychology-peer-hits']};
 assert.equal((await (await api(f,'?status=all','GET',peerUser)).json()).canManageSources,true);
 assert.equal((await api(f,'?status=all','GET',{...peerUser,role:'operator'})).status,403);
 const {handlePsychologyPeerHits}=await import('./psychology-peer-hits.js');const url=new URL('https://factory.test/api/psychology-peer-hits/api-key');
 assert.equal((await handlePsychologyPeerHits(new Request(url),f.env,url,{user:actor})).status,403);
 const {SIDEBAR_MODULES,canAccessPath}=await import('./sidebar.js');
 assert.equal(SIDEBAR_MODULES.find(r=>r.id==='psychology-peer-hits').navigationParent,'psychology-copy-library');
 assert.equal(SIDEBAR_MODULES.filter(r=>r.group?.id==='psychology'&&!r.navigationParent&&r.label==='文案库').length,1);
 assert.equal(canAccessPath(peerUser,'/psychology-copy-library'),true);assert.equal(canAccessPath({...peerUser,role:'operator'},'/psychology-copy-library'),false);
 const {handlePsychologyCreative}=await import('./psychology-creative.js');const copies=new URL('https://factory.test/api/psychology-creative/copies');
 assert.equal((await handlePsychologyCreative(new Request(copies),f.env,copies,{user:peerUser})).status,200);
});

test('old peer URLs redirect to the unified page preserving media selection after authentication',async t=>{
 const f=await setup(t);const {sha256Hex}=await import('./http.js');const {default:worker}=await import('./index.js');
 f.sqlite.prepare('INSERT INTO factory_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)').run(await sha256Hex('test-session'),'admin',Date.now()+60000,Date.now(),Date.now());
 for(const path of ['/psychology-peer-hits','/psychology-peer-hits.html']){
  const response=await worker.fetch(new Request('https://factory.test'+path+'?mediaType=photo',{headers:{cookie:'lf_session=test-session'}}),f.env,{});
  assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/psychology-copy-library?mediaType=photo');
 }
 const guest=await worker.fetch(new Request('https://factory.test/psychology-peer-hits'),f.env,{});assert.equal(guest.headers.get('location'),'/login');
});

test('the old recreation board redirects into the manual view of publish records keeping the job',async t=>{
 const f=await setup(t);const {sha256Hex}=await import('./http.js');const {default:worker}=await import('./index.js');
 const {canAccessPath}=await import('./sidebar.js');
 f.sqlite.prepare('INSERT INTO factory_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)').run(await sha256Hex('board-session'),'admin',Date.now()+60000,Date.now(),Date.now());
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json=? WHERE id='admin'").run(JSON.stringify(['psychology-production','psychology-peer-hits']));
 for(const path of ['/psychology-production','/psychology-production.html']){
  const response=await worker.fetch(new Request('https://factory.test'+path+'?job=psy-1',{headers:{cookie:'lf_session=board-session'}}),f.env,{});
  assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/psychology-publish-sources?job=psy-1&view=manual');
 }
 // A grant for only the old board still opens the merged page; operators stay out.
 assert.equal(canAccessPath({role:'admin',sidebarModules:['psychology-production']},'/psychology-publish-sources'),true);
 assert.equal(canAccessPath({role:'operator',sidebarModules:['psychology-production','psychology-publish-sources']},'/psychology-publish-sources'),false);
});


async function deleteCopies(f,ids,{user={...actor,sidebarModules:['psychology-peer-hits']},origin}={}){
 const url=new URL('https://factory.test/api/psychology-copy-library');
 return handlePsychologyCopyLibrary(new Request(url,{method:'DELETE',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify({ids})}),f.env,url,{user});
}
test('bulk deletion removes selected originals and peers, tombstones linked rewrites, and preserves job snapshots',async t=>{
 const f=await setup(t);const imported=await importPsychologyPeerHits(f.db,[post(900,'photo',{pageTexts:['Keep breathing']}),post(901,'video',{transcript:'Original video words'}),post(902,'photo',{pageTexts:['Unrelated copy']})],'admin');
 const ids=imported.items.map(i=>i.id);const keys=ids.map(id=>photoCopyKey(f.sqlite.prepare('SELECT source_url FROM psychology_copy_library WHERE id=?').get(id).source_url));
 for(let i=0;i<3;i++){f.sqlite.prepare('INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('v'+i,'admin','version'+i,keys[i],'Title','Caption','["Words"]','fp'+i,1);f.sqlite.prepare('INSERT INTO psychology_copy_comparisons(variant_id,fingerprint,updated_at) VALUES (?,?,?)').run('v'+i,'fp'+i,1);}
 f.sqlite.prepare('INSERT INTO psychology_creative_snapshots(item_id,source_key,copy_json) VALUES (?,?,?)').run('published-item',keys[0],'{"title":"Preserved"}');
 f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,title,payload_json,created_by,created_at,updated_at) VALUES ('active-job','psychology','running','Preserved','{}','admin',1,1)").run();
 const before=f.sqlite.prepare('SELECT * FROM factory_jobs').all();
 assert.equal((await (await deleteCopies(f,[ids[0],ids[1],ids[0]])).json()).deleted,2);
 assert.deepEqual(f.sqlite.prepare('SELECT id FROM psychology_copy_library').all().map(r=>r.id),[ids[2]]);assert.deepEqual(f.sqlite.prepare('SELECT id FROM psychology_peer_hits').all().map(r=>r.id),[ids[2]]);
 const variants=f.sqlite.prepare('SELECT id,enabled,deleted_at FROM psychology_copy_variants ORDER BY id').all();assert.equal(variants[0].enabled,0);assert.ok(variants[1].deleted_at>0);assert.equal(variants[2].enabled,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_comparisons').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_creative_snapshots').get().n,1);assert.deepEqual(f.sqlite.prepare('SELECT * FROM factory_jobs').all(),before);
 assert.equal((await(await deleteCopies(f,[ids[0]])).json()).deleted,0);
});
test('bulk deletion validates scope and rolls back on database failure',async t=>{
 const f=await setup(t);const id=(await importPsychologyPeerHits(f.db,post(910),'admin')).items[0].id;
 for(const ids of [[],['bad'],Array(21).fill(id)])assert.equal((await deleteCopies(f,ids)).status,400);
 assert.equal((await deleteCopies(f,[id],{user:actor})).status,403);assert.equal((await deleteCopies(f,[id],{user:{...actor,role:'operator'}})).status,403);assert.equal((await deleteCopies(f,[id],{origin:'https://evil.test'})).status,403);
 f.sqlite.exec("CREATE TRIGGER reject_copy_delete BEFORE DELETE ON psychology_copy_library BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
 await assert.rejects(deleteCopies(f,[id]),/test rollback/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_peer_hits').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_library').get().n,1);
});
