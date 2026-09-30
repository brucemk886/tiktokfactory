import { sha256Hex } from './http.js';
import { reconcileTaskGroups, taskAssignmentsFor } from './psychology-task-groups.js';

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
    if(!source)continue;
    const slots=source.slots_effective_at&&policy.startsAt>=source.slots_effective_at?source.pending_slots_json:source.slots_json;
    const hash=await sha256Hex(policy.id+':'+policy.startsAt+':'+group.groupId);
    const id='pilot-'+hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
    await env.DB.prepare(`INSERT OR IGNORE INTO psychology_autopilots(id,owner,group_id,group_name,strategy,current_strategy,strategy_started_at,slots_json,status,ends_at,created_at,updated_at,task_group_policy_id,task_group_managed)
      SELECT ?,?,?,?,'evolve','pools',?,?,'active',?,?,?, ?,1 FROM psychology_task_group_policies
      WHERE id=? AND enabled=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM psychology_autopilots WHERE group_id=? AND status<>'ended')`)
      .bind(id,user.username,group.groupId,group.groupName||group.name||group.groupId,policy.startsAt,slots,policy.endsAt,Math.max(now,policy.startsAt),now,policy.id,policy.id,policy.revision,group.groupId).run();
  }
  return result;
}

export async function taskSlotAccounts(db,pilot,ids,slot){
  const policy=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE owner=?').bind(pilot.owner).first();
  if(!policy)return pilot.task_group_managed?[]:ids;
  const enrolled=(await db.prepare('SELECT connection_id,first_seen_at,enrolled,excluded FROM psychology_task_group_accounts WHERE policy_id=? AND connection_id IN (SELECT value FROM json_each(?))').bind(policy.id,JSON.stringify(ids)).all()).results;
  const registry=new Map(enrolled.map(a=>[a.connection_id,a]));
  const selected=pilot.task_group_policy_id===policy.id;
  if(!selected)return ids.filter(id=>!registry.get(id)?.enrolled);
  if(!policy.enabled||slot>=policy.ends_at)return pilot.task_group_managed?[]:ids.filter(id=>registry.get(id)?.enrolled&&!registry.get(id)?.excluded);
  if(slot<policy.starts_at)return pilot.task_group_managed?[]:ids.filter(id=>registry.get(id)?.enrolled&&!registry.get(id)?.excluded&&registry.get(id).first_seen_at<=policy.created_at);
  const assignments=await taskAssignmentsFor(db,pilot.owner,ids,slot);
  const day=new Date(slot+8*3600000).toISOString().slice(0,10);
  const rounds=(await db.prepare('SELECT connection_id,round FROM psychology_task_group_allocations WHERE policy_id=? AND beijing_date=? AND connection_id IN (SELECT value FROM json_each(?))').bind(policy.id,day,JSON.stringify(ids)).all()).results;
  const slots=JSON.parse(pilot.slots_effective_at&&slot>=pilot.slots_effective_at?pilot.pending_slots_json:pilot.slots_json);
  const time=new Date(slot+8*3600000),round=slots.findIndex(s=>s.hour===time.getUTCHours()&&s.minute===time.getUTCMinutes());
  if(round<0||round>2)return [];
  return ids.filter(id=>{const a=assignments.get(id),claims=rounds.filter(c=>c.connection_id===id);return a&&!a.paused&&a.groupId===pilot.group_id&&!claims.some(c=>c.round===round)&&claims.length<3;});
}

export async function taskPublishContext(db,pilot,slot){
  if(!pilot.task_group_policy_id)return {};
  const policy=await db.prepare('SELECT id FROM psychology_task_group_policies WHERE id=? AND enabled=1 AND starts_at<=? AND ends_at>?').bind(pilot.task_group_policy_id,slot,slot).first();
  return policy?{taskGroupPolicyId:policy.id,taskSlotAt:slot}:{};
}

export function sameDeliveryDay(slot,scheduleSeconds,end){
  const actual=scheduleSeconds*1000;
  return actual<end&&new Date(actual+8*3600000).toISOString().slice(0,10)===new Date(slot+8*3600000).toISOString().slice(0,10);
}
