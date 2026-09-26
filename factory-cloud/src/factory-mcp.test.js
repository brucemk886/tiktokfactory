import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
// The provider only uses this Workers class for handler type detection.
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){return s==='cloudflare:workers'?{url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true}:n(s,c);}`),import.meta.url);
globalThis.Cloudflare={compatibilityFlags:{global_fetch_strictly_public:true}};
const {createMcpWorker,MCP_ORIGIN,validateAuthorization}=await import('./factory-mcp.js');
const {MCP_TOOLS,redactSecrets}=await import('./factory-mcp-tools.js');
const {callFactoryRead}=await import('./factory-api.js');
const {fixture}=await import('./psychology-cloud-test-fixture.js');
const {sha256Hex}=await import('./http.js');
const {sidebarModuleIdsForRole}=await import('./sidebar.js');
const {toPublicUser}=await import('./auth.js');
class MemoryKV{
 data=new Map();
 async get(k,type){const row=this.data.get(k);if(!row||row.expiration&&row.expiration<Date.now()/1000)return null;return (type==='json'||type?.type==='json')?JSON.parse(row.value):row.value;}
 async put(k,value,options={}){this.data.set(k,{value,...options});}
 async delete(k){this.data.delete(k);}
 async list({prefix='',limit=1000,cursor}={}){const all=[...this.data].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));const start=Number(cursor||0),slice=all.slice(start,start+limit);return {keys:slice.map(([name,r])=>({name,metadata:r.metadata})),list_complete:start+limit>=all.length,cursor:start+limit<all.length?String(start+limit):''};}
}
async function setup(t){
 const f=await fixture(t);f.env.OAUTH_KV=new MemoryKV();
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(sidebarModuleIdsForRole('admin')));
 f.session='test-session';f.sqlite.prepare('INSERT INTO factory_sessions(token_hash,user_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)').run(await sha256Hex(f.session),'admin',Date.now(),Date.now()+3600000,Date.now());
 f.worker=createMcpWorker({fetch:()=>new Response('existing factory')});
 f.fetch=(path,init={})=>f.worker.fetch(new Request(MCP_ORIGIN+path,init),f.env,{waitUntil(){},passThroughOnException(){}});
 f.browser=(path,init={})=>f.fetch(path,{...init,headers:{cookie:'lf_session='+f.session,...init.headers}});
 return f;
}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function authorize(f,write=false){
 const c=await json(await f.fetch('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Test ChatGPT',redirect_uris:['https://chatgpt.com/connector/oauth/test'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})}),201);
 const verifier='a'.repeat(64),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const query=new URLSearchParams({response_type:'code',client_id:c.client_id,redirect_uri:c.redirect_uris[0],scope:'factory.read offline_access'+(write?' factory.topics.write':''),state:'test-state',code_challenge:challenge,code_challenge_method:'S256',resource:MCP_ORIGIN+'/mcp'});
 const start=await f.browser('/oauth/authorize?'+query);const html=await start.text();assert.match(html,write?/允许读取与生图入库/:/允许只读访问/);
 const handle=html.match(/name="handle" value="([^"]+)"/)[1],csrf=html.match(/name="csrf" value="([^"]+)"/)[1],cookie=start.headers.get('set-cookie').split(';')[0];
 const body=new URLSearchParams({handle,csrf,decision:'approve'}).toString();
 const approved=await f.browser('/oauth/authorize',{method:'POST',headers:{origin:MCP_ORIGIN,cookie:'lf_session='+f.session+'; '+cookie,'content-type':'application/x-www-form-urlencoded'},body});
 assert.equal(approved.status,200);const approvedHtml=await approved.text();assert.match(approvedHtml,write?/生图入库授权成功/:/只读授权成功/);const location=new URL(approvedHtml.match(/id="returnToClient" href="([^"]+)"/)[1].replaceAll('&#38;','&')); assert.equal(location.searchParams.get('state'),'test-state');assert.equal(location.searchParams.get('iss'),MCP_ORIGIN);
 const tokenBody=new URLSearchParams({grant_type:'authorization_code',code:location.searchParams.get('code'),client_id:c.client_id,redirect_uri:c.redirect_uris[0],code_verifier:verifier,resource:MCP_ORIGIN+'/mcp'});
 const token=await json(await f.fetch('/oauth/token',{method:'POST',body:tokenBody}));return {token,c,tokenBody,query,body,cookie};
}
const rpc=(f,token,method,params={})=>f.fetch('/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('discovery and no cookie/project key bypass; existing routes pass through',async t=>{
 const f=await setup(t);assert.equal(await (await f.fetch('/api/health')).text(),'existing factory');
 const meta=await json(await f.fetch('/.well-known/oauth-authorization-server'));assert.ok(meta.code_challenge_methods_supported.includes('S256'));assert.equal(meta.registration_endpoint,MCP_ORIGIN+'/oauth/register');
 const resource=await json(await f.fetch('/.well-known/oauth-protected-resource/mcp'));assert.equal(resource.resource,MCP_ORIGIN+'/mcp');
 assert.equal((await f.browser('/mcp')).status,401);assert.equal((await rpc(f,'fac_api_fake','tools/list')).status,401);assert.equal((await f.fetch('/mcp',{headers:{origin:'https://evil.test'}})).status,403);
});
test('PKCE exchange, MCP initialize/list/call, schemas and live permission checks',async t=>{
 const f=await setup(t),a=await authorize(f),token=a.token.access_token;
 const init=await json(await rpc(f,token,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}));assert.equal(init.result.serverInfo.name,'local-factory');
 const list=await json(await rpc(f,token,'tools/list'));assert.equal(list.result.tools.length,21);assert.equal(list.result.tools.filter(x=>x.annotations.readOnlyHint).length,20);assert.deepEqual(list.result.tools.filter(x=>!x.annotations.readOnlyHint).map(x=>x.name),['psychology_generate_image_and_import_topic']);
 const call=await json(await rpc(f,token,'tools/call',{name:'psychology_topics_list',arguments:{page:1,pageSize:2}}));assert.equal(call.result.isError,false);
 for(const params of [{name:'psychology_topics_list',arguments:{pageSize:10000}},{name:'psychology_publish_create',arguments:{}}]){const x=await json(await rpc(f,token,'tools/call',params));assert.ok(x.result?.isError||x.error);}
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-topic-bank']));assert.ok((await json(await rpc(f,token,'tools/list'))).result.tools.every(t=>!t.name.startsWith('photo_factory_')));
 f.sqlite.exec('UPDATE factory_users SET active=0');assert.equal((await rpc(f,token,'tools/list')).status,401);assert.equal(f.requests.length,0);
});
test('refresh works; code replay and wrong audience fail',async t=>{
 const f=await setup(t),a=await authorize(f);
 const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:a.token.refresh_token,client_id:a.c.client_id,resource:'https://evil.test/mcp'});assert.equal((await f.fetch('/oauth/token',{method:'POST',body})).status,400);
 body.set('resource',MCP_ORIGIN+'/mcp');const token=await json(await f.fetch('/oauth/token',{method:'POST',body}));await json(await rpc(f,token.access_token,'tools/list'));assert.equal((await f.fetch('/oauth/token',{method:'POST',body:a.tokenBody})).status,400);
});
test('consent enforces S256, same-origin POST and single-use browser handle',async t=>{
 assert.throws(()=>validateAuthorization({responseType:'code',scope:['factory.read']}));const f=await setup(t),a=await authorize(f);
 assert.equal((await f.browser('/oauth/authorize',{method:'POST',headers:{origin:'https://evil.test'},body:a.body})).status,403);
 const replay=await f.browser('/oauth/authorize',{method:'POST',headers:{origin:MCP_ORIGIN,cookie:'lf_session='+f.session+'; '+a.cookie},body:a.body});assert.notEqual(replay.status,302);
 const q=new URLSearchParams(a.query);q.delete('code_challenge');q.delete('code_challenge_method');assert.doesNotMatch(await (await f.browser('/oauth/authorize?'+q)).text(),/允许只读访问/);
});
test('owner-bound revocation immediately stops previously issued access tokens',async t=>{
 const f=await setup(t),a=await authorize(f),connection=f.sqlite.prepare('SELECT id FROM factory_mcp_connections').get();const body=new URLSearchParams({id:connection.id,csrf:await sha256Hex('factory-mcp-consent:'+f.session)});
 assert.equal((await f.browser('/factory-mcp',{method:'POST',headers:{origin:'https://evil.test'},body})).status,403);
 assert.equal((await f.browser('/factory-mcp',{method:'POST',headers:{origin:MCP_ORIGIN},body})).status,303);assert.equal((await rpc(f,a.token.access_token,'tools/list')).status,401);
});
test('adapter refuses writes; schemas reject injected owner; secrets stripped recursively',async t=>{
 const f=await setup(t),user=toPublicUser(f.sqlite.prepare('SELECT * FROM factory_users').get());await assert.rejects(()=>callFactoryRead(f.env,user,{module:'psychology',action:'publish.create',params:{}},MCP_ORIGIN),/仅开放读取/);
 assert.equal(MCP_TOOLS.find(t=>t.name==='psychology_copies_list').schema.safeParse({owner:'other'}).success,false);
 assert.deepEqual(redactSecrets({access_token:'secret',apiKey:'secret',nested:{password:'p',title:'ok'}}),{nested:{title:'ok'}});
});

test('CIMD supports ChatGPT public-client metadata and advertises it',async t=>{
 const f=await setup(t),clientId='https://chatgpt.com/oauth/client.json';
 t.mock.method(globalThis,'fetch',async()=>Response.json({client_id:clientId,client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}));
 const meta=await json(await f.fetch('/.well-known/oauth-authorization-server'));assert.equal(meta.client_id_metadata_document_supported,true);
 const q=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',scope:'factory.read',code_challenge:'x'.repeat(43),code_challenge_method:'S256',resource:MCP_ORIGIN+'/mcp'});
 const page=await f.browser('/oauth/authorize?'+q);assert.match(await page.text(),/允许只读访问/);
});
test('read filters translate legacy booleans and topic search without widening queries',async t=>{
 const f=await setup(t),a=await authorize(f);
 let x=await json(await rpc(f,a.token.access_token,'tools/call',{name:'psychology_topics_list',arguments:{q:'no-such-question',enabled:'active'}}));assert.equal(x.result.isError,false);assert.equal(x.result.structuredContent.total,0);
 x=await json(await rpc(f,a.token.access_token,'tools/call',{name:'psychology_publish_list',arguments:{attention:true}}));assert.equal(x.result.isError,false);
});

 test('write tool requires explicit additional OAuth consent; configuration errors are actionable',async t=>{
 const f=await setup(t),read=await authorize(f),args={requestId:crypto.randomUUID(),title:'A',content:'B',imagePrompt:'C'};
 let out=await json(await rpc(f,read.token.access_token,'tools/call',{name:'psychology_generate_image_and_import_topic',arguments:args}));
 assert.equal(out.result.isError,true);assert.match(JSON.stringify(out.result._meta),/insufficient_scope/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 const write=await authorize(f,true);assert.ok(write.token.scope.includes('factory.topics.write'));
 out=await json(await rpc(f,write.token.access_token,'tools/call',{name:'psychology_generate_image_and_import_topic',arguments:args}));
 assert.equal(out.result.isError,true);assert.match(JSON.stringify(out.result),/OPENAI_NOT_CONFIGURED/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 const metadata=await json(await f.fetch('/.well-known/oauth-protected-resource/mcp'));assert.ok(metadata.scopes_supported.includes('factory.topics.write'));
 assert.equal(f.requests.length,0);
 });
