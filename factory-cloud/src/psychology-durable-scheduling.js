import { autopilotCheckWindow } from './psychology-autopilot-execution.js';
import { AUTOPILOT, dueSlots, autopilotDirectory, pilotLibraryConfig, pilotPairSeed, pilotSlotsAt, recoveryBatchIds, guardAccounts, pilotOutcomes } from './psychology-autopilot.js';
import { loadAutoUser, handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { reconcileTaskExecutors, taskSlotAccounts, taskPublishContext, sameDeliveryDay } from './psychology-task-group-execution.js';
import { stopPending } from './psychology-autopilot-execution.js';
import { readProductionLoad, readProductionAccountCounts, estimateProductionLead } from './psychology-production-capacity.js';
import { pilotTimeZoneAt, zonedDate, zonedParts } from '../../scripts/psychology-schedule-time.js';
import { sha256Hex } from './http.js';
import { kvGet, kvSet } from './kv.js';

const MINUTE=60000, HOUR=60*MINUTE;
export const SCHEDULE_POLICY=Object.freeze({chunkSize:5,leaseMs:5*MINUTE,maxAttempts:5,dispatchMs:MINUTE,minLeadMs:10*MINUTE});
const parse=s=>JSON.parse(s||'{}');
const connection=a=>String(a.connectionId||a.id||'');
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
async function uuid(value){const h=await sha256Hex(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);}
function workInsert(db,{id,owner,kind,windowAt,pilotId='',slotAt=0,payload={}},now){
 return db.prepare("INSERT OR IGNORE INTO psychology_schedule_work(id,owner,kind,window_at,pilot_id,slot_at,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,owner,kind,windowAt,pilotId,slotAt,JSON.stringify(payload),now,now);
}
async function batches(db,statements){for(let n=0;n<statements.length;n+=40)await db.batch(statements.slice(n,n+40));}

// This also runs in the independent five-minute watchdog. It derives expected
// rounds from active plans, not from an existing check record or publish queue.
export async function ensureScheduleWindow(env,now=Date.now(),options={}){
 const window=autopilotCheckWindow(now),db=env.DB;
 const pilots=await rows(db,"SELECT * FROM psychology_autopilots WHERE status='active' AND ends_at>? ORDER BY id",now);
 const policies=await rows(db,"SELECT owner FROM psychology_task_group_policies WHERE enabled=1 AND ends_at>?",now);
 const owners=new Set([...policies.map(p=>p.owner),...pilots.map(p=>p.owner)].filter(owner=>!options.owner||owner===options.owner));
 const statements=[];
 if(!options.owner)statements.push(workInsert(db,{id:'maintenance:'+window.scheduledAt,owner:'',kind:'maintenance',windowAt:window.scheduledAt},now));
 for(const owner of owners){
  statements.push(workInsert(db,{id:'owner:'+owner+':'+window.scheduledAt,owner,kind:'owner',windowAt:window.scheduledAt},now));
 }
 for(const pilot of pilots){
  if((options.owner&&pilot.owner!==options.owner)||(options.pilotId&&pilot.id!==options.pilotId))continue;
  for(const slotAt of dueSlots(pilot,window.scheduledAt)){
   // Do not move or silently recreate a past publication. Near deadlines remain
   // visible as incidents rather than being sent at an invented replacement time.
   if(slotAt<=now)continue;
   statements.push(workInsert(db,{id:'slot:'+pilot.id+':'+slotAt,owner:pilot.owner,kind:'slot',windowAt:window.scheduledAt,pilotId:pilot.id,slotAt,payload:{date:zonedDate(slotAt,pilotTimeZoneAt(pilot,slotAt)),round:pilotSlotsAt(pilot,slotAt).findIndex(s=>{const p=zonedParts(slotAt,pilotTimeZoneAt(pilot,slotAt));return s.hour===p.hour&&s.minute===p.minute;}),timeZone:pilotTimeZoneAt(pilot,slotAt)}},now));
  }
 }
 await batches(db,statements);
 return {windowAt:window.scheduledAt,owners:owners.size,expectedSlots:statements.length-owners.size-(options.owner?0:1)};
}

export async function dispatchScheduleWork(env,now=Date.now(),owner=''){
 if(!env.SCHEDULE_QUEUE)throw new Error('排期队列尚未配置');
 const due=await rows(env.DB,"SELECT id FROM psychology_schedule_work WHERE (?='' OR owner=?) AND (status='queued' AND available_at<=? OR status='running' AND lease_until<=?) AND dispatched_at<=? ORDER BY CASE kind WHEN 'owner' THEN 0 ELSE 1 END,slot_at,updated_at LIMIT 80",owner,owner,now,now,now-SCHEDULE_POLICY.dispatchMs);
 let sent=0;
 for(const r of due){
  const claim=await env.DB.prepare("UPDATE psychology_schedule_work SET dispatched_at=? WHERE id=? AND dispatched_at<=? AND (status='queued' AND available_at<=? OR status='running' AND lease_until<=?)").bind(now,r.id,now-SCHEDULE_POLICY.dispatchMs,now,now).run();
  if(!claim.meta?.changes)continue;
  try{await env.SCHEDULE_QUEUE.send({id:r.id});sent++;}
  catch(error){await env.DB.prepare('UPDATE psychology_schedule_work SET dispatched_at=0 WHERE id=? AND dispatched_at=?').bind(r.id,now).run();throw error;}
 }
 return {sent};
}
async function saveProgress(db,w,{phase=w.phase,status='queued',payload=parse(w.payload_json),detail='',delay=0},now){
 const result=await db.prepare("UPDATE psychology_schedule_work SET phase=?,status=?,payload_json=?,detail=?,lease_token='',lease_until=0,available_at=?,dispatched_at=0,attempts=0,updated_at=? WHERE id=? AND status='running' AND lease_token=?")
  .bind(phase,status,JSON.stringify(payload),detail,now+delay,now,w.id,w.lease_token).run();
 return !!result.meta?.changes;
}
async function ownerStep(env,w,now){
 const user=await loadAutoUser(env.DB,w.owner),directory=await autopilotDirectory(env,user,true);
 if(w.phase===0){
  await reconcileTaskExecutors(env,user,directory,now);
  await env.DB.prepare("UPDATE psychology_schedule_work SET status='queued',phase=0,available_at=0,dispatched_at=0 WHERE owner=? AND kind='slot' AND slot_at>? AND status='done'").bind(w.owner,now+SCHEDULE_POLICY.minLeadMs).run();
  await saveProgress(env.DB,w,{phase:1},now);
  // Newly admitted accounts retain their own next-Pacific-day effective time.
  await ensureScheduleWindow(env,now,{owner:w.owner});
 }else{
  const [load,accountCounts]=await Promise.all([readProductionLoad(env.DB,now),readProductionAccountCounts(env.DB,now)]);
  const next=await env.DB.prepare("SELECT MIN(slot_at) slot FROM psychology_schedule_work WHERE owner=? AND kind='slot' AND slot_at>?").bind(w.owner,now).first();
  const capacity={...estimateProductionLead({...load,accountCounts},{owner:w.owner,accountCount:accountCounts[w.owner]||0,slotAt:next?.slot||0,now}),nextSlotAt:next?.slot||0,minLeadMs:2*HOUR,maxLeadMs:3*HOUR};
  await kvSet(env.DB,'psychology-production-capacity:'+w.owner,capacity);
  await saveProgress(env.DB,w,{status:'done'},now);
 }
}
async function maintenanceStep(env,w,now){
 if(w.phase===0)await (await import('./psychology-adaptive-production.js')).recalculateAdaptiveProduction(env,now);
 else if(w.phase===1)await (await import('./psychology-pool-observations.js')).capturePoolObservations(env,now,autopilotCheckWindow(w.window_at));
 else await (await import('./psychology-transition-day.js')).runTransitionDays(env,now);
 await saveProgress(env.DB,w,{phase:w.phase+1,status:w.phase>=2?'done':'queued'},now);
}
async function currentSlot(env,w,now){
 const pilot=await env.DB.prepare('SELECT * FROM psychology_autopilots WHERE id=? AND owner=?').bind(w.pilot_id,w.owner).first();
 if(!pilot||pilot.status!=='active'||pilot.ends_at<=w.slot_at)return {reason:'运营已暂停、结束或超出周期'};
 const parts=zonedParts(w.slot_at,pilotTimeZoneAt(pilot,w.slot_at));
 if(!pilotSlotsAt(pilot,w.slot_at).some(s=>s.hour===parts.hour&&s.minute===parts.minute))return {reason:'发布设置已变更，此轮不再适用'};
 const user=await loadAutoUser(env.DB,w.owner),directory=await autopilotDirectory(env,user,true);
 if(!directory.groups.some(g=>g.id===pilot.group_id))return {reason:'当前账号授权范围已变化'};
 return {pilot,user,directory};
}
async function existingItems(db,pilot,slotAt){
 const slot=await db.prepare('SELECT * FROM psychology_autopilot_slots WHERE autopilot_id=? AND slot_at=?').bind(pilot.id,slotAt).first();
 const ids=new Set([...String(slot?.batch_id||'').split(',').filter(Boolean),...await recoveryBatchIds(db,pilot,slotAt)]);
 const committed=await rows(db,"SELECT c.batch_id FROM psychology_schedule_commits c JOIN psychology_schedule_work w ON w.id=c.work_id WHERE w.pilot_id=? AND w.slot_at=?",pilot.id,slotAt);
 for(const c of committed)ids.add(c.batch_id);
 // Project/account/day/round claims also recover committed rows whose slot link
 // was interrupted, including a different compatible executor's reservation.
 const context=await taskPublishContext(db,pilot,slotAt);
 if(context.taskGroupPolicyId){
  const p=zonedParts(slotAt,pilotTimeZoneAt(pilot,slotAt)),round=pilotSlotsAt(pilot,slotAt).findIndex(s=>s.hour===p.hour&&s.minute===p.minute);
  const claims=await rows(db,"SELECT i.batch_id FROM psychology_task_group_allocations a JOIN psychology_publish_items i ON i.id=a.item_id WHERE a.policy_id=? AND a.beijing_date=? AND a.round=?",context.taskGroupPolicyId,p.date,round);
  // Use these rows for coverage, but link only this executor's accounts below.
  const items=await rows(db,'SELECT id,batch_id,connection_id,deleted_at FROM psychology_publish_items WHERE batch_id IN (SELECT value FROM json_each(?))',JSON.stringify([...ids,...claims.map(c=>c.batch_id)]));
  return {ids:[...ids],items};
 }
 return {ids:[...ids],items:ids.size?await rows(db,'SELECT id,batch_id,connection_id,deleted_at FROM psychology_publish_items WHERE batch_id IN (SELECT value FROM json_each(?))',JSON.stringify([...ids])):[]};
}
async function initializeSlot(env,w,now,current){
 const {pilot,user,directory}=current,db=env.DB,accounts=directory.accounts.filter(a=>a.groupId===pilot.group_id);
 const ids=accounts.map(connection),states=new Map((await rows(db,"SELECT connection_id,status FROM psychology_autopilot_accounts WHERE autopilot_id=?",pilot.id)).map(a=>[a.connection_id,a.status]));
 const pauses=guardAccounts({connectionIds:ids.filter(id=>states.get(id)!=='paused'),outcomesByConnection:await pilotOutcomes(db,pilot.id,now)});
 for(const a of pauses){
  await db.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at,stop_pending) VALUES(?,?,'paused',?,?,1) ON CONFLICT(autopilot_id,connection_id) DO UPDATE SET status='paused',reason=excluded.reason,updated_at=excluded.updated_at,stop_pending=1").bind(pilot.id,a.id,a.reason,now).run();
  states.set(a.id,'paused');await stopPending(db,pilot.id,a.id,now);
 }
 const roster=await taskSlotAccounts(db,pilot,ids.filter(id=>states.get(id)!=='paused'),w.slot_at,{includeClaimed:true});
 const old=await existingItems(db,pilot,w.slot_at),byAccount=new Map(old.items.map(i=>[i.connection_id,i]));
 const members=roster.map((id,ordinal)=>{const i=byAccount.get(id);return {id,ordinal,name:accounts.find(a=>connection(a)===id)?.username||id,status:i?(i.deleted_at?'skipped':'created'):'pending',itemId:i?.id||'',reason:i?.deleted_at?'既有任务已停止，保留停止状态':''};});
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO psychology_autopilot_slots(autopilot_id,slot_at,status,updated_at) VALUES(?,?,'creating',?)").bind(pilot.id,w.slot_at,now),
  db.prepare("INSERT OR IGNORE INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) SELECT ?,json_extract(value,'$.id'),'active','',? FROM json_each(?)").bind(pilot.id,now,JSON.stringify(members)),
  db.prepare("INSERT OR IGNORE INTO psychology_schedule_members(work_id,connection_id,ordinal,name,status,item_id,reason,updated_at) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.ordinal'),json_extract(value,'$.name'),json_extract(value,'$.status'),json_extract(value,'$.itemId'),json_extract(value,'$.reason'),? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM psychology_schedule_work WHERE id=? AND lease_token=? AND status='running' AND lease_until>?)").bind(w.id,now,JSON.stringify(members),w.id,w.lease_token,now),
 ]);
 return saveProgress(db,w,{phase:1,payload:{policyId:(await taskPublishContext(db,pilot,w.slot_at)).taskGroupPolicyId||'',round:pilotSlotsAt(pilot,w.slot_at).findIndex(s=>s.hour===zonedParts(w.slot_at,pilotTimeZoneAt(pilot,w.slot_at)).hour&&s.minute===zonedParts(w.slot_at,pilotTimeZoneAt(pilot,w.slot_at)).minute),timeZone:pilotTimeZoneAt(pilot,w.slot_at),date:zonedDate(w.slot_at,pilotTimeZoneAt(pilot,w.slot_at)),accounts:members.length}},now);
}
async function memberResult(db,w,ids,status,reason,now){
 if(!ids.length)return;
 await db.prepare("UPDATE psychology_schedule_members SET status=?,reason=?,updated_at=? WHERE work_id=? AND connection_id IN (SELECT value FROM json_each(?)) AND status='pending' AND EXISTS(SELECT 1 FROM psychology_schedule_work WHERE id=? AND status='running' AND lease_token=? AND lease_until>?)").bind(status,reason,now,w.id,JSON.stringify(ids),w.id,w.lease_token,now).run();
}
async function synchronizeMembers(db,w,pilot,now){
 const old=await existingItems(db,pilot,w.slot_at);
 if(old.items.length)await db.prepare("UPDATE psychology_schedule_members AS m SET status=CASE WHEN json_extract(x.value,'$.deleted_at')>0 THEN 'skipped' ELSE 'created' END,item_id=json_extract(x.value,'$.id'),reason=CASE WHEN json_extract(x.value,'$.deleted_at')>0 THEN '既有任务已停止，保留停止状态' ELSE '' END,updated_at=? FROM json_each(?) x WHERE m.work_id=? AND m.connection_id=json_extract(x.value,'$.connection_id') AND m.status='pending' AND EXISTS(SELECT 1 FROM psychology_schedule_work WHERE id=? AND status='running' AND lease_token=? AND lease_until>?)").bind(now,JSON.stringify(old.items),w.id,w.id,w.lease_token,now).run();
 return old.ids;
}
async function finishSlot(db,w,pilot,now){
 const counts=await db.prepare("SELECT COUNT(*) n,SUM(status='pending') pending,SUM(status='blocked') blocked FROM psychology_schedule_members WHERE work_id=?").bind(w.id).first();
 if(counts.pending)return false;
 const ids=(await existingItems(db,pilot,w.slot_at)).ids;
 const detail=counts.blocked?'存在未恢复账号，请查看排期保障':counts.n?'账号清单处理完成，跳过原因见排期保障':'本轮没有满足生效日期、权限和暂停条件的账号';
 await db.prepare("UPDATE psychology_autopilot_slots SET status=?,batch_id=?,detail=?,updated_at=? WHERE autopilot_id=? AND slot_at=? AND EXISTS(SELECT 1 FROM psychology_schedule_work WHERE id=? AND status='running' AND lease_token=?)").bind(ids.length?'created':counts.blocked?'failed':'skipped',ids.join(','),detail,now,pilot.id,w.slot_at,w.id,w.lease_token).run();
 if(!counts.blocked)await db.prepare("UPDATE psychology_autopilots SET last_run_at=? WHERE id=? AND status='active'").bind(now,pilot.id).run();
 await saveProgress(db,w,{status:counts.blocked?'failed':'done',detail:counts.blocked?detail:''},now);
 return true;
}
async function slotStep(env,w,now){
 const db=env.DB,current=await currentSlot(env,w,now);
 if(current.reason){await memberResult(db,w,(await rows(db,"SELECT connection_id FROM psychology_schedule_members WHERE work_id=? AND status='pending'",w.id)).map(a=>a.connection_id),'skipped',current.reason,now);return saveProgress(db,w,{status:'done',detail:current.reason},now);}
 const {pilot,user,directory}=current;
 const preparation=await db.prepare("SELECT status,phase FROM psychology_schedule_work WHERE id=?").bind('owner:'+w.owner+':'+w.window_at).first();
 if(preparation&&preparation.phase===0){if(preparation.status==='failed')throw new Error('项目账号准备失败，等待恢复');await saveProgress(db,w,{delay:MINUTE},now);return;}
 if(w.phase===0)return initializeSlot(env,w,now,current);
 await synchronizeMembers(db,w,pilot,now);
 if(await finishSlot(db,w,pilot,now))return;
 const selected=await rows(db,"SELECT * FROM psychology_schedule_members WHERE work_id=? AND status='pending' ORDER BY ordinal LIMIT ?",w.id,SCHEDULE_POLICY.chunkSize);
 if(w.slot_at<=now+SCHEDULE_POLICY.minLeadMs){
  await memberResult(db,w,selected.map(a=>a.connection_id),'blocked','已不足10分钟准备时间，保留原轮次并告警，未擅自改时发布',now);
  await saveProgress(db,w,{},now);return;
 }
 const authorized=new Set(directory.accounts.filter(a=>a.groupId===pilot.group_id).map(connection));
 const ids=selected.map(a=>a.connection_id),eligible=new Set(await taskSlotAccounts(db,pilot,ids.filter(id=>authorized.has(id)),w.slot_at));
 const paused=new Set((await rows(db,"SELECT connection_id FROM psychology_autopilot_accounts WHERE autopilot_id=? AND status='paused'",pilot.id)).map(a=>a.connection_id));
 const valid=selected.filter(a=>eligible.has(a.connection_id)&&!paused.has(a.connection_id)),usable=[];
 for(const a of valid){if(usable.length&&a.ordinal!==usable.at(-1).ordinal+1)break;usable.push(a);}
 const roster=new Set(await taskSlotAccounts(db,pilot,ids.filter(id=>authorized.has(id)),w.slot_at,{includeClaimed:true}));
 const orphaned=selected.filter(a=>!eligible.has(a.connection_id)&&roster.has(a.connection_id)&&!paused.has(a.connection_id));
 await memberResult(db,w,orphaned.map(a=>a.connection_id),'blocked','本轮已有占用，但未找到对应任务，需要核对；未重复创建',now);
 await memberResult(db,w,selected.filter(a=>!valid.includes(a)&&!orphaned.includes(a)).map(a=>a.connection_id),'skipped','账号已暂停或权限、生效分配已变化',now);
 if(!usable.length){await saveProgress(db,w,{},now);return;}
 const context=await taskPublishContext(db,pilot,w.slot_at);
 const scheduleAt=Math.floor(w.slot_at/1000)+usable[0].ordinal*AUTOPILOT.staggerSeconds;
 const connections=usable.map(a=>a.connection_id).filter((id,i)=>sameDeliveryDay(w.slot_at,scheduleAt+i*AUTOPILOT.staggerSeconds,pilot.ends_at,pilotTimeZoneAt(pilot,w.slot_at)));
 await memberResult(db,w,usable.filter(a=>!connections.includes(a.connection_id)).map(a=>a.connection_id),'skipped','错峰将跨出运营日或周期',now);
 if(!connections.length){await saveProgress(db,w,{},now);return;}
 const [load,accountCounts]=await Promise.all([readProductionLoad(db,now),readProductionAccountCounts(db,now)]);
 const productionPlan=estimateProductionLead({...load,accountCounts},{owner:w.owner,accountCount:accountCounts[w.owner]||connections.length,slotAt:w.slot_at,now});
 const musicIds=(await kvGet(db,'psychology-auto-music-pool',[])).filter(id=>/^\d{1,30}$/.test(String(id))).slice(0,100);
 const body={requestId:await uuid(w.id+':'+connections.join(',')),name:'项目自动运营 · '+zonedDate(w.slot_at,pilotTimeZoneAt(pilot,w.slot_at)),mediaType:'photo',template:'photo-text',sourceType:'library',...pilotLibraryConfig(pilot,w.slot_at),pairSeed:pilotPairSeed(pilot,w.slot_at),count:connections.length,connectionIds:connections,scheduleAt,intervalMinutes:60,staggerSeconds:45,styleMode:'random',styleId:'classic',musicIds};
 const request=new Request('https://autopilot.internal/api/psychology-auto-publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const response=await handlePsychologyAutoPublish(request,env,new URL(request.url),{user},{...context,productionPlan,productionLeadMs:productionPlan.leadMs,scheduleWork:{id:w.id,token:w.lease_token}});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'排期创建失败');
 await synchronizeMembers(db,w,pilot,now);
 for(const skipped of result.skipped||[])await memberResult(db,w,[skipped.connectionId],'skipped',String(skipped.reason||'没有合格内容'),now);
 const unhandled=await rows(db,"SELECT connection_id FROM psychology_schedule_members WHERE work_id=? AND connection_id IN (SELECT value FROM json_each(?)) AND status='pending'",w.id,JSON.stringify(connections));
 if(unhandled.length)throw new Error('发布接口未返回所有账号的任务或明确跳过原因，等待核对');
 await saveProgress(db,w,{},Date.now());
}

export async function processScheduleMessage(env,message,options={}){
 const now=options.now??Date.now(),db=env.DB,id=String(message.body?.id||'');
 const saved=await db.prepare('SELECT * FROM psychology_schedule_work WHERE id=?').bind(id).first();
 if(!saved||['done','failed'].includes(saved.status)){message.ack();return;}
 if(saved.available_at>now){message.retry({delaySeconds:Math.max(1,Math.ceil((saved.available_at-now)/1000))});return;}
 const token=crypto.randomUUID();
 const claim=await db.prepare("UPDATE psychology_schedule_work SET status='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND (status='queued' OR status='running' AND lease_until<=?)").bind(token,now+SCHEDULE_POLICY.leaseMs,id,now).run();
 if(!claim.meta?.changes){message.ack();return;}
 const w={...saved,lease_token:token,lease_until:now+SCHEDULE_POLICY.leaseMs,attempts:saved.attempts+1};
 try{
  if(w.attempts>SCHEDULE_POLICY.maxAttempts)throw new Error('连续执行中断，已停止自动重试，请查看排期保障');
  await (options.step||(w.kind==='owner'?ownerStep:w.kind==='maintenance'?maintenanceStep:slotStep))(env,w,now);
 }catch(error){
  const detail=String(error.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,600),terminal=w.attempts>=SCHEDULE_POLICY.maxAttempts;
  await db.prepare("UPDATE psychology_schedule_work SET status=?,detail=?,available_at=?,lease_token='',lease_until=0,dispatched_at=0,updated_at=? WHERE id=? AND status='running' AND lease_token=?").bind(terminal?'failed':'queued',detail,now+Math.min(15*MINUTE,MINUTE*2**(w.attempts-1)),now,id,token).run();
  console.error(JSON.stringify({event:'psychology-schedule-retry',workId:id,terminal,error:detail}));
 }
 const current=await db.prepare('SELECT status,available_at,lease_token,attempts FROM psychology_schedule_work WHERE id=?').bind(id).first();
 if(current.status==='queued'){
  const delaySeconds=Math.max(1,Math.ceil((current.available_at-Date.now())/1000));
  if(current.attempts===0&&env.SCHEDULE_QUEUE){
   try{await env.SCHEDULE_QUEUE.send({id},{delaySeconds});message.ack();}
   catch{message.retry({delaySeconds});}
  }else message.retry({delaySeconds});
 }else message.ack();
}
export async function consumeScheduleWork(batch,env){for(const message of batch.messages)await processScheduleMessage(env,message);}
