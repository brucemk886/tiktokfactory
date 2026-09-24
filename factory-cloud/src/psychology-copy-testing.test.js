import test from 'node:test';
import assert from 'node:assert/strict';
import { planFairLibraryDraw, loadTestState, occupiesTest, testAllocationStatement, TEST_POLICY } from './psychology-copy-testing.js';
import { fixture, input } from './psychology-cloud-test-fixture.js';
import { normalizeAutoPublish } from '../../scripts/psychology-auto-publish.js';
const post=(key,variants=[])=>({sourceKey:key,createdAt:1,original:{id:key},rewrites:variants.map((id,i)=>({id:key+id,external_id:id,created_at:i+1}))});
const slots=n=>Array.from({length:n},(_,i)=>({connectionId:'account-'+i,scheduleAt:1000+i*45}));
const stats=(entries)=>new Map(entries.map(([key,posts,mature=0,avgViews=null])=>[key,{posts,mature,avgViews}]));
const draw=(args)=>planFairLibraryDraw({posts:[post('p',['v1','v2','v3'])],slots:slots(1),pairSeed:'owner:day:round-1',...args});

test('cold A gives originals and rewrites opportunities; B and C never cross their version type',()=>{
  const posts=Array.from({length:20},(_,i)=>post('p'+i,['v1','v2','v3']));
  const a=draw({posts,slots:slots(20)});
  assert.equal(a.filter(v=>v.variantId).length,10);
  assert.equal(draw({posts,slots:slots(20),strategy:'original'}).filter(v=>v.variantId).length,0);
  const c=draw({posts,slots:slots(20),strategy:'rewrite'});
  assert.ok(c.every(v=>v.variantId));
  assert.throws(()=>draw({posts:[post('p')],strategy:'rewrite'}),/不会用原版/);
});

test('three pending samples block more allocations until mature, including across strategies',()=>{
  const occupied=stats([['p|',3],['p|v1',3],['p|v2',3]]);
  for(const strategy of ['original','rewrite','evolve'])assert.throws(()=>draw({stats:occupied,strategy}),/测试名额/);
  occupied.set('p|v1',{posts:3,mature:3,avgViews:100});
  assert.equal(draw({stats:occupied,strategy:'rewrite'})[0].variantId,'v3'); // one window opens
  assert.equal(draw({stats:stats([['p|',3,3,100]]),strategy:'original'})[0].variantId,'');
});

test('active rewrite window keeps started variants and chooses the least tested',()=>{
  assert.equal(draw({strategy:'rewrite',stats:stats([['p|v2',2],['p|v3',1]])})[0].variantId,'v3');
  assert.equal(draw({strategy:'rewrite',stats:stats([['p|v1',3],['p|v2',1]])})[0].variantId,'v2');
  const c=draw({strategy:'rewrite',slots:slots(2)});
  assert.deepEqual(c.map(v=>v.variantId),['v1','v2']);
  assert.throws(()=>draw({strategy:'rewrite',slots:slots(3)}),/测试名额/);
});

test('A exploits mature winners, explores new versions and retires only against a mature baseline',()=>{
  const s=stats([['p|',3,3,100],['p|v1',3,3,200],['p|v2',3,3,20]]);
  assert.equal(draw({stats:s,random:()=>0})[0].variantId,'v1');
  assert.equal(draw({stats:s,random:()=>0.99})[0].variantId,'v3');
  const noTrials=[post('p',['v2'])];
  assert.equal(draw({posts:noTrials,stats:s})[0].variantId,'');
  assert.equal(draw({posts:noTrials,stats:s,strategy:'rewrite'})[0].variantId,'v2');
  assert.equal(draw({posts:[{...post('p',['v2']),original:null}],stats:s})[0].variantId,'v2');
});

test('same-account source reuse is blocked across rounds and versions; common seeds pair candidates',()=>{
  const posts=Array.from({length:10},(_,i)=>post('p'+i,['v1']));
  const b=draw({posts,slots:slots(5),strategy:'original'});
  const c=draw({posts,slots:slots(5),strategy:'rewrite'});
  assert.deepEqual(b.map(v=>v.post.sourceKey),c.map(v=>v.post.sourceKey));
  const used=new Map([['account-0',new Set(['p'])]]);
  assert.throws(()=>draw({used,strategy:'rewrite'}),/测试名额/);
  assert.throws(()=>draw({posts:[post('p')],slots:[{connectionId:'a'},{connectionId:'b'}],strategy:'original'}),/测试名额/);
});

test('only definite failures release samples; in-flight retries and ambiguous receipts remain occupied',()=>{
  assert.equal(occupiesTest({status:'failed'}),false);
  assert.equal(occupiesTest({execution_status:'failed',execution_type:'psychology-photo-story'}),false);
  assert.equal(occupiesTest({status:'cancelled'}),false);
  assert.equal(occupiesTest({status:'done'},{officialRemoteStatus:'failed'}),false);
  assert.equal(occupiesTest({status:'running'},{officialRemoteStatus:'failed'}),true);
  assert.equal(occupiesTest({status:'failed'},{},{retry_status:'queued'}),true);
  assert.equal(occupiesTest({status:'failed'},{officialRemoteStatus:'status_timeout'}),true);
  assert.equal(occupiesTest({status:'failed'},{officialRemoteStatus:'needs_review'}),true);
  assert.equal(occupiesTest({status:'failed'},{},{status:'failed',request_json:'{"externalId":"x"}'}),true);
  assert.equal(occupiesTest({status:'failed'},{officialRemoteStatus:'published'}),true);
  assert.equal(occupiesTest({deleted_at:123}),true); // deletion is not evidence of non-publication
});

test('policy normalization preserves idempotency and rejects reuse/unknown modes',()=>{
  const config=input({sourceType:'library',mediaType:'photo',template:'photo-text',libraryTestPolicy:TEST_POLICY});
  assert.equal(normalizeAutoPublish(config).libraryTestPolicy,TEST_POLICY);
  assert.throws(()=>normalizeAutoPublish({...config,allowPeerReuse:true}),/不能重复/);
  assert.throws(()=>normalizeAutoPublish({...config,libraryTestPolicy:'other'}),/测试策略/);
  assert.equal(normalizeAutoPublish({...config,libraryTestPolicy:undefined}).libraryTestPolicy,undefined);
});

async function ready(t){
  const f=await fixture(t);
  f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE media_type='photo'").run(JSON.stringify({title:'Ready',pages:[{text:'Choose how you handle a difficult conversation.'}]}));
  return f;
}
const batch=overrides=>input({mediaType:'photo',template:'photo-text',sourceType:'library',count:2,libraryStrategy:'original',libraryTestPolicy:TEST_POLICY,...overrides});

test('real batch transaction reserves live sample counts, not stale rollup posts; confirmed failure releases',async t=>{
  const f=await ready(t), request=batch();
  const response=await f.call('POST',request);assert.equal(response.status,202);
  const data=await response.json(), before=await loadTestState(f.db,'admin');
  assert.equal(before.revision,2);
  assert.equal([...before.stats.values()].reduce((n,v)=>n+v.posts,0),2);
  assert.equal((await loadTestState(f.db,'someone-else')).stats.size,0);
  const item=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id LIMIT 1').get();
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(item.job_id);
  assert.equal([...((await loadTestState(f.db,'admin')).stats).values()].reduce((n,v)=>n+v.posts,0),1);
  f.sqlite.prepare("UPDATE factory_jobs SET status='queued' WHERE id=?").run(item.job_id);
  assert.equal([...((await loadTestState(f.db,'admin')).stats).values()].reduce((n,v)=>n+v.posts,0),2);
  const duplicate=await (await f.call('POST',request)).json();assert.equal(duplicate.batchId,data.batchId);assert.equal(duplicate.duplicate,true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_test_allocations').get().n,1);
  assert.equal(f.requests.length,0); // never calls publish API
});

test('competing allocation revision rolls back all partial writes and succeeds only on fresh snapshot',async t=>{
  const f=await ready(t), first=await loadTestState(f.db,'admin'), second=await loadTestState(f.db,'admin');
  await f.db.batch([testAllocationStatement(f.db,'admin',first.revision,'batch-a',1)]);
  await assert.rejects(f.db.batch([
    f.db.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').bind('loser','admin','{}',1),
    testAllocationStatement(f.db,'admin',second.revision,'batch-b',1),
  ]),/UNIQUE/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_publish_batches WHERE id='loser'").get().n,0);
  const fresh=await loadTestState(f.db,'admin');assert.equal(fresh.revision,2);
  await f.db.batch([testAllocationStatement(f.db,'admin',fresh.revision,'batch-b',2)]);
});

test('C with no enabled rewrites creates neither a batch nor production work',async t=>{
  const f=await ready(t);
  await assert.rejects(f.call('POST',batch({libraryStrategy:'rewrite'})),/不会用原版/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);
  assert.equal(f.instances.size,0);
});


test('nine groups with two daily rounds allocate 360 distinct account/source pairs without exceeding cold quotas',()=>{
  const posts=Array.from({length:100},(_,i)=>post('source-'+i,['v1','v2','v3']));
  const state=new Map(),used=new Map(),all=[];
  for(let group=0;group<9;group++)for(let round=0;round<2;round++){
    const strategy=['evolve','original','rewrite'][Math.floor(group/3)];
    const plan=draw({posts,stats:state,used,strategy,pairSeed:'admin:2026-09-26:round-'+(round+1),
      slots:Array.from({length:20},(_,i)=>({connectionId:'g'+group+'a'+i,scheduleAt:group*900+round*1800+i*45}))});
    for(const item of plan){const key=item.post.sourceKey+'|'+item.variantId;const prior=state.get(key)||{posts:0,mature:0,avgViews:null};state.set(key,{...prior,posts:prior.posts+1});}
    all.push(...plan);
  }
  assert.equal(all.length,360);
  assert.equal(new Set(all.map(i=>i.connectionId+'|'+i.post.sourceKey)).size,360);
  assert.ok([...state.values()].every(s=>s.posts<=3));
  assert.ok(all.every(i=>i.variantId!=='v3'));
  for(const connectionId of new Set(all.map(i=>i.connectionId))){const times=all.filter(i=>i.connectionId===connectionId).map(i=>i.scheduleAt);assert.equal(times[1]-times[0],1800);}
});


test('workflow batch dispatch uses stable ids and idempotently rechecks the same batch',async t=>{
 const f=await ready(t),calls=[];f.env.PEER_PHOTO_WORKFLOW.createBatch=async rows=>{calls.push(rows);return rows;};
 const request=batch();const first=await (await f.call('POST',request)).json();
 const second=await (await f.call('POST',request)).json();assert.equal(second.batchId,first.batchId);
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].length,2);
 assert.ok(calls[0].every(row=>row.id===row.params.jobId));assert.equal(f.requests.length,0);
});
