import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, input } from './psychology-cloud-test-fixture.js';
import { planPoolMatches, buildPoolCandidates, loadPoolReservations } from './psychology-pool-matching.js';
import { poolPerformanceKey } from './psychology-pool-report.js';
import { loadGroupStore } from './official.js';
import { managedStyles } from './psychology-managed-styles.js';
import { librarySource } from './psychology-copy-source.js';
import { copyIdentity } from './psychology-creative.js';
import { loadTestState } from './psychology-copy-testing.js';
import { mergeAndStorePublishRecords } from './publish-records-store.js';
import { POOL_POLICY, poolQuota } from '../../scripts/psychology-pool-policy.js';

const DAY = 86400000, now = Date.UTC(2026, 8, 30, 4), cycle = now;
const actor = { id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish'] };
const context = overrides => ({cycleStartAt:cycle,postsPerDay:2,dayIndex:0,round:0,asOf:now,...overrides});
const stats = overrides => ({n:6,medianViews:600,avgViews:650,completion:0.2,potentialRate:0.1,...overrides});
const accounts = entries => new Map(entries.map(([id,pool,observed])=>['tiktok:'+id,{account:'tiktok:'+id,pool,stats:stats(observed)}]));
const slots = ids => ids.map((connectionId,i)=>({connectionId,scheduleAt:Math.floor((now+2*3600000)/1000)+i*45}));
function candidate(source='source',pool='explore',overrides={}) {
  const identity={hash:'a'.repeat(64),copy:{title:'Title',caption:'',pages:['Cover','Body']}};
  const styleDefinition={id:'classic',enabled:true,revision:0};
  const value={post:{sourceKey:source},source:{id:source,sourceKey:source,title:'Title'},variantId:'',identity,styleDefinition,
    stats:stats({n:pool==='explore'?0:5,accounts:pool==='explore'?0:5,versionKnown:true,styleKnown:true}),pool,occupied:0,...overrides};
  value.key=poolPerformanceKey({source,variant:value.variantId,style:value.styleDefinition.id,copyHash:value.identity.hash,styleRevision:value.styleDefinition.revision});
  return value;
}
const plan = overrides => planPoolMatches({candidates:[candidate()],accounts:accounts([['a','strong']]),slots:slots(['a']),context:context(),owner:'admin',...overrides});

// These tests use local in-memory SQL and a mocked publishing bridge. They never
// execute generation or call GeeLark/TikTok publishing APIs.
test('a cold exact version/style/hash receives at most five distinct account baseline slots', () => {
  const ids=Array.from({length:6},(_,i)=>'baseline-'+i), c=candidate();
  const result=plan({candidates:[c],accounts:accounts(ids.map(id=>[id,'strong'])),slots:slots(ids)});
  assert.equal(result.plan.length,5);assert.equal(result.skipped.length,1);
  assert.equal(new Set(result.plan.map(p=>p.connectionId)).size,5);
  assert.ok(result.plan.every(p=>p.key===c.key && p.source.poolMatch.warmup));
  assert.match(result.skipped[0].reason,/五个占位/);
  const occupied=new Map([[c.key,{posts:4,accounts:new Set(ids.slice(0,4))}]]);
  const next=plan({candidates:[c],accounts:accounts(ids.map(id=>[id,'strong'])),slots:slots([ids[0],ids[4],ids[5]]),occupied});
  assert.deepEqual(next.plan.map(p=>p.connectionId),[ids[4]]);
  assert.equal(next.skipped.length,2);
});

test('weak and unauthorized accounts skip independently while stable accounts complete the baseline', () => {
  const result=plan({accounts:accounts([['weak','rescue-hook',{medianViews:100}],['near-zero','diagnostic',{medianViews:10}],['a','strong']]),
    slots:slots(['weak','a','near-zero','outside'])});
  assert.deepEqual(result.plan.map(p=>p.connectionId),['a']);
  assert.equal(result.skipped.length,3);
  assert.match(result.skipped.find(s=>s.connectionId==='outside').reason,/授权/);
  assert.ok(result.skipped.filter(s=>s.connectionId!=='outside').every(s=>/合格优胜/.test(s.reason)));
  assert.equal(result.plan[0].source.poolMatch.contentPool,'explore');
});

test('six diagnostic tests require six mature samples, three sources and recovered exposure before reopening', () => {
  const candidates=Array.from({length:10},(_,i)=>candidate('winner-'+i,'winner'));
  const base={posts:6,initialPool:'diagnostic',mature:6,sources:3,stats:stats({medianViews:50})};
  for(const override of [{mature:5},{sources:2},{stats:stats({medianViews:49})},{stats:stats({medianViews:null})}]) {
    const result=plan({candidates,accounts:accounts([['a','diagnostic',{medianViews:10}]]),cycles:new Map([['a',{...base,...override}]])});
    assert.equal(result.plan.length,0);assert.match(result.skipped[0].reason,/六条诊断/);
  }
  const restored=plan({candidates,accounts:accounts([['a','diagnostic',{medianViews:10}]]),cycles:new Map([['a',base]])});
  assert.equal(restored.plan.length,1);assert.equal(restored.plan[0].source.poolMatch.accountPool,'rescue-hook');
  assert.equal(restored.plan[0].source.poolMatch.contentPool,'winner');
  const firstSix=plan({candidates,accounts:accounts([['a','diagnostic',{medianViews:10}]]),slots:slots(Array(7).fill('a'))});
  assert.equal(firstSix.plan.length,6);assert.equal(firstSix.skipped.length,1);
});

test('source/account reuse is blocked across versions and within a plan', () => {
  const candidates=[candidate('used','winner'),candidate('used','winner',{variantId:'rewrite'}),candidate('fresh','winner')];
  const used=new Map([['a',new Set(['used'])]]);
  const result=plan({candidates,used,slots:slots(['a','a'])});
  assert.equal(result.plan.length,1);assert.equal(result.plan[0].post.sourceKey,'fresh');
  assert.equal(result.skipped.length,1);
  assert.deepEqual([...used.get('a')].sort(),['fresh','used']);
});

test('weekly desired quotas use a fixed cycle seed despite daily pairing seeds', () => {
  for(const accountPool of ['strong','normal','rescue-hook','rescue-content']) {
    const candidates=[];
    for(let i=0;i<20;i++)for(const pool of ['winner','optimize','explore'])candidates.push(candidate(pool+i,pool));
    const used=new Map(),actual={winner:0,optimize:0,explore:0};
    for(let dayIndex=0;dayIndex<7;dayIndex++)for(let round=0;round<2;round++) {
      const result=plan({candidates,accounts:accounts([['a',accountPool]]),used,context:context({dayIndex,round}),pairSeed:'admin:day-'+dayIndex+':round-'+round});
      assert.equal(result.plan.length,1);
      actual[result.plan[0].source.poolMatch.desiredPool]++;
      if(accountPool.startsWith('rescue'))assert.notEqual(result.plan[0].source.poolMatch.contentPool,'explore');
    }
    const quota=poolQuota(accountPool);
    assert.deepEqual(actual,{winner:quota.winner,optimize:quota.optimize,explore:quota.explore});
  }
});

function fact(f,id,overrides={}) {
  const row={id,batch_id:'history',account_key:'tiktok:a',media:'photo',schedule_at:now-4*DAY,published_at:now-4*DAY,
    source:'history-'+id,variant:'',style:'classic',copy_hash:'history-hash',state:'published',views:600,completion:0.2,...overrides};
  const keys=Object.keys(row);
  f.sqlite.prepare('INSERT INTO ops_task_facts('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));
}
async function ready(t,{weak=false,winner=false}={}) {
  t.mock.method(Date,'now',()=>now);
  const f=await fixture(t);
  await loadGroupStore(f.db);
  f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE media_type='photo'")
    .run(JSON.stringify({title:'Ready',pages:[{text:'Choose how you handle a difficult conversation.'},{text:'Try one concrete action before asking what happens next.'}]}));
  for(const id of ['a','b'])for(let i=0;i<6;i++)fact(f,'account-'+id+i,{account_key:'tiktok:'+id,views:weak&&id==='b'?100:600});
  if(winner) {
    const row=f.sqlite.prepare("SELECT * FROM psychology_copy_library WHERE media_type='photo' ORDER BY id LIMIT 1").get();
    const source=librarySource(row,'photo'),identity=await copyIdentity(source.copyVariant);
    for(const id of ['c','d','e','f','g']) {
      f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,'g');
      fact(f,'winner-'+id,{account_key:'tiktok:'+id,source:source.sourceKey,copy_hash:identity.hash,views:800});
    }
    f.winner={source,identity};
  }
  return f;
}
const request = overrides => input({mediaType:'photo',template:'photo-text',sourceType:'library',libraryStrategy:'pools',libraryTestPolicy:POOL_POLICY.version,
  count:2,connectionIds:['a','b'],scheduleAt:Math.floor((now+2*3600000)/1000),staggerSeconds:45,poolContext:context(),pairSeed:'admin:day0:round0',...overrides});
const itemRows = f=>f.sqlite.prepare('SELECT i.*,c.source_key,c.variant_id,c.copy_hash,c.style_id,j.payload_json FROM psychology_publish_items i JOIN psychology_creative_snapshots c ON c.item_id=i.id JOIN factory_jobs j ON j.id=i.job_id ORDER BY i.id').all();

test('real pool POST creates only eligible accounts and freezes exact decisions, copy hash and style', async t => {
  const f=await ready(t,{weak:true}),raw=request();
  const response=await f.call('POST',raw);assert.equal(response.status,202);
  const created=await response.json();assert.equal(created.count,1);assert.equal(created.skipped.length,1);assert.equal(created.skipped[0].connectionId,'b');
  const items=itemRows(f);assert.equal(items.length,1);assert.equal(items[0].connection_id,'a');
  const payload=JSON.parse(items[0].payload_json),match=payload.psychologyAutomation.poolMatch;
  assert.equal(match.policy,'pools-v1');assert.equal(match.accountPool,'strong');assert.equal(match.contentPool,'explore');assert.equal(match.warmup,true);
  assert.match(items[0].copy_hash,/^[a-f0-9]{64}$/);assert.equal(match.copyHash,items[0].copy_hash);
  assert.equal(payload.psychologyAutomation.styleDefinition.id,items[0].style_id);assert.equal(payload.psychologyAutomation.styleDefinition.revision,0);
  const persisted=f.sqlite.prepare('SELECT * FROM psychology_pool_matches WHERE item_id=?').get(items[0].id);
  assert.equal(persisted.copy_hash,items[0].copy_hash);assert.equal(persisted.style_id,items[0].style_id);assert.equal(persisted.account_pool,'strong');
  assert.equal(persisted.cycle_start_at,cycle);assert.equal(persisted.owner,'admin');
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches WHERE id=?').get(created.batchId).config_json).count,2);
  const revision=(await loadTestState(f.db,'admin')).revision,allocationCount=f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_test_allocations').get().n;
  const duplicate=await(await f.call('POST',raw)).json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.batchId,created.batchId);
  assert.equal((await loadTestState(f.db,'admin')).revision,revision);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_copy_test_allocations').get().n,allocationCount);
  assert.deepEqual(itemRows(f),items);assert.equal(f.requests.length,0);
});

test('mature exact winners are frozen for both requested accounts and edits do not mutate retries', async t => {
  const f=await ready(t,{winner:true}),raw=request();
  const created=await(await f.call('POST',raw)).json();assert.equal(created.count,2);assert.equal(created.skipped,undefined);
  const before=itemRows(f);assert.equal(before.length,2);
  assert.ok(before.every(item=>item.source_key===f.winner.source.sourceKey && item.copy_hash===f.winner.identity.hash));
  assert.ok(before.every(item=>JSON.parse(item.payload_json).psychologyAutomation.poolMatch.contentPool==='winner'));
  f.sqlite.prepare("UPDATE psychology_copy_library SET content_json=? WHERE media_type='photo'").run(JSON.stringify({title:'Edited',pages:[{text:'This is an edited source and must not replace frozen copy.'}]}));
  const duplicate=await(await f.call('POST',raw)).json();assert.equal(duplicate.batchId,created.batchId);assert.equal(duplicate.duplicate,true);
  assert.deepEqual(itemRows(f),before);
  await assert.rejects(f.call('POST',{...raw,poolContext:{...raw.poolContext,dayIndex:1}}),/其他配置/);
  assert.equal(f.requests.length,0);
});

test('managed style revisions cannot inherit a winner from an older revision', async t => {
  const f=await ready(t,{winner:true}),row=f.sqlite.prepare("SELECT * FROM psychology_copy_library WHERE media_type='photo' ORDER BY id LIMIT 1").get();
  const post={sourceKey:f.winner.source.sourceKey,original:row,rewrites:[]};
  const observed={source:post.sourceKey,version:'',style:'classic',styleRevision:0,copyHash:f.winner.identity.hash,pool:'winner',stats:stats({accounts:5})};
  const state={versions:new Map([[poolPerformanceKey(observed),observed]])},styles=await managedStyles(f.db,'admin');
  const baseline=await buildPoolCandidates([post],state,styles);assert.equal(baseline[0].pool,'winner');
  const changed=styles.map(style=>style.id==='classic'?{...style,revision:1}:style);
  const edited=await buildPoolCandidates([post],state,changed);assert.equal(edited[0].pool,'explore');assert.equal(edited[0].styleDefinition.revision,1);
  assert.notEqual(edited[0].key,baseline[0].key);assert.equal(f.requests.length,0);
});

test('reservation reads release confirmed failures while queued retries and ambiguous deleted receipts stay occupied', async t => {
  const f=await ready(t,{weak:true});await f.call('POST',request());
  const item=itemRows(f)[0];
  const occupied=()=>loadPoolReservations(f.db,'admin',cycle,now);
  assert.equal([...((await occupied()).occupied).values()].reduce((n,v)=>n+v.posts,0),1);
  assert.equal((await loadPoolReservations(f.db,'other-owner',cycle,now)).occupied.size,0);
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(item.job_id);
  assert.equal((await occupied()).occupied.size,0);
  f.sqlite.prepare("UPDATE factory_jobs SET status='queued' WHERE id=?").run(item.job_id);
  assert.equal((await occupied()).occupied.size,1);
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(item.job_id);
  await mergeAndStorePublishRecords(f.db,[{id:'uncertain',autoTaskId:item.id,autoBatchId:item.batch_id,status:'failed',officialRemoteStatus:'needs_review',createdAt:now,updatedAt:now}]);
  assert.equal((await occupied()).occupied.size,1);
  f.sqlite.prepare('UPDATE psychology_publish_items SET deleted_at=? WHERE id=?').run(now,item.id);
  assert.equal((await occupied()).occupied.size,1);
  assert.equal(f.requests.length,0);
});

test('pool POST rechecks current user permissions and account scope before writes', async t => {
  const f=await ready(t,{winner:true}),raw=request();
  await assert.rejects(f.call('POST',raw,'/api/psychology-auto-publish',{...actor,username:'other',role:'operator',allowedAccountGroups:['other']}),e=>e.statusCode===403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);
  await assert.rejects(f.call('POST',raw,'/api/psychology-auto-publish',{...actor,sidebarModules:[]}),e=>e.statusCode===403);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='b'").run();
  await assert.rejects(f.call('POST',raw),e=>e.statusCode===403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_pool_matches').get().n,0);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='g' WHERE account_key='b'").run();
  await f.call('POST',raw);
  const other={...actor,username:'other-owner'};
  const listed=await(await f.call('GET',undefined,'/api/psychology-auto-publish',other)).json();
  assert.equal(listed.batches.length,0);
  const item=itemRows(f)[0];
  await assert.rejects(f.call('DELETE',undefined,'/api/psychology-auto-publish/'+item.id,other),e=>e.statusCode===404);
  assert.equal(itemRows(f).length,2);
  assert.equal(f.requests.length,0);
});


test('real baseline allocation caps five occupied accounts and a definite failure opens exactly one slot', async t => {
  const f=await ready(t),ids=Array.from({length:6},(_,i)=>'test-account-'+i);
  const chosen=f.sqlite.prepare("SELECT id FROM psychology_copy_library WHERE media_type='photo' ORDER BY id LIMIT 1").get().id;
  f.sqlite.prepare("UPDATE psychology_copy_library SET status='queued' WHERE media_type='photo' AND id<>?").run(chosen);
  const previousFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,init)=>String(url).includes('/api/v1/accounts')
    ?Response.json({accounts:ids.map(id=>({id,username:id,scopes:['video.publish']}))}):previousFetch(url,init));
  for(const id of ids) {
    f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,'g');
    for(let i=0;i<6;i++)fact(f,id+'-history-'+i,{account_key:'tiktok:'+id});
  }
  const raw=request({count:6,connectionIds:ids});
  const result=await(await f.call('POST',raw)).json();
  assert.equal(result.count,5);assert.equal(result.skipped.length,1);assert.equal(result.skipped[0].connectionId,ids[5]);
  const allocated=itemRows(f);assert.equal(new Set(allocated.map(item=>item.source_key+'|'+item.variant_id+'|'+item.style_id+'|'+item.copy_hash)).size,1);
  const before=await loadPoolReservations(f.db,'admin',cycle,now);
  assert.equal(before.occupied.size,1);assert.equal([...before.occupied.values()][0].posts,5);assert.equal([...before.occupied.values()][0].accounts.size,5);
  const blocked=await(await f.call('POST',request({count:1,connectionIds:[ids[5]]}))).json();assert.equal(blocked.count,0);assert.equal(blocked.batchId,'');
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed' WHERE id=?").run(allocated[0].job_id);
  const released=await loadPoolReservations(f.db,'admin',cycle,now);assert.equal([...released.occupied.values()][0].posts,4);
  const replacement=await(await f.call('POST',request({count:1,connectionIds:[ids[5]]}))).json();assert.equal(replacement.count,1);
  const after=await loadPoolReservations(f.db,'admin',cycle,now);assert.equal([...after.occupied.values()][0].posts,5);assert.equal([...after.occupied.values()][0].accounts.size,5);
  assert.equal(f.requests.length,0);
});

test('review task members use two fixed-version validation rounds and one winner round, freezing the role', () => {
  const assignment={policyId:'policy',id:'policy:review',role:'review',revision:3,effectiveAt:cycle,accountPool:'normal',groupId:'g'};
  const taskAssignments=new Map([['a',assignment]]);
  const candidates=[candidate('cold','explore'),candidate('proven','winner')];
  for(const round of [0,1,2]){
    const result=plan({candidates,taskAssignments,context:context({postsPerDay:3,round})});
    assert.equal(result.plan.length,1);
    const match=result.plan[0].source.poolMatch;
    assert.equal(match.contentPool,round===2?'winner':'explore');
    assert.deepEqual(match.taskGroup,{policyId:'policy',timeZone:'Asia/Shanghai',id:'policy:review',role:'review',revision:3,effectiveAt:cycle});
  }
  const full=new Map([[candidates[0].key,{posts:5,accounts:new Set(['b','c','d','e','f'])}]]);
  const result=plan({candidates,taskAssignments,occupied:full,context:context({postsPerDay:3})});
  assert.equal(result.plan[0].source.poolMatch.contentPool,'winner');
});

test('a review role cannot bypass fresh weak-account evidence or cold-version limits', () => {
  const taskAssignments=new Map([['a',{policyId:'policy',id:'review',role:'review',revision:2,effectiveAt:cycle,accountPool:'normal'}]]);
  const result=plan({taskAssignments,accounts:accounts([['a','rescue-hook',{medianViews:100}]])});
  assert.equal(result.plan.length,0);assert.equal(result.skipped.length,1);
  const proved=plan({taskAssignments,accounts:accounts([['a','rescue-hook',{medianViews:100}]]),candidates:[candidate('baseline','winner')]});
  assert.equal(proved.plan[0].source.poolMatch.accountPool,'rescue-hook');
  assert.equal(proved.plan[0].source.poolMatch.contentPool,'winner');
});
