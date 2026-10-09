import {hasPsychologyModule} from './psychology-permissions.js';
import { json, errorJson, readJson } from './http.js';
import { toPublicUser } from './auth.js';
import { reportAccountScopeSQL } from './official-report-account-scope.js';
import { ensureModuleProjects, findProjectForModule, userAllowedGroupIds } from '../../scripts/official-account-group-store.js';
import { PACIFIC_TIME_ZONE, normalizeTimeZone, nextDay } from '../../scripts/psychology-schedule-time.js';

const BASE='/api/psychology-autopilot/conversion',SITE='https://deeppersonaai.com/';
const parse=(value,fallback={})=>{try{return JSON.parse(value||'');}catch{return fallback;}};
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const idOf=a=>String(a.connectionId||a.id||a.schema||'').replace(/^tiktok:/,'');
const handle=value=>String(value||'').replace(/^@/,'');
const validHandle=value=>/^[a-zA-Z0-9_.]{1,24}$/.test(value);
export function conversionFollowers(profile){
 const value=profile?.followers??profile?.followerCount;
 if(value===null||value===undefined||value===''||typeof value==='boolean')return null;
 const number=Number(value);return Number.isFinite(number)&&number>=0?Math.floor(number):null;
}
async function currentUser(db,user,publish=false,module='psychology-autopilot'){
 if(!user?.username)fail('请先登录。',401);
 const row=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(user.username).first();
 const fresh=row?toPublicUser(row):null;
 if(!(hasPsychologyModule(fresh,module)||(module==='psychology-website'&&fresh?.role==='admin'&&hasPsychologyModule(fresh,'psychology-autopilot')))||(publish&&!fresh.sidebarModules.includes('psychology-publish')))fail('没有转化运营权限。',403);
 return fresh;
}
async function accountScope(db,user,directory){
 const raw=await db.prepare("SELECT value_json FROM factory_kv WHERE key='official-account-groups'").first();
 const store=ensureModuleProjects(parse(raw?.value_json)),project=findProjectForModule(store,'psychology');
 if(!project)fail('没有心理学项目。',403);
 const projectGroups=store.groups.filter(g=>g.projectId===project.id),grant=userAllowedGroupIds(user);
 const groupIds=projectGroups.filter(g=>!grant||grant.has(g.id)).map(g=>g.id),allowed=new Set(groupIds);
 const assigned=await rows(db,`${reportAccountScopeSQL} SELECT allowed.account_key,allowed.current_group,a.profile_json,a.synced_at FROM allowed
  LEFT JOIN official_accounts_latest a ON a.account_key=allowed.account_key`,JSON.stringify(projectGroups.map(g=>g.id)));
 if(!directory){const cache=await db.prepare("SELECT value_json FROM factory_kv WHERE key='psychology-autopilot-account-directory-v1'").first();directory=parse(cache?.value_json,{accounts:[]});}
 const input=Array.isArray(directory)?directory:directory.fullAccounts||directory.accounts||[];
 const metadata=new Map(input.map(a=>[idOf(a),a]));
 const accounts=assigned.filter(a=>allowed.has(a.current_group)).map(row=>{
  const connectionId=row.account_key.replace(/^tiktok:/,''),a=metadata.get(connectionId),profile=parse(row.profile_json);
  const username=handle(a?.username||a?.profile?.username||profile.username),followers=conversionFollowers(profile);
  return {connectionId,username,name:String(a?.displayName||a?.label||username||connectionId),groupId:row.current_group,
   groupName:projectGroups.find(g=>g.id===row.current_group)?.name||row.current_group,followers,syncedAt:Number(row.synced_at)||0,
   canPublish:Boolean(a)&&(!Array.isArray(a.scopes)||a.scopes.includes('video.publish')),candidate:validHandle(username)&&followers!==null&&followers>=1000};
 }).sort((a,b)=>a.connectionId.localeCompare(b.connectionId));
 return {project,accounts,groupIds};
}
export function balanceConversionRoutes(accounts,receivers,previous={}){
 const ids=[...new Set(accounts.map(a=>typeof a==='string'?a:a.connectionId))].sort(),targets=[...new Set(receivers.map(a=>typeof a==='string'?a:a.connectionId))].sort();
 if(!targets.length)return {};
 const valid=new Set(targets),counts=new Map(targets.map(id=>[id,0])),result={};
 for(const id of ids){const to=valid.has(id)?id:valid.has(previous[id])?previous[id]:null;if(to){result[id]=to;counts.set(to,counts.get(to)+1);}}
 for(const id of ids){if(result[id])continue;const to=targets.reduce((best,value)=>counts.get(value)<counts.get(best)?value:best,targets[0]);result[id]=to;counts.set(to,counts.get(to)+1);}
 return result;
}
export function conversionCTA(snapshot){
 if(snapshot?.objective!=='conversion'||snapshot.linkReady!==true||!validHandle(handle(snapshot.username))||!snapshot.receiverConnectionId)fail('转化承接账号或主页测试链接待配置。');
 return snapshot.connectionId===snapshot.receiverConnectionId
  ?'For your full result, tap the link in my bio to take the test.'
  :`For your full result, visit @${handle(snapshot.username)} and tap the link in their bio to take the test.`;
}
export function applyConversionCopy(plan,snapshot){
 const cta=conversionCTA(snapshot);
 if(plan?.conversion){
  if(plan.conversion.cta===cta&&plan.conversion.receiverConnectionId===snapshot.receiverConnectionId&&plan.conversion.connectionId===snapshot.connectionId&&plan.conversion.revision===snapshot.revision)return structuredClone(plan);
  fail('此文案已绑定其他转化承接账号。');
 }
 if(!Array.isArray(plan?.scenes)||plan.scenes.length<1||plan.scenes.length>6)fail('转化图文必须保留1–6张卡片。');
 const result=structuredClone(plan),caption=String(result.caption||'').trim();
 result.caption=caption.endsWith(cta)?caption:[caption,cta].filter(Boolean).join('\n\n');
 if(result.caption.length>2200)fail('转化引导使文案超过2200字，请缩短原文后重试。');
 result.conversion={...structuredClone(snapshot),cta,placement:"caption-only"};return result;
}
async function versionsFor(db,project,owner){return rows(db,'SELECT * FROM psychology_conversion_versions WHERE project_key=? AND owner=? ORDER BY revision',project,owner);}
function publicVersion(row){return row?{revision:row.revision,enabled:Boolean(row.enabled),effectiveAt:row.effective_at,timeZone:row.time_zone,websiteUrl:row.website_url,
 receivers:parse(row.receivers_json,[]),routes:parse(row.routes_json),objective:'conversion'}:null;}
async function boundary(db,scope,owner,now,zone){
 const groups=JSON.stringify(scope.groupIds),ids=JSON.stringify(scope.accounts.map(a=>a.connectionId));
 const max=await db.prepare(`SELECT max(reserved) last_reserved FROM (
  SELECT s.slot_at reserved FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id WHERE p.owner=? AND p.group_id IN (SELECT value FROM json_each(?))
  UNION ALL SELECT i.schedule_at*1000 reserved FROM psychology_publish_items i LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id
  WHERE i.connection_id IN (SELECT value FROM json_each(?)) AND (i.deleted_at=0 OR g.status='submitting' OR COALESCE(g.request_json,'{}')<>'{}'))`).bind(owner,groups,ids).first();
 return nextDay(Math.max(now,Number(max?.last_reserved)||0),zone);
}
async function responseData(db,scope,head,versions,now){
 const latest=versions.at(-1),active=versions.filter(v=>v.effective_at<=now).at(-1),zone=latest?.time_zone||PACIFIC_TIME_ZONE;
 return {projectId:scope.project.id,revision:head?.revision||0,config:publicVersion(latest),active:publicVersion(active),
  websiteUrl:latest?.website_url||SITE,nextEffectiveAt:await boundary(db,scope,head?.owner||'',now,zone),accounts:scope.accounts,
  summary:{accounts:scope.accounts.length,eligibleReceivers:scope.accounts.filter(a=>a.candidate&&a.canPublish).length,selectedReceivers:parse(latest?.receivers_json,[]).length},
  templates:{ordinary:'For your full result, visit @HANDLE and tap the link in their bio to take the test.',receiver:'For your full result, tap the link in my bio to take the test.'}};
}
export async function handleConversionCampaign(request,env,url,user,{directory,now=Date.now(),module='psychology-autopilot'}={}){
 if(url.pathname!==BASE)return null;
 try{
  user=await currentUser(env.DB,user,request.method==='PATCH',request.method==='GET'?module:'psychology-autopilot');
  if(request.method==='PATCH'&&request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)fail('转化设置请求来源无效。',403);
  const db=env.DB,scope=await accountScope(db,user,directory),head=await db.prepare('SELECT * FROM psychology_conversion_campaigns WHERE project_key=?').bind(scope.project.id).first();
  if(head&&head.owner!==user.username)fail('此项目的转化运营由其他管理员管理。',403);
  const versions=await versionsFor(db,scope.project.id,user.username);
  if(request.method==='GET')return json(await responseData(db,scope,head||{owner:user.username},versions,now));
  if(request.method!=='PATCH')return errorJson('不支持此操作。',405);
  const body=await readJson(request);
  if(!Number.isInteger(body.revision)||body.revision!==(head?.revision||0))fail('转化配置已改变，请刷新后重试。',409);
  if(typeof body.enabled!=='boolean'||!Array.isArray(body.receivers))fail('请提供转化目标与承接账号。');
  if(body.receivers.length>60||new Set(body.receivers.map(a=>a?.connectionId)).size!==body.receivers.length)fail('承接账号重复或数量超过60个。');
  let site;try{site=new URL(body.websiteUrl||versions.at(-1)?.website_url||SITE);}catch{fail('独立站网址无效。');}
  if(site.protocol!=='https:'||site.username||site.password)fail('独立站需要不含凭据的 HTTPS 网址。');
  const receivers=body.receivers.map(selected=>{
   const account=scope.accounts.find(a=>a.connectionId===selected?.connectionId);
   if(!account||!account.canPublish)fail('承接账号已移出项目、失去权限或不可发布。',403);
   if(!account.candidate)fail('承接账号需要已同步的至少1000粉丝和有效用户名。');
   if(selected.linkReady!==true)fail('请确认每个承接账号已设置主页测试链接。');
   return {connectionId:account.connectionId,username:account.username,linkReady:true};
  });
  const prior=versions.at(-1),zone=normalizeTimeZone(prior?.time_zone||PACIFIC_TIME_ZONE);
  const effectiveAt=Math.max(await boundary(db,scope,user.username,now,zone),prior?.effective_at||0),revision=body.revision+1;
  const routes=balanceConversionRoutes(scope.accounts.filter(a=>a.canPublish),receivers,parse(prior?.routes_json));
  const groups=JSON.stringify(scope.groupIds),ids=JSON.stringify(scope.accounts.map(a=>a.connectionId));
  const statements=[db.prepare('INSERT INTO psychology_conversion_campaigns(project_key,owner,revision,created_at,updated_at) VALUES(?,?,0,?,?) ON CONFLICT(project_key) DO NOTHING').bind(scope.project.id,user.username,now,now),
   db.prepare(`INSERT INTO psychology_conversion_versions(project_key,revision,owner,enabled,effective_at,time_zone,website_url,receivers_json,routes_json,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,? FROM psychology_conversion_campaigns c WHERE c.project_key=? AND c.owner=? AND c.revision=?
    AND NOT EXISTS(SELECT 1 FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id WHERE p.owner=? AND p.group_id IN (SELECT value FROM json_each(?)) AND s.slot_at>=?)
    AND NOT EXISTS(SELECT 1 FROM psychology_publish_items i LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id WHERE i.connection_id IN (SELECT value FROM json_each(?)) AND i.schedule_at*1000>=? AND (i.deleted_at=0 OR g.status='submitting' OR COALESCE(g.request_json,'{}')<>'{}'))`)
    .bind(scope.project.id,revision,user.username,Number(body.enabled),effectiveAt,zone,site.href,JSON.stringify(receivers),JSON.stringify(routes),now,scope.project.id,user.username,body.revision,user.username,groups,effectiveAt,ids,effectiveAt),
   db.prepare(`UPDATE psychology_conversion_campaigns SET revision=(SELECT v.revision FROM psychology_conversion_versions v WHERE v.project_key=psychology_conversion_campaigns.project_key AND v.revision=?),updated_at=? WHERE project_key=? AND owner=? AND revision=?`).bind(revision,now,scope.project.id,user.username,body.revision)];
  let saved;try{saved=await db.batch(statements);}catch(error){if(/unique|constraint/i.test(error.message))fail('转化配置已改变，请刷新后重试。',409);throw error;}
  if(!saved[1]?.meta?.changes||!saved[2]?.meta?.changes)fail('排期或转化配置已改变，请刷新后重试。',409);
  return json(await responseData(db,scope,{owner:user.username,revision},await versionsFor(db,scope.project.id,user.username),now));
 }catch(error){return errorJson(error.message,error.statusCode||500);}
}
// Slot times are milliseconds. Time in the key allows batches across a boundary.
export async function loadConversionAssignments(db,owner,connectionIds,slots,{directory}={}){
 const result=new Map();if(!connectionIds.length||!slots.length)return result;
 const times=[...new Set(slots.map(s=>Number(typeof s==='number'?s:s.slotAt??s.at??s.scheduleAt)).filter(Number.isFinite))];
 let user;try{user=await currentUser(db,{username:owner},true);}catch(error){
  // An enabled conversion campaign must never silently become growth after
  // its administrator loses operating permission.
  const saved=await rows(db,'SELECT * FROM psychology_conversion_versions WHERE owner=? ORDER BY revision',owner);
  for(const at of times){const latest=new Map();for(const row of saved)if(row.effective_at<=at)latest.set(row.project_key,row);
   if([...latest.values()].some(row=>row.enabled))throw error;}
  return result;
 }
 const scope=await accountScope(db,user,directory),versions=await versionsFor(db,scope.project.id,owner),accounts=new Map(scope.accounts.map(a=>[a.connectionId,a]));
 for(const at of times){const row=versions.filter(v=>v.effective_at<=at).at(-1);if(!row?.enabled)continue;
  const routes=parse(row.routes_json),receivers=new Map(parse(row.receivers_json,[]).map(a=>[a.connectionId,a]));
  for(const connectionId of connectionIds){
   const targetId=routes[connectionId],receiver=receivers.get(targetId),account=accounts.get(connectionId),current=accounts.get(targetId);
   const snapshot={objective:'conversion',projectId:scope.project.id,connectionId,revision:row.revision,effectiveAt:row.effective_at,websiteUrl:row.website_url,owner,allowedGroupIds:scope.groupIds,receiverGroupId:current?.groupId||'',receiverConnectionId:targetId||'',username:receiver?.username||'',linkReady:receiver?.linkReady===true};
   if(!account?.canPublish||!current?.canPublish||!current.candidate||!receiver?.linkReady||current.username!==receiver.username)snapshot.error='转化承接账号权限、千粉状态或主页测试链接待确认。';
   else snapshot.cta=conversionCTA(snapshot);
   result.set(`${connectionId}:${at}`,snapshot);
  }
 }
 return result;
}

// The revision subquery deliberately yields NULL on a racing campaign edit.
// NOT NULL rejects the entire allocation transaction, including its jobs.
export function conversionSnapshotStatement(db,item,conversion,now){
 const at=Number(item.scheduleAt)*1000;
 return db.prepare(`${reportAccountScopeSQL}
  INSERT INTO psychology_conversion_allocations(item_id,project_key,revision,connection_id,receiver_connection_id,schedule_at,base_copy_hash,final_copy_hash,route_json,created_at)
  VALUES(?,?,
   (SELECT v.revision FROM psychology_conversion_versions v WHERE v.project_key=? AND v.owner=? AND v.revision=? AND v.enabled=1 AND v.effective_at<=?
    AND NOT EXISTS(SELECT 1 FROM psychology_conversion_versions newer WHERE newer.project_key=v.project_key AND newer.effective_at<=? AND newer.revision>v.revision)
    AND EXISTS(SELECT 1 FROM allowed WHERE account_key=? AND current_group=?)),
   ?,?,?,?,?,?,?)`).bind(JSON.stringify(conversion.allowedGroupIds||[]),item.id,conversion.projectId,conversion.projectId,conversion.owner,conversion.revision,at,at,
   'tiktok:'+conversion.receiverConnectionId,conversion.receiverGroupId,item.connectionId,conversion.receiverConnectionId,at,
   conversion.baseCopyHash||'',conversion.finalCopyHash||'',JSON.stringify(conversion),now);
}
export async function updateConversionCopyHash(db,itemId,hash){
 return db.prepare('UPDATE psychology_conversion_allocations SET final_copy_hash=? WHERE item_id=?').bind(hash,itemId).run();
}
