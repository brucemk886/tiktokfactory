import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {SIDEBAR_MODULES} from '../factory-cloud/src/sidebar.js';
import {AUTO_TEMPLATES} from './psychology-auto-publish.js';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'psy-selection-')),clip=path.join(tmp,'sample.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=180x320:d=1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',clip]);
let bulkMode=false,bulkEmpty=false;let coverActive=0,coverPeak=0,allowMissingCover=false;const coverStarts=[];
const bytes=fs.readFileSync(clip),calls=[],errors=[],project='7693454687705595917';let imported=false,uploaded=false;const joined=new Set(),joinAttempts=new Map();
const video=(id,title)=>({id,title,fileName:id+'.mp4',previewUrl:'/clip.mp4',createdAt:Date.now(),fileSize:bytes.length,status:'ready'});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');const body=[];for await(const c of req)body.push(c);const raw=Buffer.concat(body);calls.push({path:url.pathname,method:req.method,body:req.headers['content-type']==='application/json'&&raw.length?JSON.parse(raw):null});let data;
 if(url.pathname==='/cover-qa'){
  res.setHeader('Content-Type','text/html');res.end('<style>#posterQa{display:grid;grid-template-columns:200px 200px;gap:20px}article{height:360px}video{width:180px;height:320px}</style><main id="posterQa">'+Array.from({length:12},(_,i)=>'<article><video controls preload="none" data-cover-src="/clip.mp4?poster='+i+'" src="/clip.mp4?poster='+i+'"></video><span class="video-cover-status">Loading</span></article>').join('')+'<article><video id="badCover" controls preload="none" data-cover-src="/missing-cover.mp4" src="/missing-cover.mp4"></video><span class="video-cover-status">Loading</span></article></main><script type="module">import {mountVideoPosters} from "/psychology-video-posters.js";window.posterQA=mountVideoPosters(document.querySelector("#posterQa"));window.posterQA.refresh();</script>');return;
 }
 if(url.pathname==='/missing-cover.mp4'){res.statusCode=allowMissingCover?200:404;res.setHeader('Content-Type','video/mp4');res.end(allowMissingCover?bytes:'');return;}
 if(url.pathname==='/clip.mp4'){
  if(url.searchParams.has('poster')){coverStarts.push(url.search);coverActive++;coverPeak=Math.max(coverPeak,coverActive);setTimeout(()=>{res.setHeader('Content-Type','video/mp4');res.end(bytes);coverActive--;},120);return;}
  res.setHeader('Content-Type','video/mp4');res.end(bytes);return;
 }
 if(url.pathname==='/api/auth/me')data={user:{username:'QA',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)},sidebarModules:SIDEBAR_MODULES};
 else if(url.pathname==='/api/psychology-auto-publish')data={batches:[],pagination:{page:1,total:0}};
 else if(url.pathname==='/api/psychology-auto-publish/options')data={templates:AUTO_TEMPLATES,canUseTopics:true,canUseVideoHits:true,topicCounts:{},counts:{}};
 else if(url.pathname==='/api/official-tiktok/publish-accounts')data={accounts:[{id:'a',username:'first',followers:1000,followersSyncedAt:Date.now()},{id:'b',username:'second',followers:2200,followersSyncedAt:Date.now()},{id:'c',username:'under',followers:999},{id:'d',username:'unknown',followers:null}]};
 else if(url.pathname==='/api/psychology-tiktok-one'){
  if(req.method==='POST'){
   const input=JSON.parse(raw),key=input.campaignId+':'+input.creatorConnectionId,count=(joinAttempts.get(key)||0)+1;joinAttempts.set(key,count);
   if(input.campaignId===project&&input.creatorConnectionId==='a'&&count===1){res.statusCode=409;data={error:'Demo join failure'};}
   else{joined.add(key);data={joined:true,joinStatus:'success'};}
  }else data=url.searchParams.get('resource')==='connections'?{connections:[{id:'brand',accountIds:['1'],ownerEmail:'qa@example.test'}]}:url.searchParams.get('resource')==='projects'?{campaigns:[{campaign_id:project,campaign_name:'deeppersonaai',anchor_id:'2'},{campaign_id:'7584639271164739598',campaign_name:'Visual Personality',anchor_id:'3'},{campaign_id:'7619255069147086862',campaign_name:'Unrelated shop project',anchor_id:'4'}]}:{joinStatus:joined.has(url.searchParams.get('campaignId')+':'+url.searchParams.get('creatorConnectionId'))?'success':'unknown'};
 }
 else if(url.pathname==='/api/psychology-video-library'&&bulkMode){
  const p=Number(url.searchParams.get('page')||1);await new Promise(resolve=>setTimeout(resolve,150));
  data={page:p,hasMore:!bulkEmpty&&p===1,videos:bulkEmpty?[]:[...Array.from({length:p===1?11:12},(_,i)=>({...video('bulk-'+(i+(p-1)*11),'Bulk video '+(i+(p-1)*11)),caption:'Saved bulk caption '+i})),...(p===1?[{id:'pending-bulk',title:'Still preparing',fileName:'pending.mp4',createdAt:Date.now(),canPrepare:false,status:'pending'}]:[])]};
 }
 else if(url.pathname==='/api/psychology-video-library')data={videos:url.searchParams.get('source')==='video-hits'?[{...video('hit-selection','Understanding emotional boundaries'),assetId:'hit-asset',videoHit:{sourceId:'vh-'+'a'.repeat(32),version:1,revision:3},versionName:'版本 1',caption:'Saved recreation caption — automatically carried.'}]:url.searchParams.get('source')==='uploaded'?(uploaded?[video('upload','Uploaded')]:[]):[imported?video('generated','Generated'):{id:'',sourceJobId:'render',resultIndex:0,title:'Generated',fileName:'generated.mp4',status:'local',canPrepare:true,createdAt:Date.now()}],page:1,hasMore:false};
 else if(url.pathname.endsWith('/psychology-video-library/import')){imported=true;data={pending:true};}
 else if(url.pathname.endsWith('/psychology-video-library/upload')){uploaded=true;data={video:video('upload','Uploaded')};}
 else if(url.pathname==='/api/psychology-video-publish')data={accepted:true,batchId:'selected-1'};
 else if(url.pathname.startsWith('/api/'))data={};
 else{const pathname=url.pathname==='/psychology-publish'?'/psychology-auto-publish.html':url.pathname;const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'../public',pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));return;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();let approve=false;page.on('dialog',d=>approve?d.accept():d.dismiss());page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1050});
 await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/psychology-publish',{waitUntil:'networkidle0'});await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('#newOneBatch')]);
 assert.match(page.url(),/create=one/);assert.equal(await page.$eval('#createBatchDialog',n=>n.tagName),'SECTION');
 await page.waitForSelector('[data-pick]');
 await page.waitForFunction(()=>document.querySelector('#videoCards video')?.poster.startsWith('blob:'));
 const firstPoster=await page.$eval('#videoCards video',async v=>{const image=new Image();image.src=v.poster;await image.decode();const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,1,1);return {poster:v.poster,pixel:[...ctx.getImageData(0,0,1,1).data],paused:v.paused,time:v.currentTime};});
 assert.equal(firstPoster.paused,true);assert.equal(firstPoster.time,0);assert.ok(firstPoster.pixel[2]>200&&firstPoster.pixel[0]<20,'decoded blue cover is visible before any play');
 assert.equal(await page.$eval('#videoCards .video-cover-button',b=>b.hidden),false);
 const coverRequests=calls.filter(c=>c.path==='/clip.mp4').length;
 await page.click('[data-pick]');
 assert.equal(await page.$eval('[data-map="hit-selection"] video',v=>v.poster),firstPoster.poster);
 assert.equal(await page.$eval('#videoCards video',v=>v.poster),firstPoster.poster);
 assert.equal(calls.filter(c=>c.path==='/clip.mp4').length,coverRequests,'selecting reuses cached cover without refetching');
 assert.equal(await page.$eval('[data-video-caption="hit-selection"]',n=>n.value),'Saved recreation caption — automatically carried.');
 assert.equal(await page.$eval('[data-map="hit-selection"] video',n=>Boolean(n.src)),true);
 await page.select('#videoSource','generated');await page.waitForSelector('[data-prepare]');await page.waitForFunction(()=>document.querySelectorAll('#accounts input').length===2);
 await page.waitForFunction(()=>!document.querySelector('#oneProject').disabled&&document.querySelector('#oneProject').options.length>1);
 const listedProjects=()=>page.$$eval('#oneProject option',options=>options.map(o=>o.value).filter(Boolean));
 assert.deepEqual(await listedProjects(),[project,'7584639271164739598']);
 await page.click('#oneRefreshProjects');await page.waitForFunction(()=>!document.querySelector('#oneProject').disabled);
 assert.deepEqual(await listedProjects(),[project,'7584639271164739598']);
 assert.equal(await page.$eval('#automaticContent',n=>n.hidden),true);assert.equal(await page.$eval('#accountFollowers',n=>n.value),'1000');
 await page.click('[data-prepare]');await page.waitForSelector('[data-pick]');await page.waitForSelector('#videoCards .video-cover-button:not([hidden])');await page.click('#videoCards .video-cover-button');await page.waitForFunction(()=>!document.querySelector('#videoCards video').paused);await page.$eval('#videoCards video',v=>v.pause());
 await page.click('[data-pick]');await (await page.$('#videoFiles')).uploadFile(clip);await page.waitForFunction(()=>document.querySelector('#videoSource').value==='uploaded'&&document.querySelector('#videoPickerStatus').textContent.includes('上传完成'));
 await page.click('[data-pick]');await page.click('#selectVisibleAccounts');await page.select('#oneProject',project);
 await page.waitForFunction(()=>!document.querySelector('#oneJoinSelected').disabled);
 const joinPosts=()=>calls.filter(c=>c.path==='/api/psychology-tiktok-one'&&c.method==='POST');
 assert.equal(joinPosts().length,0);
 assert.equal(await page.$$eval('[data-one-pick]',nodes=>nodes.filter(n=>n.checked).length),2);
 await page.click('[data-one-pick="b"]');assert.match(await page.$eval('#oneJoinSelected',n=>n.textContent),/（1）/);
 assert.equal(await page.$eval('#oneSelectAll',n=>n.indeterminate),true);
 await page.click('#oneSelectAll');await page.click('#oneSelectAll');assert.equal(await page.$eval('#oneJoinSelected',n=>n.disabled),true);
 await page.click('#oneSelectAll');assert.match(await page.$eval('#oneJoinSelected',n=>n.textContent),/（2）/);
 await page.click('#oneJoinSelected');assert.equal(joinPosts().length,0);
 approve=true;await page.click('#oneJoinSelected');await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 1 / 2'));
 assert.equal(joinPosts().length,2);assert.equal(calls.filter(c=>c.path==='/api/psychology-video-publish').length,0);
 assert.deepEqual(joinPosts().map(c=>c.body.creatorConnectionId),['a','b']);
 assert.equal(await page.$eval('[data-one-join="b"]',n=>n.disabled),true);
 assert.equal(await page.$eval('[data-one-pick="b"]',n=>n.disabled&&!n.checked),true);
 assert.match(await page.$eval('[data-one-account="a"]',n=>n.textContent),/Demo join failure/);
 await page.click('[data-one-join="a"]');await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 2 / 2'));
 assert.equal(joinPosts().length,3);assert.equal(joinPosts().filter(c=>c.body.creatorConnectionId==='b').length,1);
 assert.equal(await page.$eval('#oneJoinSelected',n=>n.disabled),true);
 await page.select('#oneProject','7584639271164739598');await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 0 / 2'));
 assert.equal(joinPosts().length,3);
 await page.click('[data-one-pick="b"]');await page.click('#oneJoinSelected');
 await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 1 / 2'));
 assert.equal(joinPosts().length,4);assert.equal(joinPosts().at(-1).body.creatorConnectionId,'a');assert.equal(joinPosts().at(-1).body.campaignId,'7584639271164739598');
 assert.equal(await page.$eval('[data-one-pick="b"]',n=>n.checked),false);
 await page.select('#oneProject',project);await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 2 / 2'));
 approve=false;await page.waitForSelector('#assignSelectedVideos');await page.click('#assignSelectedVideos');
 const text=await page.$('[data-video-caption="generated"]');await text.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await text.type('Reviewed first caption');
 assert.equal(await page.$eval('[data-video-caption="generated"]',n=>n.value),'Reviewed first caption');
 assert.equal(calls.filter(c=>c.path==='/api/psychology-video-publish').length,0);
 await page.click('#submitBatch');assert.equal(calls.filter(c=>c.path==='/api/psychology-video-publish').length,0);
 await page.$eval('#videoSelectionSection',n=>n.scrollIntoView({block:'start'}));
 const capture=process.env.PSYCHOLOGY_SELECTED_CAPTURE_DIR;if(capture){fs.mkdirSync(capture,{recursive:true});await page.screenshot({path:path.join(capture,'selected-desktop.png')});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(capture,'create-header.png')});await page.$eval('#videoReviewSection',n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(capture,'selected-review.png')});}
 await page.setViewport({width:390,height:844});await page.$eval('#videoSelectionSection',n=>n.scrollIntoView({block:'start'}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(capture)await page.screenshot({path:path.join(capture,'selected-mobile.png')});
 approve=true;await page.click('#submitBatch');await page.waitForFunction(()=>!location.search.includes('create='));
 const post=calls.find(c=>c.path==='/api/psychology-video-publish');assert.equal(post.body.items.length,3);assert.equal(post.body.items[0].connectionId,'a');assert.equal(post.body.items[1].connectionId,'b');assert.equal(post.body.items[1].caption,'Reviewed first caption');assert.equal(post.body.items[0].assetId,'hit-asset');assert.equal(post.body.items[0].videoHit.revision,3);assert.equal(post.body.items[0].caption,'Saved recreation caption — automatically carried.');assert.equal(post.body.tiktokOne.campaignId,project);
 await page.goto('http://127.0.0.1:'+server.address().port+'/psychology-publish?create=normal',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.querySelector('#accounts input'));
 assert.equal(await page.$eval('#sourceType',n=>n.value),'video-hits');assert.equal(await page.$eval('#oneEnabled',n=>n.checked),false);
 assert.equal(await page.$eval('#hitSourceNote',n=>n.hidden),false);await page.click('#selectVisibleAccounts');await page.$eval('#count',n=>{n.value='4';n.dispatchEvent(new Event('input',{bubbles:true}));});
 approve=false;await page.click('#submitBatch');assert.equal(calls.filter(c=>c.path==='/api/psychology-auto-publish'&&c.method==='POST').length,0);
 await page.setViewport({width:320,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 approve=true;await page.click('#submitBatch');await page.waitForFunction(()=>!location.search.includes('create='));
 const normal=calls.find(c=>c.path==='/api/psychology-auto-publish'&&c.method==='POST');assert.equal(normal.body.sourceType,'video-hits');assert.equal(normal.body.template,'selected-video');assert.equal(normal.body.isAiGenerated,true);assert.equal(normal.body.tiktokOne,undefined);
 const writesBeforeBulk=calls.filter(c=>c.method==='POST').length;bulkMode=true;
 await page.setViewport({width:1440,height:1050});await page.goto('http://127.0.0.1:'+server.address().port+'/psychology-publish?create=one',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>!document.querySelector('#selectPageVideos').disabled);await page.click('#selectPageVideos');
 assert.equal(await page.$eval('#selectedVideoCount',n=>n.textContent),'11');assert.equal(await page.$$eval('[data-pick]',ns=>ns.filter(n=>n.checked).length),11);
 assert.equal(await page.$eval('#selectPageVideos',n=>n.disabled),true);assert.equal(await page.$eval('#clearPageVideos',n=>n.disabled),false);
 await page.$eval('[data-video-caption="bulk-0"]',n=>{n.value='Keep edited bulk caption';n.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('[data-video-ai="bulk-0"]');
 await page.click('[data-pick="1"]');assert.equal(await page.$eval('#selectedVideoCount',n=>n.textContent),'10');await page.$eval('#selectPageVideos',n=>n.scrollIntoView({block:'center'}));await page.waitForFunction(()=>!document.querySelector('#selectPageVideos').disabled);await page.click('#selectPageVideos');assert.equal(await page.$eval('#selectedVideoCount',n=>n.textContent),'11');
 assert.equal(await page.$eval('[data-video-caption="bulk-0"]',n=>n.value),'Keep edited bulk caption');assert.equal(await page.$eval('[data-video-ai="bulk-0"]',n=>n.checked),false);
 await page.click('#videoNext');assert.equal(await page.$eval('#selectPageVideos',n=>n.disabled),true);
 await page.waitForFunction(()=>document.querySelector('#videoPage').textContent.includes('2')&&!document.querySelector('#selectPageVideos').disabled);await page.click('#selectPageVideos');
 assert.equal(await page.$eval('#selectedVideoCount',n=>n.textContent),'20');assert.equal(await page.$$eval('[data-pick]',ns=>ns.filter(n=>n.checked).length),9);assert.match(await page.$eval('#videoPickerStatus',n=>n.textContent),/还有 3 条未选择/);
 assert.equal(await page.$eval('#selectPageVideos',n=>n.disabled),true);await page.click('#clearPageVideos');assert.equal(await page.$eval('#selectedVideoCount',n=>n.textContent),'11');
 assert.equal(await page.$eval('[data-video-caption="bulk-0"]',n=>n.value),'Keep edited bulk caption');
 await page.click('#videoPrev');await page.waitForFunction(()=>document.querySelector('#videoPage').textContent.includes('1')&&!document.querySelector('#clearPageVideos').disabled);
 assert.equal(await page.$$eval('[data-pick]',ns=>ns.filter(n=>n.checked).length),11);
 const bulkCapture=process.env.PSYCHOLOGY_SELECTED_CAPTURE_DIR;if(bulkCapture){await page.$eval('#selectPageVideos',n=>n.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(bulkCapture,'bulk-desktop.png')});}
 await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.click('#clearPageVideos');assert.equal(await page.$eval('#selectedVideoCount',n=>n.textContent),'0');
 if(bulkCapture){await page.$eval('#selectPageVideos',n=>n.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(bulkCapture,'bulk-mobile.png')});}
 bulkEmpty=true;await page.click('#videoRefresh');await page.waitForFunction(()=>document.querySelector('.video-empty-state'));assert.equal(await page.$eval('#selectPageVideos',n=>n.disabled),true);assert.equal(await page.$eval('#clearPageVideos',n=>n.disabled),true);
 assert.equal(calls.filter(c=>c.method==='POST').length,writesBeforeBulk,'bulk selection never publishes or prepares a video');
 const writesBeforeCoverQA=calls.filter(c=>c.method==='POST').length;
 await page.setViewport({width:600,height:600});await page.goto('http://127.0.0.1:'+server.address().port+'/cover-qa',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.querySelector('#posterQa video').poster.startsWith('blob:'));
 assert.ok(coverStarts.length>0&&coverStarts.length<12,'only videos near viewport request covers');assert.ok(coverPeak<=2,'no more than two concurrent preview reads');
 await page.$eval('#badCover',v=>v.scrollIntoView());await page.waitForFunction(()=>document.querySelector('#badCover').dataset.coverState==='failed');
 assert.match(await page.$eval('#badCover',v=>v.parentElement.textContent),/仍可点击播放/);
 assert.equal(await page.$eval('#badCover',v=>v.controls),true);
 allowMissingCover=true;await page.evaluate(()=>{window.posterQA.retryFailures();window.posterQA.refresh();});await page.waitForFunction(()=>document.querySelector('#badCover').poster.startsWith('blob:'));
 assert.equal(await page.$$eval('#posterQa video',vs=>vs.every(v=>v.paused&&v.currentTime===0)),true,'cover generation does not autoplay');
 const cachedPoster=await page.$eval('#badCover',v=>v.poster);await page.evaluate(()=>window.posterQA.refresh());assert.equal(await page.$eval('#badCover',v=>v.poster),cachedPoster);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.$$eval('#posterQa video',vs=>vs.every(v=>!v.poster)),true);
 await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.waitForFunction(()=>document.querySelector('#badCover').poster.startsWith('blob:'));
 assert.equal(calls.filter(c=>c.method==='POST').length,writesBeforeCoverQA,'cover loading never submits publication');
 assert.deepEqual(errors,[]);console.log('PASS decoded cover before playback and cached selection reuse; visible account checkboxes, select-all/clear and scoped bulk joins; first-account failure continues to next success; cancellation, retry and project isolation, no publish on join, plus video preview and confirmed publishing on desktop/mobile; no real publishing APIs.');
}catch(error){console.error('Page errors:',errors);const pages=await browser.pages();const p=pages.at(-1);console.error(await p.evaluate(()=>({status:document.querySelector('#videoPickerStatus')?.textContent,picks:[...document.querySelectorAll('[data-pick]')].map(n=>({checked:n.checked,disabled:n.disabled})),mapping:document.querySelector('#videoMapping')?.innerHTML})));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));if(path.dirname(tmp)!==os.tmpdir()||!path.basename(tmp).startsWith('psy-selection-'))throw new Error('Unexpected temporary path');fs.rmSync(tmp,{recursive:true,force:true});}
