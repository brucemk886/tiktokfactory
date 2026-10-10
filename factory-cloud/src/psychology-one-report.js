import {readOfficialOneReport} from './psychology-one-official-report.js';
import {json,errorJson} from './http.js';
import {reportAccountScopeSQL} from './official-report-account-scope.js';
import {operationsWindow} from '../../scripts/psychology-operations.js';
import {ensureModuleProjects,findProjectForModule,publicState,userAllowedGroupIds} from '../../scripts/official-account-group-store.js';
const SIZE=20;
const summary=
 "count(*) total,sum(status='published') published,sum(status='submitted') submitted,sum(status='pending') pending,sum(status='failed') failed,sum(status='stopped') stopped,"+
 "sum(status='published' AND views IS NOT NULL) synced,sum(status='published' AND views IS NULL) missingMetrics,"+
 "sum(CASE WHEN status='published' THEN views END) views,avg(CASE WHEN status='published' THEN views END) averageViews,"+
 "1.0*sum(status='published' AND views>=1000)/nullif(sum(status='published' AND views IS NOT NULL),0) thousandRate,"+
 "sum(CASE WHEN status='published' THEN likes END) likes,sum(CASE WHEN status='published' THEN comments END) comments,sum(CASE WHEN status='published' THEN shares END) shares,"+
 "avg(CASE WHEN status='published' THEN completion END) completion,max(syncedAt) syncedAt,sum(dirty) updating";
const normalize=r=>({...r,...Object.fromEntries(['total','published','submitted','pending','failed','stopped','synced','missingMetrics','updating'].map(k=>[k,Number(r?.[k])||0]))});
export async function handlePsychologyOneReport(request,env,url,session){
 if(url.pathname!=='/api/psychology-one-report')return null;
 if(request.method!=='GET')return errorJson('仅支持读取报表。',405);
 const surface=url.searchParams.get('surface')||'effects',module={effects:'psychology-effects',operations:'psychology-ops-report'}[surface];
 if(!module)return errorJson('报表页面无效。',400);
 if(!session?.user?.sidebarModules?.includes(module))return errorJson('没有此报表页面权限。',403);
 try{
  const allDates=url.searchParams.get('period')==='all',dateQuery=new URLSearchParams(url.searchParams);if(allDates)dateQuery.set('period','7d');
  const db=env.DB,window={...operationsWindow(dateQuery),...(allDates?{period:'all'}:{})},basis=url.searchParams.get('basis')||'schedule',group=url.searchParams.get('group')||'',campaign=url.searchParams.get('campaign')||'',view=url.searchParams.get('view')||'videos';
  if(!['schedule','published'].includes(basis)||!['videos','accounts','projects'].includes(view)||campaign&&!/^\d{1,30}$/.test(campaign))return errorJson('筛选条件无效。',400);
  const raw=await db.prepare("SELECT json_object('projects',json_extract(value_json,'$.projects'),'groups',json_extract(value_json,'$.groups')) value_json FROM factory_kv WHERE key='official-account-groups'").first();
  const store=ensureModuleProjects(JSON.parse(raw?.value_json||'{}')),project=findProjectForModule(store,'psychology'),allow=userAllowedGroupIds(session.user);
  const groups=publicState(store).groups.filter(g=>g.projectId===project?.id&&(!allow||allow.has(g.id)));
  if(group&&!groups.some(g=>g.id===group))return errorJson('没有这个分组的权限。',403);
  const ids=JSON.stringify(groups.filter(g=>!group||g.id===group).map(g=>g.id));
  const source=url.searchParams.get('source')||'official';
  if(!['official','tasks'].includes(source))return errorJson('数据来源无效。',400);
  if(source==='tasks'&&allDates)return errorJson('工厂任务请选择具体日期范围。',400);
  if(source==='official')return json(await readOfficialOneReport(env,{ids,groups,window,campaign,view,page:Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1)),country:'US',refresh:url.searchParams.get('refresh')==='1'}));
  // Frozen per-task One metadata identifies these posts, never the account alone.
  // Task facts carry once-only video ownership and survive media/job cleanup.
  const base=reportAccountScopeSQL+`,one_tasks AS MATERIALIZED (SELECT i.id,i.batch_id batchId,a.account_key account,a.current_group groupId,
   COALESCE(NULLIF(json_extract(d.profile_json,'$.username'),''),NULLIF(d.label,''),a.account_key) accountName,
   CAST(json_extract(b.config_json,'$.tiktokOne.campaignId') AS TEXT) campaignId,
   COALESCE(NULLIF(f.title,''),NULLIF(j.title,''),'待准备视频') title,i.schedule_at*1000 scheduleAt,COALESCE(f.published_at,0) publishedAt,
   CASE WHEN f.state='published' THEN 'published' WHEN f.state='failed' THEN 'failed' WHEN i.deleted_at>0 OR f.state='stopped' THEN 'stopped'
    WHEN json_extract(i.receipt_json,'$.batchId') IS NOT NULL AND json_extract(i.receipt_json,'$.batchId')<>'' THEN 'submitted'
    WHEN i.execution_status='failed' OR j.status='failed' THEN 'failed' ELSE 'pending' END status,
   COALESCE(f.video_id,'') videoId,COALESCE(NULLIF(f.error,''),j.error,'') error,
   CASE WHEN o.item_id=i.id THEN f.views END views,CASE WHEN o.item_id=i.id THEN f.likes END likes,
   CASE WHEN o.item_id=i.id THEN f.comments END comments,CASE WHEN o.item_id=i.id THEN f.shares END shares,
   CASE WHEN o.item_id=i.id THEN f.completion END completion,COALESCE(f.synced_at,0) syncedAt,
   EXISTS(SELECT 1 FROM ops_task_dirty x WHERE x.item_id=i.id) dirty
   FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
   JOIN allowed a ON a.account_key='tiktok:'||replace(i.connection_id,'tiktok:','')
   LEFT JOIN ops_task_facts f ON f.id=i.id AND f.batch_id=i.batch_id AND f.account_key=a.account_key
   LEFT JOIN ops_video_owners o ON o.account_key=f.account_key AND o.video_id=f.video_id
   LEFT JOIN official_accounts_latest d ON d.account_key=a.account_key LEFT JOIN factory_jobs j ON j.id=i.job_id
   WHERE json_extract(b.config_json,'$.mediaType')='video' AND json_type(b.config_json,'$.tiktokOne')='object'
    AND COALESCE(CAST(json_extract(b.config_json,'$.tiktokOne.campaignId') AS TEXT),'')<>''
    AND (f.pilot_id IS NULL OR f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))
    AND ${basis==='schedule'?'i.schedule_at>=? AND i.schedule_at<?':"f.state='published' AND f.published_at>=? AND f.published_at<?"}),
  selected AS MATERIALIZED (SELECT * FROM one_tasks WHERE (?='' OR campaignId=?))`;
  const args=[ids,ids,basis==='schedule'?window.start/1000:window.start,basis==='schedule'?window.end/1000:window.end,campaign,campaign];
  const run=sql=>db.prepare(base+' '+sql).bind(...args);
  const page=Math.max(1,Math.min(1000000,Math.floor(Number(url.searchParams.get('page'))||1)));
  const grouped=view==='accounts'?'account,accountName,groupId':view==='projects'?'campaignId':'';
  const from=grouped?'(SELECT '+grouped+','+summary+' FROM selected GROUP BY '+grouped+')':'selected';
  const [totals,projects,count]=await db.batch([run('SELECT '+summary+' FROM selected'),run('SELECT campaignId,count(*) total FROM one_tasks GROUP BY campaignId ORDER BY campaignId'),run('SELECT count(*) total FROM '+from)]);
  const total=Number(count.results[0]?.total)||0,pages=Math.max(1,Math.ceil(total/SIZE)),actualPage=Math.min(page,pages);
  const rows=(await run('SELECT * FROM '+from+' ORDER BY '+(grouped?'views DESC,'+(view==='accounts'?'account':'campaignId'):'scheduleAt DESC,id')+' LIMIT '+SIZE+' OFFSET '+((actualPage-1)*SIZE)).all()).results;
  return json({source:'tasks',surface,window,basis,view,group,campaign,groups:groups.map(g=>({id:g.id,name:g.name})),projects:projects.results,
   summary:normalize(totals.results[0]),rows:grouped?rows.map(normalize):rows,pagination:{page:actualPage,pages,total,pageSize:SIZE},updatedAt:Date.now(),
   coverage:'只统计工厂任务中明确绑定 TikTok One 项目的视频。已提交表示中台已接收，不代表官方审核通过；已发布以发布回执或作品同步为准。播放与互动为最近同步的累计值，缺失显示 —。'});
 }catch(e){return errorJson(e.message||'读取 TikTok One 报表失败。',e.statusCode||400);}
}
