import { PRODUCTION_POLICY, estimateProductionLead, readProductionAccountCounts } from './psychology-production-capacity.js';

const MINUTE=60000, DISPATCH_LEASE=2*MINUTE;
// Only untouched source jobs can change their generation time. A retry's
// available_at is a backoff deadline and must never be rewritten here.
const UNTOUCHED=`EXISTS(SELECT 1 FROM factory_jobs j JOIN psychology_publish_items i ON i.id=j.id
  JOIN psychology_publish_groups g ON g.id=i.publish_group_id
  WHERE j.id=psychology_generation_plans.job_id AND j.type='psychology-photo-story'
  AND j.status='queued' AND j.worker_id='' AND j.auto_retry_count=0
  AND j.result_json='{}' AND i.job_id=j.id AND i.deleted_at=0
  AND i.ready_json='{}' AND i.receipt_json='{}' AND g.status='waiting'
  AND g.request_json='{}' AND g.response_json='{}'
  AND NOT EXISTS(SELECT 1 FROM factory_jobs child WHERE child.id=j.id||'-render'))`;
const PENDING=`policy='adaptive-v1' AND dispatch_at=0 AND started_at=0 AND dispatch_lease_until<=? AND ${UNTOUCHED}`;

export function makeProductionPlan(estimate,scheduleAt,now=Date.now()) {
  if(estimate?.policy!==PRODUCTION_POLICY.version)return null;
  const leadMs=Math.min(PRODUCTION_POLICY.maxLeadMs,Math.max(PRODUCTION_POLICY.minLeadMs,Number(estimate.leadMs)||0));
  const plan={policy:PRODUCTION_POLICY.version,asOf:now,leadMs};
  for(const key of ['requiredLeadMs','forecastJobs','backlogJobs','accountCount','sampleCount','serviceMs'])
    plan[key]=Math.max(0,Math.floor(Number(estimate[key])||0));
  plan.requiredLeadMs=Math.max(leadMs,plan.requiredLeadMs);
  plan.capacityRisk=!!estimate.capacityRisk||plan.requiredLeadMs>PRODUCTION_POLICY.maxLeadMs;
  plan.shortLead=!!estimate.shortLead||scheduleAt-now<plan.requiredLeadMs;
  plan.reason=String(estimate.reason||'').slice(0,500);
  return {...plan,generationAt:Math.max(now,scheduleAt-leadMs)};
}

export function generationPlanStatement(db,id,plan,now) {
  return db.prepare(`INSERT INTO psychology_generation_plans(job_id,policy,generation_at,initial_generation_at,lead_ms,required_lead_ms,evaluated_at,plan_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(id,plan.policy,plan.generationAt,plan.generationAt,plan.leadMs,plan.requiredLeadMs,now,JSON.stringify(plan),now);
}

export async function recalculateAdaptiveProduction(env,now=Date.now(),context=null) {
  const rows=await env.DB.prepare(`SELECT gp.*,j.created_by owner,i.schedule_at*1000 scheduleAt
    FROM psychology_generation_plans gp JOIN factory_jobs j ON j.id=gp.job_id JOIN psychology_publish_items i ON i.id=gp.job_id
    WHERE gp.job_id IN (SELECT job_id FROM psychology_generation_plans WHERE ${PENDING}) ORDER BY gp.job_id`).bind(now).all();
  if(!rows.results.length)return {evaluated:0,advanced:0};
  context ||= await (await import('./psychology-autopilot.js')).readAutopilotProductionContext(env,null,null,now);
  const localCounts=await readProductionAccountCounts(env.DB,now);
  let advanced=0;
  const pending=[];
  for(const row of rows.results){
    const load={...context.load};
    if(Array.isArray(load.forecasts)){
      load.forecasts=[...load.forecasts];
      for(const [owner,count] of Object.entries(localCounts)){
        const forecast=load.forecasts.filter(f=>f.owner===owner&&Math.abs(f.slotAt-row.scheduleAt)<=PRODUCTION_POLICY.slotWindowMs).reduce((n,f)=>n+f.accountCount,0);
        if(count>forecast)load.forecasts.push({owner,slotAt:row.scheduleAt,accountCount:count-forecast});
      }
    }else {
      load.accountCounts={...load.accountCounts};
      for(const [owner,count] of Object.entries(localCounts))load.accountCounts[owner]=Math.max(load.accountCounts[owner]||0,count);
    }
    const estimate=estimateProductionLead(load,{owner:row.owner,accountCount:Math.max(context.owners.get(row.owner)?.accountCount||0,localCounts[row.owner]||0),slotAt:row.scheduleAt,now});
    const plan=makeProductionPlan(estimate,row.scheduleAt,now);
    // Once brought forward, lower load cannot move a saved start later again.
    plan.generationAt=Math.min(row.generation_at,plan.generationAt);
    plan.leadMs=Math.max(row.lead_ms,plan.leadMs);
    pending.push({advanced:plan.generationAt<row.generation_at,statements:[
      env.DB.prepare(`UPDATE psychology_generation_plans SET generation_at=?,lead_ms=?,required_lead_ms=?,evaluated_at=?,plan_json=?,updated_at=? WHERE job_id=? AND generation_at=? AND evaluated_at=? AND ${PENDING}`)
        .bind(plan.generationAt,plan.leadMs,plan.requiredLeadMs,now,JSON.stringify(plan),now,row.job_id,row.generation_at,row.evaluated_at,now),
      env.DB.prepare(`UPDATE factory_jobs SET available_at=? WHERE id=? AND EXISTS(SELECT 1 FROM psychology_generation_plans WHERE job_id=? AND evaluated_at=? AND generation_at=? AND ${PENDING})`)
        .bind(plan.generationAt,row.job_id,row.job_id,now,plan.generationAt,now),
    ]});
  }
  for(let offset=0;offset<pending.length;offset+=40){
    const chunk=pending.slice(offset,offset+40),results=await env.DB.batch(chunk.flatMap(item=>item.statements));
    for(let i=0;i<chunk.length;i++)if(chunk[i].advanced&&results[i*2].meta?.changes)advanced++;
  }
  return {evaluated:rows.results.length,advanced};
}

export async function dispatchAdaptiveProduction(env,now=Date.now()) {
  const rows=await env.DB.prepare(`SELECT job_id FROM psychology_generation_plans WHERE generation_at<=? AND ${PENDING} ORDER BY generation_at,job_id LIMIT 100`).bind(now,now).all();
  const leased=[];
  for(const row of rows.results){
    const result=await env.DB.prepare(`UPDATE psychology_generation_plans SET dispatch_lease_until=? WHERE job_id=? AND generation_at<=? AND ${PENDING}`).bind(now+DISPATCH_LEASE,row.job_id,now,now).run();
    if(result.meta?.changes)leased.push(row.job_id);
  }
  if(!leased.length)return {dispatched:0};
  const binding=env.PEER_PHOTO_WORKFLOW;
  // createBatch skips existing stable IDs. If the RPC reply is lost, let the
  // lease expire and repeat the same IDs without restart or paid resubmission.
  if(typeof binding.createBatch==='function')await binding.createBatch(leased.map(id=>({id,params:{jobId:id}})));
  else for(const id of leased){
    try {await (await binding.get(id)).status();}
    catch {try {await binding.create({id,params:{jobId:id}});} catch(error){try{await (await binding.get(id)).status();}catch{throw error;}}}
  }
  await env.DB.batch(leased.map(id=>env.DB.prepare(`UPDATE psychology_generation_plans SET dispatch_at=?,dispatch_lease_until=0,updated_at=? WHERE job_id=? AND dispatch_lease_until=?`).bind(now,now,id,now+DISPATCH_LEASE)));
  return {dispatched:leased.length};
}

export async function beginAdaptiveProduction(db,id,now=Date.now()) {
  const row=await db.prepare(`SELECT gp.generation_at,gp.started_at,j.status,i.deleted_at,i.ready_json,i.receipt_json,g.status group_status,g.request_json,g.response_json
    FROM psychology_generation_plans gp JOIN factory_jobs j ON j.id=gp.job_id JOIN psychology_publish_items i ON i.id=j.id AND i.job_id=j.id
    JOIN psychology_publish_groups g ON g.id=i.publish_group_id WHERE gp.job_id=? AND gp.policy='adaptive-v1'`).bind(id).first();
  if(!row||!['queued','running'].includes(row.status)||row.deleted_at||row.ready_json!=='{}'||row.receipt_json!=='{}'||row.group_status!=='waiting'||row.request_json!=='{}'||row.response_json!=='{}')return false;
  if(row.generation_at>now)throw new Error('动态生成任务尚未到计划开始时间。');
  const live=`EXISTS(SELECT 1 FROM factory_jobs j JOIN psychology_publish_items i ON i.id=j.id AND i.job_id=j.id JOIN psychology_publish_groups g ON g.id=i.publish_group_id
    WHERE j.id=psychology_generation_plans.job_id AND j.status IN ('queued','running') AND i.deleted_at=0 AND i.ready_json='{}' AND i.receipt_json='{}'
    AND g.status='waiting' AND g.request_json='{}' AND g.response_json='{}')`;
  const claimed=await db.batch([
    db.prepare(`UPDATE psychology_generation_plans SET started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END,updated_at=? WHERE job_id=? AND generation_at<=? AND ${live}`).bind(now,now,id,now),
    db.prepare(`UPDATE factory_jobs SET status='running',worker_id='cloud-photo',updated_at=? WHERE id=? AND status IN ('queued','running') AND EXISTS(SELECT 1 FROM psychology_generation_plans WHERE job_id=? AND started_at>0 AND generation_at<=? AND ${live})`).bind(now,id,id,now),
  ]);
  return !!claimed[1].meta?.changes;
}
