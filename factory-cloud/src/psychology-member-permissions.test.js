import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {toPublicUser,handleAccounts} from './auth.js';
import {SIDEBAR_MODULES,canAccessPath,sidebarModuleIdsForRole} from './sidebar.js';
import {handleVideoHits,videoHitUser,sourceRow} from './psychology-video-hits.js';
import {handlePsychologyAutoPublish,loadAutoUser} from './psychology-auto-publish.js';
import {handlePsychologyAutopilot} from './psychology-autopilot.js';
import {handlePsychologyCopyLibrary} from './psychology-copy-library.js';
import {handlePsychologyPeerHits} from './psychology-peer-hits.js';
import {handlePsychologyTopicBank} from './psychology-topic-bank.js';
import {handlePsychologyCreative} from './psychology-creative.js';
import {handlePsychologyComments} from './psychology-comments.js';
import {handlePsychologyAutoReplies} from './psychology-auto-replies.js';
import {handlePsychologyManagement} from './psychology-management-api.js';
import {assertOfficialPublishAccess} from './official.js';
const psychology=SIDEBAR_MODULES.filter(m=>m.group?.id==='psychology');
const member=(modules=[])=>({id:'member',username:'member',role:'operator',active:true,sidebarModules:modules,allowedAccountGroups:['g']});
async function setup(t){const f=await fixture(t);f.sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,allowed_account_groups_json,created_at,updated_at) VALUES('member','member','operator','','','[]','[\"g\"]',0,0)").run();f.grant=(...modules)=>{f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json=? WHERE id='member'").run(JSON.stringify(modules));return toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='member'").get());};return f;}
async function call(f,handler,path,actor,method='GET',body){const url=new URL(path,'https://factory.test'),req=new Request(url,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});try{return await handler(req,f.env,url,{user:actor});}catch(e){if(e.statusCode)return Response.json({error:e.message},{status:e.statusCode});throw e;}}
test('all 17 psychology checkboxes are grantable; exact member grants survive normalization and html aliases',()=>{
 assert.equal(psychology.length,17);
 for(const m of psychology){assert.ok(sidebarModuleIdsForRole('operator').includes(m.id),m.id);const user=toPublicUser({...member(),sidebar_modules_json:JSON.stringify([m.id])});assert.deepEqual(user.sidebarModules,[m.id]);for(const path of [m.href,m.href+'.html']){assert.equal(canAccessPath(user,path),true,path);assert.equal(canAccessPath(member(),path),false,path);}}
 assert.deepEqual(toPublicUser({...member(),sidebar_modules_json:'["psychology"]'}).sidebarModules,['psychology']);
 assert.equal(canAccessPath(member(['psychology-autopilot']),'/psychology-website'),false);
 assert.equal(canAccessPath(member(['psychology-publish']),'/psychology-publish-designs'),false);
 for(const path of ['/accounts','/factory-api','/photo-factory'])assert.equal(canAccessPath(member(psychology.map(m=>m.id)),path),false,path);
});
test('only an admin can save or revoke member grants, and unrelated admin modules are filtered',async t=>{
 const f=await setup(t),admin={id:'admin',role:'admin'};
 let response=await call(f,handleAccounts,'/api/admin/accounts/member',admin,'PATCH',{sidebarModules:['psychology-video-hits','psychology-publish','accounts','factory-api']});assert.equal(response.status,200);assert.deepEqual((await response.json()).user.sidebarModules,['psychology-video-hits','psychology-publish']);
 const saved=toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='member'").get());assert.equal(saved.role,'operator');
 assert.equal((await call(f,handleAccounts,'/api/admin/accounts/member',saved,'PATCH',{role:'admin'})).status,403);
 response=await call(f,handleAccounts,'/api/admin/accounts/member',admin,'PATCH',{sidebarModules:[]});assert.equal(response.status,200);assert.deepEqual((await response.json()).user.sidebarModules,[]);
});
const routes=[
 ['psychology-video-hits',handleVideoHits,'/api/psychology-video-hits'],
 ['psychology-copy-library',handlePsychologyCopyLibrary,'/api/psychology-copy-library'],
 ['psychology-peer-hits',handlePsychologyPeerHits,'/api/psychology-peer-hits'],
 ['psychology-topic-bank',handlePsychologyTopicBank,'/api/psychology-template-topics'],
 ['psychology-publish',handlePsychologyAutoPublish,'/api/psychology-auto-publish'],
 ['psychology-publish-sources',handlePsychologyAutoPublish,'/api/psychology-auto-publish/sources'],
 ['psychology-production',handlePsychologyPeerHits,'/api/psychology-peer-hits/production'],
 ['psychology-autopilot',handlePsychologyAutopilot,'/api/psychology-autopilot'],
 ['psychology-publish-designs',handlePsychologyCreative,'/api/psychology-creative/bindings'],
 ['psychology-publish-designs',handlePsychologyManagement,'/api/psychology-management/styles'],
 ['psychology-comments',handlePsychologyComments,'/api/psychology-comments'],
 ['psychology-comments',handlePsychologyAutoReplies,'/api/psychology-auto-replies'],
];
for(const [grant,handler,path] of routes)test(`member module grant authorizes ${path} and removal denies it`,async t=>{const f=await setup(t);const denied=await call(f,handler,path,f.grant());assert.equal(denied.status,403);const response=await call(f,handler,path,f.grant(grant));assert.equal(response.status,200,await response.clone().text());assert.equal((await call(f,handler,path,f.grant())).status,403);assert.equal(f.requests.length,0);});
test('publish and video-hit background checks reload grants; assigned account scope and ownership remain',async t=>{
 const f=await setup(t),user=f.grant('psychology-publish','psychology-video-hits');
 assert.equal((await loadAutoUser(f.db,'member')).role,'operator');assert.equal((await videoHitUser(f.db,user)).role,'operator');
 await assertOfficialPublishAccess(f.env,user,{module:'psychology',connectionIds:['a']});
 await assert.rejects(assertOfficialPublishAccess(f.env,user,{module:'psychology',connectionIds:['outside']}),e=>e.statusCode===403);
 await assert.rejects(sourceRow(f.db,crypto.randomUUID(),user),e=>e.statusCode===404);
 f.grant();await assert.rejects(loadAutoUser(f.db,'member'),e=>e.statusCode===403);await assert.rejects(videoHitUser(f.db,user),e=>e.statusCode===403);assert.equal(f.requests.length,0);
});
test('granting a psychology module does not allow members to manage credentials',async t=>{
 const f=await setup(t);for(const [grant,handler,path] of [
 ['psychology-peer-hits',handlePsychologyPeerHits,'/api/psychology-peer-hits/api-key'],
 ['psychology-topic-bank',handlePsychologyTopicBank,'/api/psychology-template-topics/api-key'],
 ['psychology-publish-designs',handlePsychologyManagement,'/api/psychology-management/api-key'],
 ]){const response=await call(f,handler,path,f.grant(grant),'POST',{});assert.equal(response.status,403,path);}
});

import {handleCompat} from './compat.js';
import {handleJobs} from './jobs.js';
import {kvGet,kvSet} from './kv.js';
test('member template preferences are personal and shared credentials remain admin-only',async t=>{
 const f=await setup(t),actor=f.grant('psychology-collage');await kvSet(f.db,'psychology-settings',{kieApiKey:'fixture-kie',elevenLabsApiKey:'fixture-voice',elevenLabsVoiceId:'voice',titleFontSize:68});
 const path='/api/psychology/settings';assert.equal((await call(f,handleCompat,path,actor,'POST',{titleFontSize:42,kieApiKey:'',elevenLabsApiKey:''})).status,200);
 const own=await (await call(f,handleCompat,path,actor)).json();assert.equal(own.titleFontSize,42);assert.equal(own.kieApiKey,undefined);assert.equal(own.configured,true);assert.equal((await kvGet(f.db,'psychology-settings')).titleFontSize,68);
 assert.equal((await call(f,handleCompat,path,actor,'POST',{kieApiKey:'forbidden'})).status,403);assert.equal((await call(f,handleCompat,path,f.grant())).status,403);
});
test('member template generation checks the selected template before enqueueing',async t=>{
 const f=await setup(t);for(const [grant,path] of [['psychology-collage','/api/psychology-collage/start'],['psychology-narrative','/api/psychology-narrative/start']]){
 assert.equal((await call(f,handleJobs,path,f.grant(),'POST',{topic:'Fixture test'})).status,403);
 assert.equal((await call(f,handleJobs,path,f.grant(grant),'POST',{topic:'Fixture test'})).status,200);
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,2);assert.equal(f.requests.length,0);
});

test('autopilot-only grant cannot create active publishing plans; publish-only cannot edit the copy library',async t=>{
 const f=await setup(t),actor=f.grant('psychology-autopilot');
 assert.equal((await call(f,handlePsychologyAutopilot,'/api/psychology-autopilot',actor,'POST',{groupId:'g',strategy:'original',days:7})).status,403);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_autopilots').get().n,0);
 assert.equal((await call(f,handlePsychologyCreative,'/api/psychology-creative/copies',f.grant('psychology-publish'))).status,403);assert.equal(f.requests.length,0);
});
