import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {importPsychologyPeerHits} from './psychology-peer-hits-store.js';
import {handlePsychologyCreative,normalizeVariant} from './psychology-creative.js';
import {comparisonUnits,validateComparison} from './psychology-copy-comparison.js';
const actor={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-copy-library']};
async function call(f,path,method='GET',body,user=actor,headers={}){const url=new URL('https://factory.test/api/psychology-creative/copies'+path);return handlePsychologyCreative(new Request(url,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),f.env,url,{user});}
const v={externalId:'review-test',title:'A new title',caption:'A new caption',pages:['New sentence one. New sentence two.','New third sentence.']};
async function setup(t){
 const f=await fixture(t);
 const result=await importPsychologyPeerHits(f.db,{mediaType:'photo',videoUrl:'https://www.tiktok.com/@example/photo/9901',title:'Original title',videoData:{language:'en',caption:'Original caption',pageTexts:['First original. Second original.','Third original.']},rewrites:[v]},'admin');
 f.sourceId=result.items[0].id;f.id=f.sqlite.prepare("SELECT id FROM psychology_copy_variants WHERE external_id=?").get(v.externalId).id;f.path='/'+f.id+'/comparison?sourceId='+f.sourceId;
 return f;
}
function responseFor(prompt){const {original,rewrite}=JSON.parse(prompt.split('INPUT_JSON:\n')[1]);const body=original.filter(u=>u.kind==='body');return {translations:[...original,...rewrite].map(u=>({id:u.id,zh:'中文：'+u.text})),matches:rewrite.filter(u=>u.kind==='body').map((u,i)=>({id:u.id,originalIds:i===2?[]:[body[1-i].id]}))};}
function provider(f,generate=responseFor){let calls=0;f.env.DEEPSEEK_API_KEY='test';f.env.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const prompt=JSON.parse(init.body).messages[0].content[0].text;return Response.json({choices:[{message:{content:JSON.stringify(await generate(prompt))}}]});};return ()=>calls;}
test('comparison uses exact source sentences, validates semantic refs and caches translated views',async t=>{
 const f=await setup(t),count=provider(f);
 const base=await (await call(f,f.path)).json();assert.equal(base.status,'pending');assert.equal(count(),0);assert.equal(base.original.filter(u=>u.kind==='body').length,3);
 const done=await (await call(f,f.path,'POST')).json();assert.equal(done.status,'done');assert.equal(count(),1);assert.deepEqual(done.rewrite[2].originalIds,['o3']);assert.deepEqual(done.rewrite.at(-1).originalIds,[]);assert.equal(done.original[3].text,'Second original.');assert.ok(done.rewrite.every(u=>u.zh));
 await call(f,f.path,'POST');await call(f,f.path);assert.equal(count(),1);
 f.sqlite.prepare('UPDATE psychology_copy_library SET content_json=json_set(content_json,\'$.title\',\'Updated title\') WHERE id=?').run(f.sourceId);
 assert.equal((await (await call(f,f.path)).json()).status,'pending');
});
test('ownership, roles, origin and source association checked before cached content or model access',async t=>{
 const f=await setup(t),count=provider(f);await call(f,f.path,'POST');
 assert.equal((await call(f,f.path,'GET',null,{...actor,username:'other'})).status,404);
 assert.equal((await call(f,f.path,'POST',null,{...actor,role:'operator'})).status,403);
 assert.equal((await call(f,f.path,'POST',null,actor,{origin:'https://evil.test'})).status,403);
 assert.equal((await call(f,'/'+f.id+'/comparison?sourceId=wrong','POST')).status,409);
 await call(f,'/'+f.id,'DELETE');assert.equal((await call(f,f.path)).status,404);assert.equal(count(),1);
});
test('concurrent comparison requests share one model call; invalid output is not cached and can retry',async t=>{
 const f=await setup(t);let release,started;const gate=new Promise(r=>{started=r;});const count=provider(f,async prompt=>{started();await new Promise(r=>release=r);return responseFor(prompt);});
 const first=call(f,f.path,'POST');await gate;
 assert.equal((await call(f,f.path,'POST')).status,202);assert.equal(count(),1);release();await first;
 f.sqlite.prepare("DELETE FROM psychology_copy_comparisons").run();provider(f,()=>({translations:[],matches:[]}));assert.equal((await call(f,f.path,'POST')).status,502);assert.equal(f.sqlite.prepare('SELECT lease_until FROM psychology_copy_comparisons').get().lease_until,0);
 const retried=provider(f);assert.equal((await (await call(f,f.path,'POST')).json()).status,'done');assert.equal(retried(),1);
});
function suppliedComparison(){
 return {original:['Original title','Original caption','First original.','Second original.','Third original.'].map(text=>({text,zh:'原文中文 '+text})),rewrite:[v.title,v.caption,'New sentence one.','New sentence two.','New third sentence.'].map((text,i)=>({text,zh:'改写中文 '+text,originalTexts:i<2?[]:i===4?[]:[i===2?'Second original.':'First original.']}))};
}
test('Grokbot translation and scores can enrich immutable existing rewrites and bypass DeepSeek',async t=>{
 const f=await setup(t),count=provider(f);
 const imported=await importPsychologyPeerHits(f.db,{mediaType:'photo',videoUrl:'https://www.tiktok.com/@example/photo/9901',rewrites:[{...v,score:93,scoreReason:'Clear hook',comparison:suppliedComparison()}]},'admin');
 assert.equal(imported.rewrites.duplicates,1);
 const done=await (await call(f,f.path,'POST')).json();assert.equal(done.provider,'grokbot');assert.equal(done.status,'done');assert.equal(count(),0);assert.deepEqual(done.rewrite[2].originalIds,['o3']);
 const list=await (await call(f,'?sourceId='+f.sourceId)).json();assert.equal(list.items[0].quality_score,93);assert.equal(list.items[0].score_reason,'Clear hook');assert.equal(list.items[0].comparison_json,undefined);
 // Resend without metadata preserves prior translations/score; deleted versions cannot be revived.
 await importPsychologyPeerHits(f.db,{mediaType:'photo',videoUrl:'https://www.tiktok.com/@example/photo/9901',rewrites:[v]},'admin');assert.equal((await (await call(f,f.path)).json()).provider,'grokbot');
 await call(f,'/'+f.id,'DELETE');await importPsychologyPeerHits(f.db,{mediaType:'photo',videoUrl:'https://www.tiktok.com/@example/photo/9901',rewrites:[{...v,score:99}]},'admin');assert.equal((await call(f,f.path)).status,404);
});
test('manual bulk import also accepts review metadata and sorts scores descending with zero before unscored',async t=>{
 const f=await setup(t);const path='?sourceId='+f.sourceId;
 await call(f,path,'POST',[{...v,externalId:'high',score:96},{...v,externalId:'zero',score:0},{...v,externalId:'mid',score:80}]);
 let rows=(await (await call(f,path)).json()).items;assert.deepEqual(rows.map(r=>r.quality_score),[96,80,0,null]);
 await call(f,path,'POST',[{...v,score:98,comparison:suppliedComparison()}]);rows=(await (await call(f,path)).json()).items;assert.equal(rows[0].quality_score,98);assert.equal((await (await call(f,f.path)).json()).provider,'grokbot');
 for(const score of [-1,101,'90',NaN])assert.throws(()=>normalizeVariant({...v,sourceKey:'x',score}));
 assert.throws(()=>normalizeVariant({...v,sourceKey:'x',comparison:{original:[],rewrite:[]}}));
});
test('sentence splitting supports video transcript and screen text; hallucinated refs/translations rejected',()=>{
 const orig=comparisonUnits({title:'Title',transcript:'First sentence. Second sentence.',onScreenText:['On screen']},'video','o');assert.equal(orig.length,4);
 const rewrite=comparisonUnits({pages:['Rewritten.']},'photo','r');
 const good={translations:[...orig,...rewrite].map(u=>({id:u.id,zh:'中文'})),matches:[{id:'r0',originalIds:['o1']}]};assert.equal(validateComparison(good,orig,rewrite).rewrite[0].text,'Rewritten.');
 assert.throws(()=>validateComparison({...good,matches:[{id:'r0',originalIds:['invented']}]},orig,rewrite));assert.throws(()=>validateComparison({...good,translations:good.translations.slice(1)},orig,rewrite));
});
