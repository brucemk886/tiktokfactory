import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { planLibraryDraw, refreshCopyPerformance, loadUsedPosts, loadCopyStats, EVOLUTION } from './psychology-copy-evolution.js';

const post = (key, rewrites = [], createdAt = 0) => ({ sourceKey: key, createdAt, original: { id: 'o-' + key }, rewrites: rewrites.map(id => ({ id: 'r-' + id, external_id: id })) });
const stats = entries => new Map(entries.map(([key, variant, posts, mature, avgViews]) => [key + '|' + variant, { posts, mature, avgViews }]));
const slots = n => Array.from({ length: n }, (_, i) => ({ connectionId: 'acc' + i, scheduleAt: i }));
const always = value => () => value;
const pick = plan => plan.map(p => p.post.sourceKey + ':' + (p.variantId || 'original'));

test('originals go first, a batch spreads over posts, and a taken original yields to its least-used rewrite', () => {
  const plan = planLibraryDraw({ posts: [post('A', ['a1', 'a2']), post('B', [], 1)], slots: slots(3), random: always(0.5) });
  assert.deepEqual(pick(plan), ['A:original', 'B:original', 'A:a1']);
});

test('once the original has a baseline, 70% of picks keep the best version and 30% try untested rewrites', () => {
  const posts = () => [post('A', ['a1', 'a2'])];
  const baseline = stats([['A', '', 5, EVOLUTION.matureNeeded, 1000]]);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), stats: baseline, slots: slots(1), random: always(0.5) })), ['A:original']);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), stats: baseline, slots: slots(1), random: always(0.9) })), ['A:a1']);
});

test('a rewrite that beats the original wins; one under half the original is retired', () => {
  const posts = () => [post('A', ['a1', 'a2'])];
  const better = stats([['A', '', 5, 3, 1000], ['A', 'a1', 4, 3, 3000], ['A', 'a2', 3, 3, 900]]);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), stats: better, slots: slots(3), random: always(0.5) })), ['A:a1', 'A:original', 'A:a2']);
  const weak = stats([['A', '', 5, 3, 1000], ['A', 'a1', 4, 3, 400], ['A', 'a2', 3, 3, 499]]);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), stats: weak, slots: slots(1), random: always(0.9) })), ['A:original']);
  assert.throws(() => planLibraryDraw({ posts: posts(), stats: weak, slots: slots(2), random: always(0.9) }), /不够/); // retired versions never fill a gap
});

test('proven posts take the exploit share and fresh posts the rest', () => {
  const posts = () => [post('A'), post('B', [], 5)];
  const proven = stats([['A', '', 3, 3, 800]]);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), stats: proven, slots: slots(1), random: always(0.5) })), ['A:original']);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), stats: proven, slots: slots(1), random: always(0.9) })), ['B:original']);
});

test('an account never gets a post it already published in any version unless reuse is allowed', () => {
  const used = () => new Map([['acc0', new Set(['A'])]]);
  const posts = () => [post('A', ['a1']), post('B', [], 5)];
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), slots: slots(1), used: used(), random: always(0.5) })), ['B:original']);
  assert.deepEqual(pick(planLibraryDraw({ posts: posts(), slots: slots(1), used: used(), reuse: true, random: always(0.5) })), ['A:original']);
  // One account filling several slots in a batch still never repeats a post.
  const same = [{ connectionId: 'acc0', scheduleAt: 1 }, { connectionId: 'acc0', scheduleAt: 2 }];
  assert.deepEqual(pick(planLibraryDraw({ posts: [post('A', ['a1']), post('B', [], 5)], slots: same, random: always(0.5) })), ['A:original', 'B:original']);
});

function database(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(new URL(file, dir), 'utf8'));
  const db = { prepare(sql) { return { args: [], bind(...args) { return { ...this, args }; },
    async first() { return sqlite.prepare(sql).get(...this.args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...this.args) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...this.args).changes) } }; } }; },
    async batch(items) { sqlite.exec('BEGIN'); try { const out = []; for (const item of items) out.push(await item.all()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  return { sqlite, db };
}

test('legacy usage keyed by original or rewrite id still blocks the whole post', async t => {
  const { sqlite, db } = database(t);
  sqlite.prepare("INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES ('o-A','acc0','old-1'),('r-b1','acc1','old-2'),('C','acc2','new-1')").run();
  const used = await loadUsedPosts(db, ['acc0', 'acc1', 'acc2'], [post('A'), post('B', ['b1']), post('C')]);
  assert.deepEqual([...used.get('acc0')], ['A']);assert.deepEqual([...used.get('acc1')], ['B']);assert.deepEqual([...used.get('acc2')], ['C']);
});

test('the daily rollup counts posts per version and averages only matured views', async t => {
  const { sqlite, db } = database(t);
  const now = Date.parse('2026-09-23T08:00:00+08:00'), day = 86400000;
  sqlite.prepare("INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES ('b','admin',?,?)").run(JSON.stringify({ mediaType: 'photo' }), now - 3 * day);
  const items = [['i1', 'A', '', 'v1'], ['i2', 'A', '', 'v2'], ['i3', 'A', 'a1', 'v3'], ['i4', 'A', 'a1', 'v4']];
  for (const [id, key, variant] of items) {
    sqlite.prepare("INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at) VALUES (?,?,?,?,'a',0)").run(id, 'b', 'src', id);
    sqlite.prepare('INSERT INTO psychology_creative_snapshots(item_id,source_key,variant_id,style_id) VALUES (?,?,?,?)').run(id, key, variant, 's');
  }
  for (const [id, , , video] of items) sqlite.prepare('INSERT INTO factory_publish_records(id,created_at,value_json) VALUES (?,?,?)').run('rec-' + id, now, JSON.stringify({ autoTaskId: id, connectionId: 'a', videoId: video }));
  const videos = [{ id: 'v1', views: 1000, createTime: now - 2 * day }, { id: 'v2', views: 3000, createTime: now - 2 * day },
    { id: 'v3', views: 500, createTime: now - 2 * day }, { id: 'v4', views: 90000, createTime: now - 3600000 }]; // v4 is under 24h
  const result = await refreshCopyPerformance({ DB: db }, now, { accounts: [{ schema: 'tiktok:a', connectionId: 'a' }], videosByAccount: new Map([['tiktok:a', videos]]) });
  assert.equal(result.versions, 2);
  const table = await loadCopyStats(db, 'admin');
  assert.deepEqual(table.get('A|'), { posts: 2, mature: 2, avgViews: 2000 });
  assert.deepEqual(table.get('A|a1'), { posts: 2, mature: 1, avgViews: 500 });
});
