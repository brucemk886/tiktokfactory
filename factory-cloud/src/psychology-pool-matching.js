import { normalizeTimeZone, zonedDate } from '../../scripts/psychology-schedule-time.js';
import { POOL_POLICY, classifyAccountPool, desiredContentPool, rankPoolCandidates } from '../../scripts/psychology-pool-policy.js';
import { librarySource, reviewedSource } from './psychology-copy-source.js';
import { copyIdentity } from './psychology-creative.js';
import { occupiesTest } from './psychology-copy-testing.js';
import { poolPerformanceKey } from './psychology-pool-report.js';
import { parseObject } from '../../scripts/psychology-operations.js';

const DAY = 86400000;
const canonical = id => 'tiktok:' + String(id).replace(/^tiktok:/, '');
const median = values => { const sorted=[...values].sort((a,b)=>a-b), n=sorted.length; return n ? (sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2 : null; };

// All ongoing and uncertain remote outcomes reserve their original exact sample.
// The allocator revision is committed alongside these rows by auto-publish.
export async function loadPoolReservations(db, owner, cycleStartAt, now = Date.now()) {
  const rows=(await db.prepare(`SELECT i.id,i.batch_id,i.connection_id,i.deleted_at,
    json_object('batchId',json_extract(i.receipt_json,'$.batchId')) receipt_json,
    CASE WHEN i.ready_json='{}' THEN '{}' ELSE '{"ready":true}' END ready_json,i.publish_group_id,
    c.source_key,c.variant_id,c.style_id,c.copy_hash,j.status,j.type,json_object('publishFailed',json_extract(j.result_json,'$.publishFailed')) result_json,
    g.status group_status,CASE WHEN g.request_json IS NULL THEN NULL WHEN g.request_json='{}' THEN '{}' ELSE '{"reserved":true}' END request_json,r.status retry_status,
    m.account_pool,m.cycle_start_at,COALESCE(m.style_revision,CAST(json_extract(j.payload_json,'$.psychologyAutomation.styleDefinition.revision') AS INTEGER),0) style_revision,m.created_at match_created_at,
    f.state fact_state,f.published_at,f.views,f.completion
    FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
    JOIN psychology_creative_snapshots c ON c.item_id=i.id
    LEFT JOIN factory_jobs j ON j.id=i.job_id
    LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id
    LEFT JOIN factory_jobs r ON r.id=g.id||'-submit'
    LEFT JOIN psychology_pool_matches m ON m.item_id=i.id
    LEFT JOIN ops_task_facts f ON f.id=i.id
    WHERE b.created_by=? AND b.created_at>=?
    AND json_extract(b.config_json,'$.mediaType')='photo' ORDER BY b.created_at,i.id LIMIT 20001`)
    .bind(owner,Math.min(now-30*DAY,cycleStartAt)).all()).results;
  if(rows.length>20000)throw Object.assign(new Error('匹配占位记录超过核对上限，请缩小运营范围后重试。'),{statusCode:409});
  const records=rows.length ? (await db.prepare(`SELECT json_object('autoTaskId',json_extract(value_json,'$.autoTaskId'),'autoBatchId',json_extract(value_json,'$.autoBatchId'),'batchId',json_extract(value_json,'$.batchId'),'officialRemoteStatus',json_extract(value_json,'$.officialRemoteStatus'),'status',json_extract(value_json,'$.status')) value_json FROM factory_publish_records WHERE
    json_extract(value_json,'$.autoTaskId') IN (SELECT value FROM json_each(?))
    ORDER BY COALESCE(json_extract(factory_publish_records.value_json,'$.updatedAt'),0)`).bind(JSON.stringify(rows.map(r=>r.id))).all()).results : [];
  const byItem=new Map(records.map(r=>{const value=parseObject(r.value_json);return [value.autoTaskId,value];}));
  const occupied=new Map(),cycles=new Map();
  for(const row of rows){
    const raw=byItem.get(row.id)||{}, record=raw.autoBatchId&&raw.autoBatchId!==row.batch_id?{}:raw;
    if(!occupiesTest(row,record,{status:row.group_status,request_json:row.request_json,retry_status:row.retry_status}))continue;
    const key=poolPerformanceKey({source:row.source_key,variant:row.variant_id,style:row.style_id,copyHash:row.copy_hash,styleRevision:row.style_revision||0});
    const reservation=occupied.get(key)||{posts:0,accounts:new Set()};
    reservation.posts++;reservation.accounts.add(row.connection_id);occupied.set(key,reservation);
    if(row.cycle_start_at!==cycleStartAt)continue;
    const cycle=cycles.get(row.connection_id)||{posts:0,initialPool:row.account_pool,values:[],completions:[],sources:new Set()};
    cycle.posts++;
    if(row.fact_state==='published'&&row.published_at>0&&row.published_at<=now-POOL_POLICY.maturityHours*3600000&&row.views!=null){
      cycle.values.push(row.views);cycle.sources.add(row.source_key);
      if(row.completion!=null&&row.completion>=0&&row.completion<=1)cycle.completions.push(row.completion);
    }
    cycles.set(row.connection_id,cycle);
  }
  for(const cycle of cycles.values()){
    cycle.stats={n:cycle.values.length,medianViews:median(cycle.values),
      completion:cycle.completions.length?cycle.completions.reduce((n,v)=>n+v,0)/cycle.completions.length:null};
    cycle.mature=cycle.values.length;cycle.sources=cycle.sources.size;
    delete cycle.values;delete cycle.completions;
  }
  return {occupied,cycles};
}

// Freeze the copy hash and one style while completing a five-account baseline.
// Version scores are never inherited from a different copy, style or viral source.
export async function buildPoolCandidates(posts, state, styles, reservations = new Map()) {
  const active=styles.filter(s=>s.enabled), byStyle=new Map(active.map(s=>[s.id,s])), grouped=new Map();
  for(const observed of state.versions.values()){
    const key=JSON.stringify([observed.source,observed.version,observed.copyHash]);
    const list=grouped.get(key)||[];list.push(observed);grouped.set(key,list);
  }
  const candidates=[];
  for(const post of posts){
    const versions=[...(post.original?[{row:post.original,id:''}]:[]),...post.rewrites.map(row=>({row,id:row.external_id}))];
    const available=[];
    for(const version of versions){
      let source,identity;
      try {source=version.id?reviewedSource(version.row,'photo'):librarySource(version.row,'photo');identity=await copyIdentity(source.copyVariant);} catch {continue;}
      const observed=(grouped.get(JSON.stringify([post.sourceKey,version.id,identity.hash]))||[])
        .filter(v=>byStyle.has(v.style)&&byStyle.get(v.style).revision===(v.styleRevision||0));
      // Existing samples are completed before opening another style experiment.
      const choices=observed.map(value=>({...value,occupied:reservations.get(poolPerformanceKey(value))?.posts||0}))
        .sort((a,b)=>['winner','optimize','potential','explore','revise'].indexOf(a.pool)-['winner','optimize','potential','explore','revise'].indexOf(b.pool)
          || Math.max(b.stats.n,b.occupied)-Math.max(a.stats.n,a.occupied)
          || (b.stats.medianViews??-1)-(a.stats.medianViews??-1));
      const best=choices[0],style=best?byStyle.get(best.style):(byStyle.get('classic')||active[0]);
      if(!style)continue;
      const key=poolPerformanceKey({source:post.sourceKey,variant:version.id,style:style.id,copyHash:identity.hash,styleRevision:style.revision||0});
      const stats=best?.stats||{n:0,medianViews:null,completion:null,accounts:0,versionKnown:true,styleKnown:true};
      available.push({key,post,row:version.row,variantId:version.id,source,identity,styleDefinition:style,
        stats,pool:best?.pool||'explore',occupied:reservations.get(key)?.posts||0});
    }
    // Keep the same two unjudged rewrites in flight, rather than scattering tests.
    const cold=available.filter(c=>c.variantId&&c.pool==='explore')
      .sort((a,b)=>b.occupied-a.occupied||b.stats.n-a.stats.n||(a.row.created_at||0)-(b.row.created_at||0));
    const activeRewrites=new Set(cold.slice(0,2));
    candidates.push(...available.filter(c=>!c.variantId||c.pool!=='explore'||activeRewrites.has(c)));
  }
  return candidates;
}

export function planPoolMatches({candidates,accounts,slots,used=new Map(),occupied=new Map(),cycles=new Map(),context,owner='',pairSeed='',taskAssignments=new Map(),conversionAssignments=new Map()}){
  const plan=[],skipped=[],extra=new Map(),cycleExtra=new Map();
  const cycle=context.cycleStartAt;
  for(const slot of slots){
    let observed=accounts.get(canonical(slot.connectionId));
    if(!observed){skipped.push({...slot,reason:'账号已不在当前授权心理学分组中'});continue;}
    const conversionKey=`${slot.connectionId}:${slot.scheduleAt*1000}`;
    const conversion=conversionAssignments.get(conversionKey);
    const converting=conversionAssignments.has(conversionKey);
    if(converting&&(conversion?.objective!=='conversion'||conversion.error||conversion.linkReady!==true||!conversion.receiverConnectionId||! /^[A-Za-z0-9._]{1,24}$/.test(conversion.username||'')||!conversion.cta)){
      skipped.push({...slot,reason:conversion?.error||'转化承接账号待配置，请确认账号主页已设置测试链接'});continue;
    }
    const prior=cycles.get(slot.connectionId),count=(prior?.posts||0)+(cycleExtra.get(slot.connectionId)||0);
    if(!converting&&(prior?.initialPool==='diagnostic'||observed.pool==='diagnostic')&&count>=POOL_POLICY.diagnosticMaxTests){
      if(!prior||prior.mature<6||prior.sources<3||prior.stats.medianViews<POOL_POLICY.diagnosticViews){
        skipped.push({...slot,reason:'六条诊断基准已占位，等待满72小时、至少三个来源的成熟效果后复查'});continue;
      }
      observed={...observed,pool:classifyAccountPool(prior.stats),stats:prior.stats};
    }
    const accountPool=observed.pool;
    const assignment=taskAssignments.get(slot.connectionId);
    const reviewing=!converting&&assignment?.role==='review'&&['strong','normal'].includes(accountPool);
    // Reviewers devote two rounds to fixed-version validation and one to production.
    const desired=converting?'winner':reviewing&&context.round%3!==2?'explore':reviewing?'winner':desiredContentPool({accountPool,...context,seed:owner+':'+cycle+':'+slot.connectionId});
    const seen=used.get(slot.connectionId)||new Set();
    const eligible=candidates.filter(c=>{
      if(seen.has(c.post.sourceKey))return false;
      if(!converting&&c.pool==='explore'&&(Math.max(c.stats.n,occupied.get(c.key)?.posts||0)+(extra.get(c.key)||0)>=POOL_POLICY.minContentSamples
        ||occupied.get(c.key)?.accounts.has(slot.connectionId)))return false;
      return true;
    });
    // Historical traffic ranks the base copy only; the CTA gets a new identity.
    const ranked=rankPoolCandidates(eligible,converting?'strong':accountPool,{desiredPool:desired,seed:pairSeed+':'+slot.connectionId});
    // On stable accounts, started baselines take priority during the initial shortage.
    if(!converting&&(reviewing&&desired==='explore'||!ranked.some(c=>c.pool==='winner'))&&['strong','normal'].includes(accountPool)){
      ranked.sort((a,b)=>Number(b.pool==='explore')-Number(a.pool==='explore')
        ||(b.occupied+(extra.get(b.key)||0))-(a.occupied+(extra.get(a.key)||0))
        ||b.stats.n-a.stats.n||(b.stats.medianViews??-1)-(a.stats.medianViews??-1));
    }
    const chosen=ranked[0];
    if(!chosen){skipped.push({...slot,reason:converting?'没有该账号尚未使用的可发布文案，请补充文案':['strong','normal'].includes(accountPool)?'可用版本已满五个占位，等待成熟数据或补充可用文案':'合格优胜/优化内容不足；先由中强账号固定样式补足五账号基线'});continue;}
    const warmup=!converting&&chosen.pool==='explore'&&desired!=='explore';
    const reason=converting?'转化目标：直接使用可发布文案，追加已确认承接账号的测试引导':warmup?'优胜内容不足：中强账号补足固定版本、固定样式的五账号基线':
      reviewing&&chosen.pool==='explore'?'评审组：固定版本、固定样式补齐五账号验证':accountPool==='diagnostic'?'优胜内容诊断基准':desired===chosen.pool?'按本轮配额匹配':'优先池不足，使用允许的成熟候选';
    const poolMatch={policy:POOL_POLICY.version,accountPool,desiredPool:desired,contentPool:chosen.pool,reason,
      timeZone:normalizeTimeZone(assignment?.timeZone||context.timeZone),cycleStartAt:cycle,dayIndex:context.dayIndex,round:context.round,asOf:context.asOf||Date.now(),
      sampleCount:chosen.stats.n,accountMedianViews:observed.stats.medianViews,copyHash:chosen.identity.hash,
      styleRevision:chosen.styleDefinition.revision||0,warmup,
      ...(converting?{objective:'conversion',basis:'base-content',baseCopyHash:chosen.identity.hash}:{}),
      ...(assignment?{taskGroup:{policyId:assignment.policyId,timeZone:normalizeTimeZone(assignment.timeZone),id:assignment.id,role:assignment.role,revision:assignment.revision,effectiveAt:assignment.effectiveAt}}:{})};
    plan.push({...slot,...chosen,source:{...chosen.source,usageKey:chosen.post.sourceKey,
      poolMatch,poolStyle:chosen.styleDefinition,poolIdentity:chosen.identity,...(converting?{conversion}: {})}});
    seen.add(chosen.post.sourceKey);used.set(slot.connectionId,seen);extra.set(chosen.key,(extra.get(chosen.key)||0)+1);
    cycleExtra.set(slot.connectionId,(cycleExtra.get(slot.connectionId)||0)+1);
  }
  return {plan,skipped};
}

export function poolMatchStatement(db,item,source,owner,now){
  const match=source.poolMatch;
  return db.prepare(`INSERT INTO psychology_pool_matches(item_id,owner,connection_id,account_pool,desired_pool,content_pool,
    source_key,variant_id,style_id,copy_hash,style_revision,cycle_start_at,day_index,round,reason,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id,owner,item.connectionId,match.accountPool,match.desiredPool,match.contentPool,
    source.sourceKey,source.variantId||'',item.styleId,match.copyHash,match.styleRevision,match.cycleStartAt,
    match.dayIndex,match.round,match.reason,now);
}


// This claim is committed with the item and matching snapshot. Concurrent task
// executors cannot consume the same account's daily round twice.
export function taskGroupAllocationStatement(db,item,source,now){
  const match=source.poolMatch, group=match?.taskGroup;
  if(!group)return null;
  const timeZone=normalizeTimeZone(group.timeZone||match.timeZone),day=zonedDate(item.scheduleAt*1000,timeZone);
  return db.prepare(`INSERT INTO psychology_task_group_allocations(policy_id,connection_id,beijing_date,round,item_id,created_at,time_zone)
    VALUES(CASE WHEN EXISTS(SELECT 1 FROM psychology_task_group_policies WHERE id=? AND time_zone=? AND enabled=1 AND starts_at<=? AND ends_at>?)
      AND EXISTS(SELECT 1 FROM psychology_task_group_snapshots s WHERE s.policy_id=? AND s.connection_id=? AND s.revision=? AND s.effective_at=?
        AND NOT EXISTS(SELECT 1 FROM psychology_task_group_snapshots newer WHERE newer.policy_id=s.policy_id AND newer.connection_id=s.connection_id AND newer.effective_at>s.effective_at AND newer.effective_at<=?))
      THEN ? ELSE NULL END,?,?,?,?,?,?)`)
    .bind(group.policyId,timeZone,item.scheduleAt*1000,item.scheduleAt*1000,group.policyId,item.connectionId,group.revision,group.effectiveAt,item.scheduleAt*1000,group.policyId,item.connectionId,day,match.round,item.id,now,timeZone);
}
