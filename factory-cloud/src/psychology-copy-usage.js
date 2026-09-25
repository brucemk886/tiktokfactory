import {TOPIC_LABELS} from '../../scripts/psychology-peer-topics.js';
import {photoCopyKey} from './peer-photo-copy-cache.js';
import {json,errorJson} from './http.js';
import {rewriteModelLabel} from './psychology-rewrite-model.js';

const DAY=86400000,SIZE=20;
const dateKey=ms=>new Date(ms+28800000).toISOString().slice(0,10);
export function copyUsageWindow(params,now=Date.now()){
 const period=params.get('period')||'all',today=dateKey(now),midnight=Date.parse(today+'T00:00:00+08:00');
 if(period==='all')return {period,from:'',to:today,start:0,end:midnight+DAY};
 if(!['today','yesterday','7d','30d','custom'].includes(period))throw new Error('时间筛选无效。');
 const from=period==='custom'?params.get('from'):dateKey(midnight-({today:0,yesterday:1,'7d':6,'30d':29}[period])*DAY);
 const to=period==='custom'?params.get('to'):period==='yesterday'?dateKey(midnight-DAY):today;
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00+08:00'))&&dateKey(Date.parse(s+'T00:00:00+08:00'))===s;
 if(!valid(from)||!valid(to)||from>to||to>today)throw new Error('请选择有效且不晚于今天的日期。');
 return {period,from,to,start:Date.parse(from+'T00:00:00+08:00'),end:Date.parse(to+'T00:00:00+08:00')+DAY};
}
const numberPage=value=>Math.max(1,Math.min(1000000,Math.floor(Number(value)||1)));
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const emptyStats=()=>({samples:0,medianViews:null,averageViews:null,potentialRate:null,hitRate:null,completion:null,completionSamples:0});
const metrics=['samples','medianViews','averageViews','potentialRate','hitRate','completion','completionSamples'];
const statJson=alias=>"json_object("+metrics.map(k=>"'"+k+"',"+(k==='samples'||k==='completionSamples'?'COALESCE('+alias+'.'+k+',0)':alias+'.'+k)).join(',')+")";
const rowsJson=(sql,fields)=>"(SELECT json_group_array(json_object("+fields.map(f=>"'"+f+"',"+f).join(',')+")) FROM ("+sql+"))";

// Content read adapter. Legacy selection records supply immutable draw events;
// the local analytics projection supplies deduplicated observations. Neither
// source's account, group, schedule or execution state crosses this API boundary.
// URL canonicalization is shared with import/selection (including share links).
// Only small identity columns are read in JS; historical aggregation and paging
// are in SQL, with no 5k/10k/20k cutoffs and no remote calls or repair writes.
async function context(db,owner,params){
 const window=copyUsageWindow(params),media=params.get('media')||'all';
 if(!['all','photo','video'].includes(media))throw new Error('内容类型无效。');
 const sourceRows=(await db.prepare("SELECT id,source_url FROM psychology_copy_library WHERE status='done' AND (?='all' OR media_type=?)").bind(media,media).all()).results;
 const identities=sourceRows.map(r=>{let key;try{key=photoCopyKey(r.source_url);}catch{key=r.id;}return {id:r.id,key};});
 const query=String(params.get('q')||'').trim().slice(0,200),copy=params.get('copy')||'';
 const topicQuery=Object.entries(TOPIC_LABELS).find(([,label])=>label.includes(query)&&query)?.[0]||query;
 const args=[JSON.stringify(identities),query,query,topicQuery,copy,copy,owner,owner,window.start,window.end,window.start,window.end,window.start,window.end];
 const cte=`WITH keys AS MATERIALIZED (SELECT json_extract(value,'$.id') id,json_extract(value,'$.key') source_key FROM json_each(?)),
 catalog AS MATERIALIZED (SELECT c.id,k.source_key,c.title,c.media_type,c.created_at,p.play_count sourceViews,COALESCE(p.topics_json,'[]') topics FROM keys k JOIN psychology_copy_library c ON c.id=k.id LEFT JOIN psychology_peer_hits p ON p.id=c.id
 WHERE (?='' OR instr(lower(c.title),lower(?))>0 OR instr(lower(COALESCE(p.topics_json,'')),lower(?))>0) AND (?='' OR c.id=?)),
 versions AS MATERIALIZED (SELECT v.* FROM psychology_copy_variants v WHERE v.owner=? AND v.source_key IN (SELECT source_key FROM catalog)),
 events AS MATERIALIZED (
 SELECT i.id,b.created_at drawn_at,
 COALESCE(NULLIF(c.source_key,''),v.source_key,k.source_key) source_key,
 CASE WHEN c.item_id IS NOT NULL THEN COALESCE(NULLIF(cv.external_id,''),c.variant_id) ELSE COALESCE(v.external_id,'') END variant,
 f.published_at,f.views,f.completion,f.synced_at,f.state
 FROM psychology_publish_batches b JOIN psychology_publish_items i ON i.batch_id=b.id
 LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id
 LEFT JOIN versions v ON v.id=i.source_id
 LEFT JOIN versions cv ON cv.id=c.variant_id AND cv.source_key=c.source_key
 LEFT JOIN keys k ON k.id=i.source_id
 LEFT JOIN ops_task_facts f ON f.id=i.id
 WHERE b.created_by=? AND ((b.created_at>=? AND b.created_at<?) OR (f.published_at>=? AND f.published_at<?))
 AND COALESCE(NULLIF(c.source_key,''),v.source_key,k.source_key) IN (SELECT source_key FROM catalog)),
 draws AS MATERIALIZED (SELECT source_key,variant,count(*) draws,max(drawn_at) lastDraw FROM events WHERE drawn_at>=? AND drawn_at<? GROUP BY source_key,variant),
 observations AS MATERIALIZED (SELECT source_key,variant,views,count(*) freq,sum(completion) completion_sum,count(completion) completion_n,max(synced_at) synced_at
 FROM events WHERE state='published' AND views IS NOT NULL AND published_at>=${window.start} AND published_at<${window.end} GROUP BY source_key,variant,views),
 buckets AS (SELECT 'version' level,source_key,variant,views,freq,completion_sum,completion_n,synced_at FROM observations
 UNION ALL SELECT 'copy',source_key,'',views,freq,completion_sum,completion_n,synced_at FROM observations
 UNION ALL SELECT 'copyKind',source_key,CASE WHEN variant='' THEN 'original' ELSE 'rewrite' END,views,freq,completion_sum,completion_n,synced_at FROM observations
 UNION ALL SELECT 'kind','',CASE WHEN variant='' THEN 'original' ELSE 'rewrite' END,views,freq,completion_sum,completion_n,synced_at FROM observations
 UNION ALL SELECT 'total','','',views,freq,completion_sum,completion_n,synced_at FROM observations),
 frequencies AS (SELECT level,source_key,variant,views,sum(freq) freq,sum(completion_sum) completion_sum,sum(completion_n) completion_n,max(synced_at) synced_at FROM buckets GROUP BY level,source_key,variant,views),
 ranked AS (SELECT *,sum(freq) OVER(PARTITION BY level,source_key,variant ORDER BY views) cumulative,sum(freq) OVER(PARTITION BY level,source_key,variant) nn FROM frequencies),
 stats AS MATERIALIZED (SELECT level,source_key,variant,sum(freq) samples,1.0*sum(views*freq)/sum(freq) averageViews,
 (sum(CASE WHEN (nn+1)/2>cumulative-freq AND (nn+1)/2<=cumulative THEN views ELSE 0 END)+sum(CASE WHEN (nn+2)/2>cumulative-freq AND (nn+2)/2<=cumulative THEN views ELSE 0 END))/2.0 medianViews,
 1.0*sum(CASE WHEN views>=1000 THEN freq ELSE 0 END)/sum(freq) potentialRate,1.0*sum(CASE WHEN views>=10000 THEN freq ELSE 0 END)/sum(freq) hitRate,
 1.0*sum(completion_sum)/nullif(sum(completion_n),0) completion,sum(completion_n) completionSamples,max(synced_at) syncedAt FROM ranked GROUP BY level,source_key,variant),
 copy_draws AS (SELECT source_key,sum(draws) draws,sum(CASE WHEN variant='' THEN draws ELSE 0 END) originalDraws,sum(CASE WHEN variant<>'' THEN draws ELSE 0 END) rewriteDraws,max(lastDraw) lastDraw FROM draws GROUP BY source_key),
 version_counts AS (SELECT source_key,count(*) rewrites,sum(enabled=1 AND review_status='approved') usable,sum(review_status='pending') pending,sum(enabled=0 AND review_status='approved') disabled FROM versions WHERE deleted_at=0 GROUP BY source_key),
 copies AS MATERIALIZED (SELECT c.*,COALESCE(v.rewrites,0) rewrites,COALESCE(d.draws,0) draws,COALESCE(d.originalDraws,0) originalDraws,COALESCE(d.rewriteDraws,0) rewriteDraws,d.lastDraw,
 COALESCE(s.samples,0) samples,s.medianViews,s.potentialRate,s.hitRate,s.completion,${statJson('o')} original,${statJson('r')} rewrite
 FROM catalog c LEFT JOIN version_counts v USING(source_key) LEFT JOIN copy_draws d USING(source_key) LEFT JOIN stats s ON s.level='copy' AND s.source_key=c.source_key
 LEFT JOIN stats o ON o.level='copyKind' AND o.source_key=c.source_key AND o.variant='original'
 LEFT JOIN stats r ON r.level='copyKind' AND r.source_key=c.source_key AND r.variant='rewrite')`;
 return {cte,args,window};
}
export async function handleCopyUsage(request,env,url,user){
 if(request.method!=='GET')return errorJson('仅支持读取文案统计。',405);
 const started=Date.now(),p=url.searchParams,db=env.DB;
 try{
  const usage=p.get('usage')||'all',sort=p.get('sort')||'views';
  if(!['all','used','unused','data'].includes(usage)||!['views','recent','draws','median','potential'].includes(sort))throw new Error('筛选条件无效。');
  const {cte,args,window}=await context(db,user.username,p),page=numberPage(p.get('page')),offset=(page-1)*SIZE;
  const run=sql=>db.prepare(cte+sql).bind(...args);
  let data;
  if(p.get('copy')){
   const source=await db.prepare("SELECT id,title,source_url,content_json,created_at FROM psychology_copy_library WHERE id=? AND status='done'").bind(p.get('copy')).first();
   if(!source)return errorJson('文案不存在或已移除。',404);
   if(p.has('text')){
    const text=p.get('text');let body,meta;
    if(text===''){body=parse(source.content_json);meta={title:source.title,kind:'original'};}
    else {let key;try{key=photoCopyKey(source.source_url);}catch{key=source.id;}
     const v=await db.prepare('SELECT title,caption,pages_json,rewrite_model FROM psychology_copy_variants WHERE owner=? AND source_key=? AND external_id=?').bind(user.username,key,text).first();
     if(!v)return errorJson('该版本正文已不可用。',404);
     body={caption:v.caption,pages:parse(v.pages_json)};meta={title:v.title,kind:'rewrite',model:rewriteModelLabel(v.rewrite_model)};
    }
    return json({content:body,...meta});
   }
   const vcte=`,version_keys AS (SELECT source_key,'' variant FROM catalog UNION SELECT source_key,external_id FROM versions WHERE deleted_at=0 UNION SELECT source_key,variant FROM draws UNION SELECT source_key,variant FROM observations),
 detail AS (SELECT k.variant,CASE WHEN k.variant='' THEN '原文' ELSE COALESCE(v.title,'历史改写版本') END title,CASE WHEN k.variant='' THEN 'original' ELSE 'rewrite' END kind,
 CASE WHEN k.variant='' THEN 'usable' WHEN v.id IS NULL OR v.deleted_at>0 THEN 'deleted' WHEN v.review_status='pending' THEN 'pending' WHEN v.enabled=1 THEN 'usable' ELSE 'disabled' END status,
 COALESCE(v.rewrite_model,'') model,CASE WHEN k.variant='' THEN c.created_at ELSE v.created_at END createdAt,
 COALESCE(d.draws,0) draws,d.lastDraw,${statJson('s')} stats
 FROM version_keys k JOIN catalog c USING(source_key) LEFT JOIN versions v ON v.source_key=k.source_key AND v.external_id=k.variant
 LEFT JOIN draws d ON d.source_key=k.source_key AND d.variant=k.variant LEFT JOIN stats s ON s.level='version' AND s.source_key=k.source_key AND s.variant=k.variant)`;
   const r=await run(vcte+` SELECT json_object('total',(SELECT count(*) FROM detail),'items',${rowsJson('SELECT * FROM detail ORDER BY kind,createdAt DESC,variant LIMIT '+SIZE+' OFFSET '+offset,['variant','title','kind','status','model','createdAt','draws','lastDraw','stats'])}) payload`).first();
   data=JSON.parse(r.payload);data.items=data.items.map(r=>({...r,stats:parse(r.stats),model:rewriteModelLabel(r.model)}));data.copy={id:source.id,title:source.title};
  }else{
   const where={all:'1',used:'draws>0',unused:'draws=0',data:'samples>0'}[usage];
   const order={views:'sourceViews DESC,created_at DESC,id',recent:'created_at DESC,id',draws:'draws DESC,id',median:'medianViews DESC,samples DESC,id',potential:'potentialRate DESC,samples DESC,id'}[sort];
   const sql=` SELECT json_object(
 'inventory',json_object('originals',(SELECT count(*) FROM catalog),'rewrites',COALESCE((SELECT sum(rewrites) FROM version_counts),0),'usable',(SELECT count(*) FROM catalog)+COALESCE((SELECT sum(usable) FROM version_counts),0),'pending',COALESCE((SELECT sum(pending) FROM version_counts),0),'disabled',COALESCE((SELECT sum(disabled) FROM version_counts),0)),
 'usage',json_object('used',(SELECT count(*) FROM copies WHERE draws>0),'unused',(SELECT count(*) FROM copies WHERE draws=0),'draws',COALESCE((SELECT sum(draws) FROM copies),0),'originalDraws',COALESCE((SELECT sum(originalDraws) FROM copies),0),'rewriteDraws',COALESCE((SELECT sum(rewriteDraws) FROM copies),0)),
 'effects',(SELECT ${statJson('s')} FROM stats s WHERE level='total'),
 'copiesWithData',(SELECT count(*) FROM copies WHERE samples>0),
 'updatedAt',(SELECT max(syncedAt) FROM stats),
 'comparison',${rowsJson("SELECT variant kind,samples,medianViews,averageViews,potentialRate,hitRate,completion,completionSamples FROM stats WHERE level='kind'",['kind',...metrics])},
 'total',(SELECT count(*) FROM copies WHERE ${where}),
 'items',${rowsJson('SELECT * FROM copies WHERE '+where+' ORDER BY '+order+' LIMIT '+SIZE+' OFFSET '+offset,['id','title','media_type','topics','created_at','sourceViews','rewrites','draws','originalDraws','rewriteDraws','lastDraw','samples','medianViews','potentialRate','hitRate','completion','original','rewrite'])}) payload`;
   data=JSON.parse((await run(sql).first()).payload);
   data.effects=data.effects||emptyStats();data.usage.coverage=data.inventory.originals?data.usage.used/data.inventory.originals:null;
   data.items=data.items.map(r=>({...r,topics:parse(r.topics).map(t=>TOPIC_LABELS[t]||t),original:parse(r.original),rewrite:parse(r.rewrite)}));
  }
  const response=json({...data,window,page,pages:Math.max(1,Math.ceil(data.total/SIZE)),pageSize:SIZE});
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Server-Timing','total;dur='+(Date.now()-started));return response;
 }catch(e){if(/无效|请选择/.test(e.message))return errorJson(e.message,400);throw e;}
}
