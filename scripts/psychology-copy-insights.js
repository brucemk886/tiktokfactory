const DAY = 86400000;
const ms = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.parse(v || '') || 0; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const INSIGHT_RULES = { minSample: 5, dropRatio: 0.7, hitLift: 2, launchPosts: 10, recentPosts: 5, burstRatio: 2, declineRatio: 0.5, baselinePosts: 3 };
export const STAGES = { launch: '起号期', stable: '稳定期', burst: '爆发期', decline: '下滑期' };
export const KINDS = { first: '爆款首发', repeatOriginal: '重复 · 原版', rewrite: '改写版本' };
const USE_BUCKETS = [[1, 1, '第1次'], [2, 2, '第2次'], [3, 3, '第3次'], [4, 5, '第4–5次'], [6, 10, '第6–10次'], [11, Infinity, '第11次及以上']];
const POST_BUCKETS = [[1, 3, '第1–3条'], [4, 10, '第4–10条'], [11, 30, '第11–30条'], [31, Infinity, '第31条及以上']];

// Stage from the account's matured views before a post, oldest first.
export function accountStage(views, rules = INSIGHT_RULES) {
  if (views.length < rules.launchPosts) return 'launch';
  const recent = median(views.slice(-rules.recentPosts)), before = Math.max(1, median(views.slice(0, -rules.recentPosts)));
  if (recent >= before * rules.burstRatio) return 'burst';
  if (recent <= before * rules.declineRatio) return 'decline';
  return 'stable';
}

function summarize(rows, rules) {
  const lifts = rows.filter(r => r.lift != null).map(r => r.lift);
  return { n: rows.length, medianViews: median(rows.map(r => r.views)), liftN: lifts.length, medianLift: median(lifts),
    hitRate: lifts.length ? lifts.filter(l => l >= rules.hitLift).length / lifts.length : null };
}
const enough = (s, rules) => s.liftN >= rules.minSample;
const change = (a, b) => a && b && a.medianLift != null && b.medianLift ? a.medianLift / b.medianLift - 1 : null;
const bucket = (list, value) => list.find(([lo, hi]) => value >= lo && value <= hi)[2];

// rows: matured-or-not photo rows from buildContentPerformance (window-limited).
// history: every resolved item that could be an earlier use of the same post, any window.
export function buildCopyInsights({ rows = [], history = [], videosByAccount = new Map(), now = Date.now(), rules = INSIGHT_RULES }) {
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
      .filter(v => v.t).sort((a, b) => a.t - b.t));
  }
  const currentStages = { launch: 0, stable: 0, burst: 0, decline: 0 };
  for (const list of timelines.values()) currentStages[accountStage(list.filter(v => now - v.t >= DAY && Number.isFinite(v.views)).map(v => v.views), rules)]++;

  const samples = [];
  for (const row of rows) {
    if (!row.mature || row.views == null || !row.time) continue;
    const timeline = timelines.get(row.account) || [], prior = timeline.filter(v => v.t < row.time);
    const priorViews = prior.filter(v => row.time - v.t >= DAY && Number.isFinite(v.views)).map(v => v.views);
    const use = uses.get(row.id) || { useIndex: 1, versionIndex: 1, prevStyle: '' };
    const baseline = priorViews.length >= rules.baselinePosts ? median(priorViews) : null;
    const style = row.style && row.style !== 'unknown' ? row.style : '';
    samples.push({ ...use, views: row.views, lift: baseline == null ? null : row.views / Math.max(1, baseline), stage: accountStage(priorViews, rules),
      postIndex: prior.length + 1, rewrite: Boolean(row.variant), source: row.source, style,
      kind: use.useIndex === 1 ? 'first' : row.variant ? 'rewrite' : 'repeatOriginal' });
  }

  const reuse = USE_BUCKETS.map(([lo, hi, label]) => ({ label, ...summarize(samples.filter(s => s.useIndex >= lo && s.useIndex <= hi), rules) }));
  const base = reuse[0], drop = enough(base, rules) ? reuse.slice(1).find(b => enough(b, rules) && b.medianLift <= base.medianLift * rules.dropRatio) : null;
  const repeats = samples.filter(s => s.useIndex > 1);
  const version = { fresh: summarize(repeats.filter(s => s.versionIndex === 1), rules), same: summarize(repeats.filter(s => s.versionIndex > 1), rules) };
  const styled = repeats.filter(s => s.style && s.prevStyle);
  const style = { changed: summarize(styled.filter(s => s.style !== s.prevStyle), rules), same: summarize(styled.filter(s => s.style === s.prevStyle), rules) };
  const hitSources = new Set(samples.filter(s => !s.rewrite && s.lift != null && s.lift >= rules.hitLift).map(s => s.source));
  const rewrite = { original: summarize(samples.filter(s => !s.rewrite), rules), rewrite: summarize(samples.filter(s => s.rewrite), rules),
    hitSources: hitSources.size, hitOriginal: summarize(samples.filter(s => !s.rewrite && hitSources.has(s.source)), rules),
    hitRewrite: summarize(samples.filter(s => s.rewrite && hitSources.has(s.source)), rules) };
  const postIndex = POST_BUCKETS.map(([lo, hi, label]) => ({ label, ...summarize(samples.filter(s => s.postIndex >= lo && s.postIndex <= hi), rules) }));
  const stages = Object.keys(STAGES).map(stage => {
    const inStage = samples.filter(s => s.stage === stage);
    // New accounts rarely have a baseline yet, so launch compares raw views.
    const metric = stage === 'launch' ? 'medianViews' : 'medianLift';
    const kinds = Object.fromEntries(Object.keys(KINDS).map(kind => [kind, summarize(inStage.filter(s => s.kind === kind), rules)]));
    const ready = Object.entries(kinds).filter(([, s]) => (metric === 'medianViews' ? s.n : s.liftN) >= rules.minSample);
    const best = ready.length > 1 ? ready.sort((a, b) => b[1][metric] - a[1][metric])[0][0] : null;
    return { stage, label: STAGES[stage], metric, total: summarize(inStage, rules), kinds, best };
  });

  const findings = [], pct = v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  if (!enough(base, rules)) findings.push(`样本不足：满24小时且有账号基线的作品只有 ${base.liftN} 条（需≥${rules.minSample}），先继续跑。`);
  else if (drop) findings.push(`同一篇爆款用到${drop.label}时，相对账号基线的中位表现比首发低 ${Math.round((1 - drop.medianLift / base.medianLift) * 100)}%，这是明显下滑点。`);
  else {
    const seen = [...reuse].reverse().find(b => b !== base && enough(b, rules));
    findings.push(seen ? `观察到${seen.label}，还没看到重复使用导致的明显下滑（下滑≥${Math.round((1 - rules.dropRatio) * 100)}% 才算）。` : `还没有足够的重复使用样本（第2次及以上需≥${rules.minSample}条），暂时无法判断重复的影响。`);
  }
  const versionDiff = enough(version.fresh, rules) && enough(version.same, rules) ? change(version.fresh, version.same) : null;
  if (versionDiff != null) findings.push(`重复使用时换一个新版本，比沿用用过的版本 ${pct(versionDiff)}。`);
  const styleDiff = enough(style.changed, rules) && enough(style.same, rules) ? change(style.changed, style.same) : null;
  if (styleDiff != null) findings.push(`重复使用时换图文样式，比保持样式 ${pct(styleDiff)}。`);
  if (enough(rewrite.hitRewrite, rules) && enough(rewrite.hitOriginal, rules)) findings.push(`在我们号上爆过的 ${rewrite.hitSources} 篇爆款，改写版的中位表现是原版的 ${Math.round(rewrite.hitRewrite.medianLift / rewrite.hitOriginal.medianLift * 100)}%，爆款率 ${Math.round(rewrite.hitRewrite.hitRate * 100)}%。`);
  for (const s of stages) if (s.best) findings.push(`${s.label}表现最好的是「${KINDS[s.best]}」。`);
  return { rules, sample: { rows: rows.length, mature: samples.length, withLift: samples.filter(s => s.lift != null).length, repeats: repeats.length },
    reuse, dropAt: drop?.label || null, version, style, rewrite, postIndex, stages, currentStages, findings };
}
