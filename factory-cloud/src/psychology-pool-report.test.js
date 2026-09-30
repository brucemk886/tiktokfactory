import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { handleScalableOperations } from './psychology-report-query.js';
import { readPoolReport, readPoolMatchingState, poolPerformanceKey } from './psychology-pool-report.js';
import { buildModuleReport, loadGroupStore } from './official.js';
import { operationsWindow } from '../../scripts/psychology-operations.js';
import { classifyAccountPool, classifyContentPool } from '../../scripts/psychology-pool-policy.js';
const DAY = 86400000;
const actor = { role: 'admin', sidebarModules: ['psychology-ops-report'] };
function assign(f, keys, group = 'g') {
  for (const key of keys) f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(key, group);
}
function fact(f, id, overrides = {}) {
  const row = { id, batch_id: 'batch', account_key: 'tiktok:a', media: 'photo', schedule_at: Date.now(), published_at: Date.now() - 4 * DAY,
    source: 'source', variant: '', style: 'style', copy_hash: 'hash', title: 'Exact content', state: 'published', views: 100, completion: 0.2, ...overrides };
  const keys = Object.keys(row);
  f.sqlite.prepare(`INSERT INTO ops_task_facts(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
}
async function read(f, query = '', user = actor) {
  const url = new URL('https://factory.test/api/psychology-operations?panel=pools&period=7d&' + query);
  const response = await handleScalableOperations(new Request(url), f.env, url, { user });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.matching;
}

test('pool SQL separates latest cumulative and mature samples, exact medians, zero and missing metrics', async t => {
  const f = await fixture(t), now = Date.now(), window = operationsWindow(new URLSearchParams('period=7d'), now);
  assign(f, ['a', 'b']);
  const time = window.start + DAY;
  [1, 1, 1, 9, 99].forEach((views, i) => fact(f, 'm' + i, { published_at: time, views, completion: [0, null, 0.2, 0.4, 0.6][i] }));
  fact(f, 'fresh', { published_at: now - 1000, views: 9999 });
  fact(f, 'missing', { published_at: time, views: null, completion: null });
  const result = await read(f);
  assert.equal(result.overview.current.n, 6);
  assert.equal(result.overview.current.views, 10110);
  assert.equal(result.overview.mature.n, 5);
  assert.equal(result.overview.mature.medianViews, 1);
  assert.ok(Math.abs(result.overview.mature.completion - 0.3) < 1e-10);
  assert.equal(result.overview.mature.completionN, 4);
  assert.equal(result.coverage.published, 7);
  assert.equal(result.coverage.missingMetrics, 1);
  assert.equal(result.coverage.matureSynced, 5);
  assert.equal(result.accountPools.find(row => row.id === 'diagnostic').accounts, 1);
  assert.equal(result.accountPools.find(row => row.id === 'observing').accounts, 1);
  assert.equal(result.overview.previous.views, null);
  assert.equal(result.readiness.status,'warming');
  assert.equal(result.readiness.winnerVersions,0);
  assert.match(result.readiness.nextStep,/5个不同账号/);
  assert.match(result.basis, /不是固定72小时/);
  assert.equal(f.requests.length, 0);
  f.sqlite.prepare("UPDATE ops_task_facts SET views=NULL WHERE id='m2'").run();
  assert.equal((await read(f)).overview.mature.medianViews, 5);
});

test('account pools use medians and recovery uses per-account tier transitions with sample/source gates', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  assign(f, ['strong', 'hook', 'weak', 'diagnostic', 'observing', 'empty']);
  const setup = [
    ['strong', [400, 700, 900, 10000, 900, 700], 0.2, [100, 120, 90, 5000, 80, 100]],
    ['hook', Array(6).fill(100), 0.2, Array(6).fill(10)],
    ['weak', Array(6).fill(100), 0, Array(6).fill(500)],
    ['diagnostic', Array(6).fill(10), 0.3, Array(6).fill(10)],
    ['observing', Array(4).fill(600), 0.2, Array(6).fill(10)],
  ];
  for (const [key, values, completion, prior] of setup) {
    values.forEach((views, i) => fact(f, key + i, { account_key: 'tiktok:' + key, published_at: window.start + DAY, source: 's' + i % 3, views, completion }));
    prior.forEach((views, i) => fact(f, key + 'p' + i, { account_key: 'tiktok:' + key, published_at: window.previousStart + DAY, source: 's' + i % 3, views, completion }));
  }
  const result = await read(f, 'mode=accounts');
  const row = key => result.accounts.rows.find(row => row.account === 'tiktok:' + key);
  assert.equal(row('strong').pool, 'strong');
  assert.equal(row('strong').stats.medianViews, 800);
  assert.equal(row('strong').improved, true);
  assert.equal(row('hook').pool, 'rescue-hook');
  assert.equal(row('weak').pool, 'rescue-content');
  assert.equal(row('diagnostic').pool, 'diagnostic');
  assert.equal(row('observing').pool, 'observing');
  assert.equal(row('observing').improved, null);
  assert.equal(result.recovery.comparable, 4);
  assert.equal(result.recovery.improved, 2);
  assert.equal(result.recovery.declined, 1);
  assert.equal(result.recovery.insufficient, 2);
  for (const item of result.accounts.rows) assert.equal(item.pool, classifyAccountPool(item.stats));
  const filtered = await read(f, 'mode=accounts&accountPool=rescue-hook');
  assert.equal(filtered.accounts.total, 1);
  assert.equal(filtered.accounts.rows[0].account, 'tiktok:hook');
});

test('content pools and actual matrix preserve exact source/version/style/hash and distinct mature accounts', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  assign(f, ['a', 'b', 'c', 'd', 'e']);
  const cases = [
    ['winner', 800, 0.2, 'style', 'winner-hash'],
    ['optimize', 800, 0.1, 'style', 'optimize-hash'],
    ['potential', 100, 0.2, 'style', 'potential-hash'],
    ['revise', 100, 0, 'style', 'revise-hash'],
    ['unknown', 9999, 0.2, '', ''],
  ];
  for (const [kind, views, completion, style, copy_hash] of cases) {
    ['a', 'b', 'c', 'd', 'e'].forEach((account, i) => fact(f, kind + i, { account_key: 'tiktok:' + account, published_at: window.start + DAY,
      source: 'same-source', variant: kind, views, completion, style, copy_hash }));
  }
  // Same version ID with edited text/style is a separate observation, not a winner.
  fact(f, 'edit', { source: 'same-source', variant: 'winner', style: 'different-style', copy_hash: 'edited-hash', published_at: window.start + DAY, views: 10 });
  fact(f, 'new', { source: 'new-source', published_at: Date.now() - 1000, views: 1200 });
  const result = await read(f, 'mode=content');
  assert.equal(result.content.total, 7);
  const row = variant => result.content.rows.find(row => row.version === variant && row.style === 'style');
  for (const kind of ['winner', 'optimize', 'potential', 'revise']) {
    assert.equal(row(kind).pool, kind);
    assert.equal(row(kind).accounts, 5);
    assert.equal(row(kind).pool, classifyContentPool({ ...row(kind).stats, accounts: row(kind).accounts, versionKnown: row(kind).versionKnown, styleKnown: row(kind).styleKnown }));
  }
  assert.equal(result.content.rows.find(row => row.copyHash === 'edited-hash').pool, 'explore');
  assert.equal(result.content.rows.find(row => row.source === 'new-source').stats.n, 0);
  assert.equal(result.content.rows.find(row => row.source === 'new-source').cumulativeStats.n, 1);
  assert.equal(result.content.rows.find(row => row.version === 'unknown').pool, 'explore');
  assert.equal(result.contentPools.find(row => row.id === 'winner').versions, 1);
  assert.equal(result.readiness.status,'ready');
  assert.equal(result.readiness.readyVersions,3);
  const matrix = await read(f, 'mode=matrix&contentPool=winner');
  assert.equal(matrix.matrixDetails.total, 2);
  assert.equal(matrix.matrixDetails.rows[0].copyHash, 'winner-hash');
  assert.equal(matrix.matrixDetails.rows.reduce((sum, row) => sum + row.stats.n, 0), 5);
  assert.match(matrix.matrix.basis, /选择偏差/);
});

test('pools are exact, paginated, fresh-authorized and all read paths skip remote calls', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  const keys = Array.from({ length: 24 }, (_, i) => 'account' + i);
  assign(f, keys); assign(f, ['outside'], 'other');
  keys.forEach((key, i) => fact(f, 'i' + i, { account_key: 'tiktok:' + key, source: 'source' + i, copy_hash: 'hash' + i, published_at: window.start + DAY }));
  fact(f, 'secret', { account_key: 'tiktok:outside', source: 'private-source', published_at: window.start + DAY, views: 999999 });
  // Pilot group access is independent of current membership.
  fact(f, 'hiddenpilot', { account_key: 'tiktok:account0', pilot_id: 'otherpilot', group_id: 'other', source: 'private-pilot-source', published_at: window.start + DAY, views: 999999 });
  const a = await read(f, 'mode=accounts');
  assert.equal(a.accounts.total, 24); assert.equal(a.accounts.rows.length, 10);
  const b = await read(f, 'mode=accounts&page=3');
  assert.equal(b.accounts.rows.length, 4);
  const c = await read(f, 'mode=content&page=3');
  assert.equal(c.content.total, 24); assert.equal(c.content.rows.length, 4);
  assert.ok(!JSON.stringify(c).includes('private-source'));
  assert.ok(!JSON.stringify(c).includes('private-pilot-source'));
  const none = await read(f, 'mode=content', { ...actor, role: 'operator', allowedAccountGroups: [] });
  assert.equal(none.coverage.authorizedAccounts, 0); assert.equal(none.content.total, 0);
  const noGrant = new URL('https://factory.test/api/psychology-operations?panel=pools&group=other');
  assert.equal((await handleScalableOperations(new Request(noGrant), f.env, noGrant, { user: actor })).status, 403);
  f.sqlite.exec('DELETE FROM official_account_assignments');
  assert.equal((await read(f)).coverage.authorizedAccounts, 0);
  assert.equal(f.requests.length, 0);
});

test('overview rejects the removed pool view before reading report facts', async t => {
  const f = await fixture(t),store = await loadGroupStore(f.db);
  const query = new URLSearchParams({module:'psychology',view:'pools',period:'7d'});
  let reads=0;const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{reads++;return prepare(sql);};
  await assert.rejects(buildModuleReport(f.env,f.db,store,query,{role:'admin'}),error=>error.statusCode===400);
  assert.equal(reads,0);assert.equal(f.requests.length,0);
});

test('runtime matching loads only scoped grouped mature performance with exact candidate keys', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  assign(f, ['a', 'b', 'c', 'd', 'e']); assign(f, ['outside'], 'other');
  for (const key of ['a', 'b', 'c', 'd', 'e']) for (let i = 0; i < 5; i++) fact(f, key + i, { account_key: 'tiktok:' + key, published_at: window.start + DAY, views: 800 });
  fact(f, 'fresh', { account_key: 'tiktok:a', published_at: Date.now() - 1000, views: 999999 });
  fact(f, 'secret', { account_key: 'tiktok:outside', source: 'secret', views: 999999 });
  await assert.rejects(readPoolMatchingState(f.db,null,['a']),/当前授权用户/);
  const state = await readPoolMatchingState(f.db, actor, [{ id: 'a' }, { connectionId: 'b' }, 'outside']);
  assert.equal(state.accounts.size, 2);
  assert.equal(state.accounts.get('tiktok:a').pool, 'strong');
  assert.equal(state.accounts.get('tiktok:a').stats.n, 5);
  const version = state.versions.get(poolPerformanceKey({ source: 'source', variant: '', style: 'style', copy_hash: 'hash' }));
  assert.equal(version.pool, 'winner'); assert.equal(version.accounts, 5); assert.equal(version.stats.n, 25);
  assert.ok(![...state.versions.values()].some(row => row.source === 'secret'));
  f.sqlite.exec('DELETE FROM official_account_assignments');
  const revoked = await readPoolMatchingState(f.db, actor, ['a']);
  assert.equal(revoked.accounts.size, 0); assert.equal(revoked.versions.size, 0);
  assert.equal(f.requests.length, 0);
});


function match(f, id, overrides = {}) {
  const row = { item_id: id, owner: 'admin', connection_id: 'a', account_pool: 'normal', desired_pool: 'winner', content_pool: 'winner',
    source_key: 'source', variant_id: '', style_id: 'style', copy_hash: 'hash', style_revision: 0,
    cycle_start_at: 0, day_index: 0, round: 0, reason: 'Test frozen allocation', created_at: Date.now(), ...overrides };
  const keys = Object.keys(row);
  f.sqlite.prepare(`INSERT INTO psychology_pool_matches(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
}

test('allocation counts frozen decisions by schedule scope, separately from retrospective pools', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  assign(f, ['a']); assign(f, ['outside'], 'other');
  const scheduled = window.start + DAY;
  fact(f, 'published', { schedule_at: scheduled, published_at: scheduled, views: 0 });
  fact(f, 'pending', { schedule_at: scheduled, published_at: 0, state: 'pending', views: null });
  fact(f, 'failed', { schedule_at: scheduled, published_at: 0, state: 'failed', views: null });
  fact(f, 'outside', { schedule_at: scheduled, account_key: 'tiktok:outside' });
  fact(f, 'hidden', { schedule_at: scheduled, pilot_id: 'hidden', group_id: 'other' });
  fact(f, 'future', { schedule_at: window.end, published_at: scheduled });
  for (const id of ['published', 'pending', 'failed', 'outside', 'hidden', 'future']) match(f, id);
  const result = await read(f);
  assert.equal(result.allocation.total, 3);
  assert.deepEqual(result.allocation.rows, [{ accountPool: 'normal', contentPool: 'winner', planned: 3, published: 1, pending: 1, failed: 1, stopped: 0,
    synced: 1, views: 0, medianViews: 0, warmup: 0 }]);
  assert.equal(result.matrix.kind, 'retrospective');
  assert.deepEqual(result.retrospective, result.matrix);
  assert.equal(result.accountPools.find(row => row.id === 'observing').accounts, 1);
  assert.match(result.allocation.basis, /创建时冻结值/);
  f.sqlite.exec('DELETE FROM official_account_assignments');
  assert.equal((await read(f)).allocation.total, 0);
  assert.equal(f.requests.length, 0);
});

test('exact style revisions separate report and runtime effects; frozen match revision wins over job fallback', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  assign(f, ['a', 'b', 'c', 'd', 'e']);
  for (const revision of [0, 1]) for (const account of ['a', 'b', 'c', 'd', 'e']) {
    const id = 'rev' + revision + account;
    fact(f, id, { account_key: 'tiktok:' + account, published_at: window.start + DAY, views: revision ? 100 : 800 });
    f.sqlite.prepare("INSERT INTO factory_jobs(id,type,status,payload_json,created_at,updated_at) VALUES(?,'psychology-photo-story','done',?,0,0)")
      .run(id, JSON.stringify({ psychologyAutomation: { styleDefinition: { revision } } }));
  }
  let result = await read(f, 'mode=content');
  assert.equal(result.content.total, 2);
  assert.equal(result.content.rows.find(row => row.styleRevision === 0).pool, 'winner');
  assert.equal(result.content.rows.find(row => row.styleRevision === 1).pool, 'potential');
  let state = await readPoolMatchingState(f.db, actor, ['a']);
  assert.equal(state.versions.size, 2);
  const key = revision => poolPerformanceKey({ source: 'source', style: 'style', copyHash: 'hash', styleRevision: revision });
  assert.equal(state.versions.get(key(0)).stats.n, 5);
  assert.equal(state.versions.get(key(1)).stats.n, 5);
  match(f, 'rev1a', { style_revision: 2 });
  result = await read(f, 'mode=content');
  assert.equal(result.content.total, 3);
  assert.equal(result.content.rows.find(row => row.styleRevision === 1).stats.n, 4);
  assert.equal(result.content.rows.find(row => row.styleRevision === 1).pool, 'explore');
  state = await readPoolMatchingState(f.db, actor, ['a']);
  assert.equal(state.versions.get(key(2)).stats.n, 1);
  assert.equal(f.requests.length, 0);
});

function reportAliases(f, aliases) {
  f.sqlite.prepare("UPDATE factory_kv SET value_json=json_set(value_json,'$.aliases',json(?)) WHERE key='official-account-groups'")
    .run(JSON.stringify(aliases));
}
function reportAccount(f, key, { username = '', label = '' } = {}) {
  f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,label,profile_json) VALUES(?,?,?)')
    .run('tiktok:' + key, label, JSON.stringify(username ? { username } : {}));
}

test('pool reports count canonical psychology accounts once, including unsynced and legacy direct assignments', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  const synced = '11111111-1111-4111-8111-111111111111';
  const unsynced = '22222222-2222-4222-8222-222222222222';
  const profileOnly = '33333333-3333-4333-8333-333333333333';
  const labelOnly = '44444444-4444-4444-8444-444444444444';
  const outside = '55555555-5555-4555-8555-555555555555';
  assign(f, [synced, 'synced-name', unsynced, 'unsynced-name', profileOnly, '@profile-name', labelOnly, 'tiktok:label-name', 'legacy-unmapped']);
  assign(f, [outside], 'other');
  // Stale alias assignment in psychology cannot override its primary's other-project grant.
  assign(f, ['outside-name']);
  reportAliases(f, { [synced]: synced, 'synced-name': synced, [unsynced]: unsynced, 'unsynced-name': unsynced, 'outside-name': outside });
  reportAccount(f, synced, { username: 'synced-name' });
  // A legacy archive row under the username remains an alias, not another account.
  reportAccount(f, 'synced-name', { label: '@synced-name' });
  reportAccount(f, profileOnly, { username: 'profile-name' });
  reportAccount(f, labelOnly, { label: '@label-name' });
  reportAccount(f, outside, { username: 'outside-name' });
  fact(f, 'synced-post', { account_key: 'tiktok:' + synced, published_at: window.start + DAY, views: 100 });
  fact(f, 'profile-post', { account_key: 'tiktok:' + profileOnly, published_at: window.start + DAY, views: 200 });
  fact(f, 'outside-post', { account_key: 'tiktok:' + outside, published_at: window.start + DAY, source: 'outside-secret', views: 999999 });
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => { assert.doesNotMatch(sql, /official_report_video_cache|official_videos_latest/); return prepare(sql); };
  const changes = f.sqlite.prepare('SELECT total_changes() n').get().n;
  const result = await read(f, 'mode=accounts', { ...actor, role: 'operator', allowedAccountGroups: ['g', 'other'] });
  assert.equal(result.coverage.authorizedAccounts, 5);
  assert.equal(result.accounts.total, 5);
  assert.deepEqual(result.accounts.rows.map(row => row.account).sort(), [synced, unsynced, profileOnly, labelOnly, 'legacy-unmapped'].map(key => 'tiktok:' + key).sort());
  assert.equal(result.accountPools.reduce((total, pool) => total + pool.accounts, 0), 5);
  assert.equal(result.accountPools.find(pool => pool.id === 'observing').accounts, 5);
  assert.equal(result.overview.current.n, 2);
  assert.equal(result.overview.current.views, 300);
  assert.equal(result.coverage.published, 2);
  assert.equal(result.accounts.rows.find(row => row.account === 'tiktok:' + unsynced).stats.n, 0);
  assert.ok(!JSON.stringify(result).includes('outside-secret'));
  const content = await read(f, 'mode=content');
  assert.equal(content.content.rows[0].accounts, 2);
  assert.equal(content.content.rows[0].stats.n, 2);
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, changes);
  assert.equal(f.requests.length, 0);
});

test('canonical primary grants win over stale aliases after group moves, removal and user revocation', async t => {
  const f = await fixture(t), window = operationsWindow(new URLSearchParams('period=7d'));
  assign(f, ['a', 'alpha']);
  reportAliases(f, { a: 'a', alpha: 'a' });
  reportAccount(f, 'a', { username: 'alpha' });
  fact(f, 'visible', { published_at: window.start + DAY, views: 700 });
  match(f, 'visible');
  const operator = { ...actor, role: 'operator', allowedAccountGroups: ['g'] };
  assert.equal((await read(f, 'mode=accounts', operator)).coverage.authorizedAccounts, 1);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
  let result = await read(f, 'mode=accounts', operator);
  assert.equal(result.coverage.authorizedAccounts, 0);
  assert.equal(result.overview.current.n, 0);
  assert.equal(result.allocation.total, 0);
  assert.equal((await read(f, '', { ...operator, allowedAccountGroups: ['g', 'other'] })).coverage.authorizedAccounts, 0);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='g' WHERE account_key='a'").run();
  assert.equal((await read(f, '', { ...operator, allowedAccountGroups: [] })).coverage.authorizedAccounts, 0);
  assert.equal((await read(f, '', operator)).coverage.authorizedAccounts, 1);
  f.sqlite.prepare("DELETE FROM official_account_assignments WHERE account_key='a'").run();
  result = await read(f, 'mode=accounts', operator);
  assert.equal(result.coverage.authorizedAccounts, 0);
  assert.equal(result.accounts.total, 0);
  assert.equal(result.allocation.total, 0);
  // Older alias metadata reconstructed from the profile must not restore the removed primary grant either.
  reportAliases(f, {});
  assert.equal((await read(f, '', operator)).coverage.authorizedAccounts, 0);
  assert.equal(f.requests.length, 0);
});
