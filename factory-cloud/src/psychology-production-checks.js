import { autopilotCheckWindow } from './psychology-autopilot-execution.js';
const KEY='psychology-production-check-v1',GRACE_MS=15*60000;

// The minute timer only compares the clock outside these three Pacific windows;
// it does not query accounts, the queue, or create an operating plan.
export async function runProductionCheck(env,now=Date.now(),actions={}) {
  const window=autopilotCheckWindow(now);
  if(env.SCHEDULE_QUEUE && !actions.runPlans){
    if(now-window.scheduledAt>=GRACE_MS)return {skipped:true};
    const scheduler=await import('./psychology-durable-scheduling.js');
    const seeded=await scheduler.ensureScheduleWindow(env,now);
    return {...seeded,...await scheduler.dispatchScheduleWork(env,now)};
  }
  if(now-window.scheduledAt>=GRACE_MS)return {skipped:true};
  const started={key:window.key,scheduledAt:window.scheduledAt,status:'running',at:now};
  const claim=await env.DB.prepare(`INSERT INTO factory_kv(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
    WHERE COALESCE(json_extract(factory_kv.value_json,'$.scheduledAt'),0)<?`).bind(KEY,JSON.stringify(started),now,window.scheduledAt).run();
  if(!claim.meta?.changes)return {skipped:true};
  const result={key:window.key,scheduledAt:window.scheduledAt,status:'done',at:now};
  try{
    const run=actions.runPlans||((e,t)=>import('./psychology-autopilot.js').then(m=>m.runAutopilots(e,t)));
    const plans=await run(env,now);
    try{
      const bridge=actions.runTransitions||((e,t,c)=>import('./psychology-transition-day.js').then(m=>m.runTransitionDays(e,t,c)));
      result.transition=await bridge(env,now,plans.productionContext||null);
      if(result.transition.errors?.length)result.errors=(result.errors||0)+result.transition.errors.length;
    }catch(error){result.transitionError=String(error.message||error).slice(0,300);result.errors=(result.errors||0)+1;}
    result.plans=Object.keys(plans).length;
    result.batches=Object.values(plans).reduce((n,p)=>n+(p.batches?.length||0),0);
    result.errors=(result.errors||0)+Object.values(plans).reduce((n,p)=>n+(p.error?1:0)+(p.errors?.length||0),0);
  }catch(error){result.errors=1;result.error=String(error.message||error).slice(0,300);}
  try{
    const recalculate=actions.recalculate||((e,t)=>import('./psychology-adaptive-production.js').then(m=>m.recalculateAdaptiveProduction(e,t)));
    result.generation=await recalculate(env,now);
  }catch(error){result.errors=(result.errors||0)+1;result.error=String(error.message||error).slice(0,300);}
  try{
    const refresh=actions.refreshCapacity||((e,t)=>import('./psychology-autopilot.js').then(m=>m.refreshProductionCapacitySnapshots(e,t)));
    result.capacitySnapshots=await refresh(env,now);
  }catch(error){result.errors=(result.errors||0)+1;result.error=String(error.message||error).slice(0,300);}
  try{
    const capture=actions.captureObservations||((e,t,w)=>import('./psychology-pool-observations.js').then(m=>m.capturePoolObservations(e,t,w)));
    result.poolObservations=await capture(env,now,window);
  }catch(error){
    result.observationError=String(error.message||error).slice(0,300);
    console.error('psychology-pool-observation-failed',result.observationError);
  }
  if(result.errors)result.status='failed';
  await env.DB.prepare('UPDATE factory_kv SET value_json=?,updated_at=? WHERE key=? AND value_json=?').bind(JSON.stringify(result),now,KEY,JSON.stringify(started)).run();
  if(result.errors)console.error('psychology-operating-check-failed',JSON.stringify(result));
  return result;
}
