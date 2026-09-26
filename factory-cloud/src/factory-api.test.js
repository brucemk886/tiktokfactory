import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {handleFactoryApi} from './factory-api.js';
import {CATALOG,FACTORY_API,publicCatalog} from './factory-api-catalog.js';
import {toPublicUser} from './auth.js';
import {sidebarModuleIdsForRole,canAccessPath,visibleSidebarModules} from './sidebar.js';
import worker from './index.js';
import {DEEPSEEK_PHOTO_MODEL} from './deepseek.js';
const base='https://factory.test';
async function value(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(sidebarModuleIdsForRole('admin')));
 f.user=()=>toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 f.key=async(method='POST',actor=f.user(),headers={})=>{const r=new Request(base+'/api/factory-api/key',{method,headers:{'content-type':'application/json',...headers},...(method==='POST'?{body:'{}'}:{})});return handleFactoryApi(r,f.env,new URL(r.url),actor?{user:actor}:null);};
 f.token=(await value(await f.key(),201)).apiKey;
 f.raw=(body,token=f.token,method='POST',query='')=>worker.fetch(new Request(base+FACTORY_API+query,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}),f.env,{});
 f.call=(module,action,params={},requestId)=>f.raw({module,action,params,...(requestId?{requestId}:{})});
 f.write=(module,action,params={},requestId=crypto.randomUUID())=>f.call(module,action,params,requestId);
 f.dir=async()=> (await value(await f.write('photo-factory','directions.create',{body:{slug:'zodiac',name:'Zodiac',config:{model:DEEPSEEK_PHOTO_MODEL}}}),201)).id;
 return f;
}
test('one project key covers both modules, is hashed, rotates globally and revokes',async t=>{
 const f=await setup(t);const c=await value(await f.raw(null,f.token,'GET'));assert.deepEqual(c.modules.map(m=>m.module),['psychology','photo-factory']);
 await value(await f.call('psychology','topics.list'));await value(await f.call('photo-factory','directions.list'));
 const row=f.sqlite.prepare('SELECT * FROM factory_ai_keys').get();assert.notEqual(row.token_hash,f.token);assert.equal(row.token_hash.length,64);
 const meta=await value(await f.key('GET'));assert.equal(meta.apiKey,undefined);assert.equal(meta.configured,true);
 const old=f.token;f.token=(await value(await f.key(),201)).apiKey;assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_ai_keys').get().n,1);
 assert.equal((await f.raw(null,old,'GET')).status,401);assert.equal((await f.raw(null,'psy_topics_old','GET')).status,401);
 await value(await f.key('DELETE'));assert.equal((await f.raw(null,f.token,'GET')).status,401);
 assert.equal(f.requests.length,0);
});
test('key administration requires admin and same-site writes; navigation includes the page',async t=>{
 const f=await setup(t);assert.equal((await f.key('POST',null)).status,401);assert.equal((await f.key('POST',{...f.user(),role:'operator'})).status,403);
 assert.equal((await f.key('POST',f.user(),{origin:'https://evil.test'})).status,403);
 assert.equal((await f.key('DELETE',f.user(),{'sec-fetch-site':'cross-site'})).status,403);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['hub','accounts']));
 assert.ok(visibleSidebarModules(f.user()).some(m=>m.id==='factory-api'));assert.equal(canAccessPath({...f.user(),role:'operator'},'/factory-api.html'),false);
});
test('current grants and disabled owners are checked even for repeated writes',async t=>{
 const f=await setup(t),id=crypto.randomUUID(),params={body:{name:'New',slug:'new'}};await value(await f.write('photo-factory','directions.create',params,id),201);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-topic-bank']));
 assert.equal((await f.write('photo-factory','directions.create',params,id)).status,403);assert.equal((await value(await f.raw(null,f.token,'GET'))).modules.length,1);
 f.sqlite.exec('UPDATE factory_users SET active=0');assert.equal((await f.call('psychology','topics.list')).status,401);
});
test('whitelist rejects route/header/owner injection and malformed envelopes before writes',async t=>{
 const f=await setup(t);
 for(const body of [{module:'__proto__',action:'toString'},{module:'psychology',action:'constructor'},{module:'psychology',action:'topics.list',url:'/api/accounts'},{module:'psychology',action:'topics.list',params:{query:{owner:'other'}}},{module:'psychology',action:'topics.get',params:{id:'../../accounts'}},{module:'photo-factory',action:'directions.create',params:{body:{slug:'x',name:'x'}}}])assert.ok((await f.raw(body)).status>=400);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_ai_requests').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_directions').get().n,0);
});
test('canonical retries return the saved response and changed input conflicts across modules',async t=>{
 const f=await setup(t),requestId=crypto.randomUUID();
 const a=await value(await f.write('photo-factory','directions.create',{body:{slug:'zodiac',name:'Zodiac'}},requestId),201);
 const replay=await f.write('photo-factory','directions.create',{body:{name:'Zodiac',slug:'zodiac'}},requestId);assert.equal(replay.headers.get('x-idempotent-replay'),'true');assert.deepEqual(await value(replay,201),a);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_directions').get().n,1);
 assert.equal((await f.write('photo-factory','directions.create',{body:{slug:'other',name:'Zodiac'}},requestId)).status,409);
 assert.equal((await f.write('psychology','topics.import',{body:{template:'psychology',title:'x'}},requestId)).status,409);
 const status=await value(await f.call('photo-factory','requests.get',{id:requestId}));assert.equal(status.state,'done');assert.deepEqual(status.result,a);
 assert.equal((await f.call('psychology','requests.get',{id:requestId})).status,404);
});
test('concurrent identical writes acquire one durable claim',async t=>{
 const f=await setup(t),id=crypto.randomUUID(),params={body:{slug:'same',name:'Same'}};
 const replies=await Promise.all([f.write('photo-factory','directions.create',params,id),f.write('photo-factory','directions.create',params,id)]);
 assert.ok(replies.every(r=>[201,409].includes(r.status)));assert.ok(replies.some(r=>r.status===201));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_directions').get().n,1);
});
test('template import/read/update use one key and existing revision guards',async t=>{
 const f=await setup(t);await value(await f.write('psychology','topics.import',{body:{template:'psychology-collage',items:[{title:'A question',content:'A complete text',enabled:false}]}}));
 const list=await value(await f.call('psychology','topics.list',{query:{template:'psychology-collage'}}));const item=list.items[0];assert.ok(item.id);
 const read=await value(await f.call('psychology','topics.get',{id:item.id}));await value(await f.write('psychology','topics.update',{id:item.id,body:{revision:read.item.revision,title:'Updated'}}));
 assert.equal((await f.write('psychology','topics.update',{id:item.id,body:{revision:read.item.revision,title:'Stale'}})).status,409);
});
test('photo copies remain direction and owner scoped through unified dispatch',async t=>{
 const f=await setup(t),id=await f.dir();const imported=await value(await f.write('photo-factory','copies.import',{query:{directionId:id},body:{items:[{externalId:'one',title:'Title',pages:['Some concrete text']}]}}));assert.equal(imported.results[0].ok,true);
 const list=await value(await f.call('photo-factory','copies.list',{query:{directionId:id}}));assert.equal(list.total,1);
 f.sqlite.prepare('UPDATE photo_directions SET owner=? WHERE id=?').run('someone-else',id);assert.equal((await f.call('photo-factory','copies.list',{query:{directionId:id}})).status,404);
});
test('managed style creation and update preserve revision checks',async t=>{
 const f=await setup(t);const made=await value(await f.write('psychology','styles.create',{body:{label:'API style',baseStyleId:'classic'}}),201);
 await value(await f.write('psychology','styles.update',{id:made.item.id,body:{revision:made.item.revision,label:'Changed'}}));
 assert.equal((await f.write('psychology','styles.update',{id:made.item.id,body:{revision:made.item.revision,label:'Stale'}})).status,409);
});
test('publish creation with repeated ID creates one batch and never calls real publishing',async t=>{
 const f=await setup(t),body=input({count:1,connectionIds:['a']}),id=body.requestId;delete body.requestId;
 const made=await value(await f.write('psychology','publish.create',{body},id),202);
 const repeated=await value(await f.write('psychology','publish.create',{body},id),202);assert.deepEqual(repeated,made);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,1);assert.equal(f.requests.length,0);
});
test('AI rewrite consumes mocked model once and stores one disabled version',async t=>{
 const f=await setup(t),id=await f.dir();const added=await value(await f.write('photo-factory','copies.import',{query:{directionId:id},body:{items:[{externalId:'one',title:'Source',pages:['Source text']}]}}));
 let calls=0;f.env.DEEPSEEK_API_KEY='test';f.env.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({title:'Rewritten',pages:['New text'],caption:''})}}]});};
 const req=crypto.randomUUID(),params={query:{directionId:id},body:{sourceId:added.results[0].id}};
 await value(await f.write('photo-factory','rewrites.generate',params,req),201);await value(await f.write('photo-factory','rewrites.generate',params,req),201);assert.equal(calls,1);
 const rows=f.sqlite.prepare("SELECT * FROM photo_copies WHERE kind='rewrite'").all();assert.equal(rows.length,1);assert.equal(rows[0].enabled,0);
});
test('uncertain execution remains claimed and cannot automatically repeat',async t=>{
 const f=await setup(t),id=crypto.randomUUID(),params={body:{slug:'broken',name:'Broken'}};
 const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{if(sql.startsWith('INSERT INTO photo_directions'))throw new Error('Simulated database outage');return original(sql);};
 const r=await value(await f.write('photo-factory','directions.create',params,id),503);assert.equal(r.code,'RESULT_UNKNOWN');f.db.prepare=original;
 const retry=await value(await f.write('photo-factory','directions.create',params,id),409);assert.equal(retry.code,'REQUEST_IN_PROGRESS');
 assert.equal((await value(await f.call('photo-factory','requests.get',{id}))).state,'processing');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_directions').get().n,0);
});
test('autopilot creates paused psychology plans; activating uses current scope and revision',async t=>{
 const f=await setup(t),example=CATALOG.psychology['autopilot.create'].example;
 const made=await value(await f.write('psychology','autopilot.create',{body:{...example.body,groupId:'g'}}),201);assert.equal(made.status,'paused');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_batches').get().n,0);
 const r=await f.write('psychology','autopilot.update',{id:made.id,body:{revision:0,status:'active'}});assert.equal(r.status,409);assert.equal(f.requests.length,0);
});
test('catalog examples support runtime-only UUIDs, explicit module identity and no legacy key actions',async t=>{
 const f=await setup(t);for(const m of publicCatalog(f.user()))for(const a of m.actions){assert.equal(a.example.module,m.module);assert.equal(a.example.action,a.action);assert.ok(!/api-key|\/key$/.test(CATALOG[m.module][a.action].target));if(a.mutates)assert.equal(a.example.requestId,'GENERATE_A_UUID');}
 const filtered=await value(await f.raw(null,f.token,'GET','?module=psychology&action=publish.create'));assert.equal(filtered.modules[0].actions.length,1);
 const req=new Request(base+FACTORY_API,{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify({padding:'x'.repeat(128*1024)})});assert.equal((await worker.fetch(req,f.env,{})).status,413);
});

test('photo autopilot example creates a draft and activation remains isolated from legacy pilots',async t=>{
 const f=await setup(t),id=await f.dir(),params={query:{directionId:id},body:{...CATALOG['photo-factory']['autopilot.create'].example.body,groupId:'g'}};
 const made=await value(await f.write('photo-factory','autopilot.create',params),201);assert.equal(made.status,'draft');
 await value(await f.write('photo-factory','autopilot.update',{query:{directionId:id},body:{id:made.id,status:'active'}}));
 assert.equal(f.sqlite.prepare('SELECT status FROM photo_pilots WHERE id=?').get(made.id).status,'active');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_autopilots').get().n,0);assert.equal(f.requests.length,0);
});
test('peer import and copy listing use the same key and retain per-source identity',async t=>{
 const f=await setup(t),params=CATALOG.psychology['peers.import'].example;
 await value(await f.write('psychology','peers.import',params));
 const result=await value(await f.call('psychology','copies.list',{query:{status:'all'}}));assert.ok(result.items.some(i=>i.sourceUrl===params.body.items[0].videoUrl));
 const item=result.items[0];await value(await f.call('psychology','copies.get',{id:item.id}));
 assert.equal(f.requests.length,0);
});
test('response persistence failure cannot rerun a completed side effect',async t=>{
 const f=await setup(t),id=crypto.randomUUID(),params={body:{slug:'saved',name:'Saved'}};
 const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{if(sql.startsWith("UPDATE factory_ai_requests SET state='done'"))throw new Error('Receipt write unavailable');return original(sql);};
 await value(await f.write('photo-factory','directions.create',params,id),503);f.db.prepare=original;
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_directions').get().n,1);
 await value(await f.write('photo-factory','directions.create',params,id),409);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM photo_directions').get().n,1);
});
