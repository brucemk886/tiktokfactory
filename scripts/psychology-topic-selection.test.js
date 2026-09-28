import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {collectTopics,deleteSelectedTopics} from '../public/psychology-topic-selection.js';

test('all-result selection stays paginated and preserves template/filter/revision snapshots',async()=>{
 const calls=[];
 const selected=await collectTopics(async path=>{const q=new URL(path,'https://factory.test').searchParams;calls.push(q);return {totalPages:2,hasMore:q.get('page')==='1',items:q.get('page')==='1'?[{id:'a',revision:3}]:[{id:'b',revision:7}]};},'/topics',{template:'psychology-collage',query:'love',enabled:'inactive',page:'3'});
 assert.deepEqual([...selected.keys()],['a','b']);assert.equal(selected.get('b').revision,7);
 assert.deepEqual(calls.map(q=>q.get('page')),['1','2']);
 for(const q of calls){assert.equal(q.get('pageSize'),'100');assert.equal(q.get('query'),'love');assert.equal(q.get('template'),'psychology-collage');assert.equal(q.get('enabled'),'inactive');}
});
test('partial deletion reports revision conflicts and continues without changing stale revisions',async()=>{
 const calls=[],progress=[];
 const result=await deleteSelectedTopics(async(path,method,body)=>{calls.push([path,method,body]);if(path.endsWith('/b'))throw Error('revision conflict');},'/topics',[{id:'a',revision:1},{id:'b',title:'B',revision:2},{id:'c',revision:4}],(...v)=>progress.push(v));
 assert.equal(result.deleted,2);assert.deepEqual(result.failed,[{id:'b',title:'B',error:'revision conflict'}]);assert.equal(calls.length,3);assert.deepEqual(calls[1],['/topics/b','DELETE',{revision:2}]);assert.deepEqual(progress.at(-1),[3,3]);
});

test('browser: select page, cancel, cross-page filtered deletion, conflict, empty last page and bank isolation',async t=>{
 const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(p=>fs.existsSync(p));
 if(!executablePath){t.skip('Chrome unavailable');return;}
 const templates=['psychology','psychology-collage','psychology-target-2'].map(id=>({id,label:id,hint:'Test bank'}));
 let rows=Array.from({length:21},(_,i)=>({id:'topic-'+i,template:'psychology-collage',title:'Question '+i,content:'Body',category:'',priority:50,enabled:true,usageCount:0,revision:2}));
 rows.push({...rows[0],id:'topic-other',template:'psychology',title:'Other bank'});
 const deletes=[],reads=[];let conflict=true;
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/psychology-template-topics')){
   res.setHeader('Content-Type','application/json');
   if(req.method==='DELETE'){
    let text='';for await(const chunk of req)text+=chunk;
    const id=u.pathname.split('/').at(-1);deletes.push({id,...JSON.parse(text)});
    if(conflict&&id==='topic-0'){res.statusCode=409;res.end(JSON.stringify({error:'题目已被修改'}));return;}
    rows=rows.filter(r=>r.id!==id);res.end('{"ok":true}');return;
   }
   if(u.pathname.endsWith('/api-key')){res.end('{"configured":false}');return;}
   reads.push(u.searchParams.toString());
   const items=rows.filter(r=>r.template===u.searchParams.get('template')),page=Number(u.searchParams.get('page')||1),pageSize=Number(u.searchParams.get('pageSize')||20);
   const counts=Object.fromEntries(templates.map(t=>[t.id,{total:rows.filter(r=>r.template===t.id).length,enabled:0,unused:0}]));
   res.end(JSON.stringify({items:items.slice((page-1)*pageSize,page*pageSize),templates,counts,total:items.length,totalPages:Math.max(1,Math.ceil(items.length/pageSize)),hasMore:page*pageSize<items.length}));return;
  }
  const file=u.pathname==='/'?'psychology-topic-bank.html':u.pathname.slice(1);
  if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404).end();return;}
  if(file==='access.js'||file==='admin-ui.js'){res.setHeader('Content-Type','text/javascript');res.end('');return;}
  const path=new URL('../public/'+file,import.meta.url);
  if(!fs.existsSync(path)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const {default:puppeteer}=await import('puppeteer-core');const browser=await puppeteer.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?template=psychology-collage');
 await page.waitForSelector('[data-select-topic]');
 await page.click('#selectPage');assert.equal(await page.$eval('#selectedCount',e=>e.textContent),'已选 20 道');
 await page.click('[data-select-topic]');assert.equal(await page.$eval('#selectPageCheckbox',e=>e.indeterminate),true);
 page.once('dialog',d=>d.dismiss());await page.click('#deleteSelected');assert.equal(deletes.length,0);
 await page.click('#nextPage');await page.waitForFunction(()=>document.querySelector('#pageInfo').textContent.includes('第 2'));
 assert.equal(await page.$eval('#selectedCount',e=>e.textContent),'已选 0 道');
 await page.click('#selectPage');page.once('dialog',d=>d.accept());await page.click('#deleteSelected');
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已删除 1 道'));
 assert.match(await page.$eval('#pageInfo',e=>e.textContent),/第 1/);
 // Unsaved search edits must not silently change the visible filter scope used by Select All.
 await page.type('#search','not submitted');await page.click('#selectAllResults');
 await page.waitForFunction(()=>document.querySelector('#selectedCount').textContent==='已选 20 道'&&!document.querySelector('#bankDetail').inert);
 assert.equal(new URLSearchParams(reads.at(-1)).get('query'),'');
 page.once('dialog',d=>{assert.match(d.message(),/20 道/);d.accept();});await page.click('#deleteSelected');
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已删除 19 道，失败 1 道'));
 assert.deepEqual(rows.map(r=>r.id),['topic-0','topic-other']);assert.ok(deletes.every(d=>d.revision===2));assert.ok(!deletes.some(d=>d.id==='topic-other'));
 assert.match(await page.$eval('#message',e=>e.textContent),/题目已被修改/);
 conflict=false;await page.click('#selectPage');page.once('dialog',d=>d.accept());await page.click('#deleteSelected');
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已删除 1 道，失败 0 道'));
 assert.equal(await page.$eval('#deleteSelected',e=>e.disabled),true);assert.deepEqual(rows.map(r=>r.id),['topic-other']);
 assert.deepEqual(errors,[]);
});
