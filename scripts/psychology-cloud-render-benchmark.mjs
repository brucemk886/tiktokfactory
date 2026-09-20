// Only generates synthetic images; never creates jobs, calls AI or publishes.
// node scripts/psychology-cloud-render-benchmark.mjs [--local] [--count=20]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {loadCardModules,openCloudCardRenderer} from '../factory-cloud/src/psychology-cloud-renderer.js';
import {openCardRenderer} from './psychology-auto-photo-job.js';
const root=process.cwd(),local=process.argv.includes('--local');
const count=Math.max(1,Math.min(20,Number(process.argv.find(a=>a.startsWith('--count='))?.split('=')[1])||20));
const output=path.join(root,'work/cloud-photo-benchmark');fs.mkdirSync(output,{recursive:true});
const executablePath=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome=await puppeteer.launch({executablePath,headless:true});
let imageData;
try {
  const page=await chrome.newPage();
  imageData=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1080;c.height=1440;const g=c.getContext('2d');
    const sky=g.createLinearGradient(0,0,0,1440);sky.addColorStop(0,'#99cbe2');sky.addColorStop(.65,'#ffe0b4');sky.addColorStop(1,'#528b96');g.fillStyle=sky;g.fillRect(0,0,1080,1440);
    g.fillStyle='#fff2c9';g.beginPath();g.arc(770,760,90,0,Math.PI*2);g.fill();
    g.fillStyle='#60949c';g.fillRect(0,1020,1080,420);g.strokeStyle='#bce2dc';g.lineWidth=4;
    for(let i=0;i<10;i++){g.beginPath();g.moveTo(0,1060+i*35);g.bezierCurveTo(400,1040+i*35,750,1080+i*35,1080,1060+i*35);g.stroke();}
    return c.toDataURL('image/jpeg',.9);
  });
} finally {await chrome.close();}
const env={ASSETS:{async fetch(request){return new Response(fs.readFileSync(path.join(root,'public',new URL(request.url).pathname.slice(1))));}}};
const modules=local?await loadCardModules(env):null;
const cfg=local?null:JSON.parse(fs.readFileSync(process.env.FACTORY_WORKER_CONFIG||'D:/localfactory-data/work/factory-cloud-worker.json','utf8'));
const samples=[];let next=0;
async function worker(){
  while(next<count){
    const index=next++,mode=index%2?'mixed':'text';
    const pages=Array.from({length:6},(_,i)=>({template:i?'content':'cover',title:i?'Notice the pattern':'Why you pull away when someone gets close',body:i?'Taking a pause can help you understand what you feel. **Name the feeling**, ask for space, and agree on when to reconnect.':'',...(mode==='mixed'&&i%2?{template:'stock',imageData,title:'Take a moment to breathe',body:'Pelan-pelan. Pahami perasaanmu, lalu bicarakan dengan tenang.'}:{})}));
    let result;
    if(local){
      const renderer=await openCloudCardRenderer(env,modules,{launch:()=>puppeteer.launch({executablePath,headless:true})});let images=[];
      let browserMs;try{images=await renderer.renderBatch(pages.map((source,index)=>({source,index,template:'photo-original',imageData:source.imageData||''})));}finally{browserMs=await renderer.close();}
      // Exact shared rendering behavior on the same engine/fonts.
      if(index===0){const old=await openCardRenderer(root);try{if(await old.render(pages[0],0,'photo-original')!==images[0])throw new Error('local/cloud adapter rendering differs');}finally{await old.close();}}
      result={images,browserMs};
    } else {
      const response=await fetch(String(cfg.url).replace(/\/+$/,'')+'/api/worker/psychology-cloud-photo/probe',{method:'POST',headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/json'},body:JSON.stringify({pages}),signal:AbortSignal.timeout(240000)});
      result=await response.json();if(!response.ok)throw new Error('Cloud probe '+response.status+': '+(result.error||''));
    }
    if(result.images?.length!==6)throw new Error('Incomplete photo set');
    const imageBytes=result.images.reduce((sum,data)=>sum+Buffer.from(data.split(',')[1],'base64').length,0);
    if(index<2)for(const [i,data] of result.images.entries())fs.writeFileSync(path.join(output,(local?'local':'cloud')+'-'+mode+'-'+i+'.jpg'),Buffer.from(data.split(',')[1],'base64'));
    samples.push({index,mode,browserMs:result.browserMs,imageBytes,meteredBrowserMs:result.meteredBrowserMs,maxConcurrentSessions:result.maxConcurrentSessions});
    console.log(JSON.stringify({completed:samples.length,total:count,mode,browserMs:result.browserMs}));
  }
}
const started=Date.now();await Promise.all([worker(),worker()]);samples.sort((a,b)=>a.index-b.index);
const browserMs=samples.reduce((sum,s)=>sum+s.browserMs,0),sorted=samples.map(s=>s.browserMs).sort((a,b)=>a-b);
const report={scope:local?'Local compatibility test of cloud adapter':'Real Cloudflare browser rendering, synthetic text/stock fixtures; no AI, R2 upload, hub submission or TikTok publication',at:new Date().toISOString(),posts:count,images:count*6,concurrency:2,wallSeconds:(Date.now()-started)/1000,browserSeconds:browserMs/1000,meanPostBrowserSeconds:browserMs/count/1000,p95PostBrowserSeconds:sorted[Math.ceil(count*.95)-1]/1000,projected600BrowserMinutes:browserMs/count*600/60000,meteredBrowserSeconds:samples.every(s=>Number.isFinite(s.meteredBrowserMs))?samples.reduce((sum,s)=>sum+s.meteredBrowserMs,0)/1000:null,samples};
fs.writeFileSync(path.join(root,'docs/reports/2026-09-20-psychology-'+(local?'cloud-adapter-local':'cloud-render-benchmark')+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
