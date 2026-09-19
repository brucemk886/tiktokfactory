import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {SIDEBAR_MODULES} from '../factory-cloud/src/sidebar.js';
const long='Long text with "quotes" <tags> & symbols — '.repeat(35);
const records=[{createdAt:Date.now(),scheduleAt:Date.now()/1000,accountUsername:'psychology_example',fileName:long,autoTaskId:'psy-auto-'+long,batchId:long,autoBatchId:'b',status:'failed',publishError:long},{createdAt:Date.now(),scheduleAt:Date.now()/1000,accountUsername:'second',title:'Short post',autoTaskId:'task',batchId:'batch',autoBatchId:'b',status:'published',note:long,videoUrl:'https://www.tiktok.com/@second/photo/1234567890123',mediaType:'photo'}];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');let data;
 if(url.pathname==='/api/auth/me')data={user:{username:'QA',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)},home:'/',sidebarModules:SIDEBAR_MODULES};
 else if(url.pathname==='/api/official-publish-records')data={records,summary:{recordCount:2}};
 else if(url.pathname.startsWith('/api/'))data={};
 else {const file='public'+(url.pathname==='/official-publish-records'?'/official-publish-records.html':url.pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));return;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:1000});await page.goto('http://127.0.0.1:'+server.address().port+'/official-publish-records');await page.waitForSelector('.record-truncate');
 const cells=await page.$$eval('#officialRecordRows tr:first-child .record-truncate',els=>els.map(e=>({text:e.textContent,title:e.title,clipped:e.scrollWidth>e.clientWidth,nowrap:getComputedStyle(e).whiteSpace})));
 assert.equal(cells.length,4);assert.ok(cells.every(c=>c.clipped&&c.nowrap==='nowrap'));
 const heights=await page.$$eval('#officialRecordRows tr',rows=>rows.map(r=>r.getBoundingClientRect().height));assert.ok(heights.every(h=>h<90),JSON.stringify(heights));
 assert.equal(await page.$$eval('#officialRecordRows a',els=>els.length),1);
 assert.equal(await page.$$eval('#officialRecordRows tags',els=>els.length),0);

 const selectors=[4,5,6,8].map(n=>`#officialRecordRows tr:first-child td:nth-child(${n})`);
 for(const selector of selectors){
   await page.hover(selector);
   await page.waitForSelector('#record-detail-tooltip:not([hidden])');
   const expected=await page.$eval(selector,e=>e.querySelector('.record-truncate').textContent);
   assert.equal(await page.$eval('#record-detail-tooltip',e=>e.textContent),expected);
   const box=await page.$eval('#record-detail-tooltip',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollable:e.scrollHeight>e.clientHeight};});
   assert.ok(box.left>=0&&box.right<=1600&&box.top>=0&&box.bottom<=1000,JSON.stringify(box));
   assert.ok(box.scrollable);
 }
 await page.hover('#record-detail-tooltip');
 await new Promise(r=>setTimeout(r,250));
 assert.equal(await page.$eval('#record-detail-tooltip',e=>e.hidden),false);
 await page.$eval('#record-detail-tooltip',e=>{e.scrollTop=100;});
 assert.ok(await page.$eval('#record-detail-tooltip',e=>!e.hidden&&e.scrollTop>0));
 await new Promise(r=>setTimeout(r,250));
 assert.equal(await page.$eval('#record-detail-tooltip',e=>e.hidden),false);
 fs.mkdirSync('tmp',{recursive:true});
 await page.screenshot({path:'tmp/official-records-tooltip.png'});
 await page.keyboard.press('Escape');
 assert.equal(await page.$eval('#record-detail-tooltip',e=>e.hidden),true);
 await page.focus(selectors[0]+' .record-truncate');
 assert.equal(await page.$eval('#record-detail-tooltip',e=>e.hidden),false);
 assert.equal(await page.$eval('#record-detail-tooltip tags',e=>!!e).catch(()=>false),false);
 await page.click('#refreshOfficialRecordsBtn');
 assert.equal(await page.$eval('#record-detail-tooltip',e=>e.hidden),true);

 assert.deepEqual(errors,[]);
 console.log('PASS real hover for all four cells, complete safe text, viewport bounds, scrollable persistent popup, keyboard focus/Escape, refresh dismissal, compact rows and retained link');
}finally{await browser.close();server.close();}
