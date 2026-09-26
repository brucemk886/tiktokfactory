import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {startTopicImage,topicImageStatus,runTopicImageWorkflow,inspectPng} from './topic-image-operation.js';
import {handlePsychologyTopicBank,writeIntegrationTopics} from './psychology-topic-bank.js';
import {hydrateTopicAssets} from './topic-assets.js';
const user={id:'admin',role:'admin',sidebarModules:['psychology-topic-bank']};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK2cAAAAASUVORK5CYII=','base64');
const input=(extra={})=>({requestId:crypto.randomUUID(),title:'Why closeness feels scary',content:'A gentle reflection',imagePrompt:'An abstract quiet garden, no text',...extra});
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(user.sidebarModules));
 const objects=new Map(),workflows=new Map(),calls=[];
 f.env.OPENAI_API_KEY='test-only';f.env.ARCHIVE={async put(k,b,o){objects.set(k,{size:b.length,customMetadata:o.customMetadata,body:b});},async head(k){return objects.get(k)||null;},async get(k){return objects.get(k)||null;}};
 f.env.TOPIC_IMAGE_WORKFLOW={async create(v){if(workflows.has(v.id))throw Error('exists');workflows.set(v.id,v);},async get(id){if(!workflows.has(id))throw Error('missing');return {async status(){return {status:'queued'};}};}};
 f.env.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/images/generations');calls.push(JSON.parse(init.body));return Response.json({data:[{b64_json:png.toString('base64')}]},{headers:{'x-request-id':'test-provider'}});};
 f.run=requestId=>runTopicImageWorkflow(f.env,{payload:{ownerId:'admin',requestId}},{async do(name,config,fn){if(name==='generate-and-store')assert.equal(config.retries.limit,0);return fn();}});
 f.status=requestId=>topicImageStatus(f.env,user,requestId,'https://factory.test');
 f.topic=async(id,method='GET',body,actor=user)=>{const req=new Request('https://factory.test/api/integrations/psychology/template-topics/'+id,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return handlePsychologyTopicBank(req,f.env,new URL(req.url),null,{user:actor});};
 return {...f,objects,workflows,calls};
}
test('generation is asynchronous, stored and disabled by default; repeat never bills or imports twice',async t=>{
 const f=await setup(t),i=input();assert.equal((await startTopicImage(f.env,user,i)).status,'pending');assert.equal(f.calls.length,0);
 await f.run(i.requestId);const done=await f.status(i.requestId);assert.equal(done.status,'completed');assert.equal(done.topic.enabled,false);assert.equal(done.asset.width,1);assert.equal(done.asset.sha256.length,64);assert.match(done.asset.url,/^https:\/\/factory.test\/api\/psychology-template-topics\/assets/);
 assert.deepEqual(f.calls[0],{model:'gpt-image-2',prompt:i.imagePrompt,size:'1024x1536',n:1,quality:'medium',output_format:'png'});
 for(let n=0;n<2;n++){await startTopicImage(f.env,user,i);await f.run(i.requestId);}assert.equal(f.calls.length,1);assert.equal(f.objects.size,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);assert.equal(f.requests.length,0);
 const row=(await (await f.topic(done.topic.id)).json()).item;assert.equal(row.coverAssetId,done.asset.id);assert.equal(row.coverAsset.id,done.asset.id);
});
test('single-image quiz binds real image key with A/B/C/D and preserves metadata on edits',async t=>{
 const f=await setup(t),i=input({template:'psychology-target-2',choices:['A','B','C','D'].map(copy=>({copy}))});await startTopicImage(f.env,user,i);await f.run(i.requestId);const done=await f.status(i.requestId);
 let row=(await (await f.topic(done.topic.id)).json()).item;assert.equal(row.choices.length,4);assert.match(row.image.imageKey,/^psychology-topics\//);
 const edit=await f.topic(row.id,'PATCH',{revision:row.revision,title:'Changed title'});assert.equal(edit.status,200);row=(await edit.json()).item;assert.equal(row.coverAssetId,done.asset.id);assert.equal(row.choices.length,4);
 assert.equal((await f.topic(row.id,'PATCH',{revision:1,title:'stale'})).status,409);
});
test('input, missing config, and permission failures cannot trigger provider calls',async t=>{
 const f=await setup(t);delete f.env.OPENAI_API_KEY;await assert.rejects(startTopicImage(f.env,user,input()),e=>e.code==='OPENAI_NOT_CONFIGURED');f.env.OPENAI_API_KEY='test';
 for(const extra of [{template:'psychology'},{template:'psychology-target-2'},{imageSize:'9999x9999'},{ownerId:'other'},{title:''}])await assert.rejects(startTopicImage(f.env,user,input(extra)));
 await assert.rejects(startTopicImage(f.env,{...user,role:'operator'},input()),e=>e.statusCode===403);assert.equal(f.calls.length,0);assert.equal(f.workflows.size,0);
});
test('same UUID with different content conflicts, status is owner-scoped, concurrent starts share operation',async t=>{
 const f=await setup(t),i=input();await Promise.all([startTopicImage(f.env,user,i),startTopicImage(f.env,user,i)]);assert.equal(f.workflows.size,1);
 await assert.rejects(startTopicImage(f.env,user,{...i,title:'Different'}),e=>e.code==='REQUEST_ID_CONFLICT');await assert.rejects(topicImageStatus(f.env,{...user,id:'other'},i.requestId),e=>e.statusCode===404);await f.run(i.requestId);assert.equal(f.calls.length,1);
});
test('ambiguous provider response is never automatically generated again',async t=>{
 const f=await setup(t),i=input();let n=0;f.env.fetch=async()=>{n++;throw Error('timeout');};await startTopicImage(f.env,user,i);await f.run(i.requestId);assert.equal((await f.status(i.requestId)).status,'unknown');await startTopicImage(f.env,user,i);await f.run(i.requestId);assert.equal(n,1);assert.equal(f.objects.size,0);
});
test('R2 acknowledged failure with durable bytes is recovered without a second generation',async t=>{
 const f=await setup(t),i=input(),put=f.env.ARCHIVE.put;f.env.ARCHIVE.put=async(...args)=>{await put(...args);throw Error('connection lost after put');};await startTopicImage(f.env,user,i);await f.run(i.requestId);assert.equal((await f.status(i.requestId)).status,'completed');assert.equal(f.calls.length,1);
});
test('import failure preserves image and supports retry with the same request ID',async t=>{
 const f=await setup(t),i=input(),batch=f.db.batch;f.db.batch=async()=>{throw Error('temporary D1 error');};await startTopicImage(f.env,user,i);await f.run(i.requestId);let status=await f.status(i.requestId);assert.equal(status.errorCode,'IMPORT_PENDING');assert.equal(f.objects.size,1);
 f.db.batch=batch;delete f.env.OPENAI_API_KEY;status=await startTopicImage(f.env,user,i);assert.equal(status.status,'completed');assert.equal(f.calls.length,1);
});
test('permission revocation before execution stops a queued paid request',async t=>{
 const f=await setup(t),i=input();await startTopicImage(f.env,user,i);f.sqlite.exec('UPDATE factory_users SET active=0');await f.run(i.requestId);assert.equal((await f.status(i.requestId)).errorCode,'PERMISSION_REVOKED');assert.equal(f.calls.length,0);
});
test('foreign assets are rejected before import and revision update; invalid batches are atomic',async t=>{
 const f=await setup(t),i=input();await startTopicImage(f.env,user,i);await f.run(i.requestId);const done=await f.status(i.requestId);
 await assert.rejects(writeIntegrationTopics(f.db,{template:'psychology-collage',items:[{title:'Foreign',coverAssetId:done.asset.id}]},'other'),e=>e.statusCode===403);
 const response=await f.topic(done.topic.id,'PATCH',{revision:done.topic.revision,coverAssetId:done.asset.id},{...user,id:'other'});assert.equal(response.status,403);
 for(const body of [null,{items:'not array'},{items:[null]}])await assert.rejects(writeIntegrationTopics(f.db,body,'admin'),e=>e.statusCode===400);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
});
test('asset hydration respects D1 parameter limit on large topic pages',async()=>{
 const sizes=[],db={prepare(){return {bind(...args){sizes.push(args.length);return this;},async all(){return {results:[]};}};}};
 await hydrateTopicAssets(db,Array.from({length:100},()=>({imageAssetIds:Array.from({length:6},()=> 'asset-'+crypto.randomUUID())})));assert.equal(sizes.reduce((a,b)=>a+b,0),600);assert.ok(sizes.every(n=>n<=80));
});
test('provider rejection and invalid image return no ready assets or topics',async t=>{
 const f=await setup(t),i=input();f.env.fetch=async()=>new Response(null,{status:401});await startTopicImage(f.env,user,i);await f.run(i.requestId);assert.equal((await f.status(i.requestId)).errorCode,'OPENAI_HTTP_401');assert.equal(f.objects.size,0);assert.throws(()=>inspectPng(Buffer.from('invalid')));
});
