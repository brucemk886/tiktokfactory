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
 assert.equal(h.requests.length,0);assert.equal(h.nodes.get('#produceBtn').disabled,true);
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


test('select page covers twenty rows, supports indeterminate state and preserves five-item recreation limit',async()=>{
 const h=harness('psychology-peer-production.js');h.setRows(Array.from({length:20},(_,i)=>'id-'+i));h.events.get('peer-list-loaded')();
 h.nodes.get('#selectPageBtn').listeners.click();assert.equal(h.nodes.get('#selectionCount').textContent,'已选 20 条');assert.equal(h.nodes.get('#selectPageCheckbox').checked,true);assert.equal(h.nodes.get('#produceBtn').disabled,true);assert.equal(h.nodes.get('#deleteSelectedBtn').disabled,false);
 await h.nodes.get('#produceBtn').listeners.click();assert.equal(h.requests.length,0);
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


test('original recreation submits no rewrite option in either media tab',async()=>{
 assert.doesNotMatch(html,/rewriteCopy/);
 for(const mediaType of ['photo','video']){
  const h=harness('psychology-peer-production.js');h.document.body.dataset.mediaType=mediaType;
  h.setRows(['source-1']);h.events.get('peer-list-loaded')();h.nodes.get('#selectPageBtn').listeners.click();
  h.respond(()=>({jobIds:['job-1']}));await h.nodes.get('#produceBtn').listeners.click();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.mediaType,mediaType);
  assert.equal(Object.hasOwn(h.requests[0].body,'rewriteCopy'),false);
  assert.match(h.context.location.href,/psychology-publish-sources/);
 }
});
