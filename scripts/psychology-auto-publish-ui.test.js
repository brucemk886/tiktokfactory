import {publishTimeZone,formatPublishTime,localPublishInput,publishScheduleError,parsePublishInput} from '../public/psychology-publish-time.js';
import { VISUAL_STYLES } from '../public/psychology-visual-styles.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const receiverSource=fs.readFileSync(new URL('../public/psychology-photo-receivers.js',import.meta.url),'utf8').replace('export function','function');
const source=fs.readFileSync(new URL('../public/psychology-auto-publish.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function harness(accountsPromise, failed=false, options={}, batchesPromise=null, optionsPromise=null,autoOpen=true) {
  const nodes=new Map();
  function node(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:selector==='#sourceType'?'topic-bank':selector==='#template'?'psychology':selector==='#count'?'3':'',innerHTML:'',textContent:'',listeners:{},querySelectorAll:()=>[],closest(){return this;},classList:{toggle(){}},setAttribute(name,value){this[name]=value;},focus(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(type,fn){this.listeners[type]=fn;}});
    return nodes.get(selector);
  }
  const mediaButtons=['video','photo'].map(media=>({dataset:{media},classList:{toggle(){}},setAttribute(){},addEventListener(type,fn){this[type]=fn;}}));
  let accounts=accountsPromise;
  const batch={id:'batch-1',createdAt:Date.now(),config:{name:'Existing photo batch',mediaType:'photo',template:'photo',count:3},items:['internal-a','internal-b','internal-c'].map(connectionId=>({id:connectionId,connectionId,status:failed&&connectionId==='internal-c'?'failed':'submitted',scheduleAt:1}))};
  const requests=[];let confirmed=true;
  const context=vm.createContext({publishTimeZone,formatPublishTime,localPublishInput,publishScheduleError,parsePublishInput,URLSearchParams,mountPhotoMusic:()=>({ids:()=>options.selectedMusic||[]}),location:{search:'',assign(){}},mountHitPhotoPicker:()=>({sync(){},refs:()=>[],clear(){},busy:false}),mountPsychologyVideoPicker:()=>({active:false,count:0,open(){this.active=true;},close(){this.active=false;},update(){},clear(){}}),mountPsychologyOne:()=>({sync(){},context(){return null;},selectionChanged(){},markJoined(){}}),VISUAL_STYLES,confirm:()=>confirmed,document:{getElementById:id=>node('#'+id),body:{classList:{add(){}}},querySelector:node,querySelectorAll:selector=>selector==='[data-media]'?mediaButtons:[]},crypto:{randomUUID:()=> 'request-id'},setInterval(){},fetch:async(path,init)=>{requests.push({path,method:init?.method,body:init?.body?JSON.parse(init.body):undefined});if(init?.method==='DELETE')batch.items=batch.items.filter(i=>!path.endsWith('/'+i.id));return {ok:true,json:async()=>path.endsWith('/photo-receivers')?{revision:1,receivers:options.receivers||[{connectionId:'receiver-1',username:'target_one'}],mention:'Take the test at {account}.'}:path.includes('/options')?{templates:{photo:[],video:[]},counts:{},canUseTopics:true,...(optionsPromise?await optionsPromise:options)}:path.includes('publish-accounts')?{accounts:await accounts}:batchesPromise?await batchesPromise:{batches:[batch]}};}});
  const listReady=vm.runInContext('(async()=>{'+receiverSource+'\n'+source.replace("const creationMode=new URLSearchParams","globalThis.openNormalPage=openNormalPage;globalThis.openOnePage=openOnePage;const creationMode=new URLSearchParams")+'})()',context);
  node('#newBatch').listeners.click=()=>context.openNormalPage();node('#newOneBatch').listeners.click=()=>context.openOnePage();
  const ready=autoOpen?Promise.all([listReady,node('#newBatch').listeners.click()]):listReady;
  return {node,ready,listReady,requests,mediaButtons,setConfirmed(value){confirmed=value;},setAccounts(value){accounts=Promise.resolve(value);},refresh:()=>node('#refreshAccounts').listeners.click()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a fast batch response is rerendered with @handles when slow account data arrives',async()=>{
  let resolveAccounts;
  const h=harness(new Promise(resolve=>{resolveAccounts=resolve;}));
  await tick();
  assert.match(h.node('#batches').innerHTML,/账号加载中/);
  assert.match(h.node('#accounts').innerHTML,/正在读取/);assert.doesNotMatch(h.node('#accounts').innerHTML,/还没有可发布账号/);
  assert.doesNotMatch(h.node('#batches').innerHTML,/internal-[abc]/);
  resolveAccounts([{connectionId:'internal-a',username:'first',displayName:'Nickname'}, {id:'internal-b',username:'@second'}, {connectionId:'internal-c',username:'third'}]);
  await h.ready;
  const html=h.node('#batches').innerHTML;
  for(const handle of ['@first','@second','@third'])assert.ok(html.includes(handle));
  assert.doesNotMatch(html,/Nickname|@@second|internal-[abc]|账号加载中/);
  assert.equal((html.match(/<tr data-batch-row=/g)||[]).length,1);
});

test('account refresh immediately updates existing photo batch labels',async()=>{
  const h=harness(Promise.resolve([{id:'internal-a',username:'old'}]));await h.ready;
  h.setAccounts([{id:'internal-a',username:'new'}]);await h.refresh();
  assert.match(h.node('#batches').innerHTML,/@new/);
  assert.doesNotMatch(h.node('#batches').innerHTML,/@old/);
});

test('missing account data uses a readable fallback and account text is escaped',async()=>{
  const h=harness(Promise.resolve([{id:'internal-a',displayName:'Known nickname'}, {id:'internal-b',username:'<unsafe>'}]));await h.ready;
  const html=h.node('#batches').innerHTML;
  assert.match(html,/Known nickname/);
  assert.match(html,/@&lt;unsafe&gt;/);
  assert.match(html,/账号信息不可用/);
  assert.doesNotMatch(html,/internal-[abc]|<unsafe>/);
});


test('failed rows offer deletion; confirmation sends DELETE and refreshes without touching siblings',async()=>{
  const h=harness(Promise.resolve([]),true);await h.ready;
  await h.node('#batches').listeners.click({target:{closest:selector=>selector==='[data-batch-open]'?{dataset:{batchOpen:'batch-1'}}:null}});
  assert.equal(h.node('#batchDetail').open,true);
  assert.match(h.node('#batchDetailBody').innerHTML,/data-delete="internal-c"/);
  assert.doesNotMatch(h.node('#batchDetailBody').innerHTML,/data-delete="internal-[ab]"/);
  const button={dataset:{delete:'internal-c'},disabled:false};
  const event={target:{closest:selector=>selector==='[data-delete]'?button:null}};
  h.setConfirmed(false);await h.node('#batchDetailBody').listeners.click(event);
  assert.equal(h.requests.filter(r=>r.method==='DELETE').length,0);
  h.setConfirmed(true);await h.node('#batchDetailBody').listeners.click(event);
  assert.equal(h.requests.filter(r=>r.method==='DELETE').length,1);
  assert.doesNotMatch(h.node('#batchDetailBody').innerHTML,/data-delete|待人工处理/);
  assert.match(h.node('#batchDetailBody').innerHTML,/已提交中台 2/);
});

const grouped=[
 {id:'a',username:'alpha',groupId:'g1',groupName:'第一组'},
 {id:'b',username:'bravo',groupId:'g1',groupName:'第一组'},
 {id:'c',username:'charlie',groupId:'g2',groupName:'第二组'},
 {id:'d',username:'delta',groupId:'g3',groupName:'第二组'},
];
function filterGroup(h,id){h.node('#accountGroup').value=id;h.node('#accountGroup').listeners.change();}
function searchAccount(h,value){h.node('#accountSearch').value=value;h.node('#accountSearch').listeners.input();}

test('group IDs isolate identically named groups; searches and empty states retain hidden selections',async()=>{
 const h=harness(Promise.resolve(grouped));await h.ready;
 assert.match(h.node('#accountGroup').innerHTML,/第一组（2）/);
 filterGroup(h,'g1');assert.match(h.node('#accounts').innerHTML,/@alpha/);assert.doesNotMatch(h.node('#accounts').innerHTML,/@charlie/);
 h.node('#selectVisibleAccounts').listeners.click();
 filterGroup(h,'g2');assert.match(h.node('#accounts').innerHTML,/@charlie/);assert.doesNotMatch(h.node('#accounts').innerHTML,/@delta/);
 assert.match(h.node('#accountSelectionStatus').textContent,/已选 2 个（其中 2 个/);
 searchAccount(h,'missing');assert.match(h.node('#accounts').innerHTML,/没有可发布账号/);assert.equal(h.node('#selectVisibleAccounts').disabled,true);
 filterGroup(h,'');searchAccount(h,'@CHARLIE');assert.match(h.node('#accounts').innerHTML,/@charlie/);assert.doesNotMatch(h.node('#accounts').innerHTML,/@alpha/);
 h.node('#selectVisibleAccounts').listeners.click();assert.match(h.node('#accountSelectionStatus').textContent,/已选 3 个/);
 h.node('#clearVisibleAccounts').listeners.click();assert.match(h.node('#accountSelectionStatus').textContent,/已选 2 个/);
 h.node('#clearAllAccounts').listeners.click();assert.match(h.node('#accountSelectionStatus').textContent,/已选 0 个/);
});

test('submission includes selected accounts from hidden groups exactly once',async()=>{
 const h=harness(Promise.resolve(grouped));await h.ready;
 filterGroup(h,'g1');h.node('#selectVisibleAccounts').listeners.click();h.node('#selectVisibleAccounts').listeners.click();
 filterGroup(h,'g2');h.node('#accounts').listeners.input({target:{type:'checkbox',value:'c',checked:true}});
 await h.node('#batchForm').listeners.submit({preventDefault(){}});
 const post=h.requests.find(r=>r.path==='/api/psychology-auto-publish'&&r.method==='POST');
 assert.deepEqual(post.body.connectionIds,['a','b','c']);assert.equal(post.body.count,3);
});

test('refresh removes revoked accounts while keeping available selections and updates group counts',async()=>{
 const h=harness(Promise.resolve(grouped));await h.ready;filterGroup(h,'g1');h.node('#selectVisibleAccounts').listeners.click();
 h.setAccounts([grouped[0],grouped[2]]);await h.refresh();
 assert.match(h.node('#accountSelectionStatus').textContent,/已选 1 个/);assert.match(h.node('#accountGroup').innerHTML,/第一组（1）/);assert.doesNotMatch(h.node('#accounts').innerHTML,/value="b"/);
 await h.node('#batchForm').listeners.submit({preventDefault(){}});
 assert.deepEqual(h.requests.find(r=>r.path==='/api/psychology-auto-publish'&&r.method==='POST').body.connectionIds,['a']);
});

test('late refresh responses cannot replace the newest account directory',async()=>{
 const h=harness(Promise.resolve(grouped));await h.ready;let release;
 h.setAccounts(new Promise(r=>release=r));const old=h.refresh();await tick();
 h.setAccounts([grouped[2]]);await h.refresh();release(grouped);await old;
 assert.match(h.node('#accounts').innerHTML,/@charlie/);assert.doesNotMatch(h.node('#accounts').innerHTML,/@alpha/);
});

const topicOptions={canUseTopics:true,templates:{video:[{id:'psychology',label:'四图测试'},{id:'psychology-collage',label:'纸张拼贴'},{id:'psychology-target-2',label:'单图互动测试'}],photo:[{id:'photo-original',label:'跟随原帖'}]},topicCounts:{psychology:{total:3,enabled:0,unused:0},'psychology-collage':{total:18,enabled:4,unused:2},'psychology-target-2':{total:28,enabled:11,unused:8,availableImages:24}}};
function chooseSource(h,source){h.node('#sourceType').value=source;h.node('#sourceType').listeners.change();}
function chooseBank(h,bank){h.node('#topicBank').value=bank;h.node('#topicBank').listeners.change();}

test('concrete topic banks display counts, synchronize renderer both ways and submit selected bank',async()=>{
 const h=harness(Promise.resolve(grouped),false,topicOptions);await h.ready;
 h.node('#template').value='psychology';chooseSource(h,'topic-bank');
 assert.equal(h.node('#topicBankField').hidden,false);assert.equal(h.node('#templateField').hidden,true);
 assert.match(h.node('#topicBank').innerHTML,/四图测试题库（已启用 0 \/ 共 3 题）/);
 assert.match(h.node('#topicBank').innerHTML,/纸张拼贴题库（已启用 4 \/ 共 18 题）/);
 filterGroup(h,'g2');h.node('#selectVisibleAccounts').listeners.click();
 for(const template of ['psychology-collage','psychology-target-2','psychology']){
   chooseBank(h,template);
   assert.equal(h.node('#template').value,template);
   assert.equal(h.node('#topicBankLink').href,'/psychology-topic-bank?template='+template);
   await h.node('#batchForm').listeners.submit({preventDefault(){}});
   const post=h.requests.filter(r=>r.path==='/api/psychology-auto-publish'&&r.method==='POST').at(-1);
   assert.equal(post.body.sourceType,'topic-bank');assert.equal(post.body.template,template);
 }
 h.node('#template').value='psychology-target-2';h.node('#template').listeners.change();
 assert.equal(h.node('#topicBank').value,'psychology-target-2');
 assert.match(h.node('#sourceHint').textContent,/可用图片 24 张/);
 assert.equal(h.node('#unusedField').hidden,true);
});

test('video always uses topics; photo remains separate and missing permission cannot submit',async()=>{
 const h=harness(Promise.resolve([]),false,topicOptions);await h.ready;
 h.node('#template').value='psychology';chooseSource(h,'topic-bank');
 chooseSource(h,'peer');assert.equal(h.node('#sourceType').value,'topic-bank');assert.equal(h.node('#topicBankField').hidden,false);assert.equal(h.node('#templateField').hidden,true);
 chooseSource(h,'topic-bank');await h.mediaButtons[1].click();
 assert.equal(h.node('#topicBankField').hidden,true);assert.equal(h.node('#templateField').hidden,false);assert.equal(h.node('#unusedField').hidden,true);
 await h.mediaButtons[0].click();assert.equal(h.node('#topicBankField').hidden,false);assert.equal(h.node('#templateField').hidden,true);
 const denied=harness(Promise.resolve(grouped),false,{canUseTopics:false});await denied.ready;
 assert.equal(denied.node('#sourceType').value,'topic-bank');assert.match(denied.node('#sourceHint').textContent,/没有模板题库权限/);
 denied.node('#selectVisibleAccounts').listeners.click();await denied.node('#batchForm').listeners.submit({preventDefault(){}});
 assert.match(denied.node('#message').textContent,/没有模板题库权限/);assert.equal(denied.requests.filter(r=>r.method==='POST').length,0);
});

test('mismatched bank and renderer cannot submit an unintended topic bank',async()=>{
 const h=harness(Promise.resolve(grouped),false,topicOptions);await h.ready;
 h.node('#template').value='psychology';chooseSource(h,'topic-bank');
 filterGroup(h,'g2');h.node('#selectVisibleAccounts').listeners.click();
 h.node('#topicBank').value='psychology-collage';
 await h.node('#batchForm').listeners.submit({preventDefault(){}});
 assert.match(h.node('#message').textContent,/对应的具体题库/);
 assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});


test('photo UI defaults to random per post and creative page no longer assigns account styles',()=>{
 const publish=fs.readFileSync(new URL('../public/psychology-auto-publish.html',import.meta.url),'utf8');
 assert.match(publish,/<select id="styleMode"><option value="random" selected>/);
 assert.doesNotMatch(publish,/<option value="group">|设置分组/);
 const creative=fs.readFileSync(new URL('../public/psychology-creative.html',import.meta.url),'utf8');
 assert.match(creative,/随机样式测试/);assert.doesNotMatch(creative,/id="bindingForm"|当前账号主样式/);
 assert.match(creative,/psychology-ops-report\?tab=content/);
});

for(const media of ['photo'])for(const source of ['copy-library','copy-bank'])test(media+' submits library source and preserves copy reuse controls after submission: '+source,async()=>{
 const h=harness(Promise.resolve(grouped),false,{libraryCounts:{photo:8,video:3}});await h.ready;
 if(media==='photo')await h.mediaButtons[1].click();
 h.node('#rewriteCopy').checked=true;
 if(media==='photo'){h.node('#photoSource').value=source;h.node('#photoSource').onchange();}else chooseSource(h,source);
 h.node('#libraryMediaType').value='video';
 assert.equal(h.node('#libraryMediaField').hidden,source!=='copy-library');
 assert.equal(h.node('#rewriteCopy').checked,false);assert.equal(h.node('#rewriteCopy').disabled,true);
 assert.doesNotMatch(h.node('#selection').innerHTML,/popular/);
 h.node('#selectVisibleAccounts').listeners.click();h.node('#count').value='4';
 await h.node('#batchForm').listeners.submit({preventDefault(){}});
 const body=h.requests.find(r=>r.method==='POST'&&r.path==='/api/psychology-auto-publish').body;
 assert.equal(body.mediaType,media);assert.equal(body.sourceType,source);assert.equal(body.rewriteCopy,false);
 assert.equal(body.libraryMediaType,source==='copy-library'?'video':undefined);
 assert.equal(h.node('#rewriteCopy').disabled,true);
});

 test('list filters never enqueue, detail tabs expose records and creation retains its draft',async()=>{
 const h=harness(Promise.resolve(grouped),true);await h.ready;
 h.node('#batchSearch').value='missing';h.node('#batchSearch').listeners.input();assert.match(h.node('#batches').innerHTML,/本页没有匹配/);
 h.node('#batchSearch').value='';h.node('#batchMedia').value='video';h.node('#batchMedia').listeners.change();assert.match(h.node('#batches').innerHTML,/本页没有匹配/);
 h.node('#batchMedia').value='all';h.node('#batchMedia').listeners.change();
 await h.node('#batches').listeners.click({target:{closest:()=>({dataset:{batchOpen:'batch-1'}})}});
 assert.equal(h.node('#batchDetail').open,true);assert.match(h.node('#batchDetailItems').innerHTML,/失败/);
 h.node('#detailItemsTab').listeners.click();assert.equal(h.node('#batchDetailBody').hidden,true);assert.equal(h.node('#detailItemsTab')['aria-selected'],'true');
 h.node('#closeBatchDetail').listeners.click();assert.equal(h.node('#batchDetail').open,false);
 h.node('#newBatch').listeners.click();h.node('#batchName').value='saved draft';h.node('#closeCreateBatch').listeners.click();h.node('#newBatch').listeners.click();assert.equal(h.node('#batchName').value,'saved draft');
 assert.equal(h.requests.filter(r=>r.method==='POST'||r.method==='DELETE').length,0);
 });

 test('unchanged polling preserves the rendered list and open detail state',async()=>{
 const h=harness(Promise.resolve(grouped),true);await h.ready;
 await h.node('#batches').listeners.click({target:{closest:()=>({dataset:{batchOpen:'batch-1'}})}});
 let listWrites=0,detailWrites=0;
 for(const [selector,record] of [['#batches',()=>listWrites++],['#batchDetailBody',()=>detailWrites++]]){let value=h.node(selector).innerHTML;Object.defineProperty(h.node(selector),'innerHTML',{get:()=>value,set:next=>{value=next;record();}});}
 await h.node('#refreshBatches').listeners.click();
 assert.equal(listWrites,0);assert.equal(detailWrites,0);assert.equal(h.node('#batchDetail').open,true);
 });


test('batch and item labels distinguish production, publication and missing records',()=>{
 const text=fs.readFileSync(new URL('../public/psychology-auto-publish.js',import.meta.url),'utf8');
 const ctx=vm.createContext({});vm.runInContext(text.slice(text.indexOf('function itemState('),text.indexOf('let batchPage=')),ctx);
 const state=(...statuses)=>ctx.batchStatus(statuses.map(displayStatus=>({displayStatus})));
 assert.equal(state('published','production_failed'),'partial');
 assert.equal(state('published','missing'),'partial');
 assert.equal(state('published','published'),'done');
 assert.equal(state('production_failed','publish_failed'),'failed');
 assert.equal(state('queued'),'queued');assert.equal(state('producing'),'running');
 assert.equal(state('scheduled'),'scheduled');assert.equal(state('publishing'),'running');
 assert.equal(state('missing'),'unknown');assert.equal(state('cancelled'),'cancelled');
 assert.equal(ctx.statusLabel('partial'),'部分成功');
 assert.equal(ctx.publicationSummary([{displayStatus:'published'},{displayStatus:'production_failed'},{displayStatus:'publish_failed'},{}]),'发布成功 1 条 · 制作失败 1 条 · 发布失败 1 条 · 记录缺失 1 条');
});

test('slow initial batch response shows loading instead of an empty queue',async()=>{
  let resolveBatches;
  const h=harness(Promise.resolve([]),false,{},new Promise(resolve=>{resolveBatches=resolve;}));
  await tick();
  assert.match(h.node('#batches').innerHTML,/正在加载发布任务/);
  assert.doesNotMatch(h.node('#batches').innerHTML,/暂无发布任务|队列为空/);
  assert.equal(h.node('#pageTotalCount').textContent,'—');
  assert.equal(h.node('#batchNext').disabled,true);
  resolveBatches({batches:[]});await h.ready;
  assert.match(h.node('#batches').innerHTML,/暂无发布任务/);
  assert.equal(h.node('#pageTotalCount').textContent,0);
});

test('initial request failure is not presented as an empty queue',async()=>{
  let rejectBatches;
  const h=harness(Promise.resolve([]),false,{},new Promise((resolve,reject)=>{rejectBatches=reject;}));
  await tick();rejectBatches(new Error('network unavailable'));await h.ready;
  assert.match(h.node('#batches').innerHTML,/任务加载失败/);
  assert.doesNotMatch(h.node('#batches').innerHTML,/暂无发布任务/);
  assert.equal(h.node('#batches')['aria-busy'],'false');
});


test('task list loads without creation data; opening dialog coalesces pending reads',async()=>{
  let resolveOptions;
  const h=harness(Promise.resolve([]),false,{},null,new Promise(resolve=>{resolveOptions=resolve;}),false);
  await h.ready;
  assert.equal(h.requests.length,1);
  const opening=h.node('#newBatch').listeners.click();h.node('#newBatch').listeners.click();
  await tick();
  assert.match(h.node('#batches').innerHTML,/Existing photo batch/);
  assert.ok(h.requests.some(r=>r.path.includes('/options')));
  assert.equal(h.requests.filter(r=>r.path.includes('/options')).length,1);
  resolveOptions({});await opening;
  const count=h.requests.length;await h.node('#newBatch').listeners.click();assert.equal(h.requests.length,count);
});


test('pagination shows total pages and retains date filter across pages',async()=>{
 const data={batches:[],pagination:{page:1,pageSize:10,total:12,hasMore:true}};
 const h=harness(Promise.resolve([]),false,{},Promise.resolve(data));await h.ready;
 assert.equal(h.node('#batchNext').disabled,false);assert.match(h.node('#batchPage').textContent,/第 1 \/ 2 页.*共 12 个批次/);
 h.node('#batchDateRange').value='7d';h.node('#batchDateRange').listeners.change();await tick();
 assert.match(h.requests.at(-1).path,/page=1.*range=7d/);
 data.pagination.hasMore=false;h.node('#batchNext').listeners.click();await tick();
 assert.match(h.requests.at(-1).path,/page=2.*range=7d/);assert.equal(h.node('#batchNext').disabled,true);assert.equal(h.node('#batchPageHint').textContent,'已到最后一页');
 const count=h.requests.length;h.node('#batchNext').listeners.click();assert.equal(h.requests.length,count);
 h.node('#batchDateRange').value='today';h.node('#batchDateRange').listeners.change();await tick();assert.match(h.requests.at(-1).path,/page=1.*range=today/);
});

test('custom batch dates wait for a valid applied range',async()=>{
 const h=harness(Promise.resolve([]));await h.ready;const count=h.requests.length;
 h.node('#batchDateRange').value='custom';h.node('#batchDateRange').listeners.change();assert.equal(h.node('#batchCustomDates').hidden,false);assert.equal(h.requests.length,count);
 h.node('#applyBatchDates').listeners.click();assert.equal(h.requests.length,count);
 h.node('#batchStartDate').value='2026-09-22';h.node('#batchEndDate').value='2026-09-21';h.node('#applyBatchDates').listeners.click();assert.equal(h.requests.length,count);
 h.node('#batchEndDate').value='2026-09-22';h.node('#applyBatchDates').listeners.click();await tick();
 assert.match(h.requests.at(-1).path,/range=custom&startDate=2026-09-22&endDate=2026-09-22/);assert.equal(h.node('#queueMessage').textContent,'');
});


test('new video form exposes only template topics and ignores stale source values',async()=>{
 const html=fs.readFileSync(new URL('../public/psychology-auto-publish.html',import.meta.url),'utf8');
 const options=html.match(/<select id="sourceType">([\s\S]*?)<\/select>/)[1];
 assert.equal((options.match(/<option /g)||[]).length,2);assert.match(options,/value="topic-bank"/);
 const h=harness(Promise.resolve(grouped),false,topicOptions);await h.ready;
 assert.equal(h.node('#topicBankField').hidden,false);assert.equal(h.node('#libraryMediaField').hidden,true);
 filterGroup(h,'g2');h.node('#selectVisibleAccounts').listeners.click();
 h.node('#sourceType').value='copy-library';
 await h.node('#batchForm').listeners.submit({preventDefault(){}});
 const post=h.requests.find(r=>r.path==='/api/psychology-auto-publish'&&r.method==='POST');
 assert.equal(post.body.sourceType,'topic-bank');assert.equal(post.body.template,'psychology');
});

const followerAccounts=[{id:'a',username:'thousand',followers:1000,followersSyncedAt:1234567890000,groupId:'g1'},
 {id:'b',username:'under',followers:999,groupId:'g2'},{id:'c',username:'unknown',followers:null,groupId:'g2'},
 {id:'d',username:'large',followers:2000,groupId:'g2'}];
function filterFollowers(h,value){h.node('#accountFollowers').value=String(value);h.node('#accountFollowers').listeners.change();}
test('thousand filter prunes hidden noneligible selection and sends frozen threshold',async()=>{
 const h=harness(Promise.resolve(followerAccounts),false,topicOptions);await h.ready;
 h.node('#selectVisibleAccounts').listeners.click();filterGroup(h,'g1');filterFollowers(h,1000);
 assert.match(h.node('#accountSelectionStatus').textContent,/已选 2 个/);
 assert.match(h.node('#accounts').innerHTML,/1,000 粉丝/);assert.match(h.node('#accounts').innerHTML,/同步/);
 await h.node('#batchForm').listeners.submit({preventDefault(){}});
 const post=h.requests.find(r=>r.method==='POST');assert.equal(post.body.minFollowers,1000);assert.deepEqual(post.body.connectionIds,['a','d']);
});
test('refresh removes accounts that fall below threshold; zero is distinct from unknown',async()=>{
 const h=harness(Promise.resolve(followerAccounts),false,topicOptions);await h.ready;
 assert.match(h.node('#accounts').innerHTML,/粉丝待同步/);
 filterFollowers(h,1000);h.node('#selectVisibleAccounts').listeners.click();
 h.setAccounts(followerAccounts.map(a=>a.id==='a'?{...a,followers:0}:a));await h.refresh();
 assert.match(h.node('#accountSelectionStatus').textContent,/已选 1 个/);assert.doesNotMatch(h.node('#accounts').innerHTML,/@thousand|@unknown/);
 filterFollowers(h,0);assert.match(h.node('#accounts').innerHTML,/0 粉丝/);
});
test('One shortcut opens video with thousand filtering and never creates a task',async()=>{
 const h=harness(Promise.resolve(followerAccounts),false,topicOptions);await h.ready;
 await h.mediaButtons[1].click();await h.node('#newOneBatch').listeners.click();
 assert.equal(h.node('#createBatchDialog').hidden,false);assert.equal(h.node('#accountFollowers').value,'1000');
 assert.equal(h.node('#oneEnabled').checked,true);assert.equal(h.node('#topicBankField').hidden,false);
 assert.doesNotMatch(h.node('#accounts').innerHTML,/@under|@unknown/);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});

test('normal publication draws saved hit videos without a template and requires explicit confirmation',async()=>{
 const h=harness(Promise.resolve(grouped),false,{...topicOptions,canUseVideoHits:true});await h.ready;
 chooseSource(h,'video-hits');h.node('#hitVideoAi').checked=true;filterGroup(h,'g2');h.node('#selectVisibleAccounts').listeners.click();
 assert.equal(h.node('#templateField').hidden,true);assert.equal(h.node('#hitSourceNote').hidden,false);
 h.setConfirmed(false);await h.node('#batchForm').listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
 h.setConfirmed(true);await h.node('#batchForm').listeners.submit({preventDefault(){}});const post=h.requests.find(r=>r.path==='/api/psychology-auto-publish'&&r.method==='POST');
 assert.equal(post.body.sourceType,'video-hits');assert.equal(post.body.template,'selected-video');assert.equal(post.body.isAiGenerated,true);assert.equal(post.body.tiktokOne,undefined);assert.equal(post.body.allowPeerReuse,false);
});


test('manual photo receiver option loads saved CTA, applies to generated-photo sources and stays out of video requests',async()=>{
 const h=harness(Promise.resolve(grouped));await h.ready;assert.equal(h.node('#photoReceiverSettings').hidden,true);await h.mediaButtons[1].click();assert.equal(h.node('#photoReceiverSettings').hidden,false);
 h.node('#photoSource').value='copy-library';h.node('#photoSource').onchange();h.node('#mentionReceiver').checked=true;h.node('#mentionReceiver').listeners.change();await tick();assert.match(h.node('#photoReceiverStatus').textContent,/@target_one/);assert.match(h.node('#photoReceiverCta').textContent,/@随机承接账号/);
 h.node('#selectVisibleAccounts').listeners.click();h.node('#count').value='4';await h.node('#batchForm').listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').at(-1).body.mentionReceiver,true);
 await h.mediaButtons[0].click();assert.equal(h.node('#photoReceiverSettings').hidden,true);await h.node('#batchForm').listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').at(-1).body.mentionReceiver,undefined);
});
test('task item detail displays the frozen receiver and escapes final caption content',async()=>{
 const batches={batches:[{id:'receiver-batch',createdAt:Date.now(),config:{name:'Receiver task',mediaType:'photo',count:1},items:[{id:'i',connectionId:'a',status:'queued',photoReceiver:{username:'target_one',cta:'Visit @target_one.'},finalCaption:'Original <script>unsafe</script>\nVisit @target_one.'}]}]};
 const h=harness(Promise.resolve(grouped),false,{},Promise.resolve(batches));await h.ready;await h.node('#batches').listeners.click({target:{closest:()=>({dataset:{batchOpen:'receiver-batch'}})}});
 const html=h.node('#batchDetailItems').innerHTML;assert.match(html,/@target_one/);assert.match(html,/最终发布文案/);assert.match(html,/Original &lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
});


test('hit photo picker lists twenty albums on one page',async()=>{
 const source=fs.readFileSync(new URL('../public/psychology-hit-photo-picker.js',import.meta.url),'utf8').replace('export function','function');
 const ids=['hitPhotoStatus','hitPhotoSelectAll','hitPhotoClearPage','hitPhotoPrev','hitPhotoNext','hitPhotoRefresh','hitPhotoSearchButton','hitPhotoPage','hitPhotoCount','hitPhotoCards','hitPhotoQuery','hitPhotoSelection'];
 const nodes=new Map(ids.map(id=>[id,{textContent:'',innerHTML:'',value:'',hidden:id==='hitPhotoSelection',disabled:false}]));
 const items=Array.from({length:20},(_,i)=>({ref:{sourceId:'vh-'+i.toString(16).padStart(32,'0'),version:1,revision:1},name:'Album '+i,frameCount:2,frames:[{index:1,previewUrl:'https://images.example.com/'+i+'.jpg'}],title:'Title '+i,caption:'Caption '+i,eligible:true,reason:''}));
 const context=vm.createContext({document:{getElementById:id=>nodes.get(id)}});
 vm.runInContext(source+'\nglobalThis.mountHitPhotoPicker=mountHitPhotoPicker;',context);
 const picker=context.mountHitPhotoPicker({api:async path=>{assert.match(path,/page=1/);return {items,total:21,page:1,pageSize:20,hasMore:true};},changed(){},isBusy:()=>false});
 picker.sync(true);await tick();
 assert.equal(nodes.get('hitPhotoSelection').hidden,false);
 assert.equal((nodes.get('hitPhotoCards').innerHTML.match(/class="hit-photo-card/g)||[]).length,20);
 assert.equal(nodes.get('hitPhotoPage').textContent,'共 21 条 · 每页 20 条 · 第 1 / 2 页');
 assert.equal(nodes.get('hitPhotoNext').disabled,false);
});

test('manual photo music sends only explicit choices instead of the saved default',async()=>{
 for(const music of [[],['6873874427382073346']]){
  const h=harness(Promise.resolve(grouped),false,{musicPool:['old-pool'],selectedMusic:music});await h.ready;
  await h.mediaButtons.find(b=>b.dataset.media==='photo').click();await tick();
  h.node('#selectVisibleAccounts').listeners.click();h.node('#count').value='4';
  await h.node('#batchForm').listeners.submit({preventDefault(){}});
  const post=h.requests.find(r=>r.path==='/api/psychology-auto-publish'&&r.method==='POST');assert.deepEqual(post.body.musicIds,music);
 }
});
