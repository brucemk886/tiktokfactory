import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {SIDEBAR_MODULES} from '../factory-cloud/src/sidebar.js';
import {AUTO_TEMPLATES} from './psychology-auto-publish.js';
const requests=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),page=Number(url.searchParams.get('page'))||1;requests.push(url.pathname+url.search);
 let data;
 if(url.pathname==='/api/auth/me')data={user:{username:'QA',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)},home:'/',sidebarModules:SIDEBAR_MODULES};
 else if(url.pathname==='/api/psychology-auto-publish/options')data={templates:AUTO_TEMPLATES,counts:{photo:216,video:28},canUseTopics:true,topicCounts:{}};
 else if(url.pathname==='/api/official-tiktok/publish-accounts')data={accounts:[{id:'a',username:'synthetic',scopes:['video.publish']}]};
 else if(url.pathname==='/api/psychology-auto-publish')data={batches:[{id:'batch-'+page,config:{name:'Page '+page,mediaType:'photo',count:1,template:'photo-original'},createdAt:Date.now(),groups:[],items:[{id:'item',connectionId:'a',scheduleAt:Date.now()/1000,status:'queued'}]}],pagination:{page,total:21,hasMore:page<3}};
 else if(url.pathname==='/api/official-publish-records')data={records:[{id:'record-'+page,accountUsername:'synthetic',title:'Page '+page,status:'failed',createdAt:Date.now(),publishError:'Synthetic error'}],summary:{recordCount:1},pagination:{page,total:101,hasMore:page<3}};
 else if(url.pathname.startsWith('/api/'))data={};
 else {const routes={'/psychology-publish':'/psychology-auto-publish.html','/official-publish-records':'/official-publish-records.html'};const file='public'+(routes[url.pathname]||url.pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));return;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1500,height:1000});
 await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/psychology-publish');await page.waitForFunction(()=>document.querySelector('#batchPage').textContent.includes('共 21'));
 assert.equal(await page.$eval('#allowPeerReuse',e=>e.value),'no');assert.equal(await page.$eval('#batchPrev',e=>e.disabled),true);
 await page.click('#batchNext');await page.waitForFunction(()=>document.querySelector('#batchPage').textContent.includes('第 2'));
 await page.select('#batchFilter','attention');await page.waitForFunction(()=>document.querySelector('#batchPage').textContent.includes('第 1'));
 assert.ok(requests.some(p=>p.includes('page=1&attention=1')));
 await page.goto(base+'/official-publish-records');await page.waitForFunction(()=>document.querySelector('#recordsPage').textContent.includes('共 101'));
 await page.click('#recordsNext');await page.waitForFunction(()=>document.querySelector('#recordsPage').textContent.includes('第 2'));
 await page.type('#officialQuery','synthetic');await page.waitForFunction(()=>document.querySelector('#recordsPage').textContent.includes('第 1'));
 assert.ok(requests.some(p=>p.includes('page=1')&&p.includes('query=synthetic')));
 assert.deepEqual(errors,[]);console.log('PASS automation pagination, attention filter, default account deduplication, record pagination and search reset; no page errors or external requests');
}finally{await browser.close();await new Promise(r=>server.close(r));}
