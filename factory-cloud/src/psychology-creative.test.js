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
test('batch freezes group styles and imported copy; repeated source-account is reserved',async t=>{
 const f=await fixture(t);await api(f,'/copies','POST',[variant(1),variant(2)]);await api(f,'/bindings','PUT',{kind:'group',targetId:'g',styles:['night']});
 const body=input({mediaType:'photo',template:'photo-text',sourceType:'copy-bank',count:2,styleMode:'group'});
 assert.equal((await f.call('POST',body)).status,202);
 const rows=f.sqlite.prepare('SELECT payload_json FROM factory_jobs ORDER BY id').all().map(r=>JSON.parse(r.payload_json));assert.equal(rows.length,2);assert.ok(rows.every(r=>r.psychologyAutomation.styleId==='night'&&r.copyVariant.scenes.length===2));
 await api(f,'/bindings','PUT',{kind:'group',targetId:'g',styles:['memo']});assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs LIMIT 1').get().payload_json).psychologyAutomation.styleId,'night');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_creative_snapshots').get().n,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_peer_account_usage').get().n,2);
 assert.equal((await f.call('POST',body)).status,200);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,2);
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
