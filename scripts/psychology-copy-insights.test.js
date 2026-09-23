import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyInsights, accountStage, viewTier } from './psychology-copy-insights.js';

const DAY = 86400000, now = Date.UTC(2026, 8, 23);
const at = d => now - d * DAY;

test('view tiers follow the traffic-pool thresholds', () => {
  assert.deepEqual([0, 199, 200, 999, 1000, 9999, 10000, 99999, 100000, 499999, 500000, 1999999, 2000000].map(viewTier),
    ['low', 'low', 'normal', 'normal', 'potential', 'potential', 'rising', 'rising', 'small', 'small', 'hit', 'hit', 'big']);
});

test('account stage uses absolute views: 10 matured posts averaging 1000+ is potential', () => {
  assert.equal(accountStage(Array(9).fill(5000)), 'launch');
  assert.equal(accountStage(Array(10).fill(999)), 'normal');
  assert.equal(accountStage([...Array(9).fill(500), 5500]), 'potential');
  assert.equal(accountStage([100000, ...Array(10).fill(100)]), 'potential'); // 100k is older than the last 10: not burst, but lifts the average
  assert.equal(accountStage([...Array(9).fill(100), 100000]), 'burst');
});

// Five posts, each used six times on separate accounts; uses 4+ get fewer views.
function reuseScenario(viewsFor, extra = {}) {
  const rows = [], history = [], videosByAccount = new Map();
  for (let post = 0; post < 5; post++) for (let use = 1; use <= 6; use++) {
    const account = `tiktok:${post}-${use}`, time = at(10 - use * 0.1), id = `${post}-${use}`, views = viewsFor(use);
    const variant = extra.variant?.(use) || '', style = extra.style?.(use) || 's';
    videosByAccount.set(account, [{ id: id + 'v', createTime: time / 1000, views }]);
    history.push({ id, source_key: 'p' + post, variant_id: variant, style_id: style, schedule_at: time / 1000 });
    rows.push({ id, account, source: 'p' + post, variant, style, views, time, mature: true, averageWatch: 6, completion: 0.2, likes: use, shares: 0 });
  }
  return buildCopyInsights({ rows, history, videosByAccount, now });
}

test('finds the use count where a post clearly loses traffic', () => {
  const r = reuseScenario(use => use >= 4 ? 400 : 1200);
  assert.equal(r.reuse[0].medianViews, 1200);
  assert.equal(r.reuse[0].tiers.potential, 5);
  assert.equal(r.dropAt, '第4–5次');
  assert.match(r.findings[1], /第4–5次.*低 67%/);
  assert.equal(r.overall.averageWatch, 6);
  assert.ok(Math.abs(r.overall.completion - 0.2) < 1e-9);
  assert.equal(r.overall.shares, null); // zero shares are treated as not synced
  assert.equal(reuseScenario(() => 800).dropAt, null);
});

test('compares new versions, style changes and rewrites of posts that broke 10k', () => {
  // Use 1 is the original at 20k; odd repeats reuse the original, even repeats are new rewrites in a new style.
  const r = reuseScenario(use => use === 1 ? 20000 : use % 2 ? 1000 : 3000, { variant: use => use % 2 === 0 ? 'v' + use : '', style: use => use % 2 === 0 ? 's' + use : 's' });
  assert.equal(r.version.fresh.medianViews, 3000);
  assert.equal(r.version.same.medianViews, 1000);
  assert.equal(r.style.changed.n, 25); // every repeat differs from the style used just before it
  assert.equal(r.style.same.n, 0);
  assert.equal(r.rewrite.hitSources, 5);
  assert.equal(r.rewrite.hitRewrite.medianViews, 3000);
  assert.ok(r.findings.some(f => /换新版本的中位播放是沿用旧版本的 300%/.test(f)));
  assert.ok(r.findings.some(f => /改写版中位播放是原版的/.test(f)));
});

test('stages, new-account curve and potential accounts', () => {
  const rows = [], history = [], videosByAccount = new Map();
  const old = Array.from({ length: 10 }, (_, k) => ({ id: 'old' + k, createTime: at(30 - k) / 1000, views: 1500 }));
  videosByAccount.set('tiktok:pro', old);
  for (let i = 0; i < 6; i++) {
    const account = 'tiktok:n' + i, time = at(5), id = 'n' + i;
    videosByAccount.set(account, [{ id: id + 'v', createTime: time / 1000, views: 300 }]);
    history.push({ id, source_key: 'k' + i, variant_id: '', style_id: '', schedule_at: time / 1000 });
    rows.push({ id, account, source: 'k' + i, variant: '', style: 'unknown', views: 300, time, mature: true });
  }
  rows.push({ id: 'fresh', account: 'tiktok:n0', views: 10, time: now - 3600000, mature: false });
  const r = buildCopyInsights({ rows, history, videosByAccount, now, accounts: [{ schema: 'tiktok:pro', profile: { username: 'pro' } }] });
  assert.equal(r.sample.mature, 6);
  const launch = r.stages.find(s => s.stage === 'launch');
  assert.equal(launch.kinds.first.n, 6);
  assert.equal(launch.best, null); // only one kind has samples
  assert.deepEqual(r.currentStages, { launch: 6, normal: 0, potential: 1, burst: 0 });
  assert.deepEqual(r.potentialAccounts.map(a => [a.name, a.posts, a.avgViews]), [['pro', 10, 1500]]);
  assert.equal(r.postIndex[0].n, 6);
  assert.equal(r.overall.tiers.normal, 6);
  // A 7-day report window excludes the potential account's older posts.
  const week = buildCopyInsights({ rows, history, videosByAccount, now, window: { start: at(7), end: now } });
  assert.deepEqual(week.currentStages, { launch: 6, normal: 0, potential: 0, burst: 0 });
  assert.equal(week.potentialAccounts.length, 0);
});
