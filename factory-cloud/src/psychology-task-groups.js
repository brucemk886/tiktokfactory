import { json, errorJson, readJson } from './http.js';
import { toPublicUser } from './auth.js';
import { reportAccountScopeSQL } from './official-report-account-scope.js';
import { readPoolMatchingState } from './psychology-pool-report.js';
import { ensureModuleProjects, findProjectForModule, userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { TASK_GROUP_ROLES, assignTaskGroupRoles } from '../../scripts/psychology-task-group-policy.js';
import { DEFAULT_TIME_ZONE, PACIFIC_TIME_ZONE, normalizeTimeZone, nextDay, zonedDate, zonedEpoch, addZonedDays, pilotTimeZoneAt } from '../../scripts/psychology-schedule-time.js';

const BASE='/api/psychology-autopilot/task-groups';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=(value,fallback={})=>{try{return JSON.parse(value||'');}catch{return fallback;}};
const connectionOf=a=>String(a.connectionId||a.id||a.schema||'').replace(/^tiktok:/,'');
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const publicPolicy=p=>p?{id:p.id,enabled:Boolean(p.enabled),revision:p.revision,startsAt:p.starts_at,endsAt:p.ends_at,
 timeZone:normalizeTimeZone(p.time_zone),prestartCutoffAt:p.prestart_cutoff_at||0,cycleDays:7,reviewDays:3,lastReviewAt:p.last_review_at,nextReviewAt:p.next_review_at,reviewTarget:p.review_target,
 admitNewAccounts:Boolean(p.admit_new_accounts),enrollmentMode:p.enrollment_mode||'selected',projectId:p.project_key,sourcePilotIds:parse(p.source_pilot_ids_json,[])}:null;
const poolReady=p=>p.current_strategy==='pools'||p.pending_strategy==='pools';
const threeSlots=(p,time)=>{const slots=parse(p.slots_effective_at&&time>=p.slots_effective_at?p.pending_slots_json:p.slots_json,[]);return Array.isArray(slots)&&slots.length===3&&new Set(slots.map(s=>`${s.hour}:${s.minute}`)).size===3;};
const compatible=(p,time,timeZone)=>threeSlots(p,time)&&(!timeZone||pilotTimeZoneAt(p,time)===timeZone)&&(p.pending_strategy&&p.strategy_effective_at&&time>=p.strategy_effective_at?p.pending_strategy==='pools':p.current_strategy==='pools');


// Legacy jobs have no task-group daily claim. Keep their account/date reserved
// even after the old plan ends or the account changes administrative groups.
export const taskLegacyReservationsSQL=`SELECT i.connection_id,i.schedule_at*1000 reserved_at FROM psychology_publish_items i
 JOIN psychology_publish_batches b ON b.id=i.batch_id LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id
 WHERE i.connection_id IN (SELECT value FROM json_each(?)) AND i.schedule_at*1000>=? AND (i.deleted_at=0 OR g.status='submitting' OR COALESCE(g.request_json,'{}')<>'{}')
 AND NOT EXISTS(SELECT 1 FROM psychology_task_group_allocations a WHERE a.item_id=i.id AND a.policy_id=?)`;
async function legacyWaits(db,owner,policyId,now,scope,timeZone=DEFAULT_TIME_ZONE){
 const ids=JSON.stringify([...scope.assignments].filter(([,g])=>scope.allowedGroups.has(g)).map(([id])=>id));
 const items=await rows(db,`SELECT connection_id,max(reserved_at) reserved_at FROM (${taskLegacyReservationsSQL}) GROUP BY connection_id`,ids,now,policyId||'');
 const accounts=new Map(items.map(a=>[a.connection_id,nextDay(a.reserved_at,timeZone)]));
 const emptySlots=await rows(db,`SELECT p.group_id,max(s.slot_at) reserved_at FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id
  WHERE p.group_id IN (SELECT value FROM json_each(?)) AND s.slot_at>=? AND (p.task_group_policy_id<>? OR p.status='ended')
  AND NOT EXISTS(SELECT 1 FROM psychology_publish_items i WHERE i.batch_id=s.batch_id) GROUP BY p.group_id`,JSON.stringify([...scope.allowedGroups]),now,policyId||'');
 return {accounts,groups:new Map(emptySlots.map(g=>[g.group_id,nextDay(g.reserved_at,timeZone)]))};
}

async function currentUser(db,user,{publish=false}={}){
 if(!user?.username)fail('请先登录。',401);
 const row=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(user.username).first();
 const fresh=row?toPublicUser(row):null;
 if(!fresh||fresh.role!=='admin'||!fresh.sidebarModules.includes('psychology-autopilot')||(publish&&!fresh.sidebarModules.includes('psychology-publish')))
  fail('没有任务组运营权限。',403);
 return fresh;
}

// This reader never repairs official assignments or contacts a publishing API.
async function scopeFor(db,user,directory){
 const raw=await db.prepare("SELECT value_json FROM factory_kv WHERE key='official-account-groups'").first();
 const store=ensureModuleProjects(parse(raw?.value_json));
 const project=findProjectForModule(store,'psychology');
 const allGroups=store.groups.filter(g=>g.projectId===project?.id),grant=userAllowedGroupIds(user);
 const groups=allGroups.filter(g=>!grant||grant.has(g.id)),allowedGroups=new Set(groups.map(g=>g.id));
 const canonical=await rows(db,`${reportAccountScopeSQL} SELECT account_key,current_group FROM allowed`,JSON.stringify(allGroups.map(g=>g.id)));
 const assignments=new Map(canonical.map(a=>[a.account_key.replace(/^tiktok:/,''),a.current_group]));
 if(!directory){const saved=await db.prepare("SELECT value_json FROM factory_kv WHERE key='psychology-autopilot-account-directory-v1'").first();directory=parse(saved?.value_json,{accounts:[]});}
 const source=Array.isArray(directory)?directory:directory.fullAccounts||directory.accounts||[],seen=new Set(),all=[];
 for(const a of source){const connectionId=connectionOf(a),groupId=assignments.get(connectionId);
  if(!connectionId||seen.has(connectionId)||!groupId||(Array.isArray(a.scopes)&&!a.scopes.includes('video.publish')))continue;
  seen.add(connectionId);all.push({connectionId,name:String(a.profile?.username||a.username||a.displayName||a.label||connectionId),
   groupId,groupName:allGroups.find(g=>g.id===groupId)?.name||groupId});}
 return {project,groups,all,eligible:all.filter(a=>allowedGroups.has(a.groupId)),assignments,allowedGroups};
}

async function loadContext(db,user,directory,now=Date.now()){
 const scope=await scopeFor(db,user,directory);
 const policy=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE project_key=?').bind(scope.project.id).first();
 const pilots=await rows(db,"SELECT p.*,(SELECT max(slot_at) FROM psychology_autopilot_slots s WHERE s.autopilot_id=p.id) last_reserved FROM psychology_autopilots p WHERE status<>'ended' ORDER BY created_at,id");
 const ended=await rows(db,"SELECT * FROM psychology_autopilots WHERE status='ended' AND owner=? AND ends_at>? ORDER BY updated_at DESC,id",user.username,now);
 const own=pilots.filter(p=>p.owner===user.username&&scope.allowedGroups.has(p.group_id));
 const registry=policy?await rows(db,'SELECT * FROM psychology_task_group_accounts WHERE policy_id=?',policy.id):[];
 const snapshots=policy?await rows(db,'SELECT * FROM psychology_task_group_snapshots WHERE policy_id=? ORDER BY effective_at,connection_id',policy.id):[];
 const states=await rows(db,"SELECT a.*,p.owner,p.group_id,p.status pilot_status,p.task_group_policy_id FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id ");
 const waits=await legacyWaits(db,user.username,policy?.id,now,scope,normalizeTimeZone(policy?.time_zone));
 return {scope,policy,pilots,own,registry,snapshots,states,ended,now,waits};
}
const candidatesFor=c=>c.own.map(p=>({id:p.id,groupId:p.group_id,groupName:p.group_name||c.scope.groups.find(g=>g.id===p.group_id)?.name||p.group_id,status:p.status,poolReady:poolReady(p)}));
const latestFor=(snapshots,time)=>{const map=new Map();for(const s of snapshots)if(s.effective_at<=time&&(!map.has(s.connection_id)||map.get(s.connection_id).effective_at<=s.effective_at))map.set(s.connection_id,s);return map;};
function accountState(c,a,sourceIds,policyId){
 const executor=c.pilots.find(p=>p.group_id===a.groupId),projectMode=(c.enrollmentMode||c.policy?.enrollment_mode)==='project';
 const selected=executor&&executor.owner===c.user.username&&(projectMode?sourceIds.has(executor.id)||executor.task_group_policy_id===policyId&&executor.task_group_managed===1:sourceIds.has(executor.id)||executor.task_group_policy_id===policyId)&&(!projectMode||compatible(executor,c.allowScheduleTransition?Math.max(c.effectiveAt||0,c.policy?.starts_at||0):c.effectiveAt||c.policy?.starts_at||Date.now(),c.allowScheduleTransition?undefined:c.timeZone||normalizeTimeZone(c.policy?.time_zone)));
 const endedIntent=!executor&&projectMode&&c.ended.find(p=>p.group_id===a.groupId);
 const readyAt=projectMode?Math.max(c.waits.accounts.get(a.connectionId)||0,c.waits.groups.get(a.groupId)||0):0;
 const waiting=readyAt>Math.max(c.now,c.policy?.starts_at||c.baseEffectiveAt||0)&&!endedIntent&&(!executor||selected);
 const blocked=Boolean(executor&&!selected||endedIntent||waiting);
 const latestState=c.states.filter(s=>s.connection_id===a.connectionId&&s.owner===c.user.username&&(projectMode||sourceIds.has(s.autopilot_id)||s.task_group_policy_id===policyId)).sort((a,b)=>b.updated_at-a.updated_at||Number(b.autopilot_id===executor?.id)-Number(a.autopilot_id===executor?.id))[0];
 const paused=Boolean(selected&&executor.status==='paused')||(latestState?latestState.status==='paused':Boolean(c.registry.find(r=>r.connection_id===a.connectionId)?.paused));
 return {paused,blocked,waiting,readyAt,reason:waiting?'已有冻结发布排期，等待至'+((c.timeZone||c.policy?.time_zone)===PACIFIC_TIME_ZONE?'美西时间 ':'北京时间 ')+zonedDate(readyAt,c.timeZone||c.policy?.time_zone)+' 再参与任务组':blocked?(endedIntent?'此分组已手动结束运营，等待明确恢复后纳管':executor.owner===c.user.username?(projectMode?'现有发布计划与项目三条账号池策略不兼容，等待处理执行冲突':'现有发布计划未纳入任务组，请先在配置中选择该计划'):'此行政分组已有其他发布计划，等待处理执行冲突'):paused?'保留既有暂停状态':''};
}

async function safeBoundary(db,pilots,now,timeZone=DEFAULT_TIME_ZONE,{ignorePending=false}={}){
 const ids=pilots.map(p=>p.id),last=ids.length?await db.prepare('SELECT max(slot_at) last_slot FROM psychology_autopilot_slots WHERE autopilot_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).first():null;
 return Math.max(nextDay(Math.max(now,Number(last?.last_slot)||0),timeZone),...(ignorePending?[]:pilots.filter(p=>p.pending_strategy==='pools')).map(p=>p.strategy_effective_at?nextDay(p.strategy_effective_at-1,timeZone):0));
}
function validateConfig(body,c,now){
 if(!Number.isInteger(body.revision)||body.revision<0)fail('请提供当前配置修订。',409);
 if(body.revision!==(c.policy?.revision||0))fail('任务组配置已改变，请刷新后重试。',409);
 if(c.policy&&c.policy.owner!==c.user.username)fail('此项目已有任务组控制器。',403);
 if(typeof body.enabled!=='boolean'||typeof body.admitNewAccounts!=='boolean')fail('启用与新号纳管设置必须为布尔值。');
 if(!Number.isInteger(body.reviewTarget)||body.reviewTarget<5||body.reviewTarget>60)fail('评审目标应为5–60个账号。');
 const mode=body.enrollmentMode||c.policy?.enrollment_mode||'selected';
 if(!['selected','project'].includes(mode))fail('纳管方式无效。');
 if(mode==='project'){
  if(body.projectId!==c.scope.project.id)fail('只能绑定当前有权限的心理学项目。',403);
  const cutoff=Math.max(nextDay(now,c.timeZone),c.policy?.starts_at||0);
  body.sourcePilotIds=c.own.filter(p=>p.ends_at>now&&compatible(p,cutoff,c.allowScheduleTransition?undefined:c.timeZone)&&(!c.policy||now>=c.policy.ends_at||nextDay(Math.max(now,p.last_reserved||0),c.timeZone)<c.policy.ends_at)).map(p=>p.id);
  return c.own.filter(p=>body.sourcePilotIds.includes(p.id));
 }
 if(!Array.isArray(body.sourcePilotIds)||body.sourcePilotIds.some(id=>typeof id!=='string')||new Set(body.sourcePilotIds).size!==body.sourcePilotIds.length)fail('请选择有效的执行计划。');
 if(c.policy&&now<c.policy.ends_at&&parse(c.policy.source_pilot_ids_json,[]).some(id=>!body.sourcePilotIds.includes(id)))fail('当前七天周期不能移除执行计划；请在周期结束后调整，已创建排期继续原计划。',409);
 const selected=body.sourcePilotIds.map(id=>c.own.find(p=>p.id===id));
 if(selected.some(p=>!p||!poolReady(p)||p.ends_at<=now))fail('执行计划已结束、权限已失效或未启用账号池匹配，请刷新。',409);
 if(body.enabled&&!selected.length)fail('至少选择一个账号池匹配执行计划。');
 return selected;
}
function checkThreeSlots(pilots,at){
 for(const p of pilots){const slots=parse(p.slots_effective_at&&at>=p.slots_effective_at?p.pending_slots_json:p.slots_json,[]);
  if(!Array.isArray(slots)||slots.length!==3||new Set(slots.map(s=>`${s.hour}:${s.minute}`)).size!==3)fail(`执行计划“${p.group_name||p.group_id}”在任务组生效时必须每天发布3条，请先修改排期。`,409);}
}

async function proposed(db,c,body,now,{reconcile=false}={}){
 const continuing=Boolean(c.policy&&now<c.policy.ends_at),modeRequested=body.enrollmentMode||c.policy?.enrollment_mode||'selected';
 const oldTimeZone=normalizeTimeZone(c.policy?.time_zone),timeZone=body.timeZone??(continuing?oldTimeZone:modeRequested==='project'?PACIFIC_TIME_ZONE:DEFAULT_TIME_ZONE);
 if(![DEFAULT_TIME_ZONE,PACIFIC_TIME_ZONE].includes(timeZone))fail('请选择有效的运营时区。');
 const timeZoneTransition=continuing&&timeZone!==oldTimeZone;
 if(timeZoneTransition&&(modeRequested!=='project'||now>=c.policy.starts_at))fail('运营周期开始后不能更换时区，请在下一周期调整。',409);
 c.timeZone=timeZone;c.allowScheduleTransition=timeZoneTransition||!continuing&&modeRequested==='project'&&timeZone===PACIFIC_TIME_ZONE;
 if(timeZone!==oldTimeZone)c.waits=await legacyWaits(db,c.user.username,c.policy?.id,now,c.scope,timeZone);
 let selected=validateConfig(body,c,now);const mode=body.enrollmentMode||c.policy?.enrollment_mode||'selected',projectMode=mode==='project',policyId=c.policy?.id||`psych-task-${c.scope.project.id}`;
 const executors=c.pilots.filter(p=>body.sourcePilotIds.includes(p.id)||p.task_group_policy_id===policyId);
 let boundary=await safeBoundary(db,executors.filter(p=>!projectMode||selected.some(s=>s.id===p.id)),now,timeZone,{ignorePending:timeZoneTransition});
 if(projectMode){if(!timeZoneTransition)selected=selected.filter(p=>compatible(p,boundary,c.allowScheduleTransition?undefined:timeZone));body.sourcePilotIds=selected.map(p=>p.id);boundary=await safeBoundary(db,selected,now,timeZone,{ignorePending:timeZoneTransition});}
 const retime=value=>zonedEpoch(zonedDate(value,oldTimeZone),0,0,timeZone);
 const startsAt=continuing?(timeZoneTransition?retime(c.policy.starts_at):c.policy.starts_at):boundary;
 const endsAt=continuing?(timeZoneTransition?retime(c.policy.ends_at):c.policy.ends_at):addZonedDays(startsAt,7,timeZone);
 const transitionCutoff=timeZoneTransition?Math.min(c.policy.starts_at,startsAt):0;
 if(timeZoneTransition){
  if(now>=transitionCutoff)fail('切换后的运营周期已开始，请在下一周期调整时区。',409);
  if(executors.some(p=>!selected.some(s=>s.id===p.id)))fail('项目执行计划存在不兼容设置，请先处理后再切换时区。',409);
  const reserved=await db.prepare(`SELECT 1 FROM psychology_autopilot_slots WHERE autopilot_id IN (SELECT value FROM json_each(?)) AND slot_at>=? LIMIT 1`).bind(JSON.stringify(executors.map(p=>p.id)),transitionCutoff).first();
  const frozen=await db.prepare(`SELECT 1 FROM psychology_publish_items WHERE connection_id IN (SELECT value FROM json_each(?)) AND schedule_at*1000>=? LIMIT 1`).bind(JSON.stringify([...new Set([...c.scope.eligible.map(a=>a.connectionId),...c.registry.map(a=>a.connection_id)])]),transitionCutoff).first();
  if(reserved||frozen||boundary>startsAt)fail('原周期已有冻结发布排期，不能安全切换时区；请保留现有排期并在下一周期调整。',409);
 }
 const effectiveAt=continuing?Math.max(startsAt,boundary):startsAt;
 c.enrollmentMode=mode;c.effectiveAt=effectiveAt;c.baseEffectiveAt=effectiveAt;
 if(body.enabled){checkThreeSlots(selected,Math.max(startsAt,effectiveAt,timeZoneTransition?c.policy.starts_at:0));if(!reconcile&&effectiveAt>=endsAt)fail('本周期剩余日期已被保留排期占用，不能安全修改；请在周期结束后开启下一周期。',409);}
 const policy={...(c.policy||{}),id:policyId,project_key:c.scope.project.id,owner:c.user.username,enabled:Number(body.enabled),revision:body.revision,
  starts_at:startsAt,ends_at:endsAt,cycle_days:7,review_days:3,last_review_at:continuing?c.policy.last_review_at:0,
  prestart_cutoff_at:continuing?(timeZoneTransition?Math.min(c.policy.prestart_cutoff_at||Infinity,transitionCutoff):c.policy.prestart_cutoff_at||0):0,
  next_review_at:continuing?(timeZoneTransition?retime(c.policy.next_review_at):c.policy.next_review_at):addZonedDays(startsAt,3,timeZone),time_zone:timeZone,enrollment_mode:mode,review_target:body.reviewTarget,admit_new_accounts:Number(body.admitNewAccounts),
  source_pilot_ids_json:JSON.stringify(body.sourcePilotIds),created_at:c.policy?.created_at??now,updated_at:now};
 const sourceIds=new Set(body.sourcePilotIds),selectedGroups=new Set(selected.map(p=>p.group_id));
 const registry=new Map(c.registry.map(a=>[a.connection_id,{...a}])),initial=!c.policy;
 const oldSources=new Set(parse(c.policy?.source_pilot_ids_json,[])),explicitGroups=new Set(!reconcile?selected.filter(p=>!oldSources.has(p.id)).map(p=>p.group_id):[]),restored=new Set();
 for(const a of c.scope.all){let r=registry.get(a.connectionId);
  if(!r){const enrolled=projectMode?c.scope.allowedGroups.has(a.groupId)&&(initial||!reconcile||body.admitNewAccounts):initial?selectedGroups.has(a.groupId)&&c.scope.allowedGroups.has(a.groupId):body.admitNewAccounts&&c.scope.allowedGroups.has(a.groupId);
   r={policy_id:policyId,connection_id:a.connectionId,first_seen_at:initial?policy.created_at:Math.max(now,policy.created_at+1),enrolled:Number(enrolled),excluded:Number(!enrolled),is_new:Number(!initial),legacy_member:Number(initial&&!projectMode&&enrolled),paused:0,reason:enrolled?'':'首次纳管范围外的既有账号',group_id:a.groupId,name:a.name,updated_at:now};registry.set(a.connectionId,r);}
  if(!c.scope.allowedGroups.has(a.groupId))continue;
  if(r.excluded&&(explicitGroups.has(a.groupId)||projectMode&&(!reconcile||body.admitNewAccounts))){r.enrolled=1;r.excluded=0;r.legacy_member=0;r.reason='';restored.add(a.connectionId);}
  const state=accountState(c,a,sourceIds,policyId);Object.assign(r,{paused:Number(state.paused),reason:r.excluded?r.reason:state.reason,group_id:a.groupId,name:a.name,updated_at:now});}
 const observed=await readPoolMatchingState(db,c.user,c.scope.eligible.map(a=>a.connectionId),now);
 const prior=latestFor(c.snapshots,Math.max(now,startsAt)),previousReview=new Set([...prior.values()].filter(s=>s.role==='review').map(s=>s.connection_id));
 const accounts=c.scope.eligible.filter(a=>registry.get(a.connectionId)?.enrolled&&!registry.get(a.connectionId).excluded).map(a=>{
  const r=registry.get(a.connectionId),state=accountState(c,a,sourceIds,policyId),o=observed.accounts.get('tiktok:'+a.connectionId),n=o?.stats.n||0;
  if(initial||restored.has(a.connectionId))r.is_new=Number(n===0);else if(o?.pool&&o.pool!=='observing')r.is_new=0;
  return {...a,...state,blocked:state.blocked&&!state.waiting||state.readyAt>effectiveAt,effectiveAt:Math.max(effectiveAt,state.readyAt||0),accountPool:o?.pool||'observing',n,isNew:Boolean(r.is_new)};});
 let assignments=assignTaskGroupRoles(accounts,{reviewTarget:body.reviewTarget,previousReview});
 const retimedSnapshots=timeZoneTransition?c.snapshots.filter(s=>s.effective_at>=c.policy.starts_at).map(s=>({...s,effective_at:retime(s.effective_at)})):[];
 if(timeZoneTransition){const previous=latestFor(retimedSnapshots,Infinity);assignments=assignments.map(a=>{const s=previous.get(a.connectionId);return s?{...a,role:s.role,accountPool:s.account_pool,effectiveAt:Math.max(a.effectiveAt,s.effective_at)}:a;});}
 return {policy,effectiveAt,registry:[...registry.values()],assignments,selected,timeZoneTransition,transitionCutoff,retimedSnapshots};
}

function responseData(c,policy,registry,snapshots,{now,effectiveAt=0,group='',page=1}={}){
 const sourceIds=new Set(parse(policy?.source_pilot_ids_json,[])),at=Math.max(now,policy?.starts_at||now,effectiveAt,...snapshots.map(s=>s.effective_at)),bySnapshot=latestFor(snapshots,at),byRegistry=new Map(registry.map(r=>[r.connection_id,r]));
 c.effectiveAt=at;c.timeZone=normalizeTimeZone(policy?.time_zone);c.policy=policy;
 const members=c.scope.eligible.flatMap(a=>{const r=byRegistry.get(a.connectionId),s=bySnapshot.get(a.connectionId);if(!r?.enrolled||r.excluded||!s)return [];
  const state=accountState(c,a,sourceIds,policy.id);return [{...a,role:s.role,accountPool:s.account_pool,paused:state.paused,blocked:state.blocked,reason:state.reason||r.reason,
   effectiveAt:s.effective_at,revision:s.revision}];});
 const groups=Object.entries(TASK_GROUP_ROLES).map(([role,definition])=>{const list=members.filter(a=>a.role===role);return {id:policy?policy.id+'-'+role:role,role,...definition,
  accounts:list.length,active:list.filter(a=>!a.paused&&!a.blocked).length,paused:list.filter(a=>a.paused).length,blocked:list.filter(a=>a.blocked).length};});
 const scopedRegistry=policy?.enrollment_mode==='project'?registry.filter(r=>c.scope.eligible.some(a=>a.connectionId===r.connection_id)):registry;
 const result={project:{id:c.scope.project.id,name:c.scope.project.name},policy:publicPolicy(policy),groups,totals:{enrolled:scopedRegistry.filter(r=>r.enrolled&&!r.excluded).length,excluded:scopedRegistry.filter(r=>r.excluded).length,eligible:c.scope.eligible.length,blocked:members.filter(a=>a.blocked).length},candidates:candidatesFor(c),effectiveAt};
 if(group){if(!TASK_GROUP_ROLES[group])fail('任务组不存在。',404);const list=members.filter(a=>a.role===group);result.membership={rows:list.slice((page-1)*20,page*20),page,total:list.length,totalPages:Math.max(1,Math.ceil(list.length/20))};}
 return result;
}
const snapshotsForPlan=(plan,revision)=>plan.assignments.map(a=>({policy_id:plan.policy.id,connection_id:a.connectionId,effective_at:a.effectiveAt??plan.effectiveAt,revision,role:a.role,
 account_pool:a.accountPool,group_id:a.groupId,name:a.name,paused:Number(a.paused),reason:a.reason}));

async function savePlan(db,c,plan,now,{cycle=false}={}){
 const revision=(c.policy?.revision||0)+1,p={...plan.policy,revision};
 const executors=c.pilots.filter(pilot=>parse(p.source_pilot_ids_json,[]).includes(pilot.id)||(p.enrollment_mode!=='project'&&pilot.task_group_policy_id===p.id));
 const expected=JSON.stringify(executors.map(pilot=>({id:pilot.id,updatedAt:pilot.updated_at,status:pilot.status,owner:pilot.owner,groupId:pilot.group_id})));
 const statements=[db.prepare(`INSERT INTO psychology_task_group_revisions(policy_id,revision,created_at)
  SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM psychology_autopilot_slots WHERE autopilot_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND slot_at>=?)
  AND NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN psychology_autopilots a ON a.id=json_extract(e.value,'$.id')
    WHERE a.id IS NULL OR a.updated_at<>json_extract(e.value,'$.updatedAt') OR a.status<>json_extract(e.value,'$.status') OR a.owner<>json_extract(e.value,'$.owner') OR a.group_id<>json_extract(e.value,'$.groupId'))
  AND (?=0 OR EXISTS(SELECT 1 FROM psychology_task_group_policies WHERE id=? AND owner=? AND revision=?))
  AND (?=0 OR NOT EXISTS(SELECT 1 FROM psychology_publish_items WHERE connection_id IN (SELECT value FROM json_each(?)) AND schedule_at*1000>=?))
  THEN ? ELSE NULL END,?`).bind(p.id,expected,plan.timeZoneTransition?plan.transitionCutoff:plan.effectiveAt,expected,
    Number(Boolean(c.policy)),p.id,c.user.username,c.policy?.revision||0,Number(plan.timeZoneTransition),JSON.stringify([...new Set([...c.scope.eligible.map(a=>a.connectionId),...c.registry.map(a=>a.connection_id)])]),plan.transitionCutoff||0,revision,now)];
 if(c.policy)statements.push(db.prepare(`UPDATE psychology_task_group_policies SET enrollment_mode=?,time_zone=?,prestart_cutoff_at=?,enabled=?,revision=?,starts_at=?,ends_at=?,last_review_at=?,next_review_at=?,review_target=?,admit_new_accounts=?,source_pilot_ids_json=?,updated_at=? WHERE id=? AND owner=? AND revision=?`)
  .bind(p.enrollment_mode||'selected',p.time_zone,p.prestart_cutoff_at,p.enabled,revision,p.starts_at,p.ends_at,p.last_review_at,p.next_review_at,p.review_target,p.admit_new_accounts,p.source_pilot_ids_json,now,p.id,c.user.username,c.policy.revision));
 else statements.push(db.prepare(`INSERT INTO psychology_task_group_policies(id,project_key,owner,enrollment_mode,time_zone,prestart_cutoff_at,enabled,revision,starts_at,ends_at,last_review_at,next_review_at,review_target,admit_new_accounts,source_pilot_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(p.id,p.project_key,p.owner,p.enrollment_mode||'selected',p.time_zone,p.prestart_cutoff_at,p.enabled,revision,p.starts_at,p.ends_at,p.last_review_at,p.next_review_at,p.review_target,p.admit_new_accounts,p.source_pilot_ids_json,p.created_at,now));
 if(cycle||plan.timeZoneTransition)statements.push(db.prepare('INSERT INTO psychology_task_group_cycles(policy_id,revision,starts_at,ends_at) VALUES (?,?,?,?)').bind(p.id,revision,p.starts_at,p.ends_at));
 for(const r of plan.registry)statements.push(db.prepare(`INSERT INTO psychology_task_group_accounts(policy_id,connection_id,first_seen_at,enrolled,excluded,is_new,legacy_member,paused,reason,group_id,name,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(policy_id,connection_id) DO UPDATE SET enrolled=excluded.enrolled,excluded=excluded.excluded,is_new=excluded.is_new,legacy_member=excluded.legacy_member,paused=excluded.paused,reason=excluded.reason,group_id=excluded.group_id,name=excluded.name,updated_at=excluded.updated_at`)
  .bind(p.id,r.connection_id,r.first_seen_at,r.enrolled,r.excluded,r.is_new,r.legacy_member||0,r.paused,r.reason,r.group_id,r.name,now));
 if(plan.timeZoneTransition)statements.push(db.prepare('DELETE FROM psychology_task_group_snapshots WHERE policy_id=? AND effective_at>=?').bind(p.id,c.policy.starts_at));
 for(const s of [...(plan.retimedSnapshots||[]).map(s=>({...s,revision})),...snapshotsForPlan(plan,revision)])statements.push(db.prepare(`INSERT INTO psychology_task_group_snapshots(policy_id,connection_id,effective_at,revision,role,account_pool,group_id,name,paused,reason) VALUES (?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(policy_id,connection_id,effective_at) DO UPDATE SET revision=excluded.revision,role=excluded.role,account_pool=excluded.account_pool,group_id=excluded.group_id,name=excluded.name,paused=excluded.paused,reason=excluded.reason`)
  .bind(p.id,s.connection_id,s.effective_at,revision,s.role,s.account_pool,s.group_id,s.name,s.paused,s.reason));
 if(c.policy&&cycle)statements.push(db.prepare("UPDATE psychology_autopilots SET task_group_policy_id='' WHERE owner=? AND task_group_policy_id=? AND task_group_managed=0 AND id NOT IN (SELECT value FROM json_each(?))").bind(c.user.username,p.id,p.source_pilot_ids_json));
 for(const [index,pilot] of (plan.selected||[]).entries()){
  const stamp=Math.max(now,pilot.updated_at+1);
  if(plan.timeZoneTransition||cycle&&p.enrollment_mode==='project'&&p.time_zone===PACIFIC_TIME_ZONE){
   const oldSlots=parse(pilot.pending_slots_json,[]).length?parse(pilot.pending_slots_json,[]):parse(pilot.slots_json,[]);
   const first=oldSlots[0],inheritedOffset=first?first.hour*60+first.minute-8*60:-1;
   const offset=inheritedOffset>=0&&inheritedOffset<=80?inheritedOffset:(index%9)*10;
   const slots=[480,690,1200].map(value=>({hour:Math.floor((value+offset)/60),minute:(value+offset)%60}));
   statements.push(db.prepare(`UPDATE psychology_autopilots SET task_group_policy_id=?,task_group_managed=?,pending_slots_json=?,pending_schedule_timezone=?,slots_effective_at=?,pending_strategy='pools',strategy_effective_at=?,ends_at=?,updated_at=? WHERE id=? AND owner=? AND status<>'ended'`)
    .bind(p.id,pilot.task_group_managed||0,JSON.stringify(slots),p.time_zone,p.starts_at,p.starts_at,p.ends_at,stamp,pilot.id,c.user.username));
  }else statements.push(db.prepare(`UPDATE psychology_autopilots SET task_group_policy_id=?,task_group_managed=?,ends_at=max(ends_at,?),updated_at=? WHERE id=? AND owner=? AND status<>'ended'`).bind(p.id,pilot.task_group_managed||0,p.ends_at,stamp,pilot.id,c.user.username));
 }
 try{await db.batch(statements);}catch(error){if(/unique|constraint/i.test(String(error.message)))fail('任务组配置已改变或项目已有控制器，请刷新后重试。',409);throw error;}
 return p;
}

export async function handleTaskGroups(request,env,url,user,{directory,now=Date.now()}={}){
 if(url.pathname!==BASE&&url.pathname!==BASE+'/preview')return null;
 try{
  user=await currentUser(env.DB,user,{publish:request.method==='PATCH'});
  const c=await loadContext(env.DB,user,directory,now);c.user=user;
  if(c.policy&&c.policy.owner!==user.username)fail('此项目已有任务组控制器。',403);
  if(request.method==='GET'&&url.pathname===BASE){const page=Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1));
   return json(responseData(c,c.policy,c.registry,c.snapshots,{now,effectiveAt:Math.max(0,...c.snapshots.filter(s=>s.effective_at>=now).map(s=>s.effective_at)),group:url.searchParams.get('group')||'',page}));}
  if((request.method==='POST'&&url.pathname===BASE+'/preview')||(request.method==='PATCH'&&url.pathname===BASE)){
   const body=await readJson(request),plan=await proposed(env.DB,c,body,now);
   if(request.method==='POST')return json({...responseData(c,plan.policy,plan.registry,snapshotsForPlan(plan,body.revision),{now:plan.effectiveAt,effectiveAt:plan.effectiveAt}),preview:true});
   const saved=await savePlan(env.DB,c,plan,now,{cycle:!c.policy||now>=c.policy.ends_at});
   return json(responseData(c,saved,plan.registry,snapshotsForPlan(plan,saved.revision),{now:plan.effectiveAt,effectiveAt:plan.effectiveAt}));
  }
  return errorJson('不支持此操作。',405);
 }catch(error){return errorJson(error.message,error.statusCode||500);}
}

export async function reconcileTaskGroups(env,user,directory,now=Date.now()){
 user=await currentUser(env.DB,user,{publish:true});const db=env.DB,c=await loadContext(db,user,directory,now);c.user=user;
 const p=c.policy;
 if(!p||p.owner!==user.username||!p.enabled||now>=p.ends_at)return {policy:p?.owner===user.username?publicPolicy(p):null,newExecutorGroups:[]};
 const body={revision:p.revision,enabled:true,enrollmentMode:p.enrollment_mode||'selected',projectId:p.project_key,sourcePilotIds:parse(p.source_pilot_ids_json,[]),reviewTarget:p.review_target,admitNewAccounts:Boolean(p.admit_new_accounts)};
 // Existing sources may end or lose scope while a policy remains visible. Do not admit under stale permissions.
 const sources=body.sourcePilotIds.map(id=>c.own.find(pilot=>pilot.id===id)).filter(Boolean);
 if(body.enrollmentMode!=='project'&&sources.length!==body.sourcePilotIds.length)return {policy:publicPolicy(p),newExecutorGroups:[],warning:'执行计划或行政分组权限已失效，等待重新配置。'};
 const plan=await proposed(db,c,body,now,{reconcile:true}),prior=latestFor(c.snapshots,plan.effectiveAt),known=new Map(c.registry.map(a=>[a.connection_id,a]));
 const reviewDue=now>=p.next_review_at&&p.next_review_at<p.ends_at;
 const changed=reviewDue||plan.policy.source_pilot_ids_json!==p.source_pilot_ids_json||plan.registry.some(a=>{const old=known.get(a.connection_id);return !old||['enrolled','excluded','legacy_member','paused','reason','group_id','name','is_new'].some(k=>old[k]!==a[k]);});
 let saved=p;
 if(changed&&plan.effectiveAt>=p.ends_at)return {...responseData(c,p,c.registry,c.snapshots,{now}),newExecutorGroups:[],warning:'本周期已无可安全调整的未来整日，新成员等待下一周期。'};
 if(changed){
  if(!reviewDue)plan.assignments=plan.assignments.map(a=>{const old=prior.get(a.connectionId);return old?{...a,role:old.role,accountPool:old.account_pool}:a;});
  if(reviewDue){plan.policy.last_review_at=now;plan.policy.next_review_at=Math.min(p.ends_at,addZonedDays(p.next_review_at,3,normalizeTimeZone(p.time_zone)));}
  saved=await savePlan(db,c,plan,now);
 }
 const sourceIds=new Set(body.sourcePilotIds),newGroups=new Map(),futureMembers=latestFor(changed?[...c.snapshots,...snapshotsForPlan(plan,saved.revision)]:c.snapshots,Infinity);
 for(const a of c.scope.eligible){const r=plan.registry.find(r=>r.connection_id===a.connectionId);if(!r?.enrolled||r.excluded)continue;
  const state=accountState(c,a,sourceIds,p.id);if(state.blocked&&!state.waiting||c.pilots.some(pilot=>pilot.group_id===a.groupId))continue;
  const group=newGroups.get(a.groupId)||{groupId:a.groupId,groupName:a.groupName,name:a.groupName,connectionIds:[],effectiveAt:Math.max(p.starts_at,futureMembers.get(a.connectionId)?.effective_at||plan.effectiveAt,state.readyAt||0)};group.effectiveAt=Math.min(group.effectiveAt,Math.max(p.starts_at,futureMembers.get(a.connectionId)?.effective_at||plan.effectiveAt,state.readyAt||0));group.connectionIds.push(a.connectionId);newGroups.set(a.groupId,group);}
 return {...responseData(c,saved,plan.registry,changed?[...c.snapshots,...snapshotsForPlan(plan,saved.revision)]:c.snapshots,{now,effectiveAt:changed?plan.effectiveAt:0}),newExecutorGroups:[...newGroups.values()]};
}

export async function taskAssignmentsFor(db,owner,connectionIds,slotAt){
 if(!connectionIds.length)return new Map();
 let user;try{user=await currentUser(db,{username:owner},{publish:true});}catch{return new Map();}
 const p=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE owner=? AND enabled=1 AND starts_at<=? AND ends_at>?').bind(owner,slotAt,slotAt).first();
 if(!p)return new Map();
 const scope=await scopeFor(db,user,[]),ids=JSON.stringify([...new Set(connectionIds.map(String))]);
 const members=await rows(db,`SELECT s.*,a.paused current_paused FROM psychology_task_group_snapshots s JOIN psychology_task_group_accounts a USING(policy_id,connection_id)
  WHERE s.policy_id=? AND a.enrolled=1 AND a.excluded=0 AND s.connection_id IN (SELECT value FROM json_each(?))
  AND s.effective_at=(SELECT max(t.effective_at) FROM psychology_task_group_snapshots t WHERE t.policy_id=s.policy_id AND t.connection_id=s.connection_id AND t.effective_at<=?)`,p.id,ids,slotAt);
 const sources=new Set(parse(p.source_pilot_ids_json,[])),pilots=await rows(db,"SELECT * FROM psychology_autopilots WHERE status<>'ended'"),states=await rows(db,"SELECT a.connection_id,a.status,a.updated_at,p.owner,p.task_group_policy_id,a.autopilot_id FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id ");
 const waits=p.enrollment_mode==='project'?await legacyWaits(db,owner,p.id,slotAt,scope,normalizeTimeZone(p.time_zone)):{accounts:new Map(),groups:new Map()};
 const result=new Map();
 for(const s of members){const currentGroup=scope.assignments.get(s.connection_id),executor=pilots.find(pilot=>pilot.group_id===currentGroup);
  if(Math.max(waits.accounts.get(s.connection_id)||0,waits.groups.get(currentGroup)||0)>slotAt)continue;
  if(currentGroup!==s.group_id||!scope.allowedGroups.has(currentGroup)||!executor||executor.owner!==owner||(!sources.has(executor.id)&&executor.task_group_policy_id!==p.id)||executor.status!=='active'||executor.ends_at<=slotAt||(p.enrollment_mode==='project'&&!compatible(executor,slotAt,normalizeTimeZone(p.time_zone))))continue;
  const latestState=states.filter(a=>a.connection_id===s.connection_id&&a.owner===owner&&(p.enrollment_mode==='project'||sources.has(a.autopilot_id)||a.task_group_policy_id===p.id)).sort((a,b)=>b.updated_at-a.updated_at||Number(b.autopilot_id===executor.id)-Number(a.autopilot_id===executor.id))[0];
  const paused=latestState?latestState.status==='paused':Boolean(s.current_paused);
  if(paused)continue;
  result.set(s.connection_id,{policyId:p.id,timeZone:normalizeTimeZone(p.time_zone),id:p.id+'-'+s.role,role:s.role,effectiveAt:s.effective_at,revision:s.revision,accountPool:s.account_pool,groupId:s.group_id,paused:false});
 }
 return result;
}
