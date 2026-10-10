import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {websiteWindow} from './psychology-website-data.js';
import { fixture as factoryFixture } from './psychology-cloud-test-fixture.js';
import { readFunnelFacts,readWebsiteFunnel,funnelWindow,summarizeFunnel,stageLoss } from './psychology-website-funnel.js';
const now=Date.parse('2026-10-08T12:00:00Z'),window=funnelWindow({from:'2026-10-06',to:'2026-10-06'});
function site(t,ready=true){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec("CREATE TABLE quiz_sessions(id TEXT PRIMARY KEY,started_at TEXT,completed_at TEXT); CREATE TABLE quiz_attribution(session_id TEXT PRIMARY KEY,visit_id TEXT,source TEXT,campaign TEXT); CREATE TABLE quiz_reports(id TEXT PRIMARY KEY,session_id TEXT); CREATE TABLE payment_orders(id TEXT PRIMARY KEY,report_id TEXT,livemode INTEGER,amount_cents INTEGER,paid_at TEXT,status TEXT); CREATE TABLE quiz_events(session_id TEXT,event_name TEXT); CREATE TABLE admin_test_sessions(session_id TEXT PRIMARY KEY);");
 if(ready)sqlite.exec("CREATE TABLE traffic_link_state(id TEXT PRIMARY KEY,started_at INTEGER); CREATE TABLE traffic_link_clicks(id TEXT PRIMARY KEY,code TEXT,campaign TEXT,clicked_at INTEGER,arrived_at INTEGER,excluded INTEGER);");
 const db={prepare(sql){assert.match(sql.trim(),/^(SELECT|WITH)/);return{bind(...args){return{sql,args};}};},async batch(items){return items.map(({sql,args})=>({success:true,results:sqlite.prepare(sql).all(...args)}));}};
 const click=(id,{code='aaa',campaign='factory-a',at=window.start+1000,arrived=null,excluded=0}={})=>sqlite.prepare('INSERT INTO traffic_link_clicks VALUES(?,?,?,?,?,?)').run(id,code,campaign,at,arrived,excluded);
 const session=(id,clickId,{campaign='factory-a',finished=false,paid=false,testMode=false,marked=false,started='2026-10-07 00:00:00'}={})=>{
  sqlite.prepare('INSERT INTO quiz_sessions VALUES(?,?,?)').run(id,started,finished?'2026-10-07 00:10:00':null);
  sqlite.prepare('INSERT INTO quiz_attribution VALUES(?,?,?,?)').run(id,clickId,'tiktok',campaign);
  sqlite.prepare('INSERT INTO quiz_reports VALUES(?,?)').run('r-'+id,id);
  if(paid)sqlite.prepare('INSERT INTO payment_orders VALUES(?,?,?,?,?,?)').run('o-'+id,'r-'+id,testMode?0:1,499,'2026-10-08 00:00:00','paid');
  if(marked)sqlite.prepare('INSERT INTO admin_test_sessions VALUES(?)').run(id);
 };
 return{sqlite,db,click,session};
}
const links=[{code:'aaa',connectionId:'a',createdAt:window.start-1000}];
test('Beijing windows, missing values, zero denominators and reference-rate coverage are explicit',()=>{
 assert.equal(window.start,Date.parse('2026-10-05T16:00:00Z'));
 assert.equal(funnelWindow({period:'today',from:'2026-10-07',to:'2026-10-07'},Date.parse('2026-10-06T17:00:00Z')).from,'2026-10-07');
 assert.deepEqual(stageLoss(100,75),{lost:25,rate:.25,conversion:.75});
 assert.equal(stageLoss(0,0).rate,null);assert.equal(stageLoss(null,0).lost,null);
 const row={profileViews:100,clicks:20,arrived:15,started:10,finished:5,paid:2,profileComplete:true,coverageComplete:true};
 assert.equal(summarizeFunnel([row]).profileClickRate,.2);
 assert.equal(summarizeFunnel([{...row,profileWindowAligned:false}]).profileClickRate,null);
 assert.equal(summarizeFunnel([{...row,profileComplete:false}]).profileClickRate,null);
 assert.equal(summarizeFunnel([{...row,coverageComplete:false}]).profileClickRate,null);
 assert.equal(summarizeFunnel([{...row,clicks:101}]).profileClickRate,null);
 assert.equal(summarizeFunnel([]).clicks,null);
});
test('real SQL tracks click cohorts across later sessions/payments, deduplicates stages and enforces scope',async t=>{
 const f=site(t);f.sqlite.prepare("INSERT INTO traffic_link_state VALUES('v1',?)").run(window.start-1000);
 f.click('bounce');f.click('arrived',{arrived:window.start+2000});f.click('started');f.click('finished');f.click('paid');
 f.session('s1','started');f.session('s2','finished',{finished:true});f.session('s3','paid',{finished:true,paid:true});f.session('s4','paid',{finished:true,paid:true});
 f.click('outside',{code:'bbb',campaign:'factory-b'});f.session('s5','outside',{campaign:'factory-b',paid:true});
 f.click('bot',{excluded:1});f.session('s6','bot',{paid:true});
 f.click('end',{at:window.end});f.click('before',{at:window.start-1});
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const result=await readFunnelFacts(f.db,links,window);
 assert.equal(result.ready,true);
 assert.deepEqual({...result.rows[0]},{code:'aaa',clicks:5,arrived:4,started:3,finished:2,paid:1});
 assert.equal(result.rows.length,1);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
 assert.equal((await readFunnelFacts(f.db,[],window)).rows.length,0);
});
test('mismatched campaign, old sessions, test payments and marked sessions do not become conversions',async t=>{
 const f=site(t);f.sqlite.prepare("INSERT INTO traffic_link_state VALUES('v1',?)").run(window.start-1000);
 for(const id of ['spoof','test','marked','old'])f.click(id,{arrived:window.start+2000});
 f.session('spoof','spoof',{campaign:'factory-b',paid:true});
 f.session('test','test',{paid:true,testMode:true});f.session('marked','marked',{paid:true,marked:true});f.session('old','old',{paid:true,started:'2026-10-05 00:00:00'});
 const data=await readFunnelFacts(f.db,links,window);
 assert.deepEqual({...data.rows[0]},{code:'aaa',clicks:4,arrived:4,started:0,finished:0,paid:0});
});

test('click-linked conversions use the same normalized TikTok source rule',async t=>{
 const f=site(t);f.sqlite.prepare("INSERT INTO traffic_link_state VALUES('v1',?)").run(window.start-1000);
 for(const [i,source] of [' TIKTOK ','www.tiktok.com','direct','tiktok.com.evil'].entries()){
  const id='channel-'+i;f.click(id);f.session(id,id,{finished:true,paid:true});
  f.sqlite.prepare('UPDATE quiz_attribution SET source=? WHERE session_id=?').run(source,id);
 }
 const data=await readFunnelFacts(f.db,links,window);
 assert.deepEqual({...data.rows[0]},{code:'aaa',clicks:4,arrived:2,started:2,finished:2,paid:2});
});

test('missing tracking tables return unavailable instead of fabricating historical zeros',async t=>{
 const f=site(t,false);assert.deepEqual(await readFunnelFacts(f.db,links,window),{ready:false,startedAt:null,rows:[]});
});
test('account profile traffic remains scoped, partial data cannot become a full reference rate',async t=>{
 const f=site(t),factory=await factoryFixture(t);f.sqlite.prepare("INSERT INTO traffic_link_state VALUES('v1',?)").run(window.start-1000);
 factory.sqlite.prepare("INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES(?,?,?,?)").run('tiktok:a','A',JSON.stringify({insights:{_daily_traffic:{days:[{date:'2026-10-06',profileViews:80,updatedAt:now}]}}}),now);
 const context={accounts:[{connectionId:'a',username:'alpha',candidate:true,canPublish:true},{connectionId:'b',candidate:true,canPublish:true},{connectionId:'outside',candidate:false,canPublish:false}]};
 f.click('one',{arrived:window.start+2000});
 const result=await readWebsiteFunnel(factory.db,f.db,context,links,{from:'2026-10-06',to:'2026-10-06'},now);
 assert.equal(result.rows.length,2);assert.equal(result.rows[0].profileViews,80);assert.equal(result.rows[0].clicks,1);
 assert.equal(result.rows[1].profileViews,null);assert.equal(result.rows[1].clicks,null);
 assert.equal(result.summary.profileClickRate,null);assert.equal(result.rows[0].summary.profileClickRate,null);
 assert.equal(result.rows[0].profileComplete,true);assert.equal(result.rows[0].profileWindowAligned,false);
 assert.equal(result.profileWindow.timeZone,'UTC');assert.equal(result.window.timeZone,'Asia/Shanghai');
 assert.equal(result.profileLatestDay,'2026-10-06');
 const historical=await readWebsiteFunnel(factory.db,f.db,context,links,{from:'2026-10-01',to:'2026-10-01'},now);
 assert.equal(historical.rows[0].clicks,null);
});

test('today includes Beijing early-morning clicks, with exclusive midnight boundaries and separate official days',async t=>{
 const clock=Date.parse('2026-10-10T01:00:00Z'),selected=websiteWindow(new URLSearchParams({period:'today'}),clock),day=funnelWindow(selected,clock);
 const f=site(t),factory=await factoryFixture(t);
 f.sqlite.prepare("INSERT INTO traffic_link_state VALUES('v1',?)").run(day.start-86400000);
 for(const [id,at] of [['before',day.start-1],['midnight',day.start],['morning',Date.parse('2026-10-09T18:00:00Z')],['last',day.end-1],['next',day.end]])f.click(id,{at,arrived:at});
 f.session('start','morning',{started:'2026-10-09 18:00:01',finished:true,paid:true});
 factory.sqlite.prepare("INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES(?,?,?,?)").run('tiktok:a','A',JSON.stringify({insights:{_daily_traffic:{days:[{date:'2026-10-08',profileViews:80,updatedAt:clock}]}}}),clock);
 const context={accounts:[{connectionId:'a',candidate:true,canPublish:true}]};
 const result=await readWebsiteFunnel(factory.db,f.db,context,[{code:'aaa',connectionId:'a',createdAt:day.start-1000}],selected,clock);
 assert.equal(result.window.start,Date.parse('2026-10-09T16:00:00Z'));assert.equal(result.window.end,Date.parse('2026-10-10T16:00:00Z'));
 assert.equal(result.summary.clicks,3);assert.equal(result.summary.arrived,3);assert.equal(result.summary.started,1);
 assert.equal(result.summary.profileViews,null);assert.equal(result.summary.profileClickRate,null);
 assert.equal(result.profileLatestDay,'2026-10-08');assert.equal(result.rows[0].expectedDays,1);assert.equal(result.rows[0].profileDays,0);
 assert.equal(result.profileWindow.start,Date.parse('2026-10-10T00:00:00Z'));
 const yesterday=await readFunnelFacts(f.db,links,funnelWindow({period:'yesterday'},clock));assert.equal(yesterday.rows[0].clicks,1);
});

test('site window uses the same Beijing dates for relative ranges even before UTC midnight',()=>{
 const clock=Date.parse('2026-12-31T16:00:00Z');
 for(const period of ['today','yesterday','7d','30d']){
  const selected=websiteWindow(new URLSearchParams({period}),clock),funnel=funnelWindow(selected,clock);
  assert.equal(funnel.from,selected.from);assert.equal(funnel.to,selected.to);
  assert.equal(funnel.start,Date.parse(selected.start));assert.equal(funnel.end,Date.parse(selected.end));
 }
 assert.equal(funnelWindow({period:'today'},clock).from,'2027-01-01');
 const range=funnelWindow({period:'range',from:'2026-12-30',to:'2026-12-31'},clock);
 assert.equal(range.start,Date.parse('2026-12-29T16:00:00Z'));assert.equal(range.end,Date.parse('2026-12-31T16:00:00Z'));
});
