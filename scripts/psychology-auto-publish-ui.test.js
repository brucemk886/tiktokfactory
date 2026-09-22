import { VISUAL_STYLES } from '../public/psychology-visual-styles.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../public/psychology-auto-publish.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function harness(accountsPromise, failed=false, options={}) {
  const nodes=new Map();
  function node(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:selector==='#sourceType'?'peer':selector==='#count'?'3':'',innerHTML:'',textContent:'',listeners:{},querySelectorAll:()=>[],classList:{toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;}});
    return nodes.get(selector);
  }
  const mediaButtons=['video','photo'].map(media=>({dataset:{media},classList:{toggle(){}},setAttribute(){},addEventListener(type,fn){this[type]=fn;}}));
  let accounts=accountsPromise;
  const batch={createdAt:Date.now(),config:{name:'Existing photo batch',mediaType:'photo',template:'photo',count:3},items:['internal-a','internal-b','internal-c'].map(connectionId=>({id:connectionId,connectionId,status:failed&&connectionId==='internal-c'?'failed':'submitted',scheduleAt:1}))};
  const requests=[];let confirmed=true;
  const context=vm.createContext({VISUAL_STYLES,confirm:()=>confirmed,document:{querySelector:node,querySelectorAll:selector=>selector==='[data-media]'?mediaButtons:[]},crypto:{randomUUID:()=> 'request-id'},setInterval(){},fetch:async(path,init)=>{requests.push({path,method:init?.method,body:init?.body?JSON.parse(init.body):undefined});if(init?.method==='DELETE')batch.items=batch.items.filter(i=>!path.endsWith('/'+i.id));return {ok:true,json:async()=>path.includes('/options')?{templates:{photo:[],video:[]},counts:{},canUseTopics:false,...options}:path.includes('publish-accounts')?{accounts:await accounts}:{batches:[batch]}};}});
  const ready=vm.runInContext('(async()=>{'+source+'})()',context);
  return {node,ready,requests,mediaButtons,setConfirmed(value){confirmed=value;},setAccounts(value){accounts=Promise.resolve(value);},refresh:()=>node('#refreshAccounts').listeners.click()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a fast batch response is rerendered with @handles when slow account data arrives',async()=>{
  let resolveAccounts;
  const h=harness(new Promise(resolve=>{resolveAccounts=resolve;}));
  await tick();
  assert.match(h.node('#batches').innerHTML,/账号加载中/);
  assert.doesNotMatch(h.node('#batches').innerHTML,/internal-[abc]/);
  resolveAccounts([{connectionId:'internal-a',username:'first',displayName:'Nickname'}, {id:'internal-b',username:'@second'}, {connectionId:'internal-c',username:'third'}]);
  await h.ready;
  const html=h.node('#batches').innerHTML;
  for(const handle of ['@first','@second','@third'])assert.ok(html.includes(handle));
  assert.doesNotMatch(html,/Nickname|@@second|internal-[abc]|账号加载中/);
  assert.equal((html.match(/<article /g)||[]).length,1);
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
  assert.match(h.node('#batches').innerHTML,/data-delete="internal-c"/);
  assert.doesNotMatch(h.node('#batches').innerHTML,/data-delete="internal-[ab]"/);
  const button={dataset:{delete:'internal-c'},disabled:false};
  const event={target:{closest:selector=>selector==='[data-delete]'?button:null}};
  h.setConfirmed(false);await h.node('#batches').listeners.click(event);
  assert.equal(h.requests.filter(r=>r.method==='DELETE').length,0);
  h.setConfirmed(true);await h.node('#batches').listeners.click(event);
  assert.equal(h.requests.filter(r=>r.method==='DELETE').length,1);
  assert.doesNotMatch(h.node('#batches').innerHTML,/data-delete|待人工处理/);
  assert.match(h.node('#batches').innerHTML,/已提交中台 2/);
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

const topicOptions={canUseTopics:true,templates:{video:[{id:'psychology',label:'四图测试'},{id:'psychology-collage',label:'纸张拼贴'},{id:'psychology-target-2',label:'单图互动测试'}],photo:[{id:'photo-original',label:'跟随原帖'}]},topicCounts:{psychology:{total:3,enabled:0,unused:0},'psychology-collage':{total:18,enabled:4,unused:2},'psychology-target-2':{total:28,enabled:11,unused:8}}};
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
 assert.match(h.node('#sourceHint').textContent,/已启用 11 条，未使用 8 条/);
});

test('peer source, photo mode and missing topic permission hide the bank selector',async()=>{
 const h=harness(Promise.resolve([]),false,topicOptions);await h.ready;
 h.node('#template').value='psychology';chooseSource(h,'topic-bank');
 chooseSource(h,'peer');assert.equal(h.node('#topicBankField').hidden,true);assert.equal(h.node('#templateField').hidden,false);
 chooseSource(h,'topic-bank');await h.mediaButtons[1].click();
 assert.equal(h.node('#topicBankField').hidden,true);assert.equal(h.node('#templateField').hidden,false);assert.equal(h.node('#unusedField').hidden,true);
 await h.mediaButtons[0].click();assert.equal(h.node('#topicBankField').hidden,false);assert.equal(h.node('#templateField').hidden,true);
 const denied=harness(Promise.resolve([]));await denied.ready;chooseSource(denied,'topic-bank');
 assert.equal(denied.node('#topicBankField').hidden,true);assert.equal(denied.node('#sourceType').value,'peer');
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
 assert.doesNotMatch(publish,/<option value="group">/);
 const creative=fs.readFileSync(new URL('../public/psychology-creative.html',import.meta.url),'utf8');
 assert.match(creative,/随机样式测试/);assert.doesNotMatch(creative,/id="bindingForm"|当前账号主样式/);
 assert.match(creative,/psychology-ops-report\?tab=content/);
});
