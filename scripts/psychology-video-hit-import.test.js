import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {normalizePhotoImport,createPhotoImportSession} from '../public/psychology-video-hit-import-model.js';
import {fixture} from '../factory-cloud/src/psychology-cloud-test-fixture.js';
import {handleVideoHits} from '../factory-cloud/src/psychology-video-hits.js';
import {handleVideoHitAssets} from '../factory-cloud/src/psychology-video-hit-assets.js';
import {toPublicUser} from '../factory-cloud/src/auth.js';
import {canAccessPath,moduleIdForPath,publicSidebarModules} from '../factory-cloud/src/sidebar.js';
import {pageFileFor,isPublicPath} from '../factory-cloud/src/pages.js';
const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const image=name=>({file:new File([png],name+'.png',{type:'image/png'}),text:name});
const input=(extra={})=>({sourceMode:'new',importSource:'gpt-dot',videoUrl:'https://www.tiktok.com/@source/video/123456789',originalTitle:'Source title',title:'Recreated title',caption:'Saved caption',images:[image('one'),image('two')],originals:[],...extra});
async function setup(t){
 const f=await fixture(t),files=new Map(),writes=[],uploads=[];
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-video-hits']));
 const actor=()=>toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 f.env.ARCHIVE={async put(k,b){files.set(k,b instanceof ReadableStream?new Uint8Array(await new Response(b).arrayBuffer()):new Uint8Array(b));return {};},async get(k){return files.has(k)?{body:files.get(k),size:files.get(k).length}:null;},async head(k){return files.has(k)?{}:null;},async delete(k){files.delete(k);}};
 const handle=async r=>{const url=new URL(r.url);return await handleVideoHitAssets(r,f.env,url,{user:actor()})||await handleVideoHits(r,f.env,url,{user:actor()});};
 const request=async(p,method='GET',body)=>{if(method!=='GET')writes.push({path:p,method,body});const r=new Request('https://factory.test/api/psychology-video-hits'+p,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const response=await handle(r),data=await response.json();if(!response.ok)throw Error(data.error);return data;};
 const upload=async(id,file,type)=>{uploads.push(id);const response=await handle(new Request('https://factory.test/api/psychology-video-hits/assets/'+id,{method:'PUT',headers:{'Content-Type':type},body:await file.arrayBuffer()}));return response.json();};
 const counts=()=>Object.fromEntries(['psychology_video_hits','psychology_video_hit_versions','psychology_video_hit_frames','factory_jobs','psychology_publish_batches'].map(table=>[table,f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n]));
 return {...f,files,writes,uploads,request,upload,handle,actor,counts};
}
test('import validates before writes, defaults to disabled frames and accepts custom provenance',()=>{
 const normalized=normalizePhotoImport(input({importSource:' Bot.New ',originals:[image('original')]}));assert.equal(normalized.source.importSource,'bot.new');assert.equal(normalized.version.enabled,false);assert.equal(normalized.version.inputMode,'frames');assert.equal(normalized.version.script,'');
 for(const extra of [{images:[]},{images:Array.from({length:16},()=>image('x'))},{images:[{file:new File(['bad'],'x.gif',{type:'image/gif'})}]},{images:[{imageUrl:'http://invalid.local/a.png'}]},{videoUrl:'https://example.com/video'},{importSource:'bad label'},{sourceMode:'existing',sourceId:'foreign'}])assert.throws(()=>normalizePhotoImport(input(extra)));
});
test('new source image import survives a lost commit response without duplicates or publication',async t=>{
 const f=await setup(t);let lose=true;
 const request=async(p,method,body)=>{const result=await f.request(p,method,body);if(method==='PUT'&&p.endsWith('/frames/1')&&lose){lose=false;throw Error('lost frame response');}return result;};
 const session=createPhotoImportSession(normalizePhotoImport(input({originals:[image('original-one'),image('original-two')]})),{request,upload:f.upload});
 await assert.rejects(session.run(),/lost frame response/);const result=await session.run();assert.equal(result.frameCount,2);
 assert.deepEqual(f.counts(),{psychology_video_hits:1,psychology_video_hit_versions:1,psychology_video_hit_frames:4,factory_jobs:0,psychology_publish_batches:0});
 assert.equal(f.uploads.length,4);const frameWrites=f.writes.filter(w=>w.path.endsWith('/frames/1'));assert.equal(frameWrites.length,2);assert.deepEqual(frameWrites[0].body,frameWrites[1].body);
 const detail=await f.request('/'+result.id);assert.equal(detail.source.importSource,'gpt-dot');assert.equal(detail.versions[0].enabled,false);assert.equal(detail.source.revision,2);
 assert.deepEqual((await f.request('/'+result.id+'/frames/1')).frames.map(f=>f.text),['one','two']);
});
test('failed upload retries the same UUID and reuses completed uploads',async t=>{
 const f=await setup(t);let fail=true;const calls=[];
 const upload=async(id,file,type)=>{calls.push(id);const result=await f.upload(id,file,type);if(calls.length===2&&fail){fail=false;throw Error('upload timeout');}return result;};
 const session=createPhotoImportSession(normalizePhotoImport(input()),{request:f.request,upload});await assert.rejects(session.run(),/upload timeout/);assert.equal(f.counts().psychology_video_hits,0);
 await session.run();assert.equal(calls.length,3);assert.equal(calls[1],calls[2]);assert.equal(f.files.size,2);assert.equal(f.counts().psychology_video_hits,1);
});
test('existing source adds its next version without rewriting original content or provenance',async t=>{
 const f=await setup(t),first=await createPhotoImportSession(normalizePhotoImport(input({importSource:'grokbot'})),{request:f.request,upload:f.upload}).run();
 const before=(await f.request('/'+first.id)).source;
 const session=createPhotoImportSession(normalizePhotoImport(input({sourceMode:'existing',sourceId:first.id,images:[{imageUrl:'https://cdn.example.org/recreated.png',text:'Link frame'}]})),{request:f.request,upload:f.upload});
 const [a,b]=await Promise.all([session.run(),session.run()]);assert.equal(a.version,2);assert.deepEqual(a,b);assert.deepEqual((await f.request('/'+first.id)).source,before);assert.equal(f.counts().psychology_video_hits,1);assert.equal(f.counts().psychology_video_hit_versions,2);
});
test('full, archived, unowned and revoked imports do not create versions',async t=>{
 const f=await setup(t),first=await createPhotoImportSession(normalizePhotoImport(input()),{request:f.request,upload:f.upload}).run();
 for(let n=2;n<=20;n++)await f.request('/'+first.id+'/versions/'+n,'PUT',{requestId:crypto.randomUUID(),revision:0,title:'Other '+n});
 const session=()=>createPhotoImportSession(normalizePhotoImport(input({sourceMode:'existing',sourceId:first.id})),{request:f.request,upload:f.upload});
 await assert.rejects(session().run(),/20/);assert.equal(f.uploads.length,2);
 f.sqlite.prepare('UPDATE psychology_video_hits SET archived_at=1 WHERE id=?').run(first.id);await assert.rejects(session().run(),/归档/);
 f.sqlite.prepare("UPDATE psychology_video_hits SET owner_id='other' WHERE id=?").run(first.id);await assert.rejects(session().run(),/无权/);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();await assert.rejects(createPhotoImportSession(normalizePhotoImport(input()),{request:f.request,upload:f.upload}).run(),/权限/);assert.equal(f.counts().psychology_video_hit_versions,20);assert.equal(f.counts().factory_jobs,0);
});
test('import page and direct HTML require the explicit Video Hits module',()=>{
 const member={role:'operator',sidebarModules:['psychology-video-hits']};
 for(const url of ['/psychology-video-hits/import','/psychology-video-hit-import.html']){assert.equal(canAccessPath(member,url),true);assert.equal(moduleIdForPath(url),'psychology-video-hits');assert.equal(canAccessPath({...member,sidebarModules:[]},url),false);assert.equal(canAccessPath(null,url),false);assert.equal(isPublicPath(url),false);}
 assert.equal(pageFileFor('/psychology-video-hits/import'),'psychology-video-hit-import.html');
});
test('browser imports ordered image-text through logged-in page controls and retries once',async t=>{
 const f=await setup(t),out=path.resolve(root,'../tmp/video-hit-import-qa');fs.mkdirSync(out,{recursive:true});
 const files=['first','second','third'].map(name=>{const file=path.join(out,name+'.png');fs.writeFileSync(file,png);return file;});
 let loseFrames=true;const external=[],errors=[],framesRequests=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);let response;
   if(url.pathname==='/api/auth/me')response=Response.json({user:f.actor(),sidebarModules:publicSidebarModules()});
   else if(url.pathname.startsWith('/api/psychology-video-hits')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),r=new Request(url,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})});response=await f.handle(r);
    if(req.method==='PUT'&&/\/frames\/1$/.test(url.pathname)){framesRequests.push(JSON.parse(bytes));if(loseFrames){loseFrames=false;response=Response.json({error:'Fixture response lost after commit'},{status:503});}}
   }else{
    const file=path.resolve(root,pageFileFor(url.pathname)||url.pathname.slice(1));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
    response=new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'}});
   }
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(e.statusCode||500,{'Content-Type':'application/json'}).end(JSON.stringify({error:e.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const {default:puppeteer}=await import('puppeteer-core'),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const p=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.setRequestInterception(true);p.on('request',r=>{if(r.url().startsWith(origin)||r.url().startsWith('blob:')||r.url().startsWith('data:'))r.continue();else{external.push(r.url());r.abort();}});
 await p.goto(origin+'/psychology-video-hits',{waitUntil:'networkidle0'});assert.equal(await p.$eval('#newSource',n=>n.textContent),'新增二创导入');await Promise.all([p.waitForNavigation({waitUntil:'networkidle0'}),p.click('#newSource')]);assert.match(p.url(),/\/import$/);
 assert.equal(await p.$eval('#importSource',n=>n.value),'gpt-dot');await p.type('#originalTitle','Psychology source');await p.type('#originalUrl','https://www.tiktok.com/@reference/video/123456789');await p.type('#remixTitle','Recreated image story');await p.type('#remixCaption','Saved English caption #psychology');
 await (await p.$('#remixFiles')).uploadFile(...files);await p.waitForFunction(()=>document.querySelectorAll('#remixImages article').length===3);await p.click('#remixImages [data-move="1"][data-direction="-1"]');await p.click('#remixImages [data-remove="2"]');await p.type('#remixImages [data-image-text="0"]','First visible text');
 for(const width of [1440,390,320]){await p.setViewport({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width,'import viewport overflow');await p.$eval('#remixImages',n=>n.scrollIntoView({block:'center'}));await p.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';scrollTo(0,0);});await p.screenshot({path:path.join(out,'import-'+width+'.png'),fullPage:true});}
 assert.equal(f.counts().psychology_video_hits,0);await p.click('#saveImport');await p.waitForFunction(()=>document.querySelector('#importStatus').textContent.includes('Fixture response lost'));assert.equal(await p.$eval('#importFields',n=>n.disabled),true);assert.equal(await p.$eval('#partialRecord',n=>n.hidden),false);
 await p.click('#saveImport');await p.waitForSelector('#importResult:not([hidden])');assert.match(await p.$eval('#resultSummary',n=>n.textContent),/2 张图片.*停用/);assert.deepEqual(framesRequests[0],framesRequests[1]);
 assert.equal(f.counts().psychology_video_hits,1);assert.equal(f.counts().psychology_video_hit_versions,1);assert.equal(f.counts().psychology_video_hit_frames,2);assert.equal(f.counts().factory_jobs,0);assert.equal(f.counts().psychology_publish_batches,0);
 const recordLink=await p.$eval('#openImported',n=>n.getAttribute('href'));assert.match(recordLink,/version=1/);assert.equal(f.sqlite.prepare('SELECT text FROM psychology_video_hit_frames ORDER BY frame_index').get().text,'First visible text');
 f.sqlite.prepare("UPDATE psychology_video_hits SET import_source='grokbot'").run();
 await Promise.all([p.waitForNavigation({waitUntil:'networkidle0'}),p.click('#importAnother')]);await p.waitForFunction(()=>document.querySelector('#existingSource').value.startsWith('vh-'));assert.equal(await p.$eval('#originalTitle',n=>n.disabled),true);assert.equal(await p.$eval('#importSource',n=>n.disabled),true);
 await p.waitForFunction(()=>document.querySelector('#importSource').value==='grokbot');await p.select('#sourceMode','new');assert.equal(await p.$eval('#importSource',n=>n.value),'gpt-dot','switching back to a new source restores the agent tag');await p.select('#sourceMode','existing');await p.waitForFunction(()=>document.querySelector('#importSource').value==='grokbot');
 await p.type('#remixTitle','Second recreation');await (await p.$('#remixFiles')).uploadFile(files[0]);await p.waitForFunction(()=>document.querySelectorAll('#remixImages article').length===1);await p.click('#saveImport');await p.waitForSelector('#importResult:not([hidden])');assert.match(await p.$eval('#resultSummary',n=>n.textContent),/版本 2/);assert.equal(f.counts().psychology_video_hits,1);assert.equal(f.counts().psychology_video_hit_versions,2);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});