import {json,errorJson} from './http.js';
import {toPublicUser} from './auth.js';
import {hasPsychologyModule} from './psychology-permissions.js';
import {accountScope} from './psychology-conversion.js';
import {websiteWindow} from './psychology-website-data.js';
import {readWebsiteDailyFunnel,summarizeFunnel} from './psychology-website-funnel.js';
const BASE='/api/psychology-receiving-report',DAY=86400000,SIZE=20;
const parse=(value,fallback={})=>{try{return JSON.parse(value||'');}catch{return fallback;}};
const pageOf=value=>Math.max(1,Math.min(100000,Math.floor(Number(value)||1)));
const photoSummary=rows=>({posts:rows.reduce((n,r)=>n+r.posts,0),synced:rows.reduce((n,r)=>n+r.synced,0),mentions:rows.reduce((n,r)=>n+r.mentions,0),selfBio:rows.reduce((n,r)=>n+r.selfBio,0),views:rows.some(r=>r.views!==null)?rows.reduce((n,r)=>n+(r.views??0),0):null});
// Current publisher AND receiver grants are mandatory. Owner identity deduplicates receipts.
const base=`WITH scoped AS (
 SELECT f.*,r.receiver_key,r.receiver_username,r.cta,
 row_number() OVER(PARTITION BY f.account_key,CASE WHEN f.video_id<>'' THEN f.video_id ELSE f.id END ORDER BY f.published_at,f.id) duplicate_rank
 FROM ops_task_facts f JOIN ops_photo_receivers r ON r.item_id=f.id AND r.publisher_key=f.account_key
 LEFT JOIN ops_video_owners o ON o.account_key=f.account_key AND o.video_id=f.video_id
 WHERE f.account_key IN (SELECT value FROM json_each(?)) AND r.receiver_key IN (SELECT value FROM json_each(?))
 AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?)))
 AND f.media='photo' AND f.state='published' AND f.published_at>=? AND f.published_at<?
 AND (o.item_id IS NULL OR o.item_id=f.id)
), posts AS (SELECT * FROM scoped WHERE duplicate_rank=1)`;
export async function handlePsychologyReceivingReport(request,env,url,session,{now=Date.now()}={}){
 if(url.pathname!==BASE)return null;
 if(!session?.user?.username)return errorJson('请先登录。',401);
 if(request.method!=='GET')return errorJson('仅支持读取引流报表。',405);
 try{
  const db=env.DB,row=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(session.user.username).first();
  const user=row?toPublicUser(row):null;
  if(!hasPsychologyModule(user,'psychology-ops-report'))return errorJson('没有心理学运营报表权限。',403);
  const params=new URLSearchParams(url.searchParams);if(!params.has('period'))params.set('period','today');
  const window=websiteWindow(params,now),start=Date.parse(window.start),end=Date.parse(window.end);
  const scope=await accountScope(db,user),accounts=scope.accounts,keys=JSON.stringify(accounts.map(a=>'tiktok:'+a.connectionId));
  const groups=JSON.stringify(scope.groupIds),selected=params.get('receiver')||'';
  const settings=await db.prepare('SELECT config_json FROM psychology_imported_photo_settings WHERE owner=?').bind(user.username).first();
  const config=parse(settings?.config_json);
  // Include past receivers even if future routing has changed. New link-only accounts are not receivers.
  const history=(await db.prepare(`SELECT DISTINCT receiver_key FROM ops_photo_receivers WHERE publisher_key IN (SELECT value FROM json_each(?)) AND receiver_key IN (SELECT value FROM json_each(?)) AND created_at<?`).bind(keys,keys,end).all()).results;
  const receiverIds=new Set([...history.map(r=>r.receiver_key.slice(7)),...(config.receivers||[]).map(r=>r.connectionId)]);
  const choices=accounts.filter(a=>receiverIds.has(a.connectionId));
  if(selected&&!choices.some(a=>a.connectionId===selected))return errorJson('承接账号不在当前报表权限范围。',403);
  const receivers=choices.filter(a=>!selected||a.connectionId===selected),receiverKeys=JSON.stringify(receivers.map(a=>'tiktok:'+a.connectionId));
  const bindings=[keys,receiverKeys,groups,start,end];
  const [photos,linkResult,totals,detailResult,unmapped]=await Promise.all([
   db.prepare(base+` SELECT substr(receiver_key,8) connectionId,date(published_at/1000,'unixepoch','+8 hours') day,account_key publisher,
    count(*) posts,count(views) synced,sum(views) views,sum(account_key<>receiver_key) mentions,sum(account_key=receiver_key) selfBio,max(synced_at) syncedAt
    FROM posts GROUP BY receiver_key,day,account_key`).bind(...bindings).all(),
   db.prepare('SELECT connection_id connectionId,code,created_at createdAt FROM psychology_website_links WHERE project_key=? AND connection_id IN (SELECT value FROM json_each(?))').bind(scope.project.id,JSON.stringify(receivers.map(a=>a.connectionId))).all(),
   db.prepare(base+' SELECT count(*) total FROM posts').bind(...bindings).first(),
   db.prepare(base+' SELECT id,account_key,receiver_key,receiver_username,cta,title,video_id,published_at,views,synced_at FROM posts ORDER BY published_at DESC,id LIMIT ? OFFSET ?').bind(...bindings,SIZE,(pageOf(params.get('page'))-1)*SIZE).all(),
   db.prepare(`SELECT count(*) n FROM ops_task_facts f WHERE f.account_key IN (SELECT value FROM json_each(?)) AND (f.pilot_id='' OR f.group_id IN (SELECT value FROM json_each(?))) AND media='photo' AND state='published' AND published_at>=? AND published_at<? AND NOT EXISTS(SELECT 1 FROM ops_photo_receivers r WHERE r.item_id=f.id)`).bind(keys,groups,start,end).first()
  ]);
  const site=env.DEEP_PERSONA_DB?.withSession?env.DEEP_PERSONA_DB.withSession('first-primary'):env.DEEP_PERSONA_DB;
  let funnel,siteError=false;
  try{funnel=await readWebsiteDailyFunnel(db,site,receivers,linkResult.results,window,now);}catch(error){
   // Keep known publication/profile data visible when the independent site's read fails.
   console.error(JSON.stringify({event:'receiving-site-read-failed',message:String(error.message).slice(0,160)}));
   siteError=true;funnel=await readWebsiteDailyFunnel(db,null,receivers,linkResult.results,window,now);
  }
  const names=new Map(accounts.map(a=>['tiktok:'+a.connectionId,a.username||a.name||a.connectionId]));
  const receiverRows=funnel.rows.map(r=>{
   const p=photos.results.filter(p=>p.connectionId===r.connectionId),publishers=new Set(p.map(p=>p.publisher));
   return {...r,summary:{...r.summary,accounts:1,profileAccounts:r.summary.profileViews===null?0:1},...photoSummary(p),publishers:publishers.size,sourceAccounts:[...publishers].map(key=>({username:names.get(key),...photoSummary(p.filter(p=>p.publisher===key))})),daily:undefined};
  }).sort((a,b)=>(b.views??-1)-(a.views??-1));
  const daily=[];for(let stamp=start;stamp<end;stamp+=DAY){
   const day=new Date(stamp+8*3600000).toISOString().slice(0,10),p=photos.results.filter(p=>p.day===day);
   daily.push({day,...photoSummary(p),summary:summarizeFunnel(funnel.rows.flatMap(r=>r.daily.filter(d=>d.day===day)))});
  }
  const summary={...photoSummary(photos.results),...summarizeFunnel(funnel.rows.flatMap(r=>r.daily)),receivers:receivers.length,accounts:receivers.length,profileAccounts:receiverRows.filter(r=>r.summary.profileViews!==null).length,publishers:new Set(photos.results.map(p=>p.publisher)).size,unmappedPosts:selected?null:unmapped.n};
  const pages=Math.max(1,Math.ceil(totals.total/SIZE)),page=pageOf(params.get('page'));
  const details=detailResult.results.map(r=>({id:r.id,publisher:names.get(r.account_key),receiver:names.get(r.receiver_key),publishedHandle:r.receiver_username,cta:r.cta,title:r.title,videoId:r.video_id,publishedAt:r.published_at,views:r.views,syncedAt:r.synced_at,selfBio:r.account_key===r.receiver_key}));
  return json({window,receiver:selected,choices:choices.map(a=>({connectionId:a.connectionId,username:a.username||a.name})),summary,daily:daily.reverse(),receivers:receiverRows,details,pagination:{page,pages,total:totals.total,pageSize:SIZE},
   siteReady:funnel.ready,siteError,profileWindow:funnel.profileWindow,profileLatestDay:funnel.profileLatestDay,updatedAt:now,photoSyncedAt:Math.max(0,...photos.results.map(p=>p.syncedAt||0)),
   definitions:{exposure:'图文曝光以 TikTok 累计播放为参考：按北京时间实际发布日分组，展示这些作品最新累计播放，不是当日新增曝光或独立人数。仅计保存了引流承接关系的已发布图文。',
    attribution:'@关系取发布时冻结的承接账号；主页访问及短链接流量是承接账号整体数据，包含其他来源，无法证明每次访问都来自这些图文，也不能追踪 @ 点击次数。',
    profile:'主页访问使用同名日期的 TikTok UTC 日报，缺日报显示 —；与北京时间图文及链接数据的窗口不同，不计算曝光→主页或主页→链接转化率。',
    site:'主页链接点击为已生成短链接的有效访问，不是 TikTok 官方点击数或独立访客。进站及后续测试按该次点击关联、每步去重，转发链接的访问也会计入。跨日到站仍归入点击日；部分日期未覆盖时单独提示。'}},200,{'cache-control':'private, no-store'});
 }catch(error){
  if([400,403].includes(error.statusCode))return errorJson(error.message,error.statusCode);
  console.error(JSON.stringify({event:'psychology-receiving-report-failed',message:String(error.message).slice(0,180)}));
  return errorJson('引流报表暂时读取失败，请刷新重试；缺失数据不会记为零。',503);
 }
}
