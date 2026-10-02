import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { handlePsychologyAutopilot, runAutopilot, dueSlots, guardAccounts, AUTOPILOT, normalizePilotSlots, pilotSlotsAt, pilotPairSeed, autopilotViewWindow, pilotStrategyAt, pilotPoolContext, readOwnerProductionForecast, readAutopilotProductionContext, refreshProductionCapacitySnapshots, recoverAutopilotSlot, recoveryOriginalSlot } from './psychology-autopilot.js';
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

test('guard pauses three failed publishes in a row and keeps low-play accounts running', () => {
  const outcomesByConnection = new Map([['low', ['published']], ['failing', ['failed', 'failed', 'failed']], ['recovered', ['failed', 'failed', 'published']]]);
  const ids = ['low', 'failing', 'recovered'];
  assert.deepEqual(guardAccounts({ connectionIds: ids, outcomesByConnection }).map(p => [p.id, p.reason]),
    [['failing', '连续3次发布失败']]);
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
  const slot = f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? ORDER BY slot_at DESC').get(pilot.id);
  const dropped = f.sqlite.prepare("SELECT id,job_id FROM psychology_publish_items WHERE connection_id='b' AND batch_id=?").get(slot.batch_id);
  f.sqlite.prepare('DELETE FROM psychology_peer_account_usage WHERE item_id=?').run(dropped.id);
  f.sqlite.prepare('DELETE FROM psychology_publish_items WHERE id=?').run(dropped.id);
  f.sqlite.prepare('DELETE FROM factory_jobs WHERE id=?').run(dropped.job_id);
  const restored = await runAutopilot(f.env, pilot, pilot.created_at + 120000);
  assert.equal(restored.batches.length, 1, JSON.stringify(restored.errors));
  const linked = f.sqlite.prepare('SELECT batch_id FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').get(pilot.id, slot.slot_at).batch_id.split(',');
  assert.equal(linked.length, 2);
  const back = f.sqlite.prepare("SELECT schedule_at FROM psychology_publish_items WHERE deleted_at=0 AND connection_id='b' AND batch_id=?").get(linked[1]);
  const kept = f.sqlite.prepare("SELECT MAX(schedule_at) AS last FROM psychology_publish_items WHERE deleted_at=0 AND batch_id=?").get(linked[0]);
  assert.equal(back.schedule_at, kept.last + 45);
  const duplicate = await runAutopilot(f.env, pilot, pilot.created_at + 180000);
  assert.equal(duplicate.batches.length, 0);
  const cancelled = f.sqlite.prepare("SELECT id FROM psychology_publish_items WHERE connection_id='b' AND batch_id=?").get(linked[1]);
  f.sqlite.prepare('UPDATE psychology_publish_items SET deleted_at=? WHERE id=?').run(Date.now(), cancelled.id);
  f.sqlite.prepare('DELETE FROM psychology_peer_account_usage WHERE item_id=?').run(cancelled.id);
  const replaced = await runAutopilot(f.env, pilot, pilot.created_at + 240000);
  assert.equal(replaced.batches.length, 1, JSON.stringify(replaced.errors));
  const list = await (await f.api('GET')).json();
  assert.equal(list.pilots[0].accounts.length, 2);
  // GET defaults to today; dueSlots can also reserve tomorrow near midnight.
  const todayStart=autopilotViewWindow('today').start;
  const expectedToday=f.sqlite.prepare("SELECT count(*) n FROM psychology_autopilot_slots WHERE autopilot_id=? AND status='created' AND slot_at>=? AND slot_at<?").get(pilot.id,todayStart,todayStart+86400000).n;
  assert.equal(list.pilots[0].schedule.filter(s => s.status === 'created').length, expectedToday);
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

import { stopPending, stopImpact, slotExecution, executionCounts, nextAutopilotCheck, autopilotCheckWindow, AUTOPILOT_CHECK_SLOTS } from './psychology-autopilot-execution.js';
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
  assert.equal(nextAutopilotCheck(at('2026-09-24','00:00')),at('2026-09-24','08:00')); // Pacific prior-date 17:00
  assert.equal(nextAutopilotCheck(at('2026-09-24','08:00')),at('2026-09-24','20:00')); // next Pacific 05:00
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
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:[{hour:99,minute:0}]}),/目标时区/);
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

test('autopilot performance follows actual publication period, includes same-day zero views and isolates pilot ownership',async t=>{
 const f=await pilotFixture(t),day=autopilotViewWindow().start;
 for(const [id,owner] of [['visible','admin'],['hidden','other']]) f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES(?,?,?,'G','original','[{\"hour\":8,\"minute\":0}]','paused',?,?,?)").run(id,owner,id,day+DAY,day,day);
 const add=(id,pilot,time,views,state='published')=>f.sqlite.prepare('INSERT INTO ops_task_facts(id,batch_id,account_key,media,schedule_at,published_at,pilot_id,views,state) VALUES(?,?,?,\'photo\',?,?,?,?,?)').run(id,'b','tiktok:a',day,time,pilot,views,state);
 add('y1','visible',day-1,400);add('y2','visible',day-1,1600);add('foreign','hidden',day+1,99999);
 let result=await(await f.api('GET')).json();assert.deepEqual(result.pilots[0].performance,{n:0,medianViews:null,potentialRate:null});
 const yesterday=await(await f.api('GET','?period=yesterday')).json();assert.equal(yesterday.pilots[0].performance.n,2);assert.equal(yesterday.pilots[0].performance.medianViews,1000);assert.equal(yesterday.pilots[0].performance.potentialRate,0.5);
 add('t0','visible',day+1,0);add('t1','visible',day+2,1000);add('missing','visible',day+3,null);add('not-published','visible',day+4,9000,'pending');
 result=await(await f.api('GET')).json();assert.equal(result.pilots[0].performance.n,2);assert.equal(result.pilots[0].performance.medianViews,500);assert.equal(result.pilots[0].performance.potentialRate,0.5);
 const week=await(await f.api('GET','?period=7d')).json();assert.equal(week.pilots[0].performance.n,4);assert.equal(week.pilots[0].performance.medianViews,700);
 assert.equal(f.requests.length,0);
});


test('pool strategy resolves by slot time and calendar days with zero-based rounds', () => {
  const start=at('2026-10-02','00:00');
  const pilot={strategy:'original',current_strategy:'original',pending_strategy:'pools',strategy_effective_at:start,strategy_started_at:at('2026-09-25','01:25'),created_at:at('2026-09-25','01:25'),slots_json:JSON.stringify([{hour:1,minute:45},{hour:2,minute:15}]),slots_effective_at:0};
  assert.equal(pilotStrategyAt(pilot,start-1),'original');
  assert.equal(pilotStrategyAt(pilot,start),'pools');
  assert.deepEqual(pilotPoolContext(pilot,at('2026-10-02','01:45')),{cycleStartAt:start,postsPerDay:2,round:0,dayIndex:0,timeZone:'Asia/Shanghai'});
  assert.deepEqual(pilotPoolContext(pilot,at('2026-10-04','02:15')),{cycleStartAt:start,postsPerDay:2,round:1,dayIndex:2,timeZone:'Asia/Shanghai'});
  assert.throws(()=>pilotPoolContext(pilot,at('2026-10-02','03:15')),/发布时段/);
});

test('future pool strategy starts after reserved Beijing dates without changing jobs or account states', async t => {
  const f=await pilotFixture(t),now=at('2026-09-30','12:00');t.mock.method(Date,'now',()=>now);
  const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:7,slots:[{hour:1,minute:45},{hour:2,minute:15}]})).json();
  const original=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
  const jobs=f.sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all();
  const items=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all();
  const slots=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots ORDER BY slot_at').all();
  const accounts=f.sqlite.prepare('SELECT * FROM psychology_autopilot_accounts ORDER BY connection_id').all();
  const response=await(await f.api('PATCH','/'+id+'/strategy',{strategy:'pools',days:7,revision:original.updated_at})).json();
  assert.equal(response.effectiveAt,at('2026-10-02','00:00'));
  assert.equal(response.endsAt,at('2026-10-09','00:00'));
  assert.equal(response.pendingStrategy,'pools');
  assert.equal(response.strategy,'original');
  assert.ok(response.revision>original.updated_at);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all(),jobs);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all(),items);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots ORDER BY slot_at').all(),slots);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_autopilot_accounts ORDER BY connection_id').all(),accounts);
  const listed=(await(await f.api('GET')).json()).pilots[0];
  assert.equal(listed.pendingStrategy,'pools');assert.equal(listed.strategyEffectiveAt,response.effectiveAt);
  assert.equal(listed.strategy,'original');assert.equal(listed.endsAt,response.endsAt);
  const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
  assert.equal(pilotStrategyAt(pilot,response.effectiveAt),'pools');
  assert.equal(pilotPoolContext(pilot,response.effectiveAt+HOUR+45*60000).dayIndex,0);
  assert.equal(f.requests.length,0);
});

test('pool strategy continuation validates revision, scope, origin, duration and pending reservations', async t => {
  const f=await pilotFixture(t),now=at('2026-09-30','12:00');t.mock.method(Date,'now',()=>now);
  const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
  const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id),path='/'+id+'/strategy';
  await assert.rejects(f.api('PATCH',path,{strategy:'pools',days:7}),/revision/);
  await assert.rejects(f.api('PATCH',path,{strategy:'pools',days:0,revision:pilot.updated_at}),/运行天数/);
  await assert.rejects(f.api('PATCH',path,{strategy:'rewrite',revision:pilot.updated_at}),/接续策略/);
  const url=new URL('https://factory.test/api/psychology-autopilot'+path);
  const body={strategy:'pools',days:7,revision:pilot.updated_at};
  await assert.rejects(handlePsychologyAutopilot(new Request(url,{method:'PATCH',headers:{origin:'https://other.test'},body:JSON.stringify(body)}),f.env,url,{user:admin}),/跨站/);
  await assert.rejects(handlePsychologyAutopilot(new Request(url,{method:'PATCH',body:JSON.stringify(body)}),f.env,url,{user:{...admin,role:'operator'}}),/权限/);
  const response=await(await f.api('PATCH',path,body)).json();
  await assert.rejects(f.api('PATCH',path,body),/revision/);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)").run(id,response.effectiveAt+8*HOUR,now);
  await assert.rejects(f.api('PATCH',path,{...body,revision:response.revision}),/待生效策略已开始创建排期/);
  await f.api('PATCH','/'+id,{status:'ended'});
  await assert.rejects(f.api('PATCH',path,{...body,revision:response.revision}),/已结束/);
  assert.equal(f.requests.length,0);
});

test('new pool strategy pilots use two default slots and retain external paused creation', async t => {
  const f=await pilotFixture(t),now=at('2026-09-30','12:00');t.mock.method(Date,'now',()=>now);
  const url=new URL('https://factory.test/api/psychology-autopilot');
  const request=new Request(url,{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),groupId:'g',strategy:'pools',days:7})});
  const created=await(await handlePsychologyAutopilot(request,f.env,url,{user:admin},{external:true})).json();
  const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(created.id);
  assert.equal(pilot.status,'paused');assert.equal(pilot.current_strategy,'pools');
  assert.equal(pilot.strategy,'evolve');assert.equal(pilotStrategyAt(pilot,now),'pools');
  assert.equal(JSON.parse(pilot.slots_json).length,2);assert.equal(pilot.strategy_started_at,now);
  const listed=(await(await f.api('GET')).json()).pilots[0];
  assert.equal(listed.strategy,'pools');assert.equal(listed.pendingStrategy,null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);
  assert.equal(f.requests.length,0);
});

test('pool-to-pool continuation retains the current cycle until its future boundary', async t => {
  const f=await pilotFixture(t),now=at('2026-10-03','12:00');t.mock.method(Date,'now',()=>now);
  const url=new URL('https://factory.test/api/psychology-autopilot');
  const made=await(await handlePsychologyAutopilot(new Request(url,{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),groupId:'g',strategy:'pools',days:7})}),f.env,url,{user:admin},{external:true})).json();
  const original=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(made.id);
  const next=await(await f.api('PATCH','/'+made.id+'/strategy',{strategy:'pools',days:7,revision:original.updated_at})).json();
  const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(made.id);
  assert.equal(pilotStrategyAt(pilot,next.effectiveAt-1),'pools');
  assert.equal(pilotPoolContext(pilot,at('2026-10-03','12:00')).cycleStartAt,original.created_at);
  assert.equal(pilotPoolContext(pilot,next.effectiveAt+8*HOUR).cycleStartAt,next.effectiveAt);
  assert.equal(f.requests.length,0);
});

test('reporting slot triggers prefer frozen batch strategy and otherwise resolve strategy at publication slot', async t => {
  const f=await pilotFixture(t),now=at('2026-09-30','12:00');t.mock.method(Date,'now',()=>now);
  const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
  const original=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
  const next=await(await f.api('PATCH','/'+id+'/strategy',{strategy:'pools',days:7,revision:original.updated_at})).json();
  for(const [batch,config] of [['frozen-original',{libraryStrategy:'original'}],['frozen-pools',{libraryStrategy:'pools'}],['inferred-pools',{}]])f.sqlite.prepare('INSERT INTO psychology_publish_batches VALUES(?,?,?,?)').run(batch,'admin',JSON.stringify(config),now);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,batch_id,updated_at) VALUES(?,?,'created',?,?)").run(id,next.effectiveAt+8*HOUR,'frozen-original,inferred-pools',now);
  assert.equal(f.sqlite.prepare('SELECT strategy FROM ops_pilot_batches WHERE batch_id=?').get('frozen-original').strategy,'original');
  assert.equal(f.sqlite.prepare('SELECT strategy FROM ops_pilot_batches WHERE batch_id=?').get('inferred-pools').strategy,'pools');
  f.sqlite.prepare('UPDATE psychology_autopilot_slots SET batch_id=? WHERE autopilot_id=? AND slot_at=?').run('frozen-original,inferred-pools,frozen-pools',id,next.effectiveAt+8*HOUR);
  assert.equal(f.sqlite.prepare('SELECT strategy FROM ops_pilot_batches WHERE batch_id=?').get('frozen-pools').strategy,'pools');
  assert.equal(f.requests.length,0);
});


const PACIFIC='America/Los_Angeles';
const pacificSlots=[{hour:8,minute:0},{hour:11,minute:30},{hour:20,minute:0}];
const utc=value=>Date.parse(value+'Z');
test('Pacific publication anchors follow audience dates in summer and winter',()=>{
 const pilot={schedule_timezone:PACIFIC,slots_json:JSON.stringify(pacificSlots),created_at:utc('2026-01-01T00:00:00'),ends_at:utc('2027-01-01T00:00:00')};
 assert.deepEqual(dueSlots(pilot,utc('2026-10-02T07:00:00')), [utc('2026-10-02T15:00:00'),utc('2026-10-02T18:30:00'),utc('2026-10-03T03:00:00')]);
 assert.deepEqual(dueSlots(pilot,utc('2026-11-02T08:00:00')), [utc('2026-11-02T16:00:00'),utc('2026-11-02T19:30:00'),utc('2026-11-03T04:00:00')]);
});

test('Pacific DST transition preserves local rounds and emits repeated autumn time only once',()=>{
 const pilot={schedule_timezone:PACIFIC,slots_json:JSON.stringify([{hour:1,minute:30},...pacificSlots]),created_at:utc('2026-01-01T00:00:00'),ends_at:utc('2027-01-01T00:00:00')};
 assert.deepEqual(dueSlots(pilot,utc('2026-11-01T03:00:00')), [utc('2026-11-01T08:30:00'),utc('2026-11-01T16:00:00'),utc('2026-11-01T19:30:00'),utc('2026-11-02T04:00:00')]);
 const spring={...pilot,slots_json:JSON.stringify([{hour:1,minute:30},{hour:2,minute:30},...pacificSlots])};
 assert.deepEqual(dueSlots(spring,utc('2026-03-08T07:00:00')), [utc('2026-03-08T09:30:00'),utc('2026-03-08T15:00:00'),utc('2026-03-08T18:30:00'),utc('2026-03-09T03:00:00'),utc('2026-03-09T08:30:00')]);
});

test('a future Pacific boundary preserves earlier Beijing slots on the same Beijing date',()=>{
 const boundary=utc('2026-10-02T07:00:00');
 const pilot={schedule_timezone:'Asia/Shanghai',pending_schedule_timezone:PACIFIC,slots_json:JSON.stringify([{hour:8,minute:0},{hour:14,minute:0},{hour:20,minute:0}]),pending_slots_json:JSON.stringify(pacificSlots),slots_effective_at:boundary,created_at:at('2026-09-30','00:00'),ends_at:utc('2026-10-09T07:00:00')};
 assert.deepEqual(dueSlots(pilot,at('2026-10-02','00:00')), [at('2026-10-02','08:00'),at('2026-10-02','14:00'),utc('2026-10-02T15:00:00')]);
 assert.equal(pilotPairSeed({...pilot,owner:'admin'},utc('2026-10-03T03:00:00')),'admin:2026-10-02:round-3');
});

test('pool day and round counts use Pacific calendar dates across the 25-hour day',()=>{
 const start=utc('2026-10-31T07:00:00');
 const pilot={owner:'admin',current_strategy:'pools',strategy_started_at:start,created_at:start,schedule_timezone:PACIFIC,slots_json:JSON.stringify(pacificSlots)};
 assert.deepEqual(pilotPoolContext(pilot,utc('2026-11-02T04:00:00')),{cycleStartAt:start,postsPerDay:3,round:2,dayIndex:1,timeZone:PACIFIC});
 assert.equal(pilotPoolContext(pilot,utc('2026-11-02T16:00:00')).dayIndex,2);
 assert.equal(pilotPairSeed(pilot,utc('2026-11-02T04:00:00')),'admin:2026-11-01:round-3');
});

test('schedule timezone changes preserve frozen jobs, default old callers to Beijing and return zone metadata',async t=>{
 const f=await pilotFixture(t);t.mock.method(Date,'now',()=>utc('2026-10-01T00:00:00'));
 const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:7})).json();
 const before=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all();
 const jobs=f.sqlite.prepare('SELECT id,payload_json,available_at FROM factory_jobs ORDER BY id').all();
 assert.equal(f.sqlite.prepare('SELECT schedule_timezone FROM psychology_autopilots WHERE id=?').get(id).schedule_timezone,'Asia/Shanghai');
 const latest=f.sqlite.prepare('SELECT MAX(slot_at) t FROM psychology_autopilot_slots WHERE autopilot_id=?').get(id).t;
 const changed=await(await f.api('PATCH',`/${id}/schedule`,{slots:pacificSlots,timeZone:PACIFIC})).json();
 assert.equal(changed.timeZone,PACIFIC);assert.ok(changed.effectiveAt>latest);
 assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:PACIFIC,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(changed.effectiveAt),'00:00');
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').all(),before);
 assert.deepEqual(f.sqlite.prepare('SELECT id,payload_json,available_at FROM factory_jobs ORDER BY id').all(),jobs);
 let listed=(await(await f.api('GET')).json()).pilots[0];
 assert.equal(listed.timeZone,'Asia/Shanghai');assert.equal(listed.pendingTimeZone,PACIFIC);assert.deepEqual(listed.pendingSlots,pacificSlots);
 // An older client editing the pending schedule must not reset its zone.
 const sameZone=await(await f.api('PATCH',`/${id}/schedule`,{slots:pacificSlots})).json();assert.equal(sameZone.timeZone,PACIFIC);
 t.mock.method(Date,'now',()=>changed.effectiveAt);
 listed=(await(await f.api('GET')).json()).pilots[0];assert.equal(listed.timeZone,PACIFIC);assert.equal(listed.pendingTimeZone,null);
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:pacificSlots,timeZone:'UTC'}),/时区/);
 assert.equal(f.requests.length,0);
});

test('explicit Pacific API creation uses local-day duration through DST and binds idempotency to zone',async t=>{
 const f=await pilotFixture(t),now=utc('2026-10-30T17:00:00');t.mock.method(Date,'now',()=>now);
 const url=new URL('https://factory.test/api/psychology-autopilot');
 const input={requestId:crypto.randomUUID(),groupId:'g',strategy:'pools',days:3,slots:pacificSlots,timeZone:PACIFIC};
 const create=body=>handlePsychologyAutopilot(new Request(url,{method:'POST',body:JSON.stringify(body)}),f.env,url,{user:admin},{external:true});
 const response=await(await create(input)).json(),pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(response.id);
 assert.equal(pilot.schedule_timezone,PACIFIC);assert.equal(pilot.ends_at,utc('2026-11-02T18:00:00'));assert.equal(pilot.ends_at-now,73*HOUR);
 assert.equal((await(await create(input)).json()).duplicate,true);
 await assert.rejects(create({...input,timeZone:'Asia/Shanghai'}),/不同运营设置/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);assert.equal(f.requests.length,0);
});


test('a project-linked schedule cannot diverge from the active policy timezone or three-round contract',async t=>{
 const f=await pilotFixture(t),now=utc('2026-10-01T07:00:00');t.mock.method(Date,'now',()=>now);
 const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:7,slots:pacificSlots,timeZone:PACIFIC})).json();
 f.sqlite.prepare("INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,starts_at,ends_at,next_review_at,created_at,updated_at,time_zone) VALUES('zone-policy','proj-psych','admin',1,?,?,?,?,?,?)").run(now,now+7*DAY,now+3*DAY,now,now,PACIFIC);
 f.sqlite.prepare("UPDATE psychology_autopilots SET task_group_policy_id='zone-policy' WHERE id=?").run(id);
 const before=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:pacificSlots,timeZone:'Asia/Shanghai'}),/项目时区及每天3条/);
 await assert.rejects(f.api('PATCH',`/${id}/schedule`,{slots:pacificSlots.slice(0,2),timeZone:PACIFIC}),/项目时区及每天3条/);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id),before);
 const changed=await(await f.api('PATCH',`/${id}/schedule`,{slots:[{hour:8,minute:10},{hour:11,minute:40},{hour:20,minute:10}],timeZone:PACIFIC})).json();
 assert.equal(changed.timeZone,PACIFIC);assert.equal(f.requests.length,0);
});


test('prestart project schedule edits cannot advance the unified Pacific cycle boundary',async t=>{
 const f=await pilotFixture(t),now=utc('2026-09-30T07:00:00'),start=utc('2026-10-02T07:00:00');t.mock.method(Date,'now',()=>now);
 const url=new URL('https://factory.test/api/psychology-autopilot');
 const {id}=await(await handlePsychologyAutopilot(new Request(url,{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),groupId:'g',strategy:'pools',days:9,slots:pacificSlots,timeZone:PACIFIC})}),f.env,url,{user:admin},{external:true})).json();
 f.sqlite.prepare("INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,starts_at,ends_at,next_review_at,created_at,updated_at,time_zone) VALUES('future-zone-policy','proj-psych','admin',1,?,?,?,?,?,?)").run(start,start+7*DAY,start+3*DAY,now,now,PACIFIC);
 f.sqlite.prepare("UPDATE psychology_autopilots SET task_group_policy_id='future-zone-policy' WHERE id=?").run(id);
 const editedSlots=[{hour:8,minute:10},{hour:11,minute:40},{hour:20,minute:10}];
 const changed=await(await f.api('PATCH',`/${id}/schedule`,{slots:editedSlots,timeZone:PACIFIC})).json();
 assert.equal(changed.effectiveAt,start);
 const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
 assert.deepEqual(pilotSlotsAt(pilot,start-1),pacificSlots);assert.deepEqual(pilotSlotsAt(pilot,start),editedSlots);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_items').get().n,0);assert.equal(f.requests.length,0);
});


function insertForecastPilot(f,{id='pilot-'+crypto.randomUUID(),owner='admin',groupId='g',now,slots=[{hour:8,minute:0}],status='active',timeZone='Asia/Shanghai'}){
 f.sqlite.prepare('INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,current_strategy,slots_json,schedule_timezone,status,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,groupId,groupId,'original','original',JSON.stringify(slots),timeZone,status,now+7*DAY,now,now);
 return f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
}

test('background capacity snapshots count every operating group and GET reads only its owner snapshot without load scans',async t=>{
 const f=await pilotFixture(t),now=at('2026-10-01','00:00');t.mock.method(Date,'now',()=>now);
 const groups=Array.from({length:23},(_,n)=>({id:'forecast-'+n,name:'Group '+n,projectId:'psych'}));
 groups.push({id:'second-owner',name:'Other owner',projectId:'psych'},{id:'outside',name:'Other project',projectId:'novel'});
 const accounts=[],assignments={};
 for(let g=0;g<23;g++)for(let n=0;n<(g===0?200:3);n++){const id=`f-${g}-${n}`;accounts.push({id,connectionId:id,scopes:['video.publish']});assignments[id]='forecast-'+g;}
 for(let n=0;n<20;n++){const id='other-'+n;accounts.push({id,connectionId:id,scopes:['video.publish']});assignments[id]='second-owner';}
 accounts.push({id:'read-only',connectionId:'read-only',scopes:['user.info.basic']},{id:'foreign',connectionId:'foreign',scopes:['video.publish']});assignments['read-only']='forecast-0';assignments.foreign='outside';
 await kvSet(f.db,'official-account-groups',{projects:[{id:'psych',name:'心理学',moduleKey:'psychology'},{id:'novel',name:'小说',moduleKey:'novel-promotion'}],groups,assignments});
 t.mock.method(globalThis,'fetch',async url=>{assert.ok(String(url).includes('/api/v1/accounts'));return Response.json({accounts});});
 for(let g=0;g<23;g++)insertForecastPilot(f,{groupId:'forecast-'+g,now,id:'pilot-forecast-'+g});
 insertForecastPilot(f,{groupId:'outside',now,id:'pilot-foreign'});
 f.sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES ('other-admin','other-admin','admin','','',?,0,0)").run(JSON.stringify(['psychology-publish','psychology-autopilot']));
 insertForecastPilot(f,{groupId:'second-owner',owner:'other-admin',now,id:'pilot-other-owner'});
 f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,updated_at) VALUES('pilot-forecast-0','f-0-0','paused',?)").run(now);
 const initial=await(await f.api('GET','?refreshGroups=1')).json();
 assert.equal(initial.pilots.length,20);assert.equal(initial.productionCapacity,null);
 assert.deepEqual(await refreshProductionCapacitySnapshots(f.env,now),{refreshed:2,asOf:now});
 const context=await readAutopilotProductionContext(f.env,null,null,now);
 assert.equal(context.owners.get('admin').accountCount,265);assert.equal(context.owners.get('other-admin').accountCount,20);
 assert.equal(context.load.forecasts.filter(v=>v.slotAt===at('2026-10-01','08:00')).reduce((sum,v)=>sum+v.accountCount,0),285);
 const snapshots=f.sqlite.prepare("SELECT key,value_json FROM factory_kv WHERE key LIKE 'psychology-production-capacity:%' ORDER BY key").all();
 assert.equal(snapshots.length,2);
 assert.equal(JSON.parse(snapshots.find(s=>s.key.endsWith(':other-admin')).value_json).accountCount,20);
 const writes=f.sqlite.prepare('SELECT total_changes() n').get().n;
 t.mock.method(globalThis,'fetch',async()=>{throw Error('GET must remain local');});
 const prepare=f.db.prepare.bind(f.db),capacityReads=[];
 t.mock.method(f.db,'prepare',sql=>{
  assert.doesNotMatch(sql,/SELECT DISTINCT owner FROM psychology_autopilots|SELECT DISTINCT j.id,j.created_by owner|SELECT json_extract\(result_json,'\$\.elapsedMs'\)/,'GET must not recompute shared production load');
  const statement=prepare(sql),bind=statement.bind;
  statement.bind=function(...args){
   if(sql.includes('FROM factory_kv')&&String(args[0]).startsWith('psychology-production-capacity:'))capacityReads.push(args[0]);
   return bind.apply(this,args);
  };
  return statement;
 });
 const again=await(await f.api('GET')).json();
 assert.equal(again.productionCapacity.accountCount,265);assert.equal(again.productionCapacity.forecastJobs,285);
 assert.equal(again.productionCapacity.nextSlotAt,at('2026-10-01','08:00'));assert.ok(again.productionCapacity.leadMs>2*HOUR);
 assert.equal(again.productionCapacity.asOf,now);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,writes);
 assert.deepEqual(capacityReads,['psychology-production-capacity:admin']);
 const text=JSON.stringify(again.productionCapacity);assert.ok(!text.includes('other-admin'));assert.ok(!text.includes('f-0-0'));
 // A missing own snapshot must not fall back to a different owner's data or refresh it.
 f.sqlite.prepare("DELETE FROM factory_kv WHERE key='psychology-production-capacity:admin'").run();
 const afterDelete=f.sqlite.prepare('SELECT total_changes() n').get().n;
 assert.equal((await(await f.api('GET')).json()).productionCapacity,null);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,afterDelete);
 assert.deepEqual(capacityReads,['psychology-production-capacity:admin','psychology-production-capacity:admin']);
 assert.equal(f.requests.length,0);
});

test('every allocation chunk uses the whole owner population across execution groups',async t=>{
 const f=await pilotFixture(t),now=at('2026-10-01','00:00');t.mock.method(Date,'now',()=>now);
 const accounts=Array.from({length:101},(_,n)=>({id:'bulk-'+n,connectionId:'bulk-'+n,scopes:['video.publish']}));
 await kvSet(f.db,'official-account-groups',{projects:[{id:'psych',name:'心理学',moduleKey:'psychology'}],groups:[{id:'g',name:'Chunk group',projectId:'psych'},{id:'g2',name:'Other group',projectId:'psych'}],assignments:Object.fromEntries(accounts.map((a,n)=>[a.id,n<61?'g':'g2']))});
 t.mock.method(globalThis,'fetch',async url=>{assert.ok(String(url).includes('/api/v1/accounts'));return Response.json({accounts});});
 await importPsychologyPeerHits(f.db,Array.from({length:70},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/photo/'+(80000+n),title:'Capacity '+n,videoData:{pageTexts:['Cover '+n,'Body '+n]}})),admin.id);
 insertForecastPilot(f,{groupId:'g2',now});
 const created=await(await f.api('POST','',{groupId:'g',strategy:'original',days:3,slots:[{hour:8,minute:0}]})).json();
 assert.equal(created.run.batches.length,2,JSON.stringify(created.run.errors));
 const jobs=f.sqlite.prepare('SELECT j.payload_json FROM factory_jobs j JOIN psychology_publish_items i ON i.id=j.id').all();
 assert.equal(jobs.length,61);
 assert.ok(jobs.every(j=>JSON.parse(j.payload_json).psychologyAutomation.productionPlan.accountCount===101));
 assert.ok(jobs.every(j=>JSON.parse(j.payload_json).psychologyAutomation.productionPlan.policy==='adaptive-v1'));
 assert.equal(f.requests.length,0);
});

test('near future supplemental slots retain publishing time and flag short production lead',async t=>{
 const f=await pilotFixture(t);let now=at('2026-10-01','00:00');t.mock.method(Date,'now',()=>now);
 const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:3,slots:[{hour:8,minute:0}]})).json();
 const original=f.sqlite.prepare("SELECT * FROM psychology_publish_items WHERE connection_id='b'").get();
 f.sqlite.prepare('DELETE FROM psychology_peer_account_usage WHERE item_id=?').run(original.id);
 f.sqlite.prepare('UPDATE psychology_publish_items SET deleted_at=? WHERE id=?').run(now,original.id);
 now=at('2026-10-01','07:40');
 const pilot=f.sqlite.prepare('SELECT * FROM psychology_autopilots WHERE id=?').get(id);
 const result=await runAutopilot(f.env,pilot,now);assert.equal(result.batches.length,2,JSON.stringify(result.errors));
 // The 26-hour horizon also adds tomorrow's normal batch. Identify today's
 // supplement by its immutable publication time, not its return order.
 const restored=f.sqlite.prepare("SELECT i.schedule_at,j.payload_json FROM psychology_publish_items i JOIN factory_jobs j ON j.id=i.id WHERE i.connection_id='b' AND i.schedule_at=? AND i.deleted_at=0").get(original.schedule_at);
 const automation=JSON.parse(restored.payload_json).psychologyAutomation;
 assert.equal(restored.schedule_at,original.schedule_at);assert.equal(automation.generateAt,now);assert.equal(automation.productionPlan.shortLead,true);
 assert.equal(f.requests.length,0);
});

test('execution detail prefers persisted generation plan and parent metadata over render retry availability',async t=>{
 const f=await pilotFixture(t),now=at('2026-10-01','00:00');t.mock.method(Date,'now',()=>now);
 const {id}=await(await f.api('POST','',{groupId:'g',strategy:'original',days:3,slots:[{hour:8,minute:0}]})).json();
 const item=f.sqlite.prepare('SELECT * FROM psychology_publish_items ORDER BY id').get(),source=f.sqlite.prepare('SELECT * FROM factory_jobs WHERE id=?').get(item.id);
 const child=item.id+'-render';
 f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,title,created_by,payload_json,available_at,created_at,updated_at) VALUES(?,'psychology','queued','Render','admin',?,?,?,?)").run(child,JSON.stringify({psychologyAutomation:{generateAt:now+123,productionPlan:{leadMs:123,policy:'wrong'}}}),now+7*HOUR,now,now);
 f.sqlite.prepare('UPDATE psychology_publish_items SET job_id=? WHERE id=?').run(child,item.id);
 const generation=now+3*HOUR;
 f.sqlite.prepare('UPDATE psychology_generation_plans SET generation_at=?,lead_ms=?,plan_json=? WHERE job_id=?').run(generation,3*HOUR,JSON.stringify({capacityRisk:false,shortLead:true}),item.id);
 const slot=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=?').get(id);
 let detail=(await slotExecution(f.db,[slot])).find(i=>i.id===item.id);
 assert.equal(detail.generationStartAt,generation);assert.equal(detail.productionLeadMs,3*HOUR);assert.equal(detail.productionPolicy,'adaptive-v1');assert.equal(detail.productionRisk,true);
 f.sqlite.prepare('DELETE FROM psychology_generation_plans WHERE job_id=?').run(item.id);
 detail=(await slotExecution(f.db,[slot])).find(i=>i.id===item.id);
 assert.equal(detail.generationStartAt,JSON.parse(source.payload_json).psychologyAutomation.generateAt);assert.equal(detail.productionLeadMs,2*HOUR);
 // Legacy parents still expose generateAt even though no adaptive metadata exists.
 const legacy=JSON.parse(source.payload_json);delete legacy.psychologyAutomation.productionPlan;
 f.sqlite.prepare('UPDATE factory_jobs SET payload_json=? WHERE id=?').run(JSON.stringify(legacy),item.id);
 detail=(await slotExecution(f.db,[slot])).find(i=>i.id===item.id);assert.equal(detail.generationStartAt,legacy.psychologyAutomation.generateAt);assert.equal(detail.productionPolicy,'');
 assert.equal(f.requests.length,0);
});


test('three daily checks use Pacific 05:00, 08:30 and 17:00 with stable current-window keys',()=>{
 assert.deepEqual(AUTOPILOT_CHECK_SLOTS,[{hour:5,minute:0},{hour:8,minute:30},{hour:17,minute:0}]);
 const summer=['2026-10-02T12:00:00','2026-10-02T15:30:00','2026-10-03T00:00:00','2026-10-03T12:00:00'].map(utc);
 for(let i=0;i<3;i++){
  assert.equal(nextAutopilotCheck(summer[i]-1),summer[i]);
  assert.equal(nextAutopilotCheck(summer[i]),summer[i+1]);
  const current=autopilotCheckWindow(summer[i]+59000);
  assert.equal(current.scheduledAt,summer[i]);assert.equal(current.nextAt,summer[i+1]);
  assert.equal(current.key,['2026-10-02:05:00','2026-10-02:08:30','2026-10-02:17:00'][i]);
 }
 const midnight=autopilotCheckWindow(utc('2026-10-03T07:00:00'));
 assert.equal(midnight.key,'2026-10-02:17:00');assert.equal(midnight.nextAt,summer[3]);
});

test('three Pacific checks preserve local clocks through both DST changes and winter',()=>{
 const cases=[
  ['2026-03-08T01:00:00','2026-03-08T12:00:00','2026-03-07:17:00',11],
  ['2026-11-01T00:00:00','2026-11-01T13:00:00','2026-10-31:17:00',13],
  ['2026-11-02T01:00:00','2026-11-02T13:00:00','2026-11-01:17:00',12],
 ];
 for(const [previous,next,key,hours] of cases){
  const window=autopilotCheckWindow(utc(previous));
  assert.equal(window.key,key);assert.equal(window.scheduledAt,utc(previous));assert.equal(window.nextAt,utc(next));
  assert.equal(window.nextAt-window.scheduledAt,hours*HOUR);
 }
 assert.equal(nextAutopilotCheck(utc('2026-11-01T13:00:00')),utc('2026-11-01T16:30:00'));
 assert.equal(nextAutopilotCheck(utc('2026-11-01T16:30:00')),utc('2026-11-02T01:00:00'));
});

async function recoveryFixture(t) {
  let clock=at('2026-10-03','01:45');
  t.mock.method(Date,'now',()=>clock);
  const f=await pilotFixture(t);
  const pilot={id:'pilot-'+crypto.randomUUID(),owner:'admin',group_id:'g',group_name:'心理学账号',strategy:'original',
    slots_json:JSON.stringify([{hour:2,minute:30},{hour:12,minute:0},{hour:23,minute:10}]),status:'active',
    schedule_timezone:'Asia/Shanghai',created_at:clock-2*DAY,ends_at:clock+6*DAY,updated_at:clock-2*DAY};
  const keys=Object.keys(pilot);
  f.sqlite.prepare('INSERT INTO psychology_autopilots('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>pilot[k]));
  for(const id of ['a','b'])f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES(?,?,'active','',?)").run(pilot.id,id,clock);
  return {...f,pilot,setNow(value){clock=value;},get now(){return clock;}};
}

test('explicit one-round recovery preserves canonical round and settings while starting short-lead generation now',async t=>{
  const f=await recoveryFixture(t),target=at('2026-10-03','03:30'),original=at('2026-10-03','02:30');
  assert.equal(dueSlots(f.pilot,f.now).includes(original),false);
  const before=f.sqlite.prepare('SELECT slots_json,ends_at,updated_at FROM psychology_autopilots WHERE id=?').get(f.pilot.id);
  const result=await (await f.api('POST','/'+f.pilot.id+'/run',{recoverySlotAt:target,recoveryOriginalSlotAt:original})).json();
  assert.equal(result.originalSlotAt,original);assert.equal(result.batches.length,1,JSON.stringify(result));
  const items=f.sqlite.prepare('SELECT schedule_at FROM psychology_publish_items ORDER BY schedule_at').all();
  assert.deepEqual(items.map(i=>i.schedule_at),[target/1000,target/1000+45]);
  const batch=JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches WHERE id=?').get(result.batches[0]).config_json);
  assert.equal(batch.pairSeed,pilotPairSeed(f.pilot,original));
  const plans=f.sqlite.prepare('SELECT generation_at,lead_ms FROM psychology_generation_plans').all();
  assert.equal(plans.length,2);assert.ok(plans.every(p=>p.generation_at===f.now&&p.lead_ms>=2*HOUR));
  assert.deepEqual(f.sqlite.prepare('SELECT slots_json,ends_at,updated_at FROM psychology_autopilots WHERE id=?').get(f.pilot.id),before);
  const again=await recoverAutopilotSlot(f.env,f.pilot,target,f.now,at('2026-10-03','02:30'));
  assert.equal(again.covered,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,2);
  assert.equal(f.requests.length,0);
});

test('recovery binds committed orphan normal batches and keeps their original schedules',async t=>{
  const f=await recoveryFixture(t),original=at('2026-10-03','02:30'),target=at('2026-10-03','03:30');
  f.setNow(at('2026-10-03','00:00'));await runAutopilot(f.env,f.pilot,f.now);
  const slot=f.sqlite.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').get(f.pilot.id,original);
  assert.ok(slot.batch_id);
  const kept=f.sqlite.prepare('SELECT id,schedule_at,job_id FROM psychology_publish_items WHERE batch_id=? ORDER BY id').all(slot.batch_id);
  f.sqlite.prepare("UPDATE psychology_autopilot_slots SET batch_id='',status='creating',updated_at=? WHERE autopilot_id=? AND slot_at=?").run(f.now-6*60000,f.pilot.id,original);
  f.setNow(at('2026-10-03','01:45'));
  const before=f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n;
  const result=await recoverAutopilotSlot(f.env,f.pilot,target,f.now,at('2026-10-03','02:30'));
  assert.equal(result.covered,true);assert.ok(result.existingBatchIds.includes(slot.batch_id));
  assert.deepEqual(f.sqlite.prepare('SELECT id,schedule_at,job_id FROM psychology_publish_items WHERE batch_id=? ORDER BY id').all(slot.batch_id),kept);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,before);
});

test('fresh creating claims block recovery; stale empty claims recover once even with concurrent calls',async t=>{
  const f=await recoveryFixture(t),original=at('2026-10-03','02:30'),target=at('2026-10-03','03:30');
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)").run(f.pilot.id,original,f.now);
  assert.equal((await recoverAutopilotSlot(f.env,f.pilot,target,f.now,at('2026-10-03','02:30'))).busy,true);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,0);
  f.sqlite.prepare('UPDATE psychology_autopilot_slots SET updated_at=? WHERE autopilot_id=? AND slot_at=?').run(f.now-6*60000,f.pilot.id,original);
  const results=await Promise.all([recoverAutopilotSlot(f.env,f.pilot,target,f.now,at('2026-10-03','02:30')),recoverAutopilotSlot(f.env,f.pilot,target,f.now,at('2026-10-03','02:30'))]);
  assert.equal(results.filter(r=>r.batches.length).length,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_publish_items').get().n,2);
  assert.equal(new Set(f.sqlite.prepare('SELECT connection_id,schedule_at FROM psychology_publish_items').all().map(i=>i.connection_id+':'+i.schedule_at)).size,2);
});

test('recovery rejects expired, non-today and cross-operating-day targets and skips paused accounts',async t=>{
  const f=await recoveryFixture(t),target=at('2026-10-03','03:30');
  assert.throws(()=>recoveryOriginalSlot(f.pilot,f.now+10*60000,f.now),/超过 10 分钟/);
  assert.throws(()=>recoveryOriginalSlot(f.pilot,at('2026-10-04','03:30'),f.now),/北京时间今天/);
  assert.throws(()=>recoveryOriginalSlot(f.pilot,target,f.now,at('2026-10-03','12:00')),/原发布轮次/);
  assert.throws(()=>recoveryOriginalSlot({...f.pilot,ends_at:target},target,f.now),/运行期/);
  f.sqlite.prepare("UPDATE psychology_autopilot_accounts SET status='paused' WHERE autopilot_id=? AND connection_id='b'").run(f.pilot.id);
  const result=await recoverAutopilotSlot(f.env,f.pilot,target,f.now,at('2026-10-03','02:30'));
  assert.equal(result.batches.length,1);
  assert.deepEqual(f.sqlite.prepare('SELECT connection_id FROM psychology_publish_items').all().map(i=>i.connection_id),['a']);
  const pacific={...f.pilot,slots_json:JSON.stringify([{hour:23,minute:30}]),schedule_timezone:'America/Los_Angeles'};
  assert.throws(()=>recoveryOriginalSlot(pacific,at('2026-10-03','16:00'),f.now,at('2026-10-03','14:30')),/原发布轮次/);
});

test('one-round recovery can retry an explicit later canonical round without running all pilot slots',async t=>{
  const f=await recoveryFixture(t),target=at('2026-10-03','12:00');
  f.sqlite.prepare("INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)").run(f.pilot.id,target,f.now-6*60000);
  const result=await recoverAutopilotSlot(f.env,f.pilot,target,f.now,target);
  assert.equal(result.originalSlotAt,target);assert.equal(result.batches.length,1,JSON.stringify(result));
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_autopilot_slots WHERE autopilot_id=?').get(f.pilot.id).n,1);
  assert.deepEqual(f.sqlite.prepare('SELECT schedule_at FROM psychology_publish_items ORDER BY schedule_at').all().map(i=>i.schedule_at),[target/1000,target/1000+45]);
});
