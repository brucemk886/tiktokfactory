import {json,errorJson,sha256Hex,randomToken} from './http.js';
import {toPublicUser} from './auth.js';
import {FACTORY_API,FACTORY_API_ADMIN,CATALOG,allowed,publicCatalog} from './factory-api-catalog.js';
import {handlePsychologyManagement,readManagementBody,MANAGEMENT_MODULES} from './psychology-management-api.js';
import {handlePsychologyTopicBank} from './psychology-topic-bank.js';
import {handleCopyIntegration} from './psychology-copy-integration.js';
import {handlePsychologyCreative} from './psychology-creative.js';
import {handlePsychologyPeerHits} from './psychology-peer-hits.js';
import {handlePsychologyAutoPublish} from './psychology-auto-publish.js';
import {handlePsychologyOne} from './psychology-tiktok-one.js';
import {handleOfficial} from './official.js';
import {handlePhotoFactory} from './photo-factory.js';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>{if(!object(x)||Object.keys(x).some(k=>!keys.includes(k)))fail('包含未知字段或对象格式无效。');};
const canonical=x=>Array.isArray(x)?x.map(canonical):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
async function authenticate(request,db){
 const token=request.headers.get('authorization')?.match(/^Bearer (fac_api_\S+)$/i)?.[1];
 if(!token||token.length>200)fail('请提供项目统一 Bearer API 密钥。',401);
 const row=await db.prepare("SELECT u.* FROM factory_ai_keys k JOIN factory_users u ON u.id=k.owner_id WHERE k.id='project' AND k.token_hash=? AND u.active=1 AND u.role='admin'").bind(await sha256Hex(token)).first();
 if(!row)fail('项目密钥无效、已撤销或所属管理员不可用。',401);
 return toPublicUser(row);
}
function entryFor(user,module,action){
 if(typeof module!=='string'||!Object.hasOwn(CATALOG,module)||typeof action!=='string'||!Object.hasOwn(CATALOG[module],action))fail('模块或操作不存在；请先 GET 读取操作目录。',404);
 const entry=CATALOG[module][action];if(!allowed(user,entry))fail('所属管理员没有此模块权限。',403);return entry;
}
async function keyApi(request,db,user){
 if(request.method==='GET'){
  const row=await db.prepare("SELECT token_prefix,created_at FROM factory_ai_keys WHERE id='project'").first();
  return json({configured:!!row,prefix:row?.token_prefix||'',createdAt:row?.created_at||0,endpoint:FACTORY_API});
 }
 if(request.method==='DELETE'){await db.prepare("DELETE FROM factory_ai_keys WHERE id='project'").run();return json({ok:true});}
 if(request.method!=='POST')fail('不支持此方法。',405);
 only(await readManagementBody(request),[]);
 const apiKey='fac_api_'+randomToken(32),createdAt=Date.now();
 await db.prepare("INSERT INTO factory_ai_keys(id,owner_id,token_hash,token_prefix,created_at) VALUES('project',?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,token_hash=excluded.token_hash,token_prefix=excluded.token_prefix,created_at=excluded.created_at")
 .bind(user.id,await sha256Hex(apiKey),apiKey.slice(0,18),createdAt).run();
 return json({apiKey,createdAt,endpoint:FACTORY_API},201);
}
export function catalogDocument(user,origin,module,action){
 if(module&&!Object.hasOwn(CATALOG,module))fail('模块不存在。',404);
 const modules=publicCatalog(user,module);if(action){entryFor(user,module,action);for(const m of modules)m.actions=m.actions.filter(a=>a.action===action);}
 return {endpoint:origin+FACTORY_API,authentication:'Authorization: Bearer <PROJECT_API_KEY>',method:'POST',
  instructions:['整个项目共用一把密钥；module 区分模块，action 区分操作。查询和执行使用同一权限。','先 GET 本地址读取目录，可加 ?module=psychology&action=publish.create 精确查看。','POST JSON: {module,action,params:{...路径ID,query:{},body:{}},requestId}。不需要路径ID、query、body 时可省略。','所有写入必须携带 UUID requestId。同一操作重试沿用原编号；更改参数必须使用新编号。','HTTP 409 REQUEST_IN_PROGRESS / HTTP 503 RESULT_UNKNOWN 时，不要换编号重发；用 requests.get 查询状态并检查业务记录。','所有时间规则、账号和项目范围、revision 校验与页面相同。创建发布、启用运营会执行真实任务。','params 示例中的 ID、时间、文案需替换成实际值；revision 必须先读取。','批量导入须检查返回 results 中每条记录的 ok/error；HTTP 200 不代表每条都成功。'],
  requestStatus:{module:'psychology',action:'requests.get',params:{id:'ORIGINAL_REQUEST_UUID'}},modules};
}
function prepare(input,entry,origin){
 const p=input.params??{},ids=[...entry.target.matchAll(/:([A-Za-z]+)/g)].map(m=>m[1]);only(p,[...ids,'query','body']);
 let path=entry.target;
 for(const id of ids){if(typeof p[id]!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(p[id]))fail('路径参数 '+id+' 无效。');path=path.replace(':'+id,encodeURIComponent(p[id]));}
 const query=p.query??{};only(query,entry.query);
 if(Object.values(query).some(v=>!['string','number','boolean'].includes(typeof v)||String(v).length>2000))fail('查询参数只能使用字符串、数字或布尔值。');
 const url=new URL(path,origin);for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
 if(entry.handler==='official')url.searchParams.set('module','psychology');
 if(entry.handler==='one')url.searchParams.set('resource',{'tiktokOne.brands':'connections','tiktokOne.projects':'projects','tiktokOne.check':'prepare'}[input.action]);
 if(entry.method==='GET'&&p.body!==undefined)fail('查询操作不接受 params.body。');
 const body=structuredClone(p.body??{});if(!object(body))fail('params.body 须为 JSON 对象。');
 const inject=entry.method==='POST'&&(input.action==='publish.create'||input.action==='autopilot.create'||input.action==='styles.create'||input.action.endsWith('.views.create'));
 if(inject){if(body.requestId!==undefined&&body.requestId!==input.requestId)fail('内外 requestId 不一致。');body.requestId=input.requestId;}
 const request=new Request(url,{method:entry.method,...(entry.method==='GET'?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 return {url,request};
}
async function dispatch(entry,request,env,url,user){
 // Trusted actors are passed as server arguments only, never from client headers or body.
 if(entry.handler==='manage')return handlePsychologyManagement(request,env,url,null,{actor:{user,scopes:Object.keys(MANAGEMENT_MODULES).flatMap(m=>[m+':read',m+':write'])}});
 if(entry.handler==='topics')return handlePsychologyTopicBank(request,env,url,null,{user});
 if(entry.handler==='copy')return handleCopyIntegration(request,env,url,user.id,readManagementBody);
 const handlers={creative:handlePsychologyCreative,peers:handlePsychologyPeerHits,publish:handlePsychologyAutoPublish,one:handlePsychologyOne,official:handleOfficial,photo:handlePhotoFactory};
 return handlers[entry.handler](request,env,url,{user});
}
const receipt=(row)=>new Response(row.response_json,{status:row.response_status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-factory-request-id':row.request_id,'x-idempotent-replay':'true'}});
async function requestStatus(db,user,input){
 only(input.params,['id']);if(!UUID.test(input.params.id||''))fail('id 须为原始 UUID requestId。');
 const row=await db.prepare('SELECT * FROM factory_ai_requests WHERE owner_id=? AND request_id=?').bind(user.id,input.params.id).first();
 if(!row||row.module!==input.module)fail('请求记录不存在。',404);
 entryFor(user,row.module,row.action);
 return json({requestId:row.request_id,module:row.module,action:row.action,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,status:row.response_status||null,result:row.state==='done'?JSON.parse(row.response_json):null});
}
export async function handleFactoryApi(request,env,url,session){
 const external=url.pathname===FACTORY_API;
 if(!external&&!url.pathname.startsWith(FACTORY_API_ADMIN+'/'))return null;
 try{
  if(!external){
   const user=session?.user;if(!user)fail('请先登录。',401);if(user.role!=='admin')fail('仅管理员可管理项目 API。',403);
   if(request.method!=='GET'&&((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site'))fail('不允许跨站修改。',403);
   if(url.pathname===FACTORY_API_ADMIN+'/key')return await keyApi(request,env.DB,user);
   if(url.pathname===FACTORY_API_ADMIN+'/catalog'&&request.method==='GET')return json(catalogDocument(user,url.origin));
   fail('接口不存在。',404);
  }
  const user=await authenticate(request,env.DB);
  if(request.method==='GET')return json(catalogDocument(user,url.origin,url.searchParams.get('module'),url.searchParams.get('action')));
  if(request.method!=='POST')fail('只支持 GET 目录和 POST 调用。',405);
  const input=await readManagementBody(request);only(input,['module','action','params','requestId']);
  if(input.action==='requests.get')return await requestStatus(env.DB,user,input);
  const entry=entryFor(user,input.module,input.action),{url:target,request:forward}=prepare(input,entry,url.origin);
  if(entry.method==='GET')return await dispatch(entry,forward,env,target,user);
  if(typeof input.requestId!=='string'||!UUID.test(input.requestId))fail('写入操作须提供 UUID requestId。');
  const hash=await sha256Hex(JSON.stringify(canonical({module:input.module,action:input.action,params:input.params||{}}))),now=Date.now();
  const claimed=await env.DB.prepare("INSERT INTO factory_ai_requests(owner_id,request_id,module,action,input_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,'processing',?,?) ON CONFLICT(owner_id,request_id) DO NOTHING")
   .bind(user.id,input.requestId,input.module,input.action,hash,now,now).run();
  if(!claimed.meta?.changes){
   const row=await env.DB.prepare('SELECT * FROM factory_ai_requests WHERE owner_id=? AND request_id=?').bind(user.id,input.requestId).first();
   if(row.input_hash!==hash)fail('requestId 已用于不同参数或操作。',409);
   if(row.state==='done')return receipt(row);
   return json({error:'此请求正在处理或结果尚未确认，请查询 requests.get，不要换编号重复执行。',code:'REQUEST_IN_PROGRESS',requestId:input.requestId},409);
  }
  let response;
  try{response=await dispatch(entry,forward,env,target,user);if(!response)throw new Error('Missing handler response');}
  catch(error){response=errorJson(error.statusCode?error.message:'操作结果尚未确认，请检查业务记录。',error.statusCode||500);}
  // A server failure may follow a committed side effect. Keep the claim permanently;
  // never automatically retry it under a new ID or an expiring lease.
  if(response.status>=500)return json({error:'操作结果尚未确认，请检查业务记录；不要更换编号重复执行。',code:'RESULT_UNKNOWN',requestId:input.requestId},503);
  try{
   const body=await response.json(),result=JSON.stringify(body);
   await env.DB.prepare("UPDATE factory_ai_requests SET state='done',response_json=?,response_status=?,updated_at=? WHERE owner_id=? AND request_id=? AND state='processing'")
    .bind(result,response.status,Date.now(),user.id,input.requestId).run();
   return json(body,response.status,{'x-factory-request-id':input.requestId});
  }catch{return json({error:'结果保存失败，请检查业务记录；不要重复执行。',code:'RESULT_UNKNOWN',requestId:input.requestId},503);}
 }catch(error){return errorJson(error.statusCode?error.message:'统一 API 暂时不可用。',error.statusCode||500);}
}

// Internal-only adapter: OAuth callers cannot supply routes, headers or write actions.
export async function callFactoryRead(env,user,input,origin){
 only(input,['module','action','params']);
 const entry=entryFor(user,input.module,input.action);
 if(entry.method!=='GET')fail('MCP 仅开放读取操作。',403);
 const {url,request}=prepare(input,entry,origin);
 // The legacy topic reader calls its search parameter query.
 if(input.module==='psychology'&&input.action==='topics.list'&&url.searchParams.has('q'))url.searchParams.set('query',url.searchParams.get('q'));
 return dispatch(entry,request,env,url,user);
}
