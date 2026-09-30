// Shared, read-only classification and allocation policy. Callers own permissions,
// >=72h sample filtering, exact version/style grouping, and source/occupancy claims.
export const POOL_POLICY = Object.freeze({
  version: 'pools-v1',
  maturityHours: 72,
  minAccountSamples: 5,
  minContentSamples: 5,
  minContentAccounts: 5,
  strongViews: 500,
  normalViews: 200,
  diagnosticViews: 50,
  completionBaseline: 0.1187,
  winnerViews: 400,
  contentCompletion: 0.15,
  potentialMinViews: 50,
  diagnosticMaxTests: 6,
});

export const ACCOUNT_POOLS = Object.freeze({
  strong: Object.freeze({ id: 'strong', label: '强号池', action: '优胜内容保产出，少量验证优化和新内容' }),
  normal: Object.freeze({ id: 'normal', label: '中号池', action: '增加优胜内容，验证适合该账号的版本' }),
  'rescue-hook': Object.freeze({ id: 'rescue-hook', label: '低号救援 · 首图', action: '优胜内容作基准，单独测试首图或标题' }),
  'rescue-content': Object.freeze({ id: 'rescue-content', label: '低号救援 · 内页', action: '优胜内容作基准，分轮改善内页表达和页序' }),
  diagnostic: Object.freeze({ id: 'diagnostic', label: '近零诊断池', action: '先检查状态、可见性和回执，再做最多六条基准测试' }),
  observing: Object.freeze({ id: 'observing', label: '待观察池', action: '成熟样本不足，先积累基准数据' }),
});

export const CONTENT_POOLS = Object.freeze({
  winner: Object.freeze({ id: 'winner', label: '优胜池', action: '作为保产出与低号救援基准' }),
  optimize: Object.freeze({ id: 'optimize', label: '优化池', action: '触达较好，单独改善留存' }),
  potential: Object.freeze({ id: 'potential', label: '潜力验证池', action: '在中强账号少量验证触达' }),
  explore: Object.freeze({ id: 'explore', label: '新内容 / 待验证池', action: '样本、精确版本样式或有效曝光尚不足' }),
  revise: Object.freeze({ id: 'revise', label: '待修订池', action: '改善版本后重新验证，暂不承担救援' }),
});

const metric = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const policyFor = options => ({ ...POOL_POLICY, ...(options?.policy || {}) });
const completionFor = stats => {
  const value = metric(stats?.completion);
  return value !== null && value <= 1 ? value : null;
};

// The median sets an observable traffic tier; it is not a platform weight score.
// An isolated viral post raising avgViews never promotes an account.
export function classifyAccountPool(stats = {}, options = {}) {
  const policy = policyFor(options), n = metric(stats.n), views = metric(stats.medianViews);
  if (n === null || n < policy.minAccountSamples || views === null) return 'observing';
  if (views >= policy.strongViews) return 'strong';
  if (views >= policy.normalViews) return 'normal';
  if (views < policy.diagnosticViews) return 'diagnostic';
  const baseline = metric(options.completionBaseline) ?? policy.completionBaseline;
  const completion = completionFor(stats);
  return completion !== null && completion >= baseline ? 'rescue-hook' : 'rescue-content';
}

// stats must represent ONE exact version + style, with distinct account count.
// Unknown historical metadata cannot be promoted from aggregate source results.
export function classifyContentPool(stats = {}, options = {}) {
  const policy = policyFor(options), n = metric(stats.n), accounts = metric(stats.accounts);
  const views = metric(stats.medianViews), completion = completionFor(stats);
  if (stats.versionKnown !== true || stats.styleKnown !== true || n === null || n < policy.minContentSamples
    || accounts === null || accounts < policy.minContentAccounts || views === null || completion === null) return 'explore';
  if (views >= policy.winnerViews) return completion >= policy.contentCompletion ? 'winner' : 'optimize';
  if (completion >= policy.contentCompletion) return views >= policy.potentialMinViews ? 'potential' : 'explore';
  return 'revise';
}

const WEEKLY_BASE = Object.freeze({
  strong: Object.freeze({ winner: 12, optimize: 1, explore: 1 }),
  normal: Object.freeze({ winner: 10, optimize: 3, explore: 1 }),
  'rescue-hook': Object.freeze({ winner: 11, optimize: 3, explore: 0 }),
  'rescue-content': Object.freeze({ winner: 11, optimize: 3, explore: 0 }),
  diagnostic: Object.freeze({ winner: 14, optimize: 0, explore: 0 }),
  observing: Object.freeze({ winner: 14, optimize: 0, explore: 0 }),
});
const dailyCount = value => {
  const n = Number(value ?? 2);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new RangeError('postsPerDay must be an integer from 1 to 10');
  return n;
};
const poolIdFor = value => Object.hasOwn(ACCOUNT_POOLS, value) ? value : 'observing';

// Quotas scale by largest remainder while preserving exactly seven daily slots.
// diagnosticMaxTests is a review boundary, never an instruction to pause/ban.
export function poolQuota(accountPool, { postsPerDay = 2 } = {}) {
  const pool = poolIdFor(accountPool), total = dailyCount(postsPerDay) * 7, base = WEEKLY_BASE[pool];
  const keys = ['winner', 'optimize', 'explore'];
  const raw = keys.map(key => ({ key, exact: base[key] * total / 14 }));
  const quota = Object.fromEntries(raw.map(row => [row.key, Math.floor(row.exact)]));
  let remaining = total - keys.reduce((sum, key) => sum + quota[key], 0);
  for (const row of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1) || keys.indexOf(a.key) - keys.indexOf(b.key))) {
    if (remaining-- > 0) quota[row.key]++;
  }
  return { ...quota, total, diagnosticMaxTests: pool === 'diagnostic' ? POOL_POLICY.diagnosticMaxTests : null };
}

const hash = value => {
  let h = 2166136261;
  for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const modulo = (n, base) => ((n % base) + base) % base;

// dayIndex and round are zero-based. Optimizations/exploration are spread across
// the week and alternate rounds; at two posts/day every day retains a baseline.
// The same seed gives paired scheduling independent of group-specific time.
export function desiredContentPool({ accountPool, dayIndex = 0, round = 0, postsPerDay = 2, seed = '' } = {}) {
  const count = dailyCount(postsPerDay);
  if (!Number.isInteger(dayIndex) || !Number.isInteger(round) || round < 0 || round >= count) throw new RangeError('dayIndex and round must be valid zero-based integers');
  const quota = poolQuota(accountPool, { postsPerDay: count }), schedule = Array(quota.total).fill('winner');
  const extra = quota.optimize + quota.explore;
  const offset = seed === '' ? 0 : hash(seed), dayOffset = offset % 7, roundOffset = Math.floor(offset / 7) % count;
  for (let i = 0; i < extra; i++) {
    const day = modulo(Math.floor((i + 0.5) * 7 / extra) + dayOffset, 7);
    const slotRound = (i + roundOffset) % count;
    const pool = Math.floor((i + 1) * quota.explore / extra) > Math.floor(i * quota.explore / extra) ? 'explore' : 'optimize';
    schedule[day * count + slotRound] = pool;
  }
  return schedule[modulo(dayIndex, 7) * count + round];
}

const candidateStats = candidate => candidate.stats || candidate.performance || candidate;
const candidatePool = (candidate, options) => {
  const supplied = candidate.contentPool || candidate.pool;
  return Object.hasOwn(CONTENT_POOLS, supplied) ? supplied : classifyContentPool(candidateStats(candidate), options);
};
const candidateKey = candidate => [candidate.key ?? candidate.id ?? candidate.versionId ?? candidate.variantId ?? '', candidate.styleId ?? candidate.style ?? '', candidate.sourceKey ?? candidate.source ?? ''].join('|');

// Rank ONLY already-eligible candidates. This never relaxes source reuse, live
// version occupancy, enabled/reviewed state, permissions or publishing guards.
// optimize slots on stable accounts may verify potential content. Low accounts
// cannot receive cold exploration or low-reach potential candidates as fallback.
export function rankPoolCandidates(candidates = [], accountPool, options = {}) {
  const pool = poolIdFor(accountPool), low = pool.startsWith('rescue-') || pool === 'diagnostic';
  const desired = options.desiredPool || desiredContentPool({ accountPool: pool, ...options });
  const desiredKinds = desired === 'optimize' ? ['optimize', 'potential'] : [desired];
  const allowed = pool === 'diagnostic' || pool === 'observing' ? ['winner'] : low ? ['winner', 'optimize'] : ['winner', 'optimize', 'potential', 'explore'];
  if (options.includeRevise === true && !low && pool !== 'observing') allowed.push('revise');
  const preference = [...new Set([...desiredKinds, 'winner', 'optimize', 'potential', 'explore', 'revise'])];
  const score = candidate => {
    const stats = candidateStats(candidate), fit = candidate.accountPoolStats?.[pool];
    return [metric(fit?.medianViews) ?? metric(stats.medianViews) ?? -1, completionFor(fit) ?? completionFor(stats) ?? -1,
      metric(stats.potentialRate) ?? -1, metric(stats.n) ?? -1];
  };
  return candidates.map(candidate => ({ candidate, contentPool: candidatePool(candidate, options), scores: score(candidate) }))
    .filter(row => allowed.includes(row.contentPool))
    .sort((a, b) => {
      const delta = preference.indexOf(a.contentPool) - preference.indexOf(b.contentPool);
      if (delta) return delta;
      for (let i = 0; i < a.scores.length; i++) if (a.scores[i] !== b.scores[i]) return b.scores[i] - a.scores[i];
      return hash(String(options.seed || '') + candidateKey(a.candidate)) - hash(String(options.seed || '') + candidateKey(b.candidate))
        || candidateKey(a.candidate).localeCompare(candidateKey(b.candidate));
    }).map(row => row.candidate);
}
