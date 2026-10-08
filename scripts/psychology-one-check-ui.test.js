import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPsychologyOne} from '../public/psychology-tiktok-one.js';
const project='7693454687705595917',other='7584639271164739598';
const turn=()=>new Promise(r=>setImmediate(r));
class Element {
 value='';checked=false;disabled=false;children=[];dataset={};textContent='';classList={toggle(){}};
 replaceChildren(...children){this.children=children;if(children[0]?.value!==undefined)this.value=children[0].value;}
 append(...children){this.children.push(...children);}
 querySelectorAll(){return [];}
}
async function setup(t,read){
 const dom=new Proxy({}, {get:(target,id)=>target[id]??=new Element()});
 const priorDocument=globalThis.document,priorOption=globalThis.Option;
 globalThis.document={getElementById:id=>dom[id],createElement:()=>new Element()};
 globalThis.Option=class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}};
 let media='video';const api=async(path,body,_method,options)=>{
  assert.equal(body,undefined,'checking must never join or publish');
  const params=new URL(path,'https://test.local').searchParams;
  if(params.get('resource')==='connections')return {connections:[{id:'brand',accountIds:['1']}]};
  if(params.get('resource')==='projects')return {campaigns:[{campaign_id:project,anchor_id:'2'},{campaign_id:other,anchor_id:'3'}]};
  return read(params,options.signal);
 };
 dom.oneEnabled.checked=true;
 const one=mountPsychologyOne({api,accounts:()=>['a','b','c','d'].map(id=>({id,username:id})),media:()=>media,changed(){}});
 t.after(()=>{media='photo';one.sync();globalThis.document=priorDocument;globalThis.Option=priorOption;});
 one.sync();await turn();await turn();dom.oneProject.value=project;
 const rows=()=>dom.oneAccounts.children;
 return {dom,one,rows};
}

test('membership checks run at concurrency three, show waiting rows and settle partial failures',async t=>{
 const pending=[];let active=0,max=0;
 const f=await setup(t,(params,signal)=>new Promise((resolve,reject)=>{active++;max=Math.max(max,active);pending.push({id:params.get('creatorConnectionId'),resolve:value=>{active--;resolve(value);},reject:()=>{active--;reject(new Error('check denied'));}});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
 const done=f.dom.oneRecheck.onclick();await turn();
 assert.equal(pending.length,3);assert.equal(max,3);assert.equal(f.rows()[3].dataset.memberState,'waiting');assert.equal(f.dom.oneRecheck.disabled,true);
 pending[1].resolve({joinStatus:'success'});await turn();assert.equal(pending.length,4);assert.equal(max,3);
 pending[0].reject();pending[2].resolve({joinStatus:'unknown'});pending[3].resolve({joinStatus:'unknown'});await done;
 assert.equal(f.dom.oneRecheck.disabled,false);assert.match(f.dom.oneStatus.textContent,/已确认加入 1 \/ 4/);
 assert.equal(f.rows()[0].dataset.memberState,'error');assert.ok(f.rows().every(row=>!['waiting','checking'].includes(row.dataset.memberState)));
});

test('one slow account times out while later accounts finish and recheck stays usable',async t=>{
 const realTimeout=AbortSignal.timeout;t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,30000);return realTimeout(35);});
 const f=await setup(t,(params,signal)=>params.get('creatorConnectionId')==='a'?new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})):Promise.resolve({joinStatus:'unknown'}));
 await f.dom.oneRecheck.onclick();
 assert.match(f.rows()[0].children[0].textContent,/检查超时/);assert.equal(f.dom.oneRecheck.disabled,false);
 assert.ok(f.rows().slice(1).every(row=>row.dataset.memberState==='unknown'));
});

test('switching projects aborts old checks and late replies cannot overwrite new membership',async t=>{
 const signals=[],old=[];
 const f=await setup(t,(params,signal)=>{if(params.get('campaignId')===other)return Promise.resolve({joinStatus:'unknown'});signals.push(signal);return new Promise(resolve=>old.push(resolve));});
 const first=f.dom.oneRecheck.onclick();await turn();
 f.dom.oneProject.value=other;f.one.selectionChanged();
 assert.ok(signals.every(signal=>signal.aborted));
 await f.dom.oneRecheck.onclick();old.forEach(resolve=>resolve({joinStatus:'success'}));await first;
 assert.match(f.dom.oneStatus.textContent,/已确认加入 0 \/ 4/);assert.ok(f.rows().every(row=>row.dataset.memberState==='unknown'));
});
