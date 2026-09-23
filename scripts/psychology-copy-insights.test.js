import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyInsights, accountStage } from './psychology-copy-insights.js';

const DAY = 86400000, now = Date.UTC(2026, 8, 23);
const at = d => now - d * DAY;

test('account stage follows matured views before the post', () => {
  assert.equal(accountStage([100, 100, 100]), 'launch');
  const flat = Array(10).fill(100);
  assert.equal(accountStage(flat), 'stable');
  assert.equal(accountStage([...Array(5).fill(100), ...Array(5).fill(250)]), 'burst');
  assert.equal(accountStage([...Array(5).fill(100), ...Array(5).fill(40)]), 'decline');
});

// Each account posts 3 baseline videos at 100 views, then one auto item from a
// post shared by all accounts; the n-th use of that post gets views[n-1].
function scenario(viewsByUse, extra = {}) {
  const rows = [], history = [], videosByAccount = new Map();
  viewsByUse.forEach((views, i) => {
    const account = 'tiktok:a' + i, time = at(10 - i * 0.1), id = 'item' + i;
    videosByAccount.set(account, [...[0, 1, 2].map(k => ({ id: account + k, createTime: (at(20 + k)) / 1000, views: 100 })), { id: id + 'v', createTime: time / 1000, views }]);
    history.push({ id, source_key: 'post', variant_id: extra.variant?.(i) || '', style_id: extra.style?.(i) || 's1', schedule_at: time / 1000 });
    rows.push({ id, account, source: 'post', variant: extra.variant?.(i) || '', style: extra.style?.(i) || 's1', views, time, mature: true });
  });
  return buildCopyInsights({ rows, history, videosByAccount, now });
}

test('finds the use count where a post clearly loses traffic relative to account baselines', () => {
  assert.equal(scenario(Array(15).fill(300)).dropAt, null); // one post: its first use has fewer than 5 samples
  // Five posts, each used six times, so every use bucket has five samples.
  const rows = [], history = [], videosByAccount = new Map();
  for (let post = 0; post < 5; post++) for (let use = 1; use <= 6; use++) {
    const account = `tiktok:${post}-${use}`, time = at(10 - use * 0.1), id = `${post}-${use}`, views = use >= 4 ? 100 : 300;
    videosByAccount.set(account, [...[0, 1, 2].map(k => ({ id: account + k, createTime: at(20 + k) / 1000, views: 100 })), { id: id + 'v', createTime: time / 1000, views }]);
    history.push({ id, source_key: 'p' + post, variant_id: '', style_id: 's', schedule_at: time / 1000 });
    rows.push({ id, account, source: 'p' + post, variant: '', style: 's', views, time, mature: true });
  }
  const r = buildCopyInsights({ rows, history, videosByAccount, now });
  assert.equal(r.reuse[0].medianLift, 3);
  assert.equal(r.reuse[3].label, '第4–5次');
  assert.equal(r.dropAt, '第4–5次');
  assert.match(r.findings[0], /第4–5次.*低 67%/);
});

test('compares version and style changes on repeats and rewrites of posts that already hit', () => {
  const r = scenario(Array.from({ length: 13 }, (_, i) => i === 0 ? 400 : i % 2 ? 150 : 300), { variant: i => i && i % 2 === 0 ? 'v' + i : '', style: i => i % 2 === 0 ? 's' + i : 's1' });
  // Odd uses reuse the original with style s1; even uses are new rewrites with a new style.
  assert.equal(r.version.fresh.medianLift, 3);
  assert.equal(r.version.same.medianLift, 1.5);
  assert.equal(r.style.changed.n, 12);
  assert.equal(r.rewrite.hitSources, 1);
  assert.equal(r.rewrite.hitRewrite.medianLift, 3);
  assert.ok(r.findings.some(f => /换一个新版本|新版本/.test(f)));
  assert.ok(r.findings.some(f => /改写版的中位表现是原版的/.test(f)));
});

test('new accounts without a baseline are compared by raw views in the launch stage', () => {
  const rows = [], history = [], videosByAccount = new Map();
  for (let i = 0; i < 12; i++) {
    const account = 'tiktok:n' + i, time = at(5), id = 'n' + i, rewrite = i % 2 === 1;
    videosByAccount.set(account, [{ id: id + 'v', createTime: time / 1000, views: rewrite ? 50 : 500 }]);
    history.push({ id, source_key: 'k' + i, variant_id: rewrite ? 'r' : '', style_id: '', schedule_at: time / 1000 });
    rows.push({ id, account, source: 'k' + i, variant: rewrite ? 'r' : '', style: 'unknown', views: rewrite ? 50 : 500, time, mature: true });
  }
  rows.push({ id: 'fresh', account: 'tiktok:n0', views: 10, time: now - 3600000, mature: false });
  const r = buildCopyInsights({ rows, history, videosByAccount, now });
  assert.equal(r.sample.mature, 12);
  assert.equal(r.sample.withLift, 0);
  const launch = r.stages.find(s => s.stage === 'launch');
  assert.equal(launch.metric, 'medianViews');
  assert.equal(launch.kinds.first.n, 12); // every post is its first use
  assert.equal(launch.best, null);
  assert.equal(r.currentStages.launch, 12);
  assert.equal(r.postIndex[0].n, 12);
  assert.match(r.findings[0], /样本不足/);
});
