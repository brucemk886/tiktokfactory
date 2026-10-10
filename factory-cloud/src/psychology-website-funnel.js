import { PRODUCTION_SESSION, tikTokSourceSQL, websiteWindow } from './psychology-website-data.js';

const DAY=86400000;
const stages=['clicks','arrived','started','finished','paid'];
export function funnelWindow(window,now=Date.now()){
 const selected=websiteWindow(new URLSearchParams({period:window.period||'range',from:window.from||'',to:window.to||''}),now);
 return {from:selected.from,to:selected.to,start:Date.parse(selected.start),end:Date.parse(selected.end),timeZone:selected.timeZone};
}
// TikTok only supplies whole UTC daily samples; do not relabel or prorate them as Beijing days.
function profileWindow(window){
 return {from:window.from,to:window.to,start:Date.parse(window.from+'T00:00:00Z'),end:Date.parse(window.to+'T00:00:00Z')+DAY,timeZone:'UTC'};
}
export function stageLoss(before,after){
 if(before==null||after==null)return {lost:null,rate:null,conversion:null};
 return {lost:before-after,rate:before>0?(before-after)/before:null,conversion:before>0?after/before:null};
}
export function summarizeFunnel(rows){
 const sum=key=>rows.some(row=>row[key]!==null)?rows.reduce((total,row)=>total+(row[key]??0),0):null;
 const result=Object.fromEntries(['profileViews',...stages].map(key=>[key,sum(key)]));
 result.accounts=rows.length;result.profileAccounts=rows.filter(row=>row.profileViews!==null).length;
 result.profileComplete=rows.length>0&&rows.every(row=>row.profileComplete);
 result.coverageComplete=rows.length>0&&rows.every(row=>row.coverageComplete);
 result.profileWindowAligned=rows.length>0&&rows.every(row=>row.profileWindowAligned!==false);
 result.profileClickRate=result.profileWindowAligned&&result.profileComplete&&result.coverageComplete&&result.profileViews>0&&result.clicks<=result.profileViews?result.clicks/result.profileViews:null;
 result.losses={arrival:stageLoss(result.clicks,result.arrived),start:stageLoss(result.arrived,result.started),finish:stageLoss(result.started,result.finished),payment:stageLoss(result.finished,result.paid)};
 return result;
}
async function profileData(db,accounts,window){
 const keys=accounts.map(a=>'tiktok:'+a.connectionId);
 const result=await db.prepare("SELECT account_key,json_extract(profile_json,'$.insights._daily_traffic.days') days FROM official_accounts_latest WHERE account_key IN (SELECT value FROM json_each(?))").bind(JSON.stringify(keys)).all();
 const samples=new Map(result.results.map(row=>[row.account_key,row]));
 const expected=Math.round((window.end-window.start)/DAY);
 return new Map(accounts.map(account=>{
  let input=[];try{input=JSON.parse(samples.get('tiktok:'+account.connectionId)?.days||'[]');}catch{}
  const valid=(Array.isArray(input)?input:[]).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')&&Number.isSafeInteger(day.profileViews)&&day.profileViews>=0);
  const days=new Map(valid.filter(day=>day.date>=window.from&&day.date<=window.to).map(day=>[day.date,day]));
  const profileLatestDay=valid.map(day=>day.date).sort().at(-1)||null;
  return [account.connectionId,{samples:[...days.values()],profileViews:days.size?[...days.values()].reduce((sum,day)=>sum+day.profileViews,0):null,profileDays:days.size,expectedDays:expected,profileLatestDay,profileUpdatedAt:Math.max(0,...[...days.values()].map(day=>Number(day.updatedAt)||0))}];
 }));
}
export async function readFunnelFacts(db,links,window,{daily=false}={}){
 const [catalog]=await db.batch([db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('traffic_link_clicks','traffic_link_state')").bind()]);
 if(catalog.results.length!==2)return {ready:false,startedAt:null,rows:[]};
 const scoped=JSON.stringify(links.map(link=>({code:link.code,campaign:'factory-'+link.connectionId})));
 const query=`WITH click_facts AS (
 SELECT c.id,c.code,c.clicked_at,c.arrived_at,COUNT(s.id) started,
 MAX(CASE WHEN s.id IS NOT NULL AND (s.completed_at IS NOT NULL OR EXISTS(SELECT 1 FROM quiz_events e WHERE e.session_id=s.id AND e.event_name='email_gate_viewed')) THEN 1 ELSE 0 END) finished,
 MAX(CASE WHEN s.id IS NOT NULL AND EXISTS(SELECT 1 FROM quiz_reports r JOIN payment_orders o ON o.report_id=r.id WHERE r.session_id=s.id AND o.livemode=1 AND o.amount_cents>0 AND o.paid_at IS NOT NULL AND o.status IN ('paid','refunded') AND substr(o.id,1,8)!='preview_') THEN 1 ELSE 0 END) paid
 FROM traffic_link_clicks c JOIN json_each(?) link ON c.code=json_extract(link.value,'$.code') AND c.campaign=json_extract(link.value,'$.campaign')
 LEFT JOIN quiz_attribution a ON a.visit_id=c.id AND ${tikTokSourceSQL('a.source')} AND a.campaign=c.campaign
 LEFT JOIN quiz_sessions s ON s.id=a.session_id AND ${PRODUCTION_SESSION}
 AND datetime(s.started_at)>=datetime(c.clicked_at/1000,'unixepoch')
 WHERE c.excluded=0 AND c.clicked_at>=? AND c.clicked_at<?
 GROUP BY c.id,c.code,c.arrived_at)
 SELECT code,${daily?"date(clicked_at/1000,'unixepoch','+8 hours') day,":''}COUNT(*) clicks,SUM(arrived_at IS NOT NULL OR started>0) arrived,
 SUM(started>0) started,SUM(finished>0 OR paid>0) finished,SUM(paid>0) paid FROM click_facts GROUP BY code${daily?',day':''}`;
 const [state,facts]=await db.batch([
  db.prepare("SELECT started_at FROM traffic_link_state WHERE id='v1'").bind(),
  db.prepare(query).bind(scoped,window.start,window.end)
 ]);
 if(state.success===false||facts.success===false)throw new Error('Funnel data unavailable');
 return {ready:Boolean(state.results[0]),startedAt:state.results[0]?.started_at??null,rows:facts.results};
}
export async function readWebsiteFunnel(factory,site,context,links,selectedWindow,now=Date.now()){
 const window=funnelWindow(selectedWindow,now),officialWindow=profileWindow(window);
 const byId=new Map(links.map(link=>[link.connectionId,link]));
 const accounts=context.accounts.filter(account=>byId.has(account.connectionId)||account.candidate&&account.canPublish);
 const [profiles,facts]=await Promise.all([profileData(factory,accounts,officialWindow),readFunnelFacts(site,links,window)]);
 const byCode=new Map(facts.rows.map(row=>[row.code,row]));
 const rows=accounts.map(account=>{
  const link=byId.get(account.connectionId),{samples,...profile}=profiles.get(account.connectionId);
  const trackedFrom=facts.ready&&link?Math.max(facts.startedAt,link.createdAt):null;
  const covered=trackedFrom!==null&&trackedFrom<Math.min(window.end,now);
  const values=Object.fromEntries(stages.map(key=>[key,covered?Number(byCode.get(link.code)?.[key]||0):null]));
  return {connectionId:account.connectionId,username:account.username,name:account.name,...profile,
   profileComplete:profile.profileDays===profile.expectedDays&&officialWindow.end<=now,
   profileWindowAligned:window.start===officialWindow.start&&window.end===officialWindow.end,
   ...values,trackedFrom,coverageComplete:covered&&trackedFrom<=window.start,tracking:covered?'ready':link?'not-covered':'no-link'};
 });
 const profileLatestDay=rows.map(row=>row.profileLatestDay).filter(Boolean).sort().at(-1)||null;
 return {window,profileWindow:officialWindow,profileLatestDay,ready:facts.ready,startedAt:facts.startedAt,rows:rows.map(row=>({...row,summary:summarizeFunnel([row])})),summary:summarizeFunnel(rows),
  definition:'按所选北京时间（UTC+8）日期内的 TikTok 推广短链接访问分组，跟踪这些访问后续的进站、测试和基础报告付款。链接被转发到其他地方后仍按 TikTok 推广链接归因。同一次访问每步最多计一次，付款后退款仍计入曾付款。主页访问单独使用所选日期的 TikTok UTC 日报，不能精确换算为北京时间，也无法逐人关联，因此不与北京时间链接点击计算比率。缺少日报显示暂无，不代表访问为零。成功进站由可见网页上报或实际开始测试确认；未确认可能包含加载失败、上报被拦截或用户退出。'};
}

// One bounded range read per data source; daily rows reuse the same click-cohort rules.
export async function readWebsiteDailyFunnel(factory,site,accounts,links,selectedWindow,now=Date.now()){
 const window=funnelWindow(selectedWindow,now),officialWindow=profileWindow(window);
 const [profiles,facts]=await Promise.all([profileData(factory,accounts,officialWindow),site?readFunnelFacts(site,links,window,{daily:true}):Promise.resolve({ready:false,startedAt:null,rows:[]})]);
 const byId=new Map(links.map(link=>[link.connectionId,link])),byDay=new Map(facts.rows.map(row=>[row.code+':'+row.day,row]));
 const days=[];for(let stamp=window.start;stamp<window.end;stamp+=DAY)days.push(new Date(stamp+8*3600000).toISOString().slice(0,10));
 const rows=accounts.map(account=>{
  const profile=profiles.get(account.connectionId),link=byId.get(account.connectionId);
  const trackedFrom=facts.ready&&link?Math.max(facts.startedAt,link.createdAt):null;
  const daily=days.map(day=>{
   const start=Date.parse(day+'T00:00:00+08:00'),end=start+DAY,sample=profile.samples.find(s=>s.date===day);
   const covered=trackedFrom!==null&&trackedFrom<Math.min(end,now),fact=byDay.get(link?.code+':'+day);
   return {day,connectionId:account.connectionId,profileViews:sample?.profileViews??null,profileComplete:!!sample&&Date.parse(day+'T00:00:00Z')+DAY<=now,profileWindowAligned:false,
    ...Object.fromEntries(stages.map(key=>[key,covered?Number(fact?.[key]||0):null])),coverageComplete:covered&&trackedFrom<=start};
  });
  return {connectionId:account.connectionId,username:account.username,name:account.name,profileLatestDay:profile.profileLatestDay,profileUpdatedAt:profile.profileUpdatedAt,trackedFrom,tracking:link?(facts.ready?'ready':'unavailable'):'no-link',daily,summary:summarizeFunnel(daily)};
 });
 return {window,profileWindow:officialWindow,ready:facts.ready,profileLatestDay:rows.map(r=>r.profileLatestDay).filter(Boolean).sort().at(-1)||null,rows};
}
