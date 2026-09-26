import {OAuthProvider,AuthorizationError,CimdFetchError} from '@cloudflare/workers-oauth-provider';
import {getSession,toPublicUser} from './auth.js';
import {sha256Hex} from './http.js';
import {serveMcp} from './factory-mcp-tools.js';

export const MCP_ORIGIN='https://factory.tiktokaitool.com';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const fail=(message,status=400)=>new Response(message,{status,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
const csrf=session=>sha256Hex('factory-mcp-consent:'+session.token);
// Browser MCP traffic is bearer-authenticated. Cookie-based consent remains same-origin.
const MCP_BROWSER_ORIGINS=new Set(['https://chatgpt.com']);
const MCP_PROTOCOL_PATHS=new Set(['/mcp','/oauth/register','/oauth/token','/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource/mcp']);
const CORS_HEADERS=['authorization','content-type','accept','mcp-protocol-version','mcp-session-id','last-event-id'];
function protocolMethods(path){return path==='/mcp'?['GET','POST','DELETE']:path.startsWith('/.well-known/')?['GET']:['POST'];}
function withProtocolCors(response,requestOrigin,methods){
 const headers=new Headers(response.headers);
 headers.set('access-control-allow-origin',requestOrigin);
 headers.set('access-control-allow-methods',[...methods,'OPTIONS'].join(', '));
 headers.set('access-control-allow-headers',CORS_HEADERS.join(', '));
 headers.set('access-control-expose-headers','WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version, Retry-After');
 headers.set('access-control-max-age','600');
 headers.delete('access-control-allow-credentials');
 const vary=headers.get('vary');headers.set('vary',vary?vary+', Origin':'Origin');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function describeConsent(oauth,auth){
 const client=await oauth.lookupClient(auth.clientId);
 if(!client)throw new AuthorizationError('invalid_client',{description:'应用不存在。'});
 const host=new URL(auth.redirectUri).hostname;
 return {clientName:client.clientName||'未命名应用',clientDomain:auth.clientId.startsWith('https://')?new URL(auth.clientId).hostname:null,redirectHost:host,redirectIsLoopback:['localhost','127.0.0.1','[::1]'].includes(host)};
}
function page(title,body,headers=new Headers()){
 headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-store');headers.set('referrer-policy','no-referrer');headers.set('x-frame-options','DENY');
 headers.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
 return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Local Factory</title><style>body{margin:0;background:#f4f7fc;color:#172d4c;font:16px/1.7 system-ui}main{max-width:720px;margin:6vh auto;padding:32px;background:white;border:1px solid #dce5f3;border-radius:16px}h1{font-size:25px}a{color:#1260db}button{padding:10px 18px;background:#1260db;color:white;border:0;border-radius:7px;cursor:pointer;font:inherit;margin:8px 8px 0 0}code{overflow-wrap:anywhere}article{border-top:1px solid #dce5f3;padding:14px 0}.muted{color:#64748b}</style><main><h1>${escape(title)}</h1>${body}</main></html>`,{headers});
}
export function validateAuthorization(auth){
 if(auth.responseType!=='code'||auth.codeChallengeMethod!=='S256'||!auth.codeChallenge)throw new AuthorizationError('invalid_request',{description:'此连接必须使用授权码和 PKCE S256。'});
 if(auth.scope.some(s=>!['factory.read','factory.topics.write','offline_access'].includes(s)))throw new AuthorizationError('invalid_scope',{description:'仅支持读取和题库生图入库权限。'});
}
export async function mcpActor(env,ctx){
 if(!ctx.auth?.scope?.includes('factory.read')||!ctx.props?.userId||!ctx.props?.connectionId)return null;
 const connection=await env.DB.prepare('SELECT id FROM factory_mcp_connections WHERE id=? AND owner_id=? AND revoked_at IS NULL').bind(ctx.props.connectionId,ctx.props.userId).first();
 if(!connection)return null;
 const row=await env.DB.prepare('SELECT * FROM factory_users WHERE id=?').bind(ctx.props.userId).first();
 return row?.active===1&&row.role==='admin'?toPublicUser(row):null;
}
export function createMcpWorker(factory,origin=MCP_ORIGIN){
 const resource=origin+'/mcp';
 const provider=new OAuthProvider({apiRoute:'/mcp',apiHandler:{async fetch(request,env,ctx){
  if(new URL(request.url).pathname!=='/mcp')return fail('Not found',404);
  const user=await mcpActor(env,ctx);
  if(!user)return new Response('连接已撤销、权限不足或账号不可用。',{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,'cache-control':'no-store'}});
  return serveMcp(request,env,user,origin,ctx.auth.scope);
 }},defaultHandler:{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(!['/oauth/authorize','/factory-mcp'].includes(url.pathname))return factory.fetch(request,env,ctx);
  if(!['GET','POST'].includes(request.method))return fail('Method not allowed',405);
  const session=await getSession(request,env.DB);
  if(!session)return page('登录工厂以继续',`<p>使用你的工厂管理员账号登录，再确认所需权限。</p><a href="/login?next=${escape(encodeURIComponent(url.pathname+url.search))}">登录工厂</a>`);
  if(session.user.role!=='admin')return fail('仅工厂管理员可以连接 MCP。',403);
  const marker=await csrf(session);
  let form;
  if(request.method==='POST'){
   if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return fail('不允许跨站授权。',403);
   const raw=await request.text();if(raw.length>16000)return fail('请求过大',413);
   form=new URLSearchParams(raw);if(form.get('csrf')!==marker)return fail('登录状态已变化，请刷新后重试。',403);
  }
  if(url.pathname==='/factory-mcp'){
   if(form){
    await env.DB.prepare('UPDATE factory_mcp_connections SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL').bind(Date.now(),form.get('id')||'',session.user.id).run();
    return new Response(null,{status:303,headers:{location:'/factory-mcp','cache-control':'no-store'}});
   }
   const result=await env.DB.prepare('SELECT id,client_name,created_at,scopes_json FROM factory_mcp_connections WHERE owner_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100').bind(session.user.id).all();
   return page('ChatGPT 工厂连接',`<p><a href="/factory-api">返回统一 API</a></p><p>MCP 地址：<code>${escape(resource)}</code></p><p>在 ChatGPT 开启开发者模式，新增 MCP 连接，填写此地址，认证选择 OAuth，再用工厂账号登录授权。无需填写项目 API Key；支持动态客户端注册。</p><p>可以查询题库、文案及改写、发布状态、报表、样式、自动运营计划和图文工厂。额外授权 factory.topics.write 后，可以付费生图并导入题库。发布与启动自动运营不开放。</p><p>OpenAI 生图接口：${env.OPENAI_API_KEY?'已配置':'未配置，请在 Worker Secrets 添加 OPENAI_API_KEY'}。</p><h2>我的授权连接</h2>${result.results.length?result.results.map(c=>`<article><strong>${escape(c.client_name)}</strong><p>${JSON.parse(c.scopes_json).includes('factory.topics.write')?'读取 + 生图入库':'只读'}</p><p class="muted">授权时间：${escape(new Date(c.created_at).toISOString())}</p><form method="post"><input type="hidden" name="csrf" value="${marker}"><input type="hidden" name="id" value="${escape(c.id)}"><button>撤销连接</button></form></article>`).join(''):'<p>暂无授权连接。</p>'}`);
  }
  try{
   const oauth=env.OAUTH_PROVIDER;
   if(!form){
    const auth=await oauth.parseAuthRequest(request);validateAuthorization(auth);
    if(auth.scope.includes('factory.topics.write')&&!session.user.sidebarModules?.includes('psychology-topic-bank'))return fail('没有题库管理权限。',403);
    const details=await describeConsent(oauth,auth),consent=await oauth.beginConsent(auth);
    return page(auth.scope.includes('factory.topics.write')?'授权工厂生图入库':'授权读取工厂数据',`<p>当前工厂账号：<strong>${escape(session.user.displayName||session.user.username)}</strong></p><p>应用：<strong>${escape(details.clientName)}</strong></p><p>${details.clientDomain?'应用域名：'+escape(details.clientDomain):'应用名称由客户端自行填写，请核对回调地址。'}</p><p>授权返回地址：<strong>${escape(details.redirectHost)}</strong></p>${details.redirectIsLoopback?'<p>此授权将交给本机应用，请确认是你刚发起的连接。</p>':''}<p>授权范围：<strong>factory.read（只读）</strong>。查询范围以你的工厂模块权限为准，包括题目、文案、账号和运营数据。</p>${auth.scope.includes('factory.topics.write')?'<p><strong>factory.topics.write：允许付费调用 OpenAI 生成图片，保存素材并新建题目。默认停用；明确指定 enabled=true 会使题目进入可用题库。</strong></p>':''}${auth.scope.includes('offline_access')?'<p>包含离线访问，可自动续期。':''}</p><p>需要停止访问时，在统一 API → ChatGPT 连接中撤销。</p><form method="post"><input type="hidden" name="csrf" value="${marker}"><input type="hidden" name="handle" value="${escape(consent.handle)}"><button name="decision" value="approve">${auth.scope.includes('factory.topics.write')?'允许读取与生图入库':'允许只读访问'}</button><button name="decision" value="deny">拒绝</button></form>`,consent.headers);
   }
   const handle=form.get('handle')||'';
   if(form.get('decision')!=='approve'){
    const denied=await oauth.denyConsent(request,handle);const redirect=denied.headers.get('location');denied.headers.delete('location');return page('已拒绝授权',`<a href="${escape(redirect)}">返回应用</a>`,denied.headers);
   }
   const approved=await oauth.approveConsent(request,handle);
   validateAuthorization(approved.request);
   if(approved.request.scope.includes('factory.topics.write')&&!session.user.sidebarModules?.includes('psychology-topic-bank'))return fail('没有题库管理权限。',403);
   const scope=['factory.read',...approved.request.scope.filter(s=>['offline_access','factory.topics.write'].includes(s))];
   const details=await describeConsent(oauth,approved.request),connectionId=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO factory_mcp_connections(id,owner_id,client_name,created_at,scopes_json) VALUES(?,?,?,?,?)').bind(connectionId,session.user.id,details.clientName,Date.now(),JSON.stringify(scope)).run();
   const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:session.user.id,metadata:{connectionId},scope,props:{userId:session.user.id,connectionId}});
   return page(scope.includes('factory.topics.write')?'生图入库授权成功':'只读授权成功',`<p>最后一步：返回应用完成连接。</p><p><a id="returnToClient" href="${escape(redirectTo)}">返回 ${escape(details.clientName)}</a></p>`,approved.headers);
  }catch(error){
   if(!(error instanceof AuthorizationError)&&!(error instanceof CimdFetchError))throw error;
   if(error instanceof AuthorizationError&&error.redirectTo)return page('授权未完成',`<p>${escape(error.description)}</p><a href="${escape(error.redirectTo)}">返回应用</a>`);
   return page('授权未完成',`<p>${escape(error instanceof AuthorizationError?error.description:error instanceof CimdFetchError?'无法验证客户端，请重新连接。':'授权请求无效或已过期，请从 ChatGPT 重新发起连接。')}</p><a href="/factory-mcp">返回连接管理</a>`);
  }
 }},authorizeEndpoint:origin+'/oauth/authorize',tokenEndpoint:origin+'/oauth/token',clientRegistrationEndpoint:origin+'/oauth/register',
 scopesSupported:['factory.read','factory.topics.write','offline_access'],clientIdMetadataDocumentEnabled:true,
 resourceMetadata:{resource,authorization_servers:[origin],scopes_supported:['factory.read','factory.topics.write']},accessTokenTTL:3600,refreshTokenTTL:2592000});
 return {...factory,async fetch(request,env,ctx){
  const url=new URL(request.url),isMcp=url.pathname==='/mcp'||url.pathname.startsWith('/mcp/')||url.pathname.startsWith('/oauth/')||url.pathname.startsWith('/.well-known/oauth-')||url.pathname==='/factory-mcp';
  if(!isMcp)return factory.fetch(request,env,ctx);
  if(url.origin!==origin)return fail('请使用工厂正式域名连接。',400);
  const requestOrigin=request.headers.get('origin'),crossOrigin=requestOrigin!==null&&requestOrigin!==origin;
  const protocol=MCP_PROTOCOL_PATHS.has(url.pathname),methods=protocolMethods(url.pathname);
  // Only the OAuth landing GET may arrive from ChatGPT. Approve/revoke POSTs
  // still require our own Origin, session CSRF and the provider consent handle.
  const authorizationLanding=url.pathname==='/oauth/authorize'&&request.method==='GET';
  if(crossOrigin&&(!MCP_BROWSER_ORIGINS.has(requestOrigin)||!protocol&&!authorizationLanding))return fail('不允许跨站请求。',403);
  if(protocol&&request.method==='OPTIONS'&&requestOrigin){
   const requestedMethod=request.headers.get('access-control-request-method');
   const requestedHeaders=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(h=>h.trim()).filter(Boolean);
   if(!methods.includes(requestedMethod)||requestedHeaders.some(h=>!CORS_HEADERS.includes(h)))return fail('跨域请求方法或请求头不受支持。',403);
   return withProtocolCors(new Response(null,{status:204}),requestOrigin,methods);
  }
  if(Number(request.headers.get('content-length')||0)>131072)return fail('请求过大',413);
  const response=await provider.fetch(request,env,ctx);
  return protocol&&requestOrigin?withProtocolCors(response,requestOrigin,methods):response;
 }};
}
