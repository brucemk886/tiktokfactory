import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
import {SIDEBAR_MODULES,publicSidebarModules} from '../factory-cloud/src/sidebar.js';
import {VISUAL_STYLES} from '../public/psychology-visual-styles.js';
const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const chrome=[process.env.CHROME_PATH,process.env.PUPPETEER_EXECUTABLE_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
const routes={'/psychology-templates':'psychology-templates.html','/psychology':'psychology.html','/psychology-collage':'psychology-collage.html','/psychology-target-2':'psychology-narrative.html','/psychology-photo':'psychology-photo.html','/psychology-publish-designs':'psychology-creative.html'};
const settings={configured:true,kieConfigured:true,elevenLabsConfigured:true,elevenLabsVoiceId:'qa-voice',elevenLabsModelId:'eleven_multilingual_v2',backgroundMusicVolume:0.1};
const defaultUser={id:'qa-user',username:'Preview QA',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)};
async function fixture(t){
 const calls=[],errors=[],external=[];let user=defaultUser;
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');let body={};if(req.method!=='GET'&&req.method!=='HEAD'){let text='';for await(const chunk of req)text+=chunk;body=text?JSON.parse(text):{};}
  const send=(data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(u.pathname.startsWith('/api/')){
   calls.push({path:u.pathname,method:req.method,body});
   if(u.pathname==='/api/auth/me')return send({user,home:'/psychology-templates',sidebarModules:publicSidebarModules()});
   if(u.pathname==='/api/psychology/settings')return send(req.method==='GET'?settings:{settings});
   if(u.pathname==='/api/auto-tasks')return send(req.method==='GET'?{tasks:[]}:{task:{id:'qa-four',name:'QA uploaded choices'}});
   if(u.pathname==='/api/kie-ai')return send({tasks:[]});
   if(u.pathname==='/api/official-tiktok/publish-accounts')return send({project:{id:'psychology',name:'心理学'},groups:[{id:'qa-group',name:'QA',accountCount:2}],accounts:[1,2].map(i=>({connectionId:'qa-account-'+i,username:'demo_psych_'+i,displayName:'示例账号 '+i,groupName:'QA',groupId:'qa-group'}))});
   if(u.pathname==='/api/psychology-management/styles')return send({items:VISUAL_STYLES.map(s=>({...s,enabled:true})),active:20});
   if(u.pathname==='/api/psychology-management/api-key')return send({configured:false,availableScopes:[]});
   if(u.pathname.endsWith('/start'))return send({jobId:'qa-job'});
   if(u.pathname.includes('/progress/'))return send({status:'done',percent:100,message:'本地模拟成片完成',score:{score:88,dimensions:{structure:19,opening:18,pacing:17,scanability:13,retention:12,cta:9}},results:[{title:'QA result',duration:16,score:88,language:'en',quizType:'character-choice',fileName:'qa.mp4',videoUrl:'/qa-video.mp4',contactSheetUrl:'/psychology-template-previews/collage.png'}]});
   if(u.pathname==='/api/official-tiktok/photo-assets/upload')return send({assetKey:'qa-only-asset',contentType:'image/jpeg'});
   if(u.pathname==='/api/official-tiktok/photo-publish')return send({batchId:'qa-only-batch',message:'本地模拟提交完成'});
   res.statusCode=501;return send({error:'Unmocked fixture API '+u.pathname});
  }
  if(u.pathname==='/qa-video.mp4'){res.writeHead(204,{'Content-Type':'video/mp4'});res.end();return;}
  if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const relative=routes[u.pathname]||u.pathname.slice(1);const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--disable-background-networking','--no-first-run',...(process.platform==='linux'?['--no-sandbox']:[])]});t.after(()=>browser.close());
 async function open(route,width=1440){
  const context=await browser.createBrowserContext();const page=await context.newPage();await page.setViewport({width,height:1000,deviceScaleFactor:1});
  await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(base+'/')||request.url().startsWith('blob:')||request.url().startsWith('data:'))request.continue();else{external.push(request.url());request.abort();}});
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname);});
  await page.goto(base+route,{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.documentElement.dataset.sidebarReady==='true');
  return {page,close:()=>context.close()};
 }
 return {calls,errors,external,open,setUser:value=>user=value};
}
async function fill(page,selector,value){await page.$eval(selector,(n,value)=>{n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function upload(page,selector){await (await page.$(selector)).uploadFile(path.join(root,'psychology-template-previews/collage.png'));}
async function capture(page,id,records){
 const dir=process.env.PSYCHOLOGY_CREATION_CAPTURE_DIR;
 const measure=()=>page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,brokenImages:[...document.images].filter(i=>i.getAttribute('src')&&(!i.complete||!i.naturalWidth)).map(i=>i.getAttribute('src'))}));
 await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});await page.evaluate(async()=>{scrollTo(0,0);await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));});const desktop=await measure();assert.equal(desktop.scrollWidth,1440,id+' desktop overflow');assert.deepEqual(desktop.brokenImages,[]);
 if(dir){fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,id+'-desktop.png')});await page.screenshot({path:path.join(dir,id+'-fullpage.png'),fullPage:true});}
 await page.setViewport({width:390,height:900,deviceScaleFactor:1});await page.evaluate(async()=>{scrollTo(0,0);await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));});const mobile=await measure();assert.equal(mobile.scrollWidth,390,id+' mobile overflow');assert.deepEqual(mobile.brokenImages,[]);
 if(dir)await page.screenshot({path:path.join(dir,id+'-mobile.png'),fullPage:!id.includes('modal')});records.push({id,desktop,mobile});
}
test('creation workspaces retain real controls, scoped access, previews and mobile layouts',{skip:!chrome?'Chrome is unavailable; browser fixture skipped':false,timeout:120000},async t=>{
 const f=await fixture(t),records=[];let checks=0;
 await t.test('permission-owned template links and all five deployed example images',async()=>{
  let view=await f.open('/psychology-templates');let p=view.page;
  assert.equal(await p.$$eval('.hub-card:not([hidden])',n=>n.length),4);
  assert.equal(await p.$eval('[data-template-module="psychology"]',n=>new URL(n.href).pathname),'/psychology-topic-bank');
  assert.equal(await p.$$eval('.template-visual img',ns=>ns.filter(n=>n.complete&&n.naturalWidth).length),5);
  assert.equal(await p.$eval('.template-copy>b',n=>getComputedStyle(n).color),'rgb(255, 255, 255)');
  await capture(p,'templates',records);await view.close();
  f.setUser({...defaultUser,sidebarModules:['psychology','psychology-photo']});view=await f.open('/psychology-templates');p=view.page;
  assert.equal(await p.$$eval('.hub-card:not([hidden])',n=>n.length),2);assert.equal(await p.$eval('[data-template-module="psychology"]',n=>new URL(n.href).pathname),'/psychology');assert.equal(await p.$eval('#directVideoTools',n=>n.hidden),true);await view.close();f.setUser(defaultUser);checks++;
 });
 await t.test('four local upload summaries and aspect controls preserve actual queue payload',async()=>{
  const view=await f.open('/psychology'),p=view.page;await fill(p,'#question','Which image feels calming?');
  for(let i=0;i<4;i++){await upload(p,'#choiceFile'+i);await fill(p,'#choiceCopy'+i,'Choice '+i);}
  await p.waitForFunction(()=>[...document.querySelectorAll('.four-summary-grid img')].every(i=>!i.hidden&&i.naturalWidth));
  await fill(p,'#aspectRatio','16:9');assert.equal(await p.$eval('.preview-player-wrap',n=>n.classList.contains('is-landscape')),true);await fill(p,'#aspectRatio','9:16');
  await capture(p,'four-image',records);const before=f.calls.filter(c=>c.path==='/api/auto-tasks'&&c.method==='POST').length;
  await p.click('#createBtn');await p.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('已加入队列'));
  const queue=f.calls.filter(c=>c.path==='/api/auto-tasks'&&c.method==='POST');assert.equal(queue.length,before+1);assert.equal(queue.at(-1).body.generation.choiceImages.length,4);assert.equal(queue.at(-1).body.generation.aspectRatio,'9:16');assert.equal(queue.at(-1).body.publish.autoPublish,false);
  await (await p.$('#choiceFile0')).uploadFile();assert.equal(await p.$eval('#fourSummaryImage0',n=>n.hidden),true);assert.equal(await p.$eval('#fourSummaryEmpty0',n=>n.hidden),false);await view.close();checks++;
 });
 await t.test('single-image validates before calls and sends fixed uploaded-quiz/provider payload',async()=>{
  const view=await f.open('/psychology-target-2'),p=view.page;let start=()=>f.calls.filter(c=>c.path==='/api/psychology-narrative/start').length;
  await p.click('#startBtn');assert.match(await p.$eval('#statusText',n=>n.textContent),/四个选项/);assert.equal(start(),0);
  for(let i=0;i<4;i++)await fill(p,'#choiceCopy'+i,'Option '+i);await p.click('#startBtn');assert.match(await p.$eval('#statusText',n=>n.textContent),/上传一张/);assert.equal(start(),0);
  await upload(p,'#sourceImageFile');await p.waitForFunction(()=>document.querySelector('#singleSummaryImage').naturalWidth>0);assert.equal(await p.$eval('#statusText',n=>n.textContent),'准备生成');assert.equal(await p.$eval('#statusText',n=>n.classList.contains('error')),false);await fill(p,'#kokoroVoice','bf_emma');await fill(p,'#targetDuration','18');await fill(p,'#totalVideos','2');await capture(p,'single-image',records);
  let confirmation='';p.on('dialog',async d=>{confirmation=d.message();await d.accept();});await p.click('#startBtn');await p.waitForFunction(()=>document.querySelector('#resultList .psy-result-card'));
  let call=f.calls.filter(c=>c.path==='/api/psychology-narrative/start').at(-1);assert.equal(call.body.quizType,'character-choice');assert.equal(call.body.choices.length,4);assert.match(call.body.sourceImage.dataUrl,/^data:image\/png;base64,/);assert.equal(call.body.language,'en');assert.equal(call.body.kokoroVoice,'bf_emma');assert.equal(call.body.targetDuration,18);assert.equal(call.body.totalVideos,2);assert.match(confirmation,/不再调用生图/);assert.match(confirmation,/本机 Kokoro/);
  assert.equal(await p.$eval('#previewEmpty',n=>n.classList.contains('is-hidden')),true);assert.equal(await p.$eval('#previewVideo',n=>n.classList.contains('is-hidden')),false);assert.equal(await p.$eval('#downloadLink',n=>n.classList.contains('is-hidden')),false);
  await fill(p,'#script','请选择让你感到平静的画面。');const chineseStart=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/psychology-narrative/start');await p.click('#startBtn');await chineseStart;await p.waitForFunction(()=>!document.querySelector('#startBtn').disabled);call=f.calls.filter(c=>c.path==='/api/psychology-narrative/start').at(-1);assert.equal(call.body.language,'zh-CN');assert.equal(call.body.elevenLabsVoiceId,'qa-voice');assert.match(confirmation,/ElevenLabs/);assert.equal(start(),2);
  await p.evaluate(()=>renderJob({status:'done',percent:100}));assert.match(await p.$eval('#statusText',n=>n.textContent),/已完成/);
  await p.evaluate(()=>renderJob({status:'canceled'}));assert.match(await p.$eval('#statusText',n=>n.textContent),/已取消/);
  await p.evaluate(()=>renderJob({status:'failed',error:'真实作业错误'}));await fill(p,'#choiceCopy0','Updated option');assert.equal(await p.$eval('#statusText',n=>n.textContent),'真实作业错误');assert.equal(await p.$eval('#statusText',n=>n.classList.contains('error')),true);
  await p.evaluate(()=>renderJob({status:'done',message:'服务器自定义完成提示'}));assert.equal(await p.$eval('#statusText',n=>n.textContent),'服务器自定义完成提示');
  await p.$eval('#sourceImageFile',n=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(8*1024*1024+1)],'too-big.png',{type:'image/png'}));n.files=transfer.files;n.dispatchEvent(new Event('change',{bubbles:true}));});await p.click('#startBtn');assert.match(await p.$eval('#statusText',n=>n.textContent),/8 MB/);assert.equal(start(),2);await upload(p,'#sourceImageFile');assert.equal(await p.$eval('#statusText',n=>n.textContent),'准备生成');assert.equal(start(),2);await view.close();checks++;
 });
 await t.test('collage API settings, native reference, completed score and original result links',async()=>{
  const view=await f.open('/psychology-collage'),p=view.page;assert.equal(await p.$eval('#targetDuration',n=>[n.min,n.max,n.value].join('/')),'60/120/90');assert.equal(await p.$eval('#sceneCount',n=>[n.min,n.max].join('/')),'8/12');assert.equal(await p.$eval('.collage-models input:checked+span',n=>getComputedStyle(n).backgroundColor),'rgb(239, 246, 255)');await capture(p,'collage',records);
  await p.evaluate(()=>render({status:'canceled'}));assert.match(await p.$eval('#statusText',n=>n.textContent),/已取消/);assert.match(await p.$eval('#jobMessage',n=>n.textContent),/已取消/);
  await p.evaluate(()=>render({status:'failed',error:'服务器错误详情'}));assert.equal(await p.$eval('#statusText',n=>n.textContent),'服务器错误详情');assert.equal(await p.$eval('#jobMessage',n=>n.textContent),'服务器错误详情');
  await p.evaluate(()=>render({status:'canceled',message:'服务器自定义取消提示'}));assert.equal(await p.$eval('#statusText',n=>n.textContent),'服务器自定义取消提示');assert.equal(await p.$eval('#jobMessage',n=>n.textContent),'服务器自定义取消提示');
  await p.evaluate(()=>render({status:'done',percent:100,score:{score:88,dimensions:{structure:19,opening:18,pacing:17,scanability:13,retention:12,cta:9}},results:[{duration:90,score:88,videoUrl:'/qa-video.mp4',contactSheetUrl:'/psychology-template-previews/collage.png'}]}));
  assert.match(await p.$eval('#statusText',n=>n.textContent),/已完成/);assert.match(await p.$eval('#jobMessage',n=>n.textContent),/已完成/);assert.equal(await p.$eval('#progressPercent',n=>n.textContent),'100%');assert.match(await p.$eval('#scorePanel',n=>n.textContent),/88\/100/);assert.deepEqual(await p.$$eval('#resultList a',ns=>ns.map(n=>n.textContent)),['打开成片','五帧联系表']);await capture(p,'collage-result',records);await view.close();checks++;
 });
 await t.test('photo modes, local card renderer and one-account publication remain intact',async()=>{
  const view=await f.open('/psychology-photo'),p=view.page;assert.equal(await p.$$eval('.publish-account',ns=>ns.length),2);await capture(p,'photo',records);
  await p.click('#stockModeTab');assert.equal(await p.$eval('#stockPane',n=>n.hidden),false);assert.equal(await p.$eval('#zimagePane',n=>n.hidden),true);await capture(p,'photo-stock',records);
  await p.click('#textModeTab');await fill(p,'#cardTitle','A calmer kind of closeness');await fill(p,'#cardBody','You can need space and still care deeply.');await p.click('#renderCardBtn');await p.waitForSelector('.photo-pick input');await capture(p,'photo-text',records);
  assert.equal(await p.$$eval('.publish-account:checked',ns=>ns.length),1);await p.click('.publish-account[value="qa-account-2"]');assert.equal(await p.$$eval('.publish-account:checked',ns=>ns.length),1);await fill(p,'#musicSoundId','12345');assert.equal(await p.$eval('#autoAddMusic',n=>n.checked),false);
  await p.click('#publishBtn');await p.waitForFunction(()=>document.querySelector('#publishResult').textContent.includes('本地模拟提交完成'));const call=f.calls.find(c=>c.path==='/api/official-tiktok/photo-publish');assert.equal(call.body.connectionId,'qa-account-2');assert.equal(call.body.assets.length,1);assert.equal(call.body.musicSoundId,'12345');assert.equal(call.body.autoAddMusic,false);assert.equal(call.body.photoCoverIndex,0);await view.close();checks++;
 });
 await t.test('all twenty managed renderer pairs contain content and real modal remains usable',async()=>{
  const view=await f.open('/psychology-publish-designs'),p=view.page;await p.waitForSelector('.style-card canvas');assert.equal(await p.$$eval('.style-card',ns=>ns.length),20);assert.equal(await p.$$eval('.style-pair canvas',ns=>ns.length),40);
  assert.equal(await p.$$eval('.style-pair canvas',ns=>ns.every(n=>{const data=n.getContext('2d').getImageData(0,0,n.width,n.height).data;const colors=new Set();for(let i=0;i<data.length;i+=128)colors.add(data[i]+','+data[i+1]+','+data[i+2]);return colors.size>1;})),true);await capture(p,'styles',records);
  await p.click('[data-preview="letter"]');assert.equal(await p.$eval('#styleDialog',n=>n.open),true);assert.equal(await p.$$eval('#previewCards canvas',ns=>ns.length),2);await capture(p,'styles-modal',records);await p.click('#closeStyle');assert.equal(await p.$eval('#styleDialog',n=>n.open),false);await view.close();checks++;
 });
 assert.equal(checks,6,'All meaningful browser subtests must pass before producing QA evidence');assert.deepEqual(f.external,[]);assert.deepEqual(f.errors,[]);if(process.env.PSYCHOLOGY_CREATION_CAPTURE_DIR)fs.writeFileSync(path.join(process.env.PSYCHOLOGY_CREATION_CAPTURE_DIR,'qa.json'),JSON.stringify({pass:true,localFixture:true,productionRequests:0,pages:records,errors:f.errors,external:f.external,mutations:f.calls.filter(c=>c.method==='POST').map(c=>({path:c.path,fixtureOnly:true}))},null,2));
});
