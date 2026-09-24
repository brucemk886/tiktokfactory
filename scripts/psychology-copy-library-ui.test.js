import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const html=read('psychology-copy-library.html');
function harness(script='psychology-copy-library.js') {
 const nodes=new Map();const events=new Map();const requests=[];
 const pages=Array.from({length:6},()=>({value:''}));
 for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set('#'+id,{value:'',textContent:'',disabled:false,open:false,dataset:{},classList:{toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},reset(){for(const id of ['variantName','variantTitle','variantCaption'])nodes.get('#'+id).value='';nodes.get('#variantReviewed').checked=false;pages.forEach(p=>p.value='');}});
 const document={querySelector:q=>nodes.get(q)||null,querySelectorAll:q=>q==='[data-variant-page]'?pages:[],body:{dataset:{mediaType:'video',sourceAccess:'true'},classList:{contains:c=>c==='copy-library-page'}},addEventListener:(t,fn)=>events.set(t,fn),dispatchEvent:e=>events.get(e.type)?.(e)};
 let respond=()=>({created:1,duplicates:0,page:1,total:0,items:[]});
 const context={document,crypto:{randomUUID},CustomEvent:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},location:{hash:''},URL,URLSearchParams,setTimeout,clearTimeout,fetch:async(url,options={})=>{requests.push({url,...options,body:options.body?JSON.parse(options.body):undefined});const data=await respond(url,options);return {ok:true,json:async()=>data};}};
 vm.runInNewContext(read(script),context);
 return {context,nodes,pages,events,requests,document,respond:fn=>{respond=fn;},async click(data){await nodes.get('#hitRows').listeners.click({target:{closest:()=>({dataset:data})}});},fill(){nodes.get('#variantName').value='Test version';nodes.get('#variantTitle').value='Test title';nodes.get('#variantReviewed').checked=true;pages[0].value='First page';},submit(){return nodes.get('#variantForm').onsubmit({preventDefault(){},submitter:{}});}};
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
