import {json,errorJson} from './http.js';
import {operationsWindow} from '../../scripts/psychology-operations.js';
import {ensureModuleProjects,findProjectForModule,publicState,userAllowedGroupIds} from '../../scripts/official-account-group-store.js';
import {VIEW_TIERS,QUADRANTS,STAGES,KINDS,PLAYBOOK,RULES} from '../../scripts/psychology-ops-framework.js';
import {AUTOPILOT_STRATEGIES} from '../../scripts/psychology-autopilot-report.js';
import {EVOLUTION} from './psychology-copy-evolution.js';
import {TOPIC_LABELS} from '../../scripts/psychology-peer-topics.js';
const SIZE=10;
const blank=()=>({n:0,avgViews:null,medianViews:null,potentialRate:null,hitRate:null,averageWatch:null,completion:null,retention3:null,likes:null,comments:null,shares:null,saves:null,tiers:Object.fromEntries(VIEW_TIERS.map(t=>[t.id,0])),quadrants:Object.fromEntries(Object.keys(QUADRANTS).map(k=>[k,0]))});
const stat=r=>r?{...r,tiers:Object.fromEntries(VIEW_TIERS.map(t=>[t.id,r['tier_'+t.id]||0])),quadrants:Object.fromEntries(Object.keys(QUADRANTS).map(k=>[k,r['q_'+k]||0]))}:blank();
const pageNumber=v=>Math.max(1,Math.min(1000000,Math.floor(Number(v)||1)));
const dominant=s=>Object.entries(s.quadrants).filter(([k])=>k!=='unknown').sort((a,b)=>b[1]-a[1]).find(([,n])=>n>0)?.[0]||'unknown';
function summarySQL(input,group='bucket'){
 const part=group?`PARTITION BY ${group}`:'',prefix=group?group+',':'';
 const means=[['average_watch','averageWatch'],['completion','completion'],['retention3','retention3'],['likes','likes'],['comments','comments'],['shares','shares'],['saves','saves']];
 // Exact weighted median. Collapsing equal view counts avoids sorting millions
 // of wide task rows and never approximates or averages group medians.
 return `WITH counted AS MATERIALIZED (SELECT ${prefix}views,count(*) freq,
 ${means.map(([col])=>`sum(CASE WHEN ${col}>0 THEN ${col} ELSE 0 END) ${col}_sum,sum(${col}>0) ${col}_n`).join(',')},
 ${Object.keys(QUADRANTS).map(k=>`sum(quadrant='${k}') q_${k}`).join(',')}
 FROM ${input} WHERE views IS NOT NULL AND state='published' GROUP BY ${prefix}views),
 ranked AS (SELECT *,sum(freq) OVER (${part} ORDER BY views) cumulative,sum(freq) OVER (${part}) nn FROM counted)
 SELECT ${prefix}sum(freq) n,1.0*sum(views*freq)/sum(freq) avgViews,
 (sum(CASE WHEN (nn+1)/2>cumulative-freq AND (nn+1)/2<=cumulative THEN views ELSE 0 END)+sum(CASE WHEN (nn+2)/2>cumulative-freq AND (nn+2)/2<=cumulative THEN views ELSE 0 END))/2.0 medianViews,
 1.0*sum(CASE WHEN views>=1000 THEN freq ELSE 0 END)/sum(freq) potentialRate,1.0*sum(CASE WHEN views>=10000 THEN freq ELSE 0 END)/sum(freq) hitRate,
 ${means.map(([col,name])=>`1.0*sum(${col}_sum)/nullif(sum(${col}_n),0) ${name}`).join(',')},
 ${VIEW_TIERS.map((t,i)=>`sum(CASE WHEN views>=${t.min}${VIEW_TIERS[i+1]?' AND views<'+VIEW_TIERS[i+1].min:''} THEN freq ELSE 0 END) tier_${t.id}`).join(',')},
 ${Object.keys(QUADRANTS).map(k=>`sum(q_${k}) q_${k}`).join(',')}
 FROM ranked ${group?'GROUP BY '+group:''}`;
}
const statColumns=['n','avgViews','medianViews','potentialRate','hitRate','averageWatch','completion','retention3','likes','comments','shares','saves',...VIEW_TIERS.map(t=>'tier_'+t.id),...Object.keys(QUADRANTS).map(k=>'q_'+k)];
const jsonRows=(query,cols)=>`(SELECT json_group_array(json_object(${cols.map(c=>`'${c}',${c}`).join(',')})) FROM (${query}))`;
function summaryCTE(name,input,group){const s=summarySQL(input,group).replaceAll('counted',name+'_counted').replaceAll('ranked',name+'_ranked');const split=s.lastIndexOf('\n SELECT ');return s.slice(5,split)+','+name+' AS ('+s.slice(split)+')';}
function append(cte,sql){return cte+','+sql.replace(/^WITH /,'');}
const paging=(rows,total,page)=>({page,pages:Math.max(1,Math.ceil(total/SIZE)),total,pageSize:SIZE,rows});
export async function handleScalableOperations(request,env,url,session){
 if(url.pathname!=='/api/psychology-operations')return null;
 if(request.method!=='GET')return errorJson('仅支持读取报表。',405);
 const user=session?.user;if(!user?.sidebarModules?.includes('psychology-ops-report'))return errorJson('没有心理学运营报表权限。',403);
 const started=Date.now(),db=env.DB;
 try{
  const window=operationsWindow(url.searchParams),media=url.searchParams.get('media')||'photo',group=url.searchParams.get('group')||'',panel=url.searchParams.get('panel')||(url.searchParams.get('details')==='1'?'details':'overview');
  if(!['photo','video'].includes(media)||!['overview','accounts','content','strategy','details','batches','groups'].includes(panel))return errorJson('查询类型无效。',400);
  const raw=await db.prepare("SELECT json_object('projects',json_extract(value_json,'$.projects'),'groups',json_extract(value_json,'$.groups')) value_json FROM factory_kv WHERE key='official-account-groups'").first();
  const store=ensureModuleProjects(JSON.parse(raw?.value_json||'{}')),project=findProjectForModule(store,'psychology'),allow=userAllowedGroupIds(user);
  const groups=publicState(store).groups.filter(g=>g.projectId===project?.id&&(!allow||allow.has(g.id)));
  if(group&&!groups.some(g=>g.id===group))return errorJson('没有这个分组的权限。',403);
  const ids=JSON.stringify(groups.filter(g=>!group||g.id===group).map(g=>g.id));
  // Canonical assignments are evaluated on every request. No directory cap,
  // username fallback, archive reads, or cached permission decisions.
  const scope=`WITH allowed AS MATERIALIZED (SELECT DISTINCT 'tiktok:'||replace(account_key,'tiktok:','') account_key,group_id current_group FROM official_account_assignments WHERE group_id IN (SELECT value FROM json_each(?)))`;
  const authorized=`f.account_key=a.account_key AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))`;
  const base=scope+`,base AS (SELECT f.*,a.current_group FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published ON ${authorized} WHERE f.media=? AND f.published_at>=? AND f.published_at<?),
  completions AS (SELECT completion,row_number() OVER (ORDER BY completion) rn,count(*) OVER () n FROM base WHERE published_at>=? AND views IS NOT NULL AND state='published' AND completion>0),
  line AS (SELECT avg(completion) v FROM completions WHERE rn IN ((n+1)/2,(n+2)/2)),
  samples AS (SELECT b.*,CASE WHEN published_at>=? THEN 'current' ELSE 'previous' END bucket,date(published_at/1000,'unixepoch','+8 hours') day,
  CASE WHEN NOT(completion>0) OR (SELECT v FROM line) IS NULL THEN 'unknown' WHEN views>=1000 THEN CASE WHEN completion>=(SELECT v FROM line) THEN 'star' ELSE 'hook' END ELSE CASE WHEN completion>=(SELECT v FROM line) THEN 'account' ELSE 'weak' END END quadrant FROM base b)`;
  const args=[ids,ids,media,window.previousStart,window.end,window.start,window.start];
  const run=(sql,bind=args)=>db.prepare(sql).bind(...bind);
  const page=pageNumber(url.searchParams.get('page')),offset=(page-1)*SIZE;
  let data={};
  if(panel==='overview'||panel==='groups'){
   const planned=scope+`,planned AS (SELECT f.* FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_schedule ON ${authorized} WHERE f.media=? AND f.schedule_at>=? AND f.schedule_at<? AND f.pilot_id<>'')`;
   const planArgs=[ids,ids,media,window.start,window.end];
   const rolls=scope+`,rolls AS (SELECT d.* FROM allowed a CROSS JOIN ops_daily d INDEXED BY sqlite_autoindex_ops_daily_1 ON d.account_key=a.account_key WHERE d.media=? AND d.basis='schedule' AND d.day>=? AND d.day<=? AND d.pilot_id<>'' AND d.group_id IN (SELECT value FROM json_each(?)) AND d.planned>0)`;
   const rollArgs=[ids,media,window.from,window.to,ids];
   const rollSelect=`count(DISTINCT account_key) accounts,count(DISTINCT pilot_id) groups,sum(planned) planned,sum(published) published,sum(failed) failed,sum(pending) pending,sum(stopped) stopped,sum(synced) synced,sum(published)-sum(synced) missingMetrics,CASE WHEN sum(synced)>0 THEN sum(views) END views,1.0*sum(views)/nullif(sum(synced),0) averageViews,1.0*sum(potential)/nullif(sum(synced),0) potentialRate,1.0*sum(hit)/nullif(sum(synced),0) hitRate,CASE WHEN sum(likes_n)>0 THEN sum(likes) END likes,CASE WHEN sum(comments_n)>0 THEN sum(comments) END comments,CASE WHEN sum(shares_n)>0 THEN sum(shares) END shares,sum(CASE WHEN variant_kind='original' THEN planned ELSE 0 END) original,sum(CASE WHEN variant_kind='rewrite' THEN planned ELSE 0 END) rewrite`;
   const rollQ=(dimension)=>rolls+` SELECT ${dimension?dimension+',':''}${rollSelect} FROM rolls ${dimension?'GROUP BY '+dimension:''}`;
   const medQ=planned+`,sets AS (SELECT 'all' k,views,id FROM planned WHERE state='published' AND views IS NOT NULL UNION ALL SELECT 's:'||strategy,views,id FROM planned WHERE state='published' AND views IS NOT NULL UNION ALL SELECT 'g:'||pilot_id||'|'||strategy,views,id FROM planned WHERE state='published' AND views IS NOT NULL),r AS (SELECT *,row_number() OVER(PARTITION BY k ORDER BY views,id) rn,count(*) OVER(PARTITION BY k) n FROM sets) SELECT k,avg(views) median FROM r WHERE rn IN ((n+1)/2,(n+2)/2) GROUP BY k`;
   const [summary,strategies,groupRows,groupCount,medians,...other]=await db.batch([
    run(rollQ(''),rollArgs),run(rollQ('strategy'),rollArgs),run(rollQ('pilot_id,group_id,strategy')+` ORDER BY group_id,pilot_id,strategy LIMIT ${SIZE} OFFSET ${offset}`,rollArgs),
    run(rolls+' SELECT count(*) n FROM (SELECT pilot_id,strategy FROM rolls GROUP BY pilot_id,strategy)',rollArgs),run(medQ,planArgs),
    ...(panel==='overview'?[
     run(append(base,summarySQL('samples'))),run(append(base,summarySQL("(SELECT * FROM samples WHERE bucket='current')",'day'))),run(base+" SELECT (SELECT v FROM line) completionLine,sum(published_at>=? AND views IS NULL AND state='published') observing FROM base",[...args,window.start]),
    ]:[])]);
   const medianMap=new Map(medians.results.map(r=>[r.k,r.median]));
   const decorate=(r,k)=>({...r,planned:r?.planned||0,published:r?.published||0,failed:r?.failed||0,pending:r?.pending||0,stopped:r?.stopped||0,synced:r?.synced||0,missingMetrics:r?.missingMetrics||0,medianViews:medianMap.get(k)??null,assessment:(r?.synced||0)<5?'已同步样本不足，继续积累':'当前累计指标，不同发布时间的增长时长不同'});
   const names=new Map(groups.map(g=>[g.id,g.name]));
   data.autopilot={summary:decorate(summary.results[0],'all'),strategies:Object.entries(AUTOPILOT_STRATEGIES).map(([id,label])=>({...decorate(strategies.results.find(r=>r.strategy===id),'s:'+id),id,label})),groups:groupRows.results.map(r=>({...decorate(r,'g:'+r.pilot_id+'|'+r.strategy),pilotId:r.pilot_id,groupId:r.group_id,name:names.get(r.group_id)||r.group_id,strategyLabel:AUTOPILOT_STRATEGIES[r.strategy]||'未记录策略'})),basis:'执行按计划发布时间统计，效果按实际发布时间统计。播放是最近同步累计值；当天数据立即参与，缺失不记为0。'};
   data.groupPagination=paging([],groupCount.results[0].n,page);
   if(panel==='overview'){
    const [stats,daily,meta]=other;
    data.framework={media,tiers:VIEW_TIERS,quadrants:QUADRANTS,stageNames:STAGES,kinds:KINDS,rules:RULES,overview:{current:stat(stats.results.find(r=>r.bucket==='current')),previous:stat(stats.results.find(r=>r.bucket==='previous')),daily:Array.from({length:window.days},(_,i)=>{const date=new Date(window.start+i*86400000+28800000).toISOString().slice(0,10);return {date,...stat(daily.results.find(r=>r.day===date))};}),completionLine:meta.results[0]?.completionLine??null,observing:meta.results[0]?.observing||0},strategy:{findings:['统计覆盖当前授权范围内已归档的自动发布任务；明细按需分页读取。']}};
   }
  }
  if(panel==='accounts'){
   const sort={medianViews:'medianViews',potentialRate:'potentialRate',completion:'completion',n:'n'}[url.searchParams.get('sort')]||'medianViews';
   const filter=url.searchParams.get('filter')||'all';if(!['all','issue','potential','launch'].includes(filter))return errorJson('账号筛选无效。',400);
   const accountCTE=append(base,summarySQL("(SELECT * FROM samples WHERE bucket='current')",'account_key')).replace(/ SELECT account_key,sum\(freq\) n/,', account_stats AS (SELECT account_key,sum(freq) n')+')';
   // Stage calculations stay in SQL and include long-term videos of all media.
   const timeline=accountCTE+`,timeline AS (SELECT v.*,row_number() OVER(PARTITION BY v.account_key ORDER BY v.published_at DESC,v.video_id) recent FROM allowed a CROSS JOIN ops_video_facts v ON v.account_key=a.account_key WHERE v.published_at>0 AND v.published_at<? AND v.views IS NOT NULL),stage_end AS (SELECT account_key,count(*) totalPosts,CASE WHEN count(*)<10 THEN 'launch' WHEN max(CASE WHEN recent<=10 THEN views ELSE 0 END)>=100000 THEN 'burst' WHEN avg(views)>=1000 THEN 'potential' ELSE 'normal' END endStage FROM timeline GROUP BY account_key),
   before AS (SELECT v.*,row_number() OVER(PARTITION BY v.account_key ORDER BY v.published_at DESC,v.video_id) recent FROM allowed a CROSS JOIN ops_video_facts v ON v.account_key=a.account_key WHERE v.published_at>0 AND v.published_at<? AND v.views IS NOT NULL),stage_start AS (SELECT account_key,CASE WHEN count(*)<10 THEN 'launch' WHEN max(CASE WHEN recent<=10 THEN views ELSE 0 END)>=100000 THEN 'burst' WHEN avg(views)>=1000 THEN 'potential' ELSE 'normal' END startStage FROM before GROUP BY account_key),
   accounts AS MATERIALIZED (SELECT e.*,s.startStage,a.current_group,COALESCE(json_extract(d.profile_json,'$.username'),d.label,e.account_key) name,x.* FROM stage_end e JOIN allowed a ON a.account_key=e.account_key LEFT JOIN stage_start s ON s.account_key=e.account_key LEFT JOIN account_stats x ON x.account_key=e.account_key LEFT JOIN official_accounts_latest d ON d.account_key=e.account_key),
   filtered AS (SELECT * FROM accounts WHERE ${filter==='potential'?"endStage IN ('potential','burst')":filter==='launch'?"endStage='launch'":filter==='issue'?"(n IS NULL OR n=0 OR (n>=5 AND medianViews<200))":'1'})`;
   const bind=[...args,Math.min(Date.now(),window.end),window.start];
   const result=JSON.parse((await run(timeline+` SELECT json_object('rows',${jsonRows('SELECT * FROM filtered ORDER BY '+sort+' DESC,account_key LIMIT '+SIZE+' OFFSET '+offset,['account_key','current_group','name','startStage','endStage','totalPosts',...statColumns])},'total',(SELECT count(*) FROM filtered),'transitions',${jsonRows('SELECT startStage,endStage,count(*) n FROM accounts GROUP BY startStage,endStage',['startStage','endStage','n'])}) payload`,bind).first()).payload);
   const rows={results:result.rows},total={results:[{n:result.total}]},transitions={results:result.transitions};
   const names=new Map(groups.map(g=>[g.id,g.name])),stages={start:Object.fromEntries(Object.keys(STAGES).map(k=>[k,0])),end:Object.fromEntries(Object.keys(STAGES).map(k=>[k,0]))};
   for(const r of transitions.results){if(r.startStage)stages.start[r.startStage]+=r.n;stages.end[r.endStage]+=r.n;}
   data.accounts={stages,transitions:transitions.results.map(r=>({from:r.startStage||'new',to:r.endStage,n:r.n})),rows:rows.results.map(r=>({account:r.account_key,name:r.name,group:names.get(r.current_group)||'',startStage:r.startStage,endStage:r.endStage,totalPosts:r.totalPosts,stats:stat(r.n?r:null),quadrant:dominant(stat(r)),issue:!r.n?'本期没有已同步自动发布':r.n>=5&&r.medianViews<200?'持续低播放，检查账号状态':['potential','burst'].includes(r.endStage)?'潜力号，可以加码':''}))};
   data.pagination=paging([],total.results[0].n,page);
  }
  if(panel==='batches'||panel==='details'){
   const timeCol=panel==='batches'?'schedule_at':'published_at';
   const search=String(url.searchParams.get('q')||'').slice(0,100),mode=url.searchParams.get('mode')||'source';
   const cte=scope+`,rows AS (SELECT f.*,a.current_group,COALESCE(json_extract(d.profile_json,'$.username'),d.label,f.account_key) accountName FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published ON ${authorized} LEFT JOIN official_accounts_latest d ON d.account_key=f.account_key WHERE f.media=? AND f.${timeCol}>=? AND f.${timeCol}<? AND (?='' OR instr(lower(f.title||' '||f.variant||' '||COALESCE(d.label,'')||' '||f.source),lower(?))>0))`;
   const bind=[ids,ids,media,window.start,window.end,search,search];
   if(panel==='details'&&!url.searchParams.has('key')){
    const dimension={source:'source',copy:'copy_hash',style:'style'}[mode];if(!dimension)return errorJson('对比维度无效。',400);
    const grouped=cte+",detail_samples AS (SELECT *,"+dimension+" comparison_key,'unknown' quadrant FROM rows)";
    const groupedSQL=append(grouped,summarySQL('detail_samples','comparison_key'));
    const [rows,total]=await db.batch([run(groupedSQL+` ORDER BY medianViews DESC,comparison_key LIMIT ${SIZE} OFFSET ${offset}`,bind),run(cte+` SELECT count(DISTINCT ${dimension}) n FROM rows WHERE state='published' AND views IS NOT NULL`,bind)]);
    data.comparisons=rows.results.map(r=>({...r,key:r.comparison_key,label:r.comparison_key||'历史记录未保存'}));data.pagination=paging([],total.results[0].n,page);
   }else{
    const dimension={source:'source',copy:'copy_hash',style:'style'}[mode];if(!dimension)return errorJson('对比维度无效。',400);
    const condition=panel==='details'?' WHERE '+dimension+'=?':'';const bindings=panel==='details'?[...bind,url.searchParams.get('key')]:bind;
    const [rows,total]=await db.batch([run(cte+` SELECT * FROM rows${condition} ORDER BY ${timeCol} DESC,id DESC LIMIT ${SIZE} OFFSET ${offset}`,bindings),run(cte+' SELECT count(*) n FROM rows'+condition,bindings)]);
    data.items=rows.results;data.pagination=paging([],total.results[0].n,page);
   }
  }
  if(panel==='content'||panel==='strategy')data={...data,...await readAdvanced(db,{scope,authorized,base,args,ids,media,window,page,offset,panel,run})};
  const archive=(await run(scope+` SELECT min(d.synced_at) oldest,max(d.synced_at) latest FROM allowed a JOIN official_accounts_latest d ON d.account_key=a.account_key WHERE d.synced_at>0`,[ids]).first())||{};
  const progress=(await run(scope+` SELECT (SELECT count(*) FROM ops_task_dirty d JOIN psychology_publish_items i ON i.id=d.item_id JOIN allowed a ON a.account_key='tiktok:'||replace(i.connection_id,'tiktok:','') JOIN psychology_publish_batches b ON b.id=i.batch_id WHERE json_extract(b.config_json,'$.mediaType')=?) pending,(SELECT min(done) FROM ops_report_progress) ready,(SELECT max(error) FROM ops_report_progress) error,(SELECT min(updated_at) FROM ops_task_facts WHERE id IN (SELECT item_id FROM ops_task_dirty)) oldest`,[ids,media]).first())||{};
  const response=json({version:2,panel,window,media,groups,evolution:EVOLUTION,...data,progress,archiveAt:archive.oldest||0,archiveLatestAt:archive.latest||0,updatedAt:Date.now(),coverage:'指标长期保留，按作品实际发布日期统计最近同步的累计值，并非当日新增播放。历史未曾同步的数据无法补推；无视频ID或无指标时单独显示。报表后台持续更新，不触发TikTok查询。'});
  response.headers.set('server-timing',`total;dur=${Date.now()-started}`);return response;
 }catch(e){return errorJson(e.message||'读取报表失败。',400);}
}

async function readAdvanced(db,{scope,authorized,base,args,ids,media,window,page,offset,panel,run}){
 // Advanced comparisons are requested only when their tab is opened. All
 // populations remain in SQL; only grouped results or one page leave D1.
 const extra=base+`,uses AS MATERIALIZED (SELECT f.id,f.source,row_number() OVER(PARTITION BY source ORDER BY schedule_at,id) useIndex,row_number() OVER(PARTITION BY source,variant ORDER BY schedule_at,id) versionIndex,lag(style) OVER(PARTITION BY source ORDER BY schedule_at,id) prevStyle FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published ON ${authorized} WHERE f.media=?),
 enriched AS MATERIALIZED (SELECT s.*,u.useIndex,u.versionIndex,u.prevStyle,(SELECT count(*)+1 FROM ops_video_facts v WHERE v.account_key=s.account_key AND v.published_at>0 AND v.published_at<s.published_at AND v.views IS NOT NULL) postIndex FROM samples s JOIN uses u ON u.id=s.id WHERE bucket='current'),
 current AS MATERIALIZED (SELECT * FROM enriched WHERE state='published' AND views IS NOT NULL)`;
 const bind=[...args,ids,media];
 if(panel==='strategy'){
  // Derive the stage immediately before each publication using indexed videos.
  const stages=extra+`,staged AS (SELECT c.*,CASE WHEN postIndex<=10 THEN 'launch' WHEN (SELECT max(views) FROM (SELECT views FROM ops_video_facts v WHERE v.account_key=c.account_key AND v.published_at<c.published_at AND v.published_at>0 AND v.views IS NOT NULL ORDER BY published_at DESC,video_id DESC LIMIT 10))>=100000 THEN 'burst' WHEN (SELECT avg(views) FROM ops_video_facts v WHERE v.account_key=c.account_key AND v.published_at<c.published_at AND v.published_at>0 AND v.views IS NOT NULL)>=1000 THEN 'potential' ELSE 'normal' END stage,CASE WHEN useIndex=1 THEN 'first' WHEN variant<>'' THEN 'rewrite' ELSE 'repeatOriginal' END kind FROM current c)`;
  const result=(await run(append(stages,summarySQL('staged','stage,kind')),bind).all()).results;
  return {strategy:{stages:Object.keys(STAGES).map(stage=>{const kinds=Object.fromEntries(Object.keys(KINDS).map(kind=>[kind,stat(result.find(r=>r.stage===stage&&r.kind===kind))]));const ready=Object.entries(kinds).filter(([,s])=>s.n>=5).sort((a,b)=>b[1].medianViews-a[1].medianViews);return {stage,label:STAGES[stage],playbook:PLAYBOOK[stage],kinds,best:ready.length>1?ready[0][0]:null};})}};
 }
 const comparisons=extra+`,hit_sources AS (SELECT DISTINCT source FROM current WHERE variant='' AND views>=10000),comparison AS (
 SELECT id,views,state,average_watch,completion,retention3,likes,comments,shares,saves,quadrant,CASE WHEN useIndex=1 THEN 'reuse1' WHEN useIndex=2 THEN 'reuse2' WHEN useIndex=3 THEN 'reuse3' WHEN useIndex<=5 THEN 'reuse5' WHEN useIndex<=10 THEN 'reuse10' ELSE 'reuse11' END category FROM current
 UNION ALL SELECT id,views,state,average_watch,completion,retention3,likes,comments,shares,saves,quadrant,CASE WHEN variant='' THEN 'original' ELSE 'rewrite' END FROM current
 UNION ALL SELECT id,views,state,average_watch,completion,retention3,likes,comments,shares,saves,quadrant,CASE WHEN versionIndex=1 THEN 'fresh' ELSE 'same' END FROM current WHERE useIndex>1
 UNION ALL SELECT id,views,state,average_watch,completion,retention3,likes,comments,shares,saves,quadrant,CASE WHEN style=prevStyle THEN 'styleSame' ELSE 'styleChanged' END FROM current WHERE useIndex>1 AND style<>'' AND prevStyle<>''
 UNION ALL SELECT id,views,state,average_watch,completion,retention3,likes,comments,shares,saves,quadrant,CASE WHEN variant='' THEN 'hitOriginal' ELSE 'hitRewrite' END FROM current WHERE source IN (SELECT source FROM hit_sources)
 UNION ALL SELECT id,views,state,average_watch,completion,retention3,likes,comments,shares,saves,quadrant,CASE WHEN postIndex<=3 THEN 'post3' WHEN postIndex<=10 THEN 'post10' WHEN postIndex<=30 THEN 'post30' ELSE 'post31' END FROM current)`;
 const ctes=comparisons+','+summaryCTE('comparison_stats','comparison','category')+','+summaryCTE('source_stats','current','source')+
  `,tagged AS (SELECT c.*,COALESCE(t.value,'unset') topic FROM current c LEFT JOIN psychology_peer_hits p ON c.source='v1:tiktok:'||p.video_id LEFT JOIN json_each(p.topics_json) t),`+summaryCTE('topic_stats','tagged','topic')+
  `,selected_sources AS (SELECT * FROM source_stats ORDER BY medianViews DESC,source LIMIT ${SIZE} OFFSET ${offset}),source_labels AS (SELECT source,max(title) title,count(DISTINCT account_key) accounts,count(DISTINCT variant) versions FROM current WHERE source IN (SELECT source FROM selected_sources) GROUP BY source),use_totals AS (SELECT source,count(*) totalUses FROM uses WHERE source IN (SELECT source FROM selected_sources) GROUP BY source)`;
 const result=JSON.parse((await run(ctes+` SELECT json_object('comparisons',${jsonRows('SELECT * FROM comparison_stats',['category',...statColumns])},'sources',${jsonRows('SELECT * FROM selected_sources NATURAL LEFT JOIN source_labels NATURAL LEFT JOIN use_totals ORDER BY medianViews DESC,source',['source','title','accounts','versions','totalUses',...statColumns])},'total',(SELECT count(*) FROM source_stats),'hit',(SELECT count(*) FROM hit_sources),'topics',${jsonRows('SELECT * FROM topic_stats',['topic',...statColumns])}) payload`,bind).first()).payload);
 const cmp={results:result.comparisons},sources={results:result.sources},total={results:[{n:result.total}]},hit={results:[{n:result.hit}]},topics={results:result.topics};
 const get=k=>stat(cmp.results.find(r=>r.category===k));
 const reuse=[['reuse1','第1次'],['reuse2','第2次'],['reuse3','第3次'],['reuse5','第4–5次'],['reuse10','第6–10次'],['reuse11','第11次及以上']].map(([k,label])=>({...get(k),label}));
 const dropAt=reuse[0].n>=5&&reuse[0].medianViews>0?reuse.slice(1).find(r=>r.n>=5&&r.medianViews<=reuse[0].medianViews*.7)?.label||null:null;
 return {content:{sources:sources.results.map(r=>({...r,source:r.source,stats:stat(r),quadrant:dominant(stat(r))})),reuse,dropAt,version:{fresh:get('fresh'),same:get('same')},style:{changed:get('styleChanged'),same:get('styleSame')},rewrite:{original:get('original'),rewrite:get('rewrite'),hitOriginal:get('hitOriginal'),hitRewrite:get('hitRewrite'),hitSources:hit.results[0].n},postIndex:[['post3','第1–3条'],['post10','第4–10条'],['post30','第11–30条'],['post31','第31条及以上']].map(([k,label])=>({...get(k),label})),topics:topics.results.map(r=>({...stat(r),id:r.topic,label:TOPIC_LABELS[r.topic]||'未打标'}))},pagination:paging([],total.results[0].n,page)};
}
