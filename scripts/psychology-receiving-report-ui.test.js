import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';
import {receivingFixture} from '../factory-cloud/src/psychology-receiving-test-fixture.js';
import {SIDEBAR_MODULES} from '../factory-cloud/src/sidebar.js';
const root=fileURLToPath(new URL('../',import.meta.url)),chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
test('desktop receiving tab shows accurate funnel, filters, pagination and isolated loading',{skip:!fs.existsSync(chrome),timeout:60000},async t=>{
 const f=await receivingFixture(t),calls=[],errors=[];let fail=false,slow=false;
 for(let i=0;i<23;i++)f.photo('post-'+i,{publisher:i%2?'c':'a',views:i===0?null:1000+i*253});f.click('ok');f.click('bounce',{arrived:null});
 const user={username:'admin',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   calls.push(url);res.setHeader('content-type','application/json');
   if(url.pathname==='/api/auth/me'){res.end(JSON.stringify({user,sidebarModules:SIDEBAR_MODULES}));return;}
   if(url.pathname==='/api/psychology-receiving-report'){
    if(fail){res.statusCode=503;res.end(JSON.stringify({error:'模拟读取失败'}));return;}
    if(slow&&url.searchParams.get('period')==='yesterday')await new Promise(r=>setTimeout(r,450));
    const result=await f.read(url.search.slice(1));res.statusCode=result.status;res.end(JSON.stringify(result.data));return;
   }
   res.end('{}');return;
  }
  const file=path.join(root,'public',url.pathname==='/psychology-ops-report'?'psychology-operations.html':url.pathname==='/psychology-effects'?'official-group-report.html':url.pathname.slice(1));
  if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}
  res.setHeader('content-type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox'],defaultViewport:{width:1600,height:1120}});t.after(()=>browser.close());
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/psychology-ops-report?channel=receiving');await page.waitForFunction(()=>document.querySelector('.receiving-content')?.hidden===false);
 assert.equal(await page.$eval('#standardReport',e=>e.hidden),true);assert.equal(await page.$$eval('.one-report-tabs a',es=>es.length),3);assert.equal(await page.$eval('.one-report-tabs [aria-current=page]',e=>e.textContent),'承接引流');
 assert.equal(calls.some(u=>['/api/psychology-operations','/api/psychology-one-report'].includes(u.pathname)),false);
 const text=await page.$eval('.receiving-content',e=>e.textContent);assert.match(text,/23 条引流图文/);assert.match(text,/50\.0%/);assert.match(text,/日报未齐/);assert.match(text,/08:00（北京时间）/);assert.match(text,/北京 08:00 切日/);assert.doesNotMatch(text,/UTC 日报/);
 assert.equal(await page.$$eval('.receiving-funnel article',es=>es.length),5);
 assert.equal(await page.$eval('[data-period=today]',e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
 const screenshotDir=path.join(root,'tmp/receiving-report-qa');fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'overview.png'),fullPage:true});
 await page.click('.receiving-posts>summary');assert.equal(await page.$$eval('.receiving-post-content tbody tr',es=>es.length),20);
 await page.click('[data-page="2"]');await page.waitForFunction(()=>document.querySelector('.receiving-pager')?.textContent.includes('第 2 / 2 页'));
 assert.equal(await page.$$eval('.receiving-post-content tbody tr',es=>es.length),3);assert.equal(await page.$eval('.receiving-posts',e=>e.open),true);
 await page.click('[data-period="7d"]');await page.waitForFunction(()=>document.querySelector('.receiving-chip')?.textContent==='7 天');assert.equal(await page.$$eval('.receiving-content>section.receiving-panel:first-of-type tbody tr',es=>es.length),7);
 await page.select('[name=receiver]','b');await page.waitForFunction(()=>new URL(location.href).searchParams.get('receivingReceiver')==='b');
 await page.click('[data-period="range"]');assert.equal(await page.$eval('.receiving-dates',e=>e.hidden),false);
 await page.setViewport({width:1440,height:1050});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 slow=true;await page.click('[data-period="yesterday"]');await page.click('[data-period="today"]');await page.waitForFunction(()=>document.querySelector('.receiving-chip')?.textContent==='1 天'&&!document.querySelector('.receiving-content').hidden);await new Promise(r=>setTimeout(r,650));
 assert.match(await page.$eval('.receiving-status',e=>e.textContent),/2026-10-10 至 2026-10-10/);slow=false;
 fail=true;await page.click('.receiving-refresh');await page.waitForFunction(()=>document.querySelector('.receiving-status').textContent.includes('模拟'));assert.equal(await page.$eval('.receiving-content',e=>e.hidden),true);
 fail=false;await page.click('.receiving-refresh');await page.waitForFunction(()=>!document.querySelector('.receiving-content').hidden);
 f.sqlite.exec('DELETE FROM ops_photo_receivers');await page.select('[name=receiver]','');await page.waitForFunction(()=>document.querySelector('.receiving-empty')?.textContent.includes('暂无承接账号记录'));
 await page.screenshot({path:path.join(screenshotDir,'empty.png'),fullPage:true});
 await page.goto(base+'/psychology-effects?channel=tiktok-one');await page.waitForSelector('.one-report-tabs');assert.equal(await page.$$eval('.one-report-tabs a',es=>es.length),2);assert.equal(await page.$('.receiving-report'),null);
 assert.deepEqual(errors,[]);assert.equal(f.requests.length,0);
});
