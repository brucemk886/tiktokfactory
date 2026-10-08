import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './psychology-cloud-test-fixture.js';
import { websiteWindow, websitePage, readWebsiteAnalytics, trackedWebsiteLink, accountForSource } from './psychology-website-data.js';
import { handlePsychologyWebsite } from './psychology-website.js';
import { handleFactoryApi } from './factory-api.js';
import { sha256Hex } from './http.js';
const now=Date.parse('2026-10-06T12:00:00Z');
const window=websiteWindow(new URLSearchParams({period:'range',from:'2026-10-05',to:'2026-10-06'}),now);
function site(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec([
 'CREATE TABLE quiz_sessions(id TEXT PRIMARY KEY,started_at TEXT,completed_at TEXT,email TEXT,source TEXT,campaign TEXT);',
 'CREATE TABLE quiz_reports(id TEXT PRIMARY KEY,session_id TEXT,test_id TEXT,snapshot_json TEXT);',
 'CREATE TABLE quiz_attribution(session_id TEXT PRIMARY KEY,source TEXT,campaign TEXT,medium TEXT,content TEXT);',
 'CREATE TABLE quiz_events(session_id TEXT,event_name TEXT);',
 'CREATE TABLE admin_test_sessions(session_id TEXT PRIMARY KEY);',
 'CREATE TABLE traffic_anonymous_pages(id TEXT PRIMARY KEY,created_at TEXT,page TEXT);',
 'CREATE TABLE quiz_tests(id TEXT PRIMARY KEY,title TEXT);',
 'CREATE TABLE payment_orders(id TEXT PRIMARY KEY,report_id TEXT,amount_cents INTEGER,currency TEXT,status TEXT,paid_at TEXT,livemode INTEGER,stripe_session_id TEXT);',
 'CREATE TABLE deep_orders(id TEXT PRIMARY KEY,report_id TEXT,amount_cents INTEGER,currency TEXT,status TEXT,paid_at TEXT,livemode INTEGER,stripe_session_id TEXT);',
 'CREATE TABLE lemon_payments(order_id TEXT PRIMARY KEY,prepared INTEGER,checkout_url TEXT,remote_order_id TEXT);',
 "INSERT INTO quiz_tests VALUES('attachment-style','Attachment');"
 ].join('\n'));
 const queries=[];
 const db={prepare(sql){
  assert.match(sql.trim(),/^(SELECT|WITH)\b/i);assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);queries.push(sql);
  return {bind(...args){return {sql,args};}};
 },async batch(statements){return statements.map(({sql,args})=>({success:true,results:sqlite.prepare(sql).all(...args)}));}};
 function session(id,{started='2026-10-05 01:00:00',finished=true,source='tiktok',campaign='factory-a',medium='bio',content=''}={}){
  sqlite.prepare('INSERT INTO quiz_sessions VALUES(?,?,?,?,?,?)').run(id,started,finished?'2026-10-05 02:00:00':null,finished?'private-'+id+'@example.com':null,source,campaign);
  sqlite.prepare('INSERT INTO quiz_reports VALUES(?,?,?,?)').run('report-'+id,id,'attachment-style','PRIVATE REPORT');
  sqlite.prepare('INSERT INTO quiz_attribution VALUES(?,?,?,?,?)').run(id,source,campaign,medium,content);
 }
 function order(id,sessionId,{table='payment_orders',amount=499,currency='usd',status='paid',paid='2026-10-06 02:00:00',live=1,stripe='cs-private'}={}){
  sqlite.prepare('INSERT INTO '+table+' VALUES(?,?,?,?,?,?,?,?)').run(id,'report-'+sessionId,amount,currency,status,paid,live,stripe);
 }
 return {sqlite,db,queries,session,order};
}
const context={accounts:[{connectionId:'a',username:'account_a',name:'Account A',candidate:true,canPublish:true}],config:{receivers:[]},summary:{selectedReceivers:0}};
test('Beijing boundaries, invalid dates, maximum range and pagination',()=>{
 const w=websiteWindow(new URLSearchParams({period:'today'}),Date.parse('2026-10-05T16:00:00Z'));
 assert.equal(w.from,'2026-10-06');assert.equal(w.start,'2026-10-05T16:00:00.000Z');assert.equal(w.end,'2026-10-06T16:00:00.000Z');
 for(const p of [{period:'range',from:'2026-02-30',to:'2026-03-01'},{period:'range',from:'2020-01-01',to:'2026-10-06'},{period:'range',from:'2026-10-06',to:'2026-10-05'},{period:'other'},{period:'range',from:'2026-10-06',to:'2026-10-07'}])assert.throws(()=>websiteWindow(new URLSearchParams(p),now));
 for(const value of ['0','-1','1.2','1 OR 1=1','1000000'])assert.throws(()=>websitePage(new URLSearchParams({page:value}),'page'));
});
test('SQL distinguishes cohorts, payment dates, products and currencies; output is private and idempotent',async t=>{
 const f=site(t);
 f.session('a');f.order('base-a','a');f.order('deep-a','a',{table:'deep_orders',amount:899});
 f.session('old',{started:'2026-10-01 00:00:00',source:'tiktok',campaign:''});f.order('late-old','old');
 f.session('refunded');f.order('refund','refunded',{currency:'eur',status:'refunded'});
 f.sqlite.exec("INSERT INTO traffic_anonymous_pages VALUES('p1','2026-10-04 15:59:59','/'),('p2','2026-10-04 16:00:00','/'),('p3','2026-10-06 15:59:59','/'),('p4','2026-10-06 16:00:00','/')");
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const data=await readWebsiteAnalytics(f.db,window,context,{},now);
 assert.equal(data.summary.pageviews,null);assert.equal(data.summary.started,2);assert.equal(data.summary.paidSessions,2);assert.equal(data.summary.orders,4);assert.equal(data.summary.refundedOrders,1);
 assert.deepEqual(data.currencies.map(r=>[r.currency,r.grossCents]),[['eur',499],['usd',1897]]);
 assert.equal(data.attribution.attributedOrders,3);assert.equal(data.attribution.unattributedOrders,1);assert.equal(data.accounts[0].orders,3);assert.equal(data.accounts[0].paidSessions,2);
 assert.equal(data.days[0].started,2);assert.equal(data.days[1].orders,4);assert.equal(data.attribution.accountPageviews,null);assert.equal(data.attribution.originalVideoAttribution,false);
 assert.doesNotMatch(JSON.stringify(data),/@example.com|PRIVATE REPORT|cs-private|snapshot_json|session_id|report_id/);
 assert.deepEqual(await readWebsiteAnalytics(f.db,window,context,{},now),data);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
});
test('TikTok-only aggregation excludes direct, other, unknown, conflicting and lookalike sources',async t=>{
 const f=site(t),known=['tiktok',' TiKToK ','tiktok.com','WWW.TIKTOK.COM','vm.tiktok.com'];
 for(const [i,source] of known.entries()){f.session('known-'+i,{source});f.order('known-order-'+i,'known-'+i);}
 f.session('legacy');f.order('legacy-order','legacy');f.sqlite.exec("DELETE FROM quiz_attribution WHERE session_id='legacy'");
 f.session('empty-attribution');f.order('empty-order','empty-attribution');f.sqlite.exec("UPDATE quiz_attribution SET source=' ' WHERE session_id='empty-attribution'");
 f.session('no-account',{campaign:''});f.order('no-account-order','no-account');
 for(const [i,source] of ['direct','google','unknown','',null,'not-tiktok.com','tiktok.com.evil','https://evil.test/.tiktok.com'].entries()){
  f.session('excluded-'+i,{source});f.order('excluded-order-'+i,'excluded-'+i,{amount:99999,currency:'eur'});
  f.order('excluded-deep-'+i,'excluded-'+i,{table:'deep_orders'});
 }
 for(const source of ['google','unknown']){
  f.session('conflict-'+source,{source});f.order('conflict-order-'+source,'conflict-'+source);
  f.sqlite.prepare("UPDATE quiz_sessions SET source='tiktok' WHERE id=?").run('conflict-'+source);
 }
 f.order('orphan-order','nonexistent');
 f.sqlite.exec("INSERT INTO traffic_anonymous_pages VALUES('untagged-page','2026-10-05 01:00:00','/')");
 const data=await readWebsiteAnalytics(f.db,window,context,{},now);
 assert.equal(data.channel,'tiktok');assert.equal(data.version,2);assert.equal(data.summary.pageviews,null);
 for(const key of ['started','finished','submitted','checkout','paidSessions','orders'])assert.equal(data.summary[key],8,key);
 assert.deepEqual(data.currencies.map(row=>[row.currency,row.grossCents]),[['usd',3992]]);
 assert.equal(data.orders.total,8);assert.equal(data.orders.rows.length,8);
 assert.equal(data.sources.rows.every(row=>row.source==='tiktok'),true);assert.equal(data.sources.rows.reduce((sum,row)=>sum+row.started,0),8);
 assert.equal(data.accounts[0].started,7);assert.equal(data.accounts[0].orders,7);
 assert.equal(data.attribution.unattributedStarted,1);assert.equal(data.attribution.unattributedOrders,1);
 assert.equal(data.days.reduce((sum,row)=>sum+row.started,0),8);assert.equal(data.days.reduce((sum,row)=>sum+row.orders,0),8);
 assert.equal(data.days.every(row=>row.pageviews===null),true);
 assert.doesNotMatch(f.queries.join('\n'),/traffic_anonymous_pages/);
});

test('test mode, marked sessions, previews, zero-price and pending orders never become real revenue',async t=>{
 const f=site(t);for(const id of ['test','marked','preview','zero','pending'])f.session(id);
 f.order('test-order','test',{live:0});f.order('marked-order','marked');f.sqlite.prepare('INSERT INTO admin_test_sessions VALUES(?)').run('marked');
 f.order('preview_order','preview');f.order('zero-order','zero',{amount:0});f.order('pending-order','pending',{status:'pending',paid:null});
 const data=await readWebsiteAnalytics(f.db,window,context,{},now);
 assert.equal(data.summary.started,2);assert.equal(data.summary.orders,0);assert.equal(data.summary.paidSessions,0);assert.equal(data.currencies.length,0);assert.equal(data.orders.rows.length,0);
});
test('email gate counts finished once; prepared Lemon checkouts are not visits to checkout',async t=>{
 const f=site(t);f.session('prepared',{finished:false});f.order('prepared-order','prepared',{status:'pending',paid:null,stripe:null});
 f.session('opened',{finished:false});f.order('opened-order','opened',{status:'pending',paid:null,stripe:null});
 f.sqlite.exec("INSERT INTO lemon_payments VALUES('prepared-order',1,'https://checkout.test',NULL),('opened-order',0,'https://checkout.test',NULL); INSERT INTO quiz_events VALUES('prepared','email_gate_viewed'),('prepared','email_gate_viewed')");
 const data=await readWebsiteAnalytics(f.db,window,context,{},now);
 assert.equal(data.summary.finished,1);assert.equal(data.summary.submitted,0);assert.equal(data.summary.checkout,1);assert.equal(data.summary.orders,0);
});
test('source and order pagination preserve totals; only current project accounts resolve tags',async t=>{
 const f=site(t);for(let i=0;i<23;i++){f.session('s'+i,{campaign:'campaign-'+i});f.order('o'+i,'s'+i);}
 f.session('outside',{campaign:'factory-outside'});f.order('o-outside','outside');
 for(let i=0;i<25;i++){f.session('direct-'+i,{source:'direct',campaign:'unrelated-'+i});f.order('direct-order-'+i,'direct-'+i);}
 const data=await readWebsiteAnalytics(f.db,window,context,{sourcePage:2,orderPage:2},now);
 assert.equal(data.sources.total,24);assert.equal(data.sources.rows.length,4);assert.equal(data.orders.total,24);assert.equal(data.orders.rows.length,4);assert.equal(data.accounts.length,0);assert.equal(data.attribution.attributedStarted,0);
 assert.equal(accountForSource({source:'other',campaign:'factory-a'},context.accounts),null);assert.equal(accountForSource({source:'tiktok',campaign:'account_a'},context.accounts),null);
 const link=new URL(trackedWebsiteLink(context.accounts[0]));assert.equal(link.origin,'https://deeppersonaai.com');assert.equal(link.searchParams.get('utm_campaign'),'factory-a');assert.equal(trackedWebsiteLink({connectionId:'../../bad'}),null);
});
test('zero traffic has unknown ratios; source failure cannot fabricate zero metrics',async t=>{
 const f=site(t);const data=await readWebsiteAnalytics(f.db,window,context,{},now);
 assert.equal(data.summary.paymentRate,null);assert.equal(data.summary.completionRate,null);assert.equal(data.days.length,2);
 await assert.rejects(()=>readWebsiteAnalytics({prepare:f.db.prepare,batch:async()=>[{success:false,results:[]}]},window,context),/未完成/);
});
async function endpointFixture(t){
 const f=await fixture(t),s=site(t);s.session('a');s.order('o1','a');s.session('other',{source:'google'});s.order('other-order','other');f.env.DEEP_PERSONA_DB=s.db;
 f.sqlite.exec("UPDATE factory_users SET sidebar_modules_json='[\"psychology-autopilot\"]' WHERE username='admin'; INSERT INTO psychology_conversion_campaigns(project_key,owner,revision,created_at,updated_at) VALUES('proj-psych','admin',0,0,0)");
 const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-autopilot']};
 async function call(query='period=7d',session={user},method='GET'){
  const url=new URL('https://factory.test/api/psychology-website?'+query);
  const response=await handlePsychologyWebsite(new Request(url,{method}),f.env,url,session,{now});
  return {status:response.status,data:await response.json(),headers:response.headers};
 }return {...f,site:s,user,call};
}
test('fresh role, module, owner and login checks; GET never modifies either database',async t=>{
 const f=await endpointFixture(t),before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const first=await f.call();assert.equal(first.status,200,JSON.stringify(first));assert.match(first.headers.get('cache-control'),/no-store/);
 assert.equal(first.data.channel,'tiktok');assert.equal(first.data.summary.started,1);assert.equal(first.data.summary.orders,1);
 assert.equal((await f.call('channel=all')).data.summary.started,1);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.requests.length,0);
 assert.equal((await f.call('',null)).status,401);assert.equal((await f.call('',{user:f.user},'POST')).status,405);
 f.sqlite.exec("UPDATE psychology_conversion_campaigns SET owner='someone-else'");assert.equal((await f.call()).status,403);
 f.sqlite.exec("UPDATE psychology_conversion_campaigns SET owner='admin'; UPDATE factory_users SET role='operator'");assert.equal((await f.call()).status,403);
 f.sqlite.exec("UPDATE factory_users SET role='admin',sidebar_modules_json='[]'");assert.equal((await f.call()).status,403);
 f.sqlite.exec("UPDATE factory_users SET sidebar_modules_json='[\"psychology-autopilot\"]',active=0");assert.equal((await f.call()).status,403);
});
test('missing source, unavailable source and invalid requests return explicit errors after authorization',async t=>{
 const f=await endpointFixture(t);delete f.env.DEEP_PERSONA_DB;assert.equal((await f.call()).status,503);
 f.env.DEEP_PERSONA_DB={prepare:f.site.db.prepare,batch:async()=>{throw new Error('source unavailable');}};
 assert.equal((await f.call()).status,503);assert.equal((await f.call('period=all')).status,400);assert.equal((await f.call('orderPage=-1')).status,400);assert.equal(f.requests.length,0);
});
test('unified API website.read preserves owner checks and read-only behavior',async t=>{
 const f=await endpointFixture(t),token='fac_api_test_website';
 await f.db.prepare("INSERT INTO factory_ai_keys(id,owner_id,token_hash,token_prefix,created_at) VALUES('project','admin',?,'test',0)").bind(await sha256Hex(token)).run();
 const url=new URL('https://factory.test/api/v1/factory');
 const req=()=>new Request(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({module:'psychology',action:'website.read',params:{query:{period:'range',from:'2026-10-05',to:'2026-10-06'}}})});
 const response=await handleFactoryApi(req(),f.env,url,null);
 assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).connected,true);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_requests').get().n,0);
 f.sqlite.exec("UPDATE psychology_conversion_campaigns SET owner='revoked'");assert.equal((await handleFactoryApi(req(),f.env,url,null)).status,403);
});

test('short link creation requires the current campaign owner and same origin; report reads remain read-only',async t=>{
 const f=await endpointFixture(t);
 const url=new URL('https://factory.test/api/psychology-website/links');
 const call=(session={user:f.user},origin='https://factory.test')=>handlePsychologyWebsite(new Request(url,{method:'POST',headers:{Origin:origin}}),f.env,url,session,{now});
 assert.equal((await call(null)).status,401);
 assert.equal((await call(undefined,'https://evil.test')).status,403);
 assert.equal((await call()).status,200);
 f.sqlite.exec("UPDATE psychology_conversion_campaigns SET owner='other'");
 assert.equal((await call()).status,403);
 f.sqlite.exec("UPDATE psychology_conversion_campaigns SET owner='admin'; UPDATE factory_users SET role='operator'");
 assert.equal((await call()).status,403);assert.equal(f.requests.length,0);
});
