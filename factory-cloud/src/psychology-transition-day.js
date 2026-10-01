import { json,readJson,sha256Hex } from './http.js';
import { kvGet } from './kv.js';
import { loadAutoUser,handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { readPoolMatchingState } from './psychology-pool-report.js';
import { reportAccountScopeSQL } from './official-report-account-scope.js';
import { ensureModuleProjects,findProjectForModule,userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { PACIFIC_TIME_ZONE,zonedDate,zonedEpoch,nextDay,pilotTimeZoneAt } from '../../scripts/psychology-schedule-time.js';
import { readProductionLoad,estimateProductionLead } from './psychology-production-capacity.js';

export const TRANSITION_DATE='2026-10-01';
const BASE='/api/psychology-autopilot/transition-day',HOUR=3600000;
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=(s,f={})=>{try{return JSON.parse(s||'');}catch{return f;}};
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const start=zonedEpoch(TRANSITION_DATE,0,0,PACIFIC_TIME_ZONE);
const end=nextDay(start,PACIFIC_TIME_ZONE);
const roundAt=round=>zonedEpoch(TRANSITION_DATE,round===1?11:20,round===1?30:0,PACIFIC_TIME_ZONE);
async function uuid(text){const h=await sha256Hex(text);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;}

export function validTransitionPolicy(policy){return !!policy&&policy.enabled===1&&policy.enrollment_mode==='project'&&policy.time_zone===PACIFIC_TIME_ZONE&&policy.starts_at===end;}
export function transitionAccountReason({member,snapshot,pool,boundAt,paused,executor}){
 if(!member?.enrolled||member.excluded)return '账号未纳入当前项目运营';
 if(member.paused||snapshot?.paused||paused)return '保留账号或执行计划暂停状态';
 if(!snapshot||!['review','strong','normal'].includes(snapshot.role))return '本次过渡仅安排评审和常规运营账号';
 if(!(boundAt>0)||boundAt>=start||member.first_seen_at>=start)return '新绑定账号从美西次日加入';
 if(!['strong','normal'].includes(pool))return '当前成熟表现不在中强账号池';
 if(!executor||executor.status!=='active')return '当前分组没有可用的自有执行计划';
 return '';
}

export async function readTransitionContext(env,user,now=Date.now(),directory=null){
 const db=env.DB,store=ensureModuleProjects(await kvGet(db,'official-account-groups',{}));
 const project=findProjectForModule(store,'psychology'),grants=userAllowedGroupIds(user);
 const groups=store.groups.filter(g=>g.projectId===project?.id&&(!grants||grants.has(g.id)));
 const policy=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE project_key=? AND owner=?').bind(project?.id||'',user.username).first();
 if(!policy)return {user,policy:null,eligible:[],excluded:[],groups,executors:new Map()};
 const canonical=await rows(db,`${reportAccountScopeSQL} SELECT account_key,current_group,
 (SELECT max(a.updated_at) FROM official_account_assignments a WHERE replace(a.account_key,'tiktok:','')=replace(allowed.account_key,'tiktok:','') AND a.group_id=allowed.current_group) bound_at FROM allowed`,JSON.stringify(groups.map(g=>g.id)));
 directory ||= await kvGet(db,'psychology-autopilot-account-directory-v1',{accounts:[]});
 const live=new Map((directory.fullAccounts||directory.accounts||[]).filter(a=>!Array.isArray(a.scopes)||a.scopes.includes('video.publish')).map(a=>[String(a.connectionId||a.id||a.schema||'').replace(/^tiktok:/,''),a]));
 const registry=await rows(db,'SELECT * FROM psychology_task_group_accounts WHERE policy_id=?',policy.id);
 const snapshots=await rows(db,'SELECT * FROM psychology_task_group_snapshots WHERE policy_id=? AND effective_at<=? ORDER BY effective_at',policy.id,policy.starts_at);
 const latest=new Map(snapshots.map(s=>[s.connection_id,s]));
 const pilots=await rows(db,"SELECT * FROM psychology_autopilots WHERE status<>'ended' ORDER BY created_at,id");
 const states=await rows(db,'SELECT a.connection_id,a.status,a.updated_at,p.updated_at pilot_updated_at FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.owner=? ORDER BY a.updated_at DESC,p.updated_at DESC,a.autopilot_id',user.username);
 const paused=new Map();for(const s of states)if(!paused.has(s.connection_id))paused.set(s.connection_id,s.status==='paused');
 const ids=canonical.map(a=>a.account_key.replace(/^tiktok:/,'')),state=await readPoolMatchingState(db,user,ids,now);
 const eligible=[],excluded=[],executors=new Map();
 for(const a of canonical){const id=a.account_key.replace(/^tiktok:/,''),member=registry.find(r=>r.connection_id===id),snapshot=latest.get(id),executor=pilots.find(p=>p.group_id===a.current_group);
  const reason=!live.has(id)?'当前授权目录中无发布权限':executor?.owner!==user.username?'分组执行计划不属于当前项目控制器':snapshot?.group_id!==a.current_group?'账号分组与未来运营角色不一致':transitionAccountReason({member,snapshot,pool:state.accounts.get(a.account_key)?.pool,boundAt:Number(a.bound_at),paused:paused.get(id),executor});
  if(reason){excluded.push({connectionId:id,reason});continue;}
  eligible.push({connectionId:id,groupId:a.current_group,role:snapshot.role,name:member.name||id,boundAt:Number(a.bound_at),snapshotRevision:snapshot.revision,snapshotEffectiveAt:snapshot.effective_at});executors.set(a.current_group,executor);
 }
 return {user,policy,groups,eligible,excluded,executors,state};
}

function groupRoundAt(executor,round){
 const pending=executor.slots_effective_at&&end>=executor.slots_effective_at;
 const slots=parse(pending?executor.pending_slots_json:executor.slots_json,[]);
 const zone=pilotTimeZoneAt(executor,end);
 if(zone!==PACIFIC_TIME_ZONE||slots.length!==3)fail('未来执行计划与美西三轮发布时间不一致。',409);
 const first=slots[0].hour*60+slots[0].minute,offset=first-480;
 if(offset<0||offset>80||offset%10!==0)fail('分组发布时间错峰配置无效。',409);
 const expected=(round===1?690:1200)+offset;
 if(slots[round].hour*60+slots[round].minute!==expected)fail('未来执行计划与过渡午晚轮不一致。',409);
 return roundAt(round)+offset*60000;
}

export async function transitionAssignmentsFor(db,user,ids,context){
 const transition=await db.prepare('SELECT * FROM psychology_transition_days WHERE id=? AND owner=? AND enabled=1').bind(context.id,user.username).first();
 if(!transition||![1,2].includes(context.round)||context.slotAt<roundAt(context.round)||context.slotAt>=roundAt(context.round)+81*60000)fail('过渡排期上下文无效。',409);
 const policy=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE id=? AND owner=? AND revision=?').bind(transition.policy_id,user.username,transition.policy_revision).first();
 if(!validTransitionPolicy(policy))fail('正式项目配置已变化，停止过渡排期。',409);
 const members=await rows(db,`SELECT m.* FROM psychology_transition_members m
 JOIN psychology_task_group_accounts a ON a.policy_id=? AND a.connection_id=m.connection_id
 WHERE m.transition_id=? AND m.connection_id IN (SELECT value FROM json_each(?))
 AND a.enrolled=1 AND a.excluded=0 AND a.paused=0 AND a.first_seen_at<?
 AND EXISTS(SELECT 1 FROM psychology_task_group_snapshots s WHERE s.policy_id=? AND s.connection_id=m.connection_id AND s.revision=m.snapshot_revision AND s.effective_at=m.snapshot_effective_at AND s.role=m.role AND s.group_id=m.group_id AND s.paused=0
 AND NOT EXISTS(SELECT 1 FROM psychology_task_group_snapshots newer WHERE newer.policy_id=s.policy_id AND newer.connection_id=s.connection_id AND newer.effective_at>s.effective_at AND newer.effective_at<=?))
 AND COALESCE((SELECT a.status FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.owner=? AND a.connection_id=m.connection_id ORDER BY a.updated_at DESC,p.updated_at DESC,a.autopilot_id LIMIT 1),'active')<>'paused'
 AND EXISTS(SELECT 1 FROM psychology_autopilots p WHERE p.owner=? AND p.group_id=m.group_id AND p.status='active')`,policy.id,transition.id,JSON.stringify(ids),start,policy.id,policy.starts_at,user.username,user.username);
 if(members.length!==ids.length)fail('过渡账号权限、暂停或角色已变化，请重新检查。',409);
 return new Map(members.map(m=>[m.connection_id,{policyId:policy.id,id:m.role,role:m.role,revision:m.snapshot_revision,effectiveAt:m.snapshot_effective_at,timeZone:PACIFIC_TIME_ZONE}]));
}

// Bridge claims live outside formal-cycle allocations. They commit with jobs,
// copy-test revision, exact style reservations and items in the same D1 batch.
export function transitionAllocationStatement(db,item,source,now,context){
 if(!context)return null;
 const match=source.poolMatch;
 return db.prepare(`INSERT INTO psychology_transition_claims(transition_id,connection_id,operating_date,round,item_id,source_key,created_at)
 VALUES(CASE WHEN ? IN (1,2) AND ? >= ? AND ? < ? AND ? >= ? AND ? < ?
 AND EXISTS(SELECT 1 FROM psychology_transition_days t JOIN psychology_task_group_policies p ON p.id=t.policy_id
 JOIN psychology_transition_members m ON m.transition_id=t.id AND m.connection_id=?
 JOIN psychology_task_group_accounts a ON a.policy_id=p.id AND a.connection_id=m.connection_id
 WHERE t.id=? AND t.enabled=1 AND t.policy_revision=p.revision AND p.enabled=1 AND p.enrollment_mode='project' AND p.time_zone='America/Los_Angeles' AND p.starts_at=?
 AND a.enrolled=1 AND a.excluded=0 AND a.paused=0 AND a.first_seen_at<?
 AND EXISTS(SELECT 1 FROM official_account_assignments aa WHERE replace(aa.account_key,'tiktok:','')=m.connection_id AND aa.group_id=m.group_id AND aa.updated_at=m.bound_at)
 AND EXISTS(SELECT 1 FROM psychology_task_group_snapshots s WHERE s.policy_id=p.id AND s.connection_id=m.connection_id AND s.revision=m.snapshot_revision AND s.effective_at=m.snapshot_effective_at AND s.role=m.role AND s.group_id=m.group_id AND s.paused=0
 AND NOT EXISTS(SELECT 1 FROM psychology_task_group_snapshots newer WHERE newer.policy_id=s.policy_id AND newer.connection_id=s.connection_id AND newer.effective_at>s.effective_at AND newer.effective_at<=p.starts_at))
 AND COALESCE((SELECT aa.status FROM psychology_autopilot_accounts aa JOIN psychology_autopilots pp ON pp.id=aa.autopilot_id WHERE pp.owner=t.owner AND aa.connection_id=m.connection_id ORDER BY aa.updated_at DESC,pp.updated_at DESC,aa.autopilot_id LIMIT 1),'active')<>'paused'
 AND EXISTS(SELECT 1 FROM psychology_autopilots pp WHERE pp.owner=t.owner AND pp.group_id=m.group_id AND pp.status='active'))
 AND (SELECT count(*) FROM psychology_publish_items WHERE connection_id=? AND schedule_at>=? AND schedule_at<?)<3
 THEN ? ELSE NULL END,?,?,?,?,?,?)`).bind(context.round,item.scheduleAt*1000,context.slotAt,item.scheduleAt*1000,end,now,start,now,end,item.connectionId,context.id,end,start,item.connectionId,start/1000,end/1000,context.id,item.connectionId,TRANSITION_DATE,context.round,item.id,source.usageKey||source.sourceKey,now);
}

export async function readTransitionDay(env,user,now=Date.now(),context=null){
 context ||= await readTransitionContext(env,user,now);
 const transition=await env.DB.prepare('SELECT * FROM psychology_transition_days WHERE owner=? AND operating_date=?').bind(user.username,TRANSITION_DATE).first();
 const slots=transition?await rows(env.DB,'SELECT * FROM psychology_transition_slots WHERE transition_id=? ORDER BY round,slot_at',transition.id):[];
 const counts=transition?await rows(env.DB,`SELECT c.round,j.status,count(*) n,min(gp.generation_at) earliest,max(gp.generation_at) latest,sum(CASE WHEN f.state='published' THEN 1 ELSE 0 END) published
 FROM psychology_transition_claims c LEFT JOIN factory_jobs j ON j.id=c.item_id LEFT JOIN psychology_generation_plans gp ON gp.job_id=c.item_id LEFT JOIN ops_task_facts f ON f.id=c.item_id WHERE c.transition_id=? GROUP BY c.round,j.status`,transition.id):[];
 const rounds=[1,2].map(round=>{
  const matching=slots.filter(s=>s.round===round),resultCounts=counts.filter(c=>c.round===round),states=Object.fromEntries(resultCounts.map(c=>[c.status||'missing',c.n]));
  const details=matching.map(s=>parse(s.detail_json)),previewTimes=matching.length||!validTransitionPolicy(context.policy)?[]:[...context.executors.values()].flatMap(p=>{try{return [groupRoundAt(p,round)];}catch{return [];}});
  const slotAt=matching.length?Math.min(...matching.map(s=>s.slot_at)):previewTimes.length?Math.min(...previewTimes):roundAt(round);
  return {round,label:round===1?'午间过渡轮':'晚间过渡轮',slotAt,lastSlotAt:matching.length?Math.max(...matching.map(s=>s.slot_at)):previewTimes.length?Math.max(...previewTimes):roundAt(round),
   planned:transition?matching.reduce((n,s)=>n+s.planned,0):context.eligible.length,created:resultCounts.reduce((n,c)=>n+c.n,0),published:resultCounts.reduce((n,c)=>n+(c.published||0),0),
   skipped:details.reduce((n,d)=>n+(d.skipped?.length||0),0),states,batchIds:matching.flatMap(s=>parse(s.batch_ids_json,[])),
   generationStartAt:resultCounts.some(c=>c.earliest)?Math.min(...resultCounts.map(c=>c.earliest).filter(Boolean)):0,generationEndAt:Math.max(0,...resultCounts.map(c=>c.latest||0)),
   status:matching.some(s=>s.status==='failed')?'failed':matching.some(s=>s.status==='creating')?'creating':matching.length&&matching.every(s=>s.status==='created')?'created':matching.length?'pending':'not-enabled',detail:details.flatMap(d=>[...(d.errors||[]),...(d.skipped||[]).map(s=>s.reason)]).join('；').slice(0,1500)};
 });
 const policy=context.policy;
 return {date:TRANSITION_DATE,timeZone:PACIFIC_TIME_ZONE,enabled:Boolean(transition?.enabled),canEnable:!transition&&context.eligible.length>0&&validTransitionPolicy(policy)&&zonedDate(now,PACIFIC_TIME_ZONE)===TRANSITION_DATE&&now<=roundAt(1)-2*HOUR,
 canRun:Boolean(transition?.enabled)&&transition.policy_revision===policy?.revision&&validTransitionPolicy(policy)&&now>=start&&now<end&&rounds.some(r=>r.status!=='created'&&r.slotAt-now>=2*HOUR),
 transition:transition?{id:transition.id,policyId:transition.policy_id,policyRevision:transition.policy_revision,createdAt:transition.created_at}:null,
 preview:{eligible:context.eligible.length,review:context.eligible.filter(a=>a.role==='review').length,normal:context.eligible.filter(a=>a.role!=='review').length,excluded:context.excluded},rounds,
 formal:policy?{startsAt:policy.starts_at,endsAt:policy.ends_at,nextReviewAt:policy.next_review_at,revision:policy.revision}:null,asOf:now};
}

async function enableTransition(env,user,body,now){
 if(body.date!==TRANSITION_DATE)fail('仅允许已批准的美西10月1日过渡。');
 const directory=await (await import('./psychology-account-access.js')).publishAccountDirectory(env,{fresh:false});
 const context=await readTransitionContext(env,user,now,directory),policy=context.policy;
 if(!validTransitionPolicy(policy))fail('正式周期须保持美西10月2日起的现有项目设置。',409);
 if(body.revision!==policy.revision)fail('项目配置已变化，请刷新后重试。',409);
 const prior=await env.DB.prepare('SELECT id FROM psychology_transition_days WHERE owner=? AND operating_date=?').bind(user.username,TRANSITION_DATE).first();
 if(prior)return readTransitionDay(env,user,now,context);
 if(zonedDate(now,PACIFIC_TIME_ZONE)!==TRANSITION_DATE||now>roundAt(1)-2*HOUR)fail('午间轮距离发布不足两小时，不再启用过渡。',409);
 if(!context.eligible.length)fail('当前没有可参与过渡的稳定中强号。',409);
 const id='bridge-'+(await sha256Hex(user.username+':'+TRANSITION_DATE)).slice(0,32);
 const statements=[env.DB.prepare(`INSERT INTO psychology_transition_days(id,owner,policy_id,policy_revision,operating_date,time_zone,created_at)
 VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM psychology_task_group_policies WHERE id=? AND owner=? AND revision=? AND enabled=1 AND starts_at=?) THEN ? ELSE NULL END,?,?,?,?)`).bind(id,user.username,policy.id,user.username,policy.revision,end,policy.id,policy.revision,TRANSITION_DATE,PACIFIC_TIME_ZONE,now)];
 for(const a of context.eligible)statements.push(env.DB.prepare('INSERT INTO psychology_transition_members(transition_id,connection_id,group_id,role,snapshot_revision,snapshot_effective_at,bound_at,name) VALUES(?,?,?,?,?,?,?,?)').bind(id,a.connectionId,a.groupId,a.role,a.snapshotRevision,a.snapshotEffectiveAt,a.boundAt,a.name));
 for(const [groupId,pilot] of context.executors)for(const round of [1,2])statements.push(env.DB.prepare('INSERT INTO psychology_transition_slots(transition_id,group_id,round,slot_at,planned,updated_at) VALUES(?,?,?,?,?,?)').bind(id,groupId,round,groupRoundAt(pilot,round),context.eligible.filter(a=>a.groupId===groupId).length,now));
 try{await env.DB.batch(statements);}catch(error){
  const winner=await env.DB.prepare('SELECT id FROM psychology_transition_days WHERE id=? AND owner=? AND policy_revision=?').bind(id,user.username,policy.revision).first();
  if(!winner)throw error;
 }
 return readTransitionDay(env,user,now,context);
}

export async function runTransitionDays(env,now=Date.now(),productionContext=null,actions={}){
 if(now<start||now>=end)return {skipped:true};
 const transitions=await rows(env.DB,"SELECT * FROM psychology_transition_days WHERE enabled=1 AND operating_date=? AND (?='' OR owner=?)",TRANSITION_DATE,env.transitionOwner||'',env.transitionOwner||'');
 if(!transitions.length)return {skipped:true};
 const result={created:0,batches:[],errors:[]};
 let load=productionContext?.load||null;
 for(const transition of transitions){
  const wholeClaim=await env.DB.prepare('UPDATE psychology_transition_days SET run_lease_until=? WHERE id=? AND enabled=1 AND run_lease_until<=?').bind(now+10*60000,transition.id,now).run();
  if(!wholeClaim.meta?.changes)continue;
  try{
   const user=await loadAutoUser(env.DB,transition.owner);
   if(!user.sidebarModules.includes('psychology-autopilot'))continue;
   const directory=actions.loadContext?null:await (await import('./psychology-account-access.js')).publishAccountDirectory(env,{fresh:false});
   const context=actions.loadContext?await actions.loadContext(env,user,now):await readTransitionContext(env,user,now,directory);
   if(!validTransitionPolicy(context.policy)||context.policy.revision!==transition.policy_revision)continue;
   const approved=new Set((await rows(env.DB,'SELECT connection_id FROM psychology_transition_members WHERE transition_id=?',transition.id)).map(a=>a.connection_id));
   const eligible=context.eligible.filter(a=>approved.has(a.connectionId));
   const slots=await rows(env.DB,"SELECT * FROM psychology_transition_slots WHERE transition_id=? AND status<>'created' ORDER BY slot_at,group_id",transition.id);
   if(!slots.length)continue;
   load ||= await readProductionLoad(env.DB,now);
   const musicIds=await kvGet(env.DB,'psychology-auto-music-pool',[]);
   for(const slot of slots){
    // No catch-up or shifting a missed round; complete production must have
    // at least the existing two-hour minimum before the frozen base time.
    if(slot.slot_at-now<2*HOUR)continue;
    const claim=await env.DB.prepare("UPDATE psychology_transition_slots SET status='creating',lease_until=?,updated_at=? WHERE transition_id=? AND group_id=? AND round=? AND status<>'created' AND lease_until<=?").bind(now+10*60000,now,transition.id,slot.group_id,slot.round,now).run();
    if(!claim.meta?.changes)continue;
    const accounts=eligible.filter(a=>a.groupId===slot.group_id),oldDetails=parse(slot.detail_json),errors=[],skipped=[...(oldDetails.skipped||[])],batches=new Set(parse(slot.batch_ids_json,[]));
    const existing=new Set((await rows(env.DB,'SELECT connection_id FROM psychology_transition_claims WHERE transition_id=? AND round=?',transition.id,slot.round)).map(a=>a.connection_id));
    const estimate=estimateProductionLead(load,{accountCount:eligible.length,slotAt:slot.slot_at,owner:user.username,now});
    for(let offset=0;offset<accounts.length;offset+=50){
     const indexed=accounts.slice(offset,offset+50).map((a,index)=>({...a,ordinal:offset+index}));
     // Keep individual original account offsets after a partial transaction.
     for(const segment of contiguousUnclaimed(indexed,existing)){
      const connectionIds=segment.map(a=>a.connectionId),first=segment[0].ordinal;
      const body={requestId:await uuid(`${transition.id}:${slot.group_id}:${slot.round}:${connectionIds.join(',')}`),name:`过渡运营 · ${TRANSITION_DATE} · ${slot.round===1?'午间':'晚间'} · ${slot.group_id}`,
       mediaType:'photo',template:'photo-text',sourceType:'library',libraryStrategy:'pools',libraryTestPolicy:'pools-v1',count:connectionIds.length,connectionIds,
       poolContext:{cycleStartAt:start,dayIndex:0,postsPerDay:3,round:slot.round,timeZone:PACIFIC_TIME_ZONE},pairSeed:`${user.username}:${TRANSITION_DATE}:round-${slot.round+1}`,
       scheduleAt:slot.slot_at/1000+first*45,intervalMinutes:60,staggerSeconds:45,styleMode:'random',styleId:'classic',musicIds};
      try{
       const publish=actions.publish||handlePsychologyAutoPublish;
       const response=await publish(new Request('https://transition.internal/api/psychology-auto-publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,new URL('https://transition.internal/api/psychology-auto-publish'),{user},
        {productionLeadMs:estimate.leadMs,productionPlan:estimate,transitionDay:{id:transition.id,round:slot.round,slotAt:slot.slot_at}});
       const data=await response.json();if(!response.ok)throw new Error(data.error||'过渡创建失败');
       skipped.push(...(data.skipped||[]));if(data.batchId){batches.add(data.batchId);result.batches.push(data.batchId);result.created+=data.count||0;}
      }catch(error){errors.push(String(error.message||error).slice(0,300));}
     }
    }
    for(const member of await rows(env.DB,'SELECT connection_id FROM psychology_transition_members WHERE transition_id=? AND group_id=?',transition.id,slot.group_id))if(!accounts.some(a=>a.connectionId===member.connection_id)&&!existing.has(member.connection_id))skipped.push({connectionId:member.connection_id,reason:context.excluded.find(a=>a.connectionId===member.connection_id)?.reason||'账号已不符合当前过渡条件'});
    const detail={skipped:[...new Map(skipped.map(a=>[a.connectionId,a])).values()],errors};
    await env.DB.prepare('UPDATE psychology_transition_slots SET status=?,lease_until=0,batch_ids_json=?,detail_json=?,updated_at=? WHERE transition_id=? AND group_id=? AND round=? AND lease_until=?').bind(errors.length?'failed':'created',JSON.stringify([...batches]),JSON.stringify(detail),now,transition.id,slot.group_id,slot.round,now+10*60000).run();
    result.errors.push(...errors);
   }
  }catch(error){result.errors.push(String(error.message||error).slice(0,300));}
  finally{await env.DB.prepare('UPDATE psychology_transition_days SET run_lease_until=0 WHERE id=? AND run_lease_until=?').bind(transition.id,now+10*60000).run();}
 }
 return result;
}
function contiguousUnclaimed(accounts,claims){
 const segments=[];let segment=[];
 for(const account of accounts){if(claims.has(account.connectionId)){if(segment.length)segments.push(segment);segment=[];}else segment.push(account);}
 if(segment.length)segments.push(segment);return segments;
}

export async function handleTransitionDay(request,env,url,session,internal={}){
 if(url.pathname!==BASE&&url.pathname!==BASE+'/run')return null;
 const user=await loadAutoUser(env.DB,session?.user?.username||'');
 if(!user.sidebarModules.includes('psychology-autopilot'))fail('没有心理学自动运营权限。',403);
 const now=Number.isSafeInteger(internal.now)?internal.now:Date.now();
 if(request.method==='GET'&&url.pathname===BASE)return json(await readTransitionDay(env,user,now));
 if(request.method!=='POST')fail('不支持此请求。',405);
 const body=await readJson(request);
 if(url.pathname===BASE)return json(await enableTransition(env,user,body,now),201);
 if(body.date!==TRANSITION_DATE)fail('仅运行已批准的美西10月1日过渡。');
 const view=await readTransitionDay(env,user,now);
 if(!view.enabled||!view.canRun)fail('当前没有可运行的已批准过渡排期。',409);
 // Only this controller's approved bridge is eligible for the manual catch-up;
 // no existing normal/legacy plans are triggered here.
 await runTransitionDays({...env,transitionOwner:user.username},now,null);
 return json(await readTransitionDay(env,user,now));
}
