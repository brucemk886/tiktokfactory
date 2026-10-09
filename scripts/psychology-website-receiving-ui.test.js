import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {DEFAULT_IMPORTED_PHOTO_CTA} from './psychology-imported-photo-policy.js';
test('website receiving tab survives analytics failure, saves fields separately, previews mapping and preserves other drafts',async t=>{
 const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url))),out=path.resolve(root,'../tmp/receiving-ui');fs.mkdirSync(out,{recursive:true});
 const html=fs.readFileSync(path.join(root,'psychology-website.html'),'utf8').replace(/<script src="\/(?:access|admin-ui).js"[^>]*><\/script>/g,'');
 const calls=[],errors=[],data={revision:0,config:{receivers:[{connectionId:'b',username:'receiver',linkReady:true}],cta:{...DEFAULT_IMPORTED_PHOTO_CTA}},ctaDefaults:DEFAULT_IMPORTED_PHOTO_CTA,accounts:[{connectionId:'a',username:'publisher',name:'Publisher',canPublish:true,candidate:false,followers:300},{connectionId:'b',username:'receiver',name:'Receiver',canPublish:true,candidate:true,followers:1500}],publisherIds:['a','b'],routes:{a:'b',b:'b'}};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://test');if(url.pathname==='/api/psychology-website/receiving'){
  if(req.method==='PATCH'){let body='';for await(const c of req)body+=c;body=JSON.parse(body);calls.push(body);data.revision++;if(body.section==='receivers')data.config.receivers=body.receivers.map(r=>({...r,username:'receiver'}));if(body.section==='cta')data.config.cta=body.cta;}
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));return;
 }
 if(url.pathname==='/api/psychology-website'){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Analytics temporarily unavailable'}));return;}
 if(url.pathname==='/psychology-website'){res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;}
 const target=path.resolve(root,url.pathname.slice(1));if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/plain'}).end(fs.readFileSync(target));
 }catch(e){res.writeHead(500).end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {default:puppeteer}=await import('puppeteer-core'),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());await page.setViewport({width:1440,height:1000});
 await page.goto(origin+'/psychology-website?tab=receiving',{waitUntil:'networkidle0'});await page.waitForSelector('#wrSaveCta');assert.equal(await page.$eval('#websiteAnalytics',n=>n.hidden),true);assert.equal(calls.length,0);
 const fill=async(id,value)=>page.$eval(id,(n,v)=>{n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await fill('#wrOriginalPreview','Original photo caption.');await fill('#wrMention','Take the test at {account}.');await fill('#wrSelf','Take the test via my bio.');await page.select('#wrPreviewAccount','a');assert.equal(await page.$eval('#wrFinalPreview',n=>n.textContent),'Original photo caption.\n\nTake the test at @receiver.');
 await page.select('#wrPreviewAccount','b');assert.equal(await page.$eval('#wrFinalPreview',n=>n.textContent),'Original photo caption.\n\nTake the test via my bio.');assert.match(await page.$eval('#wrRoutes',n=>n.textContent),/@publisher → @receiver/);
 await page.click('#wrSaveReceivers');await page.waitForFunction(()=>document.getElementById('wrReceiversStatus').textContent.includes('已保存'));assert.equal(calls[0].section,'receivers');assert.equal(calls[0].cta,undefined);assert.equal(calls[0].enabled,undefined);assert.equal(await page.$eval('#wrMention',n=>n.value),'Take the test at {account}.');
 await page.click('[data-wr-link]');await page.click('#wrSaveCta');await page.waitForFunction(()=>document.getElementById('wrCtaStatus').textContent.includes('已保存'));assert.equal(calls[1].section,'cta');assert.equal(calls[1].receivers,undefined);assert.equal(calls[1].cta.mention,'Take the test at {account}.');assert.equal(await page.$eval('[data-wr-link]',n=>n.checked),false,'other unsaved receiver confirmation survives');
 await page.click('#wrRestoreCta');assert.equal(calls.length,2);assert.equal(await page.$eval('#wrMention',n=>n.value),DEFAULT_IMPORTED_PHOTO_CTA.mention);
 for(const width of [1440,390,320]){await page.setViewport({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+width);await (await page.$('#websiteReceiving')).screenshot({path:path.join(out,'settings-'+width+'.png')});}
 await page.setViewport({width:1440,height:1000});await page.click('#websiteLinks>summary');await page.waitForFunction(()=>document.getElementById('linksStatus').textContent.includes('Analytics temporarily unavailable'));assert.equal(await page.$eval('#wrSaveCta',n=>n.disabled),false);assert.equal(await page.$eval('#wrMention',n=>n.checkVisibility()),true);assert.equal(await page.$eval('#webLinksContent',n=>n.hidden),true);
 await page.click('[data-tab="overview"]');await page.waitForFunction(()=>!document.getElementById('failure').hidden);await page.click('[data-tab="receiving"]');assert.equal(await page.$eval('#websiteReceiving',n=>n.hidden),false);assert.deepEqual(errors,[]);
});
