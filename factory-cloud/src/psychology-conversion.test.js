import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { kvSet } from './kv.js';
import { nextDay,PACIFIC_TIME_ZONE } from '../../scripts/psychology-schedule-time.js';
import { handleConversionCampaign,loadConversionAssignments,balanceConversionRoutes,applyConversionCopy,conversionFollowers,conversionSnapshotStatement } from './psychology-conversion.js';
const base='/api/psychology-autopilot/conversion',now=Date.parse('2026-10-06T10:00:00Z');
const user={username:'admin',role:'admin',sidebarModules:['psychology-autopilot','psychology-publish']};
async function setup(t){
 const f=await fixture(t);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=? WHERE username=?').run(JSON.stringify(user.sidebarModules),'admin');
 for(const [id,group] of [['a','g'],['b','g'],['c','g'],['outside','other']])f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,group);
 for(const [id,profile] of [['a',{username:'alpha'}],['b',{username:'target_b',followers:1200}],['c',{username:'target_c',followers:1800}],['outside',{username:'other',followers:2000}]])
  f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+id,JSON.stringify(profile),now);
 const directory={accounts:[{id:'a',username:'alpha',scopes:['video.publish']},{id:'b',username:'target_b',scopes:['video.publish']},{id:'c',username:'target_c',scopes:['video.publish']},{id:'outside',username:'other',scopes:['video.publish']}]};
 await kvSet(f.db,'psychology-autopilot-account-directory-v1',directory);
 async function call(method='GET',body,actor=user,time=now){
  const request=new Request('https://factory.test'+base,{method,...(body?{body:JSON.stringify(body)}:{})});
  const response=await handleConversionCampaign(request,f.env,new URL(request.url),actor,{directory,now:time});return {status:response.status,data:await response.json()};
 }
 const config={revision:0,enabled:true,websiteUrl:'https://deeppersonaai.com/',receivers:[{connectionId:'b',linkReady:true},{connectionId:'c',linkReady:true}]};
 return {...f,directory,call,config};
}
test('fresh project permissions, canonical aliases, nullable followers and GET have no writes',async t=>{
 const f=await setup(t),before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const read=await f.call();assert.equal(read.status,200);assert.deepEqual(read.data.accounts.map(a=>a.connectionId),['a','b','c']);
 assert.equal(read.data.accounts[0].followers,null);assert.equal(read.data.accounts[0].candidate,false);assert.equal(read.data.summary.eligibleReceivers,2);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
 f.sqlite.prepare("UPDATE factory_users SET active=0 WHERE username='admin'").run();assert.equal((await f.call()).status,403);
 assert.equal(f.requests.length,0);
});
test('conversion validates real receiver ownership, followers, bio confirmation and HTTPS',async t=>{
 const f=await setup(t);
 assert.equal((await f.call('PATCH',{...f.config,receivers:[{connectionId:'outside',linkReady:true}]})).status,403);
 assert.equal((await f.call('PATCH',{...f.config,receivers:[{connectionId:'a',linkReady:true}]})).status,400);
 assert.equal((await f.call('PATCH',{...f.config,receivers:[{connectionId:'b',linkReady:false}]})).status,400);
 assert.equal((await f.call('PATCH',{...f.config,websiteUrl:'http://example.com/'})).status,400);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_versions').get().n,0);
 assert.equal(conversionFollowers({followers:0}),0);assert.equal(conversionFollowers({followers:''}),null);assert.equal(conversionFollowers({followers:false}),null);
});
test('empty receivers enable conversion objective with fail-closed slot snapshots',async t=>{
 const f=await setup(t),saved=await f.call('PATCH',{...f.config,receivers:[]});assert.equal(saved.status,200);
 assert.equal(saved.data.config.enabled,true);assert.equal(saved.data.config.websiteUrl,'https://deeppersonaai.com/');
 const at=saved.data.config.effectiveAt,result=await loadConversionAssignments(f.db,'admin',['a','b'],[at-1,at]);
 assert.equal(result.has('a:'+(at-1)),false);assert.equal(result.get('a:'+at).objective,'conversion');assert.match(result.get('a:'+at).error,/待确认/);
});
test('versioned CAS changes future slots only and preserves every existing job',async t=>{
 const f=await setup(t);
 f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,strategy,current_strategy,slots_json,status,ends_at,created_at,updated_at) VALUES('p','admin','g','evolve','pools','[]','active',?,0,0)").run(now+10*86400000);
 const reserved=now+2*86400000;
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES('p',?,'created',0)").run(reserved);
 const before=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots').all(),first=await f.call('PATCH',f.config);
 assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.config.effectiveAt,nextDay(reserved,PACIFIC_TIME_ZONE));
 assert.equal((await f.call('PATCH',f.config)).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_versions').get().n,1);
 const second=await f.call('PATCH',{...f.config,revision:1,enabled:false},user,first.data.config.effectiveAt+1);
 assert.equal(second.status,200);const snapshots=await loadConversionAssignments(f.db,'admin',['a'],[first.data.config.effectiveAt,second.data.config.effectiveAt]);
 assert.equal(snapshots.get('a:'+first.data.config.effectiveAt).revision,1);assert.equal(snapshots.has('a:'+second.data.config.effectiveAt),false);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots').all(),before);
 assert.equal(f.requests.length,0);
});
test('stable balanced routing retains old routes and gives receivers their own bio',()=>{
 const ids=['a','b','c','d','e','f','g','h'],targets=['b','c'];
 const first=balanceConversionRoutes(ids,targets);assert.equal(first.b,'b');assert.equal(first.c,'c');
 const counts=targets.map(id=>Object.values(first).filter(value=>value===id).length);assert.deepEqual(counts,[4,4]);
 const second=balanceConversionRoutes([...ids,'i'],targets,first);for(const id of ids)assert.equal(second[id],first[id]);
 const removed=balanceConversionRoutes(ids,['b'],first);assert.ok(Object.values(removed).every(id=>id==='b'));
});
test('receiver loss, rename, missing publish scope and new source do not fall back to growth',async t=>{
 const f=await setup(t),saved=await f.call('PATCH',f.config),at=saved.data.config.effectiveAt;
 let snapshot=(await loadConversionAssignments(f.db,'admin',['a','b'],[at])).get('b:'+at);assert.equal(snapshot.receiverConnectionId,'b');assert.match(snapshot.cta,/my bio/);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='b'").run();
 snapshot=(await loadConversionAssignments(f.db,'admin',['b'],[at])).get('b:'+at);assert.match(snapshot.error,/待确认/);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='g' WHERE account_key='b'").run();
 f.directory.accounts.find(a=>a.id==='b').username='renamed';await kvSet(f.db,'psychology-autopilot-account-directory-v1',f.directory);
 assert.match((await loadConversionAssignments(f.db,'admin',['b'],[at])).get('b:'+at).error,/待确认/);
 assert.match((await loadConversionAssignments(f.db,'admin',['new'],[at])).get('new:'+at).error,/待确认/);
});
const route={objective:'conversion',connectionId:'a',receiverConnectionId:'b',username:'target_b',linkReady:true,revision:1,effectiveAt:now};
test('CTA freezes cloned caption and last card without losing a six-card story, and is idempotent',()=>{
 const plan={title:'Title',caption:'Original caption',scenes:Array.from({length:6},(_,i)=>({title:'Card '+i,subtitle:'Subtitle',body:'Body',sourceIndex:i+1}))};
 const copy=applyConversionCopy(plan,route);assert.equal(copy.scenes.length,6);assert.equal(plan.caption,'Original caption');assert.equal(plan.scenes[5].title,'Card 5');
 assert.match(copy.caption,/@target_b/);assert.match(copy.scenes[5].title,/Card 5\nSubtitle\nBody/);assert.match(copy.scenes[5].title,/@target_b/);
 assert.deepEqual(applyConversionCopy(copy,route),copy);
 const self=applyConversionCopy(plan,{...route,connectionId:'b'});assert.match(self.caption,/my bio/);assert.doesNotMatch(self.caption,/@target_b/);
 assert.throws(()=>applyConversionCopy(copy,{...route,revision:2}),/其他/);
});
test('invalid routes, overlong captions and last-card overflow reject without shortening source',()=>{
 const plan={caption:'a'.repeat(2199),scenes:[{title:'Original'}]};assert.throws(()=>applyConversionCopy(plan,route),/2200/);assert.equal(plan.caption.length,2199);
 assert.throws(()=>applyConversionCopy({caption:'Ok',scenes:[{title:'a'.repeat(1490)}]},route),/1500/);
 assert.throws(()=>applyConversionCopy({scenes:[{title:'Ok'}]},{...route,username:'invalid handle'}),/待配置/);
 assert.throws(()=>applyConversionCopy({scenes:[]},route),/1–6/);
});
test('atomic allocation CAS rejects superseded revision and receiver permission race with rollback',async t=>{
 const f=await setup(t),saved=await f.call('PATCH',f.config),at=saved.data.config.effectiveAt;
 const snap=(await loadConversionAssignments(f.db,'admin',['b'],[at])).get('b:'+at),item={id:'item-one',connectionId:'b',scheduleAt:at/1000};
 await f.db.batch([conversionSnapshotStatement(f.db,item,{...snap,baseCopyHash:'base',finalCopyHash:'final'},now)]);
 assert.equal(f.sqlite.prepare('SELECT final_copy_hash FROM psychology_conversion_allocations').get().final_copy_hash,'final');
 await f.call('PATCH',{...f.config,revision:1,receivers:[{connectionId:'c',linkReady:true}]});
 await assert.rejects(f.db.batch([f.db.prepare("INSERT INTO factory_kv(key,value_json,updated_at) VALUES('race-test','{}',0)"),conversionSnapshotStatement(f.db,{...item,id:'race'},snap,now)]),/NOT NULL/);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM factory_kv WHERE key='race-test'").get().n,0);
 const fresh=(await loadConversionAssignments(f.db,'admin',['c'],[at])).get('c:'+at);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='c'").run();
 await assert.rejects(f.db.batch([conversionSnapshotStatement(f.db,{...item,id:'race-permission',connectionId:'c'},fresh,now)]),/NOT NULL/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_allocations').get().n,1);
});

test('revoked operating permissions cannot turn an enabled conversion slot back into growth',async t=>{
 const f=await setup(t),saved=await f.call('PATCH',f.config),at=saved.data.config.effectiveAt;
 f.sqlite.prepare("UPDATE factory_users SET role='operator' WHERE username='admin'").run();
 assert.equal((await loadConversionAssignments(f.db,'admin',['a'],[at-1])).size,0);
 await assert.rejects(loadConversionAssignments(f.db,'admin',['a'],[at]),error=>error.statusCode===403);
});
test('direct campaign PATCH rejects cross-origin before any configuration write',async t=>{
 const f=await setup(t),request=new Request('https://factory.test'+base,{method:'PATCH',headers:{Origin:'https://attacker.test'},body:JSON.stringify(f.config)});
 const response=await handleConversionCampaign(request,f.env,new URL(request.url),user,{directory:f.directory,now});
 assert.equal(response.status,403);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_versions').get().n,0);
});
test('fresh account directory overrides cached handles and publish scope at allocation',async t=>{
 const f=await setup(t),saved=await f.call('PATCH',f.config),at=saved.data.config.effectiveAt;
 const fresh=structuredClone(f.directory);fresh.accounts.find(a=>a.id==='b').username='new_handle';
 const result=await loadConversionAssignments(f.db,'admin',['b'],[at],{directory:fresh.accounts});
 assert.match(result.get('b:'+at).error,/待确认/);
 fresh.accounts.find(a=>a.id==='b').username='target_b';fresh.accounts.find(a=>a.id==='b').scopes=[];
 assert.match((await loadConversionAssignments(f.db,'admin',['b'],[at],{directory:fresh})).get('b:'+at).error,/待确认/);
});

test('a slot reserved during campaign save rejects atomically without an empty owner claim',async t=>{
 const f=await setup(t);
 f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,strategy,current_strategy,slots_json,status,ends_at,created_at,updated_at) VALUES('p','admin','g','evolve','pools','[]','active',?,0,0)").run(now+10*86400000);
 const originalBatch=f.db.batch;
 f.db.batch=async statements=>{
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES('p',?,'created',0)").run(nextDay(now,PACIFIC_TIME_ZONE));
  return originalBatch(statements);
 };
 const result=await f.call('PATCH',f.config);assert.equal(result.status,409);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_campaigns').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_conversion_versions').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_autopilot_slots').get().n,1);
});
