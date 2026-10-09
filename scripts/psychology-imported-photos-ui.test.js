import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
test('real browser configures imported photos without enabling by default, confirms receiver links and shows China times',async t=>{
 const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url))),out=fileURLToPath(new URL('../tmp/imported-photos-ui/',import.meta.url));fs.mkdirSync(out,{recursive:true});
 const html=fs.readFileSync(path.join(root,'psychology-autopilot.html'),'utf8').replace(/<script[^>]*src="(?!\/psychology-imported-photos.js)[^"]+"[^>]*><\/script>/g,'');
 const calls=[],errors=[],data={revision:0,enabled:false,config:{connectionIds:[],receivers:[],isAiGenerated:true},accounts:[{connectionId:'a',username:'alpha',name:'Alpha',canPublish:true,candidate:false,followers:400},{connectionId:'b',username:'receiver',name:'Receiver',canPublish:true,candidate:true,followers:1500},{connectionId:'c',username:'charlie',name:'Charlie',canPublish:false,candidate:true,followers:2000}],inventory:18,checkedAt:0,detail:'配置发布账号和承接账号后，可保存并启用。',nextSlots:[1791556200000,1791567000000,1791574200000],recent:[]};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://test');if(url.pathname==='/api/psychology-autopilot/imported-photos'){
  if(req.method==='PATCH'){const chunks=[];for await(const p of req)chunks.push(p);const body=JSON.parse(Buffer.concat(chunks));calls.push(body);data.revision++;data.enabled=body.enabled;if(!body.pauseOnly)data.config=body;data.detail=data.enabled?'已启用':'已保存，未启用';}
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));return;
 }
 if(url.pathname==='/psychology-autopilot'){res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;}
 const target=path.resolve(root,url.pathname.slice(1));if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/plain'}).end(fs.readFileSync(target));
 }catch(e){res.writeHead(500).end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {default:puppeteer}=await import('puppeteer-core'),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const p=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;p.on('pageerror',e=>errors.push(e.message));await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());
 await p.setViewport({width:1440,height:1000});await p.goto(origin+'/psychology-autopilot',{waitUntil:'networkidle0'});await p.waitForSelector('#ipSave');
 assert.equal(calls.length,0);assert.match(await p.$eval('#ipContent',n=>n.textContent),/22:30/);assert.match(await p.$eval('#ipContent',n=>n.textContent),/01:30/);assert.match(await p.$eval('#ipContent',n=>n.textContent),/03:30/);
 assert.equal(await p.$eval('[data-link-row="b"]',n=>getComputedStyle(n).display),'none');assert.equal(await p.$eval('[data-receiver=""][value="a"]',n=>n.disabled),true);
 await p.click('#ipSelectAll');assert.equal(await p.$$eval('[data-publisher]:checked',ns=>ns.length),2);
 await p.click('[data-receiver][value="b"]');assert.notEqual(await p.$eval('[data-link-row="b"]',n=>getComputedStyle(n).display),'none');await p.click('[data-link][value="b"]');
 assert.match(await p.$eval('#ipCaptionPreview',n=>n.textContent),/@receiver/);await p.click('#ipSave');await p.waitForFunction(()=>document.querySelector('#ipMessage').textContent.includes('已保存'));assert.equal(calls[0].enabled,false);assert.deepEqual(calls[0].connectionIds,['a','b']);assert.equal(calls[0].receivers[0].linkReady,true);
 for(const width of [1440,390,320]){await p.setViewport({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);await p.$eval('#importedPhotoMode',n=>n.scrollIntoView());await (await p.$('#importedPhotoMode')).screenshot({path:path.join(out,'mode-'+width+'.png')});}
 await p.setViewport({width:1440,height:1000});await p.click('#ipEnable');await p.waitForFunction(()=>document.querySelector('#ipMessage').textContent.includes('已启用'));assert.equal(calls[1].enabled,true);
 await p.click('#ipPause');await p.waitForFunction(()=>document.querySelector('#ipMessage').textContent.includes('已暂停'));assert.equal(calls[2].pauseOnly,true);assert.equal(calls[2].enabled,false);assert.deepEqual(errors,[]);
});
