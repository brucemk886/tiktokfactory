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

const scopeIds = {
  first: '00000000-0000-4000-8000-000000000001',
  second: '00000000-0000-4000-8000-000000000002',
  other: '00000000-0000-4000-8000-000000000003',
  pending: '00000000-0000-4000-8000-000000000004',
  unassigned: '00000000-0000-4000-8000-000000000005',
};
const mixedProjectUser = {role:'operator',allowedAccountGroups:['psych-a','psych-b','novel','unknown-allowed']};

async function mixedProjectFixture(t) {
  const f = await fixture(t);
  f.env.ARCHIVE.put = async () => {};
  await kvSet(f.db,'official-account-groups',{
    projects:[
      {id:'psych-project',name:'Psychology',moduleKey:'psychology',reportEnabled:true},
      {id:'novel-project',name:'Novel',moduleKey:'novel-promotion',reportEnabled:true},
    ],
    groups:[
      {id:'psych-a',name:'First psychology group',projectId:'psych-project'},
      {id:'psych-b',name:'Second psychology group',projectId:'psych-project'},
      {id:'novel',name:'Novel group',projectId:'novel-project'},
    ],
  });
  f.sqlite.exec('DELETE FROM official_account_assignments');
  for (const [id,group] of [[scopeIds.first,'psych-a'],[scopeIds.second,'psych-b'],
    [scopeIds.pending,'psych-a'],[scopeIds.other,'novel']]) {
    f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,group);
  }
  const now = Date.now();
  const date = new Date(now - 86400000 + 8 * 3600000).toISOString().slice(0,10);
  const publishedAt = Date.parse(date + 'T04:00:00Z');
  const samples = [
    {id:scopeIds.first,label:'First',videoId:'psych-video-a',views:400,videoViews:100,profileViews:5},
    {id:scopeIds.second,label:'Second',videoId:'psych-video-b',views:900,videoViews:200,profileViews:7},
    {id:scopeIds.other,label:'Other project',videoId:'novel-video',views:99999,videoViews:99999,profileViews:9999},
    {id:scopeIds.unassigned,label:'Unassigned',videoId:'unassigned-video',views:88888,videoViews:88888,profileViews:8888},
  ];
  await upsertOfficialAccounts(f.env,f.db,samples.map(sample=>({
    schema:'tiktok:'+sample.id,label:sample.label,latestSyncAt:now,
    profile:{insights:{_daily_traffic:{status:'ready',days:[{
      date,videoViews:sample.videoViews,profileViews:sample.profileViews,updatedAt:now,
    }]}}},
    videos:[{id:sample.videoId,createTime:publishedAt,views:sample.views}],
  })));
  const receiptCalls = [];
  const receipts = new Map([
    [scopeIds.first,{total:2,success:2,failed:0,riskAccounts:0}],
    [scopeIds.second,{total:3,success:2,failed:1,riskAccounts:1}],
    [scopeIds.pending,{total:1,success:1,failed:0,riskAccounts:0}],
    [scopeIds.other,{total:99,success:90,failed:9,riskAccounts:9}],
    [scopeIds.unassigned,{total:88,success:80,failed:8,riskAccounts:8}],
  ]);
  t.mock.method(globalThis,'fetch',async url=>{
    const request = new URL(url);
    assert.equal(request.pathname,'/api/v1/publish/stats');
    const ids = request.searchParams.get('connectionIds').split(',');
    receiptCalls.push(ids);
    return Response.json(ids.reduce((total,id)=>{
      const receipt = receipts.get(id);
      assert.ok(receipt,'known fixture connection ID');
      for (const key of Object.keys(total)) total[key] += receipt[key];
      return total;
    },{total:0,success:0,failed:0,riskAccounts:0}));
  });
  const query = view => new URLSearchParams({module:'psychology',period:'yesterday',view,from:date,to:date});
  return {...f,receiptCalls,query,store:await loadGroupStore(f.db)};
}

function reportVideoIds(report) {
  return new Set(Object.values(report.buckets).flat().map(video=>video.id));
}

test('psychology project total excludes other authorized projects across traffic, analytics and receipts',async t=>{
  const f = await mixedProjectFixture(t);
  for (const user of [mixedProjectUser,{role:'admin'}]) {
    const traffic = await buildModuleReport(f.env,f.db,f.store,f.query('traffic'),user);
    assert.equal(traffic.canSeeProjectTotal,true);
    assert.equal(traffic.report.groupId,'');
    assert.deepEqual(new Set(traffic.groups.map(group=>group.id)),new Set(['psych-a','psych-b']));
    assert.deepEqual(new Set(traffic.traffic.accounts.map(account=>account.accountKey)),
      new Set(['tiktok:'+scopeIds.first,'tiktok:'+scopeIds.second]));
    assert.equal(traffic.traffic.summary.totalAccounts,2);
    assert.equal(traffic.traffic.summary.videoViews,300);
    assert.equal(traffic.traffic.summary.profileViews,12);
    assert.equal(traffic.traffic.summary.ratio,0.04);
    assert.equal(f.receiptCalls.length,0);

    const analytics = await buildModuleReport(f.env,f.db,f.store,f.query('analytics'),user);
    assert.equal(analytics.report.summary.published,2);
    assert.equal(analytics.report.summary.accountCount,2);
    assert.equal(analytics.report.summary.views,1300);
    assert.deepEqual(reportVideoIds(analytics.report),new Set(['psych-video-a','psych-video-b']));
    assert.equal(f.receiptCalls.length,0);

    const publish = await buildModuleReport(f.env,f.db,f.store,f.query('publish'),user);
    assert.equal(publish.publishStatus,'ready');
    assert.deepEqual(publish.report.summary,{publishTotal:6,publishSuccess:5,publishFailed:1,riskAccountCount:1});
    assert.deepEqual(new Set(f.receiptCalls.flat()),new Set([scopeIds.first,scopeIds.second,scopeIds.pending]));
    f.receiptCalls.length = 0;

    const full = await buildModuleReport(f.env,f.db,f.store,f.query('full'),user);
    assert.deepEqual(full.report.summary,{...analytics.report.summary,...publish.report.summary});
    assert.deepEqual(reportVideoIds(full.report),new Set(['psych-video-a','psych-video-b']));
    assert.deepEqual(new Set(f.receiptCalls.flat()),new Set([scopeIds.first,scopeIds.second,scopeIds.pending]));
    f.receiptCalls.length = 0;
  }
});

test('explicit other-project and unknown groups are rejected before any report reads',async t=>{
  const f = await mixedProjectFixture(t);
  let reads = 0;
  const prepare = f.db.prepare;
  f.db.prepare = sql => {reads++;return prepare(sql);};
  for (const view of ['traffic','analytics','publish','full']) {
    for (const [group,user,status] of [
      ['novel',mixedProjectUser,404],
      ['unknown-allowed',mixedProjectUser,404],
      ['unknown-denied',mixedProjectUser,403],
      ['psych-b',{...mixedProjectUser,allowedAccountGroups:['psych-a','novel']},403],
    ]) {
      const query = f.query(view);query.set('group',group);
      await assert.rejects(buildModuleReport(f.env,f.db,f.store,query,user),error=>error.statusCode===status);
    }
  }
  assert.equal(reads,0);
  assert.equal(f.receiptCalls.length,0);
});

test('empty or revoked psychology scope never falls back to another project or unassigned accounts',async t=>{
  const f = await mixedProjectFixture(t);
  async function assertEmpty(store,user) {
    for (const view of ['traffic','analytics','publish','full']) {
      const result = await buildModuleReport(f.env,f.db,store,f.query(view),user);
      assert.equal(result.report.groupId,'');
      if (view === 'traffic') {
        assert.deepEqual(result.traffic.accounts,[]);
        assert.equal(result.traffic.summary.totalAccounts,0);
        assert.equal(result.traffic.summary.videoViews,null);
        assert.equal(result.traffic.summary.profileViews,null);
      } else if (view !== 'publish') {
        assert.equal(result.report.summary.published,0);
        assert.equal(result.report.summary.accountCount,0);
        assert.equal(result.report.summary.views,0);
        assert.deepEqual(reportVideoIds(result.report),new Set());
      }
      if (view === 'publish' || view === 'full') assert.equal(result.report.summary.publishTotal,0);
    }
    assert.equal(f.receiptCalls.length,0);
  }
  await assertEmpty(f.store,{...mixedProjectUser,allowedAccountGroups:[]});
  await assertEmpty(f.store,{...mixedProjectUser,allowedAccountGroups:['novel']});
  f.sqlite.prepare("DELETE FROM official_account_assignments WHERE group_id IN ('psych-a','psych-b')").run();
  await assertEmpty(await loadGroupStore(f.db),mixedProjectUser);
});
