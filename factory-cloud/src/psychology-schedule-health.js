import { ensureScheduleWindow, dispatchScheduleWork, SCHEDULE_POLICY } from './psychology-durable-scheduling.js';
import { autopilotDirectory } from './psychology-autopilot.js';
import { slotExecution } from './psychology-autopilot-execution.js';
import { signalDesk } from './signal-desk.js';
import { kvSet,kvGet } from './kv.js';
import { zonedDate } from '../../scripts/psychology-schedule-time.js';
const MINUTE=60000,HOUR=60*MINUTE;
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export function scheduleIncident(work,counts,now){
 const pending=Number(counts.pending||0)+Number(counts.blocked||0);
 if(work.kind!=='slot'){
  if(work.status==='failed'||(work.status!=='done'&&now-work.created_at>=15*MINUTE))return {level:'critical',message:'排期准备或复评未完成：'+(work.detail||'执行中断或队列未推进')};
  return null;
 }
 if(work.phase===0&&work.status==='done')return null;
 if(work.phase===0||pending){
  const overdue=now-work.created_at>=15*MINUTE,critical=work.slot_at-now<=HOUR||work.status==='failed';
  if(critical||overdue||work.status==='running'&&work.lease_until<=now)
   return {level:critical?'critical':'warn',message:(work.phase===0?'本轮账号清单尚未建立':pending+' 个账号尚未创建任务或等待恢复')+(work.detail?'；'+work.detail:'')};
 }
 if(work.slot_at>now&&work.slot_at-now<=30*MINUTE&&counts.unready>0)return {level:'critical',message:counts.unready+' 条任务距发布不足30分钟，素材尚未就绪'};
 if(work.slot_at<=now-15*MINUTE&&counts.unconfirmed>0)return {level:'critical',message:counts.unconfirmed+' 条任务超过计划发布时间15分钟，尚未确认发布'};
 return null;
}
async function workCounts(db,id,now){
 return db.prepare("SELECT COUNT(*) expected,COALESCE(SUM(m.status='created'),0) created,COALESCE(SUM(m.status='skipped'),0) skipped,COALESCE(SUM(m.status='pending'),0) pending,COALESCE(SUM(m.status='blocked'),0) blocked,COALESCE(SUM(m.status='created' AND i.deleted_at=0 AND i.ready_json='{}' AND COALESCE(json_extract(i.receipt_json,'$.batchId'),'')=''),0) unready,COALESCE(SUM(m.status='created' AND i.deleted_at=0 AND i.schedule_at*1000<=? AND NOT EXISTS(SELECT 1 FROM factory_publish_records r WHERE json_extract(r.value_json,'$.autoTaskId')=i.id AND lower(COALESCE(NULLIF(json_extract(r.value_json,'$.officialRemoteStatus'),''),json_extract(r.value_json,'$.status'))) IN ('published','publish_complete'))),0) unconfirmed FROM psychology_schedule_members m LEFT JOIN psychology_publish_items i ON i.id=m.item_id WHERE m.work_id=?").bind(now-15*MINUTE,id).first();
}
export async function checkScheduleHealth(env,now=Date.now()){
 const work=await rows(env.DB,"SELECT * FROM psychology_schedule_work WHERE (kind='slot' AND slot_at BETWEEN ? AND ?) OR (kind<>'slot' AND window_at>=?) ORDER BY slot_at,id",now-24*HOUR,now+26*HOUR,now-24*HOUR);
 let alerts=0;
 for(const w of work){
  const counts=w.kind==='slot'?await workCounts(env.DB,w.id,now):{},incident=scheduleIncident(w,counts,now),id='schedule:'+w.id;
  if(incident){
   alerts++;
   await env.DB.prepare("INSERT INTO psychology_schedule_alerts(id,owner,work_id,level,message,opened_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET level=excluded.level,message=excluded.message,updated_at=excluded.updated_at,resolved_at=0,notified_at=CASE WHEN psychology_schedule_alerts.level<>excluded.level OR psychology_schedule_alerts.resolved_at>0 THEN 0 ELSE psychology_schedule_alerts.notified_at END").bind(id,w.owner,w.id,incident.level,incident.message,now,now).run();
   console.error(JSON.stringify({event:'psychology-schedule-coverage',id,level:incident.level,expected:counts.expected??null,created:counts.created??0,pending:counts.pending??null}));
  }else await env.DB.prepare("UPDATE psychology_schedule_alerts SET resolved_at=?,updated_at=? WHERE id=? AND resolved_at=0").bind(now,now,id).run();
 }
 await env.DB.prepare("UPDATE psychology_schedule_alerts SET resolved_at=?,updated_at=? WHERE resolved_at=0 AND work_id IN (SELECT id FROM psychology_schedule_work WHERE kind='slot' AND slot_at<? OR kind<>'slot' AND window_at<?)").bind(now,now,now-24*HOUR,now-24*HOUR).run();
 return {checked:work.length,alerts,checkedAt:now};
}
export async function notifyScheduleAlerts(env,now=Date.now(),health={}){
 const alerts=await rows(env.DB,"SELECT id,level,message,opened_at FROM psychology_schedule_alerts WHERE resolved_at=0 ORDER BY CASE level WHEN 'critical' THEN 0 ELSE 1 END,opened_at LIMIT 30");
 // Heartbeat goes to a separate service even when healthy. Its own watchdog can
 // detect this entire factory monitor stopping; recipients come from Hub config.
 try{
  const result=await signalDesk(env,env.DB,'/api/v1/ops/factory-scheduling-alerts',{method:'POST',body:{alerts,healthy:!health.error}});
  if(result.sent)await env.DB.prepare('UPDATE psychology_schedule_alerts SET notified_at=? WHERE id IN (SELECT value FROM json_each(?)) AND resolved_at=0').bind(now,JSON.stringify(alerts.map(a=>a.id))).run();
  await kvSet(env.DB,'psychology-scheduling-notification',{checkedAt:now,sent:!!result.sent,reason:result.reason||'',reachable:true});
  return {sent:!!result.sent,reason:result.reason||''};
 }catch(error){
  await kvSet(env.DB,'psychology-scheduling-notification',{checkedAt:now,reachable:false,reason:'告警通道连接失败，尚未确认送达'});
  throw error;
 }
}
export async function watchScheduling(env,now=Date.now()){
 if(!env.SCHEDULE_QUEUE)return {disabled:true};
 const result={};
 for(const [key,action] of [['expected',()=>ensureScheduleWindow(env,now)],['dispatch',()=>dispatchScheduleWork(env,now)],['health',()=>checkScheduleHealth(env,now)]]){
  try{result[key]=await action();}
  catch(error){result[key]={error:String(error.message||error).slice(0,300)};console.error('psychology-schedule-watchdog-'+key,result[key].error);}
 }
 try{result.notification=await notifyScheduleAlerts(env,now,Object.values(result).find(r=>r.error)||{});}
 catch(error){console.error('psychology-schedule-notification-failed');result.notification={error:'告警通道连接失败'};}
 return result;
}
export async function retryOwnedScheduling(env,user,now=Date.now()){
 const directory=await autopilotDirectory(env,user,true),groups=JSON.stringify(directory.groups.map(g=>g.id));
 const work=await rows(env.DB,"SELECT w.* FROM psychology_schedule_work w LEFT JOIN psychology_autopilots p ON p.id=w.pilot_id WHERE w.owner=? AND w.status='failed' AND ((w.kind='slot' AND w.slot_at>? AND p.group_id IN (SELECT value FROM json_each(?)) AND p.status='active') OR w.kind='owner' AND w.window_at>?)",user.username,now+SCHEDULE_POLICY.minLeadMs,groups,now-6*HOUR);
 for(const w of work)await env.DB.batch([
  env.DB.prepare("UPDATE psychology_schedule_members SET status='pending',reason='',updated_at=? WHERE work_id=? AND status='blocked'").bind(now,w.id),
  env.DB.prepare("UPDATE psychology_schedule_work SET status='queued',attempts=0,available_at=0,dispatched_at=0,detail='',updated_at=? WHERE id=? AND status='failed'").bind(now,w.id),
 ]);
 return {retried:work.length};
}
export async function readScheduleHealth(env,user,url,now=Date.now()){
 const directory=await autopilotDirectory(env,user,true),groups=JSON.stringify(directory.groups.map(g=>g.id)),allowed=new Set(directory.accounts.map(a=>String(a.connectionId||a.id)));
 const work=await rows(env.DB,"SELECT w.* FROM psychology_schedule_work w JOIN psychology_autopilots p ON p.id=w.pilot_id WHERE w.owner=? AND w.kind='slot' AND w.slot_at BETWEEN ? AND ? AND p.group_id IN (SELECT value FROM json_each(?)) ORDER BY w.slot_at,w.id",user.username,now-18*HOUR,now+26*HOUR,groups);
 const workIds=JSON.stringify(work.map(w=>w.id));
 const members=await rows(env.DB,"SELECT m.* FROM psychology_schedule_members m WHERE m.work_id IN (SELECT value FROM json_each(?)) ORDER BY m.work_id,m.ordinal",workIds);
 const visible=members.filter(m=>allowed.has(m.connection_id)),itemIds=JSON.stringify(visible.map(m=>m.item_id).filter(Boolean));
 const itemRows=await rows(env.DB,"SELECT DISTINCT batch_id FROM psychology_publish_items WHERE id IN (SELECT value FROM json_each(?))",itemIds);
 const execution=await slotExecution(env.DB,itemRows.map((r,index)=>({batch_id:r.batch_id,slot_at:index})));
 const byItem=new Map(execution.map(i=>[i.id,i])),roundMap=new Map();
 const accountNames=new Map(directory.accounts.map(a=>[String(a.connectionId||a.id),a.username||a.label||String(a.connectionId||a.id)]));
 for(const w of work){
  const payload=JSON.parse(w.payload_json),date=payload.date||zonedDate(w.slot_at,'America/Los_Angeles'),key=date+':'+(payload.round??w.slot_at);
  if(!roundMap.has(key))roundMap.set(key,{id:key,date,round:payload.round??null,slotAt:w.slot_at,endAt:w.slot_at,status:'done',unknown:false,details:new Map(),updatedAt:0});
  const r=roundMap.get(key);r.slotAt=Math.min(r.slotAt,w.slot_at);r.endAt=Math.max(r.endAt,w.slot_at);r.updatedAt=Math.max(r.updatedAt,w.updated_at);
  if(w.phase===0&&w.status!=='done')r.unknown=true;
  if(w.status==='failed')r.status='failed';else if(w.status!=='done'&&r.status!=='failed')r.status='running';
  for(const a of visible.filter(a=>a.work_id===w.id)){
   const i=byItem.get(a.item_id),state=i?.state||'';
   const detail={account:accountNames.get(a.connection_id)||a.name,status:a.status,state,reason:a.reason||i?.error||'',scheduleAt:i?.scheduleAt||w.slot_at,ready:!!i?.materialReady,submitted:!!i?.submitted,published:state==='published',failed:['production_failed','publish_failed','missing'].includes(state)};
   const old=r.details.get(a.connection_id);if(!old||detail.status==='created')r.details.set(a.connection_id,detail);
  }
 }
 const rounds=[...roundMap.values()].map(r=>{
  const details=[...r.details.values()],counts={expected:r.unknown?null:details.length,created:0,skipped:0,pending:0,blocked:0,ready:0,submitted:0,published:0,failed:0};
  for(const d of details){counts[d.status]++;for(const k of ['ready','submitted','published','failed'])if(d[k])counts[k]++;}
  return {...r,details,counts};
 });
 const alerts=await rows(env.DB,"SELECT id,work_id,level,message,opened_at,updated_at,notified_at FROM psychology_schedule_alerts WHERE resolved_at=0 AND ((owner=? AND (work_id IN (SELECT value FROM json_each(?)) OR work_id IN (SELECT id FROM psychology_schedule_work WHERE owner=? AND kind='owner' AND window_at>?))) OR owner='') ORDER BY opened_at DESC",user.username,workIds,user.username,now-24*HOUR);
 return {rounds,alerts,notification:await kvGet(env.DB,'psychology-scheduling-notification',{}),asOf:now,basis:'应处理 = 已建 + 跳过 + 待建 + 待恢复；已建、素材就绪、平台已接收、已发布分别核对。'};
}
