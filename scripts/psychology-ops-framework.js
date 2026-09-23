// One analysis frame for psychology photo auto-publishing: every number comes
// from auto-published photo posts, bucketed by TikTok publish time, counted
// once they are 24h old. Account stages alone use the account's whole history.
const DAY = 86400000;
const ms = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.parse(v || '') || 0; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const dateKey = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);

// Rough TikTok traffic-pool tiers by absolute views; tune as data comes in.
export const VIEW_TIERS = [
  { id: 'low', label: '低播放', min: 0 }, { id: 'normal', label: '正常', min: 200 }, { id: 'potential', label: '潜力', min: 1000 },
  { id: 'rising', label: '待爆', min: 10000 }, { id: 'small', label: '小爆', min: 100000 }, { id: 'hit', label: '爆款', min: 500000 }, { id: 'big', label: '大爆', min: 2000000 },
];
export const RULES = { minSample: 5, dropRatio: 0.7, potentialViews: 1000, hitViews: 10000, burstViews: 100000, launchPosts: 10, recentPosts: 10, lowViews: 200 };
export const STAGES = { launch: '起号期', normal: '普通账号', potential: '潜力账号', burst: '爆发期' };
export const KINDS = { first: '爆款首发', repeatOriginal: '重复 · 原版', rewrite: '改写版本' };
// Views split at 1000 (潜力); completion split at the period's median.
export const QUADRANTS = {
  star: { label: '好内容 · 好号', action: '加码：多复用这篇和这个版本' },
  hook: { label: '被推了但留不住人', action: '首图有效、内页弱：改内页文案' },
  account: { label: '内容留得住，号没推', action: '号的问题：继续养号或换号' },
  weak: { label: '内容不行', action: '淘汰这个版本或这篇爆款' },
  unknown: { label: '完播率未同步', action: '等数据同步' },
};
// Starting playbook per stage; the stage table checks it against real data.
export const PLAYBOOK = {
  launch: '只发已验证爆款的原版首发，目标提高破千率',
  normal: '原版与改写各半，找适合这个号的方向',
  potential: '优先发表现好的爆款（按表现进化的 70% 部分）',
  burst: '保持节奏，多复用它爆过内容的改写版',
};
const USE_BUCKETS = [[1, 1, '第1次'], [2, 2, '第2次'], [3, 3, '第3次'], [4, 5, '第4–5次'], [6, 10, '第6–10次'], [11, Infinity, '第11次及以上']];
const POST_BUCKETS = [[1, 3, '第1–3条'], [4, 10, '第4–10条'], [11, 30, '第11–30条'], [31, Infinity, '第31条及以上']];

export const viewTier = views => [...VIEW_TIERS].reverse().find(t => views >= t.min).id;

// Stage from an account's matured views, oldest first.
export function accountStage(views, rules = RULES) {
  if (views.length < rules.launchPosts) return 'launch';
  if (views.slice(-rules.recentPosts).some(v => v >= rules.burstViews)) return 'burst';
  return mean(views) >= rules.potentialViews ? 'potential' : 'normal';
}

const positive = (rows, key) => rows.map(r => Number(r[key])).filter(v => Number.isFinite(v) && v > 0);
function summarize(rows, rules = RULES) {
  const tiers = Object.fromEntries(VIEW_TIERS.map(t => [t.id, 0])), quadrants = Object.fromEntries(Object.keys(QUADRANTS).map(k => [k, 0]));
  for (const r of rows) { tiers[viewTier(r.views)]++; if (r.quadrant) quadrants[r.quadrant]++; }
  const share = test => rows.length ? rows.filter(test).length / rows.length : null;
  return { n: rows.length, avgViews: mean(rows.map(r => r.views)), medianViews: median(rows.map(r => r.views)), tiers, quadrants,
    potentialRate: share(r => r.views >= rules.potentialViews), hitRate: share(r => r.views >= rules.hitViews),
    averageWatch: mean(positive(rows, 'averageWatch')), completion: mean(positive(rows, 'completion')),
    likes: mean(positive(rows, 'likes')), comments: mean(positive(rows, 'comments')), shares: mean(positive(rows, 'shares')), saves: mean(positive(rows, 'saves')) };
}
const enough = (s, rules) => s.n >= rules.minSample;
const inBucket = ([lo, hi], v) => v >= lo && v <= hi;
const dominant = counts => Object.entries(counts).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0] || 'unknown';

// rows: buildContentPerformance rows for auto photo items (any batch window).
// history: resolved items (earlier uses of the same post), oldest may predate the window.
export function buildOpsFramework({ rows = [], history = [], videosByAccount = new Map(), accounts = [], window, now = Date.now(), rules = RULES }) {
  const uses = new Map(), perSource = new Map(), perVersion = new Map();
  for (const item of [...history].sort((a, b) => (a.schedule_at - b.schedule_at) || String(a.id).localeCompare(String(b.id)))) {
    const key = item.source_key, versionKey = key + '\u0000' + (item.variant_id || ''), prev = perSource.get(key);
    const useIndex = (prev?.count || 0) + 1, versionIndex = (perVersion.get(versionKey) || 0) + 1;
    uses.set(item.id, { useIndex, versionIndex, prevStyle: prev?.style || '' });
    perSource.set(key, { count: useIndex, style: item.style_id || prev?.style || '' });
    perVersion.set(versionKey, versionIndex);
  }
  const timelines = new Map();
  for (const [account, videos] of videosByAccount) timelines.set(account, (videos || [])
    .map(v => ({ t: ms(v.createTime || v.createdAt || v.create_time), views: Number(v.views ?? v.viewCount ?? v.playCount) }))
    .filter(v => v.t && Number.isFinite(v.views)).sort((a, b) => a.t - b.t));
  const info = new Map(accounts.map(a => [a.schema, { name: a.profile?.username || a.username || a.label || a.schema, group: a.groupName || '' }]));
  const stageAt = (account, time) => accountStage((timelines.get(account) || []).filter(v => v.t < time && time - v.t >= DAY).map(v => v.views), rules);

  const inWindow = t => t >= window.start && t < window.end, inPrevious = t => t >= window.previousStart && t < window.start;
  const posts = rows.filter(r => r.time && (inWindow(r.time) || inPrevious(r.time)));
  const mature = posts.filter(r => r.mature && r.views != null);
  const completionLine = median(positive(mature.filter(r => inWindow(r.time)), 'completion'));
  const samples = mature.map(row => {
    const use = uses.get(row.id) || { useIndex: 1, versionIndex: 1, prevStyle: '' };
    const quadrant = !(row.completion > 0) || completionLine == null ? 'unknown' : (row.views >= rules.potentialViews ? (row.completion >= completionLine ? 'star' : 'hook') : (row.completion >= completionLine ? 'account' : 'weak'));
    return { ...row, ...use, quadrant, stage: stageAt(row.account, row.time), postIndex: (timelines.get(row.account) || []).filter(v => v.t < row.time).length + 1,
      rewrite: Boolean(row.variant), style: row.style && row.style !== 'unknown' ? row.style : '', kind: use.useIndex === 1 ? 'first' : row.variant ? 'rewrite' : 'repeatOriginal' };
  });
  const current = samples.filter(s => inWindow(s.time)), previous = samples.filter(s => inPrevious(s.time));

  // Overview
  const daily = Array.from({ length: window.days }, (_, i) => { const date = dateKey(window.start + i * DAY); return { date, ...summarize(current.filter(s => dateKey(s.time) === date), rules) }; });
  const overview = { current: summarize(current, rules), previous: summarize(previous, rules), daily,
    observing: posts.filter(r => inWindow(r.time) && !(r.mature && r.views != null)).length, completionLine };

  // Accounts: cumulative stage at period start and end, period stats from auto photo posts.
  const endTime = Math.min(now, window.end), stageCounts = { start: {}, end: {} }, transitions = new Map(), accountRows = [];
  for (const key of Object.keys(STAGES)) { stageCounts.start[key] = 0; stageCounts.end[key] = 0; }
  for (const [account, list] of timelines) {
    if (!list.some(v => v.t < endTime)) continue;
    const startStage = list.some(v => v.t < window.start) ? stageAt(account, window.start) : null, endStage = stageAt(account, endTime);
    if (startStage) stageCounts.start[startStage]++;
    stageCounts.end[endStage]++;
    const move = (startStage || 'new') + '>' + endStage;
    transitions.set(move, (transitions.get(move) || 0) + 1);
    const own = current.filter(s => s.account === account), stats = summarize(own, rules), main = dominant(stats.quadrants);
    const rank = { launch: 0, normal: 1, potential: 2, burst: 3 };
    const issue = !own.length ? '本期没有满24小时的自动发布图文'
      : stats.n >= rules.minSample && stats.medianViews < rules.lowViews ? '持续低播放，先查账号状态'
      : startStage && rank[endStage] < rank[startStage] ? '阶段下滑，查最近内容'
      : endStage === 'potential' || endStage === 'burst' ? '潜力号，可以加码'
      : own.length >= 3 && main === 'account' ? '内容完播不错但没推流，偏号的问题'
      : own.length >= 3 && main === 'weak' ? '内容留不住人，换内容方向' : '';
    accountRows.push({ account, ...(info.get(account) || { name: account, group: '' }), startStage, endStage,
      totalPosts: list.filter(v => v.t < endTime && endTime - v.t >= DAY).length, stats, quadrant: main, issue });
  }
  accountRows.sort((a, b) => (b.stats.medianViews ?? -1) - (a.stats.medianViews ?? -1));

  // Content
  const sourceMap = new Map();
  for (const s of current) { const g = sourceMap.get(s.source) || { source: s.source, title: s.title, rows: [] }; g.rows.push(s); sourceMap.set(s.source, g); }
  const sources = [...sourceMap.values()].map(g => {
    const stats = summarize(g.rows, rules);
    return { source: g.source, title: g.title, accounts: new Set(g.rows.map(r => r.account)).size, versions: new Set(g.rows.map(r => r.variant)).size,
      totalUses: perSource.get(g.source)?.count || g.rows.length, stats, quadrant: dominant(stats.quadrants) };
  }).sort((a, b) => (b.stats.medianViews ?? -1) - (a.stats.medianViews ?? -1));
  const reuse = USE_BUCKETS.map(([lo, hi, label]) => ({ label, ...summarize(current.filter(s => inBucket([lo, hi], s.useIndex)), rules) }));
  const base = reuse[0], drop = enough(base, rules) && base.medianViews > 0 ? reuse.slice(1).find(b => enough(b, rules) && b.medianViews <= base.medianViews * rules.dropRatio) : null;
  const repeats = current.filter(s => s.useIndex > 1), styled = repeats.filter(s => s.style && s.prevStyle);
  const hitSources = new Set(current.filter(s => !s.rewrite && s.views >= rules.hitViews).map(s => s.source));
  const content = { sources, reuse, dropAt: drop?.label || null, repeats: repeats.length,
    version: { fresh: summarize(repeats.filter(s => s.versionIndex === 1), rules), same: summarize(repeats.filter(s => s.versionIndex > 1), rules) },
    style: { changed: summarize(styled.filter(s => s.style !== s.prevStyle), rules), same: summarize(styled.filter(s => s.style === s.prevStyle), rules) },
    rewrite: { original: summarize(current.filter(s => !s.rewrite), rules), rewrite: summarize(current.filter(s => s.rewrite), rules), hitSources: hitSources.size,
      hitOriginal: summarize(current.filter(s => !s.rewrite && hitSources.has(s.source)), rules), hitRewrite: summarize(current.filter(s => s.rewrite && hitSources.has(s.source)), rules) },
    postIndex: POST_BUCKETS.map(([lo, hi, label]) => ({ label, ...summarize(current.filter(s => inBucket([lo, hi], s.postIndex)), rules) })) };

  // Strategy: playbook per stage checked against this period's data.
  const stages = Object.keys(STAGES).map(stage => {
    const inStage = current.filter(s => s.stage === stage);
    const kinds = Object.fromEntries(Object.keys(KINDS).map(kind => [kind, summarize(inStage.filter(s => s.kind === kind), rules)]));
    const ready = Object.entries(kinds).filter(([, s]) => enough(s, rules));
    return { stage, label: STAGES[stage], playbook: PLAYBOOK[stage], total: summarize(inStage, rules), kinds,
      best: ready.length > 1 ? ready.sort((a, b) => b[1].medianViews - a[1].medianViews)[0][0] : null };
  });
  const findings = [], pct = v => Math.round(v * 100) + '%', ratio = (a, b) => b.medianViews > 0 ? a.medianViews / b.medianViews : null, o = overview.current;
  if (!enough(o, rules)) findings.push(`样本不足：本期满24小时的自动发布图文只有 ${o.n} 条（需≥${rules.minSample}），先继续跑。`);
  else {
    findings.push(`本期 ${o.n} 条，中位播放 ${Math.round(o.medianViews)}，破千 ${pct(o.potentialRate)}，破万 ${pct(o.hitRate)}` + (enough(overview.previous, rules) ? `；上期破千 ${pct(overview.previous.potentialRate)}。` : '。'));
    const q = o.quadrants, known = o.n - q.unknown;
    if (known >= rules.minSample) {
      const top = Object.entries(q).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1])[0];
      findings.push(`最多的是「${QUADRANTS[top[0]].label}」（${pct(top[1] / known)}）：${QUADRANTS[top[0]].action}。`);
    }
  }
  if (drop) findings.push(`同一篇爆款用到${drop.label}时，中位播放比首发低 ${Math.round((1 - drop.medianViews / base.medianViews) * 100)}%，这是明显下滑点。`);
  else if (repeats.length < rules.minSample) findings.push(`重复使用的样本还不够（${repeats.length} 条），暂时判断不了重复的影响。`);
  const v = content.version, st = content.style, rw = content.rewrite;
  if (enough(v.fresh, rules) && enough(v.same, rules)) findings.push(`重复使用时换新版本的中位播放是沿用旧版本的 ${pct(ratio(v.fresh, v.same))}。`);
  if (enough(st.changed, rules) && enough(st.same, rules)) findings.push(`重复使用时换图文样式的中位播放是保持样式的 ${pct(ratio(st.changed, st.same))}。`);
  if (enough(rw.hitRewrite, rules) && enough(rw.hitOriginal, rules)) findings.push(`破万爆款的改写版中位播放是原版的 ${pct(ratio(rw.hitRewrite, rw.hitOriginal))}，改写版破万率 ${pct(rw.hitRewrite.hitRate)}。`);
  for (const s of stages) if (s.best) findings.push(`${s.label}中位播放最高的是「${KINDS[s.best]}」。`);
  const moved = [...transitions].filter(([k]) => /^(launch|normal)>(potential|burst)$/.test(k)).reduce((n, [, c]) => n + c, 0);
  if (moved) findings.push(`本期有 ${moved} 个号升到潜力账号或爆发期。`);

  return { rules, tiers: VIEW_TIERS, quadrants: QUADRANTS, stageNames: STAGES, kinds: KINDS, overview,
    accounts: { stages: stageCounts, transitions: [...transitions].map(([k, n]) => { const [from, to] = k.split('>'); return { from, to, n }; }), rows: accountRows },
    content, strategy: { stages, findings } };
}
