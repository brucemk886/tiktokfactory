import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {VISUAL_STYLES} from '../public/psychology-visual-styles.js';
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('four admin API entries load rules, scope selection, one-time key display and live style previews', {skip:!fs.existsSync(chrome)},async t=>{
 const pages={'/psychology-effects':'official-group-report.html','/psychology-ops-report':'psychology-operations.html','/psychology-autopilot':'psychology-autopilot.html','/psychology-publish-designs':'psychology-creative.html'};
 const available=['effects','operations','autopilot','styles'],writes=[];
 const user={username:'local-test',role:'admin',sidebarModules:['psychology-effects','psychology-ops-report','psychology-autopilot','psychology-publish-designs']};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local.test');let body='';
  for await(const chunk of req)body+=chunk;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(url.pathname==='/api/auth/me')return res.end(JSON.stringify({user,sidebarModules:[],home:'/'}));
  if(url.pathname==='/api/psychology-management/api-key'){
   if(req.method==='POST'){writes.push(JSON.parse(body));return res.end(JSON.stringify({apiKey:'local-test-only'}));}
   return res.end(JSON.stringify({available,configured:false,scopes:[]}));
  }
  if(url.pathname==='/api/psychology-management/styles')return res.end(JSON.stringify({items:VISUAL_STYLES.map(s=>({...s,enabled:true})),active:20}));
  if(url.pathname.startsWith('/api/'))return res.end('{}');
  const name=pages[url.pathname]||url.pathname.slice(1);
  if(!/^[a-z0-9_.-]+$/i.test(name)){res.writeHead(404);return res.end();}
  const file=new URL('../public/'+name,import.meta.url);
  if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'html':'text/html','js':'text/javascript','css':'text/css','txt':'text/plain'}[name.split('.').pop()]||'application/octet-stream')+'; charset=utf-8');
  res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await puppeteer.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
 const base='http://127.0.0.1:'+server.address().port;
 for(const route of Object.keys(pages)){
  await page.goto(base+route);
  await page.waitForFunction(()=>[...document.querySelectorAll('header button')].some(b=>b.textContent==='API 接口'));
  if(route.endsWith('designs')){await page.waitForSelector('#styleGallery canvas');assert.equal(await page.$$eval('#styleGallery .style-card',a=>a.length),20);}
  await page.evaluate(()=>[...document.querySelectorAll('header button')].find(b=>b.textContent==='API 接口').click());
  await page.waitForFunction(()=>document.querySelector('[data-guide]')?.value.includes('/autopilot'));
  assert.equal(await page.$$eval('[data-scopes] input:checked',a=>a.length),4);
  assert.equal(await page.$eval('[data-secret-wrap]',e=>e.hidden),true);
  assert.equal(await page.$eval('[data-guide]',e=>e.value.includes(location.origin)),true);
  if(route.endsWith('designs')){
   await page.screenshot({path:path.join(os.tmpdir(),'psychology-management-api-ui.png')});
   await page.click('[data-scopes] input[value="styles:write"]');
   await page.click('[data-create]');
   await page.waitForFunction(()=>document.querySelector('[data-secret]').value==='local-test-only');
   assert.deepEqual(writes[0].scopes,['effects:read','operations:read','autopilot:read','styles:read','styles:write']);
  }
  await page.click('.management-api-dialog [data-close]');
  await page.waitForFunction(()=>document.querySelector('[data-secret]').value==='');
 }
 assert.equal(writes.length,1);
});
