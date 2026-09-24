import { handlePsychologyOperations } from './psychology-operations.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {handlePsychologyCreative,normalizeVariant,copyIdentity} from './psychology-creative.js';
import {VISUAL_STYLES,chooseVisualStyle,styleById,STYLE_REPLACEMENTS,currentStyleBindings} from '../../public/psychology-visual-styles.js';
import {runPeerPhotoWorkflow} from './peer-photo-workflow.js';
import {enqueueAutoPhotoRender} from './psychology-auto-publish.js';
import {buildContentPerformance} from '../../scripts/psychology-content-performance.js';
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']};
const variant=n=>({externalId:'v'+n,sourceKey:'topic-1',title:'Title '+n,caption:'Caption '+n,pages:['Cover '+n,'A body paragraph '+n]});
function api(f,path,method='GET',body,actor=user){const url=new URL('https://factory.test/api/psychology-creative'+path);return handlePsychologyCreative(new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),f.env,url,{user:actor});}
test('twenty unique layouts and stable group assignment with account override',()=>{
 assert.equal(VISUAL_STYLES.length,20);assert.equal(new Set(VISUAL_STYLES.map(s=>s.layout)).size,20);
 const a={id:'a',groupId:'g'},group={kind:'group',target_id:'g',styles_json:'["night","letter"]'};
 assert.equal(chooseVisualStyle(a,[group]),chooseVisualStyle(a,[group]));assert.ok(['night','letter'].includes(chooseVisualStyle(a,[group])));
 assert.equal(chooseVisualStyle(a,[group,{kind:'account',target_id:'a',styles_json:'["memo"]'}]),'reassurance');assert.equal(chooseVisualStyle(a,[group],'legacy'),'');
});
test('copy import validates before writes and is immutable, idempotent and owner scoped',async t=>{
 const f=await fixture(t);assert.throws(()=>normalizeVariant({...variant(1),pages:['']}));
 await assert.rejects(api(f,'/copies','POST',[variant(1),{...variant(2),pages:[]}]));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_variants').get().n,0);
 const first=await (await api(f,'/copies','POST',[variant(1)])).json();assert.equal(first.created,1);assert.equal((await (await api(f,'/copies','POST',[variant(1)])).json()).duplicates,1);
 await assert.rejects(api(f,'/copies','POST',[{...variant(1),title:'Changed'}]),e=>e.statusCode===409);
 assert.equal((await (await api(f,'/copies','GET',undefined,{...user,username:'other'})).json()).total,0);
 await assert.rejects(api(f,'/bindings','PUT',{kind:'account',targetId:'outside',styles:['night']}),e=>e.statusCode===403);
});
test('random batches ignore account/group bindings, freeze styles and replay without redrawing',async t=>{
 const f=await fixture(t);await api(f,'/copies','POST',Array.from({length:20},(_,n)=>variant(n)));
 await api(f,'/bindings','PUT',{kind:'group',targetId:'g',styles:['night']});
 await api(f,'/bindings','PUT',{kind:'account',targetId:'a',styles:['letter']});
 let draws=0,forbidRedraw=false;t.mock.method(Math,'random',()=>{if(forbidRedraw)throw new Error('Must not redraw a saved job');return draws++/20;});
 // Old open pages send group mode; creation must also use the new random policy.
 const body=input({mediaType:'photo',template:'photo-text',sourceType:'copy-bank',count:20,connectionIds:['a'],styleMode:'group'});
 assert.equal((await f.call('POST',body)).status,202);
 const jobs=f.sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all();
 const styles=jobs.map(r=>JSON.parse(r.payload_json).psychologyAutomation.styleId);
 assert.deepEqual(styles,VISUAL_STYLES.map(s=>s.id));assert.equal(draws,20);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches').get().config_json).styleMode,'random');
 assert.deepEqual(f.sqlite.prepare('SELECT style_id FROM psychology_creative_snapshots ORDER BY item_id').all().map(r=>r.style_id),styles);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_peer_account_usage').get().n,20);
 await api(f,'/bindings','PUT',{kind:'account',targetId:'a',styles:['memo']});
 forbidRedraw=true;
 assert.equal((await f.call('POST',body)).status,200);
 const step={async do(name,config,fn){return (typeof config==='function'?config:fn)();},async sleep(){throw new Error('Unexpected wait');}};
 await runPeerPhotoWorkflow(f.env,{payload:{jobId:jobs[0].id}},step);
 await enqueueAutoPhotoRender(f.env,jobs[0].id);
 const render=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(jobs[0].id+'-render').payload_json);
 assert.equal(render.psychologyAutomation.styleId,styles[0]);
 assert.deepEqual(f.sqlite.prepare('SELECT style_id FROM psychology_creative_snapshots ORDER BY item_id').all().map(r=>r.style_id),styles);
});

test('an old group-assigned batch keeps its frozen style on a repeated submission',async t=>{
 const f=await fixture(t);await api(f,'/copies','POST',[variant(1)]);
 const body=input({mediaType:'photo',template:'photo-text',sourceType:'copy-bank',count:1,connectionIds:['a'],styleMode:'fixed',styleId:'night'});
 assert.equal((await f.call('POST',body)).status,202);
 const saved=JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches').get().config_json);
 saved.styleMode='group';
 f.sqlite.prepare('UPDATE psychology_publish_batches SET config_json=?').run(JSON.stringify(saved));
 t.mock.method(Math,'random',()=>{throw new Error('Historical batch must not be redrawn');});
 assert.equal((await f.call('POST',{...body,styleMode:'group'})).status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,1);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json).psychologyAutomation.styleId,'night');
});

test('imported copy bypasses external extraction and rewriting and persists exact comparison text',async t=>{
 const f=await fixture(t);await api(f,'/copies','POST',[variant(1)]);await f.call('POST',input({mediaType:'photo',template:'photo-text',sourceType:'copy-bank',count:1,connectionIds:['a'],styleMode:'fixed',styleId:'letter'}));
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs LIMIT 1').get();delete f.env.DEEPSEEK_API_KEY;
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected external call');});
 const step={async do(name,config,fn){return (typeof config==='function'?config:fn)();},async sleep(){throw new Error('Unexpected wait');}};
 await runPeerPhotoWorkflow(f.env,{payload:{jobId:job.id}},step);const result=JSON.parse(f.sqlite.prepare('SELECT result_json FROM factory_jobs WHERE id=?').get(job.id).result_json);
 assert.equal(result.results.length,2);assert.equal(result.results[0].title,'Cover 1');assert.equal(result.sourceCopyCache,'imported');
 await enqueueAutoPhotoRender(f.env,job.id);const snapshot=f.sqlite.prepare('SELECT * FROM psychology_creative_snapshots').get();assert.ok(snapshot.copy_hash);assert.deepEqual(JSON.parse(snapshot.copy_json).pages,['Cover 1','A body paragraph 1']);
 const render=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(job.id+'-render').payload_json);assert.equal(render.psychologyAutomation.styleId,'letter');
});
test('copy identity changes with per-page text or caption, independent of style',async()=>{
 const plan={title:'Title',caption:'Caption',scenes:[{title:'Cover'},{title:'Body'}]};assert.equal((await copyIdentity(plan)).hash,(await copyIdentity({...plan,style:'night'})).hash);assert.notEqual((await copyIdentity(plan)).hash,(await copyIdentity({...plan,caption:'Other'})).hash);
});
test('comparison joins exact task and account plus video, never batch or title, keeps missing metrics null',()=>{
 const now=Date.now(),accounts=[{schema:'tiktok:a',username:'alpha'},{schema:'tiktok:b',username:'beta'}];
 const items=['a','b'].map((id,n)=>({id:'task'+n,connection_id:id,config_json:'{"mediaType":"photo"}',source_key:'same',copy_hash:'samecopy',style_id:'night',copy_json:'{"title":"same"}'}));
 const records=[{id:'r1',autoTaskId:'task0',connectionId:'a',videoId:'101'},{id:'r2',autoTaskId:'task1',connectionId:'b',videoId:'202'}];
 const videosByAccount=new Map([['tiktok:a',[{id:'101',createTime:now-172800000,views:100,likes:2}]],['tiktok:b',[{id:'202',createTime:now-1000,views:700,comments:0}]]]);
 const result=buildContentPerformance({items,records,accounts,videosByAccount,now});assert.equal(result.coverage.matched,2);assert.equal(result.rows[0].views,100);assert.equal(result.rows[0].comments,null);assert.equal(result.rows[1].comments,0);assert.equal(result.rows[1].mature,false);
 assert.equal(buildContentPerformance({items,records,accounts:accounts.slice(0,1),videosByAccount,now}).rows.length,1);
 const wrong=buildContentPerformance({items,records:[{...records[0],connectionId:'b'}],accounts,videosByAccount,now});assert.ok(!wrong.rows.some(r=>r.id==='task0'));
});

test('operations endpoint reads creative joins with existing scope and reports empty coverage honestly',async t=>{
 const f=await fixture(t),url=new URL('https://factory.test/api/psychology-operations?period=7d');
 const response=await handlePsychologyOperations(new Request(url),f.env,url,{user:{...user,sidebarModules:['psychology-ops-report']}});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.content.coverage.total,0);
 assert.equal(result.framework.overview.current.n,0);assert.equal(result.framework.overview.daily.length,7);assert.match(result.framework.strategy.findings[0],/样本不足/);
 assert.equal(result.evolution.exploitShare,0.7);assert.equal(result.framework.media,'photo');
 const videoUrl=new URL('https://factory.test/api/psychology-operations?period=7d&media=video');
 const video=await (await handlePsychologyOperations(new Request(videoUrl),f.env,videoUrl,{user:{...user,sidebarModules:['psychology-ops-report']}})).json();
 assert.equal(video.framework.media,'video');assert.match(video.framework.strategy.findings[0],/自动发布视频/);
});

test('replacement pool retains seven originals and archives old layouts for frozen jobs',()=>{
 const retained=['classic','editorial','night','letter','dialogue','quote','minimal'];
 assert.equal(Object.keys(STYLE_REPLACEMENTS).length,13);
 for(const id of retained)assert.ok(VISUAL_STYLES.some(s=>s.id===id));
 for(const [oldId,newId] of Object.entries(STYLE_REPLACEMENTS)){
  assert.ok(!VISUAL_STYLES.some(s=>s.id===oldId));assert.ok(VISUAL_STYLES.some(s=>s.id===newId));
  assert.equal(styleById(oldId).id,oldId);assert.notEqual(styleById(oldId).layout,styleById(newId).layout);
  assert.equal(chooseVisualStyle({id:'a'},[],'fixed',oldId),newId);
  const oldBinding={kind:'account',target_id:'a',styles_json:JSON.stringify([oldId])};
  assert.equal(chooseVisualStyle({id:'a'},[oldBinding]),newId);
  assert.deepEqual(JSON.parse(currentStyleBindings([oldBinding])[0].styles_json),[newId]);
 }
});


test('new photo submissions default to random while explicit fixed/legacy and video stay supported',async()=>{
 const {normalizeAutoPublish}=await import('../../scripts/psychology-auto-publish.js');
 const photo=input({mediaType:'photo',template:'photo-text'});
 assert.equal(normalizeAutoPublish(photo).styleMode,'random');
 assert.equal(normalizeAutoPublish({...photo,styleMode:'random'}).styleMode,'random');
 assert.equal(normalizeAutoPublish({...photo,styleMode:'group'}).styleMode,'random');
 assert.equal(normalizeAutoPublish({...photo,styleMode:'fixed',styleId:'night'}).styleMode,'fixed');
 assert.equal(normalizeAutoPublish({...photo,styleMode:'legacy'}).styleMode,'legacy');
 assert.equal(normalizeAutoPublish(input({styleMode:'random'})).styleMode,'legacy');
 assert.throws(()=>normalizeAutoPublish({...photo,styleMode:'unknown'}));
});


test('source details isolate exact originals and owners, paginate versions and allow library-only administrators',async t=>{
 const f=await fixture(t),actor={...user,sidebarModules:['psychology-copy-library']};
 f.sqlite.exec("UPDATE psychology_copy_library SET status='done'");
 const source=f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE source_url LIKE '%/photo/200'").get();
 const path='/copies?sourceId='+source.id;
 const variants=Array.from({length:23},(_,n)=>({...variant(n),sourceKey:undefined}));
 assert.equal((await (await api(f,path,'POST',variants,actor)).json()).created,23);
 await api(f,'/copies','POST',[{...variant('other'),sourceKey:'v1:tiktok:2000'}]);
 await api(f,path,'POST',[{...variant('foreign'),sourceKey:undefined}],{...actor,username:'other'});
 const first=await (await api(f,path,'GET',undefined,actor)).json();
 assert.equal(first.total,23);assert.equal(first.items.length,20);assert.ok(first.items.every(r=>r.source_key==='v1:tiktok:200'&&r.owner==='admin'));
 assert.equal((await (await api(f,path+'&page=2','GET',undefined,actor)).json()).items.length,3);
 assert.equal((await (await api(f,path+'&q=missing','GET',undefined,actor)).json()).total,0);
 const disabled=first.items[0];await api(f,'/copies/'+disabled.id,'PATCH',{enabled:false},actor);
 const {handlePsychologyCopyLibrary}=await import('./psychology-copy-library.js');
 const url=new URL('https://factory.test/api/psychology-copy-library');
 const library=await (await handlePsychologyCopyLibrary(new Request(url),f.env,url,{user:actor})).json();
 const row=library.items.find(r=>r.id===source.id);assert.equal(row.variantCount,23);assert.equal(row.enabledVariantCount,22);
 assert.equal(library.items.find(r=>r.source_url.endsWith('/201')).variantCount,0);
 await assert.rejects(api(f,'/copies/'+disabled.id,'PATCH',{enabled:true},{...actor,username:'other'}),e=>e.statusCode===404);
 assert.equal((await api(f,path,'GET',undefined,{...actor,role:'operator'})).status,403);
 assert.equal((await api(f,'/bindings','GET',undefined,actor)).status,403);
 assert.equal(f.requests.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
});

test('source-bound imports reject mismatched sources and incomplete originals before writing',async t=>{
 const f=await fixture(t);f.sqlite.exec("UPDATE psychology_copy_library SET status='done'");
 const source=f.sqlite.prepare('SELECT id FROM psychology_copy_library LIMIT 1').get(),path='/copies?sourceId='+source.id;
 await assert.rejects(api(f,path,'POST',[{...variant(1),sourceKey:undefined},variant(2)]),/来源与当前爆款文案不一致/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_variants').get().n,0);
 await assert.rejects(api(f,'/copies?sourceId=missing','POST',[variant(1)]),e=>e.statusCode===404);
 f.sqlite.exec("UPDATE psychology_copy_library SET status='queued'");
 await assert.rejects(api(f,path,'GET'),e=>e.statusCode===404);
});


for(const origin of ['photo','video'])for(const output of ['photo','video'])test('completed '+origin+' copy feeds '+output+' production with frozen text and no repeated media extraction',async t=>{
 const f=await fixture(t),source=f.sqlite.prepare('SELECT id FROM psychology_copy_library WHERE media_type=? LIMIT 1').get(origin);
 const content={title:'Unique source idea',caption:'Source caption',pages:origin==='photo'?[{index:1,text:'First original page'},{index:2,text:'Second original page'}]:[],transcript:origin==='video'?'Original spoken words about asking for connection.':'',onScreenText:origin==='video'?['Visible original words']:[]};
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',title='Unique source idea',content_json=? WHERE id=?").run(JSON.stringify(content),source.id);
 const body=input({sourceType:'copy-library',selection:'recent',libraryMediaType:origin,mediaType:output,template:output==='photo'?'photo-text':'psychology-collage',count:1,connectionIds:['a'],query:'Unique source idea'});
 if(output==='photo')delete f.env.KIE_API_KEY;
 assert.equal((await f.call('POST',body)).status,202);
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs').get(),payload=JSON.parse(job.payload_json);
 assert.deepEqual(payload.copySource.content,content);assert.equal(payload.copySource.mediaType,origin);
 if(output==='video'){assert.match(payload.script,origin==='photo'?/First original page\n\nSecond original page/:/Original spoken words/);assert.equal(payload.copySource.kind,'original');}
 else {
  assert.ok(payload.copyVariant.scenes.length);t.mock.method(globalThis,'fetch',async()=>{throw new Error('Stored copy must not fetch media or call AI');});
  const step={async do(name,config,fn){return (typeof config==='function'?config:fn)();},async sleep(){throw new Error('Unexpected wait');}};
  await runPeerPhotoWorkflow(f.env,{payload:{jobId:job.id}},step);
  const result=JSON.parse(f.sqlite.prepare('SELECT result_json FROM factory_jobs WHERE id=?').get(job.id).result_json);assert.equal(result.sourceCopyCache,'imported');
  assert.deepEqual(result.results.map(r=>r.originalText),payload.copyVariant.scenes.map(r=>r.originalText));
 }
 f.sqlite.prepare("UPDATE psychology_copy_library SET content_json='{}' WHERE id=?").run(source.id);
 assert.equal((await f.call('POST',body)).status,200);assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(job.id).payload_json).copySource.content,content);
 assert.equal(f.requests.length,0);
});

test('deleted rewrites disappear from the list, cannot be re-enabled and are not re-imported',async t=>{
 const f=await fixture(t);await api(f,'/copies','POST',[variant(1),variant(2)]);
 const row=f.sqlite.prepare("SELECT id FROM psychology_copy_variants WHERE external_id='v1'").get();
 await assert.rejects(api(f,'/copies/'+row.id,'DELETE',undefined,{...user,username:'other'}),/文案不存在/);
 assert.equal((await api(f,'/copies/'+row.id,'DELETE')).status,200);
 assert.deepEqual((await (await api(f,'/copies')).json()).items.map(r=>r.external_id),['v2']);
 await assert.rejects(api(f,'/copies/'+row.id,'PATCH',{enabled:true}),/文案不存在/);
 assert.equal((await (await api(f,'/copies','POST',[variant(1)])).json()).duplicates,1);
 assert.deepEqual({...f.sqlite.prepare("SELECT enabled,deleted_at>0 d FROM psychology_copy_variants WHERE id=?").get(row.id)},{enabled:0,d:1});
});

test('video production draws only enabled own rewrites and freezes the exact selected version',async t=>{
 const f=await fixture(t);await api(f,'/copies','POST',[variant(1),variant(2)]);
 const disabled=f.sqlite.prepare("SELECT id FROM psychology_copy_variants WHERE external_id='v2'").get();await api(f,'/copies/'+disabled.id,'PATCH',{enabled:false});
 await api(f,'/copies','POST',[variant(3)],{...user,username:'other'});
 const body=input({sourceType:'copy-bank',mediaType:'video',template:'psychology-collage',count:1,connectionIds:['a']});
 assert.equal((await f.call('POST',body)).status,202);const saved=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json);
 assert.equal(saved.copySource.variantId,'v1');assert.equal(saved.script,'Cover 1\n\nA body paragraph 1');assert.equal(f.requests.length,0);
 await assert.rejects(f.call('POST',{...body,requestId:crypto.randomUUID()}),/未使用爆款不足/);
});

test('original selection excludes unfinished rows, respects origin filter, and rejects oversized text before creating jobs',async t=>{
 const f=await fixture(t),source=f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE media_type='video' LIMIT 1").get();
 const body=input({sourceType:'copy-library',selection:'recent',libraryMediaType:'video',mediaType:'video',template:'psychology-collage',count:1,connectionIds:['a']});
 await assert.rejects(f.call('POST',body),/只有 0 条/);
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(JSON.stringify({title:'Long',transcript:'x'.repeat(5001)}),source.id);
 await assert.rejects(f.call('POST',body),/5000字符/);
 await assert.rejects(f.call('POST',{...body,libraryMediaType:'photo'}),/只有 0 条/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);
 const {textPages}=await import('./psychology-copy-source.js');const text='Every word stays. '.repeat(110);
 assert.equal(textPages([text]).join(' ').replace(/\s+/g,' ').trim(),text.trim());
 assert.throws(()=>textPages(['x'.repeat(9001)]),/超过6页/);
});


test('AI rewrite uses stored photo/video text and existing DeepSeek model without saving or publishing',async t=>{
 const f=await fixture(t);f.env.DEEPSEEK_API_KEY='test-key';
 const draft={name:'情绪共鸣版',title:'Why silence feels so loud',caption:'What helps you feel safe? #attachment',pages:['Why silence feels so loud','Give yourself room to pause.']};
 let calls=0;f.env.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(init.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.messages[0].content.length,1);assert.match(body.messages[0].content[0].text,/stored original/);return Response.json({choices:[{message:{content:JSON.stringify(draft)}}]});};
 const jobs=f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n;
 for(const media of ['photo','video']){
  const row=f.sqlite.prepare('SELECT id FROM psychology_copy_library WHERE media_type=? LIMIT 1').get(media);
  f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(JSON.stringify({title:'Source',caption:'stored original',...(media==='photo'?{pages:[{text:'First original'},{text:'Second original'}]}:{transcript:'Original spoken words'})}),row.id);
  const data=await (await api(f,'/copies/generate?sourceId='+row.id,'POST')).json();assert.deepEqual(data.draft,draft);
 }
 assert.equal(calls,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_variants').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,jobs);
});

test('AI rewrite checks permission, origin and completed source before calling provider; validates output and redacts failures',async t=>{
 const f=await fixture(t);let calls=0;f.env.DEEPSEEK_API_KEY='secret-test-key';f.env.fetch=async()=>{calls++;throw new Error('secret-test-key provider detail');};
 const row=f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE media_type='photo' LIMIT 1").get();const path='/copies/generate?sourceId='+row.id;
 assert.equal((await api(f,path,'POST',null,{...user,role:'operator'})).status,403);
 assert.equal((await api(f,'/copies/generate','POST')).status,400);
 assert.equal((await api(f,path,'GET')).status,405);
 assert.equal((await api(f,path,'POST')).status,404);
 const url=new URL('https://factory.test/api/psychology-creative'+path);assert.equal((await handlePsychologyCreative(new Request(url,{method:'POST',headers:{Origin:'https://foreign.test'}}),f.env,url,{user})).status,403);assert.equal(calls,0);
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(JSON.stringify({pages:[]}),row.id);
 await assert.rejects(api(f,path,'POST'),e=>e.statusCode===400);assert.equal(calls,0);
 f.sqlite.prepare('UPDATE psychology_copy_library SET content_json=? WHERE id=?').run(JSON.stringify({pages:[{text:'Original'}]}),row.id);
 await assert.rejects(api(f,path,'POST'),e=>e.statusCode===502&&!e.message.includes('secret-test-key'));assert.equal(calls,1);
 for(const response of ['invalid JSON',JSON.stringify({name:'Draft',title:'Title',caption:'Caption',pages:[]}),JSON.stringify({name:'Draft',title:'Title',caption:'Caption',pages:['#tag']}),JSON.stringify({name:'Draft',title:'Title',caption:'Caption',pages:['One','Extra']})]){
  f.env.fetch=async()=>Response.json({choices:[{message:{content:response}}]});await assert.rejects(api(f,path,'POST'),e=>e.statusCode===502);
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_variants').get().n,0);
});
