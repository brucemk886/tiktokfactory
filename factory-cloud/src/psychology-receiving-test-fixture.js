import {DatabaseSync} from 'node:sqlite';
import {fixture} from './psychology-cloud-test-fixture.js';
import {handlePsychologyReceivingReport} from './psychology-receiving-report.js';
export const now=Date.parse('2026-10-10T09:00:00Z'),at=Date.parse('2026-10-09T16:00:00Z');
export async function receivingFixture(t){
 const f=await fixture(t),site=new DatabaseSync(':memory:');t.after(()=>site.close());
 site.exec("CREATE TABLE quiz_sessions(id TEXT PRIMARY KEY,started_at TEXT,completed_at TEXT); CREATE TABLE quiz_attribution(session_id TEXT PRIMARY KEY,visit_id TEXT,source TEXT,campaign TEXT); CREATE TABLE quiz_reports(id TEXT PRIMARY KEY,session_id TEXT); CREATE TABLE payment_orders(id TEXT PRIMARY KEY,report_id TEXT,livemode INTEGER,amount_cents INTEGER,paid_at TEXT,status TEXT); CREATE TABLE quiz_events(session_id TEXT,event_name TEXT); CREATE TABLE admin_test_sessions(session_id TEXT PRIMARY KEY);CREATE TABLE traffic_link_state(id TEXT PRIMARY KEY,started_at INTEGER); CREATE TABLE traffic_link_clicks(id TEXT PRIMARY KEY,code TEXT,campaign TEXT,clicked_at INTEGER,arrived_at INTEGER,excluded INTEGER);");
 site.prepare("INSERT INTO traffic_link_state VALUES('v1',?)").run(at-5*86400000);
 f.env.DEEP_PERSONA_DB={prepare(sql){return{bind(...args){return{sql,args};}};},async batch(items){return items.map(({sql,args})=>({success:true,results:site.prepare(sql).all(...args)}));}};
 f.sqlite.exec("UPDATE factory_users SET sidebar_modules_json='[\"psychology-ops-report\"]' WHERE username='admin';INSERT INTO official_account_assignments(account_key,group_id) VALUES('a','g'),('b','g'),('c','g'),('outside','other')");
 for(const id of ['a','b','c','outside'])f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+id,JSON.stringify({username:id==='b'?'receiver':id,followers:1500,insights:{_daily_traffic:{days:[{date:'2026-10-09',profileViews:100,updatedAt:now},{date:'2026-10-10',profileViews:50,updatedAt:now}]}}}),now);
 f.sqlite.prepare('INSERT INTO psychology_website_links(code,project_key,connection_id,created_at) VALUES(?,?,?,?)').run('abc','proj-psych','b',at-86400000*5);
 const photo=(id,{publisher='a',receiver='b',views=1200,publishedAt=at+1000,state='published',media='photo',video=id,mapped=true}={})=>{
  f.sqlite.prepare("INSERT INTO ops_task_facts(id,batch_id,account_key,media,state,published_at,schedule_at,views,video_id,title,synced_at) VALUES(?,'batch',?,?,?,?,?,?,?,?,?)").run(id,'tiktok:'+publisher,media,state,publishedAt,publishedAt,views,video,'Attachment patterns '+id,now);
  if(mapped)f.sqlite.prepare('INSERT INTO ops_photo_receivers VALUES(?,?,?,?,?,?)').run(id,'tiktok:'+publisher,'tiktok:'+receiver,receiver==='b'?'receiver':receiver,'Find your attachment type. Visit @receiver and tap the link in their bio.',at-86400000);
 };
 const click=(id,{when=at+2000,arrived=at+3000,code='abc',campaign='factory-b',excluded=0}={})=>site.prepare('INSERT INTO traffic_link_clicks VALUES(?,?,?,?,?,?)').run(id,code,campaign,when,arrived,excluded);
 const read=async(query='period=today',user={username:'admin'},method='GET')=>{
  const url=new URL('https://factory.test/api/psychology-receiving-report?'+query),res=await handlePsychologyReceivingReport(new Request(url,{method}),f.env,url,user?{user}:null,{now});
  return {status:res.status,data:await res.json(),headers:res.headers};
 };
 return {...f,site,photo,click,read};
}
