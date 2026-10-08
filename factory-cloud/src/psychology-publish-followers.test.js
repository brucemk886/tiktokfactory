import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {withPublishFollowers} from './psychology-publish-followers.js';
import {handleOfficial} from './official.js';
import {normalizeAutoPublish} from '../../scripts/psychology-auto-publish.js';
const seed=(f,id,value,at=12345)=>f.sqlite.prepare('INSERT OR REPLACE INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+id,JSON.stringify(value),at);

test('follower metadata preserves zero/unknown and joins only stable scoped IDs',async t=>{
 const f=await fixture(t);seed(f,'a',{followers:1000});seed(f,'b',{followerCount:'0'});seed(f,'outside',{followers:9000});
 const accounts=await withPublishFollowers(f.db,[{id:'a'},{id:'b'},{id:'missing',username:'outside',followers:9000}]);
 assert.deepEqual(accounts.map(a=>[a.followers,a.followersSyncedAt]),[[1000,12345],[0,12345],[null,0]]);
 for(const value of [null,'',true,'bad',-1,1.5,'   ',[],{},Number.MAX_SAFE_INTEGER+1]){
  seed(f,'a',{followers:value});assert.equal((await withPublishFollowers(f.db,[{id:'a'}]))[0].followers,null);
 }
});
test('psychology publish directory adds follower evidence after current scope and publish permission',async t=>{
 const f=await fixture(t);seed(f,'a',{followers:1000});seed(f,'outside',{followers:9000});
 const req=new Request('https://factory.test/api/official-tiktok/publish-accounts?module=psychology');
 const response=await handleOfficial(req,f.env,new URL(req.url),{user:{id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']}});
 assert.equal(response.status,200);const data=await response.json();
 assert.deepEqual(data.accounts.map(a=>a.connectionId||a.id).sort(),['a','b']);
 assert.equal(data.accounts.find(a=>a.id==='a').followers,1000);assert.equal(data.accounts.find(a=>a.id==='b').followers,null);
});
test('thousand-follower check runs before joining One or creating generation tasks; missing data never passes',async t=>{
 const f=await fixture(t),project={connectionId:'brand',accountId:'1',campaignId:'7693454687705595917'};
 seed(f,'a',{followers:1000});seed(f,'b',{followers:999});
 await assert.rejects(f.call('POST',input({minFollowers:1000,tiktokOne:project})),/999 粉丝/);
 seed(f,'b',{});await assert.rejects(f.call('POST',input({minFollowers:1000})),/粉丝待同步/);
 for(const table of ['factory_jobs','psychology_publish_batches','psychology_peer_account_usage'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
 assert.equal(f.requests.length,0);
});
test('creation rechecks current evidence; saved threshold participates in replay without regenerating',async t=>{
 const f=await fixture(t);seed(f,'a',{followers:1000});seed(f,'b',{followers:2500});
 const body=input({minFollowers:1000});await f.call('POST',body);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches').get().config_json).minFollowers,1000);
 seed(f,'a',{followers:999});
 const replay=await (await f.call('POST',body)).json();assert.equal(replay.duplicate,true);
 await assert.rejects(f.call('POST',{...body,minFollowers:0}),/其他配置/);
 await assert.rejects(f.call('POST',input({minFollowers:1000})),/999 粉丝/);
});
test('legacy configs remain unchanged and unsupported follower gates are rejected',()=>{
 assert.equal(normalizeAutoPublish(input()).minFollowers,undefined);
 assert.equal(normalizeAutoPublish(input({minFollowers:1000})).minFollowers,1000);
 for(const value of [1,'1000',-1,true,{},[]])assert.throws(()=>normalizeAutoPublish(input({minFollowers:value})),/粉丝/);
});
