import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const html=read('psychology-copy-library.html');
function harness(script='psychology-copy-library.js') {
 const nodes=new Map();const events=new Map();const requests=[];
 let selectable=[],accepted=true;const confirmations=[];
 const pages=Array.from({length:6},()=>({value:''}));
 for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set('#'+id,{value:'',textContent:'',disabled:false,open:false,dataset:{},classList:{toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},reset(){for(const id of ['variantName','variantTitle','variantCaption'])nodes.get('#'+id).value='';nodes.get('#variantReviewed').checked=false;pages.forEach(p=>p.value='');}});
 const document={querySelector:q=>nodes.get(q)||null,querySelectorAll:q=>q==='[data-variant-page]'?pages:q==='.peer-select'?selectable:[],body:{dataset:{mediaType:'video',sourceAccess:'true'},classList:{contains:c=>c==='copy-library-page'}},addEventListener:(t,fn)=>events.set(t,fn),dispatchEvent:e=>events.get(e.type)?.(e)};
 let respond=()=>({created:1,duplicates:0,page:1,total:0,items:[]});
 const context={confirm:text=>{confirmations.push(text);return accepted;},document,crypto:{randomUUID},CustomEvent:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},location:{hash:''},URL,URLSearchParams,setTimeout,clearTimeout,fetch:async(url,options={})=>{requests.push({url,...options,body:options.body?JSON.parse(options.body):undefined});const data=await respond(url,options);return {ok:true,json:async()=>data};}};
 vm.runInNewContext(read(script),context);
 return {context,nodes,pages,events,requests,document,confirmations,accept:value=>{accepted=value;},setRows:ids=>{selectable=ids.map(id=>({dataset:{peerId:id},checked:false,matches:q=>q==='.peer-select'}));},rows:()=>selectable,respond:fn=>{respond=fn;},async click(data){await nodes.get('#hitRows').listeners.click({target:{closest:()=>({dataset:data})}});},fill(){nodes.get('#variantName').value='Test version';nodes.get('#variantTitle').value='Test title';nodes.get('#variantReviewed').checked=true;pages[0].value='First page';},submit(){return nodes.get('#variantForm').onsubmit({preventDefault(){},submitter:{}});}};
}
const sources=[{id:'photo-source',media_type:'photo',title:'Photo source',content:{pages:[]}}, {id:'video-source',media_type:'video',title:'Video source',content:{transcript:'text'}}];
test('library removes obsolete controls and keeps creation/import out of rewrite details',()=>{
 assert.doesNotMatch(html,/id="(?:productionPanel|moveSelectedBtn|exportOriginalPage|bulkImportPanel|manualVariantPanel)"/);
 const detail=html.match(/<dialog id="rewriteDialog"[\s\S]*?<\/dialog>/)[0];
 assert.doesNotMatch(detail,/variantForm|importForm/);
 assert.match(read('psychology-peer-hits.js'),/data-create-variant/);
 assert.doesNotMatch(read('psychology-peer-hits.js'),/data-copy-original/);
 assert.doesNotMatch(read('psychology-copy-library.js'),/exportOriginalPage|function exportRow|psychology-originals.json/);
});
test('row creation saves to its own photo/video source even after inspecting a different source',async()=>{
 const h=harness();h.events.get('peer-list-loaded')({detail:{items:sources}});
 for(const source of sources){
  await h.click({rewriteOriginal:sources.find(s=>s!==source).id});h.nodes.get('#closeRewrites').onclick();
  await h.click({createVariant:source.id});assert.equal(h.nodes.get('#variantDialog').open,true);assert.match(h.nodes.get('#variantContext').textContent,new RegExp(source.title));
  h.fill();await h.submit();
  const saved=h.requests.filter(r=>r.method==='POST').at(-1);assert.equal(saved.url,'/api/psychology-creative/copies?sourceId='+source.id);assert.deepEqual(saved.body[0].pages,['First page']);assert.match(h.nodes.get('#variantStatus').textContent,/已保存/);h.nodes.get('#closeVariant').onclick();
 }
});
test('in-flight saves cannot switch sources or duplicate requests; retry retains version identity',async()=>{
 const h=harness();h.events.get('peer-list-loaded')({detail:{items:sources}});await h.click({createVariant:sources[0].id});h.fill();
 let reject;h.respond(()=>new Promise((_,r)=>{reject=r;}));const pending=h.submit();await h.submit();await h.click({createVariant:sources[1].id});
 assert.equal(h.requests.length,1);assert.match(h.nodes.get('#variantContext').textContent,/Photo source/);assert.equal(h.nodes.get('#closeVariant').disabled,true);
 reject(new Error('Temporary network failure'));await pending;assert.equal(h.nodes.get('#closeVariant').disabled,false);
 h.respond(()=>({created:1}));await h.submit();assert.equal(h.requests[0].body[0].externalId,h.requests[1].body[0].externalId);assert.equal(h.requests[0].url,h.requests[1].url);
});
test('top-level import does not inherit the last viewed source',async()=>{
 const h=harness();h.events.get('peer-list-loaded')({detail:{items:sources}});await h.click({rewriteOriginal:sources[0].id});h.nodes.get('#closeRewrites').onclick();h.nodes.get('#bulkImportButton').onclick();
 h.nodes.get('#copyJson').value=JSON.stringify([{externalId:'v1',sourceKey:'other-source',pages:['Text']}]);await h.nodes.get('#importForm').onsubmit({preventDefault(){},submitter:{}});
 const saved=h.requests.at(-1);assert.equal(saved.url,'/api/psychology-creative/copies');assert.equal(saved.body[0].sourceKey,'other-source');
});
test('removed jobs panel makes no polling requests and both media tabs still initialize selection',async()=>{
 const h=harness('psychology-peer-production.js');h.events.get('library-source-access')({detail:{canManage:true}});
 for(const mediaType of ['photo','video']){h.document.body.dataset.mediaType=mediaType;h.events.get('peer-media-type-changed')({detail:{mediaType}});h.events.get('peer-list-loaded')();}
 assert.equal(h.requests.length,0);assert.doesNotMatch(html,/produceBtn|原帖复刻/);
});

test('comparison renders escaped source and rewrite text with Chinese and explicit unmatched state',()=>{
 const h=harness();const html=h.context.comparisonMarkup({sourceFound:true,status:'done',original:[{id:'o0',label:'原句',text:'<img src=x onerror=alert(1)>',zh:'原文中文'}],rewrite:[{id:'r0',kind:'body',label:'第 1 句',text:'Rewritten',zh:'改写中文',originalIds:['o0']},{id:'r1',kind:'body',label:'第 2 句',text:'New thought',zh:'新内容',originalIds:[]}]});
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/原文中文/);assert.match(html,/改写中文/);assert.match(html,/新增内容 \/ 未匹配到对应原句/);
});

test('comparison removes duplicate labels, tag-only pages and unused originals; same-page references win',()=>{
 const h=harness();const original=[
  {id:'o0',kind:'title',label:'标题',text:'Title #Tag',zh:'标题 #标签'},
  {id:'o1',kind:'caption',label:'发布文案',text:'Title #Tag',zh:'标题'},
  {id:'o3',kind:'body',label:'第 3 页 · 第 1 句',text:'They pull away',zh:'他们抽离'},
  {id:'o4',kind:'body',label:'第 4 页 · 第 1 句',text:'They need space',zh:'他们需要空间'},
  {id:'o6',kind:'body',label:'第 6 页 · 第 1 句',text:'Save this',zh:'收藏'}];
 const rewrite=[{id:'r0',kind:'title',label:'标题',text:'New title',zh:'新标题',originalIds:['o0']},
 {id:'r3',kind:'body',label:'第 3 页 · 第 1 句',text:'Distance is safety',zh:'距离带来安全',originalIds:['o3','o4']},
 {id:'r4',kind:'body',label:'第 4 页 · 第 1 句',text:'Give room',zh:'给予空间',originalIds:['o4']},
 {id:'r6',kind:'body',label:'第 6 页 · 第 1 句',text:'#AvoidantAttachment #MentalHealth #3',zh:'#回避型依恋 #3',originalIds:[]}];
 const html=h.context.comparisonMarkup({sourceFound:true,status:'done',original,rewrite});
 assert.equal((html.match(/They need space/g)||[]).length,1);
 assert.ok(html.indexOf('They need space')>html.indexOf('<h3>第 4 页'));
 assert.doesNotMatch(html,/<small>|#Tag|#标签|#Avoidant|其余原文|第 6 页|Save this/);
 assert.equal((html.match(/第 3 页 · 第 1 句/g)||[]).length,1);
});


test('select page covers twenty rows and supports indeterminate state',async()=>{
 const h=harness('psychology-peer-production.js');h.setRows(Array.from({length:20},(_,i)=>'id-'+i));h.events.get('peer-list-loaded')();
 h.nodes.get('#selectPageBtn').listeners.click();assert.equal(h.nodes.get('#selectionCount').textContent,'已选 20 条');assert.equal(h.nodes.get('#selectPageCheckbox').checked,true);assert.equal(h.nodes.get('#deleteSelectedBtn').disabled,false);
 const first=h.rows()[0];first.checked=false;h.nodes.get('#hitRows').listeners.change({target:first});assert.equal(h.nodes.get('#selectPageCheckbox').indeterminate,true);
 h.nodes.get('#selectPageCheckbox').listeners.change({target:{checked:false}});assert.equal(h.nodes.get('#selectionCount').textContent,'已选 0 条');
 h.nodes.get('#selectPageBtn').listeners.click();h.setRows(['next-page']);h.events.get('peer-list-loaded')();assert.equal(h.nodes.get('#selectionCount').textContent,'已选 0 条');
});

test('batch delete confirms exact count, prevents duplicate clicks, retains selection on failure and refreshes after success',async()=>{
 const h=harness('psychology-peer-production.js');h.setRows(['a','b']);h.events.get('peer-list-loaded')();h.nodes.get('#selectPageBtn').listeners.click();
 h.accept(false);await h.nodes.get('#deleteSelectedBtn').listeners.click();assert.equal(h.requests.length,0);assert.match(h.confirmations[0],/2 条文案、同行来源及关联改写/);
 h.accept(true);let reject;h.respond(()=>new Promise((_,r)=>reject=r));const pending=h.nodes.get('#deleteSelectedBtn').listeners.click();await h.nodes.get('#deleteSelectedBtn').listeners.click();assert.equal(h.requests.length,1);assert.equal(h.nodes.get('#selectPageBtn').disabled,true);
 reject(new Error('offline'));await pending;assert.equal(h.nodes.get('#selectionCount').textContent,'已选 2 条');assert.equal(h.nodes.get('#deleteSelectedBtn').disabled,false);
 let refreshed=false;h.events.set('peer-list-refresh-request',()=>{refreshed=true;});h.respond(()=>({deleted:2}));await h.nodes.get('#deleteSelectedBtn').listeners.click();
 const req=h.requests.at(-1);assert.equal(req.method,'DELETE');assert.equal(req.url,'/api/psychology-copy-library');assert.deepEqual(req.body.ids,['a','b']);assert.equal(refreshed,true);assert.equal(h.nodes.get('#selectionCount').textContent,'已选 0 条');
 h.document.body.dataset.sourceAccess='false';h.nodes.get('#selectPageBtn').listeners.click();assert.equal(h.nodes.get('#selectionCount').textContent,'已选 0 条');
});


test('batch AI rewrite posts one request per selected source with the chosen model and count',async()=>{
 assert.match(html,/id="batchModel"[\s\S]*claude-sonnet-5[\s\S]*id="batchCount"[\s\S]*id="batchRewriteBtn"/);
 assert.match(html,/id="variantModel"[\s\S]*value="claude-sonnet-5" selected/);
 const h=harness('psychology-peer-production.js');h.setRows(['a','b','c']);h.events.get('peer-list-loaded')();
 assert.equal(h.nodes.get('#batchRewriteBtn').disabled,true);
 h.nodes.get('#selectPageBtn').listeners.click();assert.equal(h.nodes.get('#batchRewriteBtn').disabled,false);
 h.nodes.get('#batchModel').value='claude-haiku-4.5';h.nodes.get('#batchCount').value='3';
 h.accept(false);await h.nodes.get('#batchRewriteBtn').listeners.click();assert.equal(h.requests.length,0);
 h.accept(true);h.respond(url=>url.includes('sourceId=b')?Promise.reject(new Error('原文尚无可用于改写的正文')):({created:3,skipped:['x']}));
 let refreshed=false;h.events.set('peer-list-refresh-request',()=>{refreshed=true;});
 await h.nodes.get('#batchRewriteBtn').listeners.click();
 assert.deepEqual(h.requests.map(r=>r.url).sort(),['a','b','c'].map(id=>'/api/psychology-creative/copies/generate-batch?sourceId='+id+'&model=claude-haiku-4.5&count=3'));
 assert.ok(h.requests.every(r=>r.method==='POST'));
 assert.match(h.nodes.get('#productionStatus').textContent,/保存 6 个改写版本，2 个未通过质检.*1 篇失败/);
 assert.equal(h.nodes.get('#selectionCount').textContent,'已选 1 条');assert.equal(refreshed,true);
});

test('original recreation is removed from the copy library',()=>{
 assert.doesNotMatch(html,/rewriteCopy|produceBtn|原帖复刻/);
 assert.doesNotMatch(read('psychology-peer-production.js'),/produceBtn|原帖复刻/);
});


test('AI generation fills current source draft once, blocks switching/saving and requires fresh review',async()=>{
 const h=harness();h.events.get('peer-list-loaded')({detail:{items:sources}});await h.click({createVariant:'photo-source'});h.nodes.get('#variantModel').value='claude-sonnet-5';
 let resolve;h.respond(()=>new Promise(r=>resolve=r));const pending=h.nodes.get('#generateVariant').onclick();
 assert.equal(h.nodes.get('#variantFields').disabled,true);assert.equal(h.nodes.get('#closeVariant').disabled,true);
 await h.nodes.get('#generateVariant').onclick();await h.click({createVariant:'video-source'});h.nodes.get('#variantReviewed').checked=true;await h.submit();assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].url,'/api/psychology-creative/copies/generate?sourceId=photo-source&model=claude-sonnet-5');
 resolve({model:'claude-sonnet-5',draft:{name:'AI draft',title:'Generated title',caption:'Generated caption',pages:['Cover','Body']}});await pending;
 assert.equal(h.nodes.get('#variantTitle').value,'Generated title');assert.deepEqual(h.pages.map(p=>p.value),['Cover','Body','','','','']);assert.equal(h.nodes.get('#variantReviewed').checked,false);assert.equal(h.nodes.get('#variantFields').disabled,false);
 assert.equal(h.requests.length,1);await h.submit();assert.equal(h.requests.length,1);
 h.nodes.get('#variantReviewed').checked=true;h.respond(()=>({created:1}));await h.submit();assert.equal(h.requests[1].url,'/api/psychology-creative/copies?sourceId=photo-source');assert.equal(h.requests[1].body[0].rewriteModel,'claude-sonnet-5');
});

test('AI overwrite cancellation or failure preserves draft and allows retry',async()=>{
 const h=harness();h.events.get('peer-list-loaded')({detail:{items:sources}});await h.click({createVariant:'video-source'});h.fill();
 h.accept(false);await h.nodes.get('#generateVariant').onclick();assert.equal(h.requests.length,0);assert.equal(h.nodes.get('#variantTitle').value,'Test title');
 h.accept(true);h.respond(()=>{throw new Error('Try again');});await h.nodes.get('#generateVariant').onclick();assert.equal(h.nodes.get('#variantTitle').value,'Test title');assert.equal(h.pages[0].value,'First page');assert.equal(h.nodes.get('#generateVariant').disabled,false);assert.equal(h.nodes.get('#variantFields').disabled,false);
 h.respond(()=>({draft:{name:'New draft',title:'New title',caption:'Caption',pages:['New page']}}));await h.nodes.get('#generateVariant').onclick();assert.equal(h.nodes.get('#variantTitle').value,'New title');assert.equal(h.nodes.get('#variantReviewed').checked,false);
});


test('independent pending-account dialog supports bulk inputs without scheduling collection',async()=>{
 const h=harness('psychology-peer-extras.js');assert.equal(h.requests.length,0);
 h.events.get('library-source-access')({detail:{canManage:false}});assert.equal(h.nodes.get('#watchAccountsButton').hidden,true);
 h.events.get('library-source-access')({detail:{canManage:true}});assert.equal(h.nodes.get('#watchAccountsButton').hidden,false);
 h.respond((url,options)=>options.method==='POST'?{created:2,skipped:0}:{accounts:[{username:'peer',note:'<script>',status:'pending'}]});
 await h.nodes.get('#watchAccountsButton').onclick();assert.equal(h.nodes.get('#watchAccountsDialog').open,true);assert.match(h.nodes.get('#watchList').innerHTML,/待抓取/);assert.doesNotMatch(h.nodes.get('#watchList').innerHTML,/<script>/);
 h.nodes.get('#watchUsernames').value='@peer.one\nhttps://www.tiktok.com/@peer.two';
 await h.nodes.get('#watchForm').onsubmit({preventDefault(){}});
 const request=h.requests.find(r=>r.method==='POST');assert.deepEqual(request.body.usernames,['@peer.one','https://www.tiktok.com/@peer.two']);assert.equal(request.body.enabled,undefined);
 assert.ok(h.requests.every(r=>r.url==='/api/psychology-peer-hits/watch-accounts'));
 assert.match(h.nodes.get('#watchStatus').textContent,/新增 2 个待抓取/);
});

test('hot-comment action renders escaped originals and descending likes without external calls',async()=>{
 const h=harness('psychology-peer-extras.js');
 h.events.get('peer-list-loaded')({detail:{items:[{id:'a',title:'Source',peer:{commentCount:20,topComments:[{text:'lower',likes:10},{text:'<img src=x>',likes:200},{text:'zero',likes:0}],topCommentsNote:'Only two visible'}}]}});
 await h.click({hotComments:'a'});assert.equal(h.nodes.get('#hotCommentsDialog').open,true);
 const markup=h.nodes.get('#hotCommentsList').innerHTML;assert.ok(markup.indexOf('&lt;img')<markup.indexOf('lower'));assert.doesNotMatch(markup,/<img|zero/);assert.match(markup,/200/);assert.match(h.nodes.get('#hotCommentsStatus').textContent,/Only two visible/);assert.equal(h.requests.length,0);
});


test('quality review shows literal raw output and reason, and approval sends only edited content',async()=>{
 const h=harness();const row={id:'a'.repeat(64),title:'Review title',caption:'Caption',pages:['First page'],review_reason:'Copied original',raw_response:'<script>raw model text</script>',rewriteModelLabel:'Sonnet 5'};
 h.context.openQualityReview(row);assert.equal(h.nodes.get('#qualityReviewDialog').open,true);assert.equal(h.nodes.get('#qualityReviewRaw').textContent,row.raw_response);assert.match(h.nodes.get('#qualityReviewReason').textContent,/Copied original/);
 h.nodes.get('#qualityReviewPages').value='invalid';await h.nodes.get('#qualityReviewForm').onsubmit({preventDefault(){}});assert.equal(h.requests.length,0);
 h.nodes.get('#qualityReviewPages').value=JSON.stringify(['Edited page']);h.respond(()=>({ok:true,items:[],page:1,total:0}));
 await h.nodes.get('#qualityReviewForm').onsubmit({preventDefault(){}});
 const approved=h.requests.find(r=>r.url.endsWith('/approve'));assert.deepEqual(approved.body,{title:'Review title',caption:'Caption',pages:['Edited page']});assert.equal(h.nodes.get('#qualityReviewDialog').open,false);
});
