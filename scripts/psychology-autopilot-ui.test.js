import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/psychology-autopilot.js',import.meta.url),'utf8');
function harness(){
 const nodes=new Map(),events={},requests=[];let poll,failRead=false;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='[name="pauseMode"]:checked'?'planning':'',options:[],innerHTML:'',textContent:'',listeners:{},classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){},addEventListener(k,fn){this.listeners[k]=fn;}});return nodes.get(s);};
 const pilot={id:'pilot-test',groupId:'g',groupName:'<unsafe>',status:'active',accounts:[],today:{planned:2,published:1,failed:1},schedule:[{slotAt:1,status:'created',counts:{planned:2,published:1,failed:1}}],attention:[],logs:[],lastRunAt:1};
 const data={pilots:[pilot],groups:[],strategies:{evolve:'A'},rules:{slots:[],staggerSeconds:45,lowPosts:5,lowViews:200,failStreak:3},fetchedAt:2};
 const document={hidden:false,querySelector:s=>s==='dialog[open]'?[...nodes.values()].find(n=>n.open):node(s),querySelectorAll:()=>[],getElementById:id=>node('#'+id),addEventListener(k,fn){events[k]=fn;}};
 const context=vm.createContext({document,confirm:()=>true,setInterval(fn){poll=fn;},fetch:async(path,init)=>{requests.push({path,...init,body:init.body?JSON.parse(init.body):null});if(failRead&&init.method==='GET')throw Error('offline');return {ok:true,json:async()=>path.includes('/impact')?{stoppable:2,protected:1}:init.method==='PATCH'?{ok:true,stopped:2}:data};}});
 vm.runInContext(source,context);
 return {node,events,requests,document,run:code=>vm.runInContext(code,context),poll:()=>poll(),fail:()=>{failRead=true;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('overview escapes account/group data and preserves visible data on failed refresh',async()=>{
 const h=harness();await tick();assert.match(h.node('#compare').innerHTML,/&lt;unsafe&gt;/);assert.doesNotMatch(h.node('#compare').innerHTML,/<unsafe>/);
 const old=h.node('#overview').innerHTML;h.fail();await h.node('#reload').onclick();assert.equal(h.node('#overview').innerHTML,old);assert.match(h.node('#status').textContent,/保留上次数据.*offline/);
});
test('pause requires impact preview and explicit scope, with polling suspended in modal',async()=>{
 const h=harness();await tick();await h.run("openPause('pilot-test')");assert.match(h.node('#pauseImpact').textContent,/2 条.*1 条/);
 const before=h.requests.length;h.poll();await tick();assert.equal(h.requests.length,before);
 h.node('[name="pauseMode"]:checked').value='pending';await h.node('#confirmPause').onclick();
 assert.deepEqual(h.requests.find(r=>r.method==='PATCH').body,{status:'paused',stopPending:true});
 assert.equal(h.node('#pauseDialog').open,false);
});
test('planning-only pause does not request cancellation, and account pause remains account scoped',async()=>{
 const h=harness();await tick();await h.run("openPause('pilot-test')");await h.node('#confirmPause').onclick();assert.equal(h.requests.find(r=>r.method==='PATCH').body.stopPending,false);
 await h.run("openPause('pilot-test','account/a')");await h.node('#confirmPause').onclick();const last=h.requests.filter(r=>r.method==='PATCH').at(-1);assert.match(last.path,/accounts\/account%2Fa$/);assert.equal(last.body.stopPending,true);
});
