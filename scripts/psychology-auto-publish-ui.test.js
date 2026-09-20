import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../public/psychology-auto-publish.js',import.meta.url),'utf8');
function harness(accountsPromise, failed=false) {
  const nodes=new Map();
  function node(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:selector==='#sourceType'?'peer':selector==='#count'?'3':'',innerHTML:'',textContent:'',listeners:{},querySelectorAll:()=>[],classList:{toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;}});
    return nodes.get(selector);
  }
  let accounts=accountsPromise;
  const batch={createdAt:Date.now(),config:{name:'Existing photo batch',mediaType:'photo',template:'photo',count:3},items:['internal-a','internal-b','internal-c'].map(connectionId=>({id:connectionId,connectionId,status:failed&&connectionId==='internal-c'?'failed':'submitted',scheduleAt:1}))};
  const requests=[];let confirmed=true;
  const context=vm.createContext({confirm:()=>confirmed,document:{querySelector:node,querySelectorAll:()=>[]},crypto:{randomUUID:()=> 'request-id'},setInterval(){},fetch:async(path,init)=>{requests.push({path,method:init?.method,body:init?.body?JSON.parse(init.body):undefined});if(init?.method==='DELETE')batch.items=batch.items.filter(i=>!path.endsWith('/'+i.id));return {ok:true,json:async()=>path.includes('/options')?{templates:{photo:[],video:[]},counts:{},canUseTopics:false}:path.includes('publish-accounts')?{accounts:await accounts}:{batches:[batch]}};}});
  const ready=vm.runInContext('(async()=>{'+source+'})()',context);
  return {node,ready,requests,setConfirmed(value){confirmed=value;},setAccounts(value){accounts=Promise.resolve(value);},refresh:()=>node('#refreshAccounts').listeners.click()};
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
