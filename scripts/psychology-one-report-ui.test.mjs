import {oneAnalysis} from '../public/psychology-one-analysis-schema.js';
import {SIDEBAR_MODULES} from '../factory-cloud/src/sidebar.js';
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
const calls=[],errors=[];let fail=false,delay=0;
const row=(n)=>({videoId:String(7600000000000000000n+BigInt(n)),account:'tiktok:a',accountName:'creator_alpha',groupId:'g',campaignId:'111',available:{audience:true,retention:true,daily:true},publishedAt:'2026-10-09 17:40:34',views:n===1?null:n*10,organicViews:n*10,paidViews:null,likes:0,comments:0,shares:null,anchorViews:100,anchorClicks:2,anchorCtr:.02});
const summary={availability:{audience:3,retention:20,daily:2},total:23,synced:22,missingMetrics:1,views:2520,averageViews:114.5,thousandRate:0,organicViews:2520,paidViews:null,likes:0,comments:0,shares:null,anchorViews:2300,anchorClicks:46,anchorClicksSamples:23,anchorCtr:.02,published:23,submitted:0,pending:0,failed:0,stopped:0,updating:0};
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://local');calls.push(u.pathname+u.search);if(u.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(u.pathname==='/api/psychology-one-report'){
   const source=u.searchParams.get('source')||'official',view=u.searchParams.get('view')||'videos',page=Number(u.searchParams.get('page')||1);if(delay)await new Promise(r=>setTimeout(r,delay));
   if(fail){res.statusCode=502;res.end(JSON.stringify({error:'模拟官方接口失败'}));return;}
   const rows=view==='videos'?Array.from({length:page===1?20:3},(_,i)=>({...row((page-1)*20+i),...(source==='tasks'?{id:'task'+i,title:'One video title '+i,status:'published',scheduleAt:1791535200000,publishedAt:1791535800000,completion:.3}:{})})):['a','b'].map(a=>({...row(1),...summary,account:'tiktok:'+a,accountName:'creator_'+a}));
   res.end(JSON.stringify({source,view,basis:u.searchParams.get('basis')||'schedule',country:'US',window:{from:'2026-10-03',to:'2026-10-09'},dateRange:{start_date:'2026-10-03',end_date:'2026-10-09'},campaign:'111',groups:[{id:'g',name:'心理学 1 组'}],projects:[{campaignId:'111'},{campaignId:'222'}],summary,rows,...(u.searchParams.has('videoId')?{detail:{...row(20),videoId:u.searchParams.get('videoId'),anchorId:'987',anchorUniqueViews:60,anchorUniqueClicks:1,thumbnailUrl:'',embedUrl:'',analysis:oneAnalysis(u.searchParams.get('videoId')==='999'?{}:{metrics:{video_views:200,video_views_organic:200,reach:100,average_view_time:6.4,video_completion_rate:.25,likes:0},audience:{countries:[{label:'US',value:.8},{label:'GB',value:.2}],age:[{label:'2',value:1}],language:[{label:'us',value:1}],interest:[{label:'<img src=x onerror=alert(1)>',value:.5}]},retention:[1,null,.3],sources:[{label:'search',value:0}],daily:[{date:'2026-10-07',views:10,likes:0},{date:'2026-10-08',views:null,likes:null},{date:'2026-10-09',views:20,likes:1}]})}}:{}),pagination:{page,pages:view==='videos'?2:1,total:view==='videos'?23:2,pageSize:20},updatedAt:Date.now(),fetchedAt:Date.now(),coverage:'官方接口读取，空值不记作 0。'}));return;
  }
  if(u.pathname.includes('/auth/')){res.end(JSON.stringify({user:{username:'QA',role:'admin',sidebarModules:['psychology-effects','psychology-ops-report']},sidebarModules:SIDEBAR_MODULES}));return;}
  res.statusCode=503;res.end(JSON.stringify({error:'未配置测试的旧页面 API'}));return;
 }
 const names={'/psychology-effects':'official-group-report.html','/psychology-ops-report':'psychology-operations.html','/novel-ops-report':'official-group-report.html'};
 const file=path.resolve('public',names[u.pathname]||u.pathname.slice(1));if(!file.startsWith(path.resolve('public')+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:1050});const base='http://127.0.0.1:'+server.address().port;
 for(const route of ['/psychology-effects','/psychology-ops-report']){
  calls.length=0;await page.goto(base+route+'?channel=tiktok-one');await page.waitForSelector('.one-report-table tbody tr');
  assert.equal(await page.$eval('#standardReport',n=>getComputedStyle(n).display),'none');assert.equal(await page.$eval('.one-report-tabs [aria-current]',n=>n.textContent),'TikTok One');assert.equal(await page.$eval('.one-report-tabs [aria-current]',n=>getComputedStyle(n).color),'rgb(255, 255, 255)');assert.equal(await page.$eval('main h1',n=>n.textContent),route==='/psychology-effects'?'数据概览':'运营报表');assert.equal(await page.$$eval('.one-report-table tbody tr',n=>n.length),20);
  assert.equal(calls.some(u=>u.startsWith('/api/psychology-operations?')||u.startsWith('/api/official/group-report?')),false,'One tab lazily reads only One data');
  assert.match(await page.$eval('.one-report-kpis',n=>n.textContent),/官方收录视频/);assert.match(await page.$eval('.one-report-table',n=>n.textContent),/—/);
  await page.click('.one-report-pager button:last-child');await page.waitForFunction(()=>document.querySelector('.one-report-pager').textContent.includes('第 2 /'));assert.equal(await page.$$eval('.one-report-table tbody tr',n=>n.length),3);
  await Promise.all([page.waitForNavigation(),page.click('.one-detail-link')]);await page.waitForSelector('#one-audience');
  assert.equal(await page.$eval('.one-report-filters',n=>n.hidden),true);
  assert.equal(await page.$eval('main h1',n=>n.textContent),'TikTok One · 视频数据详情');
  assert.match(await page.$eval('#one-audience',n=>n.textContent),/美国 · US/);assert.match(await page.$eval('#one-audience',n=>n.textContent),/年龄分组 2/);
  assert.equal(await page.$('#one-audience img'),null,'untrusted labels stay text');
  assert.doesNotMatch(await page.$eval('.one-report-data',n=>n.textContent),/广告花费|付费流量/);
  assert.equal(await page.$eval('#one-retention svg path',n=>(n.getAttribute('d').match(/M/g)||[]).length),2,'null retention creates a gap');
  assert.match(await page.$eval('[data-daily-values]',n=>n.textContent),/—/);await page.select('[data-daily-metric]','likes');assert.match(await page.$eval('[data-daily-values]',n=>n.textContent),/点赞/);
  if(route==='/psychology-effects'){await page.screenshot({path:'tmp/one-analysis-desktop.png'});await page.$eval('#one-audience',el=>el.scrollIntoView());await page.screenshot({path:'tmp/one-analysis-audience.png'});}
  fail=true;await page.click('[data-detail-refresh]');await page.waitForFunction(()=>document.querySelector('.one-report-status').textContent.includes('模拟官方接口失败'));assert.equal(await page.$eval('.one-report-data',n=>n.hidden),true);fail=false;
  await page.click('.one-report > .one-analysis-head button');await page.waitForSelector('#one-audience');await page.waitForFunction(()=>!document.querySelector('.one-report-data').hidden);
  await Promise.all([page.waitForNavigation(),page.click('.one-report-data .one-back-link')]);await page.waitForSelector('.one-report-table tbody tr');assert.match(await page.$eval('.one-report-pager',n=>n.textContent),/第 2/);
  await page.select('#oneReportView','accounts');await page.waitForFunction(()=>document.querySelector('.one-report-heading h2').textContent.includes('账号表现'));assert.equal(await page.$$eval('.one-report-table tbody tr',n=>n.length),2);
  await page.select('.one-report [name=source]','tasks');await page.select('.one-report [name=basis]','published');await page.click('.one-report button[type=submit]');await page.waitForFunction(()=>document.querySelector('.one-report-kpis').textContent.includes('已发布'));
  assert.match(await page.$eval('.one-report-status',n=>n.textContent),/实际发布时间/);assert.equal(await page.$eval('.one-report [data-task-basis]',n=>getComputedStyle(n).display),'flex');
  await page.select('.one-report [name=source]','official');await page.select('.one-report [name=campaign]','222');await page.click('.one-report button[type=submit]');await page.waitForFunction(()=>!document.querySelector('.one-report-data').hidden);assert.ok(calls.some(u=>u.includes('campaign=222')));
  if(route==='/psychology-effects')await page.screenshot({path:'tmp/one-report-desktop.png',fullPage:true});
  fail=true;await page.click('.one-report button[type=submit]');await page.waitForFunction(()=>document.querySelector('.one-report-status').textContent.includes('模拟官方接口失败'));assert.equal(await page.$eval('.one-report-data',n=>n.hidden),true);fail=false;
  await page.click('.one-report button[type=submit]');await page.waitForFunction(()=>!document.querySelector('.one-report-data').hidden);
  await Promise.all([page.waitForNavigation(),page.click('.one-report-tabs a:first-child')]);await page.waitForSelector('.one-report-tabs');assert.notEqual(await page.$eval('#standardReport',n=>getComputedStyle(n).display),'none');assert.equal(await page.$('.one-report'),null);
 }
 await page.goto(base+'/psychology-effects?channel=tiktok-one&oneVideo=999');await page.waitForSelector('#one-audience');assert.match(await page.$eval('#one-audience',n=>n.textContent),/暂无数据/);assert.equal(await page.$('#one-retention svg'),null);assert.match(await page.$eval('[data-daily-chart]',n=>n.textContent),/暂无数据/);
 await page.goto(base+'/novel-ops-report?channel=tiktok-one');await page.waitForFunction(()=>document.readyState==='complete');assert.equal(await page.$('.one-report-tabs'),null);assert.notEqual(await page.$eval('#standardReport',n=>getComputedStyle(n).display),'none');
 assert.deepEqual(errors,[]);console.log('PASS: non-ad details, scoped empty states, XSS labels, null chart gaps, daily selectors, detail retries and preserved list page; both PC One tabs, lazy APIs, official/task isolation, 20-row pagination, accounts/projects controls, missing metrics, errors/retry, back to legacy and non-psychology isolation; no live API calls.');
}catch(e){const ps=await browser.pages();console.log(JSON.stringify({errors,calls,body:await ps.at(-1).evaluate(()=>document.body.innerText.slice(0,2200))}));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
