import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);

test("archive ingest upserts batches and only deletes named accounts", async () => {
  const [store, storage, index, official, novels] = await Promise.all([
    readFile(new URL("official-archive-store.js", root), "utf8"),
    readFile(new URL("factory-storage.js", root), "utf8"),
    readFile(new URL("index.js", root), "utf8"),
    readFile(new URL("official.js", root), "utf8"),
    readFile(new URL("novels.js", root), "utf8"),
  ]);
  assert.match(store, /export async function upsertOfficialAccounts/);
  assert.match(store, /export async function deleteOfficialAccounts/);
  assert.match(store, /export async function applyOfficialArchivePush/);
  assert.match(store, /export async function loadArchiveViewsByVideoIds/);
  assert.match(store, /official_videos_latest WHERE video_id IN/);
  assert.match(store, /refreshArchiveMeta/);
  assert.match(store, /COALESCE\(SUM\(video_count\), 0\)/);
  assert.doesNotMatch(store, /filter\(\(key\) => !keep\.has\(key\)\)/);
  assert.doesNotMatch(store, /prepare\("DELETE FROM official_videos_latest"\)/);
  assert.doesNotMatch(index, /refreshOfficialArchive/);
  assert.doesNotMatch(index, /official-archive-prefetch/);
  assert.match(storage, /\/api\/integrations\/signal-desk\/archive-accounts/);
  assert.match(storage, /applyOfficialArchivePush/);
  assert.match(official, /不会删除已有账号/);
  assert.match(official, /listAccountDirectory/);
  assert.doesNotMatch(official, /for \(let page = 0; page < 50;/);
  assert.doesNotMatch(official, /json_extract\(profile_json/);
  assert.doesNotMatch(store, /backfillAccountMetricsFromD1/);
  assert.match(store, /SELECT account_key, label, synced_at, video_count, views/);
  assert.doesNotMatch(store, /json_extract\(profile_json/);
  assert.match(official, /\/api\/v1\/publish\/stats/);
  assert.match(official, /chunkList\(connectionIds, 80\)/);
  assert.match(official, /attachPublishOutcome/);
  assert.match(novels, /hydrateOfficialPublishRecords/);
  assert.match(novels, /skipResolved: true/);
  assert.match(novels, /forceRefresh && archiveAge > 6 \* 60 \* 60 \* 1000/);
  assert.match(novels, /waitUntil/);
  assert.match(novels, /listPublishRecords/);
  assert.doesNotMatch(novels, /if \(!meta\.accountCount \|\| archiveAge/);
  assert.doesNotMatch(official, /persistProjectOpsSnapshots/);
  assert.match(official, /skipResolved: true/);
  assert.match(official, /listPublishRecords/);
});

test("factory cloud no longer serves an online asset-usage dashboard", async () => {
  const { pageFileFor } = await import("./pages.js");
  const [compat, index] = await Promise.all([
    readFile(new URL("compat.js", root), "utf8"),
    readFile(new URL("index.js", root), "utf8")
  ]);
  assert.equal(pageFileFor("/asset-usage"), "");
  assert.match(index, /pathname === "\/asset-usage"/);
  assert.doesNotMatch(compat, /applyArchiveViewsToSnapshot/);
  assert.doesNotMatch(compat, /asset-usage-impact\.js/);
  assert.doesNotMatch(compat, /\/api\/asset-usage/);
  assert.doesNotMatch(compat, /kvGet\(db, "asset-usage"/);
  assert.doesNotMatch(compat, /asset-library\.js/);
});

test("directory rows keep list fields without shipping full profile json", async () => {
  const { directoryAccountsFromRows } = await import("./official-archive-store.js");
  const [account] = directoryAccountsFromRows([{
    account_key: "acc-1",
    label: "@demo",
    username: "demo",
    displayName: "Demo",
    video_count: 12,
    synced_at: 100,
    views: 50
  }]);
  assert.equal(account.schema, "acc-1");
  assert.equal(account.profile.username, "demo");
  assert.equal(account.syncedVideoCount, 12);
});

test("account directory keeps live authorized accounts after a normal page reload", async () => {
  const { mergeOfficialAccountDirectory } = await import("./official.js");
  const archived = Array.from({ length: 45 }, (_, index) => ({
    schema: `tiktok:account-${index + 1}`,
    label: `Archived ${index + 1}`,
  }));
  const live = Array.from({ length: 65 }, (_, index) => ({
    schema: `tiktok:account-${index + 1}`,
    connectionId: `account-${index + 1}`,
    label: `Live ${index + 1}`,
  }));
  const merged = mergeOfficialAccountDirectory(archived, live);
  assert.equal(merged.length, 65);
  assert.equal(merged.filter((account) => account.schema === "tiktok:account-1").length, 1);
  assert.equal(merged.at(-1).connectionId, "account-65");
});

async function directoryFixture(t) {
  const {DatabaseSync}=await import('node:sqlite');
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  sqlite.exec('CREATE TABLE factory_kv(key TEXT PRIMARY KEY,value_json TEXT); CREATE TABLE official_account_assignments(account_key TEXT,group_id TEXT); CREATE TABLE official_accounts_latest(account_key TEXT,label TEXT,synced_at INTEGER,video_count INTEGER,views INTEGER);');
  const store={projects:[{id:'proj',name:'Psychology',moduleKey:'psychology'}],groups:[{id:'group',name:'Test',projectId:'proj'}]};
  sqlite.prepare('INSERT INTO factory_kv VALUES(?,?)').run('official-account-groups',JSON.stringify(store));
  for(let i=0;i<65;i++){sqlite.prepare('INSERT INTO official_accounts_latest VALUES(?,?,0,0,0)').run('tiktok:acc-'+i,'@account'+i);sqlite.prepare('INSERT INTO official_account_assignments VALUES(?,?)').run('acc-'+i,'group');}
  const db={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args);},async all(){return{results:sqlite.prepare(sql).all(...args)};}};}};
  const env={DB:db,SIGNAL_DESK_BASE_URL:'https://hub.test',SIGNAL_DESK_BRIDGE_KEY:'synthetic-key'};
  const live=Array.from({length:115},(_,i)=>({schema:'tiktok:acc-'+i,profile:{username:'account'+i}}));
  return {db,env,live};
}

test('directory reads every page to return 115 accounts over the 65 archived accounts',async t=>{
  const {listAllAccounts}=await import('./official.js'),f=await directoryFixture(t);let requests=0;
  t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);requests++;assert.equal(u.searchParams.get('limit'),'100');return Response.json(u.searchParams.get('cursor')?{accounts:f.live.slice(100),hasMore:false}:{accounts:f.live.slice(0,100),hasMore:true,nextCursor:'page-2'});});
  const result=await listAllAccounts(f.env,f.db);assert.equal(result.accounts.length,115);assert.equal(result.directoryComplete,true);assert.equal(result.directoryWarning,'');assert.equal(requests,2);
});

test('bridge failure clearly labels the 65-row archive fallback and logs no upstream body',async t=>{
  const {listAllAccounts}=await import('./official.js'),f=await directoryFixture(t),logs=[];
  t.mock.method(console,'warn',(...args)=>logs.push(args.join(' ')));
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'private upstream diagnostic'},{status:500}));
  const result=await listAllAccounts(f.env,f.db);assert.equal(result.accounts.length,65);assert.equal(result.directoryComplete,false);assert.equal(result.source,'archive-fallback');assert.match(result.directoryWarning,/不代表中台授权总数/);assert.doesNotMatch(JSON.stringify(result)+logs.join(''),/private upstream diagnostic/);assert.match(logs.join(''),/official-directory-fallback/);
});

test('later page failures and invalid cursors never report a complete live directory',async t=>{
  const {listAllAccounts}=await import('./official.js'),f=await directoryFixture(t);t.mock.method(console,'warn',()=>{});
  let brokenCursor=false;
  t.mock.method(globalThis,'fetch',async url=>new URL(url).searchParams.get('cursor')?Response.json({error:'unavailable'},{status:503}):Response.json({accounts:f.live.slice(0,100),hasMore:true,nextCursor:brokenCursor?'':'next'}));
  for(const invalid of [false,true]){brokenCursor=invalid;const result=await listAllAccounts(f.env,f.db);assert.equal(result.accounts.length,100);assert.equal(result.directoryComplete,false);assert.equal(result.source,'archive+partial-live');}
});

test('report archive reads use a bounded pool, enforce scope and avoid read-path repair writes',async()=>{
 const {loadVideosForAccounts}=await import('./official-archive-store.js');
 const keys=Array.from({length:35},(_,i)=>'tiktok:a'+i),reads=[];let active=0,peak=0;
 const store={projects:[{id:'p',name:'Psych',moduleKey:'psychology'}],groups:[{id:'g',name:'Group',projectId:'p'}]};
 const db={prepare(sql){assert.match(sql.trim(),/^SELECT/);return {bind(){return this;},async first(){assert.match(sql,/factory_kv/);return {value_json:JSON.stringify(store)};},async all(){
  if(sql.includes('official_account_assignments'))return {results:keys.map(key=>({account_key:key,group_id:'g'}))};
  if(sql.includes('official_videos_latest'))return {results:[{account_key:keys[34],video_id:'fallback',video_json:'{}',create_time:1}]};
  throw Error('Unexpected query '+sql);
 }};}};
 const env={ARCHIVE:{async get(key){reads.push(key);active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return key.includes('a34')?null:{async json(){return {videos:[{id:key}]};}};},async put(){throw Error('A report must not write archive packs');}}};
 const result=await loadVideosForAccounts(env,db,[...keys,keys[0],'tiktok:outside'],100,{concurrency:24,repair:false});
 assert.equal(reads.length,35);assert.ok(peak>8&&peak<=24);assert.equal(result.size,35);assert.equal(result.has('tiktok:outside'),false);assert.equal(result.get(keys[34])[0].id,'fallback');
});


async function reportProjectionFixture(t){
 const {fixture}=await import('./psychology-cloud-test-fixture.js'),f=await fixture(t);
 f.sqlite.prepare("INSERT INTO official_account_assignments(account_key,group_id,updated_at) VALUES ('a','g',0),('b','g',0)").run();
 const objects=new Map(),reads=[];
 f.env.ARCHIVE={async put(key,value){objects.set(key,JSON.parse(value));},async get(key){reads.push(key);return objects.has(key)?{async json(){return objects.get(key);}}:null;},async delete(key){objects.delete(key);}};
 return {...f,objects,reads};
}
test('archive sync maintains report projections, and hot report reads require no R2 objects',async t=>{
 const f=await reportProjectionFixture(t);
 const {upsertOfficialAccounts,loadReportVideosForAccounts,reportVideoCacheQuery,deleteOfficialAccounts}=await import('./official-archive-store.js');
 const {loadReportContext}=await import('./psychology-report-data.js');
 const make=(stamp,views)=>({schema:'tiktok:a',latestSyncAt:stamp,profile:{username:'alpha',largeUnused:'x'.repeat(1000)},videos:[{id:'v',createTime:stamp/1000,views,likes:0,retention:[{second:3,percentage:50}],analytics:{favorites:2,privateUnused:'must-not-be-in-report'}}]});
 await upsertOfficialAccounts(f.env,f.db,[make(1000000000000,0)]);
 const load=async()=>{const {archived}=await loadReportContext(f.db),rows=(await reportVideoCacheQuery(f.db,archived.map(a=>a.schema)).all()).results;return loadReportVideosForAccounts(f.env,f.db,archived,rows);};
 let result=await load();assert.equal(f.reads.length,0);assert.equal(result.get('tiktok:a')[0].views,0);assert.equal(result.get('tiktok:a')[0].analytics.favorites,2);assert.equal(result.get('tiktok:a')[0].retention[0].percentage,50);
 assert.doesNotMatch(JSON.stringify(result.get('tiktok:a')),/privateUnused|must-not/);
 await upsertOfficialAccounts(f.env,f.db,[make(1000000001000,99)]);result=await load();assert.equal(result.get('tiktok:a')[0].views,99);assert.equal(f.reads.length,0);
 await deleteOfficialAccounts(f.env,f.db,['tiktok:a']);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM official_report_video_cache').get().n,0);
});
test('legacy report projection fills once and stale fallback cannot overwrite a newer sync',async t=>{
 const f=await reportProjectionFixture(t);
 const {upsertOfficialAccounts,loadReportVideosForAccounts,reportVideoCacheQuery}=await import('./official-archive-store.js');
 const {loadReportContext}=await import('./psychology-report-data.js');
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:1000,videos:[{id:'v',createTime:1,views:7}]}]);
 f.sqlite.exec('DELETE FROM official_report_video_cache');
 const {archived}=await loadReportContext(f.db);
 assert.equal((await loadReportVideosForAccounts(f.env,f.db,archived,[])).get('tiktok:a')[0].views,7);assert.equal(f.reads.length,1);
 const rows=(await reportVideoCacheQuery(f.db,['tiktok:a']).all()).results;
 await loadReportVideosForAccounts(f.env,f.db,archived,rows);assert.equal(f.reads.length,1);
 const oldPack=structuredClone([...f.objects.values()][0]);
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:2000,videos:[{id:'v',createTime:1,views:42}]}]);
 f.objects.set([...f.objects.keys()][0],oldPack);
 await loadReportVideosForAccounts(f.env,f.db,archived,[]);
 const current=f.sqlite.prepare('SELECT * FROM official_report_video_cache').get();assert.equal(current.synced_at,2000);assert.equal(JSON.parse(current.videos_json)[0].views,42);
});
test('report context honors empty canonical assignments and rejects removed group access even with cached data',async t=>{
 const f=await reportProjectionFixture(t),{upsertOfficialAccounts}=await import('./official-archive-store.js');
 const {loadReportContext}=await import('./psychology-report-data.js');
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:1000,videos:[]}]);
 f.sqlite.exec('DELETE FROM official_account_assignments');
 assert.equal((await loadReportContext(f.db)).archived.length,0);
 const {handlePsychologyOperations}=await import('./psychology-operations.js'),url=new URL('https://factory.test/api/psychology-operations?group=g');
 const response=await handlePsychologyOperations(new Request(url),f.env,url,{user:{role:'operator',sidebarModules:['psychology-ops-report'],allowedAccountGroups:[]}});
 assert.equal(response.status,403);assert.equal(f.reads.length,0);
});
test('operations warm path makes one aggregate batch read and never re-fetches raw archive packs',async t=>{
 const f=await reportProjectionFixture(t),{upsertOfficialAccounts}=await import('./official-archive-store.js');
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:Date.now(),videos:[{id:'v',createTime:Date.now()/1000,views:10}]}]);
 let batches=0;const original=f.db.batch.bind(f.db);f.db.batch=async q=>{batches++;return original(q);};
 const {handlePsychologyOperations}=await import('./psychology-operations.js'),url=new URL('https://factory.test/api/psychology-operations');
 const response=await handlePsychologyOperations(new Request(url),f.env,url,{user:{role:'admin',sidebarModules:['psychology-ops-report']}});
 assert.equal(response.status,200,await response.text());assert.equal(batches,1);assert.equal(f.reads.length,0);assert.match(response.headers.get('server-timing'),/total;dur=/);
});

test('data overview reuses synchronized D1 projections without per-account object reads and keeps its scope',async t=>{
 const f=await reportProjectionFixture(t);
 const {upsertOfficialAccounts,loadVideosForAccounts,listLatestArchiveAccounts}=await import('./official-archive-store.js');
 const {loadArchiveBundle}=await import('./ops-report-store.js');
 const {computeGroupReport}=await import('../../scripts/official-group-report.js');
 const now=Date.now(),videos=Array.from({length:90},(_,i)=>({id:'video'+i,createTime:Math.floor(now/1000)-i,title:'Post '+i,views:i*50,likes:i,comments:0,shareLink:'https://www.tiktok.com/@test/video/'+i}));
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:now,videos},{schema:'tiktok:b',latestSyncAt:now,videos:[{id:'other',createTime:now,views:999}]}]);
 const raw=await loadVideosForAccounts(f.env,f.db,['tiktok:a'],80);f.reads.length=0;
 const rows=await listLatestArchiveAccounts(f.db),cached=await loadArchiveBundle(f.env,f.db,['tiktok:a'],rows);
 assert.equal(f.reads.length,0);assert.equal(cached.accountRows.length,1);assert.equal(cached.videosByAccount.has('tiktok:b'),false);assert.equal(cached.videosByAccount.get('tiktok:a').length,80);
 const scoped=list=>list.map(v=>({...v,account:'tiktok:a',username:'a'}));
 assert.deepEqual(computeGroupReport({videos:scoped(cached.videosByAccount.get('tiktok:a')),now}),computeGroupReport({videos:scoped(raw.get('tiktok:a')),now}));
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:now+1,videos:[{id:'new',createTime:now,views:5}]}]);
 assert.equal((await loadArchiveBundle(f.env,f.db,['tiktok:a'])).videosByAccount.get('tiktok:a')[0].views,5);assert.equal(f.reads.length,0);
});

test('windowed shared overview matches the full latest-80 report, including boundaries and corrupt cache fallback',async t=>{
 const f=await reportProjectionFixture(t);
 const {upsertOfficialAccounts,listLatestArchiveAccounts,reportVideoCacheQuery}=await import('./official-archive-store.js');
 const {loadArchiveBundle}=await import('./ops-report-store.js');
 const {computeGroupReport,resolveReportWindow}=await import('../../scripts/official-group-report.js');
 const now=Date.parse('2026-09-26T04:00:00Z'),day=Date.parse('2026-09-25T16:00:00Z');
 const videos=Array.from({length:100},(_,i)=>({id:String(i),createTime:day/1000+(i%5===0?-1:i),views:i*100}));
 videos[1].createdAt=day;videos[2].createdAt=day+86400000;videos[3].createdAt=String(day);videos[4].createdAt='';
 await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:a',latestSyncAt:now,videos}]);
 const rows=await listLatestArchiveAccounts(f.db),full=await loadArchiveBundle(f.env,f.db,['tiktok:a'],rows);
 for(const period of ['today','yesterday','7d','30d']){
  const window=resolveReportWindow({period,now});
  const filtered=await loadArchiveBundle(f.env,f.db,['tiktok:a'],rows,window);
  assert.deepEqual(computeGroupReport({videos:filtered.videosByAccount.get('tiktok:a'),period,now}),computeGroupReport({videos:full.videosByAccount.get('tiktok:a'),period,now}));
  const payload=(await reportVideoCacheQuery(f.db,['tiktok:a'],window).all()).results[0].videos_json;
  assert.ok(JSON.parse(payload).every(v=>full.videosByAccount.get('tiktok:a').some(original=>original.id===v.id)));
 }
 assert.equal(f.reads.length,0);
 f.sqlite.prepare("UPDATE official_report_video_cache SET videos_json='invalid' WHERE account_key='tiktok:a'").run();
 const fallback=await loadArchiveBundle(f.env,f.db,['tiktok:a'],rows,resolveReportWindow({period:'today',now}));
 assert.equal(f.reads.length,1);assert.equal(fallback.videosByAccount.get('tiktok:a').length,80);
});

test('split overview preserves totals and permissions while publish-only skips archives and bounds bridge concurrency',async t=>{
 const f=await reportProjectionFixture(t);
 const {buildModuleReport,loadGroupStore}=await import('./official.js');
 const {kvSet}=await import('./kv.js');
 const {upsertOfficialAccounts}=await import('./official-archive-store.js');
 const ids=Array.from({length:250},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 const store={projects:[{id:'p',name:'Psych',moduleKey:'psychology',reportEnabled:true}],groups:[{id:'g1',name:'One',projectId:'p'},{id:'g2',name:'Two',projectId:'p'}]};
 await kvSet(f.db,'official-account-groups',store);
 f.sqlite.exec('DELETE FROM official_account_assignments');
 for(const [i,id] of ids.entries())f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id,updated_at) VALUES (?,?,0)').run(id,i<180?'g1':'g2');
 const now=Date.now();await upsertOfficialAccounts(f.env,f.db,[{schema:'tiktok:'+ids[0],latestSyncAt:now,videos:[{id:'v',createTime:now,views:777}]}]);
 let calls=[],active=0,peak=0,fail=false;
 t.mock.method(console,'warn',()=>{});
 t.mock.method(globalThis,'fetch',async url=>{
  assert.match(String(url),/\/api\/v1\/publish\/stats\?/);const ids=new URL(url).searchParams.get('connectionIds').split(',');calls.push(ids);
  active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;
  return fail?Response.json({error:'failed'},{status:503}):Response.json({total:ids.length,success:ids.length-1,failed:1,riskAccounts:0});
 });
 const current=await loadGroupStore(f.db),params=view=>new URLSearchParams({module:'psychology',period:'today',view});
 const analytics=await buildModuleReport(f.env,f.db,current,params('analytics'),{role:'admin'});
 assert.equal(calls.length,0);assert.equal(analytics.report.summary.views,777);assert.equal(analytics.report.summary.publishTotal,null);
 const original=f.db.prepare;f.db.prepare=sql=>{assert.doesNotMatch(sql,/official_report_video_cache|official_videos_latest/);return original(sql);};
 const publish=await buildModuleReport(f.env,f.db,current,params('publish'),{role:'admin'});
 f.db.prepare=original;
 assert.equal(publish.publishStatus,'ready');assert.equal(publish.report.summary.publishTotal,250);assert.equal(peak,3);assert.ok(calls.every(ids=>ids.length<=80));
 const full=await buildModuleReport(f.env,f.db,current,params('full'),{role:'admin'});
 assert.deepEqual(full.report.summary,{...analytics.report.summary,...publish.report.summary});
 assert.deepEqual(full.report.buckets,analytics.report.buckets);
 calls=[];
 await buildModuleReport(f.env,f.db,current,params('publish'),{role:'operator',allowedAccountGroups:['g1']});
 assert.deepEqual(new Set(calls.flat()),new Set(ids.slice(0,180)));
 const blocked=params('publish');blocked.set('group','g2');
 await assert.rejects(buildModuleReport(f.env,f.db,current,blocked,{role:'operator',allowedAccountGroups:['g1']}),e=>e.statusCode===403);
 calls=[];await buildModuleReport(f.env,f.db,current,params('publish'),{role:'operator',allowedAccountGroups:[]});assert.equal(calls.length,0);
 fail=true;const unavailable=await buildModuleReport(f.env,f.db,current,params('publish'),{role:'admin'});assert.equal(unavailable.publishStatus,'unavailable');
});
