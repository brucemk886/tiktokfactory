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
const bytes=fs.readFileSync(clip),calls=[],errors=[],project='7693454687705595917';let imported=false,uploaded=false;const joined=new Set(),joinAttempts=new Map();
const video=(id,title)=>({id,title,fileName:id+'.mp4',previewUrl:'/clip.mp4',createdAt:Date.now(),fileSize:bytes.length,status:'ready'});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');const body=[];for await(const c of req)body.push(c);const raw=Buffer.concat(body);calls.push({path:url.pathname,method:req.method,body:req.headers['content-type']==='application/json'&&raw.length?JSON.parse(raw):null});let data;
 if(url.pathname==='/clip.mp4'){res.setHeader('Content-Type','video/mp4');res.end(bytes);return;}
 if(url.pathname==='/api/auth/me')data={user:{username:'QA',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)},sidebarModules:SIDEBAR_MODULES};
 else if(url.pathname==='/api/psychology-auto-publish')data={batches:[],pagination:{page:1,total:0}};
 else if(url.pathname==='/api/psychology-auto-publish/options')data={templates:AUTO_TEMPLATES,canUseTopics:true,topicCounts:{},counts:{}};
 else if(url.pathname==='/api/official-tiktok/publish-accounts')data={accounts:[{id:'a',username:'first',followers:1000,followersSyncedAt:Date.now()},{id:'b',username:'second',followers:2200,followersSyncedAt:Date.now()},{id:'c',username:'under',followers:999},{id:'d',username:'unknown',followers:null}]};
 else if(url.pathname==='/api/psychology-tiktok-one'){
  if(req.method==='POST'){
   const input=JSON.parse(raw),key=input.campaignId+':'+input.creatorConnectionId,count=(joinAttempts.get(key)||0)+1;joinAttempts.set(key,count);
   if(input.creatorConnectionId==='b'&&count===1){res.statusCode=409;data={error:'Demo join failure'};}
   else{joined.add(key);data={joined:true,joinStatus:'success'};}
  }else data=url.searchParams.get('resource')==='connections'?{connections:[{id:'brand',accountIds:['1'],ownerEmail:'qa@example.test'}]}:url.searchParams.get('resource')==='projects'?{campaigns:[{campaign_id:project,campaign_name:'deeppersonaai',anchor_id:'2'},{campaign_id:'7584639271164739598',campaign_name:'Visual Personality',anchor_id:'3'},{campaign_id:'7619255069147086862',campaign_name:'Unrelated shop project',anchor_id:'4'}]}:{joinStatus:joined.has(url.searchParams.get('campaignId')+':'+url.searchParams.get('creatorConnectionId'))?'success':'unknown'};
 }
 else if(url.pathname==='/api/psychology-video-library')data={videos:url.searchParams.get('source')==='uploaded'?(uploaded?[video('upload','Uploaded')]:[]):[imported?video('generated','Generated'):{id:'',sourceJobId:'render',resultIndex:0,title:'Generated',fileName:'generated.mp4',status:'local',canPrepare:true,createdAt:Date.now()}],page:1,hasMore:false};
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
 await page.goto('http://127.0.0.1:'+server.address().port+'/psychology-publish',{waitUntil:'networkidle0'});await page.click('#newOneBatch');
 await page.waitForSelector('[data-prepare]');await page.waitForFunction(()=>document.querySelectorAll('#accounts input').length===2);
 await page.waitForFunction(()=>!document.querySelector('#oneProject').disabled&&document.querySelector('#oneProject').options.length>1);
 const listedProjects=()=>page.$$eval('#oneProject option',options=>options.map(o=>o.value).filter(Boolean));
 assert.deepEqual(await listedProjects(),[project,'7584639271164739598']);
 await page.click('#oneRefreshProjects');await page.waitForFunction(()=>!document.querySelector('#oneProject').disabled);
 assert.deepEqual(await listedProjects(),[project,'7584639271164739598']);
 assert.equal(await page.$eval('#automaticContent',n=>n.hidden),true);assert.equal(await page.$eval('#accountFollowers',n=>n.value),'1000');
 await page.click('[data-prepare]');await page.waitForSelector('[data-pick]');await page.$eval('video',async v=>{v.load();await v.play();v.pause();});
 await page.click('[data-pick]');await (await page.$('#videoFiles')).uploadFile(clip);await page.waitForFunction(()=>document.querySelector('#videoSource').value==='uploaded'&&document.querySelector('#videoPickerStatus').textContent.includes('上传完成'));
 await page.click('[data-pick]');await page.click('#selectVisibleAccounts');await page.select('#oneProject',project);
 await page.waitForFunction(()=>!document.querySelector('#oneJoinSelected').disabled);
 const joinPosts=()=>calls.filter(c=>c.path==='/api/psychology-tiktok-one'&&c.method==='POST');
 assert.equal(joinPosts().length,0);
 await page.click('#oneJoinSelected');assert.equal(joinPosts().length,0);
 approve=true;await page.click('#oneJoinSelected');await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 1 / 2'));
 assert.equal(joinPosts().length,2);assert.equal(calls.filter(c=>c.path==='/api/psychology-video-publish').length,0);
 assert.equal(await page.$eval('[data-one-join="a"]',n=>n.disabled),true);
 assert.match(await page.$eval('[data-one-account="b"]',n=>n.textContent),/Demo join failure/);
 await page.click('[data-one-join="b"]');await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 2 / 2'));
 assert.equal(joinPosts().length,3);assert.equal(joinPosts().filter(c=>c.body.creatorConnectionId==='a').length,1);
 assert.equal(await page.$eval('#oneJoinSelected',n=>n.disabled),true);
 await page.select('#oneProject','7584639271164739598');await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 0 / 2'));
 assert.equal(joinPosts().length,3);
 await page.select('#oneProject',project);await page.waitForFunction(()=>document.querySelector('#oneStatus').textContent.includes('已确认加入 2 / 2'));
 approve=false;await page.waitForSelector('#assignSelectedVideos');await page.click('#assignSelectedVideos');
 const text=await page.$('[data-video-caption="generated"]');await text.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await text.type('Reviewed first caption');
 assert.equal(await page.$eval('[data-video-caption="generated"]',n=>n.value),'Reviewed first caption');
 assert.equal(calls.filter(c=>c.path==='/api/psychology-video-publish').length,0);
 await page.click('#submitBatch');assert.equal(calls.filter(c=>c.path==='/api/psychology-video-publish').length,0);
 await page.$eval('#videoSelectionSection',n=>n.scrollIntoView({block:'start'}));
 const capture=process.env.PSYCHOLOGY_SELECTED_CAPTURE_DIR;if(capture){fs.mkdirSync(capture,{recursive:true});await page.screenshot({path:path.join(capture,'selected-desktop.png')});}
 await page.setViewport({width:390,height:844});await page.$eval('#videoSelectionSection',n=>n.scrollIntoView({block:'start'}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(capture)await page.screenshot({path:path.join(capture,'selected-mobile.png')});
 approve=true;await page.click('#submitBatch');await page.waitForFunction(()=>!document.querySelector('#createBatchDialog').open);
 const post=calls.find(c=>c.path==='/api/psychology-video-publish');assert.equal(post.body.items.length,2);assert.equal(post.body.items[0].connectionId,'a');assert.equal(post.body.items[1].connectionId,'b');assert.equal(post.body.items[0].caption,'Reviewed first caption');assert.equal(post.body.tiktokOne.campaignId,project);
 assert.deepEqual(errors,[]);console.log('PASS explicit join cancellation, per-account success/failure/retry, project isolation, no publish on join, plus video preview and confirmed publishing on desktop/mobile; no real publishing APIs.');
}finally{await browser.close();await new Promise(r=>server.close(r));if(path.dirname(tmp)!==os.tmpdir()||!path.basename(tmp).startsWith('psy-selection-'))throw new Error('Unexpected temporary path');fs.rmSync(tmp,{recursive:true,force:true});}
