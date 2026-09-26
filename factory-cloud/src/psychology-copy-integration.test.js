import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {importPsychologyPeerHits} from './psychology-peer-hits-store.js';
import {handlePsychologyPeerHits} from './psychology-peer-hits.js';
import {PSYCHOLOGY_COPY_API as API} from './psychology-copy-integration.js';
import worker from './index.js';
const base='https://factory.test';
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-peer-hits']};
async function setup(t){
 const f=await fixture(t);
 f.sqlite.exec('DELETE FROM psychology_peer_hits; DELETE FROM psychology_copy_library;');
 const req=new Request(base+'/api/psychology-peer-hits/api-key',{method:'POST'});
 const key=await (await handlePsychologyPeerHits(req,f.env,new URL(req.url),{user})).json();
 f.auth={Authorization:'Bearer '+key.apiKey};
 f.call=(path='',method='GET',body,headers=f.auth)=>worker.fetch(new Request(base+API+path,{method,headers:{...headers,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),f.env,{});
 return f;
}
async function seed(f,id,type='photo'){
 const result=await importPsychologyPeerHits(f.db,{videoUrl:`https://www.tiktok.com/@example/${type}/${id}`,title:'A safe pause',topics:['avoidant'],topComments:[{text:'That feels familiar',likes:24}],videoData:type==='photo'?{pageTexts:['A pause can still mean care','Ask for time and say when you will return'],caption:'A note about connection'}:{transcript:'I need time to find the words',onScreenText:['Take a breath']}},'admin');
 return result.items[0].id;
}
test('copy integration reads paginated shared originals without a cookie and leaves old worklist intact',async t=>{
 const f=await setup(t);for(let i=0;i<3;i++)await seed(f,910+i,i===2?'video':'photo');
 let res=await f.call('?pageSize=2');assert.equal(res.status,200);let data=await res.json();assert.equal(data.total,3);assert.equal(data.items.length,2);assert.equal(data.hasMore,true);
 const second=await (await f.call('?pageSize=2&page=2')).json();assert.equal(second.items.length,1);assert.equal(second.hasMore,false);assert.ok(!data.items.some(i=>i.id===second.items[0].id));
 data=await (await f.call('?mediaType=photo')).json();assert.equal(data.total,2);assert.deepEqual(data.items[0].peer.topics,['avoidant']);assert.equal(data.items[0].content.pages.length,2);assert.equal(data.items[0].revision.length,64);
 assert.equal((await f.call('?pageSize=101')).status,400);assert.equal((await f.call('?status=bogus')).status,400);
 assert.equal((await f.call()).status,200);assert.equal((await f.call('','GET',undefined,{})).status,401);
 const legacy=await worker.fetch(new Request(base+'/api/integrations/psychology/peer-hits',{headers:f.auth}),f.env,{});assert.equal(legacy.status,200);assert.ok(Array.isArray((await legacy.json()).enrich));
 assert.equal(f.requests.length,0);
});
test('copy PATCH changes ordered pages, preserves metadata, updates source, rejects stale writes',async t=>{
 const f=await setup(t),id=await seed(f,920),path='/'+id;
 const before=(await (await f.call(path)).json()).item;
 const changed=await f.call(path,'PATCH',{revision:before.revision,title:'Closeness with room',pages:['Tell them you need a minute','Come back when you said you would'],topComments:[{text:'One',likes:1},{text:'Five',likes:5}]});
 assert.equal(changed.status,200,await changed.clone().text());const item=(await changed.json()).item;
 assert.equal(item.content.pages[1].index,2);assert.equal(item.title,'Closeness with room');assert.equal(item.content.caption,before.content.caption);assert.deepEqual(item.peer.topics,['avoidant']);assert.equal(item.peer.topComments[0].likes,5);
 assert.deepEqual(item.peer.videoData.pageTexts,item.content.pages.map(p=>p.text));assert.notEqual(item.revision,before.revision);
 assert.equal((await f.call(path,'PATCH',{revision:before.revision,title:'stale'})).status,409);
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,mediaType:'video'})).status,400);
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,pages:[]})).status,400);
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,pages:['a'.repeat(501)]})).status,400);
 assert.equal((await f.call(path,'DELETE')).status,405);
 assert.equal((await f.call('/psy-'+'0'.repeat(32))).status,404);
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,title:'No key'},{})).status,401);
 assert.equal(f.requests.length,0);
});
test('copy metadata edits keep failed state; video completion is guarded against active extraction',async t=>{
 const f=await setup(t),id=await seed(f,930,'video'),path='/'+id;
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='running' WHERE id=?").run(id);
 let item=(await (await f.call(path)).json()).item;
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,transcript:'new words'})).status,409);
 f.sqlite.prepare("UPDATE psychology_copy_library SET status='failed',content_json='{}' WHERE id=?").run(id);
 item=(await (await f.call(path)).json()).item;
 let response=await f.call(path,'PATCH',{revision:item.revision,topics:['boundaries']});assert.equal(response.status,200);item=(await response.json()).item;assert.equal(item.status,'failed');
 response=await f.call(path,'PATCH',{revision:item.revision,transcript:'Say what you need without blaming them',onScreenText:['Pause first']});assert.equal(response.status,200);item=(await response.json()).item;assert.equal(item.status,'done');assert.equal(item.content.transcript,'Say what you need without blaming them');
});
test('rewrites are owner and source scoped, score sorted, editable with revision and cannot bypass pending review',async t=>{
 const f=await setup(t),id=await seed(f,940),other=await seed(f,941),original=(await (await f.call('/'+id)).json()).item;
 const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
 for(const [vid,owner,score,status] of [[a,'admin',80,'approved'],[b,'second',99,'approved'],[c,'admin',90,'pending']])f.sqlite.prepare("INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at,quality_score,review_status,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(vid,owner,vid,original.sourceKey,'A calmer reply','A pause is useful',JSON.stringify(['Ask once and then give them time']),vid,1,score,status,status==='approved'?1:0);
 const path='/'+id+'/rewrites';let data=await (await f.call(path)).json();assert.equal(data.items.length,2);assert.equal(data.items[0].id,c);
 assert.equal((await f.call(path+'/'+b)).status,404);assert.equal((await f.call('/'+other+'/rewrites/'+a)).status,404);
 let row=(await (await f.call(path+'/'+a)).json()).item;
 let res=await f.call(path+'/'+a,'PATCH',{revision:row.revision,enabled:false,score:96,rewriteModel:'grokbot'});assert.equal(res.status,200,await res.clone().text());let edited=(await res.json()).item;assert.equal(edited.enabled,false);assert.equal(edited.score,96);
 assert.equal((await f.call(path+'/'+a,'PATCH',{revision:row.revision,enabled:true})).status,409);
 row=(await (await f.call(path+'/'+c)).json()).item;assert.equal((await f.call(path+'/'+c,'PATCH',{revision:row.revision,enabled:true})).status,409);
 assert.equal((await f.call(path+'/'+a,'PATCH',{revision:edited.revision,owner:'second'})).status,400);
 f.sqlite.exec("UPDATE factory_users SET active=0 WHERE id='admin'");assert.equal((await f.call(path)).status,401);assert.equal((await f.call('/'+id,'PATCH',{revision:original.revision,title:'Blocked'})).status,401);
});

test('concurrent original edits cannot partially update the source or overwrite the winner',async t=>{
 const f=await setup(t),id=await seed(f,950),path='/'+id;
 const before=(await (await f.call(path)).json()).item;
 const originalBatch=f.db.batch.bind(f.db);let intercepted=false;
 f.db.batch=async statements=>{
  if(!intercepted){intercepted=true;f.sqlite.prepare('UPDATE psychology_copy_library SET updated_at=updated_at+1,title=? WHERE id=?').run('Concurrent winner',id);}
  return originalBatch(statements);
 };
 const response=await f.call(path,'PATCH',{revision:before.revision,title:'Stale loser',pages:['A different page']});assert.equal(response.status,409);
 assert.equal(f.sqlite.prepare('SELECT title FROM psychology_copy_library WHERE id=?').get(id).title,'Concurrent winner');
 assert.equal(f.sqlite.prepare('SELECT title FROM psychology_peer_hits WHERE id=?').get(id).title,before.title);
});

test('rewritten text edits invalidate old ratings/translations and cannot call providers',async t=>{
 const f=await setup(t),id=await seed(f,960),original=(await (await f.call('/'+id)).json()).item,vid='d'.repeat(64);
 f.sqlite.prepare("INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at,quality_score,score_reason,comparison_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(vid,'admin',vid,original.sourceKey,'A calmer reply','Leave room for a reply',JSON.stringify(['Ask once and then give them time']),vid,1,90,'Old score','{"original":[],"rewrite":[]}');
 const path='/'+id+'/rewrites/'+vid,row=(await (await f.call(path)).json()).item;
 const response=await f.call(path,'PATCH',{revision:row.revision,title:'A little room to breathe',caption:'Try saying when you can return',pages:['You can ask for a pause and still show that you care']});
 assert.equal(response.status,200,await response.clone().text());const item=(await response.json()).item;assert.equal(item.score,null);assert.equal(item.scoreReason,'');assert.equal(item.comparison,null);assert.notEqual(item.revision,row.revision);assert.equal(f.requests.length,0);
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,pages:[]})).status,400);
 assert.equal((await f.call(path,'PATCH',{revision:item.revision,title:'x'.repeat(1024*1024)})).status,413);
 // The helper sets JSON for bodies; exercise the actual media-type guard directly.
 const req=new Request(base+API+path,{method:'PATCH',headers:{...f.auth,'Content-Type':'text/plain'},body:'{}'});
 assert.equal((await worker.fetch(req,f.env,{})).status,415);
});
