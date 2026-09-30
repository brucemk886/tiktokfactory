import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PRODUCTION_POLICY, readProductionLoad, readProductionAccountCounts, estimateProductionLead } from './psychology-production-capacity.js';

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const now = Date.parse('2026-10-02T00:00:00Z'), slotAt = now + 12 * HOUR;
const estimate = (load = {}, options = {}) => estimateProductionLead(load, { now, slotAt, owner: 'admin', ...options });
const queued = (id, scheduleAt = slotAt, extra = {}) => ({ id, scheduleAt, owner: 'admin', status: 'queued', availableAt: now + HOUR, ...extra });

function setup(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(new URL(file, dir), 'utf8'));
  const db = { prepare(sql) {
    assert.match(sql.trim(), /^(SELECT|WITH)\b/, 'capacity reader must never mutate data');
    return { args: [], bind(...args) { return { ...this, args }; }, async all() { return { results: sqlite.prepare(sql).all(...this.args) }; } };
  } };
  function insert(table, fields) {
    const keys = Object.keys(fields);
    sqlite.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')').run(...keys.map(key => fields[key]));
  }
  insert('psychology_publish_batches', { id: 'batch', created_by: 'admin', config_json: '{}', created_at: now });
  function job(id, fields = {}) {
    insert('factory_jobs', { id, type: 'psychology', status: 'queued', created_by: 'admin', created_at: now, updated_at: now,
      payload_json: JSON.stringify({ cloudPhotoRender: true, photoAutomation: true }), available_at: now + HOUR, ...fields });
  }
  function group(id, fields = {}) {
    const n = sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_groups').get().n;
    insert('psychology_publish_groups', { id, batch_id: 'batch', ordinal: n, expected_count: 1, ...fields });
  }
  function item(id, jobId = id, fields = {}) {
    insert('psychology_publish_items', { id, batch_id: 'batch', source_id: 'source', job_id: jobId, connection_id: id, schedule_at: slotAt / 1000, ...fields });
  }
  return { sqlite, db, insert, job, group, item };
}

test('conservative forecasts increase for 187 to 287 accounts and include backlog once', () => {
  const first = estimate({}, { accountCount: 187 }), larger = estimate({}, { accountCount: 287 });
  assert.equal(first.leadMs, 150 * MINUTE); assert.equal(larger.leadMs, 180 * MINUTE); assert.equal(larger.requiredLeadMs, 195 * MINUTE); assert.equal(larger.capacityRisk, true);
  assert.equal(first.serviceMs, 5 * MINUTE); assert.equal(first.sampleCount, 0);
  const jobs = Array.from({ length: 100 }, (_, i) => queued('earlier-' + i, slotAt - 2 * HOUR));
  const busy = estimate({ jobs }, { accountCount: 187 });
  assert.equal(busy.leadMs, larger.leadMs); assert.equal(busy.forecastJobs, 187); assert.equal(busy.backlogJobs, 100);
});

test('window boundaries, deduplication and cross-owner forecasts do not double-count queued work', () => {
  const jobs = [queued('own'), queued('own'), queued('other', slotAt, { owner: 'other' }),
    queued('start', slotAt - 90 * MINUTE), queued('end', slotAt + 90 * MINUTE),
    queued('earlier', slotAt - 90 * MINUTE - 1), queued('later', slotAt + 90 * MINUTE + 1),
    queued('active-future', slotAt + 3 * HOUR, { status: 'running' }),
    queued('due-future', slotAt + 3 * HOUR, { availableAt: now }),
    queued('shared', 0), queued('cancelled', slotAt, { status: 'cancelled' })];
  const result = estimate({ jobs }, { accountCount: 187 });
  assert.equal(result.forecastJobs, 188); assert.equal(result.backlogJobs, 4);
  assert.equal(result.accountCount, 187);
  const forecasts = [{ owner: 'admin', slotAt, accountCount: 100 }, { owner: 'admin', slotAt, accountCount: 100 },
    { owner: 'other', slotAt, accountCount: 50 }, { owner: 'far', slotAt: slotAt + 2 * HOUR, accountCount: 10000 }];
  assert.equal(estimate({ jobs, forecasts }, { accountCount: 187 }).forecastJobs, 250);
  assert.equal(estimate({ jobs, accountCounts: { admin: 200, other: 70 } }, { accountCount: 187 }).forecastJobs, 270);
  assert.equal(estimate({ jobs, forecasts: [], accountCounts: { other: 999 } }, { accountCount: 187 }).forecastJobs, 188);
});

test('nearest-rank P95 excludes invalid samples and uses the conservative floor only until 20 samples', () => {
  const low = Array(20).fill(1000);
  assert.equal(estimate({ sampleMs: low }).serviceMs, MINUTE);
  assert.equal(estimate({ sampleMs: low.slice(1) }).serviceMs, 5 * MINUTE);
  const measured = [...Array(18).fill(2 * MINUTE), 6 * MINUTE, 60 * MINUTE];
  assert.equal(estimate({ sampleMs: measured }).serviceMs, 6 * MINUTE);
  assert.equal(estimate({ sampleMs: [10 * MINUTE] }).serviceMs, 10 * MINUTE);
  const invalid = [0, -1, NaN, Infinity, '900000', null, undefined, Number.MAX_SAFE_INTEGER + 1];
  assert.equal(estimate({ sampleMs: [...invalid, ...low] }).sampleCount, 20);
  assert.equal(estimate({ sampleMs: [...Array(200).fill(MINUTE), 100 * MINUTE] }).serviceMs, MINUTE);
});

test('maximum lead retains the uncapped requirement and reports deadline risk without changing slot time', () => {
  const result = estimate({}, { accountCount: 10000 });
  assert.equal(result.leadMs, 3 * HOUR); assert.ok(result.requiredLeadMs > result.leadMs);
  assert.equal(result.capacityRisk, true); assert.equal(result.shortLead, true);
  const near = estimate({}, { accountCount: 187, slotAt: now + HOUR });
  assert.equal(near.shortLead, true); assert.equal(near.capacityRisk, false);
  assert.equal(estimate({}, { slotAt: 0 }).shortLead, false);
  const exact = estimate({}, { slotAt: now + 2 * HOUR }); assert.equal(exact.shortLead, false);
  const huge = estimate({ sampleMs: [Number.MAX_SAFE_INTEGER] }, { accountCount: Number.MAX_SAFE_INTEGER });
  assert.equal(huge.requiredLeadMs, Number.MAX_SAFE_INTEGER); assert.equal(huge.leadMs, 3 * HOUR);
  assert.ok(Number.isFinite(huge.requiredLeadMs));
  assert.equal(estimate({ sampleMs: Array(20).fill(123456) }, { accountCount: 100 }).leadMs % PRODUCTION_POLICY.roundMs, 0);
});

test('invalid caller counts or clocks are rejected instead of creating NaN or negative schedules', async () => {
  for (const accountCount of [-1, 1.5, Infinity, NaN, '187']) assert.throws(() => estimate({}, { accountCount }), /accountCount/);
  for (const value of [-1, Infinity, NaN, '123']) {
    assert.throws(() => estimate({}, { now: value }), /now/);
    assert.throws(() => estimate({}, { slotAt: value }), /slotAt/);
  }
  assert.throws(() => estimate({ forecasts: [{ slotAt, accountCount: NaN }] }), /forecast/);
  assert.throws(() => estimate({ accountCounts: { admin: -1 } }), /accountCounts/);
  await assert.rejects(readProductionLoad({}, Infinity), /now/);
});

test('load reader follows current parent/child link, isolates frozen/ready/cancelled work and includes shared cloud jobs', async t => {
  const f = setup(t);
  f.job('parent', { type: 'psychology-photo-story', payload_json: JSON.stringify({ psychologyAutomation: { cloudPhotoRender: true } }) }); f.item('parent');
  f.job('old-parent', { type: 'psychology-photo-story', payload_json: JSON.stringify({ psychologyAutomation: { cloudPhotoRender: true } }) });
  f.job('child', { payload_json: JSON.stringify({ cloudPhotoRender: true, photoAutomation: true, psychologyAutomation: { id: 'old-parent' } }) }); f.item('old-parent', 'child');
  f.job('shared'); f.job('other-owner', { created_by: 'other', status: 'running' }); f.item('other-owner');
  f.group('frozen', { request_json: '{"items":[]}' }); f.job('frozen'); f.item('frozen', 'frozen', { publish_group_id: 'frozen' });
  f.group('submitting', { status: 'submitting' }); f.job('submitting'); f.item('submitting', 'submitting', { publish_group_id: 'submitting' });
  f.group('received', { response_json: '{"batch":{"id":"remote"}}' }); f.job('received'); f.item('received', 'received', { publish_group_id: 'received' });
  for (const [id, fields, status] of [['ready', { ready_json: '{"item":{}}' }], ['receipt', { receipt_json: '{"batchId":"remote"}' }],
    ['deleted', { deleted_at: 1 }], ['cancelled', {}, 'cancelled'], ['failed', {}, 'failed'], ['done', {}, 'done']]) {
    f.job(id, status ? { status } : {}); f.item(id, id, fields);
  }
  f.job('local', { payload_json: '{}' }); f.item('local');
  f.job('orphan-old-child', { payload_json: '{"cloudPhotoRender":true,"psychologyAutomation":{"id":"old-parent"}}' });
  const before = f.sqlite.prepare('SELECT total_changes() n').get().n;
  const result = await readProductionLoad(f.db, now);
  assert.deepEqual(result.jobs.map(j => j.id).sort(), ['child', 'other-owner', 'parent', 'shared']);
  assert.equal(result.jobs.find(j => j.id === 'child').scheduleAt, slotAt);
  assert.equal(result.jobs.find(j => j.id === 'shared').scheduleAt, 0);
  assert.equal(result.jobs.find(j => j.id === 'other-owner').owner, 'other');
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, before);
});

test('load reader counts more than 1000 pending jobs and samples the most recent 200 valid render services only', async t => {
  const f = setup(t);
  for (let i = 0; i < 1005; i++) f.job('pending-' + i);
  for (let i = 0; i < 205; i++) f.job('sample-' + String(i).padStart(3, '0'), {
    status: 'done', completed_at: now - i, result_json: JSON.stringify({ elapsedMs: i + 1 }),
    created_at: now - 20 * HOUR, claimed_at: now - 100 * MINUTE,
  });
  for (const [id, fields] of [
    ['expired', { completed_at: now - 7 * DAY - 1 }], ['future', { completed_at: now + 1 }],
    ['failed', { status: 'failed' }], ['error', { error: 'synthetic' }],
    ['not-render', { payload_json: '{"cloudPhotoRender":true}' }], ['local', { payload_json: '{"photoAutomation":true}' }],
    ['zero', { result_json: '{"elapsedMs":0}' }], ['string', { result_json: '{"elapsedMs":"123"}' }],
  ]) f.job('invalid-' + id, { status: 'done', completed_at: now, result_json: '{"elapsedMs":999999}', ...fields });
  const result = await readProductionLoad(f.db, now);
  assert.equal(result.jobs.length, 1005); assert.equal(result.sampleCount, 200);
  assert.equal(result.sampleMs[0], 1); assert.equal(result.sampleMs.at(-1), 200);
  assert.equal(estimate(result).serviceMs, MINUTE, 'created/claimed waiting time is not a service-duration sample');
});

test('local account forecasts deduplicate plan/policy memberships, preserve pauses and include future admitted accounts', async t => {
  const f = setup(t);
  function pilot(id, owner = 'admin', fields = {}) {
    f.insert('psychology_autopilots', { id, owner, group_id: id, strategy: 'evolve', slots_json: '[]', status: 'active', ends_at: now + DAY, created_at: now, updated_at: now, ...fields });
  }
  function member(pilotId, id, fields = {}) { f.insert('psychology_autopilot_accounts', { autopilot_id: pilotId, connection_id: id, status: 'active', updated_at: now, ...fields }); }
  function policy(id, owner = 'admin', fields = {}) { f.insert('psychology_task_group_policies', {
    id, project_key: id, owner, enabled: 1, starts_at: now + HOUR, ends_at: now + 7 * DAY, next_review_at: now + 3 * DAY, created_at: now, updated_at: now, ...fields,
  }); }
  function enrolled(policyId, id, fields = {}) { f.insert('psychology_task_group_accounts', {
    policy_id: policyId, connection_id: id, first_seen_at: now, enrolled: 1, updated_at: now, ...fields,
  }); }
  pilot('a'); pilot('b'); member('a', 'duplicate'); member('b', 'duplicate');
  member('a', 'latest-paused'); member('b', 'latest-paused', { status: 'paused', updated_at: now + 1 });
  member('a', 'resumed', { status: 'paused' }); member('b', 'resumed', { updated_at: now + 1 });
  member('a', 'registry-paused');
  policy('policy'); enrolled('policy', 'duplicate'); enrolled('policy', 'new'); enrolled('policy', 'latest-paused');
  enrolled('policy', 'registry-paused', { paused: 1 }); enrolled('policy', 'excluded', { excluded: 1 }); enrolled('policy', 'unenrolled', { enrolled: 0 });
  pilot('expired', 'admin', { ends_at: now }); member('expired', 'expired');
  pilot('paused', 'admin', { status: 'paused' }); member('paused', 'only-paused-plan');
  policy('disabled', 'admin', { enabled: 0 }); enrolled('disabled', 'disabled');
  policy('ended', 'admin', { ends_at: now }); enrolled('ended', 'ended');
  pilot('other', 'other'); member('other', 'duplicate');
  assert.deepEqual(await readProductionAccountCounts(f.db, now), { admin: 3, other: 1 });
});
