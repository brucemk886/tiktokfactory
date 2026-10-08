import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fixture} from '../factory-cloud/src/psychology-cloud-test-fixture.js';
import {handleVideoHits} from '../factory-cloud/src/psychology-video-hits.js';
import {handleVideoHitAssets} from '../factory-cloud/src/psychology-video-hit-assets.js';
import {handleVideoHitProduction} from '../factory-cloud/src/psychology-video-hit-production.js';
import {publicSidebarModules} from '../factory-cloud/src/sidebar.js';
import {toPublicUser} from '../factory-cloud/src/auth.js';
test('real browser creates source/version, uploads both frame images, enables/renders and checks desktop/mobile',async t=>{
 const f=await fixture(t),store=new Map();
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits','psychology-publish','psychology-copy-library','factory-api']));
 const user=toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 f.env.ARCHIVE={async put(k,b){store.set(k,new Uint8Array(b));},async get(k){return store.has(k)?{body:store.get(k)}:null;},async delete(k){store.delete(k);}};
 const root=path.resolve(new URL('../public/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
 const out=path.resolve(root,'../tmp/video-hits-qa');fs.mkdirSync(out,{recursive:true});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'),file=path.join(out,'frame.png');fs.writeFileSync(file,png);
 const errors=[],external=[];
 const server=http.createServer(async(req,res)=>{
  try{const address='http://127.0.0.1:'+server.address().port+req.url,url=new URL(address);let response;
   if(url.pathname==='/api/auth/me')response=Response.json({user,home:'/',sidebarModules:publicSidebarModules()});
   else if(url.pathname.startsWith('/api/psychology-video-hits')){const parts=[];for await(const part of req)parts.push(part);const r=new Request(address,{method:req.method,headers:req.headers,...(parts.length?{body:Buffer.concat(parts)}:{})});response=await handleVideoHitAssets(r,f.env,url,{user})||await handleVideoHitProduction(r,f.env,url,{user})||await handleVideoHits(r,f.env,url,{user});}
   else{const name=url.pathname==='/psychology-video-hits'?'psychology-video-hits.html':url.pathname.slice(1),target=path.resolve(root,name);if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}response=new Response(fs.readFileSync(target),{headers:{'Content-Type':target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.svg')?'image/svg+xml':'text/html'}});}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(e.statusCode||500,{'Content-Type':'application/json'}).end(JSON.stringify({error:e.message}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {default:puppeteer}=await import('puppeteer-core'),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const p=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;p.on('pageerror',e=>errors.push(e.message));await p.setRequestInterception(true);p.on('request',r=>{if(r.url().startsWith(origin)||r.url().startsWith('data:'))r.continue();else{external.push(r.url());r.abort();}});
 await p.setViewport({width:1440,height:1000});await p.goto(origin+'/psychology-video-hits',{waitUntil:'networkidle0'});
 await p.click('#apiButton');assert.match(await p.$eval('#apiInstructions',n=>n.textContent),/videoHits.publish/);await p.click('#apiDialog [data-close]');
 await p.click('#newSource');await p.type('[name=videoUrl]','https://www.tiktok.com/@source/video/123456789');await p.type('[name=title]','Synthetic psychology video');await p.type('[name=script]','Original video narration');await p.click('#sourceForm button');
 await p.waitForSelector('#workspace:not([hidden])');await p.click('#editVersion');await p.type('#versionForm [name=script]','A new narration for this version.');await p.click('#versionForm button');await p.waitForFunction(()=>!document.querySelector('#versionDialog').open);
 assert.equal(await p.$eval('#versionSelect',n=>n.options.length),20);
 for(const button of ['#addOriginal','#addRemix']){
  await p.click(button);await p.waitForSelector('#frameDialog[open]');await (await p.$('#frameForm input[type=file]')).uploadFile(file);await p.click('#frameForm button');await p.waitForFunction(()=>!document.querySelector('#frameDialog').open);
 }
 await p.click('#toggleVersion');await p.waitForFunction(()=>document.querySelector('#toggleVersion').textContent==='停用版本');assert.equal(await p.$eval('#renderVersion',n=>n.disabled),false);
 await p.waitForFunction(()=>document.querySelectorAll('.vh-images img').length===2&&[...document.querySelectorAll('.vh-images img')].every(i=>i.complete&&i.naturalWidth>0));
 await p.click('#renderVersion');await p.waitForFunction(()=>document.querySelector('#jobs').textContent.includes('等待合成'));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM factory_jobs WHERE type='psychology-video-remix'").get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);assert.equal(f.requests.length,0);
 for(const width of [1440,390,320]){
  await p.setViewport({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width,'viewport overflow');
  await p.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';scrollTo(0,0);});await p.screenshot({path:path.join(out,'workspace-'+width+'.png'),fullPage:true});
  await p.click('#editVersion');await p.waitForSelector('#versionDialog[open]');const bounds=await p.$eval('#versionDialog',d=>({x:d.getBoundingClientRect().x,right:d.getBoundingClientRect().right}));assert.ok(bounds.x>=0&&bounds.right<=width);await p.click('#versionDialog [data-close]');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
