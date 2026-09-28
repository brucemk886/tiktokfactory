import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
test('browser: manage multiple images, pagination, upload, consumed protection and Kie submission',async t=>{
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));if(!executablePath){t.skip('Chrome unavailable');return;}
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
 const topic={id:'topic-test',template:'psychology-target-2',title:'Which situation first?',choices:['Alarm','Door','Water','Phone'].map((copy,i)=>({label:'ABCD'[i],copy})),image:{previewUrl:'data:image/png;base64,'+png},imagePool:{total:22,available:21,used:1},enabled:true,priority:50,revision:1,usageCount:1};
 let images=Array.from({length:22},(_,i)=>({id:'image-'+i,previewUrl:'data:image/png;base64,'+png,status:i===0?'used':'available',enabled:true,drawnAt:i===0?1:0})),generated=[];
 const mutations=[],errors=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let body='';for await(const c of req)body+=c;
  const data=body?JSON.parse(body):null;
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(url.pathname.startsWith('/api/')){
   if(req.method!=='GET')mutations.push({path:url.pathname,data});
   if(url.pathname.endsWith('/api-key'))return json({configured:false});
   if(url.pathname.endsWith('/assets'))return json({key:'psychology-topics/00000000-0000-4000-8000-000000000001.png'});
   if(url.pathname.endsWith('/image-generation')){
    if(req.method==='POST')generated=[{requestId:data.requestId,status:'generating',createdAt:Date.now()}];
    return json(req.method==='POST'?generated[0]:{items:generated});
   }
   if(url.pathname.includes('/images/image-')){const image=images.find(i=>url.pathname.endsWith('/'+i.id));image.enabled=data.enabled;image.status=data.enabled?'available':'disabled';return json({ok:true});}
   if(url.pathname.endsWith('/images')){
    if(req.method==='POST'){images.push({id:'image-22',previewUrl:topic.image.previewUrl,enabled:true,status:'available'});return json({created:1,skipped:0});}
    const page=Number(url.searchParams.get('page')||1);return json({revision:1,total:images.length,hasMore:page*20<images.length,items:images.slice((page-1)*20,page*20)});
   }
   return json({items:[topic],templates:[{id:topic.template,label:'03 单图',hint:'多图抽取'}],counts:{[topic.template]:{total:1,enabled:1,unused:1,availableImages:21}},total:1});
  }
  const file=url.pathname==='/'?'psychology-topic-bank.html':url.pathname.slice(1);if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404).end();return;}
  if(file==='access.js'||file==='admin-ui.js'){res.setHeader('Content-Type','text/javascript');res.end('');return;}
  const source=new URL('../public/'+file,import.meta.url);if(!fs.existsSync(source)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(source));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const {default:puppeteer}=await import('puppeteer-core');const browser=await puppeteer.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?template=psychology-target-2');await page.waitForSelector('[data-images]');await page.click('[data-images]');
 await page.waitForSelector('.pool-image');assert.equal(await page.$$eval('.pool-image',els=>els.length),20);
 assert.equal(await page.$('[data-pool-toggle="image-0"]'),null);
 await page.click('#poolNext');await page.waitForFunction(()=>document.querySelector('#poolPage').textContent.includes('第 2'));assert.equal(await page.$$eval('.pool-image',els=>els.length),2);
 await page.click('[data-pool-toggle="image-20"]');await page.waitForFunction(()=>document.querySelector('[data-pool-toggle="image-20"]').textContent==='启用图片');
 const file=path.join(os.tmpdir(),'topic-pool-test-'+Date.now()+'.png');fs.writeFileSync(file,Buffer.from(png,'base64'));t.after(()=>fs.unlinkSync(file));
 await (await page.$('#poolFiles')).uploadFile(file);await page.click('#poolUpload');await page.waitForFunction(()=>document.querySelector('#poolMessage').textContent.includes('新增 1 张'));
 assert.ok(mutations.find(m=>m.path.endsWith('/images')).data.images[0].imageKey);
 await page.click('#poolAi summary');await page.click('#poolGenerate');await page.waitForFunction(()=>document.querySelector('#poolGenerate').textContent==='检查此生图任务');
 const generation=mutations.find(m=>m.path.endsWith('/image-generation'));assert.equal(generation.data.revision,1);assert.ok(generation.data.requestId);
 await page.click('#poolGenerate');await page.waitForFunction(()=>document.querySelector('#poolGenerate').textContent==='检查此生图任务'&&!document.querySelector('#poolControls').inert);
 assert.deepEqual(mutations.filter(m=>m.path.endsWith('/image-generation')).map(m=>m.data.requestId),[generation.data.requestId,generation.data.requestId]);
 await page.screenshot({path:path.join(os.tmpdir(),'topic-image-pool-ui.png'),fullPage:true});assert.deepEqual(errors,[]);
});

