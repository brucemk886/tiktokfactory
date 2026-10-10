import {hasPsychologyModule} from './psychology-permissions.js';
import { json, errorJson } from './http.js';
import { toPublicUser } from './auth.js';
import { reportAccountScopeSQL } from './official-report-account-scope.js';
import { ensureModuleProjects, findProjectForModule, userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { ACCOUNT_POOLS, CONTENT_POOLS, POOL_POLICY } from '../../scripts/psychology-pool-policy.js';
import { TASK_GROUP_ROLES } from '../../scripts/psychology-task-group-policy.js';
import { DEFAULT_TIME_ZONE, zonedDate, startOfDay, nextDay, addCalendarDays, zonedEpoch } from '../../scripts/psychology-schedule-time.js';
import { managedStyles } from './psychology-managed-styles.js';
import { librarySource, reviewedSource } from './psychology-copy-source.js';
import { copyIdentity } from './psychology-creative.js';
import { photoCopyKey } from './peer-photo-copy-cache.js';
import { readPublicationTrend, readPoolObservationTrend } from './psychology-pool-observations.js';

const BASE = '/api/psychology-autopilot/dashboard', DAY = 86400000, SIZE = 10;
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const parse = (value, fallback = {}) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
const fields = ['n', 'views', 'avgViews', 'medianViews', 'potentialRate', 'completion', 'completionN'];
const identity = ['source', 'variant', 'style', 'copy_hash', 'style_revision'];
const TRAFFIC_TIERS = Object.freeze({
  strong: { id: 'strong', label: '强流量' }, normal: { id: 'normal', label: '中流量' },
  weak: { id: 'weak', label: '低流量' }, observing: { id: 'observing', label: '待观察' },
});
const trafficFields = ['trafficTier','trafficPublished','trafficSynced','trafficViews','trafficMedian','followers','profileViews','profileDays'];
const joinIdentity = (a, b) => identity.map(k => a + '.' + k + '=' + b + '.' + k).join(' AND ');
const profileURL = username => {
  const handle = String(username || '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9_.]+$/.test(handle) ? 'https://www.tiktok.com/@' + handle : null;
};
const stats = row => Object.fromEntries(fields.map(k => [k, row?.[k] ?? (['n', 'completionN'].includes(k) ? 0 : null)]));
const jsonRows = (sql, columns) => '(SELECT json_group_array(json_object(' + columns.map(k => "'" + k + "'," + k).join(',') + ')) FROM (' + sql + '))';
const paging = (rows, total, page) => ({ rows, total, page, pages: Math.max(1, Math.ceil(total / SIZE)), pageSize: SIZE });

// Same exact frequency median and zero-preserving completion semantics as pool reporting.
function statsCTE(name, input, dimensions = '') {
  const prefix = dimensions ? dimensions + ',' : '', partition = dimensions ? 'PARTITION BY ' + dimensions : '';
  return name + '_counted AS MATERIALIZED (SELECT ' + prefix + `views,count(*) freq,
    sum(CASE WHEN completion>=0 AND completion<=1 THEN completion END) completion_sum,
    count(CASE WHEN completion>=0 AND completion<=1 THEN completion END) completion_n FROM ` + input + ' GROUP BY ' + prefix + 'views),' +
    name + '_ranked AS (SELECT *,sum(freq) OVER (' + partition + ' ORDER BY views) cumulative,sum(freq) OVER (' + partition + ') nn FROM ' + name + '_counted),' +
    name + ' AS (SELECT ' + prefix + `sum(freq) n,sum(views*freq) views,1.0*sum(views*freq)/sum(freq) avgViews,
    (sum(CASE WHEN (nn+1)/2>cumulative-freq AND (nn+1)/2<=cumulative THEN views ELSE 0 END)
    +sum(CASE WHEN (nn+2)/2>cumulative-freq AND (nn+2)/2<=cumulative THEN views ELSE 0 END))/2.0 medianViews,
    1.0*sum(CASE WHEN views>=1000 THEN freq ELSE 0 END)/sum(freq) potentialRate,
    1.0*sum(completion_sum)/nullif(sum(completion_n),0) completion,sum(completion_n) completionN
    FROM ` + name + '_ranked' + (dimensions ? ' GROUP BY ' + dimensions : '') + ')';
}
function accountPoolSQL(alias) {
  const p = POOL_POLICY;
  return `CASE WHEN COALESCE(${alias}.n,0)<${p.minAccountSamples} OR ${alias}.medianViews IS NULL THEN 'observing'
    WHEN ${alias}.medianViews>=${p.strongViews} THEN 'strong' WHEN ${alias}.medianViews>=${p.normalViews} THEN 'normal'
    WHEN ${alias}.medianViews<${p.diagnosticViews} THEN 'diagnostic'
    WHEN ${alias}.completion>=${p.completionBaseline} THEN 'rescue-hook' ELSE 'rescue-content' END`;
}
function contentPoolSQL() {
  const p = POOL_POLICY;
  return `CASE WHEN COALESCE(s.n,0)<${p.minContentSamples} OR m.distinctAccounts<${p.minContentAccounts}
    OR m.source='' OR m.copy_hash='' OR m.style='' OR s.completion IS NULL THEN 'explore'
    WHEN s.medianViews>=${p.winnerViews} AND s.completion>=${p.contentCompletion} THEN 'winner'
    WHEN s.medianViews>=${p.winnerViews} THEN 'optimize'
    WHEN s.medianViews>=${p.potentialMinViews} AND s.completion>=${p.contentCompletion} THEN 'potential'
    WHEN s.medianViews<${p.potentialMinViews} AND s.completion>=${p.contentCompletion} THEN 'explore' ELSE 'revise' END`;
}
export function dashboardWindow(now = Date.now()) {
  const operatingDate = zonedDate(now, DEFAULT_TIME_ZONE), trafficFrom = addCalendarDays(operatingDate, -6);
  const profileTo = operatingDate, profileFrom = addCalendarDays(profileTo, -6);
  return { start: now - 30 * DAY, cutoff: now - POOL_POLICY.maturityHours * 3600000,
    todayStart: startOfDay(now, DEFAULT_TIME_ZONE), todayEnd: nextDay(now, DEFAULT_TIME_ZONE),
    operatingDate, timeZone: DEFAULT_TIME_ZONE, trafficStart: zonedEpoch(trafficFrom,0,0,DEFAULT_TIME_ZONE),
    trafficFrom, trafficTo: operatingDate, profileFrom, profileTo };
}
function requestQuery(url) {
  const p = url.searchParams, view = p.get('view') || 'overview';
  if (!['overview', 'accounts', 'content'].includes(view)) fail('数据视图无效。');
  const accountPool = p.get('accountPool') || '', contentPool = p.get('contentPool') || '', trafficTier = p.get('trafficTier') || '';
  if (accountPool && !ACCOUNT_POOLS[accountPool] || contentPool && !CONTENT_POOLS[contentPool]) fail('池子筛选无效。');
  if (trafficTier && !TRAFFIC_TIERS[trafficTier]) fail('流量筛选无效。');
  const evidencePage = Number(p.get('evidencePage') || 1);
  if (!Number.isInteger(evidencePage) || evidencePage < 1 || evidencePage > 1000000) fail('证据分页参数无效。');
  const page = Number(p.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000000) fail('分页参数无效。');
  const account = p.get('account') ? 'tiktok:' + p.get('account').replace(/^tiktok:/, '') : '';
  const exact = p.has('source');
  const selected = exact ? { source: p.get('source'), variant: p.get('variant') ?? p.get('version') ?? '', style: p.get('style') || '',
    copy_hash: p.get('copyHash') || '', style_revision: Number(p.get('styleRevision') || 0) } : null;
  if (selected && (!selected.source || !Number.isInteger(selected.style_revision) || selected.style_revision < 0)) fail('版本标识无效。');
  return { view, accountPool, contentPool, trafficTier, page, evidencePage, account, selected, q: String(p.get('q') || '').trim().slice(0, 200) };
}
async function scope(db, actor) {
  if (!actor?.username) fail('请先登录。', 401);
  const [userRow, storeRow, directoryRow] = await Promise.all([
    db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(actor.username).first(),
    db.prepare("SELECT value_json FROM factory_kv WHERE key='official-account-groups'").first(),
    db.prepare("SELECT value_json FROM factory_kv WHERE key='psychology-autopilot-account-directory-v1'").first(),
  ]);
  const user = userRow ? toPublicUser(userRow) : null;
  if (!hasPsychologyModule(user,'psychology-autopilot')) fail('没有自动运营权限。', 403);
  const store = ensureModuleProjects(parse(storeRow?.value_json)), project = findProjectForModule(store, 'psychology'), grants = userAllowedGroupIds(user);
  if (!project?.id) fail('心理学项目尚未配置。', 404);
  const groups = store.groups.filter(g => g.projectId === project?.id && (!grants || grants.has(g.id)));
  const directory = parse(directoryRow?.value_json, { accounts: [] });
  const source = directory.fullAccounts || directory.accounts || [];
  const publishing = [...new Set(source.filter(a => !Array.isArray(a.scopes) || a.scopes.includes('video.publish'))
    .map(a => 'tiktok:' + String(a.connectionId || a.id || a.schema || '').replace(/^tiktok:/, '')).filter(k => k !== 'tiktok:'))];
  const policy = await db.prepare('SELECT * FROM psychology_task_group_policies WHERE project_key=?').bind(project.id).first();
  return { user, project, groups, ids: JSON.stringify(groups.map(g => g.id)), publishing, policy };
}
function dashboardCTE() {
  return `${reportAccountScopeSQL},
    settings AS (SELECT ? since,? cutoff,? now,? day_start,? day_end,? policy_id,? active_policy,? traffic_start,? profile_from,? profile_to),
    facts AS MATERIALIZED (SELECT f.*,COALESCE(m.style_revision,CAST(json_extract(j.payload_json,'$.psychologyAutomation.styleDefinition.revision') AS INTEGER),0) style_revision
      FROM allowed a CROSS JOIN ops_task_facts f ON f.account_key=a.account_key
      LEFT JOIN psychology_pool_matches m ON m.item_id=f.id LEFT JOIN factory_jobs j ON j.id=f.id
      WHERE f.media='photo' AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))
      AND (f.published_at>=(SELECT since FROM settings) OR f.schedule_at>=(SELECT since FROM settings))),
    mature AS MATERIALIZED (SELECT * FROM facts WHERE state='published' AND published_at>=(SELECT since FROM settings)
      AND published_at<=(SELECT cutoff FROM settings) AND views IS NOT NULL),
    ${statsCTE('mature_stats', 'mature')},
    ${statsCTE('account_stats', 'mature', 'account_key')},
    traffic_published AS MATERIALIZED (SELECT * FROM facts WHERE state='published'
      AND published_at>=(SELECT traffic_start FROM settings) AND published_at<=(SELECT now FROM settings)),
    traffic_measured AS MATERIALIZED (SELECT * FROM traffic_published WHERE views IS NOT NULL AND views>=0),
    ${statsCTE('traffic_stats', 'traffic_measured', 'account_key')},
    traffic_counts AS (SELECT account_key,count(*) published FROM traffic_published GROUP BY account_key),
    profile_days AS MATERIALIZED (SELECT a.account_key,json_extract(day.value,'$.date') date,
      CASE WHEN json_type(day.value,'$.profileViews')='integer' AND json_extract(day.value,'$.profileViews')>=0
        THEN json_extract(day.value,'$.profileViews') END profileViews,
      row_number() OVER(PARTITION BY a.account_key,json_extract(day.value,'$.date') ORDER BY CAST(day.key AS INTEGER) DESC) rn
      FROM allowed a JOIN official_accounts_latest d ON d.account_key=a.account_key
      CROSS JOIN json_each(CASE WHEN json_type(d.profile_json,'$.insights._daily_traffic.days')='array'
        THEN json_extract(d.profile_json,'$.insights._daily_traffic.days') ELSE '[]' END) day
      WHERE json_extract(day.value,'$.date') BETWEEN (SELECT profile_from FROM settings) AND (SELECT profile_to FROM settings)),
    profile_traffic AS (SELECT account_key,sum(profileViews) profileViews,count(profileViews) profileDays
      FROM profile_days WHERE rn=1 GROUP BY account_key),
    current_roles AS MATERIALIZED (SELECT * FROM (SELECT s.*,row_number() OVER(PARTITION BY connection_id ORDER BY effective_at DESC,revision DESC) rn
      FROM psychology_task_group_snapshots s WHERE policy_id=(SELECT policy_id FROM settings) AND effective_at<=(SELECT now FROM settings)) WHERE rn=1),
    future_roles AS MATERIALIZED (SELECT * FROM (SELECT s.*,row_number() OVER(PARTITION BY connection_id ORDER BY effective_at,revision DESC) rn
      FROM psychology_task_group_snapshots s WHERE policy_id=(SELECT policy_id FROM settings) AND effective_at>(SELECT now FROM settings)) WHERE rn=1),
    latest_states AS MATERIALIZED (SELECT * FROM (SELECT a.connection_id,a.status,p.status pilot_status,
      row_number() OVER(PARTITION BY a.connection_id ORDER BY a.updated_at DESC,p.updated_at DESC,p.id) rn
      FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id
      WHERE p.owner=? AND p.group_id IN (SELECT value FROM json_each(?))) WHERE rn=1),
    sources AS (SELECT account_key,count(DISTINCT nullif(source,'')) sources FROM mature GROUP BY account_key),
    accounts AS MATERIALIZED (SELECT a.account_key,a.current_group,
      COALESCE(NULLIF(json_extract(d.profile_json,'$.username'),''),NULLIF(d.label,''),a.account_key) name,
      json_extract(d.profile_json,'$.username') profileUsername,
      ${fields.map(k => 's.' + k).join(',')},COALESCE(x.sources,0) sources,${accountPoolSQL('s')} pool,
      CASE WHEN COALESCE(ts.n,0)<${POOL_POLICY.minAccountSamples} OR ts.medianViews IS NULL THEN 'observing'
        WHEN ts.medianViews>=${POOL_POLICY.strongViews} THEN 'strong' WHEN ts.medianViews>=${POOL_POLICY.normalViews} THEN 'normal' ELSE 'weak' END trafficTier,
      COALESCE(tc.published,0) trafficPublished,COALESCE(ts.n,0) trafficSynced,ts.views trafficViews,ts.medianViews trafficMedian,
      CASE WHEN json_type(d.profile_json,'$.followers') IN ('integer','real') AND json_extract(d.profile_json,'$.followers')>=0 THEN json_extract(d.profile_json,'$.followers')
        WHEN json_type(d.profile_json,'$.followerCount') IN ('integer','real') AND json_extract(d.profile_json,'$.followerCount')>=0 THEN json_extract(d.profile_json,'$.followerCount') END followers,
      pt.profileViews,COALESCE(pt.profileDays,0) profileDays,
      CASE WHEN (SELECT active_policy FROM settings) THEN c.role END currentRole,
      f.role futureRole,f.effective_at futureEffectiveAt,COALESCE(r.enrolled,0) enrolled,COALESCE(r.excluded,0) excluded,
      COALESCE(l.status='paused' OR l.pilot_status='paused',r.paused,0) paused,COALESCE(r.reason,'') reason,
      a.account_key IN (SELECT value FROM json_each(?)) publishingEligible
      FROM allowed a LEFT JOIN official_accounts_latest d ON d.account_key=a.account_key
      LEFT JOIN account_stats s ON s.account_key=a.account_key LEFT JOIN sources x ON x.account_key=a.account_key
      LEFT JOIN traffic_stats ts ON ts.account_key=a.account_key LEFT JOIN traffic_counts tc ON tc.account_key=a.account_key
      LEFT JOIN profile_traffic pt ON pt.account_key=a.account_key
      LEFT JOIN psychology_task_group_accounts r ON r.policy_id=(SELECT policy_id FROM settings) AND r.connection_id=substr(a.account_key,8)
      LEFT JOIN latest_states l ON l.connection_id=substr(a.account_key,8)
      LEFT JOIN current_roles c ON c.connection_id=substr(a.account_key,8) LEFT JOIN future_roles f ON f.connection_id=substr(a.account_key,8)),
    ${statsCTE('content_stats', 'mature', identity.join(','))},
    content_meta AS MATERIALIZED (SELECT ${identity.join(',')},max(title) title,
      sum(state='published') published,sum(state='pending') reserved,
      sum(state='published' AND published_at>(SELECT cutoff FROM settings)) waiting,
      sum(state='published' AND published_at<=(SELECT cutoff FROM settings) AND views IS NULL) missingMetrics,
      count(DISTINCT CASE WHEN state='published' AND published_at<=(SELECT cutoff FROM settings) AND views IS NOT NULL THEN account_key END) distinctAccounts,
      count(DISTINCT account_key) linkedAccounts,
      count(DISTINCT CASE WHEN account_key IN (SELECT account_key FROM accounts WHERE pool IN ('strong','normal')) THEN account_key END) testingAccounts
      FROM facts WHERE state='pending' OR (state='published' AND published_at>=(SELECT since FROM settings)) GROUP BY ${identity.join(',')}),
    contents AS MATERIALIZED (SELECT m.*,${fields.map(k => 's.' + k).join(',')},${contentPoolSQL()} pool
      FROM content_meta m LEFT JOIN content_stats s ON ${joinIdentity('m', 's')})`;
}
const contentColumns = [...identity, 'title', 'published', 'reserved', 'waiting', 'missingMetrics', 'distinctAccounts', 'linkedAccounts', 'testingAccounts', 'pool', ...fields];
const accountColumns = ['account_key', 'current_group', 'name', 'profileUsername', 'pool', 'sources', 'currentRole', 'futureRole', 'futureEffectiveAt', 'enrolled', 'excluded', 'paused', 'reason', 'publishingEligible', ...fields, ...trafficFields];
const accountRow = row => ({ account: row.account_key, connectionId: row.account_key.slice(7), name: row.name, profileUrl: profileURL(row.profileUsername), groupId: row.current_group,
  pool: row.pool, sources: row.sources, stats: stats(row), currentRole: row.currentRole, currentRoleLabel: TASK_GROUP_ROLES[row.currentRole]?.label || '',
  futureRole: row.futureRole, futureRoleLabel: TASK_GROUP_ROLES[row.futureRole]?.label || '', futureEffectiveAt: row.futureEffectiveAt,
  enrolled: Boolean(row.enrolled && !row.excluded), paused: Boolean(row.paused), reason: row.reason, publishingEligible: Boolean(row.publishingEligible),
  recommendation: ACCOUNT_POOLS[row.pool].action, trafficTier: row.trafficTier,
  traffic: { published: row.trafficPublished, synced: row.trafficSynced, views: row.trafficViews, medianViews: row.trafficMedian },
  followers: row.followers, conversionCandidate: row.followers == null ? null : row.followers>=1000,
  profileTraffic: { views: row.profileViews, days: row.profileDays, expectedDays: 7, timeZone: 'UTC' } });
const contentRow = row => ({ source: row.source, version: row.variant, style: row.style, copyHash: row.copy_hash, styleRevision: row.style_revision,
  title: row.title, pool: row.pool, stats: stats(row), distinctAccounts: row.distinctAccounts, accounts: row.distinctAccounts, linkedAccounts: row.linkedAccounts,
  published: row.published, reserved: row.reserved, waiting: row.waiting, missingMetrics: row.missingMetrics,
  mature: row.n || 0, testingAccounts: row.testingAccounts, missingAccounts: Math.max(0, POOL_POLICY.minContentAccounts - row.distinctAccounts),
  versionKnown: Boolean(row.source && row.copy_hash), styleKnown: Boolean(row.style) });

// Eligibility reuses the exact source builder/hash and current owner style revisions.
// Historical winners remain visible even after edits, disabling or review changes.
async function eligibilityFor(db, owner, contentRows) {
  if (!contentRows.length) return new Map();
  const sources = new Set(contentRows.filter(r => !r.variant).map(r => r.source)), variants = [...new Set(contentRows.map(r => r.variant).filter(Boolean))];
  const [styles, originalKeys, rewrites] = await Promise.all([
    managedStyles(db, owner),
    sources.size ? db.prepare(`SELECT id,source_url FROM psychology_copy_library c WHERE c.status='done' AND c.media_type='photo'
      AND EXISTS(SELECT 1 FROM json_each(?) k WHERE c.id=k.value
        OR (substr(k.value,1,10)='v1:tiktok:' AND (instr(c.source_url,'/photo/'||substr(k.value,11))>0 OR instr(c.source_url,'/video/'||substr(k.value,11))>0))
        OR (substr(k.value,1,7)='v1:url:' AND instr(c.source_url,substr(k.value,8))>0)) ORDER BY c.completed_at,c.id`)
      .bind(JSON.stringify([...sources])).all() : Promise.resolve({results:[]}),
    db.prepare("SELECT * FROM psychology_copy_variants WHERE owner=? AND external_id IN (SELECT value FROM json_each(?))")
      .bind(owner, JSON.stringify(variants)).all(),
  ]);
  const keyed = originalKeys.results.flatMap(r => {
    let key; try { key = photoCopyKey(r.source_url); } catch { key = r.id; }
    return sources.has(key) ? [{ id: r.id, key }] : [];
  });
  const originals = keyed.length ? (await db.prepare('SELECT * FROM psychology_copy_library WHERE id IN (SELECT value FROM json_each(?)) ORDER BY completed_at,id')
    .bind(JSON.stringify(keyed.map(r => r.id))).all()).results : [];
  const byOriginal = new Map(originals.map(r => [keyed.find(k => k.id === r.id)?.key, r]));
  const byRewrite = new Map(rewrites.results.map(r => [r.external_id, r]));
  const byStyle = new Map(styles.map(s => [s.id, s])), copies = new Map(), result = new Map();
  for (const row of contentRows) {
    const key = JSON.stringify(identity.map(k => row[k])), copyKey = JSON.stringify([row.source, row.variant]);
    let reason = '', style = byStyle.get(row.style);
    if (!style?.enabled) reason = '样式未启用或不存在';
    else if (Number(style.revision || 0) !== row.style_revision) reason = '样式修订已改变，须重新验证';
    if (!copies.has(copyKey)) {
      const current = row.variant ? byRewrite.get(row.variant) : byOriginal.get(row.source);
      let hash = null, unavailable = '';
      if (!current || row.variant && (current.source_key !== row.source || !current.enabled || current.deleted_at || current.review_status !== 'approved')) unavailable = '文案未就绪、已禁用或待审核';
      else { try { hash = (await copyIdentity((row.variant ? reviewedSource : librarySource)(current, 'photo').copyVariant)).hash; } catch { unavailable = '当前文案无法生成图文'; } }
      copies.set(copyKey, { hash, unavailable });
    }
    const copy = copies.get(copyKey);
    reason ||= copy.unavailable || (copy.hash !== row.copy_hash ? '文案已修改，当前文本须重新验证' : '');
    const qualificationReason = row.pool === 'winner' ? '成熟证据已达到优胜条件'
      : row.distinctAccounts < POOL_POLICY.minContentAccounts ? '尚缺' + (POOL_POLICY.minContentAccounts - row.distinctAccounts) + '个不同账号的满72小时证据'
      : row.completion == null ? '缺少有效完成率，仍待验证' : '成熟效果尚未达到优胜条件';
    result.set(key, { eligible: !reason, qualificationReason, eligibilityReason: reason || ('当前文本和样式修订可发布；' + qualificationReason) });
  }
  return result;
}
export async function readAutopilotDashboard(db, actor, url, now = Date.now()) {
  const query = requestQuery(url), c = await scope(db, actor), w = dashboardWindow(now), p = c.policy;
  const args = [c.ids, w.start, w.cutoff, now, w.todayStart, w.todayEnd, p?.id || '',
    Number(Boolean(p?.enabled && p.starts_at <= now && p.ends_at > now)), w.trafficStart, w.profileFrom, w.profileTo, c.ids, p?.owner || c.user.username, c.ids, JSON.stringify(c.publishing)];
  const cte = dashboardCTE();
  let filters = '', detail = '', detailArgs = [];
  if (query.view === 'accounts') {
    filters = `(?='' OR pool=?) AND (?='' OR trafficTier=?) AND (?='' OR instr(lower(name||' '||account_key),lower(?))>0) AND (?='' OR account_key=?)`;
    detailArgs = [query.accountPool, query.accountPool, query.trafficTier, query.trafficTier, query.q, query.q, query.account, query.account];
    detail = `,'details',${jsonRows('SELECT * FROM accounts WHERE ' + filters + ' ORDER BY trafficViews DESC,trafficMedian DESC,account_key LIMIT ' + SIZE + ' OFFSET ' + (query.account ? 0 : (query.page - 1) * SIZE), accountColumns)},
      'detailTotal',(SELECT count(*) FROM accounts WHERE ${filters})`;
    detailArgs = [...detailArgs, ...detailArgs];
  } else if (query.view === 'content') {
    filters = `(?='' OR pool=?) AND (?='' OR instr(lower(title||' '||source||' '||variant),lower(?))>0)`;
    detailArgs = [query.contentPool, query.contentPool, query.q, query.q];
    if (query.selected) {
      filters += ' AND ' + identity.map(k => k + '=?').join(' AND ');
      detailArgs.push(...identity.map(k => query.selected[k]));
    }
    detail = `,'details',${jsonRows('SELECT * FROM contents WHERE ' + filters + ' ORDER BY COALESCE(n,0) DESC,medianViews DESC,source,variant,style,copy_hash,style_revision LIMIT ' + SIZE + ' OFFSET ' + (query.selected ? 0 : (query.page - 1) * SIZE), contentColumns)},
      'detailTotal',(SELECT count(*) FROM contents WHERE ${filters})`;
    detailArgs = [...detailArgs, ...detailArgs];
  }
  const sql = cte + ` SELECT json_object(
    'summary',(SELECT json_object('projectAccounts',count(*),'enrolledAccounts',COALESCE(sum(enrolled AND NOT excluded),0),
      'publishingEligibleAccounts',COALESCE(sum(publishingEligible),0),'pausedAccounts',COALESCE(sum(paused),0)) FROM accounts),
    'today',(SELECT json_object('planned',COALESCE(sum(schedule_at>=s.day_start AND schedule_at<s.day_end),0),
      'published',COALESCE(sum(state='published' AND published_at>=s.day_start AND published_at<s.day_end),0),
      'scheduledPublished',COALESCE(sum(state='published' AND schedule_at>=s.day_start AND schedule_at<s.day_end),0),
      'pending',COALESCE(sum(state='pending' AND schedule_at>=s.day_start AND schedule_at<s.day_end),0),
      'failed',COALESCE(sum(state='failed' AND schedule_at>=s.day_start AND schedule_at<s.day_end),0),
      'stopped',COALESCE(sum(state='stopped' AND schedule_at>=s.day_start AND schedule_at<s.day_end),0)) FROM facts CROSS JOIN settings s),
    'mature',${jsonRows('SELECT * FROM mature_stats', fields)},
    'accountPools',${jsonRows('SELECT pool,count(*) accounts FROM accounts GROUP BY pool', ['pool','accounts'])},
    'trafficTiers',${jsonRows('SELECT trafficTier,count(*) accounts FROM accounts GROUP BY trafficTier', ['trafficTier','accounts'])},
    'trafficSummary',(SELECT json_object('published',sum(trafficPublished),'synced',sum(trafficSynced),'views',sum(trafficViews),
      'conversionCandidates',sum(followers>=1000),'followersKnown',count(followers),'profileViews',sum(profileViews),
      'profileCoveredAccounts',sum(profileDays>0)) FROM accounts),
    'contentPools',${jsonRows('SELECT pool,count(*) versions FROM contents GROUP BY pool', ['pool','versions'])},
    'progress',(SELECT json_object('published',COALESCE(sum(published),0),'reserved',COALESCE(sum(reserved),0),'waiting',COALESCE(sum(waiting),0),
      'missingMetrics',COALESCE(sum(missingMetrics),0),'mature',COALESCE(sum(n),0),
      'testingVersions',COALESCE(sum(pool='explore' AND source<>'' AND style<>'' AND copy_hash<>'' AND testingAccounts>0 AND (COALESCE(n,0)<5 OR distinctAccounts<5 OR completion IS NULL)),0)) FROM contents),
    'winners',${jsonRows("SELECT * FROM contents WHERE pool='winner'", contentColumns)}
    ${detail}) payload`;
  const raw = parse((await db.prepare(sql).bind(...args, ...detailArgs).first())?.payload);
  const eligible = await eligibilityFor(db, p?.owner || c.user.username, [...(raw.winners || []), ...(query.view === 'content' ? raw.details || [] : [])]);
  const decorateContent = row => ({ ...contentRow(row), ...eligible.get(JSON.stringify(identity.map(k => row[k]))) });
  const [trend, observations] = await Promise.all([
    readPublicationTrend(db, { groupIds: c.groups.map(g => g.id), now, timeZone: w.timeZone }),
    readPoolObservationTrend(db, { projectId: c.project.id, groupIds: c.groups.map(g => g.id), now, timeZone: w.timeZone }),
  ]);
  const summary = { ...raw.summary, today: raw.today, mature: stats(raw.mature?.[0]),
    winnerVersions: raw.winners?.length || 0,
    eligibleWinnerVersions: (raw.winners || []).filter(r => eligible.get(JSON.stringify(identity.map(k => r[k])))?.eligible).length,
    testingVersions: raw.progress?.testingVersions || 0 };
  const result = { asOf: now, project: c.project, timeZone: w.timeZone, operatingDate: w.operatingDate, window: w,
    policy: p ? { enabled: Boolean(p.enabled), revision: p.revision, startsAt: p.starts_at, endsAt: p.ends_at,
      nextReviewAt: p.next_review_at, cycleDays: 7, reviewDays: 3, timeZone: p.time_zone, admission: 'next-operating-day' } : null,
    summary, trafficSummary: raw.trafficSummary,
    trafficTiers: Object.values(TRAFFIC_TIERS).map(def => ({ ...def, accounts: raw.trafficTiers?.find(r => r.trafficTier === def.id)?.accounts || 0 })),
    trafficPolicy: { minimumSamples: POOL_POLICY.minAccountSamples, strongViews: POOL_POLICY.strongViews, normalViews: POOL_POLICY.normalViews,
      from: w.trafficFrom, to: w.trafficTo, timeZone: w.timeZone, profileFrom: w.profileFrom, profileTo: w.profileTo, profileTimeZone: 'UTC' },
    accountPools: Object.values(ACCOUNT_POOLS).map(def => ({ ...def, accounts: raw.accountPools?.find(r => r.pool === def.id)?.accounts || 0 })),
    contentPools: Object.values(CONTENT_POOLS).map(def => ({ ...def, versions: raw.contentPools?.find(r => r.pool === def.id)?.versions || 0 })),
    contentProgress: raw.progress, readiness: { status: summary.eligibleWinnerVersions ? 'ready' : 'warming',
      winnerVersions: summary.winnerVersions, eligibleWinnerVersions: summary.eligibleWinnerVersions,
      minimumAccounts: POOL_POLICY.minContentAccounts, minimumSamples: POOL_POLICY.minContentSamples,
      nextStep: summary.eligibleWinnerVersions ? '优胜版本可用于保产出与低号基准；继续固定版本补测。' : '固定文本和样式，在中强号补足至少5个不同账号的满72小时样本；旧版证据不继承给修改后的文本和样式。' },
    trend, observations, poolTrend: observations, basis: {
      accounts: '当前权限内项目唯一账号，包含未同步账号。主流量分层取近7个北京发布日的图文作品最新累计播放，无72小时门槛；不足5条有效指标保留待观察。',
      profileTraffic: '主页访问为官方整日日报，换算为北京时间每天08:00至次日08:00，与作品的零点切日口径不同；缺失日期不补零。主页访问不是站内访问或转化。',
      content: '已观察和已排期的具体文本哈希×样式修订；成熟证据至少5条且来自5个不同账号。未观察库存不算已验证内容。',
      today: '今日按北京日历：已发布按实际发布日期，已排按计划发布日期；同批进度使用scheduledPublished。',
      metrics: '72小时是观察门槛，数据为最近同步累计值；缺失为null，真实零保留0。事实投影后台同步前可能短暂滞后。',
      roles: 'currentRole只取已生效且处于启用周期的任务；futureRole是下一次生效角色，界面须标明待生效。'
    } };
  if (query.view === 'accounts') result.details = paging((raw.details || []).map(accountRow), raw.detailTotal || 0, query.page);
  if (query.view === 'content') result.details = paging((raw.details || []).map(decorateContent), raw.detailTotal || 0, query.page);
  if (query.account && query.view === 'accounts') {
    if (!result.details.total) fail('账号不在当前心理学授权范围。', 404);
    const selected = await db.prepare(cte + ` SELECT ${contentColumns.map(k => 'c.' + k).join(',')} FROM contents c
      WHERE EXISTS(SELECT 1 FROM facts f WHERE f.account_key=? AND ${joinIdentity('f','c')})
      ORDER BY COALESCE(c.n,0) DESC,c.source,c.variant,c.style LIMIT 10`).bind(...args, query.account).all();
    const checks = await eligibilityFor(db, p?.owner || c.user.username, selected.results);
    result.matchedVersions = { rows: selected.results.map(r => ({ ...contentRow(r), ...checks.get(JSON.stringify(identity.map(k => r[k]))) })),
      limit: 10, basis: '最多10个关联版本；指标为该精确版本在当前授权范围的全部账号证据。' };
  }
  if (query.selected && query.view === 'content') {
    if (!result.details.total) fail('具体版本不在当前心理学授权范围。', 404);
    const linkedFilter = identity.map(k => 'f.' + k + '=?').join(' AND ');
    const linkedSQL = cte + `,linked AS (SELECT DISTINCT a.* FROM accounts a JOIN facts f ON f.account_key=a.account_key WHERE ${linkedFilter})
      SELECT json_object('rows',${jsonRows('SELECT * FROM linked ORDER BY name,account_key LIMIT 10 OFFSET ' + (query.page - 1) * SIZE, accountColumns)},
        'total',(SELECT count(*) FROM linked)) payload`;
    const linked = parse((await db.prepare(linkedSQL).bind(...args, ...identity.map(k => query.selected[k])).first())?.payload);
    result.linkedAccounts = paging((linked.rows || []).map(accountRow), linked.total || 0, query.page);
    const evidenceSQL = cte + `,evidence AS (SELECT f.id,f.account_key,a.name,f.video_id,f.state,f.published_at,f.schedule_at,
      f.views,f.completion,COALESCE(v.share,'') share,json_extract(d.profile_json,'$.username') handle
      FROM facts f JOIN accounts a ON a.account_key=f.account_key
      LEFT JOIN ops_video_facts v ON v.account_key=f.account_key AND v.video_id=f.video_id
      LEFT JOIN official_accounts_latest d ON d.account_key=f.account_key
      WHERE ${linkedFilter} AND (f.state='pending' OR (f.state='published' AND f.published_at>=(SELECT since FROM settings))))
      SELECT json_object('rows',${jsonRows('SELECT * FROM evidence ORDER BY CASE WHEN state=\'published\' THEN 0 ELSE 1 END,published_at DESC,schedule_at DESC,id LIMIT 10 OFFSET ' + (query.evidencePage - 1) * SIZE,
        ['id','account_key','name','video_id','state','published_at','schedule_at','views','completion','share','handle'])},
        'total',(SELECT count(*) FROM evidence)) payload`;
    const evidence = parse((await db.prepare(evidenceSQL).bind(...args, ...identity.map(k => query.selected[k])).first())?.payload);
    result.evidence = paging((evidence.rows || []).map(row => ({ id: row.id, account: row.account_key, name: row.name,
      videoId: row.video_id, url: row.state === 'published' ? evidenceURL(row) : null,
      publishedAt: row.published_at, scheduledAt: row.schedule_at, views: row.views, completion: row.completion,
      status: row.state !== 'published' ? 'reserved' : row.published_at > w.cutoff ? 'waiting' : row.views == null ? 'missingMetrics' : 'mature' })),
      evidence.total || 0, query.evidencePage);
  }
  return result;
}
function evidenceURL(row) {
  try {
    const url = new URL(row.share);
    if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'))) return url.href;
  } catch {}
  const handle = String(row.handle || '').replace(/^@/, '');
  return /^[A-Za-z0-9_.]+$/.test(handle) && /^\d+$/.test(row.video_id)
    ? 'https://www.tiktok.com/@' + handle + '/photo/' + row.video_id : null;
}
export async function handleAutopilotDashboard(request, env, url, actor, { now = Date.now() } = {}) {
  if (url.pathname !== BASE) return null;
  if (request.method !== 'GET') return errorJson('只支持读取自动运营看板。', 405);
  try { return json(await readAutopilotDashboard(env.DB, actor, url, now)); }
  catch (error) { return errorJson(error.message, error.statusCode || 500); }
}
