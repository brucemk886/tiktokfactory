import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { createWebsiteLinks,readWebsiteLinks,handleWebsiteShortLink } from './psychology-website-links.js';
const now=Date.parse('2026-10-06T12:00:00Z');
const context={projectId:'proj-psych',accounts:[{connectionId:'a',username:'alpha',candidate:true,canPublish:true},{connectionId:'b',candidate:false,canPublish:true},{connectionId:'outside',candidate:true,canPublish:false}]};
const window={from:'2026-10-06',to:'2026-10-06'};
test('stable short links are idempotent under concurrent creation and account scoped',async t=>{
 const f=await fixture(t);
 await Promise.all([createWebsiteLinks(f.db,context,now),createWebsiteLinks(f.db,context,now)]);
 const links=await readWebsiteLinks(f.db,context,window);
 assert.equal(links.length,1);assert.equal(links[0].connectionId,'a');assert.match(links[0].trackingUrl,/^https:\/\/deeppersonaai.com\/go\/[a-f0-9]{10}$/);
 await createWebsiteLinks(f.db,context,now+1);assert.deepEqual(await readWebsiteLinks(f.db,context,window),links);
 assert.equal((await readWebsiteLinks(f.db,{...context,projectId:'other'},window)).length,0);
 assert.equal((await readWebsiteLinks(f.db,{...context,accounts:[]},window)).length,0);
 assert.equal(f.requests.length,0);
});
test('redirect preserves exact account attribution, ignores injected destinations and counts bounded daily requests',async t=>{
 const f=await fixture(t);await createWebsiteLinks(f.db,context,now);
 const [{code}]=await readWebsiteLinks(f.db,context,window);
 const url=new URL('https://factory.test/go/'+code+'?next=https://evil.test&connectionId=outside&utm_campaign=evil');
 for(const extra of [{},{},{'user-agent':'Googlebot'},{purpose:'prefetch'},{'sec-purpose':'prefetch;prerender'}]){
  const request=new Request(url,{headers:{'user-agent':'Mozilla/5.0',...extra}});
  const response=await handleWebsiteShortLink(request,f.env,url,null,{now});
  assert.equal(response.status,302);const target=new URL(response.headers.get('location'));
  assert.equal(target.origin,'https://deeppersonaai.com');assert.equal(target.pathname,'/');assert.equal(target.searchParams.get('utm_campaign'),'factory-a');
  assert.equal(target.searchParams.get('utm_source'),'tiktok');assert.equal(target.searchParams.get('next'),null);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const [{visits,requests,filtered}]=await readWebsiteLinks(f.db,context,window);
 assert.deepEqual({visits,requests,filtered},{visits:2,requests:5,filtered:3});
 await handleWebsiteShortLink(new Request(url,{method:'HEAD'}),f.env,url,null,{now});
 assert.equal((await readWebsiteLinks(f.db,context,window))[0].requests,5);
 // Beijing midnight is a separate day.
 await handleWebsiteShortLink(new Request(url,{headers:{'user-agent':'Mozilla/5.0'}}),f.env,url,null,{now:Date.parse('2026-10-06T16:00:00Z')});
 assert.equal((await readWebsiteLinks(f.db,context,window))[0].requests,5);
 assert.equal((await readWebsiteLinks(f.db,context,{from:'2026-10-07',to:'2026-10-07'}))[0].visits,1);
});
test('invalid and unknown codes never redirect; unsupported methods do not count',async t=>{
 const f=await fixture(t);
 for(const [path,method,status] of [['/go/not-valid','GET',404],['/go/0000000000','GET',404],['/go/0000000000','POST',405]]){
  const url=new URL('https://factory.test'+path),response=await handleWebsiteShortLink(new Request(url,{method}),f.env,url);
  assert.equal(response.status,status);assert.equal(response.headers.get('location'),null);
 }
 assert.equal(await handleWebsiteShortLink(new Request('https://factory.test/'),f.env,new URL('https://factory.test/')),null);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_website_link_days').get().n,0);
});
test('counter failures cannot block the destination, and read failures are not zero',async t=>{
 const f=await fixture(t);await createWebsiteLinks(f.db,context,now);
 const [{code}]=await readWebsiteLinks(f.db,context,window),url=new URL('https://factory.test/go/'+code);
 const db={prepare(sql){if(sql.startsWith('INSERT INTO psychology_website_link_days'))return{bind(){return{run:async()=>{throw new Error('offline');}};}};return f.db.prepare(sql);}};
 assert.equal((await handleWebsiteShortLink(new Request(url),{DB:db},url,null,{now})).status,302);
 await assert.rejects(()=>readWebsiteLinks({prepare(){return{bind(){return{all:async()=>({success:false})};}};}},context,window),/unavailable/);
});
