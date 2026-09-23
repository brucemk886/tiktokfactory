// Autopilot: runs one psychology photo account group on its own. Twice a day it
// pauses accounts that keep failing or stay under 200 views, logs a 7-day
// analysis, and creates library batches for the next day's slots as the owner.
import { json, errorJson, readJson, sha256Hex } from './http.js';
import { kvGet } from './kv.js';
import { loadGroupStore, scopedAnalyticsAccounts } from './official.js';
import { listLatestArchiveAccounts, accountsFromLatestArchive, loadVideosForAccounts } from './official-archive-store.js';
import { publicState, findProjectForModule, userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { operationsWindow, publishOutcome, parseObject } from '../../scripts/psychology-operations.js';
import { assertAutoUser, loadAutoUser, handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { frameworkFor } from './psychology-operations.js';

const BASE = '/api/psychology-autopilot';
const DAY = 86400000, HOUR = 3600000;
export const AUTOPILOT = Object.freeze({
  // Beijing times, roughly US morning, lunch and evening.
  slots: [{ hour: 8, minute: 0 }, { hour: 12, minute: 0 }, { hour: 21, minute: 0 }],
  leadMs: 2 * HOUR, horizonMs: 26 * HOUR, staggerSeconds: 45, maxAccountsPerBatch: 50,
  lowViews: 200, lowPosts: 5, failStreak: 3,
});
export const STRATEGIES = { evolve: 'A · 按表现进化', original: 'B · 只发原版首发', rewrite: 'C · 改写版优先' };
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const ms = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : 0; };
const beijingDate = t => new Date(t + 8 * HOUR).toISOString().slice(0, 10);
const beijingLabel = t => new Date(t + 8 * HOUR).toISOString().slice(5, 16).replace('T', ' ');
const connectionOf = account => String(account.connectionId || String(account.schema || '').replace(/^tiktok:/, ''));
async function uuidFrom(text) { const h = await sha256Hex(text); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }

// Slot times (ms) inside (now+lead, now+horizon], within the pilot's lifetime.
export function dueSlots(pilot, now, slots = JSON.parse(pilot.slots_json)) {
  const out = [];
  for (let d = 0; d < 3; d++) {
    const date = beijingDate(now + d * DAY);
    for (const s of slots) {
      const t = Date.parse(`${date}T${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}:00+08:00`);
      if (t > now + AUTOPILOT.leadMs && t <= now + AUTOPILOT.horizonMs && t < pilot.ends_at && t >= pilot.created_at) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// Accounts to pause: 5 matured posts since the pilot started all under 200
// views, or the last 3 due autopilot items all failed to publish.
export function guardAccounts({ pilot, connectionIds, videosByConnection, outcomesByConnection, now, rules = AUTOPILOT }) {
  const pauses = [];
  for (const id of connectionIds) {
    const recent = (videosByConnection.get(id) || []).map(v => ({ t: ms(v.createTime || v.createdAt), views: Number(v.views) || 0 }))
      .filter(v => v.t >= pilot.created_at && now - v.t >= DAY).sort((a, b) => b.t - a.t).slice(0, rules.lowPosts);
    if (recent.length === rules.lowPosts && recent.every(v => v.views < rules.lowViews)) { pauses.push({ id, reason: `连续${rules.lowPosts}条满24小时播放都低于${rules.lowViews}` }); continue; }
    const last = (outcomesByConnection.get(id) || []).slice(0, rules.failStreak);
    if (last.length === rules.failStreak && last.every(o => o === 'failed')) pauses.push({ id, reason: `连续${rules.failStreak}次发布失败` });
  }
  return pauses;
}

async function log(db, pilotId, kind, message, detail = {}, now = Date.now()) {
  await db.prepare('INSERT INTO psychology_autopilot_log(autopilot_id,kind,message,detail_json,created_at) VALUES(?,?,?,?,?)').bind(pilotId, kind, message, JSON.stringify(detail), now).run();
}

async function groupAccounts(env, user, groupId) {
  const store = await loadGroupStore(env.DB);
  return scopedAnalyticsAccounts(accountsFromLatestArchive(await listLatestArchiveAccounts(env.DB)), store, user, 'psychology').filter(a => a.groupId === groupId);
}

// Latest-first publish outcomes of this pilot's items that should have gone out by now.
async function pilotOutcomes(db, pilotId, now) {
  const items = (await db.prepare(`SELECT i.id,i.connection_id,j.status,json_extract(j.result_json,'$.publishFailed') AS publish_failed
    FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id
    WHERE i.deleted_at=0 AND i.schedule_at<? AND i.batch_id IN (SELECT batch_id FROM psychology_autopilot_slots WHERE autopilot_id=? AND batch_id<>'')
    ORDER BY i.schedule_at DESC LIMIT 2000`).bind(Math.floor((now - 2 * HOUR) / 1000), pilotId).all()).results;
  const records = items.length ? (await db.prepare(`SELECT value_json FROM factory_publish_records WHERE json_extract(value_json,'$.autoTaskId') IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(items.map(i => i.id))).all()).results.map(r => parseObject(r.value_json)) : [];
  const byTask = new Map(records.map(r => [r.autoTaskId, publishOutcome(r)]));
  const out = new Map();
  for (const item of items) {
    const outcome = byTask.get(item.id) || (item.status === 'failed' || Number(item.publish_failed) === 1 ? 'failed' : 'pending');
    if (outcome === 'pending') continue;
    const list = out.get(item.connection_id) || []; list.push(outcome); out.set(item.connection_id, list);
  }
  return out;
}

export async function runAutopilot(env, pilot, now = Date.now()) {
  const db = env.DB, summary = { paused: [], batches: [], errors: [] };
  if (now >= pilot.ends_at) {
    await db.prepare("UPDATE psychology_autopilots SET status='ended',updated_at=? WHERE id=? AND status='active'").bind(now, pilot.id).run();
    await log(db, pilot.id, 'status', '运行期结束，自动运营已停止。', {}, now);
    return { ...summary, ended: true };
  }
  let user;
  try { user = await loadAutoUser(db, pilot.owner); }
  catch {
    await db.prepare("UPDATE psychology_autopilots SET status='paused',updated_at=? WHERE id=?").bind(now, pilot.id).run();
    await log(db, pilot.id, 'status', '启动人账号已停用或没有自动发布权限，自动运营已暂停。', {}, now);
    return summary;
  }
  const accounts = await groupAccounts(env, user, pilot.group_id);
  const ids = accounts.map(connectionOf);
  if (ids.length) await db.prepare(`INSERT OR IGNORE INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at)
    SELECT ?,value,'active','',? FROM json_each(?)`).bind(pilot.id, now, JSON.stringify(ids)).run();
  const states = new Map((await db.prepare('SELECT connection_id,status FROM psychology_autopilot_accounts WHERE autopilot_id=?').bind(pilot.id).all()).results.map(r => [r.connection_id, r.status]));
  const videosByAccount = await loadVideosForAccounts(env, db, accounts.map(a => a.schema), 100);
  const videosByConnection = new Map(accounts.map(a => [connectionOf(a), videosByAccount.get(a.schema) || []]));
  const pauses = guardAccounts({ pilot, connectionIds: ids.filter(id => states.get(id) === 'active'), videosByConnection, outcomesByConnection: await pilotOutcomes(db, pilot.id, now), now });
  const names = new Map(accounts.map(a => [connectionOf(a), a.profile?.username || a.username || a.label || connectionOf(a)]));
  for (const p of pauses) {
    await db.prepare("UPDATE psychology_autopilot_accounts SET status='paused',reason=?,updated_at=? WHERE autopilot_id=? AND connection_id=? AND status='active'").bind(p.reason, now, pilot.id, p.id).run();
    states.set(p.id, 'paused'); summary.paused.push(p.id);
    await log(db, pilot.id, 'pause', `@${names.get(p.id)} 已自动停发：${p.reason}`, { connectionId: p.id }, now);
  }

  // One 7-day analysis per Beijing day, on the same framework as the ops report.
  const dayStart = Date.parse(beijingDate(now) + 'T00:00:00+08:00');
  if (!(await db.prepare("SELECT 1 FROM psychology_autopilot_log WHERE autopilot_id=? AND kind='daily' AND created_at>=?").bind(pilot.id, dayStart).first()) && accounts.length) {
    try {
      const window = operationsWindow(new URLSearchParams({ period: '7d' }), now);
      const { framework } = await frameworkFor(env, { accounts, window, media: 'photo', videosByAccount });
      const o = framework.overview.current, pct = v => v == null ? '—' : Math.round(v * 100) + '%';
      await log(db, pilot.id, 'daily', `近7天 ${o.n} 条满24小时 · 中位播放 ${o.medianViews == null ? '—' : Math.round(o.medianViews)} · 破千 ${pct(o.potentialRate)} · 破万 ${pct(o.hitRate)} · 完播 ${pct(o.completion)}`,
        { overview: o, previous: framework.overview.previous, stages: framework.accounts.stages.end, findings: framework.strategy.findings, observing: framework.overview.observing }, now);
    } catch (error) { await log(db, pilot.id, 'error', '每日分析失败：' + String(error.message || error).slice(0, 300), {}, now); }
  }

  const active = ids.filter(id => states.get(id) === 'active');
  const musicIds = (await kvGet(db, 'psychology-auto-music-pool', [])).filter(id => /^\d{1,30}$/.test(String(id))).slice(0, 100);
  for (const slot of dueSlots(pilot, now)) {
    const claim = await db.prepare(`INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)
      ON CONFLICT(autopilot_id,slot_at) DO UPDATE SET status='creating',detail='',updated_at=excluded.updated_at WHERE status='failed'`).bind(pilot.id, slot, now).run();
    if (!claim.meta?.changes) continue;
    if (!active.length) {
      await db.prepare("UPDATE psychology_autopilot_slots SET status='skipped',detail='没有可发布的账号' WHERE autopilot_id=? AND slot_at=?").bind(pilot.id, slot).run();
      continue;
    }
    const batchIds = [], errors = [];
    for (let offset = 0; offset < active.length; offset += AUTOPILOT.maxAccountsPerBatch) {
      const connectionIds = active.slice(offset, offset + AUTOPILOT.maxAccountsPerBatch);
      const body = { requestId: await uuidFrom(pilot.id + ':' + slot + ':' + connectionIds.join(',')), name: `自动运营 · ${pilot.group_name || pilot.group_id} · ${beijingLabel(slot)}`,
        // Every group of this owner at this slot shares one post order.
        mediaType: 'photo', template: 'photo-text', sourceType: 'library', libraryStrategy: pilot.strategy, pairSeed: pilot.owner + ':' + slot, count: connectionIds.length, connectionIds,
        scheduleAt: Math.floor(slot / 1000), intervalMinutes: 60, staggerSeconds: AUTOPILOT.staggerSeconds, styleMode: 'random', styleId: 'classic', musicIds };
      try {
        const response = await handlePsychologyAutoPublish(new Request('https://autopilot.internal/api/psychology-auto-publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
          env, new URL('https://autopilot.internal/api/psychology-auto-publish'), { user });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '创建失败');
        batchIds.push(data.batchId);
      } catch (error) { errors.push(String(error.message || error).slice(0, 300)); }
    }
    const status = batchIds.length ? 'created' : 'failed', detail = errors.join('；');
    await db.prepare('UPDATE psychology_autopilot_slots SET status=?,batch_id=?,detail=?,updated_at=? WHERE autopilot_id=? AND slot_at=?').bind(status, batchIds.join(','), detail, Date.now(), pilot.id, slot).run();
    if (batchIds.length) { summary.batches.push(...batchIds); await log(db, pilot.id, 'batch', `已排 ${beijingLabel(slot)} 的发布：${active.length} 个号`, { slot, batchIds, accounts: active.length }, now); }
    if (errors.length) { summary.errors.push(...errors); await log(db, pilot.id, 'error', `${beijingLabel(slot)} 创建失败：${detail}`, { slot }, now); }
  }
  return summary;
}

export async function runAutopilots(env, now = Date.now()) {
  const pilots = (await env.DB.prepare("SELECT * FROM psychology_autopilots WHERE status='active' ORDER BY created_at LIMIT 20").all()).results;
  const results = {};
  for (const pilot of pilots) {
    try { results[pilot.id] = await runAutopilot(env, pilot, now); }
    catch (error) { results[pilot.id] = { error: error.message }; await log(env.DB, pilot.id, 'error', '运行失败：' + String(error.message || error).slice(0, 300), {}, now).catch(() => {}); }
  }
  return results;
}

async function psychologyGroups(env, user) {
  const store = await loadGroupStore(env.DB), project = findProjectForModule(store, 'psychology'), allowed = userAllowedGroupIds(user);
  const groups = publicState(store).groups.filter(g => g.projectId === project?.id && (!allowed || allowed.has(g.id)));
  const accounts = scopedAnalyticsAccounts(accountsFromLatestArchive(await listLatestArchiveAccounts(env.DB)), store, user, 'psychology');
  return groups.map(g => ({ id: g.id, name: g.name, accounts: accounts.filter(a => a.groupId === g.id).length }));
}

export async function handlePsychologyAutopilot(request, env, url, session) {
  if (!url.pathname.startsWith(BASE)) return null;
  const user = session?.user;
  assertAutoUser(user);
  if (request.method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail('不允许跨站修改。', 403);
  const db = env.DB;
  if (url.pathname === BASE && request.method === 'GET') {
    const [pilots, groups] = await Promise.all([db.prepare('SELECT * FROM psychology_autopilots WHERE owner=? ORDER BY created_at DESC LIMIT 20').bind(user.username).all(), psychologyGroups(env, user)]);
    const labels = new Map(accountsFromLatestArchive(await listLatestArchiveAccounts(db)).map(a => [connectionOf(a), a.profile?.username || a.username || a.label || '']));
    const out = [];
    for (const p of pilots.results) {
      const [accounts, slots, logs] = await Promise.all([
        db.prepare('SELECT connection_id,status,reason,updated_at FROM psychology_autopilot_accounts WHERE autopilot_id=? ORDER BY status DESC,connection_id').bind(p.id).all(),
        db.prepare('SELECT slot_at,status,batch_id,detail FROM psychology_autopilot_slots WHERE autopilot_id=? ORDER BY slot_at DESC LIMIT 12').bind(p.id).all(),
        db.prepare('SELECT kind,message,detail_json,created_at FROM psychology_autopilot_log WHERE autopilot_id=? ORDER BY created_at DESC,id DESC LIMIT 60').bind(p.id).all(),
      ]);
      const daily = logs.results.find(l => l.kind === 'daily');
      out.push({ id: p.id, groupId: p.group_id, groupName: p.group_name, strategy: p.strategy, strategyLabel: STRATEGIES[p.strategy], status: p.status, endsAt: p.ends_at, createdAt: p.created_at,
        slots: JSON.parse(p.slots_json), accounts: accounts.results.map(a => ({ connectionId: a.connection_id, name: labels.get(a.connection_id) || a.connection_id, status: a.status, reason: a.reason, updatedAt: a.updated_at })),
        schedule: slots.results.map(s => ({ slotAt: s.slot_at, status: s.status, batchIds: s.batch_id ? s.batch_id.split(',') : [], detail: s.detail })),
        latest: daily ? { at: daily.created_at, message: daily.message, ...parseObject(daily.detail_json) } : null,
        logs: logs.results.map(l => ({ kind: l.kind, message: l.message, at: l.created_at })) });
    }
    return json({ pilots: out, groups, strategies: STRATEGIES, rules: AUTOPILOT });
  }
  if (url.pathname === BASE && request.method === 'POST') {
    const body = await readJson(request), days = Number(body.days || 7);
    if (!Object.hasOwn(STRATEGIES, body.strategy)) fail('请选择运营策略。');
    if (!Number.isInteger(days) || days < 1 || days > 30) fail('运行天数应为 1–30 天。');
    const group = (await psychologyGroups(env, user)).find(g => g.id === body.groupId);
    if (!group) fail('没有这个心理学分组的权限。', 403);
    if (!group.accounts) fail('这个分组里还没有已授权的账号。');
    if (await db.prepare("SELECT 1 FROM psychology_autopilots WHERE group_id=? AND status<>'ended'").bind(group.id).first()) fail('这个分组已经在自动运营中。', 409);
    const now = Date.now(), id = 'pilot-' + crypto.randomUUID();
    await db.prepare(`INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?,?)`)
      .bind(id, user.username, group.id, group.name, body.strategy, JSON.stringify(AUTOPILOT.slots), now + days * DAY, now, now).run();
    await log(db, id, 'status', `开始自动运营 ${days} 天：${STRATEGIES[body.strategy]}，${group.accounts} 个号，每天北京时间 08:00 / 12:00 / 21:00 各发 1 条。`, {}, now);
    const pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(id).first();
    return json({ id, run: await runAutopilot(env, pilot, now) });
  }
  const one = url.pathname.match(/^\/api\/psychology-autopilot\/(pilot-[0-9a-f-]{36})(?:\/(run|accounts\/([^/]+)))?$/);
  if (!one) fail('不支持此请求。', 405);
  const pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=? AND owner=?').bind(one[1], user.username).first();
  if (!pilot) fail('自动运营不存在。', 404);
  const now = Date.now();
  if (!one[2] && request.method === 'PATCH') {
    const status = (await readJson(request)).status;
    if (!['active', 'paused', 'ended'].includes(status)) fail('状态无效。');
    if (pilot.status === 'ended') fail('已结束的自动运营不能再修改。', 409);
    await db.prepare('UPDATE psychology_autopilots SET status=?,updated_at=? WHERE id=?').bind(status, now, pilot.id).run();
    await log(db, pilot.id, 'status', { active: '已恢复自动运营。', paused: '已暂停自动运营：不再创建新的发布，已排好的发布照常进行。', ended: '已结束自动运营。' }[status], {}, now);
    return json({ ok: true });
  }
  if (one[2] === 'run' && request.method === 'POST') {
    if (pilot.status !== 'active') fail('请先恢复自动运营。', 409);
    return json(await runAutopilot(env, pilot, now));
  }
  if (one[3] && request.method === 'PATCH') {
    const status = (await readJson(request)).status, connectionId = decodeURIComponent(one[3]);
    if (!['active', 'paused'].includes(status)) fail('状态无效。');
    const result = await db.prepare('UPDATE psychology_autopilot_accounts SET status=?,reason=?,updated_at=? WHERE autopilot_id=? AND connection_id=?')
      .bind(status, status === 'paused' ? '手动停发' : '', now, pilot.id, connectionId).run();
    if (!result.meta?.changes) fail('账号不在这个自动运营里。', 404);
    await log(db, pilot.id, status === 'paused' ? 'pause' : 'resume', (status === 'paused' ? '手动停发账号 ' : '已恢复账号 ') + connectionId, { connectionId }, now);
    return json({ ok: true });
  }
  fail('不支持此请求。', 405);
}
