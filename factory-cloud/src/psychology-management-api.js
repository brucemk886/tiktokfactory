import {json,errorJson,sha256Hex,randomToken} from './http.js';
import {toPublicUser} from './auth.js';
import {handleOfficial,loadGroupStore} from './official.js';
import {handlePsychologyOperations} from './psychology-operations.js';
import {handlePsychologyAutopilot} from './psychology-autopilot.js';
import {styleApi} from './psychology-managed-styles.js';
import {scopeOfficialAccess} from '../../scripts/official-account-group-store.js';
import {operationsWindow} from '../../scripts/psychology-operations.js';
import {resolveReportWindow,parseShanghaiDate} from '../../scripts/official-group-report.js';
export const MANAGEMENT_API='/api/integrations/psychology/manage';
const INTERNAL='/api/psychology-management';
export const MANAGEMENT_MODULES={effects:'psychology-effects',operations:'psychology-ops-report',autopilot:'psychology-autopilot',styles:'psychology-publish-designs'};
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export async function readManagementBody(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('请使用 application/json。',415);
 const limit=128*1024;
 if(Number(request.headers.get('content-length'))>limit)fail('请求最多 128 KiB。',413);
 if(!request.body)fail('请提交 JSON 对象。');
 const reader=request.body.getReader(),chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('请求最多 128 KiB。',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('JSON 格式无效。');}
 if(!body||typeof body!=='object'||Array.isArray(body))fail('请提交 JSON 对象。');return body;
}
function only(body,fields){if(Object.keys(body).some(k=>!fields.includes(k)))fail('包含未知或不可修改字段。');}
function assertModule(user,module){if(user?.role!=='admin'||!user.sidebarModules?.includes(MANAGEMENT_MODULES[module]))fail('没有此心理学模块的管理权限。',403);}
async function actor(request,db){
 const token=request.headers.get('authorization')?.match(/^Bearer (psy_manage_\S+)$/i)?.[1];
 if(!token||token.length>200)fail('请提供心理学管理 Bearer 密钥。',401);
 const row=await db.prepare('SELECT u.*,k.scopes_json FROM psychology_management_keys k JOIN factory_users u ON u.id=k.owner_id WHERE k.token_hash=? AND u.active=1 AND u.role=\'admin\'').bind(await sha256Hex(token)).first();
 if(!row)fail('管理密钥失效或所属管理员不可用。',401);
 return {user:toPublicUser(row),scopes:JSON.parse(row.scopes_json)};
}
async function keys(request,db,user){
 if(user?.role!=='admin')fail('仅管理员可管理 API 密钥。',403);
 const available=Object.keys(MANAGEMENT_MODULES).filter(k=>user.sidebarModules?.includes(MANAGEMENT_MODULES[k]));
 if(!available.length)fail('没有这些心理学模块的权限。',403);
 if(request.method==='GET'){
  const row=await db.prepare('SELECT token_prefix,scopes_json,created_at FROM psychology_management_keys WHERE owner_id=?').bind(user.id).first();
  return json({configured:!!row,prefix:row?.token_prefix||'',scopes:JSON.parse(row?.scopes_json||'[]'),createdAt:row?.created_at||0,available,endpoint:MANAGEMENT_API});
 }
 if(request.method==='DELETE'){await db.prepare('DELETE FROM psychology_management_keys WHERE owner_id=?').bind(user.id).run();return json({ok:true});}
 if(request.method!=='POST')fail('不支持此密钥操作。',405);
 const body=await readManagementBody(request);only(body,['scopes']);
 const scopes=body.scopes??available.map(m=>m+':read');
 if(!Array.isArray(scopes)||!scopes.length||scopes.some(s=>typeof s!=='string'||!available.some(m=>s===m+':read'||s===m+':write')))fail('密钥范围无效或超过当前页面权限。');
 const token='psy_manage_'+randomToken(32),stamp=Date.now();
 await db.prepare('INSERT INTO psychology_management_keys(owner_id,token_hash,token_prefix,scopes_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash,token_prefix=excluded.token_prefix,scopes_json=excluded.scopes_json,created_at=excluded.created_at').bind(user.id,await sha256Hex(token),token.slice(0,18),JSON.stringify([...new Set(scopes)]),stamp).run();
 return json({apiKey:token,scopes,createdAt:stamp},201);
}
async function reportQuery(db,user,module,input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('query 须为查询参数对象。');
 const fields=module==='effects'?['period','group','from','to','date']:['period','group','from','to','media','panel','page','sort','filter','q','mode','key'];
 only(input,fields);
 if(Object.values(input).some(v=>!['string','number'].includes(typeof v)||String(v).length>2000))fail('查询参数格式无效。');
 const params=new URLSearchParams(Object.entries(input).map(([k,v])=>[k,String(v)]));
 const group=params.get('group');
 if(group&&!(scopeOfficialAccess({accounts:[]},await loadGroupStore(db),user,'psychology').groups||[]).some(g=>g.id===group))fail('没有这个心理学分组的权限。',403);
 if(module==='operations'){
  try{operationsWindow(params);}catch(error){fail(error.message);}
  if(params.has('page')&&(!Number.isInteger(Number(params.get('page')))||Number(params.get('page'))<1||Number(params.get('page'))>1000000))fail('page 须为 1–1000000 整数。');
  if(!['photo','video'].includes(params.get('media')||'photo')||!['overview','accounts','content','strategy','details','batches','groups'].includes(params.get('panel')||'overview'))fail('报表 media/panel 无效。');
 }else{
  if(params.has('period')&&!['today','yesterday','7d','30d','week','custom'].includes(params.get('period')))fail('数据概览 period 无效。');
  if(params.get('period')==='custom'&&(!params.get('from')||!params.get('to')))fail('自定义周期须提供 from 和 to。');
  if(params.get('from')&&params.get('to')&&params.get('from')>params.get('to'))fail('开始日期不能晚于结束日期。');
  for(const k of ['from','to','date'])if(params.has(k)&&!parseShanghaiDate(params.get(k)))fail('日期须为 YYYY-MM-DD。');
  resolveReportWindow({period:params.get('period')||'today',now:Date.now(),fromKey:params.get('from')||params.get('date')||'',toKey:params.get('to')||params.get('from')||params.get('date')||''});
 }
 return Object.fromEntries(params);
}
const publicView=row=>({id:row.id,name:row.name,module:row.module,query:JSON.parse(row.query_json),revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});
async function views(db,user,module,id,method,input){
 if(method==='GET'){
  if(id){const row=await db.prepare('SELECT * FROM psychology_report_views WHERE id=? AND owner=? AND module=?').bind(id,user.username,module).first();if(!row)fail('报表方案不存在。',404);return json({item:publicView(row)});}
  return json({items:(await db.prepare('SELECT * FROM psychology_report_views WHERE owner=? AND module=? ORDER BY created_at DESC,id LIMIT 100').bind(user.username,module).all()).results.map(publicView)});
 }
 if(!['POST','PATCH'].includes(method)||((method==='POST')===!!id))fail('请使用 POST 新增或 PATCH /方案ID 修改。',405);
 only(input,method==='POST'?['name','query','requestId']:['name','query','revision']);
 let old=null,hash='';
 if(method==='POST'){
  if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))fail('新增方案须提供 UUID requestId。');
  id='view-'+(await sha256Hex(user.username+':'+module+':'+input.requestId)).slice(0,32);
  hash=await sha256Hex(JSON.stringify([input.name,Object.entries(input.query||{}).sort()]));
  old=await db.prepare('SELECT * FROM psychology_report_views WHERE id=? AND owner=? AND module=?').bind(id,user.username,module).first();
  if(old){if(old.creation_hash!==hash)fail('requestId 已用于不同方案。',409);return json({duplicate:true,item:publicView(old)});}
 }else{
  old=await db.prepare('SELECT * FROM psychology_report_views WHERE id=? AND owner=? AND module=?').bind(id,user.username,module).first();
  if(!old)fail('报表方案不存在。',404);
  if(!Number.isInteger(input.revision)||input.revision!==old.revision)fail('revision 缺失或方案已修改。',409);
  if(input.name===undefined&&input.query===undefined)fail('请提供修改字段。');
 }
 const name=input.name??old?.name;
 if(typeof name!=='string'||!name.trim()||name.length>100)fail('name 须为 1–100 字符。');
 const query=await reportQuery(db,user,module,input.query??JSON.parse(old?.query_json||'{}')),now=Date.now();
 let changed;
 if(old)changed=await db.prepare('UPDATE psychology_report_views SET name=?,query_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?').bind(name.trim(),JSON.stringify(query),now,id,user.username,old.revision).run();
 else changed=await db.prepare('INSERT INTO psychology_report_views(id,owner,module,name,query_json,creation_hash,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM psychology_report_views WHERE owner=? AND module=?)<100 ON CONFLICT(id) DO NOTHING').bind(id,user.username,module,name.trim(),JSON.stringify(query),hash,now,now,user.username,module).run();
 if(!changed.meta?.changes)fail('方案已变化或已达 100 个上限，请重新读取。',409);
 return json({item:publicView(await db.prepare('SELECT * FROM psychology_report_views WHERE id=?').bind(id).first())},old?200:201);
}
export async function handlePsychologyManagement(request,env,url,session){
 const external=url.pathname===MANAGEMENT_API||url.pathname.startsWith(MANAGEMENT_API+'/');
 if(!external&&url.pathname!==INTERNAL+'/api-key'&&url.pathname!==INTERNAL+'/styles')return null;
 try{
  let user,scopes;
  if(external)({user,scopes}=await actor(request,env.DB));
  else{
   user=session?.user;if(!user)fail('请先登录。',401);
   if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)fail('不允许跨站修改。',403);
   if(url.pathname===INTERNAL+'/api-key')return await keys(request,env.DB,user);
   assertModule(user,'styles');if(request.method!=='GET')fail('请使用外部管理 API 修改样式。',405);
   return await styleApi(env.DB,user,'','GET');
  }
  const parts=url.pathname.slice(MANAGEMENT_API.length).split('/').filter(Boolean),module=parts.shift();
  if(!Object.hasOwn(MANAGEMENT_MODULES,module))fail('模块不存在，使用 effects/operations/autopilot/styles。',404);
  assertModule(user,module);
  if(!scopes.includes(module+':'+(request.method==='GET'?'read':'write')))fail('密钥未授权此模块的'+(request.method==='GET'?'读取':'写入')+'。',403);
  if(!['GET','POST','PATCH'].includes(request.method))fail('只支持 GET/POST/PATCH。',405);
  const body=request.method==='GET'?null:await readManagementBody(request);
  if(module==='styles'){
   if(parts.length>1)fail('样式路径不存在。',404);
   return await styleApi(env.DB,user,parts[0]||'',request.method,body);
  }
  if(module==='effects'||module==='operations'){
   if(parts[0]==='views'&&parts.length<=2)return await views(env.DB,user,module,parts[1]||'',request.method,body);
   if(parts.length||request.method!=='GET')fail('统计数据只读；新增/修改查询方案请使用 /views。',405);
   let query=Object.fromEntries(url.searchParams),saved={};
   if(query.viewId){const row=await env.DB.prepare('SELECT query_json FROM psychology_report_views WHERE id=? AND owner=? AND module=?').bind(query.viewId,user.username,module).first();if(!row)fail('报表方案不存在。',404);saved=JSON.parse(row.query_json);delete query.viewId;}
   query=await reportQuery(env.DB,user,module,{...saved,...query});
   const dest=new URL(module==='effects'?'/api/official-tiktok/ops-report':'/api/psychology-operations',url.origin);dest.search=new URLSearchParams(query).toString();
   if(module==='effects')dest.searchParams.set('module','psychology');
   return await (module==='effects'?handleOfficial:handlePsychologyOperations)(new Request(dest),env,dest,{user});
  }
  // Only these explicit operations are delegated; there is no arbitrary internal-route proxy.
  if(!user.sidebarModules.includes('psychology-publish')&&request.method!=='GET')fail('自动运营写入还需要自动发布权限。',403);
  const suffix=parts.join('/');
  if(suffix&&!/^pilot-[a-f0-9-]{36}(?:\/(?:schedule|impact|slots\/\d+|accounts\/[^/]+))?$/.test(suffix))fail('自动运营路径不存在。',404);
  if(!suffix&&request.method==='PATCH')fail('请指定运营 ID。',405);
  if(suffix&&request.method==='POST')fail('不提供外部立即执行接口。',405);
  if(body){
   const fields=!suffix?['requestId','groupId','strategy','days','slots','startNow']:suffix.endsWith('/schedule')?['revision','slots']:suffix.includes('/accounts/')?['revision','status']:['revision','status','stopPending','strategy','endsAt'];
   only(body,fields);
   if(suffix&&!fields.some(k=>k!=='revision'&&Object.hasOwn(body,k)))fail('请提交至少一个修改字段。');
  }
  const dest=new URL('/api/psychology-autopilot'+(suffix?'/'+suffix:''),url.origin);dest.search=url.search;
  if([...dest.searchParams.keys()].some(k=>!['period','page','pageSize','refreshGroups','account'].includes(k)))fail('自动运营查询参数无效。');
  const single=request.method==='GET'&&parts.length===1;
  if(single)dest.pathname='/api/psychology-autopilot';
  const forward=new Request(dest,{method:request.method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  const response=await handlePsychologyAutopilot(forward,env,dest,{user},{external:true,pilotId:single?parts[0]:''});
  if(single&&response.ok){const data=await response.json();if(!data.pilots.length)fail('自动运营不存在或没有权限。',404);return json({item:data.pilots[0],window:data.window});}
  return response;
 }catch(error){return errorJson(error.statusCode?error.message:'心理学管理 API 操作失败，请稍后重试。',error.statusCode||500);}
}
