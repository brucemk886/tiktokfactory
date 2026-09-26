import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import worker from './index.js';
import {handleAuth} from './auth.js';
import {UI_ASSETS} from './ui-asset-manifest.js';
import {serveUiAsset,uiAssetUrl,versionPageAssets} from './ui-assets.js';
const base='https://factory.test';
const req=(path,logged=true,method='GET')=>new Request(base+path,{method,headers:logged?{cookie:'lf_session=test-only'}:{}});
function db({active=1,expired=false,role='admin'}={}){
 const queries=[];const store={queries,prepare(sql){queries.push(sql);return {bind(){return this;},async first(){
  if(sql.includes('factory_sessions'))return {user_id:'one',expires_at:expired?1:Date.now()+60000};
  if(sql.includes('COUNT(*)'))return {count:1};
  if(sql.includes('factory_users'))return {id:'one',username:'admin',role,active};
  throw new Error('Unexpected SQL '+sql);
 }}}};return store;
}
const assets=()=>({fetch:async request=>new Response(request.url,{headers:{'Content-Type':'text/css','ETag':'test'}})});
test('tracked UI assets bypass D1, even with invalid cookies; other paths never enter the fast path',async()=>{
 const env={DB:{prepare(){throw new Error('Static request accessed database');}},ASSETS:assets()};
 for(const method of ['GET','HEAD']){
  const response=await worker.fetch(req('/app.css',true,method),env,{});assert.equal(response.status,200);
 }
 for(const path of ['/api/private.css','/psychology-publish','/psychology-auto-publish.html','/uploads/private.svg','/config.json','/psychology-topics.js'])assert.equal(await serveUiAsset(req(path),env,new URL(base+path)),null);
 assert.equal(await serveUiAsset(req('/app.css',true,'POST'),env,new URL(base+'/app.css')),null);
});
test('only matching content versions receive immutable caching; errors and wrong MIME are not cached',async()=>{
 for(const [query,expected] of [['','must-revalidate'],['?__asset=old','must-revalidate'],['?__asset='+UI_ASSETS['/app.css'],'immutable']]){
  const request=req('/app.css'+query);const response=await serveUiAsset(request,{ASSETS:assets()},new URL(request.url));
  assert.match(response.headers.get('Cache-Control'),new RegExp(expected));assert.equal((await response.text()).includes('__asset'),false);
 }
 for(const [status,type] of [[404,'text/css'],[200,'text/html'],[503,'text/css']]){
  const request=req('/app.css?__asset='+UI_ASSETS['/app.css']);const response=await serveUiAsset(request,{ASSETS:{fetch:async()=>new Response('error',{status,headers:{'Content-Type':type}})}},new URL(request.url));
  assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
});
test('HTML asset versions preserve query/fragment and never rewrite foreign URLs or private pages',()=>{
 assert.equal(uiAssetUrl('/app.css?v=old#part',base),'/app.css?v=old&__asset='+UI_ASSETS['/app.css']+'#part');
 for(const url of ['https://other.test/app.css','/api/auth/me','/accounts','/private.svg'])assert.equal(uiAssetUrl(url,base),url);
 const previous=globalThis.HTMLRewriter;const handlers=[];
 globalThis.HTMLRewriter=class{on(selector,handler){handlers.push([selector,handler]);return this;}transform(response){return response;}};
 try{
  const response=versionPageAssets(new Response('<html></html>',{headers:{'Content-Type':'text/html','ETag':'old'}}),req('/psychology-publish'));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.has('ETag'),false);
  let changed;handlers.find(([selector])=>selector==='script[src]')[1].element({getAttribute:()=>'/access.js',setAttribute:(name,value)=>{changed=value;}});
  assert.match(changed,/__asset=/);
 }finally{globalThis.HTMLRewriter=previous;}
});
test('unrelated routes skip auth handling; ordinary API request checks session and user only once',async()=>{
 const database=db();const env={DB:database};const request=req('/api/not-implemented');
 assert.equal(await handleAuth(request,env,new URL(request.url)),null);assert.equal(database.queries.length,0);
 const response=await worker.fetch(request,env,{});assert.equal(response.status,501);
 assert.equal(database.queries.filter(sql=>sql.includes('factory_sessions')).length,1);
 assert.equal(database.queries.filter(sql=>sql.includes('factory_users')).length,1);
});
test('navigation identity omits unused profile queries; revocation and expiry remain effective on the next request',async()=>{
 const database=db();const env={DB:database};
 const response=await worker.fetch(req('/api/auth/me?view=navigation'),env,{});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).profiles,[]);assert.equal(database.queries.length,2);
 for(const settings of [{active:0},{expired:true}])assert.equal((await worker.fetch(req('/api/auth/me?view=navigation'),{DB:db(settings)},{})).status,401);
});
test('private page and direct HTML remain protected for GET and HEAD',async()=>{
 let assetReads=0;const env={DB:db(),ASSETS:{fetch:async()=>{assetReads++;return new Response('private');}}};
 for(const path of ['/psychology-publish','/psychology-auto-publish.html'])for(const method of ['GET','HEAD']){
  const response=await worker.fetch(req(path,false,method),env,{});assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'/login');
 }
 assert.equal((await worker.fetch(req('/psychology-publish',false,'POST'),env,{})).status,405);
 assert.equal(assetReads,0);
 const response=await worker.fetch(req('/psychology-publish'),{...env,DB:db({role:'operator'})},{});
 assert.equal(response.status,302);assert.equal(assetReads,0);
});
test('asset manifest matches tracked UI content and excludes private/runtime data',()=>{
 execFileSync(process.execPath,['factory-cloud/scripts/ui-asset-manifest.mjs','--check'],{cwd:new URL('../../',import.meta.url)});
 assert.ok(Object.keys(UI_ASSETS).length>50);
 for(const key of Object.keys(UI_ASSETS))assert.match(key,/^\/[^/]+\.(js|css)$|^\/vendor\/bootstrap-icons\/[^/]+\.svg$/);
});
