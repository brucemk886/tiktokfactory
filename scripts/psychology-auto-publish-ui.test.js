import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../public/psychology-auto-publish.js',import.meta.url),'utf8');
function harness(accountsPromise) {
  const nodes=new Map();
  function node(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:selector==='#sourceType'?'peer':selector==='#count'?'3':'',innerHTML:'',textContent:'',listeners:{},classList:{toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;}});
    return nodes.get(selector);
  }
  let accounts=accountsPromise;
  const batch={createdAt:Date.now(),config:{name:'Existing photo batch',mediaType:'photo',template:'photo',count:3},items:['internal-a','internal-b','internal-c'].map(connectionId=>({connectionId,status:'submitted',scheduleAt:1}))};
  const context=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[]},crypto:{randomUUID:()=> 'request-id'},setInterval(){},fetch:async(path)=>({ok:true,json:async()=>path.includes('/options')?{templates:{photo:[],video:[]},counts:{},canUseTopics:false}:path.includes('publish-accounts')?{accounts:await accounts}:{batches:[batch]}})});
  const ready=vm.runInContext('(async()=>{'+source+'})()',context);
  return {node,ready,setAccounts(value){accounts=Promise.resolve(value);},refresh:()=>node('#refreshAccounts').listeners.click()};
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
