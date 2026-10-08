import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer-core';
import { summarizeFunnel } from '../factory-cloud/src/psychology-website-funnel.js';
import { toPublicUser } from '../factory-cloud/src/auth.js';
import { SIDEBAR_MODULES, canAccessPath } from '../factory-cloud/src/sidebar.js';
const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
const fixture=()=>({
 channel:'tiktok',connected:true,updatedAt:'2026-10-06T12:00:00Z',window:{from:'2026-09-30',to:'2026-10-06'},
 summary:{pageviews:null,started:60,finished:40,submitted:30,checkout:10,paidSessions:2,orders:3,refundedOrders:1,completionRate:2/3,paymentRate:2/60},
 currencies:[{currency:'usd',grossCents:1497}],days:[{day:'2026-10-06',pageviews:null,started:60,finished:40,orders:3}],
 attribution:{attributedStarted:20,attributedOrders:2,unattributedStarted:40,unattributedOrders:1},
 accounts:[{connectionId:'a',username:'account_a',started:20,finished:15,paidSessions:2,orders:2}],
 sources:{page:1,pageSize:20,total:21,rows:[{source:'tiktok',campaign:'<img src=x onerror=alert(1)>',medium:'bio',content:'content & detail',started:20,finished:15,checkout:4,paidSessions:2,orders:2}]},
 orders:{page:1,pageSize:20,total:3,rows:[{id:'order-demo',paid_at:'2026-10-06 02:00:00',testTitle:'Attachment',kind:'report',amount_cents:499,currency:'usd',status:'refunded',provider:'stripe',source:'tiktok',campaign:'factory-a'}]},
 receivers:[{connectionId:'a',username:'account_a',configured:false,trackingUrl:null}],
 campaign:{configuredReceivers:0,enabled:true},
 definitions:{pageviews:'历史匿名页面访问未保存渠道，因此不展示。',acquisition:'测试按开始时间，订单按付款时间。',money:'未扣退款、税费或支付平台手续费，不代表实际到账。'}
});
test('website page permission aliases retain admin-only autopilot access',()=>{
 assert.equal(canAccessPath({role:'operator',sidebarModules:['psychology-autopilot']},'/psychology-website'),false);
 assert.equal(canAccessPath({role:'admin',sidebarModules:[]},'/psychology-website.html'),false);
 assert.equal(canAccessPath({role:'admin',sidebarModules:['psychology-autopilot']},'/psychology-website'),true);
});
test('saved admin navigation includes the website entry and excludes operators',()=>{
 const admin=toPublicUser({id:'admin',role:'admin',sidebar_modules_json:JSON.stringify(['psychology-effects','psychology-autopilot'])});
 assert.equal(admin.sidebarModules.includes('psychology-website'),true);
 assert.equal(admin.sidebarModules.indexOf('psychology-website'),admin.sidebarModules.indexOf('psychology-effects')+1);
 const operator=toPublicUser({id:'operator',role:'operator',sidebar_modules_json:JSON.stringify(['psychology-effects','psychology-website'])});
 assert.equal(operator.sidebarModules.includes('psychology-website'),false);
});
test('website UI handles mobile, safe content, attribution links, paging and failed/stale reads',{skip:!chrome,timeout:90000},async t=>{
 let mode='ready',requests=[],generated=false;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/auth/me'){
   res.setHeader('content-type','application/json');res.end(JSON.stringify({user:{id:'admin',username:'admin',role:'admin',sidebarModules:SIDEBAR_MODULES.map(m=>m.id)},home:'/',sidebarModules:SIDEBAR_MODULES}));return;
  }
  if(url.pathname==='/api/psychology-website/links'){
   assert.equal(req.method,'POST');generated=true;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));return;
  }
  if(url.pathname==='/api/psychology-website'){
   requests.push(Object.fromEntries(url.searchParams));
   const selectedMode=mode,value=fixture();
   const funnelRows=[
    {connectionId:'a',username:'account_a',profileViews:100,profileDays:7,expectedDays:7,profileComplete:true,coverageComplete:true,clicks:20,arrived:15,started:10,finished:6,paid:2},
    {connectionId:'b',username:'account_b',profileViews:null,profileDays:0,expectedDays:7,profileComplete:false,coverageComplete:true,clicks:10,arrived:5,started:2,finished:1,paid:0}
   ];
   value.funnel={ready:true,window:{from:'2026-09-30',to:'2026-10-06'},startedAt:Date.parse('2026-09-30T00:00:00Z'),rows:funnelRows.map(row=>({...row,summary:summarizeFunnel([row])})),summary:summarizeFunnel(funnelRows),definition:'同次点击去重'};

   value.receivers[0].trackingUrl=generated?'https://deeppersonaai.com/go/123456abcd':null;
   value.links={rows:generated?[{connectionId:'a',trackingUrl:value.receivers[0].trackingUrl,visits:12,filtered:2}]:[]};

   value.sources.page=Number(url.searchParams.get('sourcePage')||1);
   if(url.searchParams.get('period')==='today')value.window.from='2026-10-06';
   res.setHeader('content-type','application/json');
   if(selectedMode==='error'){res.statusCode=503;res.end(JSON.stringify({error:'测试模拟：来源暂不可用'}));return;}
   const send=()=>res.end(JSON.stringify(value));
   if(url.searchParams.get('period')==='today')setTimeout(send,250);else send();
   return;
  }
  const name=url.pathname==='/psychology-website'?'psychology-website.html':url.pathname.slice(1),file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/svg+xml');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/psychology-website');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));
 await page.waitForSelector('.side-tabs a[href="/psychology-website"]');
 assert.match(await page.$eval('.web-scope',e=>e.textContent),/TikTok 渠道概况/);
 assert.match(await page.$eval('#channelScope',e=>e.textContent),/来源不明不计入/);
 assert.equal(await page.$$eval('#metrics article',rows=>rows.length),3);
 assert.doesNotMatch(await page.$eval('#metrics',e=>e.textContent),/页面访问|全站|104/);
 assert.doesNotMatch(await page.$eval('#days',e=>e.textContent),/页面访问|104/);
 assert.match(await page.$eval('#attribution',e=>e.textContent),/已识别为 TikTok/);
 assert.deepEqual(await page.$$eval('.side-tabs a',links=>{
  const index=links.findIndex(a=>a.getAttribute('href')==='/psychology-website');
  return [links[index-1].textContent.trim(),links[index].textContent.trim()];
 }),['数据概览','独立站转化']);
 for(const width of [1366,390,320]){
  await page.setViewport({width,height:900});
  for(const tab of ['overview','sources','orders','links']){
   await page.click('[data-tab="'+tab+'"]');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow '+width+' '+tab);
  }
  await page.click('[data-tab="overview"]');
  if(process.env.WEBSITE_QA_SCREENSHOTS){const dir=path.resolve(root,'../work/website-qa');fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'website-'+width+'.png'),fullPage:true});}
 }
 assert.match(await page.$eval('#journeyStages',e=>e.textContent),/成功进站/);
 assert.match(await page.$eval('#journeyLosses',e=>e.textContent),/未确认进站/);
 await page.select('#journeyAccount','a');
 assert.match(await page.$eval('#profileClickHint',e=>e.textContent),/20.0%/);
 assert.equal(await page.$$eval('#journeyAccounts tbody tr',rows=>rows.length),1);
 await page.select('#journeyAccount','b');
 assert.match(await page.$eval('#journeyStages',e=>e.textContent),/暂无/);
 assert.match(await page.$eval('#profileClickHint',e=>e.textContent),/参考点击率：—/);
 await page.select('#journeyAccount','');
 assert.equal(await page.$eval('#sources',e=>e.querySelectorAll('img').length),0);
 assert.match(await page.$eval('#sources',e=>e.textContent),/<img src=x/);
 await page.click('[data-tab="links"]');assert.equal(await page.$eval('#trackingUrl',e=>e.value),'');
 await page.click('#createLinks');await page.waitForFunction(()=>document.getElementById('trackingUrl').value.includes('/go/'));
 assert.equal(await page.$eval('#trackingUrl',e=>e.value),'https://deeppersonaai.com/go/123456abcd');
 assert.match(await page.$eval('#linkStats',e=>e.textContent),/12 次/);
 assert.equal(await page.$eval('#createLinks',e=>e.disabled),true);
 assert.match(await page.$eval('#campaignNote',e=>e.textContent),/等待承接配置/);
 await page.click('[data-tab="sources"]');await page.click('#sourceNext');await page.waitForFunction(()=>document.getElementById('sourcePage').textContent.includes('第 2'));
 assert.equal(requests.at(-1).sourcePage,'2');
 mode='error';await page.click('#refresh');await page.waitForFunction(()=>!document.getElementById('failure').hidden);
 assert.match(await page.$eval('#metrics',e=>e.textContent),/60/);assert.match(await page.$eval('#status',e=>e.textContent),/上次成功/);
 mode='ready';await page.click('[data-period="today"]');await page.click('[data-period="7d"]');
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));
 assert.match(await page.$eval('#rangeLabel',e=>e.textContent),/2026-09-30/);
 const before=requests.length;await page.click('[data-period="range"]');
 await page.$eval('#from',e=>{e.value='2026-10-01';e.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(requests.length,before);assert.match(await page.$eval('#rangeLabel',e=>e.textContent),/2026-09-30/);
 assert.deepEqual(errors,[]);
});
