import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { handleAutopilotDashboard, dashboardWindow } from './psychology-autopilot-dashboard.js';
import { handlePsychologyAutopilot } from './psychology-autopilot.js';
import { librarySource } from './psychology-copy-source.js';
import { copyIdentity, variantPlan } from './psychology-creative.js';
const DAY = 86400000, now = Date.parse('2026-10-01T02:00:00Z');
const actor = { username: 'admin', role: 'admin', sidebarModules: ['psychology-autopilot'] };
async function setup(t) {
  const f = await fixture(t);
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Dashboard must not call network');});
  f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json=? WHERE username='admin'").run(JSON.stringify(['psychology-autopilot','psychology-publish']));
  return f;
}
function assign(f, ids, group = 'g') {
  for (const id of ids) f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,group);
}
function fact(f, id, overrides = {}) {
  const value = { id, batch_id:'batch', account_key:'tiktok:a', media:'photo', schedule_at:now-DAY*4,
    published_at:now-DAY*4, source:'source', variant:'', style:'classic', copy_hash:'hash', title:'Fixed version', state:'published',views:100,completion:0.2,...overrides };
  const keys = Object.keys(value);
  f.sqlite.prepare('INSERT INTO ops_task_facts(' + keys.join(',') + ') VALUES(' + keys.map(()=>'?').join(',') + ')').run(...keys.map(k=>value[k]));
}
async function read(f, query='', user=actor, status=200) {
  const url = new URL('https://factory.test/api/psychology-autopilot/dashboard?' + query);
  const response = await handleAutopilotDashboard(new Request(url),f.env,url,user,{now});
  const data = await response.json();
  assert.equal(response.status,status,JSON.stringify(data));
  return data;
}
test('dashboard counts complete canonical psychology population and pages independently of plans, unsynced or missing metrics', async t => {
  const f = await setup(t), ids = Array.from({length:25},(_,i)=>'account'+i);
  assign(f,ids);assign(f,['outside'],'other');
  fact(f,'hidden',{account_key:'tiktok:outside',views:999999,source:'private'});
  const a=await read(f,'view=accounts');
  assert.equal(a.summary.projectAccounts,25);
  assert.equal(a.details.total,25);
  assert.equal(a.details.rows.length,10);
  assert.equal(a.accountPools.find(r=>r.id==='observing').accounts,25);
  assert.equal(a.summary.mature.n,0);
  assert.equal(a.summary.mature.medianViews,null);
  assert.equal(a.summary.mature.potentialRate,null);
  const b=await read(f,'view=accounts&page=3');
  assert.equal(b.details.rows.length,5);
  assert.ok(!JSON.stringify(b).includes('private'));
  assert.equal(f.requests.length,0);
});
test('dashboard separates Pacific actual publication and planned cohorts and preserves zero versus missing mature metrics',async t=>{
  const f=await setup(t), w=dashboardWindow(now);
  assign(f,['a','b']);
  assert.equal(w.operatingDate,'2026-09-30');
  fact(f,'late',{schedule_at:w.todayStart-DAY,published_at:w.todayStart+1000,views:0});
  fact(f,'plan',{account_key:'tiktok:b',schedule_at:w.todayStart+1000,published_at:0,state:'pending',views:null});
  fact(f,'zero',{published_at:now-72*3600000,views:0,completion:0});
  fact(f,'missing',{views:null,completion:null});
  fact(f,'fresh',{published_at:now-72*3600000+1,views:100000});
  const r=await read(f,'view=content');
  assert.equal(r.summary.today.published,1);
  assert.equal(r.summary.today.planned,1);
  assert.equal(r.summary.today.scheduledPublished,0);
  assert.equal(r.summary.mature.n,1);
  assert.equal(r.summary.mature.medianViews,0);
  assert.equal(r.summary.mature.potentialRate,0);
  assert.equal(r.summary.mature.completion,0);
  assert.equal(r.contentProgress.reserved,1);
  assert.equal(r.contentProgress.waiting,2);
  assert.equal(r.contentProgress.missingMetrics,1);
  assert.equal(r.contentProgress.mature,1);
});
test('dashboard validates methods and stale user/module authorization before returning observations',async t=>{
  const f=await setup(t);
  assign(f,['a']);
  await read(f,'',null,401);
  f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]' WHERE username='admin'").run();
  await read(f,'',actor,403);
  f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json=? WHERE username='admin'").run(JSON.stringify(['psychology-autopilot']));
  await read(f,'view=unknown',actor,400);
  const url=new URL('https://factory.test/api/psychology-autopilot/dashboard');
  const r=await handleAutopilotDashboard(new Request(url,{method:'POST'}),f.env,url,actor,{now});
  assert.equal(r.status,405);
});

test('canonical aliases deduplicate accounts and moved primary assignments defeat stale aliases and historical pilot access',async t=>{
  const f=await setup(t);
  await f.db.prepare("UPDATE factory_kv SET value_json=json_set(value_json,'$.aliases',json(?)) WHERE key='official-account-groups'")
    .bind(JSON.stringify({alpha:'a'})).run();
  assign(f,['a','alpha','b']);
  f.sqlite.prepare("INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES('tiktok:a','@alpha',?,0)")
    .run(JSON.stringify({username:'alpha'}));
  fact(f,'visible');
  fact(f,'hidden-pilot',{pilot_id:'foreign',group_id:'other',source:'private-pilot',views:999999});
  let r=await read(f,'view=accounts');
  assert.equal(r.summary.projectAccounts,2);
  assert.equal(r.summary.mature.n,1);
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
  r=await read(f,'view=accounts');
  assert.equal(r.summary.projectAccounts,1);
  assert.equal(r.summary.mature.n,0);
  assert.ok(!JSON.stringify(r).includes('private-pilot'));
  await read(f,'view=accounts&account=a',actor,404);
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
  await read(f,'view=content');
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
});
test('current role waits for effective time and cycle state while future roles and explicit pauses remain separate',async t=>{
  const f=await setup(t);assign(f,['a','b']);
  f.sqlite.prepare(`INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,starts_at,ends_at,next_review_at,created_at,updated_at,time_zone)
    VALUES('policy','proj-psych','admin',1,?,?,?,0,0,'America/Los_Angeles')`).run(now-DAY,now+6*DAY,now+2*DAY);
  f.sqlite.prepare(`INSERT INTO psychology_task_group_accounts(policy_id,connection_id,first_seen_at,enrolled,group_id,updated_at)
    VALUES('policy','a',?,1,'g',?)`).run(now-DAY,now);
  const snapshot=f.sqlite.prepare("INSERT INTO psychology_task_group_snapshots(policy_id,connection_id,effective_at,revision,role,account_pool,group_id) VALUES('policy',?,?,?,?,?,'g')");
  snapshot.run('a',now-DAY,1,'normal','normal');
  snapshot.run('a',now+DAY,2,'review','normal');
  snapshot.run('b',now+DAY,2,'launch','observing');
  f.sqlite.prepare("INSERT INTO psychology_autopilots(id,owner,group_id,group_name,strategy,slots_json,status,ends_at,created_at,updated_at) VALUES('source','admin','g','G','evolve','[]','active',?,0,?)").run(now+DAY,now);
  f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES('source','a','paused','manual',?)").run(now);
  const r=await read(f,'view=accounts');
  const a=r.details.rows.find(r=>r.connectionId==='a'),b=r.details.rows.find(r=>r.connectionId==='b');
  assert.equal(a.currentRole,'normal');assert.equal(a.futureRole,'review');
  assert.equal(a.futureEffectiveAt,now+DAY);assert.equal(a.paused,true);
  assert.equal(b.currentRole,null);assert.equal(b.futureRole,'launch');
  assert.equal(r.summary.enrolledAccounts,1);assert.equal(r.summary.pausedAccounts,1);
  f.sqlite.prepare("UPDATE psychology_task_group_policies SET starts_at=?").run(now+1000);
  const inactive=await read(f,'view=accounts');
  assert.ok(inactive.details.rows.every(r=>r.currentRole===null));
});
test('exact content qualification requires five distinct mature accounts and separates pending, maturity, synchronization and style evidence',async t=>{
  const f=await setup(t);assign(f,['a','b','c','d','e']);
  for(const account of ['a','b','c','d','e']) fact(f,'winner-'+account,{account_key:'tiktok:'+account,variant:'winner',views:500});
  for(let i=0;i<5;i++) fact(f,'same-'+i,{variant:'one-account',views:9999});
  fact(f,'fresh',{variant:'winner',account_key:'tiktok:b',published_at:now-1000,views:99999});
  fact(f,'missing',{variant:'winner',account_key:'tiktok:c',views:null,completion:null});
  fact(f,'reserved',{variant:'winner',account_key:'tiktok:d',published_at:0,schedule_at:now+10*DAY,state:'pending',views:null});
  fact(f,'different-style',{variant:'winner',style:'soft',views:99999});
  fact(f,'edited-copy',{variant:'winner',copy_hash:'new-hash',views:99999});
  const r=await read(f,'view=content');
  assert.equal(r.summary.winnerVersions,1);
  assert.equal(r.summary.eligibleWinnerVersions,0);
  const winner=r.details.rows.find(r=>r.version==='winner'&&r.style==='classic'&&r.copyHash==='hash');
  assert.equal(winner.pool,'winner');assert.equal(winner.stats.n,5);assert.equal(winner.distinctAccounts,5);
  assert.equal(winner.published,7);assert.equal(winner.waiting,1);assert.equal(winner.missingMetrics,1);assert.equal(winner.reserved,1);
  assert.equal(winner.eligible,false);
  assert.equal(r.details.rows.find(r=>r.version==='one-account').pool,'explore');
  const exact='view=content&source=source&variant=winner&style=classic&copyHash=hash&styleRevision=0';
  const detail=await read(f,exact);
  assert.equal(detail.details.total,1);assert.equal(detail.linkedAccounts.total,5);
  assert.equal(detail.linkedAccounts.rows.length,5);
  assert.equal(detail.details.rows[0].stats.n,5);
  const account=await read(f,'view=accounts&account=a');
  assert.equal(account.details.total,1);assert.ok(account.matchedVersions.rows.some(r=>r.version==='winner'));
  await read(f,exact.replace('copyHash=hash','copyHash=private'),actor,404);
});
test('current inventory eligibility verifies exact text hash, approval, owner and active style revision without promoting old evidence',async t=>{
  const f=await setup(t);assign(f,['a','b','c','d','e']);
  const row={title:'A useful fixed title',caption:'caption',pages_json:JSON.stringify(['First page','Second page'])};
  const hash=(await copyIdentity(variantPlan(row))).hash;
  f.sqlite.prepare(`INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at)
    VALUES('v','admin','version','source',?,?,?,'fingerprint',0)`).run(row.title,row.caption,row.pages_json);
  for(const account of ['a','b','c','d','e']) fact(f,'item-'+account,{account_key:'tiktok:'+account,variant:'version',copy_hash:hash,views:500});
  let r=await read(f,'view=content');
  assert.equal(r.summary.winnerVersions,1);assert.equal(r.summary.eligibleWinnerVersions,1);
  assert.equal(r.details.rows[0].eligible,true);assert.match(r.details.rows[0].qualificationReason,/优胜/);
  f.sqlite.prepare("UPDATE psychology_copy_variants SET title='Modified title'").run();
  r=await read(f,'view=content');
  assert.equal(r.summary.winnerVersions,1);assert.equal(r.summary.eligibleWinnerVersions,0);
  assert.match(r.details.rows[0].eligibilityReason,/修改/);
  f.sqlite.prepare("UPDATE psychology_copy_variants SET title=?,review_status='pending',enabled=0").run(row.title);
  r=await read(f,'view=content');
  assert.equal(r.summary.eligibleWinnerVersions,0);assert.match(r.details.rows[0].eligibilityReason,/待审核/);
  f.sqlite.prepare("UPDATE psychology_copy_variants SET review_status='approved',enabled=1,owner='other'").run();
  r=await read(f,'view=content');
  assert.equal(r.summary.eligibleWinnerVersions,0);
  f.sqlite.prepare("UPDATE psychology_copy_variants SET owner='admin'").run();
  f.sqlite.prepare("INSERT INTO psychology_managed_styles(owner,id,definition_json,enabled,revision,created_at,updated_at) VALUES('admin','classic','{}',1,1,0,0)").run();
  r=await read(f,'view=content');
  assert.equal(r.summary.eligibleWinnerVersions,0);assert.match(r.details.rows[0].eligibilityReason,/修订/);
});
test('Pacific daily windows follow DST calendar boundaries',()=>{
  const spring=dashboardWindow(Date.parse('2026-03-08T20:00:00Z'));
  const autumn=dashboardWindow(Date.parse('2026-11-01T20:00:00Z'));
  assert.equal(spring.todayEnd-spring.todayStart,23*3600000);
  assert.equal(autumn.todayEnd-autumn.todayStart,25*3600000);
});

test('original pool inventory follows photo-only current source selection and exact copy hash',async t=>{
  const f=await setup(t);assign(f,['a','b','c','d','e']);
  const content={title:'Original title',caption:'caption',pages:[{text:'One original page'},{text:'A second page'}]};
  const photo={id:'photo-source',title:content.title,media_type:'photo',source_url:'https://www.tiktok.com/@test/photo/98765432',content_json:JSON.stringify(content),source_json:'{}'};
  const video={id:'video-source',title:'Video title',media_type:'video',source_url:'https://www.tiktok.com/@test/video/98765433',content_json:JSON.stringify({transcript:'A video transcript'}),source_json:'{}'};
  for(const row of [photo,video]) f.sqlite.prepare(`INSERT INTO psychology_copy_library(id,owner,media_type,title,source_url,source_json,status,content_json,created_at,updated_at)
    VALUES(?,'admin',?,?,?,?,'done',?,0,0)`).run(row.id,row.media_type,row.title,row.source_url,row.source_json,row.content_json);
  const photoHash=(await copyIdentity(librarySource(photo,'photo').copyVariant)).hash;
  const videoHash=(await copyIdentity(librarySource(video,'photo').copyVariant)).hash;
  for(const account of ['a','b','c','d','e']){
    fact(f,'photo-'+account,{account_key:'tiktok:'+account,source:'v1:tiktok:98765432',copy_hash:photoHash,views:500});
    fact(f,'video-'+account,{account_key:'tiktok:'+account,source:'v1:tiktok:98765433',copy_hash:videoHash,views:500});
  }
  const r=await read(f,'view=content');
  assert.equal(r.summary.winnerVersions,2);
  assert.equal(r.summary.eligibleWinnerVersions,1);
  assert.equal(r.details.rows.find(r=>r.source==='v1:tiktok:98765432').eligible,true);
  assert.equal(r.details.rows.find(r=>r.source==='v1:tiktok:98765433').eligible,false);
});
test('autopilot dashboard routing returns without directory refresh, queue scan, writes or remote calls',async t=>{
  const f=await setup(t);assign(f,['a','b']);
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
  const url=new URL('https://factory.test/api/psychology-autopilot/dashboard?view=accounts');
  const response=await handlePsychologyAutopilot(new Request(url),f.env,url,{user:actor});
  const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  assert.equal(data.summary.projectAccounts,2);
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(f.requests.length,0);
});

test('another authorized admin sees actual project controller roles and inventory while foreign project facts stay excluded',async t=>{
  const f=await setup(t);assign(f,['a','b','c','d','e']);assign(f,['private-account'],'other');
  f.sqlite.prepare(`INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at)
    VALUES('viewer','viewer','admin','','',?,0,0)`).run(JSON.stringify(['psychology-autopilot']));
  f.sqlite.prepare(`INSERT INTO psychology_task_group_policies(id,project_key,owner,enabled,starts_at,ends_at,next_review_at,created_at,updated_at,time_zone)
    VALUES('policy','proj-psych','admin',1,?,?,?,0,0,'America/Los_Angeles')`).run(now-DAY,now+6*DAY,now+2*DAY);
  f.sqlite.prepare("INSERT INTO psychology_task_group_snapshots(policy_id,connection_id,effective_at,revision,role,account_pool,group_id) VALUES('policy','a',?,1,'review','normal','g')").run(now-DAY);
  const row={title:'Shared controlled content',caption:'caption',pages_json:JSON.stringify(['First page','Second page'])};
  const hash=(await copyIdentity(variantPlan(row))).hash;
  f.sqlite.prepare(`INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at)
    VALUES('v','admin','version','source',?,?,?,'fingerprint',0)`).run(row.title,row.caption,row.pages_json);
  for(const account of ['a','b','c','d','e']) fact(f,'shared-'+account,{account_key:'tiktok:'+account,variant:'version',copy_hash:hash,views:500});
  fact(f,'private',{account_key:'tiktok:private-account',source:'private-source',views:999999});
  fact(f,'foreign-pilot',{pilot_id:'foreign',group_id:'other',source:'foreign-pilot-source',views:999999});
  const viewer={username:'viewer',role:'admin',sidebarModules:['psychology-autopilot']};
  const accounts=await read(f,'view=accounts',viewer);
  assert.equal(accounts.summary.projectAccounts,5);
  assert.equal(accounts.details.rows.find(r=>r.connectionId==='a').currentRole,'review');
  const content=await read(f,'view=content',viewer);
  assert.equal(content.summary.eligibleWinnerVersions,1);
  assert.equal(content.details.total,1);
  assert.ok(!JSON.stringify(content).includes('private-source'));
  assert.ok(!JSON.stringify(content).includes('foreign-pilot-source'));
  assert.equal(f.requests.length,0);
});


test('seven-day account traffic uses actual Pacific publications, includes fresh metrics and preserves missing versus zero',async t=>{
  const f=await setup(t),w=dashboardWindow(now);assign(f,['a','b','c']);
  for(let i=0;i<5;i++)fact(f,'fresh-seven-'+i,{published_at:i===0?w.trafficStart:now-1000, schedule_at:w.trafficStart-DAY, views:500});
  fact(f,'missing-seven',{published_at:now-2000,views:null});
  fact(f,'outside-seven',{published_at:w.trafficStart-1,views:999999});
  fact(f,'future-seven',{published_at:now+1,views:999999});
  fact(f,'pending-seven',{published_at:0,schedule_at:now,state:'pending',views:999999});
  for(let i=0;i<5;i++)fact(f,'zero-seven-'+i,{account_key:'tiktok:b',published_at:now-1000,views:0});
  const r=await read(f,'view=accounts');
  const a=r.details.rows.find(x=>x.connectionId==='a'),b=r.details.rows.find(x=>x.connectionId==='b'),c=r.details.rows.find(x=>x.connectionId==='c');
  assert.deepEqual(a.traffic,{published:6,synced:5,views:2500,medianViews:500});
  assert.equal(a.trafficTier,'strong');assert.equal(a.stats.n,2,'only the boundary and old excluded traffic sample enter mature policy evidence');
  assert.deepEqual(b.traffic,{published:5,synced:5,views:0,medianViews:0});assert.equal(b.trafficTier,'weak');
  assert.deepEqual(c.traffic,{published:0,synced:0,views:null,medianViews:null});assert.equal(c.trafficTier,'observing');
  assert.equal(r.trafficSummary.published,11);assert.equal(r.trafficSummary.synced,10);assert.equal(r.trafficSummary.views,2500);
  assert.equal(r.trafficPolicy.from,'2026-09-24');assert.equal(r.trafficPolicy.to,'2026-09-30');
});

test('traffic thresholds need five observed posts and rank paginated accounts by total views with stable ties',async t=>{
  const f=await setup(t);assign(f,Array.from({length:25},(_,i)=>'a'+String(i).padStart(2,'0')));
  for(let i=0;i<5;i++){
    fact(f,'strong-'+i,{account_key:'tiktok:a01',views:500,published_at:now-1000});
    fact(f,'normal-'+i,{account_key:'tiktok:a02',views:200,published_at:now-1000});
    fact(f,'weak-'+i,{account_key:'tiktok:a03',views:199,published_at:now-1000});
    fact(f,'partial-'+i,{account_key:'tiktok:a04',views:i===4?null:9999,published_at:now-1000});
  }
  const all=await read(f,'view=accounts');
  assert.equal(all.details.rows[0].connectionId,'a04','higher total views first, insufficient samples stay observing');
  assert.equal(all.details.rows[0].trafficTier,'observing');
  assert.equal(all.details.rows[1].connectionId,'a01');assert.equal(all.details.rows[2].connectionId,'a02');
  assert.equal(all.trafficTiers.find(x=>x.id==='weak').accounts,1);
  const middle=await read(f,'view=accounts&trafficTier=normal');assert.equal(middle.details.total,1);assert.equal(middle.details.rows[0].connectionId,'a02');
  const third=await read(f,'view=accounts&page=3');assert.equal(third.details.rows.length,5);assert.equal(third.details.total,25);
  assert.equal(new Set([...all.details.rows,...third.details.rows].map(x=>x.account)).size,15);
  await read(f,'view=accounts&trafficTier=rescue-content',actor,400);await read(f,'view=accounts&page=1.2',actor,400);
});

test('followers and UTC profile visits retain unknown values, explicit zero and partial coverage without inventing conversions',async t=>{
  const f=await setup(t);assign(f,['a','b','c','d']);assign(f,['private'],'other');
  const insert=f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json) VALUES(?,?)');
  insert.run('tiktok:a',JSON.stringify({followers:1000,insights:{_daily_traffic:{days:[
    {date:'2026-09-25',profileViews:99},{date:'2026-09-25',profileViews:0},{date:'2026-09-30',profileViews:8},
    {date:'2026-10-01',profileViews:4},{date:'2026-09-24',profileViews:999},{date:'2026-10-02',profileViews:999},
    {date:'2026-09-26',profileViews:null},{date:'2026-09-27',profileViews:'55'},{date:'2026-09-28',profileViews:-1}
  ]}}}));
  insert.run('tiktok:b',JSON.stringify({followerCount:0,insights:{_daily_traffic:{days:[{date:'2026-10-01',profileViews:0}]}}}));
  insert.run('tiktok:d',JSON.stringify({followers:-1}));
  insert.run('tiktok:private',JSON.stringify({followers:99999,insights:{_daily_traffic:{days:[{date:'2026-10-01',profileViews:99999}]}}}));
  const r=await read(f,'view=accounts'),a=r.details.rows.find(x=>x.connectionId==='a'),b=r.details.rows.find(x=>x.connectionId==='b'),c=r.details.rows.find(x=>x.connectionId==='c');
  assert.equal(a.followers,1000);assert.equal(a.conversionCandidate,true);assert.deepEqual(a.profileTraffic,{views:12,days:3,expectedDays:7,timeZone:'UTC'});
  assert.equal(b.followers,0);assert.equal(b.conversionCandidate,false);assert.equal(b.profileTraffic.views,0);
  assert.equal(c.followers,null);assert.equal(c.conversionCandidate,null);assert.equal(c.profileTraffic.views,null);assert.equal(c.profileTraffic.days,0);
  assert.equal(r.details.rows.find(x=>x.connectionId==='d').followers,null);
  assert.equal(r.trafficSummary.profileViews,12);assert.equal(r.trafficSummary.conversionCandidates,1);assert.equal(r.trafficSummary.followersKnown,2);
  assert.equal(r.trafficPolicy.profileFrom,'2026-09-25');assert.equal(r.trafficPolicy.profileTo,'2026-10-01');
  assert.match(r.basis.profileTraffic,/不是站内/);assert.ok(!JSON.stringify(r).includes('99999'));
  f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
  const revoked=await read(f,'view=accounts');assert.equal(revoked.trafficSummary.profileViews,0);assert.equal(revoked.trafficSummary.conversionCandidates,0);
});

test('seven Pacific calendar days include DST transitions without sliding the start by one hour',()=>{
  const spring=dashboardWindow(Date.parse('2026-03-08T20:00:00Z')),autumn=dashboardWindow(Date.parse('2026-11-01T20:00:00Z'));
  assert.equal(spring.trafficFrom,'2026-03-02');assert.equal(spring.todayEnd-spring.trafficStart,167*3600000);
  assert.equal(autumn.trafficFrom,'2026-10-26');assert.equal(autumn.todayEnd-autumn.trafficStart,169*3600000);
});


test('all content pools expose exact scoped work links, maturity and independent evidence paging without writes',async t=>{
 const f=await setup(t);assign(f,['a','b']);assign(f,['outside'],'other');
 f.sqlite.prepare("INSERT INTO official_accounts_latest(account_key,label,profile_json,synced_at) VALUES('tiktok:a','Alpha',?,0)").run(JSON.stringify({username:'alpha'}));
 const addVideo=f.sqlite.prepare('INSERT INTO ops_video_facts(account_key,video_id,synced_at,share) VALUES(?,?,0,?)');
 for(let i=0;i<12;i++){
  const video=String(7000000000000000000n+BigInt(i));
  fact(f,'e'+i,{video_id:video,published_at:now-DAY*4+i,views:i===0?0:i===1?null:200});
  addVideo.run('tiktok:a',video,i===0?'https://www.tiktok.com/@alpha/photo/'+video:i===1?'javascript:alert(1)':'');
 }
 fact(f,'fresh-evidence',{published_at:now-1000,video_id:'123',views:5});
 fact(f,'reservation',{state:'pending',published_at:0,video_id:'456',views:null});
 fact(f,'private-evidence',{account_key:'tiktok:outside',video_id:'999'});
 fact(f,'other-revision',{copy_hash:'edited',video_id:'888'});
 fact(f,'failed-evidence',{state:'failed',video_id:'777'});
 const query='view=content&source=source&style=classic&copyHash=hash&styleRevision=0';
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 const first=await read(f,query),second=await read(f,query+'&evidencePage=2');
 assert.equal(first.evidence.total,14);assert.equal(first.evidence.rows.length,10);assert.equal(second.evidence.rows.length,4);
 assert.equal(second.details.total,1);assert.equal(second.details.rows.length,1,'work paging must not page away the selected version');
 assert.equal(first.evidence.rows[0].status,'waiting');
 const rows=[...first.evidence.rows,...second.evidence.rows];
 assert.equal(new Set(rows.map(r=>r.id)).size,14);
 assert.equal(rows.find(r=>r.id==='e0').views,0);assert.equal(rows.find(r=>r.id==='e0').status,'mature');
 assert.equal(rows.find(r=>r.id==='e1').status,'missingMetrics');
 assert.match(rows.find(r=>r.id==='e1').url,/^https:\/\/www\.tiktok\.com\/@alpha\/photo\//);
 assert.equal(rows.find(r=>r.id==='reservation').url,null);assert.equal(rows.find(r=>r.id==='reservation').status,'reserved');
 assert.ok(rows.every(r=>!['private-evidence','other-revision','failed-evidence'].includes(r.id)));
 f.sqlite.prepare("UPDATE official_accounts_latest SET profile_json='{}' WHERE account_key='tiktok:a'").run();
 const noHandle=await read(f,query+'&evidencePage=2');
 assert.equal(noHandle.evidence.rows.find(r=>r.id==='e1').url,null);
 const after=f.sqlite.prepare('SELECT total_changes() n').get().n;assert.equal(after,before+1);
 await read(f,query+'&evidencePage=0',actor,400);
 f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='a'").run();
 await read(f,query,actor,404);
 assert.equal(f.requests.length,0);
});
