import {checkPublishEntries} from './psychology-publish-checks.js';
import {hasPsychologyModule} from './psychology-permissions.js';
import { signalDesk } from './signal-desk.js';
import { assertOfficialPublishAccess } from './official.js';
import { json, readJson } from './http.js';
import { loadAutoUser } from './psychology-auto-publish.js';
import { normalizeOneProject } from '../../scripts/psychology-auto-publish.js';
const BASE='/api/psychology-tiktok-one';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export function assertPsychologyOneUser(user){
 if(!hasPsychologyModule(user,'psychology-publish'))fail('需要心理学自动发布权限才能使用 TikTok One 挂锚点发布。',403);
}
export async function ensurePsychologyOneMembers(env,user,config,accounts=[]){
 if(!config.tiktokOne)return;
 assertPsychologyOneUser(user);
 await checkPublishEntries([...new Set(config.connectionIds)],async creatorConnectionId=>{
  const account=accounts.find(a=>String(a.id||a.connectionId)===creatorConnectionId);
  const name=account?.username||account?.displayName||creatorConnectionId;
  try{
   const data=await signalDesk(env,env.DB,'/api/v1/tiktok-one',{method:'POST',body:{...config.tiktokOne,creatorConnectionId,action:'ensure'},signal:AbortSignal.timeout(120000)});
   if(data.joined!==true)fail('未确认加入当前项目。',409);
  }catch(error){fail(`账号 ${name} 加入项目 ${config.tiktokOne.campaignId} 失败：${error.message}`,error.statusCode||502);}
 });
}
export async function handlePsychologyOne(request,env,url,session){
 if(url.pathname!==BASE)return null;
 assertPsychologyOneUser(session?.user);
 if(request.method==='POST'){
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)fail('请求来源无效。',403);
  const user=await loadAutoUser(env.DB,session?.user?.username),input=await readJson(request);
  if(!input||input.action!=='ensure')fail('不支持此操作。');
  const project=normalizeOneProject(input),creatorConnectionId=String(input.creatorConnectionId||'').trim();
  if(!creatorConnectionId||creatorConnectionId.length>100)fail('请选择发布账号。');
  const scoped=await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:[creatorConnectionId]});
  await ensurePsychologyOneMembers(env,user,{tiktokOne:project,connectionIds:[creatorConnectionId]},scoped.accounts);
  return json({joined:true,joinStatus:'success',creatorConnectionId,campaignId:project.campaignId});
 }
 if(request.method!=='GET')fail('不支持此请求。',405);
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
  try{return json(await signalDesk(env,env.DB,'/api/v1/tiktok-one?'+new URLSearchParams({...project,resource:'membership',creatorConnectionId,refresh:input.refresh==='1'?'1':'0'}),{signal:AbortSignal.timeout(25000)}));}
  catch(error){if(['TimeoutError','AbortError'].includes(error.name))fail('账号检查超时，请点击“重新检查账号”重试。',504);throw error;}
 }
 fail('不支持此查询。');
}
