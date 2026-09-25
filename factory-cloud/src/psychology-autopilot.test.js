import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { handlePsychologyAutopilot, runAutopilot, dueSlots, guardAccounts, AUTOPILOT, normalizePilotSlots, pilotSlotsAt, pilotPairSeed, autopilotViewWindow } from './psychology-autopilot.js';
import { planLibraryDraw, EVOLUTION } from './psychology-copy-evolution.js';
import { normalizeAutoPublish, assignments } from '../../scripts/psychology-auto-publish.js';

const HOUR = 3600000, DAY = 24 * HOUR;
const admin = { id: 'admin', username: 'admin', role: 'admin', sidebarModules: ['psychology-publish', 'psychology-autopilot'] };
const at = (date, hm) => Date.parse(`${date}T${hm}:00+08:00`);

test('due slots are the Beijing 08:00 / 12:00 / 21:00 times 2–26 hours ahead, inside the run period', () => {
  const pilot = { slots_json: JSON.stringify(AUTOPILOT.slots), created_at: at('2026-09-23', '00:00'), ends_at: at('2026-09-30', '00:00') };
  assert.deepEqual(dueSlots(pilot, at('2026-09-24', '00:00')), [at('2026-09-24', '08:00'), at('2026-09-24', '12:00'), at('2026-09-24', '21:00')]);
  assert.deepEqual(dueSlots(pilot, at('2026-09-24', '08:00')), [at('2026-09-24', '12:00'), at('2026-09-24', '21:00'), at('2026-09-25', '08:00')]);
  assert.deepEqual(dueSlots(pilot, at('2026-09-24', '11:00')), [at('2026-09-24', '21:00'), at('2026-09-25', '08:00'), at('2026-09-25', '12:00')]); // 12:00 is under 2h away
  assert.deepEqual(dueSlots(pilot, at('2026-09-29', '08:00')), [at('2026-09-29', '12:00'), at('2026-09-29', '21:00')]); // run ends at 09-30 00:00
});

test('guard pauses five low matured posts since the start or three failed publishes in a row', () => {
  const now = at('2026-09-26', '12:00'), pilot = { created_at: at('2026-09-23', '00:00') };
  const posts = (views, startDay = 24) => views.map((v, i) => ({ createTime: (at(`2026-09-${startDay}`, '08:00') + i * 5 * HOUR) / 1000, views: v }));
  const videosByConnection = new Map([
    ['low', posts([10, 50, 199, 0, 120])],
    ['one-ok', posts([10, 50, 250, 0, 120])],
    ['old-low', [...posts([1, 1, 1, 1], 20), ...posts([5])]], // low posts before the pilot started do not count
    ['fresh', [...posts([1, 1, 1, 1]), { createTime: (now - HOUR) / 1000, views: 0 }]],
  ]);
  const outcomesByConnection = new Map([['failing', ['failed', 'failed', 'failed']], ['recovered', ['failed', 'failed', 'published']]]);
  const ids = ['low', 'one-ok', 'old-low', 'fresh', 'failing', 'recovered'];
  assert.deepEqual(guardAccounts({ pilot, connectionIds: ids, videosByConnection, outcomesByConnection, now }).map(p => [p.id, p.reason]),
    [['low', '连续5条满24小时播放都低于200'], ['failing', '连续3次发布失败']]);
});

test('library draw strategies: original only never uses rewrites, rewrite-first falls back to the original', () => {
  const post = (key, rewrites) => ({ sourceKey: key, createdAt: 1, original: { id: key }, rewrites: rewrites.map(r => ({ external_id: r })) });
  const posts = [post('p1', ['r1', 'r2']), post('p2', [])];
  const slots = [{ connectionId: 'a' }, { connectionId: 'b' }, { connectionId: 'c' }, { connectionId: 'd' }];
  const original = planLibraryDraw({ posts, slots: slots.slice(0, 2), strategy: 'original', random: () => 0 });
  assert.deepEqual(original.map(p => [p.post.sourceKey, p.variantId]).sort(), [['p1', ''], ['p2', '']]);
  assert.throws(() => planLibraryDraw({ posts, slots: slots.slice(0, 3), strategy: 'original', random: () => 0 }), /不够/);
  const rewrite = planLibraryDraw({ posts, slots, strategy: 'rewrite', random: () => 0 });
  assert.deepEqual(rewrite.filter(p => p.post.sourceKey === 'p1').map(p => p.variantId).sort(), ['', 'r1', 'r2']);
  assert.deepEqual(rewrite.filter(p => p.post.sourceKey === 'p2').map(p => p.variantId), ['']);
});

test('paired draws with the same seed give different groups the same posts, differing only in version', () => {
  const posts = Array.from({ length: 12 }, (_, n) => ({ sourceKey: 'p' + n, createdAt: n, original: { id: 'p' + n }, rewrites: [{ external_id: 'p' + n + '-r' }] }));
  const stats = new Map(posts.slice(0, 6).map((p, n) => [p.sourceKey + '|', { posts: 5, mature: 5, avgViews: 1000 + n }]));
  const slots = group => Array.from({ length: 5 }, (_, i) => ({ connectionId: group + i }));
  const draw = (group, strategy, seed) => planLibraryDraw({ posts, stats, slots: slots(group), strategy, pairSeed: seed });
  const a = draw('a', 'evolve', 'owner:1'), b = draw('b', 'original', 'owner:1'), c = draw('c', 'rewrite', 'owner:1');
  const keys = plan => plan.map(p => p.post.sourceKey);
  assert.deepEqual(keys(b), keys(a));
  assert.deepEqual(keys(c), keys(a));
  assert.ok(b.every(p => p.variantId === ''));
  assert.ok(c.every(p => p.variantId.endsWith('-r')));
  assert.notDeepEqual(keys(draw('a', 'evolve', 'owner:2')), keys(a)); // another slot, another order
  // Accounts that already used the first posts in the order stay aligned across groups.
  const used = group => new Map(slots(group).map(s => [s.connectionId, new Set(keys(a))]));
  const next = group => planLibraryDraw({ posts, stats, slots: slots(group), used: used(group), strategy: 'original', pairSeed: 'owner:3' });
  assert.deepEqual(keys(next('x')), keys(next('y')));
  assert.ok(keys(next('x')).every(k => !keys(a).includes(k)));
});

test('stagger spreads each slot across accounts and only appears in configs that use it', () => {
  const base = { requestId: crypto.randomUUID(), mediaType: 'photo', template: 'photo-text', sourceType: 'library', count: 3, connectionIds: ['a', 'b', 'c'], scheduleAt: Math.floor(Date.now() / 1000) + 7200, intervalMinutes: 60 };
  const plain = normalizeAutoPublish(base);
  assert.equal('staggerSeconds' in plain, false);
  assert.equal('libraryStrategy' in plain, false);
  const config = normalizeAutoPublish({ ...base, staggerSeconds: 45, libraryStrategy: 'rewrite' });
  assert.deepEqual(assignments(config, [1, 2, 3]).map(a => a.scheduleAt - config.scheduleAt), [0, 45, 90]);
  assert.equal(config.libraryStrategy, 'rewrite');
  assert.throws(() => normalizeAutoPublish({ ...base, libraryStrategy: 'bogus' }), /策略/);
  assert.throws(() => normalizeAutoPublish({ ...base, staggerSeconds: 601 }), /错开/);
});

async function pilotFixture(t) {
  const f = await fixture(t);
  f.env.ARCHIVE = { async get() { return null; }, async put() {}, async delete() {} };
  for (const id of ['a', 'b']) f.sqlite.prepare("INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES(?,?,?,?)").run('tiktok:' + id, id, JSON.stringify({ username: id }), Date.now());
  await importPsychologyPeerHits(f.env.DB, Array.from({ length: 4 }, (_, n) => ({ videoUrl: 'https://www.tiktok.com/@example/photo/' + (400 + n), title: 'Library ' + n, videoData: { pageTexts: ['Cover ' + n, 'Page ' + n] } })), admin.id);
  const api = (method, path = '', body) => { const url = new URL('https://factory.test/api/psychology-autopilot' + path); return handlePsychologyAutopilot(new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, url, { user: admin }); };
  return { ...f, api };
}

test('autopilot starts on a group, schedules library batches for the coming slots as the owner, and is idempotent', async t => {
  const f = await pilotFixture(t);
  await assert.rejects(f.api('POST', '', { groupId: 'other', strategy: 'evolve' }), /没有这个心理学分组/);
  const url = new URL('https://factory.test/api/psychology-autopilot');
  await assert.rejects(handlePsychologyAutopilot(new Request(url), f.env, url, { user: { ...admin, sidebarModules: ['psychology-publish'] } }), /没有自动运营权限/);
  await assert.rejects(handlePsychologyAutopilot(new Request(url), f.env, url, { user: { ...admin, role: 'operator' } }), /没有自动运营权限/);
  const started = await (await f.api('POST', '', { groupId: 'g', strategy: 'original', days: 7 })).json();
  await assert.rejects(f.api('POST', '', { groupId: 'g', strategy: 'evolve' }), /已经在自动运营/);
  const pilot = f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(started.id);
  const expected = dueSlots(pilot, pilot.created_at).length;
  assert.ok(expected >= 2);
  assert.equal(started.run.batches.length, expected, JSON.stringify(started.run.errors));
  const batches = f.sqlite.prepare("SELECT created_by,config_json FROM psychology_publish_batches").all();
  assert.equal(batches.length, expected);
  const config = JSON.parse(batches[0].config_json);
  assert.equal(batches[0].created_by, 'admin');
  assert.deepEqual([config.sourceType, config.libraryStrategy, config.staggerSeconds, config.template, config.count], ['library', 'original', 45, 'photo-text', 2]);
  assert.equal(config.pairSeed, pilotPairSeed(pilot,config.scheduleAt*1000));
  assert.equal(config.libraryTestPolicy,'balanced-v1');
  const items = f.sqlite.prepare('SELECT i.connection_id,i.schedule_at,c.variant_id FROM psychology_publish_items i JOIN psychology_creative_snapshots c ON c.item_id=i.id ORDER BY i.schedule_at').all();
  assert.equal(items.length, expected * 2);
  assert.ok(items.every(i => i.variant_id === ''));
  assert.equal(items[1].schedule_at - items[0].schedule_at, 45);
  assert.equal(new Set(items.map(i => i.connection_id + ':' + i.schedule_at)).size, items.length);
  const again = await runAutopilot(f.env, pilot, pilot.created_at + 60000);
  assert.equal(again.batches.length, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n, expected);
  const list = await (await f.api('GET')).json();
  assert.equal(list.pilots[0].accounts.length, 2);
  assert.equal(list.pilots[0].schedule.filter(s => s.status === 'created').length, expected);
  assert.ok(list.pilots[0].logs.some(l => l.kind === 'daily'));
  assert.equal(list.groups.find(g => g.id === 'g').accounts, 2);
  assert.deepEqual(Object.keys(list.strategyRules).sort(),Object.keys(list.strategies).sort());
  assert.deepEqual(list.evolutionRules,EVOLUTION);
  assert.ok(Object.values(list.strategyRules).every(s=>s.summary&&s.rules.length>=4));
  assert.equal(f.requests.length, 0);
});

test('paused accounts are skipped, a paused pilot creates nothing, and ended pilots cannot change', async t => {
  const f = await pilotFixture(t);
  const { id } = await (await f.api('POST', '', { groupId: 'g', strategy: 'evolve', days: 3 })).json();
  assert.equal((await f.api('PATCH', `/${id}/accounts/b`, { status: 'paused' })).status, 200);
  const pilot = f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
  const later = await runAutopilot(f.env, pilot, pilot.created_at + DAY);
  const newest = f.sqlite.prepare('SELECT connection_id FROM psychology_publish_items WHERE batch_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(later.batches));
  assert.ok(later.batches.length > 0);
  assert.deepEqual([...new Set(newest.map(r => r.connection_id))], ['a']);
  assert.equal((await f.api('PATCH', `/${id}`, { status: 'paused' })).status, 200);
  await assert.rejects(f.api('POST', `/${id}/run`), /请先恢复/);
  assert.equal((await f.api('PATCH', `/${id}`, { status: 'ended' })).status, 200);
  await assert.rejects(f.api('PATCH', `/${id}`, { status: 'active' }), /不能再修改/);
  // The group is free again; with only four library posts, account a has used them all, so the shortage is logged.
  const restarted = await (await f.api('POST', '', { groupId: 'g', strategy: 'rewrite', days: 7 })).json();
  assert.match(restarted.id, /^pilot-/);
  assert.ok(restarted.run.errors.some(e => /不足/.test(e)));
  assert.ok(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_autopilot_log WHERE autopilot_id=? AND kind='error'").get(restarted.id).n > 0);
});

import { stopPending, stopImpact, slotExecution, executionCounts, nextAutopilotCheck } from './psychology-autopilot-execution.js';
import { mergeAndStorePublishRecords } from './publish-records-store.js';
import { dispatchPublishGroup, stagePublishItem } from './psychology-publish-groups.js';

test('execution reports durable receipts, cleaned failures, retries and Beijing day without querying TikTok', async t => {
  const f = await pilotFixture(t);
  const {id} = await (await f.api('POST', '', {groupId:'g', strategy:'original', days:7})).json();
  const slots = f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? ORDER BY slot_at').all(id);
  const items = f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY schedule_at,id').all();
  await mergeAndStorePublishRecords(f.db, [{id:'receipt',autoTaskId:items[0].id,autoBatchId:items[0].batch_id,batchId:'remote',status:'published',videoId:'1234567890123',createdAt:Date.now(),updatedAt:Date.now()}]);
  f.sqlite.prepare("UPDATE factory_jobs SET status='failed',error='render unavailable' WHERE id=?").run(items[1].job_id);
  f.sqlite.prepare('DELETE FROM factory_jobs WHERE id=?').run(items[1].job_id);
  f.sqlite.prepare("UPDATE factory_jobs SET status='queued',auto_retry_count=1,available_at=? WHERE id=?").run(Date.now()+30000,items[2].job_id);
  const result = await slotExecution(f.db, slots);
  assert.equal(result.find(i=>i.id===items[0].id).state,'published');
  assert.equal(result.find(i=>i.id===items[0].id).videoId,'1234567890123');
  assert.equal(result.find(i=>i.id===items[1].id).state,'production_failed');
  assert.equal(result.find(i=>i.id===items[1].id).error,'render unavailable');
  assert.equal(result.find(i=>i.id===items[2].id).retrying,true);
  const counts = executionCounts(result);
  assert.equal(counts.published,1); assert.equal(counts.failed,1);
  assert.equal(Object.values(counts).slice(1).reduce((a,b)=>a+b,0),counts.planned);
  const list = await (await f.api('GET')).json();
  const pilot = list.pilots[0];
  const today = new Date(Date.now()+8*HOUR).toISOString().slice(0,10),start=at(today,'00:00');
  assert.equal(pilot.today.planned,items.filter(i=>i.schedule_at*1000>=start&&i.schedule_at*1000<start+DAY).length);
  assert.ok(pilot.lastRunAt>0);
  const detail = await (await f.api('GET',`/${id}/slots/${slots[0].slot_at}`)).json();
  assert.equal(detail.items.length,2); assert.equal(detail.items[0].version,'原版');
  assert.equal(f.requests.length,0);
  await assert.rejects(f.api('GET',`/pilot-${crypto.randomUUID()}/slots/${slots[0].slot_at}`),/不存在/);
});

test('pause planning leaves existing work; stop pending protects frozen/inflight/submitted requests and is idempotent',async t=>{
  const f=await pilotFixture(t);
  const {id}=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
  const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY schedule_at,id').all();
  const groups=[...new Set(items.map(i=>i.publish_group_id))];
  await f.api('PATCH',`/${id}`,{status:'paused'});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items WHERE deleted_at>0').get().n,0);
  f.sqlite.prepare("UPDATE psychology_publish_groups SET status='submitting' WHERE id=?").run(groups[0]);
  // Second group is safe to stop even while generation is running.
  const local=items.find(i=>i.publish_group_id===groups[1]);
  f.sqlite.prepare("UPDATE factory_jobs SET status='running' WHERE id=?").run(local.job_id);
  const impact=await stopImpact(f.db,id);
  assert.equal(impact.protected,items.filter(i=>i.publish_group_id===groups[0]).length);
  const stopped=await (await f.api('PATCH',`/${id}`,{status:'paused',stopPending:true})).json();
  assert.equal(stopped.stopped,impact.stoppable);
  assert.equal(f.sqlite.prepare('SELECT status FROM factory_jobs WHERE id=?').get(local.job_id).status,'running');
  assert.ok(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items WHERE id=?').get(local.id).deleted_at>0);
  assert.ok(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items WHERE publish_group_id=?').all(groups[0]).every(i=>i.deleted_at===0));
  assert.equal(await stopPending(f.db,id),0);
  // A late render callback cannot send stopped content.
  await stagePublishItem(f.env,local,{item:{fileName:'stopped.png'},title:'Stopped'});
  assert.equal(f.requests.length,0);
  await f.api('PATCH',`/${id}`,{status:'active'});
  assert.ok(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items WHERE id=?').get(local.id).deleted_at>0);
});

test('account stop is scoped and does not alter frozen failed requests or durable submitted items',async t=>{
  const f=await pilotFixture(t);
  const {id}=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
  const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY schedule_at,id').all();
  const frozen=items[0];
  f.sqlite.prepare("UPDATE psychology_publish_groups SET status='failed',request_json=? WHERE id=?").run('{"items":[]}',frozen.publish_group_id);
  const receipt=items.find(i=>i.connection_id==='a'&&i.publish_group_id!==frozen.publish_group_id);
  await mergeAndStorePublishRecords(f.db,[{id:'r2',autoTaskId:receipt.id,autoBatchId:receipt.batch_id,batchId:'accepted',status:'submitted',createdAt:Date.now()}]);
  await f.api('PATCH',`/${id}/accounts/a`,{status:'paused'});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items WHERE connection_id=? AND deleted_at>0').get('b').n,0);
  assert.equal(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items WHERE id=?').get(frozen.id).deleted_at,0);
  assert.equal(f.sqlite.prepare('SELECT deleted_at FROM psychology_publish_items WHERE id=?').get(receipt.id).deleted_at,0);
  assert.equal(f.requests.length,0);
});

test('multi-batch slot membership and daily schedule boundaries are exact',async t=>{
  const f=await pilotFixture(t);
  const {id}=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
  const slots=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots ORDER BY slot_at').all();
  f.sqlite.prepare('UPDATE psychology_autopilot_slots SET batch_id=? WHERE autopilot_id=? AND slot_at=?').run(slots[0].batch_id+','+slots[1].batch_id,id,slots[0].slot_at);
  f.sqlite.prepare('DELETE FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').run(id,slots[1].slot_at);
  const impact=await stopImpact(f.db,id);
  const total=f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n;
  assert.equal(impact.stoppable,total);
  assert.equal(await stopPending(f.db,id),total);
  assert.equal(nextAutopilotCheck(at('2026-09-24','00:00')),at('2026-09-24','08:00'));
  assert.equal(nextAutopilotCheck(at('2026-09-24','08:00')),at('2026-09-25','00:00'));
});

import { kvSet } from './kv.js';
test('ten groups use all 200 authorized members even when analytics only knows first four; polling stays local', async t => {
  const f=await pilotFixture(t), originalFetch=globalThis.fetch;
  const accounts=Array.from({length:200},(_,n)=>({id:'member-'+n,username:'user'+n,scopes:['video.publish']}));
  const groups=Array.from({length:10},(_,n)=>({id:'g'+n,name:'Group '+n,projectId:'psych'}));
  const assignments=Object.fromEntries(accounts.map((a,n)=>[a.id,'g'+Math.floor(n/20)]));
  await kvSet(f.db,'official-account-groups',{projects:[{id:'psych',name:'心理学',moduleKey:'psychology'}],groups,assignments});
  for(const a of accounts.slice(0,80))f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES(?,?,?,?)').run('tiktok:'+a.id,a.username,JSON.stringify({username:a.username}),Date.now());
  let reads=0,unavailable=false;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url).includes('/api/v1/accounts')){
      reads++;if(unavailable)throw Error('directory offline');
      const second=new URL(String(url)).searchParams.has('cursor');
      return Response.json({accounts:second?accounts.slice(100):accounts.slice(0,100),hasMore:!second,nextCursor:second?'':'next'});
    }
    return originalFetch(url,init);
  });
  const initial=await (await f.api('GET','?refreshGroups=1')).json();
  assert.equal(initial.groups.length,10);assert.ok(initial.groups.every(g=>g.accounts===20));assert.equal(reads,2);
  await f.api('GET');await f.api('GET');assert.equal(reads,2);
  // Membership edits affect cached directory counts immediately, without analytics or network.
  await f.db.prepare('UPDATE official_account_assignments SET group_id=? WHERE account_key=?').bind('g8','member-199').run();
  const moved=await (await f.api('GET')).json();assert.equal(moved.groups.find(g=>g.id==='g9').accounts,19);assert.equal(moved.groups.find(g=>g.id==='g8').accounts,21);
  // No cache erasure on failed explicit refresh.
  unavailable=true;await assert.rejects(f.api('GET','?refreshGroups=1'),/offline/);
  const retained=await (await f.api('GET')).json();assert.equal(retained.groups.find(g=>g.id==='g9').accounts,19);unavailable=false;
  await importPsychologyPeerHits(f.db,Array.from({length:25},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/photo/'+(900+n),title:'New '+n,videoData:{pageTexts:['Cover '+n,'Body']}})),admin.id);
  const created=await (await f.api('POST','',{groupId:'g9',strategy:'original',days:3})).json();
  assert.ok(created.run.batches.length>0,JSON.stringify(created.run.errors));
  const selected=f.sqlite.prepare('SELECT DISTINCT connection_id FROM psychology_autopilot_accounts WHERE autopilot_id=?').all(created.id);
  assert.equal(selected.length,19);assert.ok(selected.every(a=>Number(a.connection_id.replace('member-',''))>=180));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM official_accounts_latest WHERE account_key='tiktok:member-180'").get().n,0);
});

test('autopilot directory excludes read-only, outside-project, duplicates and revoked accounts after explicit refresh', async t=>{
 const f=await pilotFixture(t);
 let accounts=[{id:'a',username:'a',scopes:['video.publish']},{id:'a',scopes:['video.publish']},{id:'b',scopes:['user.info.basic']},{id:'outside',scopes:['video.publish']}];
 t.mock.method(globalThis,'fetch',async()=>Response.json({accounts}));
 const first=await (await f.api('GET','?refreshGroups=1')).json();assert.equal(first.groups.find(g=>g.id==='g').accounts,1);assert.ok(!first.groups.some(g=>g.id==='other'));
 accounts=[];const refreshed=await (await f.api('GET','?refreshGroups=1')).json();assert.equal(refreshed.groups.find(g=>g.id==='g').accounts,0);
 await assert.rejects(f.api('POST','',{groupId:'g',strategy:'original',days:7}),/发布权限/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_autopilots').get().n,0);
});

test('custom daily times validate and select old/new schedule at a Beijing day boundary',()=>{
 assert.deepEqual(normalizePilotSlots([{hour:20,minute:30},{hour:9,minute:15}]),[{hour:9,minute:15},{hour:20,minute:30}]);
 for(const invalid of [[],Array(11).fill({hour:8,minute:0}),[{hour:24,minute:0}],[{hour:8,minute:60}],[{hour:'8',minute:0}],[{hour:8,minute:0},{hour:8,minute:0}]])assert.throws(()=>normalizePilotSlots(invalid));
 const pilot={created_at:at('2026-09-23','00:00'),ends_at:at('2026-09-30','00:00'),slots_json:JSON.stringify([{hour:9,minute:0},{hour:20,minute:0}]),pending_slots_json:JSON.stringify([{hour:10,minute:15}]),slots_effective_at:at('2026-09-25','00:00')};
 assert.deepEqual(dueSlots(pilot,at('2026-09-24','08:00')),[at('2026-09-24','20:00')]);
 assert.deepEqual(dueSlots(pilot,at('2026-09-24','09:00')),[at('2026-09-24','20:00'),at('2026-09-25','10:15')]);
 assert.equal(pilotSlotsAt(pilot,at('2026-09-24','23:59')).length,2);assert.equal(pilotSlotsAt(pilot,pilot.slots_effective_at).length,1);
});
test('one daily slot persists, allocates once per account and defers generation until two hours before each post',async t=>{
 const f=await pilotFixture(t), slot={hour:10,minute:15};
 const {id}=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7,slots:[slot]})).json();
 const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);assert.deepEqual(JSON.parse(pilot.slots_json),[slot]);
 const jobs=f.sqlite.prepare('SELECT j.payload_json,j.available_at,i.schedule_at FROM factory_jobs j JOIN psychology_publish_items i ON i.job_id=j.id').all();
 assert.equal(jobs.length,2);
 for(const job of jobs){assert.equal(job.available_at,job.schedule_at*1000-AUTOPILOT.leadMs);assert.equal(JSON.parse(job.payload_json).psychologyAutomation.generateAt,job.available_at);}
 assert.equal(jobs[1].available_at-jobs[0].available_at,45000);assert.equal(f.requests.length,0);
 const list=await (await f.api('GET')).json();assert.deepEqual(list.pilots[0].slots,[slot]);
});
test('schedule edits preserve created jobs, start after reserved days, are scoped and reject expired/malformed changes',async t=>{
 const f=await pilotFixture(t);const {id}=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
 const before=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all();
 const latest=f.sqlite.prepare('SELECT MAX(slot_at) t FROM psychology_autopilot_slots').get().t;
 const updated=await (await f.api('PATCH',`/${id}/schedule`,{slots:[{hour:11,minute:25}]})).json();
 assert.ok(updated.effectiveAt>latest);assert.equal(new Date(updated.effectiveAt+8*HOUR).getUTCHours(),0);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all(),before);
 const list=await (await f.api('GET')).json();assert.equal(list.pilots[0].slots.length,3);assert.deepEqual(list.pilots[0].pendingSlots,[{hour:11,minute:25}]);
 const row=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
 assert.deepEqual(pilotSlotsAt(row,updated.effectiveAt),[{hour:11,minute:25}]);
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{}),/发布时间/);
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:[{hour:99,minute:0}]}),/北京时间/);
 await assert.rejects(f.api('PATCH','/pilot-00000000-0000-4000-8000-000000000000/schedule',{slots:[{hour:11,minute:25}]}),/不存在/);
 f.sqlite.prepare('UPDATE psychology_autopilots SET ends_at=? WHERE id=?').run(updated.effectiveAt,id);
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:[{hour:11,minute:25}]}),/完整日期/);
 await f.api('PATCH',`/${id}`,{status:'ended'});await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:[{hour:11,minute:25}]}),/已结束/);
 assert.equal(f.requests.length,0);
});

test('a pending schedule already reserved for its effective date cannot be overwritten into old times',async t=>{
 const f=await pilotFixture(t);const {id}=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
 const update=await (await f.api('PATCH',`/${id}/schedule`,{slots:[{hour:11,minute:25}]})).json();
 f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)").run(id,update.effectiveAt+11*HOUR,Date.now());
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:[{hour:14,minute:0}]}),/待生效设置已开始创建排期/);
 const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);assert.deepEqual(pilotSlotsAt(pilot,update.effectiveAt),[{hour:11,minute:25}]);
});


test('staggered midnight groups pair by Beijing date and daily round', () => {
  const pilot=slots=>({owner:'admin',slots_json:JSON.stringify(slots),pending_slots_json:'[]',slots_effective_at:0});
  const first=pilot([{hour:0,minute:15},{hour:0,minute:45}]);
  const ninth=pilot([{hour:2,minute:15},{hour:2,minute:45}]);
  assert.equal(pilotPairSeed(first,at('2026-09-26','00:15')),pilotPairSeed(ninth,at('2026-09-26','02:15')));
  assert.equal(pilotPairSeed(first,at('2026-09-26','00:45')),pilotPairSeed(ninth,at('2026-09-26','02:45')));
  assert.notEqual(pilotPairSeed(first,at('2026-09-26','00:15')),pilotPairSeed(first,at('2026-09-26','00:45')));
  assert.notEqual(pilotPairSeed(first,at('2026-09-26','00:15')),pilotPairSeed(first,at('2026-09-27','00:15')));
});


test('explicit immediate start includes first-day slots above ten minutes, while later days retain two hours',()=>{
  const pilot={start_now:1,created_at:at('2026-09-25','01:20'),ends_at:at('2026-10-02','01:20'),slots_json:JSON.stringify([{hour:1,minute:25},{hour:1,minute:30},{hour:1,minute:45},{hour:2,minute:15}])};
  const immediate=dueSlots(pilot,pilot.created_at);
  assert.ok(immediate.includes(at('2026-09-25','01:45')));assert.ok(immediate.includes(at('2026-09-25','02:15')));
  assert.ok(!immediate.includes(at('2026-09-25','01:25')));assert.ok(!immediate.includes(at('2026-09-25','01:30')));
  assert.ok(!dueSlots({...pilot,start_now:0},pilot.created_at).includes(at('2026-09-25','01:45')));
  assert.ok(!dueSlots(pilot,at('2026-09-26','01:20')).includes(at('2026-09-26','01:45')));
});

test('short-notice creation persists its choice, generates now and reserves the requested first round exactly once',async t=>{
  const f=await pilotFixture(t),now=at('2026-09-25','01:20');t.mock.method(Date,'now',()=>now);
  const slots=[{hour:1,minute:45},{hour:2,minute:15}];
  await assert.rejects(f.api('POST','',{groupId:'g',strategy:'original',days:7,slots,startNow:'true'}),/立即准备/);
  const created=await (await f.api('POST','',{groupId:'g',strategy:'original',days:7,slots,startNow:true})).json();
  assert.deepEqual(created.run.errors,[]);
  const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(created.id);assert.equal(pilot.start_now,1);
  const first=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').get(pilot.id,at('2026-09-25','01:45'));assert.equal(first.status,'created');
  const jobs=f.sqlite.prepare('SELECT payload_json,available_at FROM factory_jobs WHERE id IN (SELECT job_id FROM psychology_publish_items WHERE batch_id=?)').all(first.batch_id);
  assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.available_at===now&&JSON.parse(j.payload_json).psychologyAutomation.generateAt===now));
  const later=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').get(pilot.id,at('2026-09-26','01:45'));assert.equal(later.status,'created');
  const before=f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n;
  await runAutopilot(f.env,pilot,now+60000);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,before);
});

test('batched overview preserves owner, overlapping slot and per-pilot history boundaries',async t=>{
 const f=await pilotFixture(t),now=Date.now(),slot=Math.floor(now/1000)*1000;
 for(let n=0;n<3;n++){
  const id='pilot-'+crypto.randomUUID(),owner=n===2?'other-owner':'admin';
  f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,'[]','paused',?,?,?)").run(id,owner,'group-'+n,'group-'+n,'original',now+DAY,now,now);
  // Valid configured times, same execution slot in all three pilots.
  f.sqlite.prepare('UPDATE psychology_autopilots SET slots_json=? WHERE id=?').run(JSON.stringify([{hour:8,minute:0}]),id);
  f.sqlite.prepare('INSERT INTO psychology_publish_batches VALUES(?,?,?,?)').run('batch-'+n,owner,'{}',now);
  for(let j=0;j<13;j++)f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,updated_at) VALUES(?,?,'created',?,?)").run(id,slot-j*DAY,j===0?'batch-'+n:'',now);
  for(let j=0;j<65;j++)f.sqlite.prepare("INSERT INTO psychology_autopilot_log(autopilot_id,kind,message,created_at) VALUES(?,'status',?,?)").run(id,'group-'+n+' log '+j,now+j);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_log(autopilot_id,kind,message,detail_json,created_at) VALUES(?,'daily',?,'{}',?)").run(id,'daily-'+n,now-1);
  for(let j=0;j<=n;j++){
   const item='item-'+n+'-'+j;
   f.sqlite.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES(?,?,?,?,?,?)').run(item,'batch-'+n,'source',item,'a',slot/1000);
   await mergeAndStorePublishRecords(f.db,[{id:'record-'+item,autoTaskId:item,autoBatchId:'batch-'+n,batchId:'remote',status:n===0?'published':'failed',createdAt:now,updatedAt:now}]);
  }
 }
 await f.api('GET'); // Warm the independent directory snapshot before counting list queries.
 let rounds=0;const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{rounds++;return batch(statements);};
 const result=await (await f.api('GET')).json();
 assert.equal(rounds,2);assert.equal(result.pilots.length,2);
 for(const p of result.pilots){assert.equal(p.schedule.length,1);assert.equal(p.logs.length,60);assert.equal(p.latest.message,'daily-'+p.groupName.slice(-1));assert.ok(p.logs.every(l=>l.message.startsWith(p.groupName)));}
 const a=result.pilots.find(p=>p.groupName==='group-0'),b=result.pilots.find(p=>p.groupName==='group-1');
 assert.equal(a.today.planned,1);assert.equal(a.today.published,1);assert.equal(a.today.failed,0);
 assert.equal(b.today.planned,2);assert.equal(b.today.failed,2);assert.equal(b.today.published,0);
 assert.equal(f.requests.length,0);
});


test('autopilot period follows Beijing boundaries including seven complete calendar dates',()=>{
 const now=at('2026-09-26','00:05');
 assert.equal(autopilotViewWindow(undefined,now).start,at('2026-09-26','00:00'));
 assert.equal(autopilotViewWindow('yesterday',now).end,at('2026-09-26','00:00'));
 assert.equal(autopilotViewWindow('7d',now).start,at('2026-09-20','00:00'));
 assert.throws(()=>autopilotViewWindow('all',now),/请选择/);
});

test('period selection includes all seven days beyond twelve slots and excludes outside slots and logs',async t=>{
 const f=await pilotFixture(t),now=Date.now(),day=autopilotViewWindow('today',now).start,id='period-pilot';
 f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES(?,'admin','g','Period','original','[{\"hour\":0,\"minute\":0},{\"hour\":1,\"minute\":0}]','paused',?,?,?)").run(id,now+DAY,now-8*DAY,now);
 for(let d=-7;d<=1;d++)for(let h=0;h<2;h++){
  const slot=day+d*DAY+h*HOUR,batch='period-b'+d+'-'+h;
  f.sqlite.prepare('INSERT INTO psychology_publish_batches VALUES(?,?,?,?)').run(batch,'admin','{}',slot);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,updated_at) VALUES(?,?,'created',?,?)").run(id,slot,batch,slot);
  f.sqlite.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES(?,?,?,?,?,?)').run(batch,batch,'source','missing','a',slot/1000);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_log(autopilot_id,kind,message,created_at) VALUES(?,'status',?,?)").run(id,batch,slot);
 }
 for(const [period,n] of [['today',2],['yesterday',2],['7d',14]]){
  const result=await(await f.api('GET','?period='+period)).json(),p=result.pilots[0];
  assert.equal(p.schedule.length,n);assert.equal(p.execution.planned,n);assert.equal(p.logs.length,n);
  assert.ok(p.schedule.every(s=>s.slotAt>=result.window.start&&s.slotAt<result.window.end));
  assert.ok(p.attention.every(i=>i.scheduleAt>=result.window.start&&i.scheduleAt<result.window.end));
 }
 assert.equal(f.requests.length,0);
});
