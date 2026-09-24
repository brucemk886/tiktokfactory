// Autopilot: runs one psychology photo account group on its own. Twice a day it
// pauses accounts that keep failing or stay under 200 views, logs a 7-day
// analysis, and creates library batches for the next day's slots as the owner.
import { json, errorJson, readJson, sha256Hex } from './http.js';
import { kvGet, kvSet } from './kv.js';
import { loadGroupStore } from './official.js';
import { listLatestArchiveAccounts, accountsFromLatestArchive, loadVideosForAccounts } from './official-archive-store.js';
import { scopeOfficialAccess } from '../../scripts/official-account-group-store.js';
import { operationsWindow, publishOutcome, parseObject } from '../../scripts/psychology-operations.js';
import { loadAutoUser, handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { executionCounts, slotExecution, stopImpact, stopPending, nextAutopilotCheck } from './psychology-autopilot-execution.js';
import { publishAccountDirectory } from './psychology-account-access.js';
import { TEST_POLICY, TEST_RULES } from './psychology-copy-testing.js';
import { EVOLUTION } from './psychology-copy-evolution.js';
import { frameworkFor } from './psychology-operations.js';

const BASE = '/api/psychology-autopilot';
const DAY = 86400000, HOUR = 3600000;
export const AUTOPILOT = Object.freeze({
  // Beijing times, roughly US morning, lunch and evening.
  slots: [{ hour: 8, minute: 0 }, { hour: 12, minute: 0 }, { hour: 21, minute: 0 }],
  leadMs: 2 * HOUR, immediateLeadMs: 10 * 60000, horizonMs: 26 * HOUR, staggerSeconds: 45, maxAccountsPerBatch: 50,
  lowViews: 200, lowPosts: 5, failStreak: 3, maxDailyPosts: 10,
});
export const STRATEGIES = { evolve: 'A · 优胜放量', original: 'B · 原版测试', rewrite: 'C · 改写测试' };
function strategyRules() {
  const n = TEST_RULES.samples, exploit = Math.round(EVOLUTION.exploitShare * 100), retire = Math.round(EVOLUTION.retireRatio * 100);
  return {
    evolve: { summary:'原版与改写版共同起测，有成熟数据后优胜放量并持续探索。', rules:[
      `冷启动同时给原版、改写版测试机会；两类都有可用测试版本时交替选择，不等待原版先跑完。每版先分配 ${n} 个测试名额。`,
      `成熟版本和待测试版本都存在时，约 ${exploit}% 优先平均播放最高的成熟版本，约 ${100-exploit}% 测试样本不足的版本；某类不可用时选另一类。比例是抽取倾向。`,
      `原版与改写版都达到 ${n} 条满 24 小时且有播放数据的样本后，改写平均播放低于原版 ${retire}% 的版本不再由 A 抽取。`,
      `使用最近 ${EVOLUTION.windowDays} 天归档表现，每天更新两次；已排队和已发布但数据未成熟的任务占用名额，不因数据延迟连续补发。`,
    ] },
    original: { summary:'只测原版，优先补齐原版对照样本。', rules:[
      '只使用已完成提取的原版，原版不可用就跳过选题，不用改写补足。',
      `优先完成原版 ${n} 个测试名额；已占满但数据尚未成熟的版本等待评估，确认失败才释放名额。`,
      '可用待测原版不足时，可以继续使用已有成熟数据的原版，不按照改写评分切换版本。',
      '账号用过的选题与本批已用版本都会跳过；剩余候选不足时整批不创建并说明原因。',
    ] },
    rewrite: { summary:'只测改写版，轮换版本并补齐样本，不回退原版。', rules:[
      '只选择已启用、可发布的改写版本；没有可用改写就跳过，不用原版补足。',
      `每个选题同时测试最多 ${TEST_RULES.activeRewrites} 个未成熟改写版，优先完成已经开始的版本，再开放下一版。`,
      `优先选择测试次数少的可用版本，每版先占用 ${n} 个测试名额，满额等待成熟数据；无待测版本时轮换已有成熟数据的改写。`,
      '不按 AI 改写评分挑选，不执行 A 的相对淘汰；剩余候选不足时整批不创建并说明原因。',
    ] },
  };
}
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const ms = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : 0; };
const beijingDate = t => new Date(t + 8 * HOUR).toISOString().slice(0, 10);
export function pilotPairSeed(pilot, slot) {
  const time=new Date(slot+8*HOUR), index=pilotSlotsAt(pilot,slot).findIndex(s=>s.hour===time.getUTCHours()&&s.minute===time.getUTCMinutes());
  return `${pilot.owner}:${beijingDate(slot)}:round-${index+1}`;
}
const beijingLabel = t => new Date(t + 8 * HOUR).toISOString().slice(5, 16).replace('T', ' ');
const connectionOf = account => String(account.connectionId || String(account.schema || '').replace(/^tiktok:/, ''));
async function uuidFrom(text) { const h = await sha256Hex(text); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }

export function normalizePilotSlots(slots = AUTOPILOT.slots) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > AUTOPILOT.maxDailyPosts) fail('每号每天应发布 1–10 条，每条设置一个发布时间。');
  if (slots.some(s => !s || !Number.isInteger(s.hour) || s.hour<0 || s.hour>23 || !Number.isInteger(s.minute) || s.minute<0 || s.minute>59)) fail('发布时间应为有效的北京时间（00:00–23:59）。');
  const normalized=slots.map(s=>({hour:s.hour,minute:s.minute})).sort((a,b)=>a.hour*60+a.minute-b.hour*60-b.minute);
  if(new Set(normalized.map(s=>s.hour*60+s.minute)).size!==slots.length)fail('每天的发布时间不能重复。');
  return normalized;
}
const slotLabel = slots => slots.map(s=>`${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`).join(' / ');
function validateDayEnd(slots, accounts) {
  const last=slots.at(-1);
  if((last.hour*60+last.minute)*60 + Math.max(0,accounts-1)*AUTOPILOT.staggerSeconds >= 86400)fail('最后一个发布时间过晚，组内账号错峰后会跨天，请提前该时段。');
}
export function pilotSlotsAt(pilot, now) {
  return normalizePilotSlots(JSON.parse(pilot.slots_effective_at && now>=pilot.slots_effective_at ? pilot.pending_slots_json : pilot.slots_json));
}

// Slot times (ms) inside (now+lead, now+horizon], within the pilot's lifetime.
export function dueSlots(pilot, now, slots = JSON.parse(pilot.slots_json)) {
  const out = [];
  for (let d = 0; d < 3; d++) {
    const date = beijingDate(now + d * DAY);
    const daySlots = pilot.slots_effective_at && Date.parse(date+'T00:00:00+08:00')>=pilot.slots_effective_at ? JSON.parse(pilot.pending_slots_json) : slots;
    for (const s of daySlots) {
      const t = Date.parse(`${date}T${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}:00+08:00`);
      const lead = pilot.start_now && beijingDate(t)===beijingDate(pilot.created_at) ? AUTOPILOT.immediateLeadMs : AUTOPILOT.leadMs;
      if (t > now + lead && t <= now + AUTOPILOT.horizonMs && t < pilot.ends_at && t >= pilot.created_at) out.push(t);
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

// Group membership is operational data, independent of whether analytics has synced.
// Polls reuse the local directory; explicit refresh/start/scheduled runs refresh from the hub.
const DIRECTORY_KEY = 'psychology-autopilot-account-directory-v1';
async function autopilotDirectory(env, user, fresh = false) {
  let directory = await kvGet(env.DB, DIRECTORY_KEY, null);
  if (fresh || !Array.isArray(directory?.accounts)) {
    const live = await publishAccountDirectory(env, { fresh:true });
    if (!Array.isArray(live.accounts)) fail('授权账号目录返回无效，请重新刷新。', 502);
    directory = { updatedAt:Date.now(), accounts:live.accounts.map(a => ({
      id:String(a.connectionId || a.id || ''), connectionId:String(a.connectionId || a.id || ''),
      username:String(a.username || ''), displayName:String(a.displayName || a.label || ''),
      ...(Array.isArray(a.scopes) ? { scopes:a.scopes } : {}),
    })).filter(a => a.id) };
    await kvSet(env.DB, DIRECTORY_KEY, directory);
  }
  const scoped = scopeOfficialAccess(directory, await loadGroupStore(env.DB), user, 'psychology');
  const seen = new Set();
  const accounts = scoped.accounts.filter(a => {
    if (seen.has(a.connectionId) || (Array.isArray(a.scopes) && !a.scopes.includes('video.publish'))) return false;
    seen.add(a.connectionId); return true;
  }).map(a => ({ ...a, schema:'tiktok:'+a.connectionId, profile:{ username:a.username }, label:a.displayName || a.username }));
  return { accounts, updatedAt:directory.updatedAt,
    groups:scoped.groups.map(g => ({ id:g.id, name:g.name, accounts:accounts.filter(a => a.groupId === g.id).length })) };
}
async function groupAccounts(env, user, groupId) {
  return (await autopilotDirectory(env, user, true)).accounts.filter(a => a.groupId === groupId);
}

// Latest-first publish outcomes of this pilot's items that should have gone out by now.
async function pilotOutcomes(db, pilotId, now) {
  const items = (await db.prepare(`SELECT i.id,i.connection_id,COALESCE(j.status,i.execution_status) status,json_extract(j.result_json,'$.publishFailed') AS publish_failed
    FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id
    WHERE i.deleted_at=0 AND i.schedule_at<? AND EXISTS (SELECT 1 FROM psychology_autopilot_slots s WHERE s.autopilot_id=? AND instr(','||s.batch_id||',', ','||i.batch_id||',')>0)
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
  pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(pilot.id).first();
  if (!pilot || pilot.status !== 'active') return summary;
  await db.prepare('UPDATE psychology_autopilots SET last_run_at=? WHERE id=?').bind(now, pilot.id).run();
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
    await db.prepare("UPDATE psychology_autopilot_accounts SET status='paused',stop_pending=1,reason=?,updated_at=? WHERE autopilot_id=? AND connection_id=? AND status='active'").bind(p.reason, now, pilot.id, p.id).run();
    states.set(p.id, 'paused'); summary.paused.push(p.id);
    const stopped = await stopPending(db, pilot.id, p.id);
    await log(db, pilot.id, 'status', `已停止 @${names.get(p.id)} 尚未提交的 ${stopped} 条任务；进入提交的任务继续核对回执。`, {}, now);
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
    const current = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(pilot.id).first();
    if (current?.status !== 'active') break;
    if(!dueSlots(current,now).includes(slot))continue;
    const claim = await db.prepare(`INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) SELECT ?,?,'creating',? FROM psychology_autopilots WHERE id=? AND status='active' AND updated_at=?
      ON CONFLICT(autopilot_id,slot_at) DO UPDATE SET status='creating',detail='',updated_at=excluded.updated_at WHERE status='failed'`).bind(pilot.id, slot, now, pilot.id, current.updated_at).run();
    if (!claim.meta?.changes) continue;
    if (!active.length) {
      await db.prepare("UPDATE psychology_autopilot_slots SET status='skipped',detail='没有可发布的账号' WHERE autopilot_id=? AND slot_at=?").bind(pilot.id, slot).run();
      continue;
    }
    const batchIds = [], errors = [];
    for (let offset = 0; offset < active.length; offset += AUTOPILOT.maxAccountsPerBatch) {
      const connectionIds = active.slice(offset, offset + AUTOPILOT.maxAccountsPerBatch);
      const body = { requestId: await uuidFrom(pilot.id + ':' + slot + ':' + connectionIds.join(',')), name: `自动运营 · ${pilot.group_name || pilot.group_id} · ${beijingLabel(slot)}`,
        // Staggered groups pair by Beijing date and daily round, not wall-clock time.
        mediaType: 'photo', template: 'photo-text', sourceType: 'library', libraryStrategy: pilot.strategy, libraryTestPolicy:TEST_POLICY, pairSeed: pilotPairSeed(current,slot), count: connectionIds.length, connectionIds,
        scheduleAt: Math.floor(slot / 1000) + offset * AUTOPILOT.staggerSeconds, intervalMinutes: 60, staggerSeconds: AUTOPILOT.staggerSeconds, styleMode: 'random', styleId: 'classic', musicIds };
      try {
        const response = await handlePsychologyAutoPublish(new Request('https://autopilot.internal/api/psychology-auto-publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
          env, new URL('https://autopilot.internal/api/psychology-auto-publish'), { user }, { productionLeadMs:AUTOPILOT.leadMs });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '创建失败');
        batchIds.push(data.batchId);
        await db.prepare('UPDATE psychology_autopilot_slots SET batch_id=? WHERE autopilot_id=? AND slot_at=?').bind(batchIds.join(','), pilot.id, slot).run();
        const fresh = await db.prepare('SELECT status,stop_pending FROM psychology_autopilots WHERE id=?').bind(pilot.id).first();
        if (fresh?.status !== 'active' && fresh?.stop_pending) await stopPending(db, pilot.id);
        const stoppedAccounts = await db.prepare("SELECT connection_id FROM psychology_autopilot_accounts WHERE autopilot_id=? AND status='paused' AND stop_pending=1").bind(pilot.id).all();
        for (const a of stoppedAccounts.results) await stopPending(db, pilot.id, a.connection_id);
        if (fresh?.status !== 'active') break;
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

export async function handlePsychologyAutopilot(request, env, url, session) {
  if (!url.pathname.startsWith(BASE)) return null;
  const user = session?.user;
  if (user?.role !== 'admin' || !(user.sidebarModules || []).includes('psychology-autopilot')) fail('没有自动运营权限。', 403);
  if (request.method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail('不允许跨站修改。', 403);
  const db = env.DB;
  if (url.pathname === BASE && request.method === 'GET') {
    const [pilots, directory] = await Promise.all([db.prepare('SELECT * FROM psychology_autopilots WHERE owner=? ORDER BY created_at DESC LIMIT 20').bind(user.username).all(), autopilotDirectory(env, user, url.searchParams.get('refreshGroups') === '1')]);
    const groups = directory.groups;
    const labels = new Map([...accountsFromLatestArchive(await listLatestArchiveAccounts(db)), ...directory.accounts].map(a => [connectionOf(a), a.profile?.username || a.username || a.label || '']));
    const out = [];
    for (const p of pilots.results) {
      const [accounts, slots, logs, daily] = await Promise.all([
        db.prepare('SELECT connection_id,status,reason,updated_at,stop_pending FROM psychology_autopilot_accounts WHERE autopilot_id=? ORDER BY status DESC,connection_id').bind(p.id).all(),
        db.prepare('SELECT slot_at,status,batch_id,detail FROM psychology_autopilot_slots WHERE autopilot_id=? ORDER BY slot_at DESC LIMIT 12').bind(p.id).all(),
        db.prepare('SELECT kind,message,detail_json,created_at FROM psychology_autopilot_log WHERE autopilot_id=? ORDER BY created_at DESC,id DESC LIMIT 60').bind(p.id).all(),
        db.prepare("SELECT * FROM psychology_autopilot_log WHERE autopilot_id=? AND kind='daily' ORDER BY created_at DESC,id DESC LIMIT 1").bind(p.id).first(),
      ]);
      const items = await slotExecution(db, slots.results, labels);
      const dayStart = Date.parse(beijingDate(Date.now()) + 'T00:00:00+08:00');
      const today = executionCounts(items.filter(i => i.scheduleAt >= dayStart && i.scheduleAt < dayStart + DAY));
      const attention = items.filter(i => i.error || i.retrying || ['missing','production_failed','publish_failed'].includes(i.state));
      out.push({ id: p.id, groupId: p.group_id, groupName: p.group_name, strategy: p.strategy, strategyLabel: STRATEGIES[p.strategy], status: p.status, endsAt: p.ends_at, createdAt: p.created_at,
        today, attention, lastRunError:logs.results.find(l=>l.kind==='error' && l.created_at>=p.last_run_at)?.message || '', lastRunAt:p.last_run_at, nextCheckAt:p.status === 'active' ? nextAutopilotCheck() : null, stopPending:Boolean(p.stop_pending),
        slots: pilotSlotsAt(p,Date.now()), pendingSlots:p.slots_effective_at>Date.now()?JSON.parse(p.pending_slots_json):null, scheduleEffectiveAt:p.slots_effective_at>Date.now()?p.slots_effective_at:0, accounts: accounts.results.map(a => ({ connectionId: a.connection_id, name: labels.get(a.connection_id) || a.connection_id, status: a.status, reason: a.reason, updatedAt: a.updated_at, stopPending:Boolean(a.stop_pending) })),
        schedule: slots.results.map(s => ({ slotAt: s.slot_at, status: s.status, batchIds: s.batch_id ? s.batch_id.split(',') : [], detail: s.detail, counts:executionCounts(items.filter(i => i.slotAt === s.slot_at)) })),
        latest: daily ? { at: daily.created_at, message: daily.message, ...parseObject(daily.detail_json) } : null,
        logs: logs.results.map(l => ({ kind: l.kind, message: l.message, at: l.created_at })) });
    }
    return json({ pilots: out, groups, strategies: STRATEGIES, strategyRules:strategyRules(), evolutionRules:EVOLUTION, testingRules:TEST_RULES, rules: AUTOPILOT, fetchedAt:Date.now(), groupsUpdatedAt:directory.updatedAt });
  }
  if (url.pathname === BASE && request.method === 'POST') {
    const body = await readJson(request), days = Number(body.days || 7), slots = normalizePilotSlots(body.slots);
    if(body.startNow !== undefined && typeof body.startNow !== 'boolean')fail('立即准备选项无效。');
    if (!Object.hasOwn(STRATEGIES, body.strategy)) fail('请选择运营策略。');
    if (!Number.isInteger(days) || days < 1 || days > 30) fail('运行天数应为 1–30 天。');
    const group = (await autopilotDirectory(env, user, true)).groups.find(g => g.id === body.groupId);
    if (!group) fail('没有这个心理学分组的权限。', 403);
    if (!group.accounts) fail('这个分组里还没有已授权且有发布权限的账号，请检查分组成员和账号授权。');
    validateDayEnd(slots, group.accounts);
    if (await db.prepare("SELECT 1 FROM psychology_autopilots WHERE group_id=? AND status<>'ended'").bind(group.id).first()) fail('这个分组已经在自动运营中。', 409);
    const now = Date.now(), id = 'pilot-' + crypto.randomUUID();
    await db.prepare(`INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at,start_now) VALUES(?,?,?,?,?,?,'active',?,?,?,?)`)
      .bind(id, user.username, group.id, group.name, body.strategy, JSON.stringify(slots), now + days * DAY, now, now, Number(body.startNow===true)).run();
    await log(db, id, 'status', `开始自动运营 ${days} 天：${STRATEGIES[body.strategy]}，${group.accounts} 个号，每号每天 ${slots.length} 条，北京时间 ${slotLabel(slots)}；${body.startNow?'首日不足 2 小时、距离发布超过 10 分钟的时段立即准备，其他时段提前 2 小时生成':'每条提前 2 小时开始生成'}。`, {}, now);
    const pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(id).first();
    return json({ id, run: await runAutopilot(env, pilot, now) });
  }
  const one = url.pathname.match(/^\/api\/psychology-autopilot\/(pilot-[0-9a-f-]{36})(?:\/(run|impact|schedule|slots\/(\d+)|accounts\/([^/]+)))?$/);
  if (!one) fail('不支持此请求。', 405);
  const pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=? AND owner=?').bind(one[1], user.username).first();
  if (!pilot) fail('自动运营不存在。', 404);
  const now = Date.now();
  if (one[2] === 'schedule' && request.method === 'PATCH') {
    if(pilot.status==='ended')fail('已结束的自动运营不能修改发布设置。',409);
    const body=await readJson(request);if(!Array.isArray(body.slots))fail('请设置每天的发布时间。');
    const slots=normalizePilotSlots(body.slots);
    const group=(await autopilotDirectory(env,user,true)).groups.find(g=>g.id===pilot.group_id);
    if(!group)fail('没有这个心理学分组的权限。',403);
    validateDayEnd(slots,group.accounts);
    // Changes start on a whole Beijing day after all already-created/reserved slots.
    // Existing generation and publishing snapshots remain immutable.
    const latest=await db.prepare('SELECT MAX(slot_at) last_slot FROM psychology_autopilot_slots WHERE autopilot_id=?').bind(pilot.id).first();
    if(pilot.slots_effective_at>now && Number(latest?.last_slot)>=pilot.slots_effective_at)fail('待生效设置已开始创建排期，请在该设置生效后再修改；已创建任务继续原计划。',409);
    const effectiveAt=Date.parse(beijingDate(Math.max(now,Number(latest?.last_slot)||0))+'T00:00:00+08:00')+DAY;
    if(effectiveAt>=pilot.ends_at)fail('本次运营结束前已无完整日期可应用新设置，请新建运营计划。',409);
    const changed=await db.prepare("UPDATE psychology_autopilots SET slots_json=?,pending_slots_json=?,slots_effective_at=?,updated_at=? WHERE id=? AND status<>'ended' AND updated_at=? AND NOT EXISTS (SELECT 1 FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at>=?)")
      .bind(JSON.stringify(pilotSlotsAt(pilot,now)),JSON.stringify(slots),effectiveAt,Math.max(now,pilot.updated_at+1),pilot.id,pilot.updated_at,pilot.id,effectiveAt).run();
    if(!changed.meta?.changes)fail('运营设置刚被修改，请刷新后重试。',409);
    await log(db,pilot.id,'status',`发布设置已更新：每号每天 ${slots.length} 条，北京时间 ${slotLabel(slots)}，${beijingDate(effectiveAt)} 起生效；已创建任务继续原计划。`,{slots,effectiveAt},now);
    return json({ok:true,slots,effectiveAt});
  }
  if (one[2] === 'impact' && request.method === 'GET') return json(await stopImpact(db, pilot.id, url.searchParams.get('account') || ''));
  if (one[3] && request.method === 'GET') {
    const slot = await db.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').bind(pilot.id, Number(one[3])).first();
    if (!slot) fail('排期不存在。', 404);
    const currentAccounts = (await autopilotDirectory(env, user)).accounts;
    const labels = new Map([...accountsFromLatestArchive(await listLatestArchiveAccounts(db)), ...currentAccounts].map(a => [connectionOf(a), a.profile?.username || a.username || a.label || connectionOf(a)]));
    return json({ items:await slotExecution(db, [slot], labels) });
  }
  if (!one[2] && request.method === 'PATCH') {
    const body = await readJson(request), status = body.status;
    if (body.stopPending !== undefined && typeof body.stopPending !== 'boolean') fail('暂停范围无效。');
    if (!['active', 'paused', 'ended'].includes(status)) fail('状态无效。');
    if (pilot.status === 'ended') fail('已结束的自动运营不能再修改。', 409);
    await db.prepare('UPDATE psychology_autopilots SET status=?,stop_pending=?,updated_at=? WHERE id=?').bind(status, status === 'active' ? 0 : Number(Boolean(body.stopPending)), now, pilot.id).run();
    const stopped = status !== 'active' && body.stopPending ? await stopPending(db, pilot.id) : 0;
    await log(db, pilot.id, 'status', { active: '已恢复自动运营。', paused: body.stopPending ? '已暂停自动运营并停止本地尚未提交的任务。' : '已暂停新增排期，已排好的发布照常进行。', ended: '已结束自动运营。' }[status], {}, now);
    if (body.stopPending) await log(db, pilot.id, 'status', `已停止本地尚未提交的 ${stopped} 条任务；已进入提交的任务仍会继续。恢复不重新创建已停止任务。`, {}, now);
    return json({ ok: true, stopped });
  }
  if (one[2] === 'run' && request.method === 'POST') {
    if (pilot.status !== 'active') fail('请先恢复自动运营。', 409);
    return json(await runAutopilot(env, pilot, now));
  }
  if (one[4] && request.method === 'PATCH') {
    const body = await readJson(request), status = body.status, connectionId = decodeURIComponent(one[4]);
    if (pilot.status === 'ended') fail('已结束的自动运营不能再修改。', 409);
    if (!['active', 'paused'].includes(status)) fail('状态无效。');
    const result = await db.prepare('UPDATE psychology_autopilot_accounts SET status=?,stop_pending=?,reason=?,updated_at=? WHERE autopilot_id=? AND connection_id=?')
      .bind(status, status === 'paused' ? 1 : 0, status === 'paused' ? '手动停发' : '', now, pilot.id, connectionId).run();
    if (!result.meta?.changes) fail('账号不在这个自动运营里。', 404);
    const stopped = status === 'paused' ? await stopPending(db, pilot.id, connectionId) : 0;
    await log(db, pilot.id, status === 'paused' ? 'pause' : 'resume', (status === 'paused' ? '手动停发账号 ' : '已恢复账号 ') + connectionId, { connectionId }, now);
    return json({ ok: true, stopped });
  }
  fail('不支持此请求。', 405);
}
