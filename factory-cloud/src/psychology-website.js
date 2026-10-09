import {readWebsiteFunnel} from './psychology-website-funnel.js';
import {createWebsiteLinks,readWebsiteLinks} from './psychology-website-links.js';
import { json, errorJson } from './http.js';
import { handleConversionCampaign } from './psychology-conversion.js';
import { websiteWindow, websitePage, readWebsiteAnalytics } from './psychology-website-data.js';

export const WEBSITE_ANALYTICS_PATH='/api/psychology-website';
export async function handlePsychologyWebsite(request,env,url,session,{now=Date.now()}={}){
 if(url.pathname===WEBSITE_ANALYTICS_PATH+'/receiving')return (await import('./psychology-imported-photos.js')).handleImportedPhotos(request,env,url,session,{now,website:true});
 const creating=url.pathname===WEBSITE_ANALYTICS_PATH+'/links';
 if(url.pathname!==WEBSITE_ANALYTICS_PATH&&!creating)return null;
 if(!session?.user)return errorJson('请先登录。',401);
 if(request.method!==(creating?'POST':'GET'))return errorJson('不支持此操作。',405);
 if(creating&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return errorJson('请求来源无效。',403);
 try{
  // Reuse fresh module/project/owner checks, including revoked account grants.
  const contextUrl=new URL('/api/psychology-autopilot/conversion',url);
  const response=await handleConversionCampaign(new Request(contextUrl),env,contextUrl,session.user,{now,module:'psychology-website'});
  if(!response.ok)return response;
  const context=await response.json();
  const campaign=await env.DB.prepare('SELECT owner FROM psychology_conversion_campaigns WHERE project_key=?').bind(context.projectId).first();
  if(!campaign||campaign.owner!==session.user.username)return errorJson('仅心理学转化项目负责人可查看全站订单与流量。',403);
  const receiving=await env.DB.prepare('SELECT config_json,enabled FROM psychology_imported_photo_settings WHERE owner=?').bind(session.user.username).first();
  if(receiving){const cfg=JSON.parse(receiving.config_json),receivers=cfg.receivers||[];if(cfg.receiversConfigured||receivers.length){context.config={...context.config,receivers,enabled:Boolean(receiving.enabled)};context.summary={...context.summary,selectedReceivers:receivers.length};}}
  if(creating)return json(await createWebsiteLinks(env.DB,context,now));
  const window=websiteWindow(url.searchParams,now);
  const paging={sourcePage:websitePage(url.searchParams,'sourcePage'),orderPage:websitePage(url.searchParams,'orderPage')};
  if(!env.DEEP_PERSONA_DB)return errorJson('独立站数据尚未连接。',503);
  const source=env.DEEP_PERSONA_DB.withSession?env.DEEP_PERSONA_DB.withSession('first-primary'):env.DEEP_PERSONA_DB;
  const [data,links]=await Promise.all([readWebsiteAnalytics(source,window,context,paging,now),readWebsiteLinks(env.DB,context,window)]);
  data.funnel=await readWebsiteFunnel(env.DB,source,context,links,window,now);
  const byId=new Map(links.map(link=>[link.connectionId,link]));
  data.receivers=data.receivers.map(account=>({...account,trackingUrl:byId.get(account.connectionId)?.trackingUrl||null}));
  const accounts=new Map(data.accounts.map(account=>[account.connectionId,account]));
  for(const link of links){
   const account=context.accounts.find(a=>a.connectionId===link.connectionId);
   const value=accounts.get(link.connectionId)||{connectionId:link.connectionId,username:account.username,name:account.name,started:0,finished:0,paidSessions:0,orders:0};
   accounts.set(link.connectionId,{...value,linkVisits:link.visits});
  }
  data.accounts=[...accounts.values()].map(account=>({...account,linkVisits:byId.has(account.connectionId)?account.linkVisits:null}));
  data.links={rows:links,visits:links.reduce((sum,row)=>sum+row.visits,0),filtered:links.reduce((sum,row)=>sum+row.filtered,0)};
  data.definitions.linkVisits='短链接访问从创建后开始统计，过滤已识别机器人与预加载，重复访问仍计数；不是 TikTok 官方点击量、独立访客或成功进站量。未经过短链接的历史访问无法补算。';
  return json(data,200,{'Cache-Control':'private, no-store'});
 }catch(error){
  if(error.statusCode===400)return errorJson(error.message,400);
  console.error(JSON.stringify({event:'psychology-website-read-failed',message:String(error.message).slice(0,240)}));
  return errorJson('独立站数据暂时读取失败，请稍后刷新；未将缺失数据记为零。',503);
 }
}
