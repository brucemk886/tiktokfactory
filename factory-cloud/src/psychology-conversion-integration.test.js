import test from 'node:test';
import assert from 'node:assert/strict';
import { planPoolMatches } from './psychology-pool-matching.js';
import { poolPerformanceKey } from './psychology-pool-report.js';

// Pure allocation integration: no HTTP, generation, publishing or GeeLark calls.
const now = Date.parse('2026-10-06T08:00:00-07:00');
const cycle = now - 4 * 86400000;
const context = extra => ({ cycleStartAt:cycle, postsPerDay:3, dayIndex:4, round:0, asOf:now, ...extra });
const stats = extra => ({ n:6, medianViews:600, completion:0.2, potentialRate:0.1, ...extra });
const accounts = entries => new Map(entries.map(([id,pool='normal',extra={}]) => [
  'tiktok:'+id, { account:'tiktok:'+id, pool, stats:stats(extra) },
]));
const slots = ids => ids.map((connectionId,index) => ({ connectionId, scheduleAt:now / 1000 + 7200 + index * 45 }));
const route = extra => ({ objective:'conversion', revision:1, effectiveAt:cycle,
  receiverConnectionId:'receiver-id', username:'receiver', linkReady:true,
  cta:'For your full result, visit @receiver and tap the link in their bio to take the test.', ...extra });
const routeKey = slot => slot.connectionId+':'+slot.scheduleAt * 1000;
const conversionFor = (scheduled, snapshot=route()) => new Map(scheduled.map(slot => [routeKey(slot), snapshot]));
function candidate(source='source',pool='explore',extra={}) {
  const identity={ hash:'a'.repeat(64), copy:{ title:'A specific hook', caption:'A useful question', pages:['A specific hook','One concrete idea.'] } };
  const styleDefinition={ id:'classic', enabled:true, revision:0 };
  const value={ post:{sourceKey:source}, source:{ id:source, sourceKey:source, title:'A specific hook' },
    variantId:'', identity, styleDefinition, pool, occupied:0,
    stats:stats({ n:pool==='explore'?0:5, accounts:pool==='explore'?0:5, versionKnown:true, styleKnown:true }), ...extra };
  value.key=poolPerformanceKey({ source, variant:value.variantId, style:styleDefinition.id, copyHash:identity.hash, styleRevision:0 });
  return value;
}
const plan = extra => planPoolMatches({ candidates:[candidate()], accounts:accounts([['a','normal']]),
  slots:slots(['a']), context:context(), owner:'admin', ...extra });

test('conversion directly serves rescue, diagnostic, observing and launch accounts while growth waits', () => {
  const ids=['rescue','diagnostic','observing','launch'];
  const scheduled=slots(ids);
  const observed=accounts([['rescue','rescue-hook',{medianViews:100}],['diagnostic','diagnostic',{medianViews:10}],
    ['observing','observing',{n:0,medianViews:null}],['launch','observing',{n:0,medianViews:null}]]);
  const taskAssignments=new Map([['launch',{policyId:'policy',role:'launch',revision:1,effectiveAt:cycle}]]);
  const cycles=new Map([['diagnostic',{posts:6,initialPool:'diagnostic',mature:0,sources:0,stats:stats({n:0,medianViews:null})}]]);
  const growth=plan({accounts:observed,slots:scheduled,taskAssignments,cycles});
  assert.equal(growth.plan.length,0);
  assert.equal(growth.skipped.length,4);
  const converted=plan({accounts:observed,slots:scheduled,taskAssignments,cycles,conversionAssignments:conversionFor(scheduled)});
  assert.deepEqual(converted.plan.map(item=>item.connectionId),ids);
  assert.equal(converted.skipped.length,0);
  assert.ok(converted.plan.every(item=>item.source.poolMatch.warmup===false));
  assert.ok(converted.plan.every(item=>item.source.conversion.username==='receiver'));
});

test('conversion selects proven content instead of retaining review-round baseline work', () => {
  const scheduled=slots(['a']);
  const candidates=[candidate('cold'),candidate('proven','winner')];
  const taskAssignments=new Map([['a',{policyId:'policy',id:'policy-review',role:'review',revision:2,effectiveAt:cycle,accountPool:'normal'}]]);
  const growth=plan({candidates,taskAssignments,slots:scheduled});
  assert.equal(growth.plan[0].post.sourceKey,'cold');
  const converted=plan({candidates,taskAssignments,slots:scheduled,conversionAssignments:conversionFor(scheduled)});
  assert.equal(converted.plan[0].post.sourceKey,'proven');
  assert.equal(converted.plan[0].source.poolMatch.contentPool,'winner');
  assert.equal(converted.plan[0].source.poolMatch.warmup,false);
});

test('conversion is not capped by five occupied cold baseline samples across different accounts', () => {
  const ids=Array.from({length:7},(_,index)=>'conversion-'+index);
  const scheduled=slots(ids), cold=candidate();
  const occupied=new Map([[cold.key,{posts:5,accounts:new Set(['historical-1','historical-2','historical-3','historical-4','historical-5'])}]]);
  const observed=accounts(ids.map(id=>[id,'normal']));
  const growth=plan({candidates:[cold],accounts:observed,slots:scheduled,occupied});
  assert.equal(growth.plan.length,0);
  const converted=plan({candidates:[cold],accounts:observed,slots:scheduled,occupied,conversionAssignments:conversionFor(scheduled)});
  assert.equal(converted.plan.length,7);
  assert.equal(converted.skipped.length,0);
  assert.equal(new Set(converted.plan.map(item=>item.connectionId)).size,7);
  assert.ok(converted.plan.every(item=>item.source.poolMatch.warmup===false));
});

test('conversion preserves source nonreuse across versions and repeated slots for one account', () => {
  const scheduled=slots(['a','a']);
  const used=new Map([['a',new Set(['already-used'])]]);
  const result=plan({slots:scheduled,used,candidates:[candidate('already-used','winner'),
    candidate('already-used','winner',{variantId:'rewrite'}),candidate('fresh','winner')],
    conversionAssignments:conversionFor(scheduled)});
  assert.equal(result.plan.length,1);
  assert.equal(result.plan[0].post.sourceKey,'fresh');
  assert.equal(result.skipped.length,1);
  assert.deepEqual([...used.get('a')].sort(),['already-used','fresh']);
});

test('invalid or unconfigured conversion routes skip independently instead of publishing a growth fallback', () => {
  const cases=[null,undefined,{objective:'conversion',error:'转化承接账号待配置'},route({objective:'growth'}),route({cta:''}),route({receiverConnectionId:''}),
    route({username:''}),route({username:'receiver with spaces'}),route({linkReady:false})];
  const ids=cases.map((_,index)=>'invalid-'+index),scheduled=slots(ids);
  const conversionAssignments=new Map(scheduled.map((slot,index)=>[routeKey(slot),cases[index]]));
  const result=plan({candidates:[candidate('proven','winner')],accounts:accounts(ids.map(id=>[id,'strong'])),
    slots:scheduled,conversionAssignments});
  assert.equal(result.plan.length,0);
  assert.deepEqual(result.skipped.map(item=>item.connectionId),ids);
  assert.ok(result.skipped.every(item=>typeof item.reason==='string'&&item.reason.length>0));
});

test('one broken conversion route does not prevent another authorized account from publishing', () => {
  const scheduled=slots(['broken','ready']);
  const routes=new Map([[routeKey(scheduled[0]),{objective:'conversion',error:'转化承接账号待配置'}],
    [routeKey(scheduled[1]),route()]]);
  const result=plan({candidates:[candidate('proven','winner')],accounts:accounts([['broken','normal'],['ready','observing',{n:0,medianViews:null}]]),
    slots:scheduled,conversionAssignments:routes});
  assert.deepEqual(result.plan.map(item=>item.connectionId),['ready']);
  assert.deepEqual(result.skipped.map(item=>item.connectionId),['broken']);
});

test('an empty conversion map preserves the existing growth-mode diagnostic gate', () => {
  const cycles=new Map([['a',{posts:6,initialPool:'diagnostic',mature:0,sources:0,stats:stats({n:0,medianViews:null})}]]);
  const options={candidates:[candidate('proven','winner')],accounts:accounts([['a','diagnostic',{medianViews:10}]]),cycles};
  const baseline=plan(options),empty=plan({...options,conversionAssignments:new Map()});
  assert.deepEqual(empty,baseline);
  assert.equal(empty.plan.length,0);
  assert.match(empty.skipped[0].reason,/六条诊断/);
});

test('conversion route keys use the exact account and scheduled millisecond instant', () => {
  const scheduled=slots(['a','a']);
  const first=route({receiverConnectionId:'first-id',username:'first',revision:4,cta:'Visit @first for the test.'});
  const second=route({receiverConnectionId:'second-id',username:'second',revision:5,cta:'Visit @second for the test.'});
  const routes=new Map([[routeKey(scheduled[0]),first],[routeKey(scheduled[1]),second]]);
  const result=plan({slots:scheduled,candidates:[candidate('one','winner'),candidate('two','winner')],conversionAssignments:routes});
  assert.equal(result.plan.length,2);
  assert.deepEqual(result.plan.map(item=>item.source.conversion),[first,second]);
  assert.equal(new Set(result.plan.map(item=>item.post.sourceKey)).size,2);
});

test('a valid conversion route cannot grant access to an account missing from authorized observations', () => {
  const scheduled=slots(['a','outside']);
  const result=plan({slots:scheduled,candidates:[candidate('proven','winner')],conversionAssignments:conversionFor(scheduled)});
  assert.deepEqual(result.plan.map(item=>item.connectionId),['a']);
  assert.equal(result.skipped.length,1);
  assert.equal(result.skipped[0].connectionId,'outside');
  assert.match(result.skipped[0].reason,/授权/);
});



// Real handlers backed by in-memory SQLite; every external call is intercepted.
async function conversionFixture(t) {
  t.mock.method(Date,'now',()=>now);
  const [{fixture,input},{loadGroupStore},{kvSet},{handleConversionCampaign}] = await Promise.all([
    import('./psychology-cloud-test-fixture.js'),import('./official.js'),import('./kv.js'),import('./psychology-conversion.js'),
  ]);
  const f=await fixture(t);
  const actor={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-autopilot']};
  f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=? WHERE username=?').run(JSON.stringify(actor.sidebarModules),'admin');
  await loadGroupStore(f.db);
  const directory={accounts:[
    {id:'a',connectionId:'a',username:'sender',scopes:['video.publish']},
    {id:'b',connectionId:'b',username:'receiver',scopes:['video.publish']},
  ]};
  const persistDirectory=()=>kvSet(f.db,'psychology-autopilot-account-directory-v1',directory);
  await persistDirectory();
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(new URL(url).pathname,'/api/v1/accounts','unexpected external request');
    return Response.json(directory);
  });
  f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,snapshot_date,synced_at,profile_json) VALUES(?,?,?,?)')
    .run('tiktok:b','2026-10-06',now,JSON.stringify({username:'receiver',followers:1500}));
  const sourceRows=f.sqlite.prepare("SELECT * FROM psychology_copy_library WHERE media_type='photo' ORDER BY id").all();
  f.sqlite.prepare("UPDATE psychology_copy_library SET status='queued' WHERE media_type='photo'").run();
  function enableSource(index) {
    const content=JSON.stringify({title:'A specific hook '+index,caption:'Which habit feels familiar?',
      pages:[{text:'One familiar relationship habit '+index+'.'},{text:'Ask one clear question before guessing their answer.'}]});
    f.sqlite.prepare("UPDATE psychology_copy_library SET status='done',content_json=? WHERE id=?").run(content,sourceRows[index].id);
    return content;
  }
  const firstContent=enableSource(0);
  async function campaign(body,time=now) {
    const url=new URL('https://factory.test/api/psychology-autopilot/conversion');
    const response=await handleConversionCampaign(new Request(url,{method:'PATCH',body:JSON.stringify(body)}),f.env,url,actor,{directory,now:time});
    const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));
    return data;
  }
  async function publish(scheduleAt,extra={}) {
    const body=input({mediaType:'photo',template:'photo-text',sourceType:'library',libraryStrategy:'pools',libraryTestPolicy:'pools-v1',
      count:2,connectionIds:['a','b'],scheduleAt,staggerSeconds:45,poolContext:context(),...extra});
    const response=await f.call('POST',body,'/api/psychology-auto-publish',actor);
    const result=await response.json();assert.equal(response.status,202,JSON.stringify(result));
    return {body,result};
  }
  function items(batchId) {
    return f.sqlite.prepare('SELECT i.connection_id,i.schedule_at,j.payload_json,c.copy_hash,c.copy_json,a.route_json,a.base_copy_hash,a.final_copy_hash,a.revision,a.receiver_connection_id FROM psychology_publish_items i JOIN factory_jobs j ON j.id=i.job_id JOIN psychology_creative_snapshots c ON c.item_id=i.id JOIN psychology_conversion_allocations a ON a.item_id=i.id WHERE i.batch_id=? ORDER BY i.connection_id').all(batchId);
  }
  return {...f,actor,directory,persistDirectory,sourceRows,enableSource,firstContent,campaign,publish,items};
}

test('real conversion POST freezes account-specific CTA and hash, immutable library, replay, and revision boundary',async t=>{
  const {copyIdentity}=await import('./psychology-creative.js');
  const f=await conversionFixture(t);
  const saved=await f.campaign({revision:0,enabled:true,websiteUrl:'https://example.com/test',receivers:[{connectionId:'b',linkReady:true}]});
  const {librarySource}=await import('./psychology-copy-source.js');
  const sourcePlan=librarySource(f.sqlite.prepare('SELECT * FROM psychology_copy_library WHERE id=?').get(f.sourceRows[0].id),'photo').copyVariant;
  const baseIdentity=await copyIdentity(sourcePlan);
  const scheduled=(saved.config.effectiveAt+8*3600000)/1000;
  const first=await f.publish(scheduled);
  assert.equal(first.result.count,2,'unsampled accounts directly receive conversion content');
  const frozen=f.items(first.result.batchId);
  assert.equal(frozen.length,2);
  for(const row of frozen) {
    const payload=JSON.parse(row.payload_json),snapshot=payload.psychologyAutomation.conversion;
    const identity=await copyIdentity(payload.copyVariant);
    assert.equal(snapshot.revision,1);assert.equal(snapshot.receiverConnectionId,'b');assert.equal(snapshot.username,'receiver');
    assert.equal(payload.rewriteCopy,false);
    assert.equal(row.copy_hash,identity.hash);assert.equal(row.final_copy_hash,identity.hash);
    assert.equal(payload.psychologyAutomation.poolMatch.copyHash,identity.hash);
    assert.equal(payload.psychologyAutomation.poolMatch.baseCopyHash,row.base_copy_hash);
    assert.notEqual(row.base_copy_hash,row.final_copy_hash);
    assert.equal(payload.copyVariant.caption.split(snapshot.cta).length,2,'caption CTA appended once');
    assert.deepEqual(payload.copyVariant.scenes,sourcePlan.scenes,'every scene remains identical to library source');
    assert.deepEqual(identity.copy.pages,baseIdentity.copy.pages);
    assert.doesNotMatch(JSON.stringify(payload.copyVariant.scenes),/@receiver|For your full result/);
    assert.equal(payload.copyVariant.conversion.placement,'caption-only');
    assert.deepEqual(JSON.parse(row.route_json),snapshot);
  }
  assert.equal(frozen[0].base_copy_hash,frozen[1].base_copy_hash,'base evidence is shared for the same library copy');
  assert.notEqual(frozen[0].final_copy_hash,frozen[1].final_copy_hash,'receiver and ordinary CTA do not share final content hash');
  assert.match(JSON.parse(frozen[0].payload_json).copyVariant.caption,/@receiver/);
  assert.match(JSON.parse(frozen[1].payload_json).copyVariant.caption,/link in my bio/);
  assert.equal(f.sqlite.prepare('SELECT content_json FROM psychology_copy_library WHERE id=?').get(f.sourceRows[0].id).content_json,f.firstContent);

  f.directory.accounts[1].username='receiver_new';await f.persistDirectory();
  f.sqlite.prepare('UPDATE official_accounts_latest SET profile_json=? WHERE account_key=?')
    .run(JSON.stringify({username:'receiver_new',followers:1500}),'tiktok:b');
  const next=await f.campaign({revision:1,enabled:true,websiteUrl:'https://example.com/test',receivers:[{connectionId:'b',linkReady:true}]});
  assert.equal(next.config.revision,2);
  assert.ok(next.config.effectiveAt>Math.max(...frozen.map(row=>row.schedule_at*1000)),'new route starts after every reserved item');
  const duplicate=await f.call('POST',first.body,'/api/psychology-auto-publish',f.actor);
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).duplicate,true);
  assert.deepEqual(f.items(first.result.batchId),frozen,'replay cannot change an existing task snapshot');

  f.enableSource(1);
  const second=await f.publish((next.config.effectiveAt+8*3600000)/1000);
  assert.equal(second.result.count,2);
  const current=f.items(second.result.batchId);
  assert.ok(current.every(row=>row.revision===2));
  assert.ok(current.every(row=>JSON.parse(row.route_json).username==='receiver_new'));
  assert.match(JSON.parse(current[0].payload_json).copyVariant.caption,/@receiver_new/);
  assert.deepEqual(f.items(first.result.batchId),frozen);
  assert.equal(f.sqlite.prepare('SELECT content_json FROM psychology_copy_library WHERE id=?').get(f.sourceRows[0].id).content_json,f.firstContent);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_allocations').get().n,4);
  assert.equal(f.requests.length,0);
});

test('real conversion POST with no receiver creates no item, usage or allocation even for a strong account',async t=>{
  const f=await conversionFixture(t),past=now-4*86400000;
  const insert=f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,source,variant,style,copy_hash,state,views,completion) VALUES(?,?,'tiktok:a','photo',?,?,?,'','classic','historical-copy','published',600,0.2)");
  for(let index=0;index<6;index++)insert.run('history-'+index,'history',past,past,'history-source-'+index);
  const saved=await f.campaign({revision:0,enabled:true,websiteUrl:'https://example.com/test',receivers:[]});
  const posted=await f.publish((saved.config.effectiveAt+8*3600000)/1000);
  assert.equal(posted.result.count,0);assert.equal(posted.result.batchId,'');assert.equal(posted.result.skipped.length,2);
  for(const table of ['psychology_publish_items','psychology_conversion_allocations','psychology_peer_account_usage'])
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.equal(f.requests.length,0);
});





test('caption-only conversion CTA stays out of every rendered card and enqueue preserves final identity',async t=>{
  const [{runPeerPhotoWorkflow},{enqueueAutoPhotoRender},{copyIdentity}]=await Promise.all([
    import('./peer-photo-workflow.js'),import('./psychology-auto-publish.js'),import('./psychology-creative.js'),
  ]);
  const f=await conversionFixture(t);
  const saved=await f.campaign({revision:0,enabled:true,websiteUrl:'https://example.com/test',receivers:[{connectionId:'b',linkReady:true}]});
  const posted=await f.publish((saved.config.effectiveAt+8*3600000)/1000);
  assert.equal(posted.result.count,2);
  const before=f.items(posted.result.batchId);
  const {librarySource}=await import('./psychology-copy-source.js');
  const sourcePlan=librarySource(f.sqlite.prepare('SELECT * FROM psychology_copy_library WHERE id=?').get(f.sourceRows[0].id),'photo').copyVariant;
  const baseIdentity=await copyIdentity(sourcePlan);
  delete f.env.DEEPSEEK_API_KEY;delete f.env.KIE_API_KEY;
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected external request during text-card conversion');});
  const step={async do(name,config,fn){return (typeof config==='function'?config:fn)();},
    async sleep(){throw new Error('Unexpected workflow wait');}};
  for(const frozen of before) {
    const item=f.sqlite.prepare('SELECT id,job_id FROM psychology_publish_items WHERE batch_id=? AND connection_id=?')
      .get(posted.result.batchId,frozen.connection_id);
    const originalPayload=JSON.parse(frozen.payload_json),cta=originalPayload.psychologyAutomation.conversion.cta;
    assert.equal(originalPayload.rewriteCopy,false);
    await runPeerPhotoWorkflow(f.env,{payload:{jobId:item.job_id}},step);
    const completed=f.sqlite.prepare('SELECT status,result_json FROM factory_jobs WHERE id=?').get(item.job_id);
    assert.equal(completed.status,'done');
    const result=JSON.parse(completed.result_json),identity=await copyIdentity(result.plan);
    assert.equal(result.sourceCopyCache,'imported');
    assert.equal(result.results.length,originalPayload.copyVariant.scenes.length);
    assert.equal(result.plan.caption.split(cta).length,2);
    assert.deepEqual(originalPayload.copyVariant.scenes,sourcePlan.scenes);
    assert.deepEqual(result.plan.scenes,sourcePlan.scenes);
    assert.deepEqual(identity.copy.pages,baseIdentity.copy.pages);
    assert.doesNotMatch(JSON.stringify(result.results),/@receiver|For your full result/);
    assert.equal(result.plan.conversion.placement,'caption-only');
    assert.equal(result.results.at(-1).text,result.plan.scenes.at(-1).text);
    assert.equal(result.results.at(-1).title,identity.copy.pages.at(-1));
    assert.equal(identity.hash,frozen.final_copy_hash,'styling and repeated route application preserve final identity');
    assert.deepEqual(await runPeerPhotoWorkflow(f.env,{payload:{jobId:item.job_id}},step),{skipped:true});
    const enqueued=await enqueueAutoPhotoRender(f.env,item.job_id);
    const render=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs WHERE id=?').get(enqueued.jobId).payload_json);
    assert.deepEqual(render.plan,result.plan);assert.deepEqual(render.pages,result.results);
    assert.deepEqual(render.psychologyAutomation.conversion,originalPayload.psychologyAutomation.conversion);
    const snapshot=f.sqlite.prepare('SELECT c.copy_hash,c.copy_json,a.final_copy_hash,a.base_copy_hash FROM psychology_creative_snapshots c JOIN psychology_conversion_allocations a ON a.item_id=c.item_id WHERE c.item_id=?').get(item.id);
    assert.equal(snapshot.copy_hash,identity.hash);assert.equal(snapshot.final_copy_hash,identity.hash);
    assert.equal(snapshot.base_copy_hash,frozen.base_copy_hash);assert.deepEqual(JSON.parse(snapshot.copy_json),identity.copy);
  }
  assert.equal(f.sqlite.prepare('SELECT content_json FROM psychology_copy_library WHERE id=?').get(f.sourceRows[0].id).content_json,f.firstContent);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_allocations').get().n,2);
  assert.equal(f.requests.length,0);
});
