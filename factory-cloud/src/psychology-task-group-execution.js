import { sha256Hex } from './http.js';
import { DEFAULT_TIME_ZONE, PACIFIC_TIME_ZONE, normalizeTimeZone, zonedDate, zonedParts, pilotTimeZoneAt } from '../../scripts/psychology-schedule-time.js';
import { reconcileTaskGroups, taskAssignmentsFor, taskLegacyReservationsSQL } from './psychology-task-groups.js';

// Permission groups remain delivery executors; task memberships never move
// permission assignments or rewrite existing items.
export async function reconcileTaskExecutors(env,user,directory,now){
  const result=await reconcileTaskGroups(env,user,directory,now);
  const policy=result?.policy;
  if(!policy?.enabled||now>=policy.endsAt)return result;
  for(const group of result.newExecutorGroups||[]){
    const existing=await env.DB.prepare("SELECT id FROM psychology_autopilots WHERE group_id=? AND status<>'ended'").bind(group.groupId).first();
    if(existing)continue;
    const source=await env.DB.prepare('SELECT * FROM psychology_autopilots WHERE owner=? AND id IN (SELECT value FROM json_each(?)) ORDER BY created_at,id LIMIT 1').bind(user.username,JSON.stringify(policy.sourcePilotIds)).first();
    if(!source&&policy.enrollmentMode!=='project')continue;
    const offset=(Number.parseInt((await sha256Hex(group.groupId)).slice(0,8),16)%9)*10;
    const defaultSlots=(policy.timeZone===PACIFIC_TIME_ZONE?[480,690,1200]:[480,840,1200]).map(value=>({hour:Math.floor((value+(policy.timeZone===PACIFIC_TIME_ZONE?offset:0))/60),minute:(value+(policy.timeZone===PACIFIC_TIME_ZONE?offset:0))%60}));
    const timeZone=normalizeTimeZone(policy.timeZone);
    const slots=source&&policy.enrollmentMode!=='project'?(source.slots_effective_at&&policy.startsAt>=source.slots_effective_at?source.pending_slots_json:source.slots_json):JSON.stringify(defaultSlots);
    const createdAt=Math.max(now,policy.startsAt,group.effectiveAt||0);
    const prior=await env.DB.prepare("SELECT id FROM psychology_autopilots WHERE group_id=? AND owner=? AND status='ended' ORDER BY updated_at DESC,id LIMIT 1").bind(group.groupId,user.username).first();
    const hash=await sha256Hex(policy.id+':'+policy.startsAt+':'+group.groupId+':'+(prior?.id||''));
    const id='pilot-'+hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
    await env.DB.prepare(`INSERT OR IGNORE INTO psychology_autopilots(id,owner,group_id,group_name,strategy,current_strategy,strategy_started_at,slots_json,schedule_timezone,status,ends_at,created_at,updated_at,task_group_policy_id,task_group_managed)
      SELECT ?,?,?,?,'evolve','pools',?,?,?,'active',?,?,?, ?,1 FROM psychology_task_group_policies
      WHERE id=? AND enabled=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM psychology_autopilots WHERE group_id=? AND status<>'ended')
      AND NOT EXISTS(SELECT 1 FROM psychology_autopilots WHERE group_id=? AND owner=? AND status='ended' AND ends_at>?)
      AND NOT EXISTS(SELECT 1 FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id WHERE p.group_id=? AND (p.task_group_policy_id<>? OR p.status='ended') AND s.slot_at>=? AND NOT EXISTS(SELECT 1 FROM psychology_publish_items i WHERE i.batch_id=s.batch_id))
      AND NOT EXISTS(SELECT 1 FROM (${taskLegacyReservationsSQL}) legacy JOIN psychology_task_group_snapshots m ON m.policy_id=? AND m.connection_id=legacy.connection_id
        WHERE m.group_id=? AND m.effective_at=(SELECT max(t.effective_at) FROM psychology_task_group_snapshots t WHERE t.policy_id=m.policy_id AND t.connection_id=m.connection_id) AND legacy.reserved_at>=m.effective_at)`)
      .bind(id,user.username,group.groupId,group.groupName||group.name||group.groupId,policy.startsAt,slots,timeZone,policy.endsAt,createdAt,now,policy.id,policy.id,policy.revision,group.groupId,group.groupId,user.username,now,group.groupId,policy.id,createdAt,JSON.stringify(group.connectionIds),now,policy.id,policy.id,group.groupId).run();
  }
  return result;
}

export async function taskSlotAccounts(db,pilot,ids,slot){
  const policy=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE owner=?').bind(pilot.owner).first();
  if(!policy)return pilot.task_group_managed?[]:ids;
  const enrolled=(await db.prepare('SELECT connection_id,first_seen_at,legacy_member,enrolled,excluded FROM psychology_task_group_accounts WHERE policy_id=? AND connection_id IN (SELECT value FROM json_each(?))').bind(policy.id,JSON.stringify(ids)).all()).results;
  const registry=new Map(enrolled.map(a=>[a.connection_id,a]));
  const selected=pilot.task_group_policy_id===policy.id;
  if(!selected)return ids.filter(id=>!registry.get(id)?.enrolled);
  if(!policy.enabled||slot>=policy.ends_at)return pilot.task_group_managed?[]:ids.filter(id=>registry.get(id)?.enrolled&&!registry.get(id)?.excluded);
  // A prestart timezone conversion may move the cycle later. Do not backfill
  // the old schedule into that gap; already-frozen items still run unchanged.
  if(policy.prestart_cutoff_at&&slot>=policy.prestart_cutoff_at&&slot<policy.starts_at)return [];
  if(slot<policy.starts_at)return pilot.task_group_managed?[]:ids.filter(id=>registry.get(id)?.enrolled&&!registry.get(id)?.excluded&&(policy.enrollment_mode==='project'?registry.get(id).legacy_member===1:registry.get(id).first_seen_at<=policy.created_at));
  const assignments=await taskAssignmentsFor(db,pilot.owner,ids,slot);
  const timeZone=normalizeTimeZone(policy.time_zone),day=zonedDate(slot,timeZone);
  const rounds=(await db.prepare('SELECT connection_id,round FROM psychology_task_group_allocations WHERE policy_id=? AND beijing_date=? AND connection_id IN (SELECT value FROM json_each(?))').bind(policy.id,day,JSON.stringify(ids)).all()).results;
  const slots=JSON.parse(pilot.slots_effective_at&&slot>=pilot.slots_effective_at?pilot.pending_slots_json:pilot.slots_json);
  const time=zonedParts(slot,pilotTimeZoneAt(pilot,slot)),round=slots.findIndex(s=>s.hour===time.hour&&s.minute===time.minute);
  if(round<0||round>2)return [];
  return ids.filter(id=>{const a=assignments.get(id),claims=rounds.filter(c=>c.connection_id===id);return a&&!a.paused&&a.groupId===pilot.group_id&&!claims.some(c=>c.round===round)&&claims.length<3;});
}

export async function taskPublishContext(db,pilot,slot){
  if(!pilot.task_group_policy_id)return {};
  const policy=await db.prepare('SELECT id FROM psychology_task_group_policies WHERE id=? AND enabled=1 AND starts_at<=? AND ends_at>?').bind(pilot.task_group_policy_id,slot,slot).first();
  return policy?{taskGroupPolicyId:policy.id,taskSlotAt:slot}:{};
}

export function sameDeliveryDay(slot,scheduleSeconds,end,timeZone=DEFAULT_TIME_ZONE){
  const actual=scheduleSeconds*1000;
  return actual<end&&zonedDate(actual,timeZone)===zonedDate(slot,timeZone);
}
