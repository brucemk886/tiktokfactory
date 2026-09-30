import test from 'node:test';
import assert from 'node:assert/strict';
import { POOL_POLICY, ACCOUNT_POOLS, CONTENT_POOLS, classifyAccountPool, classifyContentPool, poolQuota, desiredContentPool, rankPoolCandidates } from './psychology-pool-policy.js';

const account = overrides => ({ n: 6, medianViews: 300, avgViews: 350, completion: 0.16, potentialRate: 0.1, ...overrides });
const content = overrides => ({ ...account(), accounts: 5, medianViews: 500, versionKnown: true, styleKnown: true, ...overrides });
const candidate = (id, pool, stats = {}) => ({ id, contentPool: pool, stats: content(stats) });

test('shared constants and definitions are immutable and complete', () => {
  assert.equal(POOL_POLICY.maturityHours, 72);
  assert.ok(Object.isFrozen(POOL_POLICY));
  for (const [id, def] of Object.entries(ACCOUNT_POOLS)) assert.equal(def.id, id);
  for (const [id, def] of Object.entries(CONTENT_POOLS)) assert.equal(def.id, id);
});

test('account median thresholds classify pools without upgrading from a viral mean', () => {
  assert.deepEqual([0, 49, 50, 199, 200, 499, 500].map(medianViews => classifyAccountPool(account({ medianViews }))),
    ['diagnostic', 'diagnostic', 'rescue-hook', 'rescue-hook', 'normal', 'normal', 'strong']);
  assert.equal(classifyAccountPool(account({ medianViews: 126.5, avgViews: 10000 })), 'rescue-hook');
});

test('account classification keeps zero, unknown and insufficient samples separate', () => {
  assert.equal(classifyAccountPool(account({ n: 4, medianViews: 8000 })), 'observing');
  for (const missing of [null, undefined, '', NaN]) assert.equal(classifyAccountPool(account({ medianViews: missing })), 'observing');
  assert.equal(classifyAccountPool(account({ medianViews: 0, completion: 1 })), 'diagnostic');
  assert.equal(classifyAccountPool(account({ medianViews: 100, completion: 0 })), 'rescue-content');
  assert.equal(classifyAccountPool(account({ medianViews: 100, completion: null })), 'rescue-content');
  assert.equal(classifyAccountPool(account({ medianViews: 100, completion: 0.1187 })), 'rescue-hook');
  assert.equal(classifyAccountPool(account({ medianViews: 100, completion: 0 }), { completionBaseline: 0 }), 'rescue-hook');
});

test('content is mature only with enough distinct accounts and known exact identity', () => {
  assert.equal(classifyContentPool(content()), 'winner');
  assert.equal(classifyContentPool(content({ n: 4 })), 'explore');
  assert.equal(classifyContentPool(content({ n: 100, accounts: 4 })), 'explore');
  assert.equal(classifyContentPool(content({ accounts: null })), 'explore');
  assert.equal(classifyContentPool(content({ versionKnown: undefined })), 'explore');
  assert.equal(classifyContentPool(content({ styleKnown: false })), 'explore');
});

test('content thresholds preserve zero completion and guard zero-exposure high completion', () => {
  assert.equal(classifyContentPool(content({ medianViews: 400, completion: 0.15 })), 'winner');
  assert.equal(classifyContentPool(content({ medianViews: 400, completion: 0.149 })), 'optimize');
  assert.equal(classifyContentPool(content({ medianViews: 400, completion: 0 })), 'optimize');
  assert.equal(classifyContentPool(content({ medianViews: 399, completion: 0.15 })), 'potential');
  assert.equal(classifyContentPool(content({ medianViews: 50, completion: 0.15 })), 'potential');
  assert.equal(classifyContentPool(content({ medianViews: 49, completion: 0.5 })), 'explore');
  assert.equal(classifyContentPool(content({ medianViews: 0, completion: 0.5 })), 'explore');
  assert.equal(classifyContentPool(content({ medianViews: 0, completion: 0 })), 'revise');
  assert.equal(classifyContentPool(content({ completion: null })), 'explore');
  assert.equal(classifyContentPool(content({ medianViews: null })), 'explore');
});

test('threshold options are shared and preserve an explicit zero baseline', () => {
  assert.equal(classifyAccountPool(account({ medianViews: 450 }), { policy: { strongViews: 400 } }), 'strong');
  assert.equal(classifyContentPool(content({ medianViews: 350 }), { policy: { winnerViews: 300 } }), 'winner');
  assert.equal(classifyContentPool(content({ completion: 0 }), { policy: { contentCompletion: 0 } }), 'winner');
});

test('weekly quotas match the approved two-post allocation', () => {
  const ratios = pool => { const q = poolQuota(pool); return [q.winner, q.optimize, q.explore, q.total]; };
  assert.deepEqual(ratios('strong'), [12, 1, 1, 14]);
  assert.deepEqual(ratios('normal'), [10, 3, 1, 14]);
  assert.deepEqual(ratios('rescue-hook'), [11, 3, 0, 14]);
  assert.deepEqual(ratios('rescue-content'), [11, 3, 0, 14]);
  assert.deepEqual(ratios('diagnostic'), [14, 0, 0, 14]);
  assert.equal(poolQuota('diagnostic').diagnosticMaxTests, 6);
  assert.equal(poolQuota('normal').diagnosticMaxTests, null);
});

test('weekly slots exactly preserve scaled quotas across one to ten daily posts and seeds', () => {
  for (const accountPool of Object.keys(ACCOUNT_POOLS)) for (let postsPerDay = 1; postsPerDay <= 10; postsPerDay++) for (const seed of ['', 'test-week', 'second-owner']) {
    const actual = { winner: 0, optimize: 0, explore: 0 }, quota = poolQuota(accountPool, { postsPerDay });
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) for (let round = 0; round < postsPerDay; round++) actual[desiredContentPool({ accountPool, dayIndex, round, postsPerDay, seed })]++;
    assert.deepEqual(actual, { winner: quota.winner, optimize: quota.optimize, explore: quota.explore }, accountPool + '/' + postsPerDay + '/' + seed);
  }
});

test('two-post schedules retain a daily baseline and alternate optimization rounds', () => {
  for (const accountPool of ['strong', 'normal', 'rescue-hook', 'rescue-content']) {
    const rounds = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const slots = [0, 1].map(round => desiredContentPool({ accountPool, dayIndex, round }));
      assert.ok(slots.includes('winner'));
      for (let round = 0; round < 2; round++) if (slots[round] !== 'winner') rounds.push(round);
      assert.equal(desiredContentPool({ accountPool, dayIndex: dayIndex + 7, round: 0 }), slots[0]);
    }
    assert.ok(rounds.includes(0) && rounds.includes(1));
  }
  assert.throws(() => poolQuota('normal', { postsPerDay: 0 }), RangeError);
  assert.throws(() => desiredContentPool({ accountPool: 'normal', round: 2 }), RangeError);
});

test('low account ranking never falls back to cold exploration or low-reach potential', () => {
  const candidates = [candidate('cold', 'explore'), candidate('potential', 'potential'), candidate('winner', 'winner'), candidate('opt', 'optimize'), candidate('bad', 'revise')];
  for (const pool of ['rescue-hook', 'rescue-content']) assert.deepEqual(rankPoolCandidates(candidates, pool, { desiredPool: 'explore' }).map(c => c.id).sort(), ['opt', 'winner']);
  assert.deepEqual(rankPoolCandidates(candidates, 'diagnostic').map(c => c.id), ['winner']);
  assert.deepEqual(rankPoolCandidates([candidates[0], candidates[1]], 'rescue-hook'), []);
  assert.deepEqual(rankPoolCandidates([candidates[0]], 'diagnostic'), []);
});

test('stable account candidate ordering follows desired pool then median, not mean', () => {
  const candidates = [candidate('viral-mean', 'winner', { medianViews: 420, avgViews: 50000 }), candidate('steady', 'winner', { medianViews: 600, avgViews: 650 }), candidate('new', 'explore')];
  const untouched = structuredClone(candidates);
  assert.deepEqual(rankPoolCandidates(candidates, 'normal', { desiredPool: 'winner' }).map(c => c.id), ['steady', 'viral-mean', 'new']);
  assert.equal(rankPoolCandidates(candidates, 'strong', { desiredPool: 'explore' })[0].id, 'new');
  assert.deepEqual(candidates, untouched);
  assert.equal(classifyContentPool(content({ medianViews: 100, avgViews: 100000, completion: 0.1 })), 'revise');
});

test('ranking classifies exact candidate stats and uses stable tie-breaking', () => {
  const candidates = ['a', 'b', 'c'].map(id => ({ id, stats: content() }));
  const first = rankPoolCandidates(candidates, 'normal', { seed: 'paired' });
  const second = rankPoolCandidates([...candidates].reverse(), 'normal', { seed: 'paired' });
  assert.deepEqual(first.map(c => c.id), second.map(c => c.id));
  const fit = candidate('fit', 'winner', { medianViews: 450 });
  fit.accountPoolStats = { normal: { medianViews: 900, completion: 0.2 } };
  assert.equal(rankPoolCandidates([candidate('overall', 'winner', { medianViews: 800 }), fit], 'normal')[0].id, 'fit');
});


test('allocator exact candidate keys participate in deterministic pairing', () => {
  const rows=['source-a','source-b','source-c'].map(key=>({key,variantId:'',pool:'winner',stats:content()}));
  assert.deepEqual(rankPoolCandidates(rows,'normal',{seed:'week'}).map(c=>c.key),rankPoolCandidates([...rows].reverse(),'normal',{seed:'week'}).map(c=>c.key));
});
