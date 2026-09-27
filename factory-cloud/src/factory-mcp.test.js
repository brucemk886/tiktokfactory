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
 const start=await f.browser('/oauth/authorize?'+query);const html=await start.text();assert.match(html,write?/允许读取与图片入库/:/允许只读访问/);
 const handle=html.match(/name="handle" value="([^"]+)"/)[1],csrf=html.match(/name="csrf" value="([^"]+)"/)[1],cookie=start.headers.get('set-cookie').split(';')[0];
 const body=new URLSearchParams({handle,csrf,decision:'approve'}).toString();
 const approved=await f.browser('/oauth/authorize',{method:'POST',headers:{origin:MCP_ORIGIN,cookie:'lf_session='+f.session+'; '+cookie,'content-type':'application/x-www-form-urlencoded'},body});
 assert.equal(approved.status,200);const approvedHtml=await approved.text();assert.match(approvedHtml,write?/图片入库授权成功/:/只读授权成功/);const location=new URL(approvedHtml.match(/id="returnToClient" href="([^"]+)"/)[1].replaceAll('&#38;','&')); assert.equal(location.searchParams.get('state'),'test-state');assert.equal(location.searchParams.get('iss'),MCP_ORIGIN);
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
 const list=await json(await rpc(f,token,'tools/list'));assert.equal(list.result.tools.length,23);assert.equal(list.result.tools.filter(x=>x.annotations.readOnlyHint).length,21);assert.deepEqual(list.result.tools.filter(x=>!x.annotations.readOnlyHint).map(x=>x.name),['psychology_save_selected_topic_image','psychology_import_topic_image']);
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

test('file import requires write consent and works without an OpenAI key or workflow',async t=>{
 const f=await setup(t),read=await authorize(f),args={requestId:crypto.randomUUID(),title:'A',content:'B',image:{download_url:'https://files.oaiusercontent.com/example.png?sig=test-only',file_id:'file-test'}};
 const tools=(await json(await rpc(f,read.token.access_token,'tools/list'))).result.tools;
 assert.ok(!tools.some(x=>x.name==='psychology_generate_image_and_import_topic'));
 const tool=tools.find(x=>x.name==='psychology_import_topic_image');
 assert.deepEqual(tool._meta['openai/fileParams'],['image']);
 assert.deepEqual(tool.inputSchema.properties.image.required,['download_url','file_id']);
 for(const field of ['download_url','file_id','mime_type','file_name'])assert.ok(tool.inputSchema.properties.image.properties[field]);
 let out=await json(await rpc(f,read.token.access_token,'tools/call',{name:tool.name,arguments:args}));
 assert.equal(out.result.isError,true);assert.match(JSON.stringify(out.result._meta),/insufficient_scope/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 const write=await authorize(f,true);assert.ok(write.token.scope.includes('factory.topics.write'));
 delete f.env.OPENAI_API_KEY;delete f.env.TOPIC_IMAGE_WORKFLOW;
 const objects=new Map();f.env.ARCHIVE={async head(k){return objects.get(k)||null;},async put(k,b,o){objects.set(k,{size:b.length,customMetadata:o.customMetadata});return objects.get(k);}};
 let downloads=0;f.env.fetch=async(url,init)=>{assert.equal(url,args.image.download_url);assert.equal(init.method,'GET');assert.equal(init.headers,undefined);downloads++;return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK2cAAAAASUVORK5CYII=','base64'));};
 out=await json(await rpc(f,write.token.access_token,'tools/call',{name:tool.name,arguments:args}));
 assert.equal(out.result.isError,false,JSON.stringify(out));assert.equal(out.result.structuredContent.status,'completed');assert.equal(out.result.structuredContent.topic.enabled,false);
 const repeated=await json(await rpc(f,write.token.access_token,'tools/call',{name:tool.name,arguments:args}));assert.equal(repeated.result.structuredContent.topic.id,out.result.structuredContent.topic.id);assert.equal(downloads,1);
 const removed=await json(await rpc(f,write.token.access_token,'tools/call',{name:'psychology_generate_image_and_import_topic',arguments:{requestId:crypto.randomUUID(),title:'A',content:'B',imagePrompt:'C'}}));assert.ok(removed.error||removed.result?.isError);assert.equal(downloads,1);
 assert.equal(f.requests.length,0);
});

test('ChatGPT cross-origin discovery, PKCE and MCP calls work while consent stays same-origin',async t=>{
 const f=await setup(t),fetch=f.fetch;
 f.fetch=(path,init={})=>fetch(path,{...init,headers:{origin:'https://chatgpt.com',...Object.fromEntries(new Headers(init.headers))}});
 const meta=await f.fetch('/.well-known/oauth-protected-resource/mcp');assert.equal(meta.status,200);assert.equal(meta.headers.get('access-control-allow-origin'),'https://chatgpt.com');
 const unauth=await f.fetch('/mcp');assert.equal(unauth.status,401);assert.match(unauth.headers.get('access-control-expose-headers'),/WWW-Authenticate/);assert.equal(unauth.headers.get('access-control-allow-credentials'),null);
 const a=await authorize(f,true);const list=await json(await rpc(f,a.token.access_token,'tools/list'));assert.equal(list.result.tools.length,23);
 assert.equal((await f.browser('/factory-mcp',{method:'POST',headers:{origin:'https://chatgpt.com'},body:a.body})).status,403);
 assert.equal((await f.browser('/oauth/authorize',{method:'POST',headers:{origin:'https://chatgpt.com'},body:a.body})).status,403);
 assert.equal(f.requests.length,0);
});
test('CORS preflights are route/method/header bounded and never authenticate a tool call',async t=>{
 const f=await setup(t);
 for(const [path,method] of [['/mcp','POST'],['/oauth/token','POST'],['/oauth/register','POST'],['/.well-known/oauth-authorization-server','GET']]){
 const r=await f.fetch(path,{method:'OPTIONS',headers:{origin:'https://chatgpt.com','access-control-request-method':method,'access-control-request-headers':'Authorization, Content-Type, MCP-Protocol-Version'}});
 assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://chatgpt.com');assert.notEqual(r.headers.get('access-control-allow-methods'),'*');
 }
 for(const origin of ['null','https://evil.test','https://chatgpt.com.evil.test','http://chatgpt.com']){
 for(const path of ['/mcp','/.well-known/oauth-protected-resource/mcp','/oauth/authorize'])assert.equal((await f.fetch(path,{headers:{origin}})).status,403);
 }
 for(const headers of [{'access-control-request-method':'PATCH'},{'access-control-request-method':'POST','access-control-request-headers':'x-untrusted'}])assert.equal((await f.fetch('/mcp',{method:'OPTIONS',headers:{origin:'https://chatgpt.com',...headers}})).status,403);
 assert.equal((await f.fetch('/oauth/authorize',{method:'OPTIONS',headers:{origin:'https://chatgpt.com','access-control-request-method':'POST'}})).status,403);
 const r=await f.browser('/mcp',{headers:{origin:'https://chatgpt.com'}});assert.equal(r.status,401);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_mcp_connections').get().n,0);
});


test('consent pages keep a usable Origin on native browser POST without leaking authorization URL',async t=>{
 const f=await setup(t),page=await f.browser('/factory-mcp');
 assert.equal(page.headers.get('referrer-policy'),'strict-origin');
 assert.match(page.headers.get('content-security-policy'),/form-action 'self'/);
 // Transport tests construct Origin manually; this regression uses Chromium's
 // native navigation/form algorithm instead of fetch or synthetic headers.
 const {default:fs}=await import('node:fs');
 const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(p=>fs.existsSync(p));
 if(!executablePath){t.diagnostic('Native browser check unavailable: Chrome is not installed; header contract checked.');return;}
 const {default:puppeteer}=await import('puppeteer-core');
 const browser=await puppeteer.launch({executablePath,headless:true});t.after(()=>browser.close());
 for(const [policy,expected] of [['no-referrer','null'],[page.headers.get('referrer-policy'),MCP_ORIGIN]]){
  const tab=await browser.newPage();await tab.setRequestInterception(true);let observed;
  tab.on('request',async request=>{
   if(request.method()==='POST'){
    observed={origin:request.headers().origin,referer:request.headers().referer};
    await request.respond({status:200,contentType:'text/plain',body:'diagnostic received'});
   }else await request.respond({status:200,headers:{'Content-Type':'text/html','Referrer-Policy':policy,'Content-Security-Policy':page.headers.get('content-security-policy')},body:'<form method="post" action="/oauth/authorize"><button>Diagnostic submit</button></form>'});
  });
  await tab.goto(MCP_ORIGIN+'/oauth/authorize?state=diagnostic-query');
  await Promise.all([tab.waitForNavigation(),tab.click('button')]);
  assert.equal(observed.origin,expected);
  if(policy==='strict-origin')assert.equal(observed.referer,MCP_ORIGIN+'/');
  await tab.close();
 }
 const {token,query}=await authorize(f);await json(await rpc(f,token.access_token,'tools/list'));
 // Exercise the actual consent HTML and cookie-bound handle too, through the
 // real OAuth provider with the in-memory fixture, never the production server.
 const consentTab=await browser.newPage();await consentTab.setRequestInterception(true);let lastPost;
 consentTab.on('request',async request=>{
  const url=new URL(request.url());
  if(url.origin!==MCP_ORIGIN||url.pathname!=='/oauth/authorize'){await request.respond({status:404,body:'not part of fixture'});return;}
  const headers=request.headers();headers.cookie='lf_session='+f.session+'; '+(headers.cookie||'');
  const body=request.method()==='POST'?(request.postData()??await request.fetchPostData()):undefined;
  const response=await f.fetch(url.pathname+url.search,{method:request.method(),headers,...(body!==undefined?{body}: {})});
  if(request.method()==='POST')lastPost={status:response.status,fields:[...new URLSearchParams(body).keys()],bodyLength:body?.length,csrfCorrect:new URLSearchParams(body).get('csrf')===await sha256Hex('factory-mcp-consent:'+f.session),origin:headers.origin,site:headers['sec-fetch-site'],error:response.status===200?'':await response.clone().text()};
  await request.respond({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 await consentTab.goto(MCP_ORIGIN+'/oauth/authorize?'+query);
 await Promise.all([consentTab.waitForNavigation(),consentTab.click('button[value="approve"]')]);
 assert.match(await consentTab.title(),/只读授权成功/,JSON.stringify(lastPost));
 assert.equal(await consentTab.$eval('#returnToClient',link=>link.textContent),'返回 Test ChatGPT');
 await consentTab.close();
 assert.equal((await f.browser('/oauth/authorize',{method:'POST',headers:{origin:'null'},body:''})).status,403);
});


test('picker resource prepares without writing, avoids fileParams on UI save, preserves OAuth checks',async t=>{
 const f=await setup(t),a=await authorize(f),draft={requestId:crypto.randomUUID(),title:'Draft',content:'Body'};
 const list=(await json(await rpc(f,a.token.access_token,'tools/list'))).result.tools;
 const prepare=list.find(x=>x.name==='psychology_prepare_topic_image_import'),save=list.find(x=>x.name==='psychology_save_selected_topic_image');
 assert.equal(prepare.inputSchema.properties.image,undefined);assert.equal(prepare._meta['openai/fileParams'],undefined);
 assert.equal(save._meta['openai/fileParams'],undefined);assert.deepEqual(save._meta.ui.visibility,['app']);assert.equal(save._meta['openai/widgetAccessible'],true);
 const result=await json(await rpc(f,a.token.access_token,'tools/call',{name:prepare.name,arguments:draft}));assert.equal(result.result.structuredContent.status,'awaiting_image');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 const resource=await json(await rpc(f,a.token.access_token,'resources/read',{uri:prepare._meta.ui.resourceUri}));assert.equal(resource.result.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resource.result.contents[0].text,/selectFiles/);
 const args={...draft,image:{file_id:'file-picker',download_url:'https://files.oaiusercontent.com/test.png'}};
 const denied=await json(await rpc(f,a.token.access_token,'tools/call',{name:save.name,arguments:args}));assert.match(JSON.stringify(denied.result._meta),/insufficient_scope/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 const invalid=await json(await rpc(f,a.token.access_token,'tools/call',{name:prepare.name,arguments:{...draft,template:'psychology-target-2'}}));assert.ok(invalid.error||invalid.result?.isError);
 const stringFile=await json(await rpc(f,a.token.access_token,'tools/call',{name:save.name,arguments:{...args,image:'file-picker'}}));assert.ok(stringFile.error||stringFile.result?.isError);
});

test('real Chrome picker selects host file then calls actual OAuth MCP import without any generation',async t=>{
 const {default:fs}=await import('node:fs');const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(p=>fs.existsSync(p));if(!executablePath){t.skip('Chrome unavailable');return;}
 const f=await setup(t),a=await authorize(f,true),draft={requestId:crypto.randomUUID(),template:'psychology-target-2',title:'<img src=x onerror="window.unsafe=true">',content:'Reflection',choices:['A','B','C','D'].map(copy=>({copy})),revealComment:'Reveal'};
 const prepared=(await json(await rpc(f,a.token.access_token,'tools/call',{name:'psychology_prepare_topic_image_import',arguments:draft}))).result.structuredContent;
 const {TOPIC_IMPORT_UI}=await import('./topic-import-widget.js');const html=(await json(await rpc(f,a.token.access_token,'resources/read',{uri:TOPIC_IMPORT_UI}))).result.contents[0].text;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK2cAAAAASUVORK5CYII=','base64'),objects=new Map();
 f.env.ARCHIVE={async head(k){return objects.get(k)||null;},async put(k,b,o){if(objects.has(k))return null;objects.set(k,{size:b.length,customMetadata:o.customMetadata});return objects.get(k);}};
 let downloads=0;f.env.fetch=async(url,init)=>{assert.match(url,/^https:\/\/files.oaiusercontent.com\//);assert.equal(init.method,'GET');downloads++;return new Response(png);};
 delete f.env.OPENAI_API_KEY;delete f.env.TOPIC_IMAGE_WORKFLOW;
 const {default:puppeteer}=await import('puppeteer-core');const browser=await puppeteer.launch({executablePath,headless:true});t.after(()=>browser.close());
 const tab=await browser.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));await tab.setViewport({width:640,height:850});
 await tab.exposeFunction('fixtureCall',async(name,args)=>{const result=await json(await rpc(f,a.token.access_token,'tools/call',{name,arguments:args}));assert.ok(!result.error,JSON.stringify(result));return result.result;});
 await tab.evaluate(data=>{window.openai={toolOutput:data,selectFiles:async()=>[{fileId:'file-picker-test',fileName:'attachment.png',mimeType:'image/png'}],getFileDownloadUrl:async({fileId})=>{if(fileId!=='file-picker-test')throw Error('wrong file');return {downloadUrl:'https://files.oaiusercontent.com/test.png?sig=private-picker'};},callTool:window.fixtureCall,setWidgetState:s=>{window.savedState=s;}};},prepared);
 await tab.setContent(html);await tab.click('summary');assert.equal(await tab.$eval('#title',e=>e.textContent),draft.title);assert.equal(await tab.evaluate(()=>window.unsafe),undefined);
 assert.equal(await tab.$eval('#save',e=>e.disabled),true);await tab.click('#library');await tab.waitForFunction(()=>!document.getElementById('save').disabled);assert.equal(downloads,0);
 await tab.click('#save');await tab.waitForFunction(()=>document.getElementById('status').textContent.includes('已写入成功'));
 assert.equal(downloads,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);assert.equal(await tab.$eval('#save',e=>e.disabled),true);assert.doesNotMatch(await tab.evaluate(()=>JSON.stringify(window.savedState)),/download_url|private-picker/);assert.deepEqual(errors,[]);
 assert.equal(await tab.$eval('#choices',e=>e.textContent),'A · A\nB · B\nC · C\nD · D');
 // A fresh card also supports uploadFile when selectFiles is unavailable.
 const tab2=await browser.newPage();await tab2.exposeFunction('fixtureCall',async(name,args)=>(await json(await rpc(f,a.token.access_token,'tools/call',{name,arguments:args}))).result);
 await tab2.evaluate(data=>{window.openai={toolOutput:data,uploadFile:async file=>{window.uploaded={name:file.name,size:file.size};return {fileId:'file-upload-test'};},getFileDownloadUrl:async()=>({downloadUrl:'https://files.oaiusercontent.com/upload.png'}),callTool:window.fixtureCall};},{...prepared,draft:{...prepared.draft,requestId:crypto.randomUUID()}});
 await tab2.setContent(html);assert.equal(await tab2.$eval('#library',e=>e.disabled),true);assert.equal(await tab2.$eval('#upload',e=>e.disabled),false);
 await tab2.evaluate(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'local.png',{type:'image/png'}));const el=document.getElementById('file');el.files=transfer.files;el.dispatchEvent(new Event('change'));},[...png]);
 await tab2.waitForFunction(()=>!document.getElementById('save').disabled);await tab2.click('#save');await tab2.waitForFunction(()=>document.getElementById('status').textContent.includes('已写入成功'));assert.equal(downloads,2);

 // A sandbox iframe uses the standard postMessage bridge with no callTool fallback.
 // Simulate a lost tool response AFTER a successful import, then query the same ID.
 const host=await browser.newPage();await host.setViewport({width:640,height:900});
 const third={...prepared,draft:{...prepared.draft,requestId:crypto.randomUUID(),title:'When closeness feels overwhelming'}};
 let savedRequest;
 await host.exposeFunction('fixtureCall',async(name,args)=>{
  const result=(await json(await rpc(f,a.token.access_token,'tools/call',{name,arguments:args}))).result;
  if(name==='psychology_save_selected_topic_image'){savedRequest=args.requestId;return {lost:true};}
  assert.equal(args.requestId,savedRequest);return result;
 });
 await host.setContent('<iframe title="Factory" style="border:0;width:100%;height:850px" sandbox="allow-scripts allow-same-origin"></iframe>');
 await host.evaluate(({html,prepared})=>{
  const frame=document.querySelector('iframe');window.bridgeMethods=[];
  window.addEventListener('message',async event=>{
   if(event.source!==frame.contentWindow)return;
   const msg=event.data;window.bridgeMethods.push(msg.method);
   const send=data=>event.source.postMessage({jsonrpc:'2.0',...data},'*');
   if(msg.method==='ui/initialize'){
    if(msg.params.protocolVersion!=='2026-01-26')throw Error('bad protocol');
    send({id:msg.id,result:{protocolVersion:'2026-01-26',hostCapabilities:{},hostInfo:{name:'Fixture',version:'1'}}});
   }else if(msg.method==='ui/notifications/initialized')send({method:'ui/notifications/tool-result',params:{structuredContent:prepared}});
   else if(msg.method==='tools/call'){
    const result=await window.fixtureCall(msg.params.name,msg.params.arguments);
    if(result.lost)send({id:msg.id,error:{code:-32603,message:'lost acknowledgement'}});
    else send({id:msg.id,result});
   }
  });
  // Host-only injection of file capabilities; no draft/callTool shortcut in this test.
  frame.srcdoc=html.replace('<script>',`<script>window.openai={selectFiles:async()=>[{fileId:'file-bridge-test',fileName:'selected.png',mimeType:'image/png'}],getFileDownloadUrl:async()=>({downloadUrl:'https://files.oaiusercontent.com/bridge.png'}),setWidgetState:s=>{window.savedState=s;}};<`+'/script><script>');
 },{html,prepared:third});
 await host.waitForFunction(()=>window.bridgeMethods.includes('ui/notifications/initialized'));
 const frame=host.frames().find(x=>x!==host.mainFrame());
 await frame.waitForFunction(()=>!document.getElementById('library').disabled);
 await frame.click('#library');await frame.waitForFunction(()=>!document.getElementById('save').disabled);
 await frame.click('#save');await frame.waitForFunction(()=>document.getElementById('status').textContent.includes('暂时无法确认'));
 assert.equal(await frame.$eval('#library',e=>e.disabled),true);assert.equal(await frame.$eval('#save',e=>e.disabled),false);
 assert.equal(downloads,3);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,3);
 await frame.click('#check');await frame.waitForFunction(()=>document.getElementById('status').textContent.includes('已写入成功'));
 assert.equal(downloads,3);assert.equal(await frame.$eval('#save',e=>e.disabled),true);
 assert.ok((await host.evaluate(()=>window.bridgeMethods)).includes('ui/notifications/size-changed'));
 // Keep a local screenshot for visual review; no production/user data is used.
 if(process.env.MCP_PICKER_SCREENSHOT)await host.screenshot({path:process.env.MCP_PICKER_SCREENSHOT,fullPage:true});
 // Host upload failures leave the card usable and make no Factory call.
 await tab2.evaluate(id=>{window.openai.uploadFile=async()=>{throw Error('upload failed');};window.openai.toolOutput.draft.requestId=id;},crypto.randomUUID());
 await tab2.setContent(html);
 await tab2.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['png'],'failed.png',{type:'image/png'}));const el=document.getElementById('file');el.files=transfer.files;el.dispatchEvent(new Event('change'));});
 await tab2.waitForFunction(()=>document.getElementById('status').textContent.includes('没有取得可用图片'));
 assert.equal(await tab2.$eval('#save',e=>e.disabled),true);assert.equal(await tab2.$eval('#upload',e=>e.disabled),false);assert.equal(downloads,3);
 assert.equal(f.requests.length,0);
});
