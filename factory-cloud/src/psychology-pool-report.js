import { reportAccountScopeSQL } from './official-report-account-scope.js';
import { ensureModuleProjects, findProjectForModule, publicState, userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { ACCOUNT_POOLS, CONTENT_POOLS, POOL_POLICY, poolQuota, classifyAccountPool, classifyContentPool } from '../../scripts/psychology-pool-policy.js';

const PAGE_SIZE = 10;
const DAY = 86400000;
const STAT_COLUMNS = ['n', 'views', 'avgViews', 'medianViews', 'potentialRate', 'completion', 'completionN'];
const pageNumber = value => Math.max(1, Math.min(1000000, Math.floor(Number(value) || 1)));
const blankStats = () => ({ n: 0, views: null, avgViews: null, medianViews: null, potentialRate: null, completion: null, completionN: 0 });
const stats = row => row?.n ? Object.fromEntries(STAT_COLUMNS.map(key => [key, row[key] ?? null])) : blankStats();
const paging = (rows, total, page) => ({ rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE });
const jsonRows = (query, columns) => `(SELECT json_group_array(json_object(${columns.map(column => `'${column}',${column}`).join(',')})) FROM (${query}))`;

// Equal-view frequencies give an exact median without transferring populations
// to the worker. Zero metrics are observations; null metrics stay missing.
function statsCTE(name, input, dimensions) {
  const prefix = dimensions ? dimensions + ',' : '';
  const partition = dimensions ? `PARTITION BY ${dimensions}` : '';
  return `${name}_counted AS MATERIALIZED (
    SELECT ${prefix}views,count(*) freq,sum(CASE WHEN completion>=0 AND completion<=1 THEN completion END) completion_sum,count(CASE WHEN completion>=0 AND completion<=1 THEN completion END) completion_n
    FROM ${input} GROUP BY ${prefix}views),
    ${name}_ranked AS (SELECT *,sum(freq) OVER (${partition} ORDER BY views) cumulative,sum(freq) OVER (${partition}) nn FROM ${name}_counted),
    ${name} AS (SELECT ${prefix}sum(freq) n,sum(views*freq) views,1.0*sum(views*freq)/sum(freq) avgViews,
      (sum(CASE WHEN (nn+1)/2>cumulative-freq AND (nn+1)/2<=cumulative THEN views ELSE 0 END)
       +sum(CASE WHEN (nn+2)/2>cumulative-freq AND (nn+2)/2<=cumulative THEN views ELSE 0 END))/2.0 medianViews,
      1.0*sum(CASE WHEN views>=1000 THEN freq ELSE 0 END)/sum(freq) potentialRate,
      1.0*sum(completion_sum)/nullif(sum(completion_n),0) completion,sum(completion_n) completionN
      FROM ${name}_ranked ${dimensions ? 'GROUP BY ' + dimensions : ''})`;
}
function accountPoolSQL(prefix) {
  const p = POOL_POLICY;
  return `CASE WHEN COALESCE(${prefix}.n,0)<${p.minAccountSamples} OR ${prefix}.medianViews IS NULL THEN 'observing'
    WHEN ${prefix}.medianViews>=${p.strongViews} THEN 'strong'
    WHEN ${prefix}.medianViews>=${p.normalViews} THEN 'normal'
    WHEN ${prefix}.medianViews<${p.diagnosticViews} THEN 'diagnostic'
    WHEN ${prefix}.completion>=${p.completionBaseline} THEN 'rescue-hook' ELSE 'rescue-content' END`;
}
function contentPoolSQL() {
  const p = POOL_POLICY;
  return `CASE WHEN COALESCE(s.n,0)<${p.minContentSamples} OR m.accounts<${p.minContentAccounts}
      OR m.source='' OR m.copy_hash='' OR m.style='' OR s.completion IS NULL THEN 'explore'
    WHEN s.medianViews>=${p.winnerViews} AND s.completion>=${p.contentCompletion} THEN 'winner'
    WHEN s.medianViews>=${p.winnerViews} THEN 'optimize'
    WHEN s.medianViews>=${p.potentialMinViews} AND s.completion>=${p.contentCompletion} THEN 'potential'
    WHEN s.medianViews<${p.potentialMinViews} AND s.completion>=${p.contentCompletion} THEN 'explore'
    ELSE 'revise' END`;
}
const poolLevelSQL = column => `CASE ${column} WHEN 'strong' THEN 3 WHEN 'normal' THEN 2 WHEN 'rescue-hook' THEN 1 WHEN 'rescue-content' THEN 1 WHEN 'diagnostic' THEN 0 ELSE -1 END`;
const identity = 'source,variant,style,copy_hash,style_revision';
const identityJoin = (left, right) => ['source', 'variant', 'style', 'copy_hash', 'style_revision'].map(key => `${left}.${key}=${right}.${key}`).join(' AND ');

/** Read-only account/content matching report. Caller resolves current permissions
 * and supplies authorized group IDs; canonical assignments are re-read in SQL.
 * Only aggregates and one page of rows leave D1. No sync, repair or task writes.
 */
export async function readPoolReport(db, { ids, window, media = 'photo', groups = [], url, now = Date.now() }) {
  if(!['photo','video'].includes(media))throw new Error('内容类型无效。');
  if(!window || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end<=window.start || window.end-window.start>31*DAY)throw new Error('请选择不超过31天的日期范围。');
  const params = url?.searchParams || new URLSearchParams();
  const mode = params.get('mode') || 'summary';
  if (!['summary', 'accounts', 'content', 'matrix'].includes(mode)) throw new Error('账号池与内容池查询类型无效。');
  const accountPool = params.get('accountPool') || '';
  const contentPool = params.get('contentPool') || '';
  if (accountPool && !Object.hasOwn(ACCOUNT_POOLS, accountPool)) throw new Error('账号池筛选无效。');
  if (contentPool && !Object.hasOwn(CONTENT_POOLS, contentPool)) throw new Error('内容池筛选无效。');
  const page = pageNumber(params.get('page'));
  const offset = (page - 1) * PAGE_SIZE;
  const cutoff = now - POOL_POLICY.maturityHours / 24 * DAY;
  const cte = `${reportAccountScopeSQL},
    facts AS MATERIALIZED (SELECT f.*,COALESCE(m.style_revision,CAST(json_extract(j.payload_json,'$.psychologyAutomation.styleDefinition.revision') AS INTEGER),0) style_revision,a.current_group,CASE WHEN f.published_at>=? THEN 'current' ELSE 'previous' END bucket,
      f.published_at<=? mature FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published
      ON f.account_key=a.account_key AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))
      LEFT JOIN psychology_pool_matches m ON m.item_id=f.id LEFT JOIN factory_jobs j ON j.id=f.id
      WHERE f.media=? AND f.published_at>=? AND f.published_at<?),
    valid AS MATERIALIZED (SELECT * FROM facts WHERE state='published' AND views IS NOT NULL),
    current_valid AS MATERIALIZED (SELECT * FROM valid WHERE bucket='current'),
    mature_valid AS MATERIALIZED (SELECT * FROM valid WHERE mature),
    current_mature AS MATERIALIZED (SELECT * FROM mature_valid WHERE bucket='current'),
    populations AS (SELECT v.*,j.value population FROM valid v CROSS JOIN json_each('["current","previous","mature","previousMature"]') j
      WHERE (j.value=v.bucket) OR (j.value='mature' AND v.bucket='current' AND mature) OR (j.value='previousMature' AND v.bucket='previous' AND mature)),
    ${statsCTE('overview_stats', 'populations', 'population')},
    ${statsCTE('account_stats', 'mature_valid', 'account_key,bucket')},
    account_sources AS (SELECT account_key,bucket,count(DISTINCT nullif(source,'')) sources FROM mature_valid GROUP BY account_key,bucket),
    accounts AS MATERIALIZED (SELECT a.account_key,a.current_group,
      COALESCE(json_extract(d.profile_json,'$.username'),d.label,a.account_key) name,
      ${STAT_COLUMNS.map(key => `c.${key} ${key},p.${key} previous_${key}`).join(',')},
      COALESCE(cs.sources,0) sources,COALESCE(ps.sources,0) previousSources,
      ${accountPoolSQL('c')} pool,${accountPoolSQL('p')} previousPool
      FROM allowed a LEFT JOIN official_accounts_latest d ON d.account_key=a.account_key
      LEFT JOIN account_stats c ON c.account_key=a.account_key AND c.bucket='current'
      LEFT JOIN account_stats p ON p.account_key=a.account_key AND p.bucket='previous'
      LEFT JOIN account_sources cs ON cs.account_key=a.account_key AND cs.bucket='current'
      LEFT JOIN account_sources ps ON ps.account_key=a.account_key AND ps.bucket='previous'),
    recovery_rows AS MATERIALIZED (SELECT *,${poolLevelSQL('pool')} currentLevel,${poolLevelSQL('previousPool')} previousLevel,
      n>=6 AND previous_n>=6 AND sources>=3 AND previousSources>=3 comparable FROM accounts),
    ${statsCTE('content_stats', 'current_mature', identity)},
    ${statsCTE('content_cumulative', 'current_valid', identity)},
    content_meta AS (SELECT ${identity},max(title) title,count(DISTINCT account_key) cumulativeAccounts FROM current_valid GROUP BY ${identity}),
    content_mature_meta AS (SELECT ${identity},count(DISTINCT account_key) accounts FROM current_mature GROUP BY ${identity}),
    contents AS MATERIALIZED (SELECT m.*,COALESCE(mm.accounts,0) accounts,
      ${STAT_COLUMNS.map(key => `s.${key} ${key},cs.${key} cumulative_${key}`).join(',')},
      ${contentPoolSQL().replace('m.accounts', 'COALESCE(mm.accounts,0)')} pool,
      m.source<>'' AND m.copy_hash<>'' versionKnown,m.style<>'' styleKnown
      FROM content_meta m LEFT JOIN content_stats s ON ${identityJoin('m', 's')}
      LEFT JOIN content_cumulative cs ON ${identityJoin('m', 'cs')}
      LEFT JOIN content_mature_meta mm ON ${identityJoin('m', 'mm')}),
    matrix_input AS MATERIALIZED (SELECT v.*,a.pool accountPool,c.pool contentPool
      FROM current_mature v JOIN accounts a ON a.account_key=v.account_key JOIN contents c ON ${identityJoin('v', 'c')}),
    ${statsCTE('matrix_stats', 'matrix_input', 'accountPool,contentPool')},
    matrix_meta AS (SELECT accountPool,contentPool,count(DISTINCT account_key) accounts,
      count(DISTINCT json_array(source,variant,style,copy_hash,style_revision)) versions FROM matrix_input GROUP BY accountPool,contentPool),
    allocations AS MATERIALIZED (SELECT f.*,m.account_pool accountPool,m.content_pool contentPool
      FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_schedule
      ON f.account_key=a.account_key AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))
      JOIN psychology_pool_matches m ON m.item_id=f.id
      WHERE f.media=? AND f.schedule_at>=? AND f.schedule_at<?),
    allocation_counts AS (SELECT accountPool,contentPool,count(*) planned,sum(state='published') published,
      sum(state='pending') pending,sum(state='failed') failed,sum(state='stopped') stopped,
      sum(state='published' AND views IS NOT NULL) synced,sum(contentPool='explore') warmup
      FROM allocations GROUP BY accountPool,contentPool),
    ${statsCTE('allocation_stats', "(SELECT * FROM allocations WHERE state='published' AND views IS NOT NULL)", 'accountPool,contentPool')}`;
  const bind = [ids, window.start, cutoff, ids, media, window.previousStart, window.end, ids, media, window.start, window.end];
  let detail = '';
  const detailBindings = [];
  if (mode === 'accounts') {
    detail = `,'detailRows',${jsonRows(`SELECT * FROM accounts WHERE (?='' OR pool=?) ORDER BY CASE pool WHEN 'diagnostic' THEN 0 WHEN 'rescue-content' THEN 1 WHEN 'rescue-hook' THEN 2 WHEN 'observing' THEN 3 ELSE 4 END,medianViews,account_key LIMIT ${PAGE_SIZE} OFFSET ${offset}`, ['account_key', 'current_group', 'name', 'pool', 'previousPool', 'sources', 'previousSources', ...STAT_COLUMNS, ...STAT_COLUMNS.map(key => 'previous_' + key)])},
      'detailTotal',(SELECT count(*) FROM accounts WHERE (?='' OR pool=?))`;
    detailBindings.push(accountPool, accountPool, accountPool, accountPool);
  } else if (mode === 'content') {
    detail = `,'detailRows',${jsonRows(`SELECT * FROM contents WHERE (?='' OR pool=?) ORDER BY medianViews DESC,source,variant,style,copy_hash,style_revision LIMIT ${PAGE_SIZE} OFFSET ${offset}`, ['source', 'variant', 'style', 'copy_hash', 'style_revision', 'title', 'pool', 'versionKnown', 'styleKnown', 'accounts', 'cumulativeAccounts', ...STAT_COLUMNS, ...STAT_COLUMNS.map(key => 'cumulative_' + key)])},
      'detailTotal',(SELECT count(*) FROM contents WHERE (?='' OR pool=?))`;
    detailBindings.push(contentPool, contentPool, contentPool, contentPool);
  } else if (mode === 'matrix') {
    detail = `,'detailRows',${jsonRows(`SELECT s.*,m.title,m.accounts FROM version_matrix_stats s JOIN version_matrix_meta m USING(accountPool,contentPool,source,variant,style,copy_hash,style_revision)
      WHERE (?='' OR accountPool=?) AND (?='' OR contentPool=?) ORDER BY medianViews DESC,source,variant,style,copy_hash,style_revision,accountPool LIMIT ${PAGE_SIZE} OFFSET ${offset}`, ['source', 'variant', 'style', 'copy_hash', 'style_revision', 'title', 'accountPool', 'contentPool', 'accounts', ...STAT_COLUMNS])},
      'detailTotal',(SELECT count(*) FROM version_matrix_stats WHERE (?='' OR accountPool=?) AND (?='' OR contentPool=?))`;
    detailBindings.push(accountPool, accountPool, contentPool, contentPool, accountPool, accountPool, contentPool, contentPool);
  }
  const extraCTE = mode === 'matrix' ? `,${statsCTE('version_matrix_stats', 'matrix_input', 'accountPool,contentPool,' + identity)},
    version_matrix_meta AS (SELECT accountPool,contentPool,${identity},max(title) title,count(DISTINCT account_key) accounts FROM matrix_input GROUP BY accountPool,contentPool,${identity})` : '';
  const query = cte + extraCTE + ` SELECT json_object(
    'overview',${jsonRows('SELECT * FROM overview_stats', ['population', ...STAT_COLUMNS])},
    'accountPools',${jsonRows('SELECT pool,count(*) accounts FROM accounts GROUP BY pool', ['pool', 'accounts'])},
    'contentPools',${jsonRows('SELECT pool,count(*) versions FROM contents GROUP BY pool', ['pool', 'versions'])},
    'allocation',${jsonRows('SELECT c.*,s.views,s.medianViews FROM allocation_counts c LEFT JOIN allocation_stats s USING(accountPool,contentPool)', ['accountPool','contentPool','planned','published','pending','failed','stopped','synced','views','medianViews','warmup'])},
    'matrix',${jsonRows('SELECT * FROM matrix_stats JOIN matrix_meta USING(accountPool,contentPool)', ['accountPool', 'contentPool', 'accounts', 'versions', ...STAT_COLUMNS])},
    'transitions',${jsonRows('SELECT previousPool,pool,count(*) n FROM recovery_rows WHERE comparable GROUP BY previousPool,pool', ['previousPool', 'pool', 'n'])},
    'recovery',(SELECT json_object('comparable',COALESCE(sum(comparable),0),'improved',COALESCE(sum(comparable AND currentLevel>previousLevel),0),
      'declined',COALESCE(sum(comparable AND currentLevel<previousLevel),0),'stable',COALESCE(sum(comparable AND currentLevel=previousLevel),0),
      'insufficient',count(*)-COALESCE(sum(comparable),0)) FROM recovery_rows),
    'coverage',(SELECT json_object('authorizedAccounts',(SELECT count(*) FROM accounts),
      'published',count(*),'synced',count(views),'missingMetrics',count(*)-count(views),
      'matureSynced',COALESCE(sum(mature AND views IS NOT NULL),0),
      'observingAccounts',(SELECT count(*) FROM accounts WHERE pool='observing'),
      'unknownVersions',COALESCE(sum(views IS NOT NULL AND (source='' OR copy_hash='')),0),
      'unknownStyles',COALESCE(sum(views IS NOT NULL AND style=''),0)) FROM facts WHERE bucket='current' AND state='published')
    ${detail}) payload`;
  const raw = await db.prepare(query).bind(...bind, ...detailBindings).first();
  const result = JSON.parse(raw?.payload || '{}');
  const names = new Map(groups.map(group => [group.id, group.name]));
  const winnerVersions = result.contentPools?.find(row => row.pool === 'winner')?.versions || 0;
  const readyVersions = (result.contentPools || []).filter(row => ['winner','optimize','potential'].includes(row.pool)).reduce((total,row) => total+row.versions,0);
  const matching = {
    policy: POOL_POLICY,
    readiness: { status: winnerVersions ? 'ready' : 'warming', winnerVersions, readyVersions,
      nextStep: winnerVersions ? '按账号池匹配已验证的具体版本与样式，并继续保留对照验证。' : '尚无满足严格条件的优胜版本。先在中强号为固定版本、文本和样式补足至少5个不同账号的满72小时样本；来源整体表现只作为验证线索。' },
    accountPools: Object.entries(ACCOUNT_POOLS).map(([id, definition]) => ({ id, ...definition, accounts: result.accountPools?.find(row => row.pool === id)?.accounts || 0, quota: poolQuota(id, { postsPerDay: 2 }) })),
    contentPools: Object.entries(CONTENT_POOLS).map(([id, definition]) => ({ id, ...definition, versions: result.contentPools?.find(row => row.pool === id)?.versions || 0 })),
    overview: Object.fromEntries(['current', 'previous', 'mature', 'previousMature'].map(id => [id, stats(result.overview?.find(row => row.population === id))])),
    coverage: { ...result.coverage, basis: '仅当前授权账号的已观察作品。累计与发布满72小时样本分开；缺失指标不记为0。内容池为已观察版本，包含成熟不足的探索版本，不代表完整可发布库存。' },
    allocation: { total: (result.allocation || []).reduce((total,row) => total+row.planned,0), rows: result.allocation || [], basis: '只统计新策略持久化的真实分配决策，账号池和内容池采用创建时冻结值；按计划发布日期筛选，效果为已同步最新累计指标。任务事实后台同步前可能短暂未计入。' },
    matrix: { kind: 'retrospective', rows: (result.matrix || []).map(row => ({ accountPool: row.accountPool, contentPool: row.contentPool, accounts: row.accounts, versions: row.versions, stats: stats(row) })), basis: '历史来源版本×账号池回顾表现；按本期成熟样本回顾分池，存在选择偏差，不能视为池匹配的因果效果。' },
    recovery: { ...result.recovery, transitions: (result.transitions || []).map(row => ({ from: row.previousPool, to: row.pool, n: row.n })), basis: '按单号成熟作品中位播放比较前期与本期，分别至少6条且覆盖3个来源后才计升层；不是平均播放增长。两期均为最新累计指标，未保存精确72小时快照。' },
    basis: '分池基于发布满72小时作品的最近同步累计值；72小时为观察门槛，不是固定72小时指标快照。账号池是可观测流量分层，不代表TikTok内部权重。',
    mode,
  };
  matching.retrospective = matching.matrix;
  if (mode === 'accounts') {
    const rows = (result.detailRows || []).map(row => {
      const current = stats(row);
      const previous = stats(Object.fromEntries(STAT_COLUMNS.map(key => [key, row['previous_' + key]])));
      const comparable = current.n >= 6 && previous.n >= 6 && row.sources >= 3 && row.previousSources >= 3;
      const level = { diagnostic: 0, 'rescue-hook': 1, 'rescue-content': 1, normal: 2, strong: 3, observing: -1 };
      return { account: row.account_key, name: row.name, groupId: row.current_group, group: names.get(row.current_group) || '', pool: row.pool, previousPool: row.previousPool,
        sources: row.sources, previousSources: row.previousSources, stats: current, previousStats: previous,
        medianDelta: current.medianViews !== null && previous.medianViews !== null ? current.medianViews - previous.medianViews : null,
        comparable, improved: comparable ? level[row.pool] > level[row.previousPool] : null, recommendation: ACCOUNT_POOLS[row.pool]?.action || '' };
    });
    matching.accounts = paging(rows, result.detailTotal || 0, page);
  } else if (mode === 'content') {
    matching.content = paging((result.detailRows || []).map(row => ({ source: row.source, version: row.variant, style: row.style, copyHash: row.copy_hash, styleRevision: row.style_revision, title: row.title, pool: row.pool,
      versionKnown: Boolean(row.versionKnown), styleKnown: Boolean(row.styleKnown), accounts: row.accounts, cumulativeAccounts: row.cumulativeAccounts,
      stats: stats(row), cumulativeStats: stats(Object.fromEntries(STAT_COLUMNS.map(key => [key, row['cumulative_' + key]]))) })), result.detailTotal || 0, page);
  } else if (mode === 'matrix') {
    matching.matrixDetails = paging((result.detailRows || []).map(row => ({ source: row.source, version: row.variant, style: row.style, copyHash: row.copy_hash, styleRevision: row.style_revision, title: row.title,
      accountPool: row.accountPool, contentPool: row.contentPool, accounts: row.accounts, stats: stats(row) })), result.detailTotal || 0, page);
  }
  return { matching };
}



export function poolPerformanceKey(value = {}) {
  return JSON.stringify([String(value.source || ''), String(value.variant ?? value.version ?? ''), String(value.style || ''), String(value.copyHash ?? value.copy_hash ?? ''), Number(value.styleRevision ?? value.style_revision ?? value.revision ?? 0)]);
}

// Runtime matching consumes grouped SQL observations only. It rechecks current
// owner/group access rather than trusting a scheduler's cached account list.
export async function readPoolMatchingState(db, user, requestedAccounts = [], now = Date.now()) {
  if(!user)throw new Error('运行时匹配需要当前授权用户。');
  const raw = await db.prepare("SELECT json_object('projects',json_extract(value_json,'$.projects'),'groups',json_extract(value_json,'$.groups')) value_json FROM factory_kv WHERE key='official-account-groups'").first();
  const store = ensureModuleProjects(JSON.parse(raw?.value_json || '{}'));
  const project = findProjectForModule(store, 'psychology');
  const grant = userAllowedGroupIds(user);
  const groups = publicState(store).groups.filter(group => group.projectId === project?.id && (!grant || grant.has(group.id)));
  const ids = JSON.stringify(groups.map(group => group.id));
  const requested = JSON.stringify([...new Set(requestedAccounts.map(value => {
    const key = typeof value === 'string' ? value : value.connectionId || value.id || value.account || value.schema || value.account_key || '';
    return 'tiktok:' + String(key).replace(/^tiktok:/, '');
  }).filter(key => key !== 'tiktok:'))]);
  const cutoff = now - POOL_POLICY.maturityHours / 24 * DAY;
  const cte = `WITH allowed AS MATERIALIZED (SELECT DISTINCT 'tiktok:'||replace(account_key,'tiktok:','') account_key
      FROM official_account_assignments WHERE group_id IN (SELECT value FROM json_each(?))),
    mature AS MATERIALIZED (SELECT f.*,COALESCE(m.style_revision,CAST(json_extract(j.payload_json,'$.psychologyAutomation.styleDefinition.revision') AS INTEGER),0) style_revision FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published
      ON f.account_key=a.account_key AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))
      LEFT JOIN psychology_pool_matches m ON m.item_id=f.id LEFT JOIN factory_jobs j ON j.id=f.id
      WHERE f.media='photo' AND f.published_at>=? AND f.published_at<=? AND f.state='published' AND f.views IS NOT NULL),
    ${statsCTE('account_stats', '(SELECT * FROM mature WHERE account_key IN (SELECT value FROM json_each(?)))', 'account_key')},
    account_sources AS (SELECT account_key,count(DISTINCT nullif(source,'')) sources FROM mature WHERE account_key IN (SELECT value FROM json_each(?)) GROUP BY account_key),
    selected_accounts AS (SELECT a.account_key,s.*,COALESCE(m.sources,0) sources FROM allowed a LEFT JOIN account_stats s ON s.account_key=a.account_key
      LEFT JOIN account_sources m ON m.account_key=a.account_key WHERE a.account_key IN (SELECT value FROM json_each(?))),
    ${statsCTE('version_stats', 'mature', identity)},
    version_meta AS (SELECT ${identity},count(DISTINCT account_key) accounts FROM mature GROUP BY ${identity})
    SELECT json_object('accounts',${jsonRows('SELECT * FROM selected_accounts', ['account_key', 'sources', ...STAT_COLUMNS])},
      'versions',${jsonRows('SELECT * FROM version_stats JOIN version_meta USING(source,variant,style,copy_hash,style_revision)', ['source', 'variant', 'style', 'copy_hash', 'style_revision', 'accounts', ...STAT_COLUMNS])}) payload`;
  const result = JSON.parse((await db.prepare(cte).bind(ids, ids, now - 30 * DAY, cutoff, requested, requested, requested).first())?.payload || '{}');
  const accounts = new Map((result.accounts || []).map(row => {
    const observed = stats(row);
    return [row.account_key, { account: row.account_key, pool: classifyAccountPool(observed), stats: observed, sources: row.sources }];
  }));
  const versions = new Map((result.versions || []).map(row => {
    const observed = { ...stats(row), accounts: row.accounts, versionKnown: row.source !== '' && row.copy_hash !== '', styleKnown: row.style !== '' };
    const version = { source: row.source, version: row.variant, style: row.style, copyHash: row.copy_hash, styleRevision: row.style_revision, accounts: row.accounts,
      versionKnown: observed.versionKnown, styleKnown: observed.styleKnown, pool: classifyContentPool(observed), stats: observed };
    return [poolPerformanceKey(version), version];
  }));
  return { accounts, versions, policy: POOL_POLICY, asOf: now, window: { start: now - 30 * DAY, end: cutoff },
    basis: '当前授权账号30天内发布满72小时的最近同步累计指标；只有聚合观察，没有精确72小时快照。' };
}
