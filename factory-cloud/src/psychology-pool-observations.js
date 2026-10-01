import { reportAccountScopeSQL } from './official-report-account-scope.js';
import { toPublicUser } from './auth.js';
import { ensureModuleProjects, findProjectForModule, userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { POOL_POLICY } from '../../scripts/psychology-pool-policy.js';
import { PACIFIC_TIME_ZONE, normalizeTimeZone, zonedDate, zonedEpoch, addCalendarDays } from '../../scripts/psychology-schedule-time.js';

const DAY=86400000,MATURE_MS=POOL_POLICY.maturityHours*3600000;
const parse=(v,fallback)=>{try{return JSON.parse(v||'');}catch{return fallback;}};
const groupList=ids=>[...new Set((ids||[]).filter(id=>typeof id==='string'&&id))];
export function observationDates(now=Date.now(),timeZone=PACIFIC_TIME_ZONE){
 timeZone=normalizeTimeZone(timeZone);const today=zonedDate(now,timeZone);
 return Array.from({length:7},(_,index)=>{
  const date=addCalendarDays(today,index-6);
  return {date,start:zonedEpoch(date,0,0,timeZone),end:zonedEpoch(addCalendarDays(date,1),0,0,timeZone)};
 });
}
function statsSQL(input,dimension,name='sample_stats'){
 return name+'_frequencies AS MATERIALIZED (SELECT '+dimension+',views,count(*) freq,'+
 'sum(CASE WHEN completion BETWEEN 0 AND 1 THEN completion END) completion_sum,'+
 'count(CASE WHEN completion BETWEEN 0 AND 1 THEN completion END) completion_n FROM '+input+' GROUP BY '+dimension+',views),'+
 name+'_ranked AS (SELECT *,sum(freq) OVER (PARTITION BY '+dimension+' ORDER BY views) cumulative,'+
 'sum(freq) OVER (PARTITION BY '+dimension+') nn FROM '+name+'_frequencies),'+
 name+' AS (SELECT '+dimension+',sum(freq) n,sum(views*freq) views,'+
 '(sum(CASE WHEN (nn+1)/2>cumulative-freq AND (nn+1)/2<=cumulative THEN views ELSE 0 END)'+
 '+sum(CASE WHEN (nn+2)/2>cumulative-freq AND (nn+2)/2<=cumulative THEN views ELSE 0 END))/2.0 medianViews,'+
 '1.0*sum(CASE WHEN views>=1000 THEN freq ELSE 0 END)/sum(freq) highRate,'+
 '1.0*sum(completion_sum)/nullif(sum(completion_n),0) completion,sum(completion_n) completionN'+
 ' FROM '+name+'_ranked GROUP BY '+dimension+')';
}

// Publication cohorts compare latest durable cumulative metrics at request time.
// This is neither daily traffic nor historical pool changes. Maturity is >=72h.
export async function readPublicationTrend(db,{groupIds,now=Date.now(),timeZone=PACIFIC_TIME_ZONE,media='photo'}={}){
 if(!['photo','video'].includes(media))throw new RangeError('内容类型无效。');
 const ids=JSON.stringify(groupList(groupIds)),dates=observationDates(now,timeZone);
 const sql=reportAccountScopeSQL+','+
 "days AS MATERIALIZED (SELECT json_extract(value,'$.date') date,json_extract(value,'$.start') start,json_extract(value,'$.end') end FROM json_each(?)),"+
 'facts AS MATERIALIZED (SELECT d.date,f.*,f.published_at<=? mature FROM days d CROSS JOIN allowed a '+
 'CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published ON f.account_key=a.account_key AND f.published_at>=d.start AND f.published_at<d.end '+
 "WHERE f.state='published' AND f.media=? AND f.published_at<=? AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))),"+
 'totals AS (SELECT date,count(*) published,count(views) synced,count(*)-count(views) missingMetrics,sum(mature) maturePublished,max(synced_at) latestSyncAt FROM facts GROUP BY date),'+
 'valid AS MATERIALIZED (SELECT * FROM facts WHERE mature AND views IS NOT NULL),'+statsSQL('valid','date')+
 ' SELECT d.*,COALESCE(t.published,0) published,COALESCE(t.synced,0) synced,COALESCE(t.missingMetrics,0) missingMetrics,'+
 'COALESCE(t.maturePublished,0) maturePublished,COALESCE(s.n,0) n,s.views,s.medianViews,s.highRate,s.completion,COALESCE(s.completionN,0) completionN,'+
 'nullif(t.latestSyncAt,0) latestSyncAt FROM days d LEFT JOIN totals t USING(date) LEFT JOIN sample_stats s USING(date) ORDER BY d.start';
 const result=await db.prepare(sql).bind(ids,JSON.stringify(dates),now-MATURE_MS,media,now,ids).all();
 return {kind:'publication-cohort',timeZone:normalizeTimeZone(timeZone),rows:result.results,
  basis:'按运营时区的实际发布日期比较近七天作品；播放中位数和千播率只用发布满72小时且播放已同步的作品，指标为当前最新累计值，不是当日新增播放或历史分池快照。暂无成熟样本显示缺失。'};
}
function accountPoolSQL(){
 const p=POOL_POLICY;
 return 'CASE WHEN COALESCE(s.n,0)<'+p.minAccountSamples+" OR s.medianViews IS NULL THEN 'observing'"+
 ' WHEN s.medianViews>='+p.strongViews+" THEN 'strong' WHEN s.medianViews>="+p.normalViews+" THEN 'normal'"+
 ' WHEN s.medianViews<'+p.diagnosticViews+" THEN 'diagnostic' WHEN s.completion>="+p.completionBaseline+" THEN 'rescue-hook' ELSE 'rescue-content' END";
}

// Only an already-claimed operating check calls this writer. A single
// insert-select captures full permitted account aggregates inside D1; no raw
// account/publication population leaves the database. Empty checks are durable.
export async function capturePoolObservations(env,now=Date.now(),check={}){
 const db=env.DB;
 const raw=await db.prepare("SELECT value_json FROM factory_kv WHERE key='official-account-groups'").first();
 const store=ensureModuleProjects(parse(raw?.value_json,{})),project=findProjectForModule(store,'psychology');
 if(!project)return {checks:0};
 const policy=await db.prepare('SELECT * FROM psychology_task_group_policies WHERE project_key=?').bind(project.id).first();
 if(!policy)return {checks:0};
 const owner=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(policy.owner).first(),user=owner&&toPublicUser(owner);
 if(!user||user.role!=='admin'||!user.sidebarModules.includes('psychology-autopilot'))return {checks:0};
 const grant=userAllowedGroupIds(user),groups=store.groups.filter(g=>g.projectId===project.id&&(!grant||grant.has(g.id))).map(g=>g.id);
 const ids=JSON.stringify(groups),timeZone=normalizeTimeZone(policy.time_zone||PACIFIC_TIME_ZONE),date=zonedDate(now,timeZone),key=String(check.key||now),token=crypto.randomUUID();
 const cte=reportAccountScopeSQL+','+
 'valid AS MATERIALIZED (SELECT f.* FROM allowed a CROSS JOIN ops_task_facts f INDEXED BY ops_task_account_published ON f.account_key=a.account_key '+
 "WHERE f.media='photo' AND f.state='published' AND f.views IS NOT NULL AND f.published_at>=? AND f.published_at<=? "+
 "AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))),"+statsSQL('valid','account_key');
 const writes=await db.batch([
  db.prepare('INSERT OR IGNORE INTO psychology_pool_observation_checks(project_key,check_key,observed_at,operating_date,time_zone,group_ids_json,capture_token) VALUES(?,?,?,?,?,?,?)')
   .bind(project.id,key,now,date,timeZone,ids,token),
  db.prepare(cte+' INSERT OR IGNORE INTO psychology_account_observations(project_key,check_key,account_key,group_id,pool,samples,median_views,high_rate,completion) '+
   'SELECT ?,?,a.account_key,a.current_group,'+accountPoolSQL()+',COALESCE(s.n,0),s.medianViews,s.highRate,s.completion FROM allowed a LEFT JOIN sample_stats s USING(account_key) '+
   'WHERE EXISTS(SELECT 1 FROM psychology_pool_observation_checks c WHERE c.project_key=? AND c.check_key=? AND c.capture_token=?)')
   .bind(ids,now-30*DAY,now-MATURE_MS,ids,project.id,key,project.id,key,token),
  db.prepare('DELETE FROM psychology_account_observations WHERE project_key=? AND check_key IN (SELECT check_key FROM psychology_pool_observation_checks WHERE project_key=? AND observed_at<?)')
   .bind(project.id,project.id,now-14*DAY),
  db.prepare('DELETE FROM psychology_pool_observation_checks WHERE project_key=? AND observed_at<?').bind(project.id,now-14*DAY),
 ]);
 return {checks:Number(writes[0]?.meta?.changes||0)>0?1:0,observedAt:now};
}

// Current canonical scope AND the observation's original grants both apply.
// A moved primary or revoked alias cannot restore historical access. Unrecorded
// days are null; a recorded and permitted zero-account check is an actual zero.
export async function readPoolObservationTrend(db,{projectId,groupIds,now=Date.now(),timeZone=PACIFIC_TIME_ZONE}={}){
 const groups=groupList(groupIds),dates=observationDates(now,timeZone);
 if(!projectId||!groups.length)return {kind:'pool-observation',timeZone:normalizeTimeZone(timeZone),rows:dates.map(d=>({...d,observedAt:null,accounts:null,pools:null}))};
 const ids=JSON.stringify(groups);
 const sql=reportAccountScopeSQL+','+
 "days AS MATERIALIZED (SELECT json_extract(value,'$.date') date,json_extract(value,'$.start') start,json_extract(value,'$.end') end FROM json_each(?)),"+
 'candidates AS MATERIALIZED (SELECT c.*,row_number() OVER (PARTITION BY c.operating_date ORDER BY c.observed_at DESC,c.check_key DESC) rank '+
 'FROM psychology_pool_observation_checks c WHERE c.project_key=? AND c.time_zone=? AND c.observed_at>=? AND c.observed_at<=? '+
 'AND NOT EXISTS(SELECT 1 FROM json_each(?) requested WHERE requested.value NOT IN (SELECT value FROM json_each(c.group_ids_json)))),'+
 'checks AS MATERIALIZED (SELECT * FROM candidates WHERE rank=1),'+
 'counts AS (SELECT c.operating_date,c.observed_at,count(a.account_key) accounts,'+
 "COALESCE(sum(a.pool='strong'),0) strong,COALESCE(sum(a.pool='normal'),0) normal,COALESCE(sum(a.pool='rescue-hook'),0) hook,"+
 "COALESCE(sum(a.pool='rescue-content'),0) content,COALESCE(sum(a.pool='diagnostic'),0) diagnostic,COALESCE(sum(a.pool='observing'),0) observing "+
 'FROM checks c LEFT JOIN psychology_account_observations a ON a.project_key=c.project_key AND a.check_key=c.check_key '+
 'AND a.group_id IN (SELECT value FROM json_each(?)) AND a.account_key IN (SELECT account_key FROM allowed) GROUP BY c.operating_date,c.observed_at) '+
 'SELECT d.*,c.observed_at observedAt,c.accounts,c.strong,c.normal,c.hook,c.content,c.diagnostic,c.observing FROM days d LEFT JOIN counts c ON c.operating_date=d.date ORDER BY d.start';
 const result=await db.prepare(sql).bind(ids,JSON.stringify(dates),projectId,normalizeTimeZone(timeZone),dates[0].start,now,ids,ids).all();
 return {kind:'pool-observation',timeZone:normalizeTimeZone(timeZone),rows:result.results.map(({strong,normal,hook,content,diagnostic,observing,...row})=>({
  ...row,pools:row.observedAt===null?null:{strong,normal,'rescue-hook':hook,'rescue-content':content,diagnostic,observing},
 })),basis:'每天三次运营检查记录当时近30天成熟样本的账号分池，按运营日取最后一次检查。仅展示当前项目与权限交集；未记录日期保持缺失，不回填历史分池。'};
}
