import { handleAutopilotDashboard } from './psychology-autopilot-dashboard.js';
import { handleTransitionDay } from './psychology-transition-day.js';
import { handleTaskGroups } from './psychology-task-groups.js';
import { reconcileTaskExecutors,taskSlotAccounts,taskPublishContext,sameDeliveryDay } from './psychology-task-group-execution.js';
// Autopilot: checks psychology groups at Pacific 05:00 / 08:30 / 17:00.
// It pauses accounts that keep failing to publish, logs a 7-day analysis, and
// creates library batches for the next day's slots as the owner.
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
import { POOL_POLICY, ACCOUNT_POOLS, CONTENT_POOLS } from '../../scripts/psychology-pool-policy.js';
import { readPoolReport } from './psychology-pool-report.js';
import { frameworkFor } from './psychology-operations.js';
import { PRODUCTION_POLICY, readProductionLoad, estimateProductionLead } from './psychology-production-capacity.js';
import { DEFAULT_TIME_ZONE, PACIFIC_TIME_ZONE, normalizeTimeZone, zonedParts, zonedDate, zonedEpoch, addCalendarDays, nextDay, addZonedDays, calendarDayIndex, pilotTimeZoneAt } from '../../scripts/psychology-schedule-time.js';

const BASE = '/api/psychology-autopilot';
const DAY = 86400000, HOUR = 3600000;
export const AUTOPILOT = Object.freeze({
  // Legacy defaults use Beijing time; project-managed schedules set their zone explicitly.
  slots: [{ hour: 8, minute: 0 }, { hour: 12, minute: 0 }, { hour: 21, minute: 0 }],
  leadMs: 2 * HOUR, immediateLeadMs: 10 * 60000, horizonMs: 26 * HOUR, staggerSeconds: 45, maxAccountsPerBatch: 50,
  lowViews: 200, lowPosts: 5, failStreak: 3, maxDailyPosts: 10,
});
export const STRATEGIES = { pools: '账号池 × 内容池匹配', evolve: 'A · 优胜放量', original: 'B · 原版测试', rewrite: 'C · 改写测试' };
function strategyRules() {
  const n = TEST_RULES.samples, exploit = Math.round(EVOLUTION.exploitShare * 100), retire = Math.round(EVOLUTION.retireRatio * 100);
  return {
    pools: { summary:'按成熟账号池匹配精确版本与样式的内容池，低号专门救援。', rules:[
      '账号按至少五条满 72 小时作品的播放中位数分层；观察权重不是平台内部权重，低播放不会自动停号。',
      '每号每天2条（每周14条）参考：强号 12 / 1 / 1、中号 10 / 3 / 1、救援号 11 / 3 / 0；每天3条（每周21条）参考：强号 18 / 2 / 1、中号 15 / 5 / 1、救援号 17 / 4 / 0，顺序为优胜基准 / 优化验证 / 新内容。',
      '配额按实际计划每天1–10条等比例换算并取整，是目标而非保证发布量；每天两条时至少一条基准，低号有合格基准才救援。',
      '内容按精确版本和样式统计，至少五个不同账号的成熟有效样本才判断优胜；未知指标保持缺失，真实零保持零。',
      '低号不分配冷探索；近零号先检查状态，最多六条基准测试后等待复查，不自动封号；没有合格内容时只跳过相应账号。',
      '后续策略按已保留排期之后的完整目标时区日期生效，已创建的生产与发布任务保持原计划。',
    ] },
    evolve: { summary:'原版与改写版共同起测，有成熟数据后优胜放量并持续探索。', rules:[
      `冷启动同时给原版、改写版测试机会；两类都有可用测试版本时交替选择，不等待原版先跑完。每版先分配 ${n} 个测试名额。`,
      `成熟版本和待测试版本都存在时，约 ${exploit}% 优先平均播放最高的成熟版本，约 ${100-exploit}% 测试样本不足的版本；某类不可用时选另一类。比例是抽取倾向。`,
      `原版与改写版都达到 ${n} 条满 24 小时且有播放数据的样本后，改写平均播放低于原版 ${retire}% 的版本不再由 A 抽取。`,
      `使用最近 ${EVOLUTION.windowDays} 天归档表现，每轮检查按最新已同步数据评估；已排队和已发布但数据未成熟的任务占用名额，不因数据延迟连续补发。`,
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
const beijingDate = t => new Date(t + 8 * HOUR).toISOString().slice(0, 10);
export function pilotPairSeed(pilot, slot) {
  const timeZone=pilotTimeZoneAt(pilot,slot), time=zonedParts(slot,timeZone), index=pilotSlotsAt(pilot,slot).findIndex(s=>s.hour===time.hour&&s.minute===time.minute);
  return `${pilot.owner}:${time.date}:round-${index+1}`;
}
const timeZoneLabel = timeZone => timeZone===PACIFIC_TIME_ZONE?'美西时间':'北京时间';
const pilotLabel = (pilot,t) => { const zone=pilotTimeZoneAt(pilot,t),parts=zonedParts(t,zone);return `${parts.date.slice(5)} ${String(parts.hour).padStart(2,'0')}:${String(parts.minute).padStart(2,'0')} ${timeZoneLabel(zone)}`; };
const connectionOf = account => String(account.connectionId || String(account.schema || '').replace(/^tiktok:/, ''));
async function uuidFrom(text) { const h = await sha256Hex(text); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }

export function normalizePilotSlots(slots = AUTOPILOT.slots) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > AUTOPILOT.maxDailyPosts) fail('每号每天应发布 1–10 条，每条设置一个发布时间。');
  if (slots.some(s => !s || !Number.isInteger(s.hour) || s.hour<0 || s.hour>23 || !Number.isInteger(s.minute) || s.minute<0 || s.minute>59)) fail('发布时间应为目标时区的有效时间（00:00–23:59）。');
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

// Resolve the additive canonical strategy at the slot time, preserving legacy
// CHECK constraints and immutable generation/publication snapshots.
export function pilotStrategyAt(pilot, time) {
  return pilot.pending_strategy && pilot.strategy_effective_at && time >= pilot.strategy_effective_at
    ? pilot.pending_strategy : pilot.current_strategy || pilot.strategy;
}
const pilotStrategyStartAt = (pilot, time) => pilot.pending_strategy && pilot.strategy_effective_at && time >= pilot.strategy_effective_at
  ? pilot.strategy_effective_at : pilot.strategy_started_at || pilot.created_at;
export function pilotPoolContext(pilot, slot) {
  const slots = pilotSlotsAt(pilot, slot), timeZone=pilotTimeZoneAt(pilot,slot), time=zonedParts(slot,timeZone);
  const round = slots.findIndex(s => s.hour === time.hour && s.minute === time.minute);
  if (round < 0) fail('发布时段不在当前运营配置中。', 409);
  const cycleStartAt = pilotStrategyStartAt(pilot, slot);
  const dayIndex = Math.max(0, calendarDayIndex(slot,cycleStartAt,timeZone));
  return { cycleStartAt, postsPerDay: slots.length, round, dayIndex, timeZone };
}
function pilotLibraryConfig(pilot, slot) {
  const strategy = pilotStrategyAt(pilot, slot);
  return { libraryStrategy: strategy, libraryTestPolicy: strategy === 'pools' ? POOL_POLICY.version : TEST_POLICY,
    ...(strategy === 'pools' ? { poolContext: pilotPoolContext(pilot, slot) } : {}) };
}

// Slot times (ms) inside (now+lead, now+horizon], within the pilot's lifetime.
export function dueSlots(pilot, now, slots = JSON.parse(pilot.slots_json)) {
  const out = [];
  const boundary=Number(pilot.slots_effective_at)||Infinity;
  const currentZone=normalizeTimeZone(pilot.schedule_timezone);
  const schedules=[{slots,timeZone:currentZone,start:-Infinity,end:boundary}];
  if(Number.isFinite(boundary)) schedules.push({slots:JSON.parse(pilot.pending_slots_json),timeZone:normalizeTimeZone(pilot.pending_schedule_timezone||currentZone),start:boundary,end:Infinity});
  // Iterate calendar dates in each schedule's own zone. DST days are 23/25
  // hours, and a zone change can occur partway through the old local date.
  for (const schedule of schedules) {
    const lastDate=zonedDate(now+AUTOPILOT.horizonMs,schedule.timeZone);
    for(let date=zonedDate(now,schedule.timeZone);date<=lastDate;date=addCalendarDays(date,1)){
      for(const s of schedule.slots){
        let t;
        try { t=zonedEpoch(date,s.hour,s.minute,schedule.timeZone); }
        catch(error){if(error instanceof RangeError)continue;throw error;}
        const lead=pilot.start_now&&date===zonedDate(pilot.created_at,schedule.timeZone)?AUTOPILOT.immediateLeadMs:AUTOPILOT.leadMs;
        if(t>=schedule.start&&t<schedule.end&&t>now+lead&&t<=now+AUTOPILOT.horizonMs&&t<pilot.ends_at&&t>=pilot.created_at)out.push(t);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// Accounts to pause: the last 3 due autopilot items all failed to publish.
// Low-play volume is reported, not used to stop an account mid-run.
export function guardAccounts({ connectionIds, outcomesByConnection, rules = AUTOPILOT }) {
  const pauses = [];
  for (const id of connectionIds) {
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
  return { accounts, fullAccounts:directory.accounts, updatedAt:directory.updatedAt,
    groups:scoped.groups.map(g => ({ id:g.id, name:g.name, accounts:accounts.filter(a => a.groupId === g.id).length })) };
}
// Forecasts count complete authorized operating groups, never a UI page or a
// 50-account allocation chunk. Existing reservations remain load, not new work.
export async function readOwnerProductionForecast(db,user,directory,now=Date.now()){
  const [planRows,stateRows,policy]=await Promise.all([
    db.prepare("SELECT * FROM psychology_autopilots WHERE owner=? AND status='active' AND ends_at>? ORDER BY id").bind(user.username,now).all(),
    db.prepare('SELECT a.*,p.updated_at pilot_updated_at FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.owner=? ORDER BY a.updated_at DESC,p.updated_at DESC,a.autopilot_id').bind(user.username).all(),
    db.prepare('SELECT * FROM psychology_task_group_policies WHERE owner=?').bind(user.username).first(),
  ]);
  const registry=policy?new Map((await db.prepare('SELECT * FROM psychology_task_group_accounts WHERE policy_id=?').bind(policy.id).all()).results.map(a=>[a.connection_id,a])):new Map();
  const states=new Map(stateRows.results.map(a=>[a.autopilot_id+':'+a.connection_id,a.status])),latest=new Map();
  for(const a of stateRows.results)if(!latest.has(a.connection_id))latest.set(a.connection_id,a.status);
  const authorized=new Map();
  for(const account of directory.accounts||[]){
    if(Array.isArray(account.scopes)&&!account.scopes.includes('video.publish'))continue;
    authorized.set(connectionOf(account),account);
  }
  const candidates=(pilot,slot)=>{
    if(slot<pilot.created_at||slot>=pilot.ends_at)return [];
    const selected=policy&&pilot.task_group_policy_id===policy.id;
    let ids=[...authorized].filter(([id,a])=>a.groupId===pilot.group_id&&(states.get(pilot.id+':'+id)||latest.get(id)||(registry.get(id)?.paused?'paused':'active'))!=='paused').map(([id])=>id);
    if(!policy)return pilot.task_group_managed?[]:ids;
    if(!selected)return ids.filter(id=>!registry.get(id)?.enrolled);
    ids=ids.filter(id=>registry.get(id)?.enrolled&&!registry.get(id)?.excluded);
    if(!policy.enabled||slot>=policy.ends_at)return pilot.task_group_managed?[]:ids;
    if(policy.prestart_cutoff_at&&slot>=policy.prestart_cutoff_at&&slot<policy.starts_at)return [];
    if(slot<policy.starts_at)return pilot.task_group_managed?[]:ids.filter(id=>policy.enrollment_mode==='project'?registry.get(id).legacy_member===1:registry.get(id).first_seen_at<=policy.created_at);
    if(policy.enrollment_mode==='project'&&(pilotStrategyAt(pilot,slot)!=='pools'||pilotSlotsAt(pilot,slot).length!==3||pilotTimeZoneAt(pilot,slot)!==normalizeTimeZone(policy.time_zone)))return [];
    return ids;
  };
  const forecasts=[],members=new Set();let nextSlotAt=0;
  for(const pilot of planRows.results){
    const reference=Math.max(now,pilot.created_at,policy?.enabled&&pilot.task_group_policy_id===policy.id?policy.starts_at:0);
    for(const id of candidates(pilot,reference))members.add(id);
    // Include near future slots in the forecast without changing dueSlots'
    // production admission gate or creating any additional publications.
    const times=[...new Set([...dueSlots(pilot,now),...dueSlots(pilot,now-AUTOPILOT.leadMs)])].filter(slot=>slot>now).sort((a,b)=>a-b);
    for(const slotAt of times){const ids=candidates(pilot,slotAt);if(!ids.length)continue;
      forecasts.push({owner:user.username,slotAt,accountCount:ids.length});
      if(!nextSlotAt||slotAt<nextSlotAt)nextSlotAt=slotAt;
    }
  }
  const reserved=await db.prepare("SELECT min(s.slot_at) slot FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id WHERE p.owner=? AND p.status='active' AND p.ends_at>? AND s.slot_at>? AND p.group_id IN (SELECT value FROM json_each(?))").bind(user.username,now,now,JSON.stringify([...new Set([...authorized.values()].map(a=>a.groupId))])).first();
  if(reserved?.slot&&(!nextSlotAt||reserved.slot<nextSlotAt))nextSlotAt=reserved.slot;
  return {accountCount:members.size,nextSlotAt,forecasts};
}

export async function readAutopilotProductionContext(env,user=null,directory=null,now=Date.now()){
  const [load,store,ownerRows]=await Promise.all([readProductionLoad(env.DB,now),loadGroupStore(env.DB),env.DB.prepare("SELECT DISTINCT owner FROM psychology_autopilots WHERE status='active' AND ends_at>?").bind(now).all()]);
  if(!directory){const stored=await kvGet(env.DB,DIRECTORY_KEY,null);directory={accounts:[],fullAccounts:stored?.accounts||[]};}
  const owners=new Map(),forecasts=[];
  const names=new Set([...(user?[user.username]:[]),...ownerRows.results.map(p=>p.owner)]);
  for(const owner of names){
    let actor=user,scope=directory;
    if(owner!==user?.username){
      try{actor=await loadAutoUser(env.DB,owner);}catch{continue;}
      scope=scopeOfficialAccess({accounts:directory.fullAccounts||[]},store,actor,'psychology');
    }
    const forecast=await readOwnerProductionForecast(env.DB,actor,scope,now);
    owners.set(owner,forecast);forecasts.push(...forecast.forecasts);
  }
  return {load:{...load,forecasts},owners};
}

// Only the three background checks refresh capacity. UI polling reads one
// owner-scoped snapshot and never scans shared queues or other owners' plans.
export async function refreshProductionCapacitySnapshots(env,now=Date.now()){
  const production=await readAutopilotProductionContext(env,null,null,now);
  for(const [owner,forecast] of production.owners){
    const capacity={...estimateProductionLead(production.load,{accountCount:forecast.accountCount,slotAt:forecast.nextSlotAt,owner,now:production.load.asOf}),nextSlotAt:forecast.nextSlotAt,minLeadMs:PRODUCTION_POLICY.minLeadMs,maxLeadMs:PRODUCTION_POLICY.maxLeadMs};
    await kvSet(env.DB,'psychology-production-capacity:'+owner,capacity);
  }
  return {refreshed:production.owners.size,asOf:production.load.asOf};
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

export async function runAutopilot(env, pilot, now = Date.now(), productionContext = null) {
  const db = env.DB, summary = { paused: [], batches: [], errors: [], skipped: [] };
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
  const directory=await autopilotDirectory(env,user,true);
  const accounts=directory.accounts.filter(a=>a.groupId===pilot.group_id);
  const ids = accounts.map(connectionOf);
  if (ids.length) await db.prepare(`INSERT OR IGNORE INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at)
    SELECT ?,value,CASE WHEN ?<>'' AND (SELECT a.status FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.owner=? AND a.connection_id=value ORDER BY a.updated_at DESC,p.updated_at DESC,a.autopilot_id LIMIT 1)='paused' THEN 'paused' ELSE 'active' END,
      CASE WHEN ?<>'' AND (SELECT a.status FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.owner=? AND a.connection_id=value ORDER BY a.updated_at DESC,p.updated_at DESC,a.autopilot_id LIMIT 1)='paused' THEN '保留既有暂停状态' ELSE '' END,? FROM json_each(?)`)
      .bind(pilot.id,pilot.task_group_policy_id||'',pilot.owner,pilot.task_group_policy_id||'',pilot.owner,now,JSON.stringify(ids)).run();
  const states = new Map((await db.prepare('SELECT connection_id,status FROM psychology_autopilot_accounts WHERE autopilot_id=?').bind(pilot.id).all()).results.map(r => [r.connection_id, r.status]));
  const videosByAccount = await loadVideosForAccounts(env, db, accounts.map(a => a.schema), 100);
  const pauses = guardAccounts({ connectionIds: ids.filter(id => states.get(id) === 'active'), outcomesByConnection: await pilotOutcomes(db, pilot.id, now) });
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
      if(pilotStrategyAt(pilot,now)==='pools'){
        const window=operationsWindow(new URLSearchParams({period:'30d'}),now);
        const {matching}=await readPoolReport(db,{ids:JSON.stringify([pilot.group_id]),window,media:'photo',now});
        const o=matching.overview.mature,pct=v=>v==null?'—':Math.round(v*100)+'%';
        await log(db,pilot.id,'daily','近30天 '+o.n+' 条满72小时 · 中位播放 '+(o.medianViews==null?'—':Math.round(o.medianViews))+' · 完播 '+pct(o.completion)+' · 优胜版本 '+matching.readiness.winnerVersions,
          {overview:o,previous:matching.overview.previousMature,matching,basis:matching.basis},now);
      }else{
      const window = operationsWindow(new URLSearchParams({ period: '7d' }), now);
      const { framework } = await frameworkFor(env, { accounts, window, media: 'photo', videosByAccount });
      const o = framework.overview.current, pct = v => v == null ? '—' : Math.round(v * 100) + '%';
      await log(db, pilot.id, 'daily', `近7天 ${o.n} 条满24小时 · 中位播放 ${o.medianViews == null ? '—' : Math.round(o.medianViews)} · 破千 ${pct(o.potentialRate)} · 破万 ${pct(o.hitRate)} · 完播 ${pct(o.completion)}`,
        { overview: o, previous: framework.overview.previous, stages: framework.accounts.stages.end, findings: framework.strategy.findings, observing: framework.overview.observing }, now);
      }
    } catch (error) { await log(db, pilot.id, 'error', '每日分析失败：' + String(error.message || error).slice(0, 300), {}, now); }
  }

  const active = ids.filter(id => states.get(id) === 'active');
  const production=productionContext||await readAutopilotProductionContext(env,user,directory,now);
  const forecast=production.owners.get(user.username)||await readOwnerProductionForecast(db,user,directory,now);
  const musicIds = (await kvGet(db, 'psychology-auto-music-pool', [])).filter(id => /^\d{1,30}$/.test(String(id))).slice(0, 100);
  for (const slot of dueSlots(pilot, now)) {
    const current = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(pilot.id).first();
    if (current?.status !== 'active') break;
    if(!dueSlots(current,now).includes(slot))continue;
    const claim = await db.prepare(`INSERT INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) SELECT ?,?,'creating',? FROM psychology_autopilots WHERE id=? AND status='active' AND updated_at=?
      ON CONFLICT(autopilot_id,slot_at) DO UPDATE SET status='creating',detail='',updated_at=excluded.updated_at WHERE status='failed'`).bind(pilot.id, slot, now, pilot.id, current.updated_at).run();
    if (!claim.meta?.changes) continue;
    const taskContext=await taskPublishContext(db,current,slot);
    const slotAccounts=await taskSlotAccounts(db,current,active,slot);
    if (!slotAccounts.length) {
      await db.prepare("UPDATE psychology_autopilot_slots SET status='skipped',detail='没有可发布的账号' WHERE autopilot_id=? AND slot_at=?").bind(pilot.id, slot).run();
      continue;
    }
    const productionPlan=estimateProductionLead(production.load,{accountCount:forecast.accountCount,slotAt:slot,owner:user.username,now});
    const batchIds = [], errors = [];
    let createdAccounts = 0;
    for (let offset = 0; offset < slotAccounts.length; offset += AUTOPILOT.maxAccountsPerBatch) {
      const connectionIds = slotAccounts.slice(offset, offset + AUTOPILOT.maxAccountsPerBatch).filter((id,index)=>sameDeliveryDay(slot,Math.floor(slot/1000)+(offset+index)*AUTOPILOT.staggerSeconds,current.ends_at,pilotTimeZoneAt(current,slot)));
      if(!connectionIds.length)continue;
      const body = { requestId: await uuidFrom(pilot.id + ':' + slot + ':' + connectionIds.join(',')), name: `自动运营 · ${pilot.group_name || pilot.group_id} · ${pilotLabel(current,slot)}`,
        // Staggered groups pair by their target-zone date and daily round.
        mediaType: 'photo', template: 'photo-text', sourceType: 'library', ...pilotLibraryConfig(current,slot), pairSeed: pilotPairSeed(current,slot), count: connectionIds.length, connectionIds,
        scheduleAt: Math.floor(slot / 1000) + offset * AUTOPILOT.staggerSeconds, intervalMinutes: 60, staggerSeconds: AUTOPILOT.staggerSeconds, styleMode: 'random', styleId: 'classic', musicIds };
      try {
        const response = await handlePsychologyAutoPublish(new Request('https://autopilot.internal/api/psychology-auto-publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
          env, new URL('https://autopilot.internal/api/psychology-auto-publish'), { user }, { productionLeadMs:productionPlan.leadMs,productionPlan,...taskContext });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '创建失败');
        if (Array.isArray(data.skipped) && data.skipped.length) {
          summary.skipped.push(...data.skipped);
          await log(db,pilot.id,'matching','账号池匹配跳过 '+data.skipped.length+' 个号：'+data.skipped.map(a => a.connectionId + ' ' + a.reason).join('；').slice(0,1000),{slot,skipped:data.skipped},now);
        }
        if (!data.batchId) continue;
        batchIds.push(data.batchId);
        createdAccounts += Number.isInteger(data.count) ? data.count : connectionIds.length;
        await db.prepare('UPDATE psychology_autopilot_slots SET batch_id=? WHERE autopilot_id=? AND slot_at=?').bind(batchIds.join(','), pilot.id, slot).run();
        const fresh = await db.prepare('SELECT status,stop_pending FROM psychology_autopilots WHERE id=?').bind(pilot.id).first();
        if (fresh?.status !== 'active' && fresh?.stop_pending) await stopPending(db, pilot.id);
        const stoppedAccounts = await db.prepare("SELECT connection_id FROM psychology_autopilot_accounts WHERE autopilot_id=? AND status='paused' AND stop_pending=1").bind(pilot.id).all();
        for (const a of stoppedAccounts.results) await stopPending(db, pilot.id, a.connection_id);
        if (fresh?.status !== 'active') break;
      } catch (error) { errors.push(String(error.message || error).slice(0, 300)); }
    }
    const status = batchIds.length ? 'created' : errors.length ? 'failed' : 'skipped', detail = errors.join('；') || (!batchIds.length ? '账号池匹配没有合格候选，等待复查或内容成熟' : '');
    await db.prepare('UPDATE psychology_autopilot_slots SET status=?,batch_id=?,detail=?,updated_at=? WHERE autopilot_id=? AND slot_at=?').bind(status, batchIds.join(','), detail, Date.now(), pilot.id, slot).run();
    if (batchIds.length) { summary.batches.push(...batchIds); await log(db, pilot.id, 'batch', `已排 ${pilotLabel(current,slot)} 的发布：${createdAccounts} 个号`, { slot, batchIds, accounts: createdAccounts }, now); }
    if (errors.length) { summary.errors.push(...errors); await log(db, pilot.id, 'error', `${pilotLabel(current,slot)} 创建失败：${detail}`, { slot }, now); }
  }
  await fillMissingSlotAccounts(env, db, pilot, user, active, musicIds, now, summary, production, forecast);
  return summary;
}

// Active accounts with no live item on an already-created future slot get one
// supplementary batch. A cancelled future item is replaced; past slots are left alone.
async function fillMissingSlotAccounts(env, db, pilot, user, active, musicIds, now, summary, production, forecast) {
  if (!active.length || pilot.status !== 'active') return;
  const slots = (await db.prepare(`SELECT slot_at,batch_id FROM psychology_autopilot_slots
    WHERE autopilot_id=? AND status='created' AND slot_at>? AND slot_at<? ORDER BY slot_at`).bind(pilot.id, now + 5 * 60000, pilot.ends_at).all()).results;
  for (const slot of slots) {
    const current = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(pilot.id).first();
    if (current?.status !== 'active') break;
    const batchIds = String(slot.batch_id || '').split(',').filter(Boolean);
    if (!batchIds.length) continue;
    const present = new Set((await db.prepare('SELECT connection_id FROM psychology_publish_items WHERE deleted_at=0 AND batch_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(batchIds)).all()).results.map(r => r.connection_id));
    const taskContext=await taskPublishContext(db,current,slot.slot_at);
    const eligible=await taskSlotAccounts(db,current,active,slot.slot_at);
    const missing = eligible.filter(id => !present.has(id));
    if (!missing.length) continue;
    const maxRow = await db.prepare('SELECT MAX(schedule_at) AS last FROM psychology_publish_items WHERE deleted_at=0 AND batch_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(batchIds)).first();
    const base = maxRow?.last ? Number(maxRow.last) + AUTOPILOT.staggerSeconds : Math.floor(slot.slot_at / 1000);
    const productionPlan=estimateProductionLead(production.load,{accountCount:forecast.accountCount,slotAt:slot.slot_at,owner:user.username,now});
    const added = [], errors = [];
    let restoredAccounts = 0;
    for (let offset = 0; offset < missing.length; offset += AUTOPILOT.maxAccountsPerBatch) {
      const connectionIds = missing.slice(offset, offset + AUTOPILOT.maxAccountsPerBatch).filter((id,index)=>sameDeliveryDay(slot.slot_at,base+(offset+index)*AUTOPILOT.staggerSeconds,current.ends_at,pilotTimeZoneAt(current,slot.slot_at)));
      if(!connectionIds.length)continue;
      const body = { requestId: await uuidFrom(pilot.id + ':restore:' + slot.slot_at + ':' + connectionIds.join(',')), name: `自动运营 · ${current.group_name || current.group_id} · ${pilotLabel(current,slot.slot_at)} · 补排`,
        mediaType: 'photo', template: 'photo-text', sourceType: 'library', ...pilotLibraryConfig(current,slot.slot_at), pairSeed: pilotPairSeed(current, slot.slot_at), count: connectionIds.length, connectionIds,
        scheduleAt: base + offset * AUTOPILOT.staggerSeconds, intervalMinutes: 60, staggerSeconds: AUTOPILOT.staggerSeconds, styleMode: 'random', styleId: 'classic', musicIds };
      try {
        const response = await handlePsychologyAutoPublish(new Request('https://autopilot.internal/api/psychology-auto-publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
          env, new URL('https://autopilot.internal/api/psychology-auto-publish'), { user }, { productionLeadMs:productionPlan.leadMs,productionPlan,...taskContext });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '创建失败');
        if (Array.isArray(data.skipped) && data.skipped.length) {
          summary.skipped.push(...data.skipped);
          await log(db,pilot.id,'matching','补排匹配跳过 '+data.skipped.length+' 个号：'+data.skipped.map(a => a.connectionId + ' ' + a.reason).join('；').slice(0,1000),{slot:slot.slot_at,skipped:data.skipped},now);
        }
        if (!data.batchId) continue;
        if (!batchIds.includes(data.batchId)) batchIds.push(data.batchId);
        added.push(data.batchId);
        restoredAccounts += Number.isInteger(data.count) ? data.count : connectionIds.length;
        await db.prepare('UPDATE psychology_autopilot_slots SET batch_id=?,updated_at=? WHERE autopilot_id=? AND slot_at=?').bind(batchIds.join(','), Date.now(), pilot.id, slot.slot_at).run();
      } catch (error) { errors.push(String(error.message || error).slice(0, 300)); }
    }
    if (added.length) { summary.batches.push(...added); await log(db, pilot.id, 'batch', `已补排 ${pilotLabel(current,slot.slot_at)}：恢复 ${restoredAccounts} 个号`, { slot: slot.slot_at, batchIds: added, accounts: restoredAccounts }, now); }
    if (errors.length) { const detail = errors.join('；'); summary.errors.push(...errors); await log(db, pilot.id, 'error', `${pilotLabel(current,slot.slot_at)} 补排失败：${detail}`, { slot: slot.slot_at }, now); }
  }
}

export async function runAutopilots(env, now = Date.now()) {
  const results = {};
  // Reconcile project membership before scheduling, including newly authorized
  // publishing accounts in permission groups with no delivery executor yet.
  const policies=(await env.DB.prepare('SELECT owner FROM psychology_task_group_policies WHERE enabled=1 AND ends_at>?').bind(now).all()).results;
  for(const policy of policies){
    try {const user=await loadAutoUser(env.DB,policy.owner);await reconcileTaskExecutors(env,user,await autopilotDirectory(env,user,true),now);}
    catch(error){results['task-groups:'+policy.owner]={error:error.message};}
  }
  let production=null;
  const first=await env.DB.prepare("SELECT owner FROM psychology_autopilots WHERE status='active' AND ends_at>? ORDER BY id LIMIT 1").bind(now).first();
  if(first){
    try{const user=await loadAutoUser(env.DB,first.owner),directory=await autopilotDirectory(env,user,true);production=await readAutopilotProductionContext(env,user,directory,now);}catch{}
  }
  let cursor='';
  // Keyset pagination prevents new executors beyond the old first-20 limit
  // from being permanently starved; every active plan is processed once.
  while(true){
    const pilots=(await env.DB.prepare("SELECT * FROM psychology_autopilots WHERE status='active' AND id>? ORDER BY id LIMIT 20").bind(cursor).all()).results;
    if(!pilots.length)break;
    for (const pilot of pilots) {
      try { results[pilot.id] = await runAutopilot(env, pilot, now, production); }
      catch (error) { results[pilot.id] = { error: error.message }; await log(env.DB, pilot.id, 'error', '运行失败：' + String(error.message || error).slice(0, 300), {}, now).catch(() => {}); }
    }
    cursor=pilots.at(-1).id;
  }
  Object.defineProperty(results,'productionContext',{value:production,enumerable:false});
  return results;
}

export function autopilotViewWindow(period = 'today', now = Date.now()) {
  if (!['today','yesterday','7d'].includes(period)) fail('请选择今天、昨天或近7天。',400);
  const dayStart=Date.parse(beijingDate(now)+'T00:00:00+08:00');
  const start=dayStart-(period==='yesterday'?DAY:period==='7d'?6*DAY:0);
  const end=period==='yesterday'?dayStart:dayStart+DAY;
  return {period,start,end,from:beijingDate(start),to:beijingDate(end-1),label:{today:'今天',yesterday:'昨天','7d':'近7天'}[period]};
}

export async function handlePsychologyAutopilot(request, env, url, session, apiOptions = {}) {
  if (!url.pathname.startsWith(BASE)) return null;
  const user = session?.user;
  if (user?.role !== 'admin' || !(user.sidebarModules || []).includes('psychology-autopilot')) fail('没有自动运营权限。', 403);
  if (request.method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail('不允许跨站修改。', 403);
  const db = env.DB;
  if(url.pathname===BASE+'/dashboard')return handleAutopilotDashboard(request,env,url,user);
  if(url.pathname===BASE+'/transition-day'||url.pathname===BASE+'/transition-day/run'){
    if(apiOptions.external)fail('过渡排期请在自动运营页面管理。',403);
    return handleTransitionDay(request,env,url,session);
  }
  if(url.pathname===BASE+'/task-groups'||url.pathname.startsWith(BASE+'/task-groups/')){
    if(apiOptions.external)fail('此配置请在自动运营页面管理。',403);
    const directory=await autopilotDirectory(env,user,request.method!=='GET'||url.searchParams.get('refreshGroups')==='1');
    return handleTaskGroups(request,env,url,user,{directory});
  }
  if (url.pathname === BASE && request.method === 'GET') {
    const window=autopilotViewWindow(url.searchParams.get('period') || 'today');
    const page=apiOptions.external?Number(url.searchParams.get('page')||1):1,pageSize=apiOptions.external?Number(url.searchParams.get('pageSize')||20):20;
    if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail('分页参数无效。');
    const only=apiOptions.pilotId||'';
    const directory=await autopilotDirectory(env,user,url.searchParams.get('refreshGroups')==='1');
    // Historical logs can contain former members: external callers must retain
    // access to every recorded member as well as the plan's group.
    const scope=apiOptions.external?` AND group_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM psychology_autopilot_accounts a WHERE a.autopilot_id=psychology_autopilots.id AND a.connection_id NOT IN (SELECT value FROM json_each(?)))`:'';
    const args=[user.username,only,only,...(apiOptions.external?[JSON.stringify(directory.groups.map(g=>g.id)),JSON.stringify(directory.accounts.map(connectionOf))]:[])];
    const [pilots,total]=await Promise.all([db.prepare("SELECT * FROM psychology_autopilots WHERE owner=? AND (?='' OR id=?)"+scope+" ORDER BY created_at DESC,id LIMIT ? OFFSET ?").bind(...args,pageSize,(page-1)*pageSize).all(),db.prepare("SELECT count(*) n FROM psychology_autopilots WHERE owner=? AND (?='' OR id=?)"+scope).bind(...args).first()]);
    const groups = directory.groups;
    const labels = new Map([...accountsFromLatestArchive(await listLatestArchiveAccounts(db)), ...directory.accounts].map(a => [connectionOf(a), a.profile?.username || a.username || a.label || '']));
    const pilotIds = JSON.stringify(pilots.results.map(p => p.id));
    // One round trip for all pilots; per-pilot windows preserve list limits.
    const [accountRows, slotRows, logRows, dailyRows, performanceRows] = await db.batch([
      db.prepare('SELECT * FROM psychology_autopilot_accounts WHERE autopilot_id IN (SELECT value FROM json_each(?)) ORDER BY status DESC,connection_id').bind(pilotIds),
      db.prepare(`SELECT * FROM psychology_autopilot_slots WHERE autopilot_id IN (SELECT value FROM json_each(?)) AND slot_at>=? AND slot_at<? ORDER BY autopilot_id,slot_at DESC`).bind(pilotIds,window.start,window.end),
      db.prepare(`SELECT * FROM (SELECT autopilot_id,kind,message,created_at,ROW_NUMBER() OVER (PARTITION BY autopilot_id ORDER BY created_at DESC,id DESC) rn FROM psychology_autopilot_log WHERE autopilot_id IN (SELECT value FROM json_each(?)) AND created_at>=? AND created_at<?) WHERE rn<=60 ORDER BY autopilot_id,rn`).bind(pilotIds,window.start,window.end),
      db.prepare(`SELECT * FROM (SELECT autopilot_id,message,detail_json,created_at,ROW_NUMBER() OVER (PARTITION BY autopilot_id ORDER BY created_at DESC,id DESC) rn FROM psychology_autopilot_log WHERE kind='daily' AND autopilot_id IN (SELECT value FROM json_each(?))) WHERE rn=1`).bind(pilotIds),
      db.prepare(`WITH ranked AS (
        SELECT pilot_id,views,row_number() OVER(PARTITION BY pilot_id ORDER BY views,id) rn,count(*) OVER(PARTITION BY pilot_id) n
        FROM ops_task_facts WHERE media='photo' AND pilot_id IN (SELECT value FROM json_each(?))
          AND published_at>=? AND published_at<? AND state='published' AND views IS NOT NULL)
        SELECT pilot_id,count(*) n,avg(CASE WHEN rn IN ((n+1)/2,(n+2)/2) THEN views END) medianViews,
          avg(CASE WHEN views>=1000 THEN 1.0 ELSE 0.0 END) potentialRate
        FROM ranked GROUP BY pilot_id`).bind(pilotIds,window.start,window.end),
    ]);
    const allItems = await slotExecution(db, slotRows.results, labels);
    const out = [];
    for (const p of pilots.results) {
      const accounts = {results:accountRows.results.filter(a => a.autopilot_id===p.id)};
      const slots = {results:slotRows.results.filter(s => s.autopilot_id===p.id)};
      const logs = {results:logRows.results.filter(l => l.autopilot_id===p.id)};
      const daily = dailyRows.results.find(l => l.autopilot_id===p.id);
      // Times overlap between groups; ownership must be matched by batch ID.
      const batchIds = new Set(slots.results.flatMap(s => String(s.batch_id||'').split(',').filter(Boolean)));
      const items = allItems.filter(i => batchIds.has(i.batchId) && i.scheduleAt >= window.start && i.scheduleAt < window.end);
      const dayStart = Date.parse(beijingDate(Date.now()) + 'T00:00:00+08:00');
      const today = executionCounts(items.filter(i => i.scheduleAt >= dayStart && i.scheduleAt < dayStart + DAY));
      const attention = items.filter(i => i.error || i.retrying || ['missing','production_failed','publish_failed'].includes(i.state));
      out.push({ id: p.id, groupId: p.group_id, groupName: p.group_name, strategy: pilotStrategyAt(p,Date.now()), strategyLabel: STRATEGIES[pilotStrategyAt(p,Date.now())], pendingStrategy:p.strategy_effective_at>Date.now()?p.pending_strategy||null:null, strategyEffectiveAt:p.strategy_effective_at>Date.now()?p.strategy_effective_at:0, status: p.status, endsAt: p.ends_at, createdAt: p.created_at, revision:p.updated_at,
        today, execution:executionCounts(items), performance:performanceRows.results.find(r=>r.pilot_id===p.id)||{n:0,medianViews:null,potentialRate:null}, attention, lastRunError:logs.results.find(l=>l.kind==='error' && l.created_at>=p.last_run_at)?.message || '', lastRunAt:p.last_run_at, nextCheckAt:p.status === 'active' ? nextAutopilotCheck() : null, stopPending:Boolean(p.stop_pending),
        timeZone:pilotTimeZoneAt(p,Date.now()), pendingTimeZone:p.slots_effective_at>Date.now()?normalizeTimeZone(p.pending_schedule_timezone||p.schedule_timezone):null, slots: pilotSlotsAt(p,Date.now()), pendingSlots:p.slots_effective_at>Date.now()?JSON.parse(p.pending_slots_json):null, scheduleEffectiveAt:p.slots_effective_at>Date.now()?p.slots_effective_at:0, accounts: accounts.results.map(a => ({ connectionId: a.connection_id, name: labels.get(a.connection_id) || a.connection_id, status: a.status, reason: a.reason, updatedAt: a.updated_at, revision:a.updated_at, stopPending:Boolean(a.stop_pending) })),
        schedule: slots.results.map(s => ({ slotAt: s.slot_at, status: s.status, batchIds: s.batch_id ? s.batch_id.split(',') : [], detail: s.detail, counts:executionCounts(items.filter(i => i.slotAt === s.slot_at)) })),
        latest: daily ? { at: daily.created_at, message: daily.message, ...parseObject(daily.detail_json) } : null,
        logs: logs.results.map(l => ({ kind: l.kind, message: l.message, at: l.created_at })) });
    }
    const productionCapacity=await kvGet(db,'psychology-production-capacity:'+user.username,null);
    return json({ page,pageSize,total:total.n,totalPages:Math.max(1,Math.ceil(total.n/pageSize)),hasMore:page*pageSize<total.n,window, productionCapacity, pilots: out, groups, strategies: STRATEGIES, strategyRules:strategyRules(), evolutionRules:EVOLUTION, testingRules:TEST_RULES, poolRules:POOL_POLICY, accountPools:ACCOUNT_POOLS, contentPools:CONTENT_POOLS, rules: AUTOPILOT, fetchedAt:Date.now(), groupsUpdatedAt:directory.updatedAt });
  }
  if (url.pathname === BASE && request.method === 'POST') {
    const body = await readJson(request), days = Number(body.days || 7), slots = normalizePilotSlots(body.slots ?? (body.strategy === 'pools' ? AUTOPILOT.slots.slice(0,2) : AUTOPILOT.slots));
    const timeZone=normalizeTimeZone(body.timeZone);
    if(body.startNow !== undefined && typeof body.startNow !== 'boolean')fail('立即准备选项无效。');
    if (!Object.hasOwn(STRATEGIES, body.strategy)) fail('请选择运营策略。');
    if (!Number.isInteger(days) || days < 1 || days > 30) fail('运行天数应为 1–30 天。');
    let apiId='',apiHash='';
    if(apiOptions.external){
      if(!/^[a-f0-9-]{36}$/i.test(body.requestId||''))fail('新增须填写 UUID requestId，重试沿用同一个值。');
      apiId='pilot-'+await uuidFrom(user.username+':'+body.requestId);
      apiHash=await sha256Hex(JSON.stringify([body.groupId,body.strategy,days,slots,body.startNow===true,...(timeZone===DEFAULT_TIME_ZONE?[]:[timeZone])]));
      const prior=await db.prepare('SELECT id,group_id,api_request_hash,status,updated_at FROM psychology_autopilots WHERE id=? AND owner=?').bind(apiId,user.username).first();
      if(prior){if(!(await autopilotDirectory(env,user)).groups.some(g=>g.id===prior.group_id))fail('没有这个心理学分组的权限。',403);if(prior.api_request_hash!==apiHash)fail('requestId 已用于不同运营设置。',409);return json({id:prior.id,status:prior.status,revision:prior.updated_at,duplicate:true});}
    }
    const group = (await autopilotDirectory(env, user, true)).groups.find(g => g.id === body.groupId);
    if (!group) fail('没有这个心理学分组的权限。', 403);
    if (!group.accounts) fail('这个分组里还没有已授权且有发布权限的账号，请检查分组成员和账号授权。');
    validateDayEnd(slots, group.accounts);
    if (await db.prepare("SELECT 1 FROM psychology_autopilots WHERE group_id=? AND status<>'ended'").bind(group.id).first()) fail('这个分组已经在自动运营中。', 409);
    const now = Date.now(), id = apiId || 'pilot-' + crypto.randomUUID(), initialStatus=apiOptions.external?'paused':'active';
    await db.prepare(`INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at,start_now,api_request_hash,current_strategy,strategy_started_at,schedule_timezone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, user.username, group.id, group.name, body.strategy==='pools'?'evolve':body.strategy, JSON.stringify(slots),initialStatus, addZonedDays(now,days,timeZone), now, now, Number(body.startNow===true),apiHash,body.strategy,now,timeZone).run();
    if(apiOptions.external){await log(db,id,'status','通过管理 API 创建，已暂停；明确恢复后才会新增排期。',{},now);return json({id,status:initialStatus,revision:now},201);}
    await log(db, id, 'status', `开始自动运营 ${days} 天：${STRATEGIES[body.strategy]}，${group.accounts} 个号，每号每天 ${slots.length} 条，${timeZoneLabel(timeZone)} ${slotLabel(slots)}；${body.startNow?'首日不足 2 小时、距离发布超过 10 分钟的时段立即准备；':''}其余按账号数与积压提前 ${PRODUCTION_POLICY.minLeadMs/HOUR}–${PRODUCTION_POLICY.maxLeadMs/HOUR} 小时开始生成。`, {}, now);
    const pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=?').bind(id).first();
    return json({ id, run: await runAutopilot(env, pilot, now) });
  }
  const one = url.pathname.match(/^\/api\/psychology-autopilot\/(pilot-[0-9a-f-]{36})(?:\/(run|impact|schedule|strategy|slots\/(\d+)|accounts\/([^/]+)))?$/);
  if (!one) fail('不支持此请求。', 405);
  const pilot = await db.prepare('SELECT * FROM psychology_autopilots WHERE id=? AND owner=?').bind(one[1], user.username).first();
  if (!pilot) fail('自动运营不存在。', 404);
  const now = Date.now();
  if(apiOptions.external){
    const directory=await autopilotDirectory(env,user);
    const allowed=directory.groups.some(g=>g.id===pilot.group_id);
    if(!allowed)fail('没有这个心理学分组的权限。',403);
    const ids=new Set(directory.accounts.map(connectionOf));
    const members=(await db.prepare('SELECT connection_id FROM psychology_autopilot_accounts WHERE autopilot_id=?').bind(pilot.id).all()).results;
    if(members.some(a=>!ids.has(a.connection_id)))fail('此运营包含当前权限之外的历史账号，请在后台处理分组权限。',403);
    const account=one[4]?decodeURIComponent(one[4]):url.searchParams.get('account');
    if(account&&!directory.accounts.some(a=>connectionOf(a)===account&&a.groupId===pilot.group_id))fail('没有此分组账号的操作权限。',403);
    if(request.method==='PATCH'&&!one[4]){
      const body=await request.clone().json();
      if(!Number.isSafeInteger(body.revision)||body.revision!==pilot.updated_at)fail('revision 缺失或运营设置已修改，请重新读取。',409);
    }
  }
  if (one[2] === 'strategy' && request.method === 'PATCH') {
    if (pilot.status === 'ended') fail('已结束的自动运营不能接续策略。',409);
    const body = await readJson(request), days = Number(body.days ?? 7);
    if (body.strategy !== 'pools') fail('接续策略请选择账号池与内容池匹配。');
    if (!Number.isInteger(days) || days < 1 || days > 30) fail('运行天数应为 1–30 天。');
    if (!Number.isSafeInteger(body.revision) || body.revision !== pilot.updated_at) fail('revision 缺失或运营设置已修改，请重新读取。',409);
    const group=(await autopilotDirectory(env,user,true)).groups.find(g=>g.id===pilot.group_id);
    if(!group)fail('没有这个心理学分组的权限。',403);
    if(!group.accounts)fail('此分组没有可发布账号。');
    const latest=await db.prepare('SELECT MAX(slot_at) last_slot FROM psychology_autopilot_slots WHERE autopilot_id=?').bind(pilot.id).first();
    if(pilot.strategy_effective_at>now && Number(latest?.last_slot)>=pilot.strategy_effective_at)fail('待生效策略已开始创建排期，请在策略生效后再修改。',409);
    const timeZone=pilotTimeZoneAt(pilot,Math.max(now,Number(latest?.last_slot)||0,Number(pilot.slots_effective_at)||0));
    const effectiveAt=nextDay(Math.max(now,Number(latest?.last_slot)||0,(Number(pilot.slots_effective_at)||0)-1),timeZone);
    const endsAt=addZonedDays(effectiveAt,days,timeZone), stamp=Math.max(now,pilot.updated_at+1), strategy=pilotStrategyAt(pilot,now);
    const changed=await db.prepare("UPDATE psychology_autopilots SET current_strategy=?,strategy_started_at=?,pending_strategy=?,strategy_effective_at=?,ends_at=?,updated_at=? WHERE id=? AND owner=? AND status<>'ended' AND updated_at=? AND NOT EXISTS (SELECT 1 FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at>=?)")
      .bind(strategy,pilotStrategyStartAt(pilot,now),'pools',effectiveAt,endsAt,stamp,pilot.id,user.username,pilot.updated_at,pilot.id,effectiveAt).run();
    if(!changed.meta?.changes)fail('运营设置或排期刚被修改，请刷新后重试。',409);
    await log(db,pilot.id,'status','账号池与内容池匹配将于 '+timeZoneLabel(timeZone)+' '+zonedDate(effectiveAt,timeZone)+' 起接续 '+days+' 天；已创建任务继续原计划，账号暂停状态保持。',{strategy:'pools',effectiveAt,endsAt},now);
    return json({ok:true,strategy,pendingStrategy:'pools',effectiveAt,strategyEffectiveAt:effectiveAt,endsAt,revision:stamp});
  }
  if (one[2] === 'schedule' && request.method === 'PATCH') {
    if(pilot.status==='ended')fail('已结束的自动运营不能修改发布设置。',409);
    const body=await readJson(request);if(!Array.isArray(body.slots))fail('请设置每天的发布时间。');
    const slots=normalizePilotSlots(body.slots), timeZone=normalizeTimeZone(body.timeZone??pilotTimeZoneAt(pilot,Math.max(now,Number(pilot.slots_effective_at)||0)));
    const group=(await autopilotDirectory(env,user,true)).groups.find(g=>g.id===pilot.group_id);
    if(!group)fail('没有这个心理学分组的权限。',403);
    validateDayEnd(slots,group.accounts);
    // Changes start on a whole target-zone day after all already-created/reserved slots.
    // Existing generation and publishing snapshots remain immutable.
    const latest=await db.prepare('SELECT MAX(slot_at) last_slot FROM psychology_autopilot_slots WHERE autopilot_id=?').bind(pilot.id).first();
    if(pilot.slots_effective_at>now && Number(latest?.last_slot)>=pilot.slots_effective_at)fail('待生效设置已开始创建排期，请在该设置生效后再修改；已创建任务继续原计划。',409);
    const linkedPolicy=pilot.task_group_policy_id?await db.prepare('SELECT time_zone,starts_at,ends_at FROM psychology_task_group_policies WHERE id=? AND enabled=1 AND ends_at>?').bind(pilot.task_group_policy_id,now).first():null;
    const effectiveAt=Math.max(nextDay(Math.max(now,Number(latest?.last_slot)||0),timeZone),Number(linkedPolicy?.starts_at)||0);
    if(effectiveAt>=pilot.ends_at)fail('本次运营结束前已无完整日期可应用新设置，请新建运营计划。',409);
    const taskPolicy=linkedPolicy&&linkedPolicy.ends_at>effectiveAt?linkedPolicy:null;
    if(taskPolicy&&(timeZone!==normalizeTimeZone(taskPolicy.time_zone)||slots.length!==3))fail('项目自动运营期间须保持项目时区及每天3条，请在项目设置中统一调整时区。',409);
    const changed=await db.prepare("UPDATE psychology_autopilots SET slots_json=?,pending_slots_json=?,slots_effective_at=?,schedule_timezone=?,pending_schedule_timezone=?,updated_at=? WHERE id=? AND status<>'ended' AND updated_at=? AND NOT EXISTS (SELECT 1 FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at>=?)")
      .bind(JSON.stringify(pilotSlotsAt(pilot,now)),JSON.stringify(slots),effectiveAt,pilotTimeZoneAt(pilot,now),timeZone,Math.max(now,pilot.updated_at+1),pilot.id,pilot.updated_at,pilot.id,effectiveAt).run();
    if(!changed.meta?.changes)fail('运营设置刚被修改，请刷新后重试。',409);
    await log(db,pilot.id,'status',`发布设置已更新：每号每天 ${slots.length} 条，${timeZoneLabel(timeZone)} ${slotLabel(slots)}，${zonedDate(effectiveAt,timeZone)} 起生效；已创建任务继续原计划。`,{slots,timeZone,effectiveAt},now);
    return json({ok:true,slots,timeZone,effectiveAt,revision:Math.max(now,pilot.updated_at+1)});
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
    const body = await readJson(request), status = body.status ?? pilot.status;
    if (body.stopPending !== undefined && typeof body.stopPending !== 'boolean') fail('暂停范围无效。');
    if (!['active', 'paused', 'ended'].includes(status)) fail('状态无效。');
    if (pilot.status === 'ended') fail('已结束的自动运营不能再修改。', 409);
    const strategy=apiOptions.external?(body.strategy??pilotStrategyAt(pilot,now)):pilotStrategyAt(pilot,now);
    if(apiOptions.external&&body.strategy==='pools'&&pilotStrategyAt(pilot,now)!=='pools')fail('切换账号池匹配请使用 /strategy 未来接续接口。',409);
    if(apiOptions.external&&body.strategy!==undefined&&pilot.strategy_effective_at>now)fail('已有待生效策略，请等待生效后再修改当前策略。',409);
    const endsAt=apiOptions.external?(body.endsAt??pilot.ends_at):pilot.ends_at;
    if(!Object.hasOwn(STRATEGIES,strategy))fail('运营策略无效。');
    if(apiOptions.external&&(body.endsAt!==undefined||status==='active')&&(!Number.isSafeInteger(endsAt)||endsAt<=now||endsAt>now+30*DAY))fail('endsAt 须为未来 30 天内的毫秒时间戳。');
    if(status==='active'&&apiOptions.external&&!user.sidebarModules.includes('psychology-publish'))fail('没有自动发布权限。',403);
    const stamp=Math.max(now,pilot.updated_at+1);
    const changing=apiOptions.external&&body.strategy!==undefined&&strategy!==pilotStrategyAt(pilot,now);
    const result=await db.prepare('UPDATE psychology_autopilots SET status=?,stop_pending=?,strategy=?,current_strategy=?,strategy_started_at=?,pending_strategy=?,strategy_effective_at=?,ends_at=?,updated_at=? WHERE id=? AND owner=? AND updated_at=?')
      .bind(status,status==='active'?0:Number(body.stopPending??pilot.stop_pending),strategy==='pools'?pilot.strategy:strategy,changing?strategy:pilot.current_strategy||'',changing?now:pilot.strategy_started_at||0,changing?'':pilot.pending_strategy||'',changing?0:pilot.strategy_effective_at||0,endsAt,stamp,pilot.id,user.username,pilot.updated_at).run();
    if(!result.meta?.changes)fail('运营设置已变化，请重新读取。',409);
    const stopped = status !== 'active' && body.stopPending ? await stopPending(db, pilot.id) : 0;
    await log(db, pilot.id, 'status', { active: '已恢复自动运营。', paused: body.stopPending ? '已暂停自动运营并停止本地尚未提交的任务。' : '已暂停新增排期，已排好的发布照常进行。', ended: '已结束自动运营。' }[status], {}, now);
    if (body.stopPending) await log(db, pilot.id, 'status', `已停止本地尚未提交的 ${stopped} 条任务；已进入提交的任务仍会继续。恢复不重新创建已停止任务。`, {}, now);
    return json({ ok: true, stopped,revision:stamp,status,strategy,endsAt });
  }
  if (one[2] === 'run' && request.method === 'POST') {
    if (pilot.status !== 'active') fail('请先恢复自动运营。', 409);
    return json(await runAutopilot(env, pilot, now));
  }
  if (one[4] && request.method === 'PATCH') {
    const body = await readJson(request), status = body.status, connectionId = decodeURIComponent(one[4]);
    if (pilot.status === 'ended') fail('已结束的自动运营不能再修改。', 409);
    if (!['active', 'paused'].includes(status)) fail('状态无效。');
    const saved=await db.prepare('SELECT updated_at FROM psychology_autopilot_accounts WHERE autopilot_id=? AND connection_id=?').bind(pilot.id,connectionId).first();
    if(!saved)fail('账号不在这个自动运营里。',404);
    if(apiOptions.external&&(!Number.isSafeInteger(body.revision)||body.revision!==saved.updated_at))fail('账号状态已变化，请重新读取。',409);
    const stamp=Math.max(now,saved.updated_at+1);
    const result = await db.prepare('UPDATE psychology_autopilot_accounts SET status=?,stop_pending=?,reason=?,updated_at=? WHERE autopilot_id=? AND connection_id=? AND updated_at=?')
      .bind(status, status === 'paused' ? 1 : 0, status === 'paused' ? '手动停发' : '', stamp, pilot.id, connectionId,saved.updated_at).run();
    if (!result.meta?.changes) fail('账号不在这个自动运营里。', 404);
    const stopped = status === 'paused' ? await stopPending(db, pilot.id, connectionId) : 0;
    await log(db, pilot.id, status === 'paused' ? 'pause' : 'resume', (status === 'paused' ? '手动停发账号 ' : '已恢复账号 ') + connectionId, { connectionId }, now);
    return json({ ok: true, stopped,revision:stamp });
  }
  fail('不支持此请求。', 405);
}
