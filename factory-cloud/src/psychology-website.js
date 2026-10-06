import { json, errorJson } from './http.js';
import { handleConversionCampaign } from './psychology-conversion.js';
import { websiteWindow, websitePage, readWebsiteAnalytics } from './psychology-website-data.js';

export const WEBSITE_ANALYTICS_PATH='/api/psychology-website';
export async function handlePsychologyWebsite(request,env,url,session,{now=Date.now()}={}){
 if(url.pathname!==WEBSITE_ANALYTICS_PATH)return null;
 if(!session?.user)return errorJson('请先登录。',401);
 if(request.method!=='GET')return errorJson('此接口只允许读取网站数据。',405);
 try{
  // Reuse fresh admin/module/project/owner checks, including revoked account grants.
  const contextUrl=new URL('/api/psychology-autopilot/conversion',url);
  const response=await handleConversionCampaign(new Request(contextUrl),env,contextUrl,session.user,{now});
  if(!response.ok)return response;
  const context=await response.json();
  const campaign=await env.DB.prepare('SELECT owner FROM psychology_conversion_campaigns WHERE project_key=?').bind(context.projectId).first();
  if(!campaign||campaign.owner!==session.user.username)return errorJson('仅心理学转化项目负责人可查看全站订单与流量。',403);
  const window=websiteWindow(url.searchParams,now);
  const paging={sourcePage:websitePage(url.searchParams,'sourcePage'),orderPage:websitePage(url.searchParams,'orderPage')};
  if(!env.DEEP_PERSONA_DB)return errorJson('独立站数据尚未连接。',503);
  const source=env.DEEP_PERSONA_DB.withSession?env.DEEP_PERSONA_DB.withSession('first-primary'):env.DEEP_PERSONA_DB;
  return json(await readWebsiteAnalytics(source,window,context,paging,now),200,{'Cache-Control':'private, no-store'});
 }catch(error){
  if(error.statusCode===400)return errorJson(error.message,400);
  console.error(JSON.stringify({event:'psychology-website-read-failed',message:String(error.message).slice(0,240)}));
  return errorJson('独立站数据暂时读取失败，请稍后刷新；未将缺失数据记为零。',503);
 }
}
