import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpsFramework, accountStage, viewTier } from './psychology-ops-framework.js';
import { buildContentPerformance, retentionAt } from './psychology-content-performance.js';

const DAY = 86400000, now = Date.UTC(2026, 8, 23);
const at = d => now - d * DAY;
const win = (days = 14) => ({ start: at(days), end: now, previousStart: at(days * 2), days });

test('3-second retention reads the per-second curve in either scale and needs 3 seconds of data', () => {
  assert.equal(retentionAt([{ second: 0, percentage: 100 }, { second: 3, percentage: 42 }]), 0.42);
  assert.equal(retentionAt([{ second: 2, percentage: 0.6 }, { second: 4, percentage: 0.4 }]), 0.5);
  assert.equal(retentionAt('[{"second":0,"percentage":1},{"second":5,"percentage":0.5}]'), 0.7);
  assert.equal(retentionAt([{ second: 0, percentage: 100 }, { second: 2, percentage: 50 }]), null);
  assert.equal(retentionAt([]), null);
});

test('video auto posts are analysed on their own with 3-second retention', () => {
  const account = 'tiktok:v', videos = [], items = [], records = [];
  for (let k = 0; k < 6; k++) {
    const time = at(5 - k * 0.2);
    videos.push({ id: 'vid' + k, createTime: time / 1000, views: 2000, fullWatchRate: 0.3, averageTimeWatched: 9, duration: 20, retention: [{ second: 0, percentage: 100 }, { second: 3, percentage: 60 }] });
    items.push({ id: 'i' + k, connection_id: 'v', config_json: JSON.stringify({ mediaType: k === 5 ? 'photo' : 'video' }), source_key: 'topic' + k, title: 'T' + k });
    records.push({ autoTaskId: 'i' + k, connectionId: 'v', videoId: 'vid' + k });
  }
  const accounts = [{ schema: account, connectionId: 'v' }], videosByAccount = new Map([[account, videos]]);
  const rows = buildContentPerformance({ items, records, accounts, videosByAccount, now, media: 'video' }).rows;
  assert.equal(rows.length, 5);
  assert.equal(rows[0].retention3, 0.6);
  assert.equal(buildContentPerformance({ items, records, accounts, videosByAccount, now }).rows[0].retention3, null); // photo rows skip it
  const r = buildOpsFramework({ rows, history: items.map((i, k) => ({ id: i.id, source_key: i.source_key, schedule_at: at(5 - k * 0.2) / 1000 })), videosByAccount, window: win(), now, media: 'video' });
  assert.equal(r.media, 'video');
  assert.equal(r.overview.current.n, 5);
  assert.ok(Math.abs(r.overview.current.retention3 - 0.6) < 1e-9);
  assert.match(r.strategy.findings[0], /本期视频 5 条.*3秒留存 60%/);
  assert.match(r.quadrants.hook.action, /脚本/);
});

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

// Five posts, each used six times on separate accounts inside the window.
function reuseScenario(viewsFor, extra = {}) {
  const rows = [], history = [], videosByAccount = new Map();
  for (let post = 0; post < 5; post++) for (let use = 1; use <= 6; use++) {
    const account = `tiktok:${post}-${use}`, time = at(10 - use * 0.1), id = `${post}-${use}`, views = viewsFor(use);
    const variant = extra.variant?.(use) || '', style = extra.style?.(use) || 's';
    videosByAccount.set(account, [{ id: id + 'v', createTime: time / 1000, views }]);
    history.push({ id, source_key: 'p' + post, variant_id: variant, style_id: style, schedule_at: time / 1000 });
    rows.push({ id, account, source: 'p' + post, title: 'Post ' + post, variant, style, views, time, mature: true, averageWatch: 6, completion: extra.completion?.(use) ?? 0.2, likes: use, shares: 0 });
  }
  return buildOpsFramework({ rows, history, videosByAccount, window: win(), now });
}

test('content: finds the use count where a post clearly loses traffic and ranks posts', () => {
  const r = reuseScenario(use => use >= 4 ? 400 : 1200);
  assert.equal(r.content.reuse[0].medianViews, 1200);
  assert.equal(r.content.dropAt, '第4–5次');
  assert.ok(r.strategy.findings.some(f => /第4–5次.*低 67%/.test(f)));
  assert.equal(r.content.sources.length, 5);
  assert.equal(r.content.sources[0].totalUses, 6);
  assert.equal(r.content.sources[0].accounts, 6);
  assert.equal(r.overview.current.averageWatch, 6);
  assert.equal(r.overview.current.shares, null); // zero shares are treated as not synced
  assert.equal(reuseScenario(() => 800).content.dropAt, null);
});

test('content: new versions, style changes and rewrites of posts that broke 10k', () => {
  const r = reuseScenario(use => use === 1 ? 20000 : use % 2 ? 1000 : 3000, { variant: use => use % 2 === 0 ? 'v' + use : '', style: use => use % 2 === 0 ? 's' + use : 's' });
  assert.equal(r.content.version.fresh.medianViews, 3000);
  assert.equal(r.content.version.same.medianViews, 1000);
  assert.equal(r.content.style.changed.n, 25);
  assert.equal(r.content.rewrite.hitSources, 5);
  assert.equal(r.content.rewrite.hitRewrite.medianViews, 3000);
  assert.ok(r.strategy.findings.some(f => /换新版本的中位播放是沿用旧版本的 300%/.test(f)));
});

test('overview: quadrants split views at 1000 and completion at the period median', () => {
  // Uses 1-3: 1200 views; 4-6: 400. Completion alternates high/low.
  const r = reuseScenario(use => use >= 4 ? 400 : 1200, { completion: use => use % 2 ? 0.3 : 0.1 });
  assert.equal(r.overview.completionLine, 0.2);
  assert.deepEqual(r.overview.current.quadrants, { star: 10, hook: 5, account: 5, weak: 10, unknown: 0 });
  assert.ok(r.strategy.findings.some(f => /最多的是/.test(f)));
  assert.equal(r.overview.daily.length, 14);
  assert.equal(r.overview.daily.reduce((n, d) => n + d.n, 0), 30);
});

test('accounts: cumulative stages at period start and end, transitions, issues and previous period', () => {
  const rows = [], history = [], videosByAccount = new Map(), w = win(7);
  // "riser": 10 old posts at 300 (normal before the window), then 5 in-window posts at 5000.
  const riser = [...Array.from({ length: 10 }, (_, k) => ({ id: 'r' + k, createTime: at(30 - k) / 1000, views: 300 }))];
  for (let k = 0; k < 5; k++) {
    const time = at(5 - k * 0.5), id = 'ri' + k;
    riser.push({ id: id + 'v', createTime: time / 1000, views: 5000 });
    history.push({ id, source_key: 's' + k, variant_id: '', style_id: '', schedule_at: time / 1000 });
    rows.push({ id, account: 'tiktok:riser', source: 's' + k, title: 'S' + k, variant: '', style: 'unknown', views: 5000, time, mature: true, completion: 0.2 });
  }
  videosByAccount.set('tiktok:riser', riser);
  // "stuck": new account, 5 in-window posts at 50 views.
  const stuck = [];
  for (let k = 0; k < 5; k++) {
    const time = at(5 - k * 0.5), id = 'st' + k;
    stuck.push({ id: id + 'v', createTime: time / 1000, views: 50 });
    history.push({ id, source_key: 'x' + k, variant_id: '', style_id: '', schedule_at: time / 1000 });
    rows.push({ id, account: 'tiktok:stuck', source: 'x' + k, title: 'X' + k, variant: '', style: 'unknown', views: 50, time, mature: true, completion: 0.1 });
  }
  videosByAccount.set('tiktok:stuck', stuck);
  // One previous-period post and one fresh post.
  rows.push({ id: 'prev', account: 'tiktok:riser', source: 'p', views: 700, time: at(10), mature: true });
  rows.push({ id: 'fresh', account: 'tiktok:stuck', source: 'f', views: 3, time: now - 3600000, mature: false });
  const r = buildOpsFramework({ rows, history, videosByAccount, window: w, now, accounts: [{ schema: 'tiktok:riser', profile: { username: 'riser' }, groupName: 'G' }] });
  assert.equal(r.overview.current.n, 10);
  assert.equal(r.overview.previous.n, 1);
  assert.equal(r.overview.observing, 1);
  assert.deepEqual(r.accounts.stages.start, { launch: 0, normal: 1, potential: 0, burst: 0 });
  assert.deepEqual(r.accounts.stages.end, { launch: 1, normal: 0, potential: 1, burst: 0 });
  assert.deepEqual(r.accounts.transitions.sort((a, b) => a.from.localeCompare(b.from)), [{ from: 'new', to: 'launch', n: 1 }, { from: 'normal', to: 'potential', n: 1 }]);
  const byName = Object.fromEntries(r.accounts.rows.map(a => [a.name, a]));
  assert.equal(byName.riser.issue, '潜力号，可以加码');
  assert.equal(byName.riser.group, 'G');
  assert.equal(byName['tiktok:stuck'].issue, '持续低播放，先查账号状态');
  assert.ok(r.strategy.findings.some(f => /1 个号升到潜力账号/.test(f)));
  const launch = r.strategy.stages.find(s => s.stage === 'launch');
  assert.equal(launch.kinds.first.n, 5);
  assert.equal(launch.best, null);
});


test('interactive report includes same-day samples while the scheduler retains its maturity policy',()=>{
 const account='tiktok:a',time=now-3600000;
 const rows=[{id:'i',account,time,views:2000,mature:false,source:'s',topics:[],completion:.5,variant:'',style:'s'},{id:'missing',account,time,views:null,mature:false,topics:[]}];
 const input={rows,window:{start:now-8*3600000,end:now+16*3600000,previousStart:now-32*3600000,days:1},now,videosByAccount:new Map([[account,[{id:'v',createTime:time/1000,views:2000}]]])};
 const report=buildOpsFramework({...input,matureOnly:false});
 assert.equal(report.overview.current.n,1);assert.equal(report.overview.current.avgViews,2000);assert.equal(report.overview.current.potentialRate,1);assert.equal(report.overview.observing,1);
 assert.equal(report.accounts.rows[0].totalPosts,1);assert.equal(report.content.sources.length,1);assert.equal(report.overview.daily[0].n,1);
 assert.equal(buildOpsFramework(input).overview.current.n,0);
});
