import { signalDesk } from './signal-desk.js';
import { assertOfficialPublishAccess } from './official.js';
import { json } from './http.js';
import { normalizeOneProject } from '../../scripts/psychology-auto-publish.js';
const BASE='/api/psychology-tiktok-one';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export function assertPsychologyOneUser(user){
 if(!user||user.role!=='admin'||user.active===false||!user.sidebarModules?.includes('psychology-publish'))fail('仅心理学发布管理员可以使用 TikTok One 挂锚点发布。',403);
}
export async function ensurePsychologyOneMembers(env,user,config,accounts=[]){
 if(!config.tiktokOne)return;
 assertPsychologyOneUser(user);
 for(const creatorConnectionId of config.connectionIds){
  const account=accounts.find(a=>String(a.id||a.connectionId)===creatorConnectionId);
  const name=account?.username||account?.displayName||creatorConnectionId;
  try{
   const data=await signalDesk(env,env.DB,'/api/v1/tiktok-one',{method:'POST',body:{...config.tiktokOne,creatorConnectionId,action:'ensure'},signal:AbortSignal.timeout(120000)});
   if(data.joined!==true)fail('未确认加入当前项目。',409);
  }catch(error){fail(`账号 ${name} 加入项目 ${config.tiktokOne.campaignId} 失败：${error.message}`,error.statusCode||502);}
 }
}
export async function handlePsychologyOne(request,env,url,session){
 if(url.pathname!==BASE)return null;
 assertPsychologyOneUser(session?.user);
 if(request.method!=='GET')fail('此入口仅支持查询。',405);
 const input=Object.fromEntries(url.searchParams);
 const resource=input.resource;
 if(resource==='connections')return json(await signalDesk(env,env.DB,'/api/v1/tiktok-one?resource=connections'));
 if(resource==='projects'){
  const {connectionId,accountId}=normalizeOneProject({...input,campaignId:'1'});
  const page=Number(input.page||1);if(!Number.isInteger(page)||page<1||page>200)fail('项目页码无效。');
  return json(await signalDesk(env,env.DB,'/api/v1/tiktok-one?'+new URLSearchParams({resource,connectionId,accountId,page:String(page),refresh:input.refresh==='1'?'1':'0'})));
 }
 if(resource==='prepare'){
  const project=normalizeOneProject(input),creatorConnectionId=String(input.creatorConnectionId||'');
  await assertOfficialPublishAccess(env,session.user,{module:'psychology',connectionIds:[creatorConnectionId]});
  return json(await signalDesk(env,env.DB,'/api/v1/tiktok-one?'+new URLSearchParams({...project,resource,creatorConnectionId,refresh:input.refresh==='1'?'1':'0'})));
 }
 fail('不支持此查询。');
}
