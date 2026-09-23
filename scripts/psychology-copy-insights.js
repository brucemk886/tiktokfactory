const DAY = 86400000;
const ms = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.parse(v || '') || 0; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

// Rough TikTok traffic-pool tiers by absolute views; tune as data comes in.
export const VIEW_TIERS = [
  { id: 'low', label: '低播放', min: 0 }, { id: 'normal', label: '正常', min: 200 }, { id: 'potential', label: '潜力', min: 1000 },
  { id: 'rising', label: '待爆', min: 10000 }, { id: 'small', label: '小爆', min: 100000 }, { id: 'hit', label: '爆款', min: 500000 }, { id: 'big', label: '大爆', min: 2000000 },
];
export const INSIGHT_RULES = { minSample: 5, dropRatio: 0.7, potentialViews: 1000, hitViews: 10000, burstViews: 100000, launchPosts: 10, recentPosts: 10 };
export const STAGES = { launch: '起号期', normal: '普通账号', potential: '潜力账号', burst: '爆发期' };
export const KINDS = { first: '爆款首发', repeatOriginal: '重复 · 原版', rewrite: '改写版本' };
const USE_BUCKETS = [[1, 1, '第1次'], [2, 2, '第2次'], [3, 3, '第3次'], [4, 5, '第4–5次'], [6, 10, '第6–10次'], [11, Infinity, '第11次及以上']];
const POST_BUCKETS = [[1, 3, '第1–3条'], [4, 10, '第4–10条'], [11, 30, '第11–30条'], [31, Infinity, '第31条及以上']];

export const viewTier = views => [...VIEW_TIERS].reverse().find(t => views >= t.min).id;

// Stage from the account's matured views, oldest first. A potential account has
// at least 10 matured posts averaging 1000+ views; a recent 100k+ post means burst.
export function accountStage(views, rules = INSIGHT_RULES) {
  if (views.length < rules.launchPosts) return 'launch';
  if (views.slice(-rules.recentPosts).some(v => v >= rules.burstViews)) return 'burst';
  return mean(views) >= rules.potentialViews ? 'potential' : 'normal';
}

const positive = (rows, key) => rows.map(r => Number(r[key])).filter(v => Number.isFinite(v) && v > 0);
function summarize(rows, rules) {
  const tiers = Object.fromEntries(VIEW_TIERS.map(t => [t.id, 0]));
  for (const r of rows) tiers[viewTier(r.views)]++;
  const share = test => rows.length ? rows.filter(test).length / rows.length : null;
  return { n: rows.length, avgViews: mean(rows.map(r => r.views)), medianViews: median(rows.map(r => r.views)), tiers,
    potentialRate: share(r => r.views >= rules.potentialViews), hitRate: share(r => r.views >= rules.hitViews),
    averageWatch: mean(positive(rows, 'averageWatch')), completion: mean(positive(rows, 'completion')),
    likes: mean(positive(rows, 'likes')), comments: mean(positive(rows, 'comments')), shares: mean(positive(rows, 'shares')), saves: mean(positive(rows, 'saves')) };
}
const enough = (s, rules) => s.n >= rules.minSample;
const bucketOf = (list, value) => list.find(([lo, hi]) => value >= lo && value <= hi);

// rows: photo rows from buildContentPerformance (window-limited).
// history: every resolved item that could be an earlier use of the same post, any window.
export function buildCopyInsights({ rows = [], history = [], videosByAccount = new Map(), accounts = [], window = null, now = Date.now(), rules = INSIGHT_RULES }) {
  const uses = new Map(), perSource = new Map(), perVersion = new Map();
  for (const item of [...history].sort((a, b) => (a.schedule_at - b.schedule_at) || String(a.id).localeCompare(String(b.id)))) {
    const key = item.source_key, versionKey = key + '\u0000' + (item.variant_id || '');
    const prev = perSource.get(key);
    const useIndex = (prev?.count || 0) + 1, versionIndex = (perVersion.get(versionKey) || 0) + 1;
    uses.set(item.id, { useIndex, versionIndex, prevStyle: prev?.style || '' });
    perSource.set(key, { count: useIndex, style: item.style_id || prev?.style || '' });
    perVersion.set(versionKey, versionIndex);
  }
  const timelines = new Map();
  for (const [account, videos] of videosByAccount) {
    timelines.set(account, (videos || []).map(v => ({ t: ms(v.createTime || v.createdAt || v.create_time), views: Number(v.views ?? v.viewCount ?? v.playCount) }))
      .filter(v => v.t && Number.isFinite(v.views)).sort((a, b) => a.t - b.t));
  }
  const names = new Map(accounts.map(a => [a.schema, a.profile?.username || a.username || a.label || a.schema]));
  const currentStages = Object.fromEntries(Object.keys(STAGES).map(k => [k, 0])), potentialAccounts = [];
  // Account stages for the report period: only posts published inside the window.
  for (const [account, list] of timelines) {
    const views = list.filter(v => now - v.t >= DAY && (!window || (v.t >= window.start && v.t < window.end))).map(v => v.views);
    if (window && !views.length) continue;
    const stage = accountStage(views, rules);
    currentStages[stage]++;
    if (stage === 'potential' || stage === 'burst') potentialAccounts.push({ account, name: names.get(account) || account, stage, posts: views.length, avgViews: mean(views), best: Math.max(...views) });
  }
  potentialAccounts.sort((a, b) => b.avgViews - a.avgViews);

  const samples = [];
  for (const row of rows) {
    if (!row.mature || row.views == null || !row.time) continue;
    const prior = (timelines.get(row.account) || []).filter(v => v.t < row.time);
    const use = uses.get(row.id) || { useIndex: 1, versionIndex: 1, prevStyle: '' };
    samples.push({ ...row, ...use, stage: accountStage(prior.filter(v => row.time - v.t >= DAY).map(v => v.views), rules), postIndex: prior.length + 1,
      rewrite: Boolean(row.variant), style: row.style && row.style !== 'unknown' ? row.style : '',
      kind: use.useIndex === 1 ? 'first' : row.variant ? 'rewrite' : 'repeatOriginal' });
  }

  const overall = summarize(samples, rules);
  const reuse = USE_BUCKETS.map(([lo, hi, label]) => ({ label, ...summarize(samples.filter(s => s.useIndex >= lo && s.useIndex <= hi), rules) }));
  const base = reuse[0], drop = enough(base, rules) && base.medianViews > 0 ? reuse.slice(1).find(b => enough(b, rules) && b.medianViews <= base.medianViews * rules.dropRatio) : null;
  const repeats = samples.filter(s => s.useIndex > 1);
  const version = { fresh: summarize(repeats.filter(s => s.versionIndex === 1), rules), same: summarize(repeats.filter(s => s.versionIndex > 1), rules) };
  const styled = repeats.filter(s => s.style && s.prevStyle);
  const style = { changed: summarize(styled.filter(s => s.style !== s.prevStyle), rules), same: summarize(styled.filter(s => s.style === s.prevStyle), rules) };
  const hitSources = new Set(samples.filter(s => !s.rewrite && s.views >= rules.hitViews).map(s => s.source));
  const rewrite = { original: summarize(samples.filter(s => !s.rewrite), rules), rewrite: summarize(samples.filter(s => s.rewrite), rules),
    hitSources: hitSources.size, hitOriginal: summarize(samples.filter(s => !s.rewrite && hitSources.has(s.source)), rules),
    hitRewrite: summarize(samples.filter(s => s.rewrite && hitSources.has(s.source)), rules) };
  const postIndex = POST_BUCKETS.map(([lo, hi, label]) => ({ label, ...summarize(samples.filter(s => bucketOf([[lo, hi]], s.postIndex)), rules) }));
  const stages = Object.keys(STAGES).map(stage => {
    const inStage = samples.filter(s => s.stage === stage);
    const kinds = Object.fromEntries(Object.keys(KINDS).map(kind => [kind, summarize(inStage.filter(s => s.kind === kind), rules)]));
    const ready = Object.entries(kinds).filter(([, s]) => enough(s, rules));
    const best = ready.length > 1 ? ready.sort((a, b) => b[1].medianViews - a[1].medianViews)[0][0] : null;
    return { stage, label: STAGES[stage], total: summarize(inStage, rules), kinds, best };
  });

  const findings = [], pct = v => Math.round(v * 100) + '%', ratio = (a, b) => b.medianViews > 0 ? a.medianViews / b.medianViews : null;
  if (!enough(overall, rules)) findings.push(`样本不足：满24小时的图文只有 ${overall.n} 条（需≥${rules.minSample}），先继续跑。`);
  else findings.push(`本期满24小时图文 ${overall.n} 条，中位播放 ${Math.round(overall.medianViews)}，破千（潜力及以上）${pct(overall.potentialRate)}，破万（待爆及以上）${pct(overall.hitRate)}。`);
  if (drop) findings.push(`同一篇爆款用到${drop.label}时，中位播放比首发低 ${Math.round((1 - drop.medianViews / base.medianViews) * 100)}%，这是明显下滑点。`);
  else if (enough(base, rules)) {
    const seen = [...reuse].reverse().find(b => b !== base && enough(b, rules));
    findings.push(seen ? `观察到${seen.label}，还没看到重复使用导致的明显下滑（中位播放降≥${Math.round((1 - rules.dropRatio) * 100)}% 才算）。` : `还没有足够的重复使用样本（第2次及以上需≥${rules.minSample}条），暂时无法判断重复的影响。`);
  }
  if (enough(version.fresh, rules) && enough(version.same, rules)) findings.push(`重复使用时换新版本的中位播放是沿用旧版本的 ${pct(ratio(version.fresh, version.same))}。`);
  if (enough(style.changed, rules) && enough(style.same, rules)) findings.push(`重复使用时换图文样式的中位播放是保持样式的 ${pct(ratio(style.changed, style.same))}。`);
  if (enough(rewrite.hitRewrite, rules) && enough(rewrite.hitOriginal, rules)) findings.push(`在我们号上破万的 ${rewrite.hitSources} 篇爆款，改写版中位播放是原版的 ${pct(ratio(rewrite.hitRewrite, rewrite.hitOriginal))}，改写版破万率 ${pct(rewrite.hitRewrite.hitRate)}。`);
  for (const s of stages) if (s.best) findings.push(`${s.label}中位播放最高的是「${KINDS[s.best]}」。`);
  if (potentialAccounts.length) findings.push(`目前有 ${potentialAccounts.length} 个潜力账号（满10条且平均播放破千，或近10条出过10万+）。`);
  return { rules, tiers: VIEW_TIERS, sample: { rows: rows.length, mature: samples.length, repeats: repeats.length }, overall,
    reuse, dropAt: drop?.label || null, version, style, rewrite, postIndex, stages, currentStages, potentialAccounts: potentialAccounts.slice(0, 50), findings };
}
