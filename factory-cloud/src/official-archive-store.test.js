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
