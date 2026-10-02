import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function harness(file,{hash='',search='',comments=[],watches=[],records=[],sources=[]}={}){
 const nodes=new Map(),requests=[],historyCalls=[];
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',innerHTML:'',hidden:false,listeners:{},dataset:{},disabled:false,addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(name,value){this[name]=value;},focus(){this.focused=true;},click(){this.clicked=true;this.listeners.click?.();},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(s);};
 const tabs=[node('#recordsAutoTab'),node('#recordsManualTab')];tabs[0].dataset.view='auto';tabs[1].dataset.view='manual';
 const location={pathname:'/psychology-comments',hash,search};
 const context=vm.createContext({document:{querySelector:node,querySelectorAll:selector=>selector.includes('data-view')?tabs:[]},location,URLSearchParams,window:{addEventListener(){},psychologyProductionDetail:async(id,body)=>{body.innerHTML='readonly '+id;}},history:{replaceState(_state,_title,url){historyCalls.push(url);}},fetch:async(path,init)=>{requests.push({path,method:init?.method||'GET',body:init?.body?JSON.parse(init.body):undefined});let d;
  if(path.includes('/templates'))d={templates:[{template:'psychology',label:'四图测试模板',enabled:1,delay_minutes:120,auto_reply_enabled:1,reply_hours:48,reply_max:100}]};
  else if(path.includes('/records'))d={items:records,total:records.length};
  else if(path.includes('/sources?'))d={items:sources,hasMore:true};
  else if(path.includes('auto-replies'))d={items:watches,total:watches.length};
  else d={items:comments,total:comments.length};return{ok:true,json:async()=>d};}});
 vm.runInContext(read(file),context);
 return{node,requests,historyCalls,tabs};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const key=(h,id,key)=>h.node(id).listeners.keydown({key,preventDefault(){}});
test('comment tabs preserve the deep link, support keyboard navigation and leave action controls independent',async()=>{
 const h=harness('psychology-comments.js',{hash:'#autoReplies',search:'?template=psychology'});await tick();
 assert.equal(h.node('#autoReplies').hidden,false);assert.equal(h.node('#revealPanel').hidden,true);assert.equal(h.node('#commentRepliesTab')['aria-selected'],'true');assert.equal(h.node('#commentRevealTab').tabIndex,-1);
 h.node('#commentRevealTab').listeners.click();assert.equal(h.node('#revealPanel').hidden,false);h.node('#commentRepliesTab').listeners.click();assert.equal(h.node('#autoReplies').hidden,false);
 key(h,'#commentRepliesTab','Home');assert.equal(h.node('#revealPanel').hidden,false);assert.equal(h.node('#autoReplies').hidden,true);assert.equal(h.node('#commentRevealTab').focused,true);
 key(h,'#commentRevealTab','ArrowRight');assert.equal(h.node('#autoReplies').hidden,false);assert.equal(h.node('#commentRepliesTab').tabIndex,0);
 key(h,'#commentRepliesTab','ArrowLeft');assert.equal(h.node('#revealPanel').hidden,false);key(h,'#commentRevealTab','End');assert.equal(h.node('#autoReplies').hidden,false);
 assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);assert.equal(h.historyCalls.at(-1),'/psychology-comments?template=psychology#autoReplies');
 h.node('#replySettings').listeners.click();assert.equal(h.node('#template').focused,true);assert.equal(h.node('#revealPanel').hidden,false);
});
test('reveal rows retain cancellation eligibility, review actions, missing time and escaped comment text',async()=>{
 const h=harness('psychology-comments.js',{comments:[
  {id:'a',title:'<unsafe>',text:'<script>',status:'pending',attempts:0,delay_minutes:120},
  {id:'b',title:'attempted',text:'B',status:'pending',attempts:1,delay_minutes:120},
  {id:'c',title:'review',text:'C',status:'needs_review',error:'<error>',delay_minutes:120},
  {id:'d',title:'published',text:'D',status:'published',comment_id:'saved',delay_minutes:120}
 ]});await tick();const html=h.node('#rows').innerHTML;
 assert.match(html,/data-cancel="a"/);assert.doesNotMatch(html,/data-cancel="[bcd]"/);assert.match(html,/data-check="c"/);assert.match(html,/等待发布成功/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<unsafe>|<script>|<error>/);
 const button={dataset:{cancel:'a'},disabled:false};await h.node('#rows').onclick({target:{closest:()=>button}});assert.equal(h.requests.at(-2).path,'/api/psychology-comments/a/cancel');assert.equal(h.requests.at(-2).method,'POST');
});
test('compact settings retain the future-batch template policy and limits',async()=>{
 const h=harness('psychology-comments.js');await tick();h.node('#template').value='psychology';h.node('#enabled').checked=true;h.node('#autoReplyEnabled').checked=true;h.node('#delay').value='120';h.node('#replyHours').value='48';h.node('#replyMax').value='100';
 await h.node('#settingsForm').onsubmit({preventDefault(){}});const request=h.requests.find(r=>r.method==='PUT');assert.deepEqual(request.body,{template:'psychology',enabled:true,delayMinutes:120,autoReplyEnabled:true,replyHours:48,replyMax:100});assert.match(h.node('#settingsStatus').textContent,/之后创建的批次/);
});
test('reply task table keeps per-video counts, status-specific pause/resume, escaped errors and record checks',async()=>{
 const h=harness('psychology-auto-replies.js',{watches:[{id:'a',title:'<title>',account_name:'demo',video_id:'v1',status:'active',sent_count:0,max_replies:100,pending_count:2,error_count:1,error:'<failure>'},{id:'b',title:'paused',status:'paused'},{id:'c',title:'complete',status:'completed'}],records:[{id:'r',status:'needs_review',author_name:'<name>',comment_text:'C',choice:'C',text:'reply'}]});await tick();const html=h.node('#replyWatches').innerHTML;
 assert.match(html,/^<tr>/);assert.match(html,/data-toggle="a" data-action="pause"/);assert.match(html,/data-toggle="b" data-action="resume"/);assert.doesNotMatch(html,/data-toggle="c"/);assert.match(html,/<td>0 \/ 100<\/td>/);assert.match(html,/&lt;failure&gt;/);assert.match(html,/尚未扫描/);
 await h.node('#replyWatches').onclick({target:{closest:()=>({dataset:{records:'a'}})}});assert.match(h.node('#replyRecords').innerHTML,/data-check-reply="r"/);assert.match(h.node('#replyRecords').innerHTML,/&lt;name&gt;/);
 await h.node('#replyRecords').onclick({target:{closest:()=>({dataset:{checkReply:'r'},disabled:false})}});assert.ok(h.requests.some(r=>r.path==='/api/psychology-auto-replies/a/check'&&r.method==='POST'&&r.body.id==='r'));
});
test('record view keyboard tabs preserve manual history, row provenance, cleaned records and paging filters',async()=>{
 const h=harness('psychology-publish-sources.js',{sources:[{id:'1',mediaType:'photo',sourceType:'library',variantId:'rewrite-1',status:'published',detailJobId:'job',title:'<unsafe>'},{id:'2',status:'cleaned'}]});await tick();assert.match(h.node('#rows').innerHTML,/文案库改写/);assert.match(h.node('#rows').innerHTML,/任务已清理/);assert.match(h.node('#rows').innerHTML,/&lt;unsafe&gt;/);assert.doesNotMatch(h.node('#rows').innerHTML,/data-delete/);
 key(h,'#recordsAutoTab','End');assert.equal(h.node('#manualView').hidden,false);assert.equal(h.node('#autoView').hidden,true);assert.equal(h.tabs[1].tabIndex,0);assert.equal(h.node('#refreshBoard').clicked,true);
 key(h,'#recordsManualTab','Home');assert.equal(h.node('#autoView').hidden,false);assert.equal(h.tabs[0]['aria-selected'],'true');
 h.node('#range').value='7d';h.node('#range').listeners.change();await tick();h.node('#nextPage').listeners.click();await tick();assert.match(h.requests.at(-1).path,/offset=20.*range=7d/);assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
});