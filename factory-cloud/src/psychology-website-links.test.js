import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { createWebsiteLinks,readWebsiteLinks,readWebsiteLinkAccounts,handleWebsiteShortLink } from './psychology-website-links.js';
const now=Date.parse('2026-10-06T12:00:00Z');
const context={projectId:'proj-psych',accounts:[{connectionId:'a',username:'alpha',candidate:true,canPublish:true},{connectionId:'b',candidate:false,canPublish:true},{connectionId:'outside',candidate:false,canPublish:false}]};
const window={from:'2026-10-06',to:'2026-10-06'};
test('stable short links are idempotent under concurrent creation and account scoped',async t=>{
 const f=await fixture(t);
 await Promise.all([createWebsiteLinks(f.db,context,now),createWebsiteLinks(f.db,context,now)]);
 const links=await readWebsiteLinks(f.db,context,window);
 assert.equal(links.length,1);assert.equal(links[0].connectionId,'a');assert.match(links[0].trackingUrl,/^https:\/\/deeppersonaai.com\/[1-9][a-z0-9]{4}$/);
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


test('every scoped thousand-follower account can have a link independently of receiver selection or publish scope',async t=>{
 const f=await fixture(t),ctx={projectId:'proj-psych',accounts:[{connectionId:'a',username:'alpha',followers:1000,candidate:true,canPublish:false},{connectionId:'b',username:'beta',followers:1500,candidate:true,canPublish:true},{connectionId:'small',username:'small',followers:999,candidate:false,canPublish:true}],config:{receivers:[]}};
 assert.deepEqual((await readWebsiteLinkAccounts(f.db,ctx)).map(a=>[a.connectionId,a.trackingUrl]),[['a',null],['b',null]]);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_website_links').get().n,0);
 assert.equal((await createWebsiteLinks(f.db,ctx,now,['a'])).created,1);const first=(await readWebsiteLinkAccounts(f.db,ctx))[0].trackingUrl;
 assert.equal((await readWebsiteLinkAccounts(f.db,ctx))[1].trackingUrl,null);
 assert.equal((await createWebsiteLinks(f.db,ctx,now)).created,1);assert.equal((await createWebsiteLinks(f.db,ctx,now+1)).created,0);assert.equal((await readWebsiteLinkAccounts(f.db,ctx))[0].trackingUrl,first);
 for(const ids of [[],['a','a'],null,Array(201).fill('a')])await assert.rejects(()=>createWebsiteLinks(f.db,ctx,now,ids),e=>e.statusCode===400);
 for(const ids of [['outside'],['small']])await assert.rejects(()=>createWebsiteLinks(f.db,ctx,now,ids),e=>e.statusCode===403);
 assert.deepEqual(ctx.config.receivers,[]);assert.equal(f.requests.length,0);
});

test('compact aliases and old URLs retain one immutable identity and counter',async t=>{
 const f=await fixture(t);await createWebsiteLinks(f.db,context,now);
 const [link]=await readWebsiteLinks(f.db,context,window);
 assert.match(link.trackingUrl,/^https:\/\/deeppersonaai.com\/[1-9][a-z0-9]{4}$/);
 assert.equal((await readWebsiteLinkAccounts(f.db,context))[0].trackingUrl,link.trackingUrl);
 const old=new URL('https://factory.test/go/'+link.code),compact=new URL(link.trackingUrl+'?next=https://evil.test');
 for(const url of [old,compact]){
  const response=await handleWebsiteShortLink(new Request(url,{headers:{'user-agent':'Mozilla/5.0'}}),f.env,url,null,{now});
  assert.equal(response.status,302);assert.equal(response.headers.get('X-Factory-Link-Code'),link.code);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('utm_campaign'),'factory-a');
  assert.equal(new URL(response.headers.get('location')).searchParams.get('next'),null);
 }
 let [stats]=await readWebsiteLinks(f.db,context,window);assert.equal(stats.requests,2);assert.equal(stats.visits,2);assert.equal(stats.code,link.code);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_website_link_days').get().n,1);
 for(const url of [old,compact])assert.equal((await handleWebsiteShortLink(new Request(url,{method:'HEAD'}),f.env,url,null,{now})).status,302);
 assert.equal((await readWebsiteLinks(f.db,context,window))[0].requests,2);
 await handleWebsiteShortLink(new Request(compact,{headers:{'user-agent':'Googlebot'}}),f.env,compact,null,{now});
 [stats]=await readWebsiteLinks(f.db,context,window);assert.equal(stats.filtered,1);assert.equal(stats.visits,2);
 for(const path of ['/go/invalid']){
  const url=new URL('https://factory.test'+path);assert.equal((await handleWebsiteShortLink(new Request(url),f.env,url)).status,404);
 }
 assert.equal((await handleWebsiteShortLink(new Request(compact,{method:'POST'}),f.env,compact)).status,405);
 for(const path of ['/about','/privacy','/api/psychology-website','/1234','/00001','/100001','/1ABCD']){
  const url=new URL('https://factory.test'+path);assert.equal(await handleWebsiteShortLink(new Request(url),f.env,url),null);
 }
 assert.equal((await readWebsiteLinks(f.db,context,window))[0].requests,3);
});

test('compact-link migration backfills existing links without rewriting legacy attribution',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(fs.readFileSync(new URL('../migrations/0077_psychology_website_links.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO psychology_website_links VALUES('19d828d363','p','a',1),('123456abcd','p','b',2); INSERT INTO psychology_website_link_days VALUES('19d828d363','2026-10-09',9,1)");
  for(const sql of unstable_splitSqlQuery(fs.readFileSync(new URL('../migrations/0088_psychology_website_compact_links.sql',import.meta.url),'utf8')))db.exec(sql);
  const aliases=db.prepare('SELECT code,short_code FROM psychology_website_link_aliases ORDER BY code').all();
  assert.deepEqual(aliases.map(a=>a.code),['123456abcd','19d828d363']);for(const a of aliases)assert.match(a.short_code,/^[1-9][a-z0-9]{4}$/);assert.notEqual(aliases[0].short_code,aliases[1].short_code);
  assert.deepEqual({...db.prepare('SELECT * FROM psychology_website_link_days').get()},{code:'19d828d363',day:'2026-10-09',requests:9,filtered:1});
  db.exec("INSERT OR IGNORE INTO psychology_website_links VALUES('19d828d363','p','a',3)");
  assert.equal(db.prepare('SELECT COUNT(*) n FROM psychology_website_link_aliases').get().n,2);
  db.exec("INSERT INTO psychology_website_links VALUES('987654abcd','p','c',3)");
  assert.match(db.prepare("SELECT short_code FROM psychology_website_link_aliases WHERE code='987654abcd'").get().short_code,/^[1-9][a-z0-9]{4}$/);
  assert.deepEqual(db.prepare("SELECT code,short_code FROM psychology_website_link_aliases WHERE code!='987654abcd' ORDER BY code").all(),aliases);
 }finally{db.close();}
});

test('random aliases retry collisions atomically and exhausted retries do not leave broken mappings',async t=>{
 const f=await fixture(t);await createWebsiteLinks(f.db,context,now);
 f.sqlite.exec("UPDATE psychology_website_link_aliases SET short_code='10000'");
 let calls=0;f.sqlite.function('random',()=>++calls<=5?0n:1n);
 const ctx={projectId:'proj-psych',accounts:[{connectionId:'b',username:'beta',candidate:true}]};
 await createWebsiteLinks(f.db,ctx,now);
 assert.equal((await readWebsiteLinkAccounts(f.db,ctx))[0].trackingUrl,'https://deeppersonaai.com/21111');
 assert.equal(calls,10);
 f.sqlite.function('random',()=>0n);
 await assert.rejects(()=>createWebsiteLinks(f.db,{...ctx,accounts:[{connectionId:'c',username:'charlie',candidate:true}]},now),/allocation failed/);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM psychology_website_links WHERE connection_id='c'").get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_website_link_aliases WHERE short_code IS NULL').get().n,0);
 const url=new URL('https://factory.test/39999');assert.equal((await handleWebsiteShortLink(new Request(url),f.env,url)).status,404);
});
