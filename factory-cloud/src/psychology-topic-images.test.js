import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {writeIntegrationTopics,selectTopicSources,topicUsageStatement,handlePsychologyTopicBank,storeTopicImage} from './psychology-topic-bank.js';
import {appendTopicImages,imagePoolCounts} from './psychology-topic-images.js';
import {handlePoolGeneration,runPoolImageWorkflow,downloadPoolPng} from './topic-pool-generation.js';
const user={id:'admin',role:'admin',sidebarModules:['psychology-topic-bank']};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const config={template:'psychology-target-2',selection:'random',onlyUnused:true,query:'',count:20};
async function setup(t){
 const f=await fixture(t);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(user.sidebarModules));
 const topic=(await writeIntegrationTopics(f.db,{template:config.template,title:'Four situations',imageUrl:'https://images.example/one.png',choices:['Alarm','Door','Water','Phone'].map(copy=>({copy}))},user.id)).items[0];
 const objects=new Map(),workflows=new Set(),calls=[];
 f.env.ARCHIVE={async head(k){return objects.get(k)||null;},async put(k,b,o){objects.set(k,{size:b.length,body:b,customMetadata:o.customMetadata});}};
 f.env.TOPIC_IMAGE_WORKFLOW={async create({id}){if(workflows.has(id))throw Error('already exists');workflows.add(id);},async get(){return {async status(){return {status:'running'};},async restart(){}};}};
 f.env.KIE_API_KEY='test-only';
 f.env.fetch=async(url,init)=>{
  calls.push({url:String(url),method:init?.method});
  if(String(url).includes('/createTask'))return Response.json({code:200,data:{taskId:'kie-task'}});
  if(String(url).includes('/recordInfo'))return Response.json({code:200,data:{state:'success',resultJson:JSON.stringify({resultUrls:['https://images.example/generated.png']})}});
  if(String(url)==='https://images.example/generated.png')return new Response(png);
  throw Error('Unexpected network');
 };
 const generate=async body=>{const url=new URL('https://factory.test/api/psychology-template-topics/'+topic.id+'/image-generation');return handlePoolGeneration(new Request(url,{method:'POST',body:JSON.stringify(body)}),f.env,url,user,topic.id);};
 const run=async requestId=>runPoolImageWorkflow(f.env,{payload:{ownerId:user.id,requestId}},{async do(_n,opt,fn){return (fn||opt)();},async sleep(){}});
 return {...f,topic,objects,workflows,calls,generate,run};
}
test('one topic draws multiple distinct images in one batch and never reuses them, even with onlyUnused=false',async t=>{
 const f=await setup(t);
 await appendTopicImages(f.env,user.id,f.topic.id,{revision:1,images:[{imageUrl:'https://images.example/two.png'},{imageUrl:'https://images.example/three.png'}]});
 const selected=await selectTopicSources(f.db,config);assert.equal(selected.length,3);assert.equal(new Set(selected.map(s=>s.imageId)).size,3);
 await f.db.batch(selected.map((s,i)=>topicUsageStatement(f.db,s,'batch','item-'+i,config,100)));
 assert.equal((await selectTopicSources(f.db,{...config,onlyUnused:false})).length,0);
 assert.equal(f.sqlite.prepare('SELECT usage_count FROM psychology_template_topics').get().usage_count,3);
 await appendTopicImages(f.env,user.id,f.topic.id,{revision:1,images:[{imageUrl:'https://images.example/four.png'}]});
 assert.equal((await selectTopicSources(f.db,config)).length,1);
});
test('concurrent stale draws rollback atomically and same image is deduplicated across topics',async t=>{
 const f=await setup(t);
 await writeIntegrationTopics(f.db,{template:config.template,title:'Another question',imageUrl:'https://images.example/one.png',choices:['A','B','C','D'].map(copy=>({copy}))},user.id);
 const a=await selectTopicSources(f.db,config),b=await selectTopicSources(f.db,config);
 assert.equal(a.length,1);assert.equal(b.length,1);
 await f.db.batch([topicUsageStatement(f.db,a[0],'first','first-item',config,1)]);
 await assert.rejects(f.db.batch([topicUsageStatement(f.db,b[0],'second','second-item',config,2)]),/TOPIC_IMAGE_UNAVAILABLE/);
 assert.equal((await selectTopicSources(f.db,config)).length,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_topic_usage').get().n,1);
});
test('stop/start, parent edit and reimport never reset image usage; unrelated templates retain old logic',async t=>{
 const f=await setup(t),source=(await selectTopicSources(f.db,config))[0];
 await topicUsageStatement(f.db,source,'b','i',config,1).run();
 f.sqlite.prepare('UPDATE psychology_template_topics SET revision=revision+1,title=?').run('New title');
 const result=await appendTopicImages(f.env,user.id,f.topic.id,{revision:2,images:[{imageUrl:'https://images.example/one.png'}]});assert.equal(result.skipped,1);
 f.sqlite.exec('UPDATE psychology_topic_images SET enabled=0; UPDATE psychology_topic_images SET enabled=1;');
 assert.equal((await selectTopicSources(f.db,config)).length,0);
 const counts=await imagePoolCounts(f.db,[{id:f.topic.id,template:config.template}]);assert.deepEqual(counts[0].imagePool,{total:1,available:0,used:1});
});
test('API enforces permissions, revision, pagination, template and image ownership',async t=>{
 const f=await setup(t),base='https://factory.test/api/psychology-template-topics/'+f.topic.id+'/images';
 const call=async(method,body,actor=user,suffix='')=>{const url=new URL(base+suffix);return handlePsychologyTopicBank(new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),f.env,url,actor?{user:actor}:null);};
 assert.equal((await call('GET',null,null)).status,401);
 assert.equal((await call('POST',{revision:1,images:[]},{...user,role:'operator', sidebarModules: []})).status,403);
 assert.equal((await call('POST',{revision:99,images:[{imageUrl:'https://example.com/a'}]})).status,409);
 assert.equal((await call('POST',{revision:1,images:[{assetId:'asset-'+crypto.randomUUID()}]})).status,403);
 const added=await call('POST',{revision:1,images:Array.from({length:25},(_,i)=>({imageUrl:'https://images.example/'+i+'.png'}))});assert.equal(added.status,201);
 const page=await (await call('GET')).json();assert.equal(page.items.length,20);assert.equal(page.total,26);assert.equal(page.hasMore,true);
 assert.equal((await (await call('GET',null,user,'?page=2')).json()).items.length,6);
});
test('identical uploaded bytes use the same hash and cannot be consumed again under a new filename',async t=>{
 const f=await setup(t),body={dataUrl:'data:image/png;base64,'+png.toString('base64')};
 const a=await storeTopicImage(f.env,{...body,fileName:'a.png'}),b=await storeTopicImage(f.env,{...body,fileName:'b.png'});
 assert.equal(a.key,b.key);
 const out=await appendTopicImages(f.env,user.id,f.topic.id,{revision:1,images:[{imageKey:a.key},{imageKey:b.key}]});assert.equal(out.created,1);
 const selected=(await selectTopicSources(f.db,config)).find(s=>s.sourceImage.imageKey);
 await topicUsageStatement(f.db,selected,'batch','item',config,1).run();
 assert.equal((await selectTopicSources(f.db,config)).filter(s=>s.sourceImage.imageKey).length,0);
});
test('Kie generation is idempotent and adds a disabled image to the existing topic without publishing',async t=>{
 const f=await setup(t),input={requestId:crypto.randomUUID(),revision:1,prompt:'A calm bedroom'};
 assert.equal((await f.generate(input)).status,202);await f.generate(input);assert.equal(f.workflows.size,1);
 await f.run(input.requestId);await f.run(input.requestId);
 const status=await (await f.generate(input)).json();assert.equal(status.status,'completed');
 assert.equal(f.calls.filter(c=>c.url.includes('/createTask')).length,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT enabled FROM psychology_topic_images WHERE id=?').get(status.imageId).enabled,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_assets').get().n,1);
});
test('ambiguous paid submission never retries the provider; resume and changed request IDs are guarded',async t=>{
 const f=await setup(t),input={requestId:crypto.randomUUID(),revision:1,prompt:'Room'};
 let paid=0;f.env.fetch=async()=>{paid++;throw Error('timeout');};
 await f.generate(input);await f.run(input.requestId);await f.generate({requestId:input.requestId,resume:true});await f.run(input.requestId);
 assert.equal(paid,1);assert.equal((await (await f.generate(input)).json()).status,'unknown');
 await assert.rejects(f.generate({...input,prompt:'changed'}),e=>e.statusCode===409);
});
test('changed topics and revoked permissions prevent generated assets entering the draw pool',async t=>{
 const f=await setup(t),input={requestId:crypto.randomUUID(),revision:1,prompt:'Room'};
 await f.generate(input);f.sqlite.exec('UPDATE psychology_template_topics SET revision=2');
 await f.run(input.requestId);assert.equal((await (await f.generate(input)).json()).errorCode,'TOPIC_CHANGED');
 const g=await setup(t),next={...input,requestId:crypto.randomUUID()};
 await g.generate(next);g.sqlite.exec('UPDATE factory_users SET active=0');
 await g.run(next.requestId);assert.equal(g.calls.length,0);
});
test('generated PNG download rejects invalid bytes, excessive size and private redirects',async()=>{
 for(const response of [new Response('html'),new Response(png,{headers:{'content-length':String(9*1024*1024)}}),new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})]){
  await assert.rejects(downloadPoolPng({fetch:async()=>response},'https://images.example/test.png'));
 }
});


test('migration keeps historical draws consumed and existing usage records intact',async t=>{
 const {DatabaseSync}=await import('node:sqlite'),fs=await import('node:fs');
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const dir=new URL('../migrations/',import.meta.url);
 for(const name of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'0067').sort())sqlite.exec(fs.readFileSync(new URL(name,dir),'utf8'));
 sqlite.prepare("INSERT INTO psychology_template_topics(id,template,title,content,fingerprint,created_by,created_at,updated_at) VALUES('topic-old','psychology-target-2','Old',?,'old','admin',1,1)")
 .run(JSON.stringify({kind:'single-image-quiz',imageUrl:'https://example.com/used.png',choices:['A','B','C','D'].map(copy=>({copy}))}));
 sqlite.exec("INSERT INTO psychology_topic_usage VALUES('topic-old','old-batch','old-item','psychology-target-2',1,1,100)");
 sqlite.exec(fs.readFileSync(new URL('0067_topic_image_pool.sql',dir),'utf8'));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM psychology_topic_images').get().n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM psychology_topic_image_uses').get().n,1);
 assert.equal(sqlite.prepare('SELECT item_id FROM psychology_topic_usage').get().item_id,'old-item');
 assert.equal(sqlite.prepare('SELECT usage_count FROM psychology_template_topics').get().usage_count,1);
});

