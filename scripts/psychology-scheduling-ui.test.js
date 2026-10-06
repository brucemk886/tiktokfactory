import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
test('scheduling assurance distinguishes stages, escapes evidence and restores through the explicit action',async t=>{
 let fail=false,posts=0;
 const detail={account:'<img src=x onerror=alert(1)>',status:'skipped',state:'',reason:'没有合格内容',scheduleAt:1791298800000};
 const data={asOf:1791290000000,basis:'应处理 = 已建 + 跳过 + 待建 + 待恢复',notification:{reachable:true,checkedAt:1791290000000,reason:'resend-http-401'},alerts:[],rounds:[{date:'2026-10-06',round:0,slotAt:1791298800000,endAt:1791302400000,status:'running',counts:{expected:100,created:60,skipped:20,pending:15,blocked:5,ready:40,submitted:10,published:2},details:[detail]}]};
 const server=createServer((req,res)=>{
  if(req.url.startsWith('/api/')){res.setHeader('content-type','application/json');if(req.method==='POST'){posts++;return res.end('{}');}if(fail){res.statusCode=503;return res.end('{"error":"暂时不可用"}');}return res.end(JSON.stringify(data));}
  if(req.url==='/'){res.setHeader('content-type','text/html');return res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/psychology-autopilot.css"></head><body><section id="scheduleAssurance" class="panel data-section"></section><button id="reload">刷新</button><script type="module" src="/psychology-scheduling.js"></script></body></html>');}
  const name=req.url.slice(1);if(!['app.css','psychology-autopilot.css','psychology-scheduling.js'].includes(name)){res.statusCode=404;return res.end();}
  res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(new URL('../public/'+name,import.meta.url)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setViewport({width:1440,height:900});await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('#recoverScheduling');
 assert.equal(await page.locator('#scheduleAssurance tbody tr td:nth-child(2)').waitHandle().then(h=>h.evaluate(el=>el.textContent)), '100');
 assert.equal(await page.$eval('#scheduleAssurance img',()=>true).catch(()=>false),false);
 await page.click('summary');assert.match(await page.$eval('#scheduleAssurance',el=>el.textContent),/没有合格内容/);
 const output=new URL('../tmp/psychology-scheduling-ui.png',import.meta.url);fs.mkdirSync(new URL('../tmp/',import.meta.url),{recursive:true});await page.screenshot({path:output.pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
 await page.click('#recoverScheduling');await page.waitForFunction(()=>document.querySelector('#scheduleActionStatus')?.textContent.includes('已提交'));
 assert.equal(posts,1);
 assert.match(await page.$eval('#scheduleAssurance',el=>el.textContent),/邮件告警未送达.*401/);
 fail=true;await page.click('#reload');await page.waitForSelector('#retryScheduling');
 assert.match(await page.$eval('#scheduleAssurance',el=>el.textContent),/不能确认当前完整性/);
 assert.equal(await page.$('#scheduleAssurance table'),null);
 fail=false;await page.click('#retryScheduling');await page.waitForSelector('#recoverScheduling');
});