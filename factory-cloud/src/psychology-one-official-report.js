import {oneAnalysis,oneAvailability,oneMediaUrl} from '../../public/psychology-one-analysis-schema.js';
import {signalDesk} from './signal-desk.js';
import {reportAccountScopeSQL} from './official-report-account-scope.js';
const cache=new WeakMap(),SIZE=20,MAX_PAGES=20,TTL=120000;
const fields=['views','organicViews','likes','comments','shares','anchorViews','anchorClicks','anchorUniqueViews','anchorUniqueClicks'];
const number=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Math.max(0,Number(v));
function aggregate(rows){
 const result={total:rows.length,synced:rows.filter(v=>v.views!==null).length,missingMetrics:rows.filter(v=>v.views===null).length};
 for(const k of fields){const values=rows.map(r=>r[k]).filter(v=>v!==null);result[k]=values.length?values.reduce((a,b)=>a+b,0):null;result[k+'Samples']=values.length;}
 result.averageViews=result.synced?result.views/result.synced:null;
 result.thousandRate=result.synced?rows.filter(v=>v.views>=1000).length/result.synced:null;
 // CTR uses only rows with both views and clicks; summing different coverage is misleading.
 const paired=rows.filter(v=>v.anchorViews!==null&&v.anchorClicks!==null),denom=paired.reduce((s,v)=>s+v.anchorViews,0);
 result.anchorCtr=denom?paired.reduce((s,v)=>s+v.anchorClicks,0)/denom:null;
 return result;
}
async function fetchProject(env,context,{window,country,refresh}){
 const query={...context,resource:'report',country,...(window.period==='all'?{}:{startDate:window.from,endDate:window.to})},key=JSON.stringify(query);
 let saved=cache.get(env.DB);if(!saved){saved=new Map();cache.set(env.DB,saved);}
 const hit=saved.get(key);if(!refresh&&hit&&Date.now()-hit.at<TTL)return {...hit.data,cached:true};
 const page=async n=>{
  const r=await signalDesk(env,env.DB,'/api/v1/tiktok-one?'+new URLSearchParams({...query,page:String(n)}),{signal:AbortSignal.timeout(60000)});
  if(!Array.isArray(r.videos)||!Number.isInteger(Number(r.page_info?.total_page))||Number(r.page_info.total_page)<0)throw new Error('TikTok One 报表返回不完整，请稍后刷新。');
  return r;
 };
 const first=await page(1),totalPages=Number(first.page_info.total_page),pages=[first];
 for(let start=2;start<=Math.min(MAX_PAGES,totalPages);start+=3){const batch=[];for(let n=start;n<=Math.min(start+2,totalPages,MAX_PAGES);n++)batch.push(page(n));pages.push(...await Promise.all(batch));}
 const rows=new Map();for(const p of pages)for(const v of p.videos)if(v.videoId)rows.set(String(v.videoId),v);
 const data={videos:[...rows.values()],partial:totalPages>MAX_PAGES||pages.some(p=>Number(p.page_info.total_page)!==totalPages),dateRange:first.dateRange,fetchedAt:Math.min(...pages.map(p=>Number(p.fetchedAt)||Date.now())),requestIds:pages.map(p=>p.requestId).filter(Boolean)};
 // Runtime-only cache; re-evaluate all Factory permissions on every request.
 if(saved.size>=30)saved.delete(saved.keys().next().value);saved.set(key,{at:Date.now(),data});return {...data,cached:false};
}
export async function readOfficialOneReport(env,{ids,groups,window,campaign,view,page,country='US',refresh=false,videoId=''}){
 const db=env.DB;
 const projects=(await db.prepare(reportAccountScopeSQL+` SELECT json_extract(b.config_json,'$.tiktokOne.connectionId') connectionId,
 CAST(json_extract(b.config_json,'$.tiktokOne.accountId') AS TEXT) accountId,CAST(json_extract(b.config_json,'$.tiktokOne.campaignId') AS TEXT) campaignId,max(b.created_at) lastAt
 FROM allowed a JOIN psychology_publish_items i ON a.account_key='tiktok:'||replace(i.connection_id,'tiktok:','') JOIN psychology_publish_batches b ON b.id=i.batch_id
 WHERE json_extract(b.config_json,'$.mediaType')='video' AND json_type(b.config_json,'$.tiktokOne')='object'
 GROUP BY connectionId,accountId,campaignId ORDER BY lastAt DESC,campaignId`).bind(ids).all()).results.filter(p=>p.connectionId&&p.accountId&&p.campaignId);
 const context=campaign?projects.find(p=>p.campaignId===campaign):projects[0];
 if(campaign&&!context)throw Object.assign(new Error('没有这个 TikTok One 项目的报表权限。'),{statusCode:403});
 const meta={source:'official',window,view,country,groups:groups.map(g=>({id:g.id,name:g.name})),projects:[...new Map(projects.map(p=>[p.campaignId,{campaignId:p.campaignId}])).values()],campaign:context?.campaignId||'',updatedAt:Date.now(),coverage:'数据来自 TikTok One 官方项目报表，仅显示当前授权心理学账号的作品；不包含普通发布。指标保留官方累计口径，空值不计作 0。日期筛选按官方返回的作品发布日期，不做时区换算；播放与互动不是期间新增值。此接口未提供审核状态。'};
 if(!context&&videoId)throw Object.assign(new Error('当前范围内没有这条视频，或已无访问权限。'),{statusCode:404});
 if(!context)return {...meta,summary:aggregate([]),rows:[],pagination:{page:1,pages:1,total:0,pageSize:SIZE},fetchedAt:0,partial:false};
 const source=await fetchProject(env,{connectionId:context.connectionId,accountId:context.accountId,campaignId:context.campaignId},{window,country,refresh});
 const scoped=(await db.prepare(reportAccountScopeSQL+` SELECT a.account_key,a.current_group,COALESCE(NULLIF(json_extract(d.profile_json,'$.username'),''),NULLIF(d.label,''),a.account_key) name,
 m.alias_key FROM allowed a LEFT JOIN official_accounts_latest d ON d.account_key=a.account_key LEFT JOIN report_account_aliases m ON 'tiktok:'||m.primary_key=a.account_key`).bind(ids).all()).results;
 const byHandle=new Map(),accounts=new Map(),handle=v=>String(v||'').replace(/^@/,'').toLowerCase();
 for(const a of scoped){accounts.set(a.account_key,a);for(const name of [a.name,a.alias_key]){const k=handle(name);if(!k||k.startsWith('tiktok:'))continue;const prior=byHandle.get(k);byHandle.set(k,prior===undefined||prior?.account_key===a.account_key?a:null);}}
 // Exact task/video evidence takes precedence over mutable usernames.
 const known=(await db.prepare(`SELECT DISTINCT f.video_id,f.account_key FROM ops_task_facts f JOIN psychology_publish_batches b ON b.id=f.batch_id
 WHERE f.video_id<>'' AND CAST(json_extract(b.config_json,'$.tiktokOne.campaignId') AS TEXT)=?`).bind(context.campaignId).all()).results;
 const owners=new Map();for(const r of known){const set=owners.get(r.video_id)||new Set();set.add(r.account_key);owners.set(r.video_id,set);}
 const videos=[];let detail;
 const availability={audience:0,retention:0,daily:0,sources:0,watch:0};
 for(const v of source.videos){const keys=owners.get(String(v.videoId));let a;if(keys){if(keys.size===1)a=accounts.get([...keys][0]);}else a=byHandle.get(handle(v.creator));if(!a)continue;
  if(window.period!=='all'){const date=String(v.publishedAt||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<window.from||date>window.to)continue;}
  const row={videoId:String(v.videoId),account:a.account_key,accountName:a.name,groupId:a.current_group,campaignId:context.campaignId,publishedAt:String(v.publishedAt||''),...Object.fromEntries(fields.map(k=>[k,number(v[k])]))};
  row.anchorCtr=row.anchorViews>0&&row.anchorClicks!==null?row.anchorClicks/row.anchorViews:null;
  const analysis=oneAnalysis(v.analysis||{});row.available=oneAvailability(analysis);
  for(const key of Object.keys(availability))if(row.available[key])availability[key]++;
  if(videoId===row.videoId)detail={...row,anchorId:String(v.anchorId||''),thumbnailUrl:oneMediaUrl(v.thumbnailUrl),embedUrl:oneMediaUrl(v.embedUrl),analysis};
  videos.push(row);
 }
 if(videoId&&!detail)throw Object.assign(new Error('当前范围内没有这条视频，或已无访问权限。'),{statusCode:404});
 const summary={...aggregate(videos),availability};let rows=videos;
 if(view!=='videos'){const map=new Map();for(const v of videos){const key=view==='accounts'?v.account:v.campaignId;if(!map.has(key))map.set(key,[]);map.get(key).push(v);}rows=[...map.values()].map(v=>({...aggregate(v),account:v[0].account,accountName:v[0].accountName,groupId:v[0].groupId,campaignId:v[0].campaignId}));}
 rows.sort((a,b)=>(b.views??-1)-(a.views??-1)||String(a.videoId||a.account||a.campaignId).localeCompare(String(b.videoId||b.account||b.campaignId)));
 const total=rows.length,pages=Math.max(1,Math.ceil(total/SIZE)),actualPage=Math.min(Math.max(1,Number(page)||1),pages);
 return {...meta,summary,...(detail?{detail}:{}),rows:videoId?[]:rows.slice((actualPage-1)*SIZE,actualPage*SIZE),pagination:{page:actualPage,pages,total,pageSize:SIZE},dateRange:source.dateRange,fetchedAt:source.fetchedAt,cached:source.cached,partial:source.partial,requestIds:source.requestIds};
}
