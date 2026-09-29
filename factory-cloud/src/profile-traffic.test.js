import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeProfileTraffic,loadProfileTraffic} from './profile-traffic.js';
import {fixture} from './psychology-cloud-test-fixture.js';
import {buildModuleReport,loadGroupStore} from './official.js';
import {kvSet} from './kv.js';
import {upsertOfficialAccounts} from './official-archive-store.js';

test('daily ratios pair account and day; missing is distinct from zero',()=>{
 const accounts=['a','b','c'].map(account_key=>({account_key,label:account_key}));
 const samples=[{account_key:'a',days_json:JSON.stringify([
  {date:'2026-09-26',videoViews:100,profileViews:5,updatedAt:1},
  {date:'2026-09-27',videoViews:900,profileViews:null,updatedAt:2},
  {date:'2026-09-28',videoViews:500,profileViews:100},
 ])},{account_key:'b',days_json:JSON.stringify([
  {date:'2026-09-26',videoViews:null,profileViews:99},
  {date:'2026-09-27',videoViews:0,profileViews:0},
 ])},{account_key:'outside',days_json:JSON.stringify([{date:'2026-09-26',videoViews:99999,profileViews:99}])}];
 const result=summarizeProfileTraffic(accounts,samples,'2026-09-26','2026-09-27');
 assert.equal(result.summary.videoViews,1000);assert.equal(result.summary.profileViews,104);
 assert.equal(result.summary.ratio,0.05);assert.equal(result.summary.pairedDays,2);
 assert.equal(result.summary.coveredAccounts,2);assert.equal(result.accounts.find(r=>r.accountKey==='b').ratio,null);
 assert.equal(result.accounts.find(r=>r.accountKey==='c').profileViews,null);
});

test('traffic view enforces current scope before reading daily data, skips videos and network',async t=>{
 const f=await fixture(t); f.env.ARCHIVE.put=async()=>{};
 await kvSet(f.db,'official-account-groups',{projects:[{id:'p',name:'Psych',moduleKey:'psychology',reportEnabled:true}],
 groups:[{id:'g1',name:'One',projectId:'p'},{id:'g2',name:'Two',projectId:'p'}]});
 f.sqlite.exec("DELETE FROM official_account_assignments; INSERT INTO official_account_assignments(account_key,group_id) VALUES('a','g1'),('b','g2')");
 const now=Date.now(),date=new Date(now-86400000).toISOString().slice(0,10);
 await upsertOfficialAccounts(f.env,f.db,['a','b'].map((id,i)=>({schema:'tiktok:'+id,label:id,latestSyncAt:now,profile:{insights:{_daily_traffic:{status:'ready',days:[{date,videoViews:100,profileViews:i?99:5,updatedAt:now}]}}},videos:[]})));
 const store=await loadGroupStore(f.db),query=new URLSearchParams({module:'psychology',period:'yesterday',view:'traffic',from:date,to:date});
 const prepare=f.db.prepare;f.db.prepare=sql=>{assert.doesNotMatch(sql,/official_report_video_cache|official_videos_latest/);return prepare(sql);};
 const user={role:'operator',allowedAccountGroups:['g1']};
 const data=await buildModuleReport(f.env,f.db,store,query,user);
 assert.equal(data.traffic.summary.totalAccounts,1);assert.equal(data.traffic.summary.profileViews,5);
 assert.equal(f.requests.length,0);
 query.set('group','g2');await assert.rejects(buildModuleReport(f.env,f.db,store,query,user),e=>e.statusCode===403);
 query.delete('group');const none=await buildModuleReport(f.env,f.db,store,query,{...user,allowedAccountGroups:[]});
 assert.equal(none.traffic.summary.totalAccounts,0);assert.equal(none.traffic.summary.profileViews,null);
 f.sqlite.exec('DELETE FROM official_account_assignments');
 const revoked=await loadGroupStore(f.db);assert.equal((await buildModuleReport(f.env,f.db,revoked,query,user)).traffic.summary.totalAccounts,0);
});
