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
 const query=new URLSearchParams({response_type:'code',client_id:c.client_id,redirect_uri:c.redirect_uris[0],scope:'factory.read offline_access'+(write==='video'?' factory.video_hits.write':write?' factory.topics.write':''),state:'test-state',code_challenge:challenge,code_challenge_method:'S256',resource:MCP_ORIGIN+'/mcp'});
 const start=await f.browser('/oauth/authorize?'+query);const html=await start.text();assert.match(html,write==='video'?/允许读取与视频爆款写入/:write?/允许读取与图片入库/:/允许只读访问/);
 const handle=html.match(/name="handle" value="([^"]+)"/)[1],csrf=html.match(/name="csrf" value="([^"]+)"/)[1],cookie=start.headers.get('set-cookie').split(';')[0];
 const body=new URLSearchParams({handle,csrf,decision:'approve'}).toString();
 const approved=await f.browser('/oauth/authorize',{method:'POST',headers:{origin:MCP_ORIGIN,cookie:'lf_session='+f.session+'; '+cookie,'content-type':'application/x-www-form-urlencoded'},body});
 assert.equal(approved.status,200);const approvedHtml=await approved.text();assert.match(approvedHtml,write==='video'?/视频爆款写入授权成功/:write?/图片入库授权成功/:/只读授权成功/);const location=new URL(approvedHtml.match(/id="returnToClient" href="([^"]+)"/)[1].replaceAll('&#38;','&')); assert.equal(location.searchParams.get('state'),'test-state');assert.equal(location.searchParams.get('iss'),MCP_ORIGIN);
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
 const list=await json(await rpc(f,token,'tools/list'));assert.equal(list.result.tools.length,40);assert.equal(list.result.tools.filter(x=>x.annotations.readOnlyHint).length,31);assert.deepEqual(list.result.tools.filter(x=>!x.annotations.readOnlyHint&&!x.name.startsWith('psychology_videoHits_')).map(x=>x.name),['psychology_save_selected_topic_image','psychology_upload_topic_png','psychology_import_topic_image']);
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
 let downloads=0;f.env.fetch=async(url,init)=>{assert.equal(url,args.image.download_url);assert.equal(init.method,'GET');assert.equal(init.headers,undefined);downloads++;return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'));};
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
 const a=await authorize(f,true);const list=await json(await rpc(f,a.token.access_token,'tools/list'));assert.equal(list.result.tools.length,40);
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
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'),objects=new Map();
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
 // A local File uploads its bytes over MCP without any ChatGPT file/download helpers.
 const tab2=await browser.newPage();await tab2.setRequestInterception(true);tab2.on('request',r=>r.respond({status:200,contentType:'text/html',body:'<!doctype html>'}));await tab2.goto('https://fixture.test/');await tab2.exposeFunction('fixtureCall',async(name,args)=>(await json(await rpc(f,a.token.access_token,'tools/call',{name,arguments:args}))).result);
 await tab2.evaluate(data=>{window.openai={toolOutput:data,callTool:window.fixtureCall,setWidgetState:s=>{window.savedState=s;}};},{...prepared,draft:{...prepared.draft,requestId:crypto.randomUUID()}});
 await tab2.setContent(html);assert.equal(await tab2.$eval('#library',e=>e.disabled),true);assert.equal(await tab2.$eval('#upload',e=>e.disabled),false);
 await tab2.evaluate(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'local.png',{type:'image/png'}));const el=document.getElementById('file');el.files=transfer.files;el.dispatchEvent(new Event('change'));},[...png]);
 await tab2.waitForFunction(()=>!document.getElementById('save').disabled);await tab2.click('#save');await tab2.waitForFunction(()=>document.getElementById('status').textContent.includes('已写入成功'));assert.equal(downloads,1);assert.doesNotMatch(await tab2.evaluate(()=>JSON.stringify(window.savedState)),/imageBase64|downloadUrl/);

 // After remount, local bytes are not persisted; reselecting the same file restores a safe retry.
 await tab2.evaluate(()=>{window.openai.widgetState=window.savedState;});await tab2.setContent(html);
 assert.equal(await tab2.$eval('#save',e=>e.disabled),true);assert.equal(await tab2.$eval('#upload',e=>e.disabled),false);
 await tab2.evaluate(()=>{const d=new DataTransfer();d.items.add(new File(['other'],'other.png',{type:'image/png'}));const e=document.getElementById('file');e.files=d.files;e.dispatchEvent(new Event('change'));});
 await tab2.waitForFunction(()=>document.getElementById('status').textContent.includes('同一张图片'));
 assert.equal(await tab2.$eval('#save',e=>e.disabled),true);
 await tab2.evaluate(bytes=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],'local.png',{type:'image/png'}));const e=document.getElementById('file');e.files=d.files;e.dispatchEvent(new Event('change'));},[...png]);
 await tab2.waitForFunction(()=>!document.getElementById('save').disabled);await tab2.click('#save');await tab2.waitForFunction(()=>document.getElementById('status').textContent.includes('已写入成功'));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,2);assert.equal(downloads,1);
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
 assert.equal(downloads,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,3);
 await frame.click('#check');await frame.waitForFunction(()=>document.getElementById('status').textContent.includes('已写入成功'));
 assert.equal(downloads,2);assert.equal(await frame.$eval('#save',e=>e.disabled),true);
 assert.ok((await host.evaluate(()=>window.bridgeMethods)).includes('ui/notifications/size-changed'));
 // Keep a local screenshot for visual review; no production/user data is used.
 if(process.env.MCP_PICKER_SCREENSHOT)await host.screenshot({path:process.env.MCP_PICKER_SCREENSHOT,fullPage:true});
 // Oversized/local-invalid selection makes no Factory call, and can be corrected.
 await tab2.evaluate(id=>{window.openai.toolOutput.draft.requestId=id;},crypto.randomUUID());
 await tab2.setContent(html);
 await tab2.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['not a png'],'failed.jpg',{type:'image/jpeg'}));const el=document.getElementById('file');el.files=transfer.files;el.dispatchEvent(new Event('change'));});
 await tab2.waitForFunction(()=>document.getElementById('status').textContent.includes('不超过 8 MB'));
 assert.equal(await tab2.$eval('#save',e=>e.disabled),true);assert.equal(await tab2.$eval('#upload',e=>e.disabled),false);assert.equal(downloads,2);
 assert.equal(f.requests.length,0);
});


test('MCP file host errors include a visible code and Blob host reaches bounded download',async t=>{
 const f=await setup(t),a=await authorize(f,true),draft={requestId:crypto.randomUUID(),title:'Blob retry',content:'Reflection'};
 const invoke=async url=>(await json(await rpc(f,a.token.access_token,'tools/call',{name:'psychology_import_topic_image',arguments:{...draft,image:{file_id:'file-blob',download_url:url}}}))).result;
 const denied=await invoke('https://unrelated.blob.core.windows.net/image.png?sig=private-test');
 assert.equal(denied.isError,true);assert.equal(denied.structuredContent.errorCode,'FILE_HOST_NOT_ALLOWED');assert.match(denied.content[0].text,/\[FILE_HOST_NOT_ALLOWED\]/);assert.doesNotMatch(JSON.stringify(denied),/private-test/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 f.env.ARCHIVE={};let calls=0;f.env.ARCHIVE.head=async()=>null;
 f.env.fetch=async()=>{calls++;return new Response('expired',{status:403});};
 const expired=await invoke('https://oaisdmntprwestus.blob.core.windows.net/image.png?sig=private-test');
 assert.equal(calls,1);assert.equal(expired.isError,true);assert.equal(expired.structuredContent.errorCode,'FILE_HTTP_403');assert.match(expired.content[0].text,/\[FILE_HTTP_403\]/);assert.doesNotMatch(JSON.stringify(expired),/private-test/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,0);assert.equal(f.requests.length,0);
});


test('byte upload is app-only and requires current OAuth write consent',async t=>{
 const f=await setup(t),a=await authorize(f),args={requestId:crypto.randomUUID(),title:'Local PNG',content:'Reflection',imageBase64:'YQ=='};
 const list=(await json(await rpc(f,a.token.access_token,'tools/list'))).result.tools,tool=list.find(x=>x.name==='psychology_upload_topic_png');
 assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool._meta['openai/fileParams'],undefined);
 const denied=(await json(await rpc(f,a.token.access_token,'tools/call',{name:tool.name,arguments:args}))).result;
 assert.equal(denied.isError,true);assert.match(JSON.stringify(denied._meta),/insufficient_scope/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
});

const hitPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
async function videoSetup(t){
 const f=await setup(t),files=new Map();f.env.ARCHIVE={async put(k,b){files.set(k,new Uint8Array(b));},async get(k){return files.has(k)?{body:files.get(k)}:null;}};
 const {readFileSync}=await import('node:fs');
 f.env.ASSETS={async fetch(r){assert.equal(new URL(r.url).pathname,'/docs/psychology-video-hits-api.md');return new Response(readFileSync(new URL('../../public/docs/psychology-video-hits-api.md',import.meta.url),'utf8'));}};
 f.video=async(token,name,args)=>(await json(await rpc(f,token,'tools/call',{name:'psychology_videoHits_'+name,arguments:args}))).result;
 f.source={body:{externalId:'mcp-fixture',videoUrl:'https://www.tiktok.com/@fixture/video/123456789',title:'Original',script:'Original narration'}};
 const {handleFactoryApi}=await import('./factory-api.js');
 const user=toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 const keyReq=new Request(MCP_ORIGIN+'/api/factory-api/key',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 f.restKey=(await (await handleFactoryApi(keyReq,f.env,new URL(keyReq.url),{user})).json()).apiKey;
 f.rest=async(action,params,requestId)=>{const r=new Request(MCP_ORIGIN+'/api/v1/factory',{method:'POST',headers:{authorization:'Bearer '+f.restKey,'content-type':'application/json'},body:JSON.stringify({module:'psychology',action,params,...(requestId?{requestId}:{})})});return handleFactoryApi(r,f.env,new URL(r.url));};
 f.files=files;return f;
}
test('video-hit OAuth writes require separate consent, schemas disallow publish and permissions stay live',async t=>{
 const f=await videoSetup(t),read=await authorize(f),topic=await authorize(f,true),args={params:f.source,requestId:crypto.randomUUID()};
 const meta=await json(await f.fetch('/.well-known/oauth-protected-resource/mcp'));assert.ok(meta.scopes_supported.includes('factory.video_hits.write'));
 for(const a of [read,topic]){const r=await f.video(a.token.access_token,'create',args);assert.equal(r.isError,true);assert.equal(r.structuredContent.code,'INSUFFICIENT_SCOPE');assert.match(JSON.stringify(r._meta),/factory.video_hits.write/);}
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hits').get().n,0);
 const a=await authorize(f,'video'),token=a.token.access_token;
 const list=(await json(await rpc(f,token,'tools/list'))).result.tools;
 assert.ok(list.find(x=>x.name==='psychology_videoHits_create')._meta.securitySchemes[0].scopes.includes('factory.video_hits.write'));
 assert.ok(!list.some(x=>/videoHits_(publish|render|archive)$/.test(x.name)));
 const file=list.find(x=>x.name==='psychology_videoHits_assets_upload_file');assert.deepEqual(file._meta['openai/fileParams'],['image']);assert.deepEqual(file.inputSchema.properties.image.required,['download_url','file_id']);
 for(const key of ['mime_type','file_name'])assert.ok(file.inputSchema.properties.image.properties[key]);
 assert.equal((await f.video(token,'create',{...args,ownerId:'other'})).isError,true);
 assert.equal((await f.video(token,'create',args)).isError,false);
 assert.match(await (await f.browser('/factory-mcp')).text(),/视频爆款素材写入/);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-topic-bank']));
 const removed=(await json(await rpc(f,token,'tools/list'))).result.tools;assert.ok(!removed.some(x=>x.name.startsWith('psychology_videoHits_')));
 assert.equal((await f.video(token,'create',args)).isError,true);
 const page=await f.browser('/oauth/authorize?'+a.query);assert.equal(page.status,403);
 assert.equal(f.requests.length,0);
});
test('REST and MCP share exact UUID receipts, revisions, frame bindings and safe readback',async t=>{
 const f=await videoSetup(t),a=await authorize(f,'video'),token=a.token.access_token,requestId=crypto.randomUUID();
 const rest=await json(await f.rest('videoHits.create',f.source,requestId)),id=rest.id;
 const replay=await f.video(token,'create',{params:f.source,requestId});assert.equal(replay.isError,false);assert.equal(replay.structuredContent.id,id);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hits').get().n,1);
 assert.equal((await f.video(token,'create',{params:{body:{...f.source.body,title:'Changed'}},requestId})).structuredContent.httpStatus,409);
 const write=async(name,params)=>{const uuid=crypto.randomUUID(),r=await f.video(token,name,{params,requestId:uuid});assert.equal(r.isError,false,JSON.stringify(r));const action='videoHits.'+name.replaceAll('_','.');const repeated=await json(await f.rest(action,params,uuid));assert.equal(repeated.revision,r.structuredContent.revision);return r.structuredContent;};
 const uploadId=crypto.randomUUID();let r=await f.video(token,'assets_upload_bytes',{uploadId,contentType:'image/png',imageBase64:hitPng.toString('base64')});assert.equal(r.structuredContent.httpStatus,201);assert.equal(f.files.size,1);
 r=await f.video(token,'assets_get',{uploadId});assert.equal(r.structuredContent.status,'active');
 await write('frames_write',{id,version:'0',body:{revision:1,frames:[{index:1,assetId:uploadId,text:'Original frame'}]}});
 await write('versions_write',{id,version:'1',body:{revision:0,title:'Recreation',script:'Complete narration',enabled:false}});
 await write('frames_write',{id,version:'1',body:{revision:1,frames:[{index:1,assetId:uploadId,text:'New frame'}]}});
 await write('versions_write',{id,version:'1',body:{revision:2,enabled:true}});
 r=await f.video(token,'get',{params:{id}});assert.equal(r.structuredContent.versions[0].enabled,true);assert.equal(r.structuredContent.versions[0].revision,3);
 r=await f.video(token,'frames_list',{params:{id,version:'1',query:{page:1}}});assert.ok(JSON.stringify(r.structuredContent).includes(uploadId));
 r=await f.video(token,'requests_get',{requestId});assert.equal(r.structuredContent.state,'done');assert.equal(r.structuredContent.result.id,id);
 r=await f.video(token,'guide',{});assert.equal(r.structuredContent.writeAuthorized,true);assert.match(r.content[0].text,/psychology_videoHits_assets_upload_bytes/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);assert.equal(f.requests.length,0);
});
test('video-hit upload retries keep immutable identity and block unsafe files, redirects and cross-owner reads',async t=>{
 const f=await videoSetup(t),a=await authorize(f,'video'),token=a.token.access_token,uploadId=crypto.randomUUID(),image={file_id:'file-fixture',download_url:'https://files.oaiusercontent.com/test.png?sig=fixture'};
 let downloads=0;f.env.fetch=async(u,init)=>{downloads++;assert.equal(init.redirect,'manual');assert.equal(init.headers,undefined);return new Response(hitPng,{headers:{'content-type':'image/png'}});};
 const first=await f.video(token,'assets_upload_file',{uploadId,image});assert.equal(first.isError,false,JSON.stringify(first));assert.equal(downloads,1);
 let r=await f.video(token,'assets_upload_bytes',{uploadId,contentType:'image/png',imageBase64:hitPng.toString('base64')});assert.equal(r.structuredContent.duplicate,true);assert.equal(f.files.size,1);
 r=await f.video(token,'assets_upload_file',{uploadId:crypto.randomUUID(),image:{...image,download_url:'http://127.0.0.1/file'}});assert.equal(r.isError,true);assert.equal(downloads,1);
 f.env.fetch=async()=>new Response(null,{status:302,headers:{location:'https://evil.example/secret'}});
 r=await f.video(token,'assets_upload_file',{uploadId:crypto.randomUUID(),image});assert.equal(r.isError,true);assert.equal(f.files.size,1);
 r=await f.video(token,'assets_upload_bytes',{uploadId:crypto.randomUUID(),contentType:'image/png',imageBase64:Buffer.from('not png').toString('base64')});assert.equal(r.isError,true);assert.equal(f.files.size,1);
 f.sqlite.prepare("UPDATE psychology_video_hit_assets SET owner_id='other'").run();r=await f.video(token,'assets_get',{uploadId});assert.equal(r.structuredContent.httpStatus,404);
 r=await f.video(token,'assets_upload_bytes',{uploadId,contentType:'image/png',imageBase64:hitPng.toString('base64')});assert.equal(r.structuredContent.httpStatus,409);
 assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM factory_ai_requests').all()).includes('sig=fixture'));
 const count=f.sqlite.prepare('SELECT COUNT(*) n FROM factory_mcp_connections').get().n;assert.ok(count>0);f.sqlite.prepare('UPDATE factory_mcp_connections SET revoked_at=1').run();assert.equal((await rpc(f,token,'tools/list')).status,401);
});
test('MCP request receipts do not expose other operations and failed source revisions stay unchanged',async t=>{
 const f=await videoSetup(t),a=await authorize(f,'video'),token=a.token.access_token,requestId=crypto.randomUUID();
 const created=await json(await f.rest('videoHits.create',f.source,crypto.randomUUID()));
 const args={params:{id:created.id,body:{revision:99,title:'Stale'}},requestId};
 let r=await f.video(token,'update',args);assert.equal(r.structuredContent.httpStatus,409);
 r=await f.video(token,'requests_get',{requestId});assert.equal(r.structuredContent.state,'done');assert.equal(r.structuredContent.status,409);
 r=await f.video(token,'get',{params:{id:created.id}});assert.equal(r.structuredContent.source.title,'Original');
 f.sqlite.prepare("UPDATE factory_ai_requests SET action='videoHits.publish' WHERE request_id=?").run(requestId);
 r=await f.video(token,'requests_get',{requestId});assert.equal(r.structuredContent.httpStatus,403);assert.equal(r.structuredContent.result,undefined);
 f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='someone-else'").run();r=await f.video(token,'get',{params:{id:created.id}});assert.equal(r.structuredContent.httpStatus,404);
 assert.equal(f.requests.length,0);
});
test('public guide is anonymous, exact and read-only; MCP transport bounds streamed payloads',async t=>{
 const f=await videoSetup(t),{default:worker}=await import('./index.js'),{readFileSync}=await import('node:fs');
 const r=await worker.fetch(new Request(MCP_ORIGIN+'/docs/psychology-video-hits-api.md'),f.env,{});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/markdown/);
 assert.equal(await r.text(),readFileSync(new URL('../../docs/psychology-video-hits-api.md',import.meta.url),'utf8').replace(/\r\n/g,'\n'));
 assert.equal((await worker.fetch(new Request(MCP_ORIGIN+'/docs/psychology-video-hits-api.md',{method:'POST'}),f.env,{})).status,405);
 const a=await authorize(f,'video');const bytes=new Uint8Array(13*1024*1024),body=new ReadableStream({start(c){c.enqueue(bytes);c.close();}});
 const large=await f.worker.fetch(new Request(MCP_ORIGIN+'/mcp',{method:'POST',duplex:'half',headers:{authorization:'Bearer '+a.token.access_token,'content-type':'application/json'},body}),f.env,{waitUntil(){}});assert.equal(large.status,413);
});

test('video-hit picker uploads a real >128KB file through OAuth MCP and confirms its asset',async t=>{
 const f=await videoSetup(t),a=await authorize(f,'video'),token=a.token.access_token,uploadId=crypto.randomUUID();
 const {default:fs}=await import('node:fs'),{default:os}=await import('node:os'),{default:path}=await import('node:path'),{pngCrc}=await import('./topic-png.js');
 const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(x=>fs.existsSync(x));
 if(!executablePath){t.diagnostic('Chrome unavailable; protocol upload covered separately.');return;}
 const data=Buffer.alloc(140000,65),chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write('tEXt',4);data.copy(chunk,8);chunk.writeUInt32BE(pngCrc(chunk.subarray(4,-4)),chunk.length-4);
 const png=Buffer.concat([hitPng.subarray(0,-12),chunk,hitPng.subarray(-12)]),dir=fs.mkdtempSync(path.join(os.tmpdir(),'factory-mcp-video-')),file=path.join(dir,'real.png');fs.writeFileSync(file,png);t.after(()=>{fs.unlinkSync(file);fs.rmdirSync(dir);});
 const prepared=await f.video(token,'prepare_image_upload',{uploadId});assert.equal(prepared.structuredContent.status,'awaiting_image');assert.equal(f.files.size,0);
 const {VIDEO_HIT_IMPORT_UI}=await import('./video-hit-import-widget.js'),resource=await json(await rpc(f,token,'resources/read',{uri:VIDEO_HIT_IMPORT_UI}));
 const {default:puppeteer}=await import('puppeteer-core'),browser=await puppeteer.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('fixtureCall',async(name,args)=>{assert.ok(name.startsWith('psychology_videoHits_'));return (await json(await rpc(f,token,'tools/call',{name,arguments:args}))).result;});
 await page.evaluateOnNewDocument(({uploadId})=>{window.openai={toolOutput:{uploadId},callTool:(name,args)=>window.fixtureCall(name,args)};},{uploadId});
 await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:resource.result.contents[0].text}));
 await page.goto(MCP_ORIGIN+'/widget-fixture');await (await page.$('#file')).uploadFile(file);await page.click('#save');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('图片已保存'));
 await page.setViewport({width:390,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);const captures=new URL('../../tmp/video-hits-mcp-qa/',import.meta.url);fs.mkdirSync(captures,{recursive:true});await page.screenshot({path:path.join(path.resolve(captures.pathname.replace(/^\/([A-Z]:)/,'$1')),'image-upload-mobile.png')});
 assert.equal(f.files.size,1);assert.deepEqual(Buffer.from([...f.files.values()][0]),png);assert.deepEqual(errors,[]);
 const saved=await f.video(token,'assets_get',{uploadId});assert.equal(saved.structuredContent.status,'active');assert.equal(saved.structuredContent.size,png.length);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_video_hits').get().n,0);assert.equal(f.requests.length,0);
});


test('MCP advertises and executes importSource writes and list filters across REST receipts',async t=>{
 const f=await videoSetup(t),a=await authorize(f,'video'),token=a.token.access_token;
 const list=(await json(await rpc(f,token,'tools/list'))).result.tools;
 assert.ok(list.find(x=>x.name==='psychology_videoHits_create').inputSchema.properties.params.properties.body.properties.importSource);
 assert.ok(list.find(x=>x.name==='psychology_videoHits_list').inputSchema.properties.params.properties.query.properties.importSource);
 const params={body:{...f.source.body,importSource:'GPT-Dot'}},requestId=crypto.randomUUID();
 const made=await f.video(token,'create',{params,requestId});assert.equal(made.isError,false);const id=made.structuredContent.id;
 assert.equal((await json(await f.rest('videoHits.create',params,requestId))).id,id);
 const r=await f.video(token,'list',{params:{query:{importSource:'gpt-dot'}}});assert.equal(r.isError,false);assert.equal(r.structuredContent.total,1);assert.equal(r.structuredContent.items[0].importSource,'gpt-dot');
 assert.equal((await f.video(token,'list',{params:{query:{importSource:'grokbot'}}})).structuredContent.total,0);assert.equal((await f.video(token,'list',{params:{query:{importSource:''}}})).structuredContent.total,1);
 const update=await f.video(token,'update',{params:{id,body:{revision:1,importSource:'future.agent'}},requestId:crypto.randomUUID()});assert.equal(update.isError,false);
 assert.equal((await f.video(token,'get',{params:{id}})).structuredContent.source.importSource,'future.agent');assert.equal(f.requests.length,0);
});
