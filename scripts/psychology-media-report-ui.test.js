import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const repoRoot=fileURLToPath(new URL('../',import.meta.url));
import puppeteer from 'puppeteer-core';
import {fixture} from '../factory-cloud/src/psychology-cloud-test-fixture.js';
import {handleScalableOperations} from '../factory-cloud/src/psychology-report-query.js';
import {computeGroupReport} from './official-group-report.js';
import {SIDEBAR_MODULES} from '../factory-cloud/src/sidebar.js';
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
test('desktop overview and operations compare media, preserve filters and exclude stale reads',{skip:!fs.existsSync(chrome),timeout:60000},async t=>{
 const f=await fixture(t),now=Date.now(),requests=[],errors=[];let fail=false,delay=0;
 f.sqlite.exec("INSERT INTO official_account_assignments(account_key,group_id) VALUES('a','g')");
 const videos=[{id:'1',title:'Photo A',mediaType:'photo',views:1200,likes:0,comments:2,shares:1,createdAt:now},{id:'2',title:'Photo missing',mediaType:'photo',views:null,createdAt:now},{id:'3',title:'Video zero',mediaType:'video',views:0,likes:0,createdAt:now},{id:'4',title:'Unclassified',views:50,createdAt:now}];
 for(const v of videos.slice(0,3))f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,state,published_at,schedule_at,views,likes) VALUES(?,'batch','tiktok:a',?,'published',?,?,?,?)").run(v.id,v.mediaType,now,now,v.views,v.likes??null);
 const user={id:'admin',username:'admin',role:'admin',sidebarModules:SIDEBAR_MODULES.map(r=>r.id)};
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
   requests.push(u);res.setHeader('content-type','application/json');
   if(u.pathname==='/api/auth/me'){res.end(JSON.stringify({user,sidebarModules:SIDEBAR_MODULES}));return;}
   if(fail){res.statusCode=503;res.end(JSON.stringify({error:'模拟读取失败'}));return;}
   if(delay&&u.searchParams.get('media')==='photo')await new Promise(r=>setTimeout(r,delay));
   if(u.pathname==='/api/psychology-operations'){
    const response=await handleScalableOperations(new Request(u),f.env,u,{user});res.statusCode=response.status;res.end(await response.text());return;
   }
   if(u.pathname==='/api/official-tiktok/ops-report'){
    const q=u.searchParams,project={id:'proj-psych',name:'心理学',reportEnabled:true},report=computeGroupReport({project,group:{id:'g',name:'组1'},videos:videos.map(v=>({...v,username:v.username||'alice',account:'tiktok:a'})),media:q.get('media')||'all',period:q.get('period')||'today',fromKey:q.get('from')||'',toKey:q.get('to')||'',now});
    const common={project,groups:[{id:'g',name:'组1'}],report:{...report,groupId:q.get('group')||''},source:'live'};
    if(q.get('view')==='publish')common.report.summary={publishTotal:5,publishSuccess:5,publishFailed:0,riskAccountCount:0};
    if(q.get('view')==='traffic')common.traffic={summary:{profileViews:null,ratio:null,totalAccounts:1,coveredAccounts:0,pairedDays:0,pairedProfileViews:0,pairedVideoViews:0},accounts:[],rows:[]};
    res.end(JSON.stringify(common));return;
   }
   res.statusCode=404;res.end('{}');return;
  }
  const routes={'/psychology-effects':'official-group-report.html','/psychology-ops-report':'psychology-operations.html','/novel-ops-report':'official-group-report.html'};
  const root=path.join(repoRoot,'public'),file=path.resolve(root,routes[u.pathname]||u.pathname.slice(1));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
  res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const browser=await puppeteer.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/psychology-effects');await page.waitForFunction(()=>!document.querySelector('#mediaComparison').hidden);
 assert.equal(await page.$$eval('#mediaComparison tbody tr',rows=>rows.length),3);
 await page.select('#effectsMedia','photo');await page.waitForFunction(()=>document.querySelector('#mediaComparison .is-selected th')?.textContent==='图文');
 assert.match(await page.$eval('#summaryGrid',n=>n.textContent),/发布作品2.*总播放1,200/);assert.equal(new URL(page.url()).searchParams.get('media'),'photo');
 assert.match(await page.$eval('#summaryGrid',n=>n.textContent),/账号全部类型/);assert.match(await page.$eval('#publishOverview',n=>n.textContent),/全部类型/);
 await page.select('#effectsMedia','video');await page.waitForFunction(()=>document.querySelector('#mediaComparison .is-selected th')?.textContent==='视频');
 assert.match(await page.$eval('#summaryGrid',n=>n.textContent),/发布作品1.*总播放0/);
 await page.select('#effectsMedia','unknown');await page.waitForFunction(()=>document.querySelector('#mediaComparison .is-selected th')?.textContent==='类型未知');assert.match(await page.$eval('#summaryGrid',n=>n.textContent),/总播放50/);
 delay=200;await page.select('#effectsMedia','photo');await page.select('#effectsMedia','video');await page.waitForFunction(()=>document.querySelector('#mediaComparison .is-selected th')?.textContent==='视频');delay=0;
 fail=true;await page.click('#queryBtn');await page.waitForFunction(()=>document.querySelector('#reportMeta').textContent.includes('模拟'));assert.equal(await page.$eval('#mediaComparison',n=>n.hidden),true);fail=false;
 await page.select('#effectsMedia','all');await page.waitForFunction(()=>!document.querySelector('#mediaComparison').hidden);
 const qaRoot=path.join(repoRoot,'tmp/media-report-qa');fs.mkdirSync(qaRoot,{recursive:true});await page.screenshot({path:path.join(qaRoot,'overview.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 // Exercise actual detail rows: long handles, full timestamps and both action links.
 videos.push(...[1500,50,828,0].map((views,i)=>({id:'760000000000000000'+i,username:'psychology_long_account_12345678',title:'Sometimes silence says more than words. The signs you should stay silent, no matter what: '+('Long caption content. '.repeat(12)),mediaType:'video',views,likes:50,createdAt:now})));
 await page.click('#queryBtn');await page.waitForFunction(()=>document.querySelector('#normalSection .report-video-table'));
 const checkDetailCells=async selector=>{
  const failures=await page.$$eval(selector,rows=>rows.flatMap(row=>Array.from(row.cells).flatMap((cell,i)=>{
   const box=cell.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(cell);
   const rects=[...range.getClientRects()];
   return rects.filter(r=>r.width>0&&(r.left<box.left-1||r.right>box.right+1)).map(()=>({column:i,text:cell.textContent.slice(0,40),width:box.width}));
  })));
  assert.deepEqual(failures,[],selector+' contents stay inside their column');
 };
 for(const width of [1280,1440,1920]){
  await page.setViewport({width,height:1000});
  for(const tab of ['high','low','anomaly']){
   await page.click('[data-result-tab='+tab+']');
   if(tab==='anomaly')await page.$eval('.report-anomaly',el=>{el.open=true;});
   await checkDetailCells('#'+tab+'Section .report-video-table tr');
  }
  await checkDetailCells('#normalSection .report-video-table tr');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 }
 await page.setViewport({width:1440,height:1000});
 await (await page.$('#normalSection .table-wrap')).screenshot({path:path.join(qaRoot,'detail-columns.png')});
 await page.goto(base+'/psychology-ops-report?period=today');await page.waitForFunction(()=>!document.querySelector('#report').hidden);
 assert.equal(await page.$$eval('#mediaComparison tbody tr',r=>r.length),2);assert.match(await page.$eval('#mediaComparison',n=>n.textContent),/图文2.*1,200.*视频1/);
 const before=await page.$eval('#mediaComparison table',n=>n.textContent);await page.click('[data-media=video]');await page.waitForFunction(()=>!document.querySelector('#report').hidden&&document.querySelector('#mediaComparison .is-selected th')?.textContent==='视频');
 assert.equal(await page.$eval('#mediaComparison table',n=>n.textContent),before);assert.match(await page.$eval('#reportKpis',n=>n.textContent),/累计播放量0/);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-media=video]')).color==='rgb(255, 255, 255)');
 await page.screenshot({path:path.join(qaRoot,'operations.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.goto(base+'/novel-ops-report');await page.waitForFunction(()=>document.readyState==='complete');assert.equal(await page.$eval('#mediaComparison',n=>n.hidden),true);assert.equal(await page.$eval('#effectsMedia',n=>n.checkVisibility()),false);
 assert.deepEqual(errors,[]);assert.equal(f.requests.length,0);
});
