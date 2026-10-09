import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {normalizeAutoPublish} from '../../scripts/psychology-auto-publish.js';
import {stagePublishItem,dispatchPublishGroup} from './psychology-publish-groups.js';
import {handlePsychologyOne} from './psychology-tiktok-one.js';
const project={connectionId:'brand-1',accountId:'111',campaignId:'333'};
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']};
async function setup(t,failure=''){
 const f=await fixture(t),prior=globalThis.fetch,checks=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  if(String(url).includes('/api/v1/tiktok-one')){
   if(init.method==='POST'){const body=JSON.parse(init.body);checks.push(body);if(failure)return Response.json({error:failure},{status:409});return Response.json({joined:true});}
   return Response.json({connections:[],joinStatus:'success'});
  }return prior(url,init);
 });return {...f,checks};
}
test('anchor is explicit, video only, exact brand/project and not client-supplied invite',()=>{
 assert.equal(normalizeAutoPublish(input()).tiktokOne,undefined);
 assert.deepEqual(normalizeAutoPublish(input({tiktokOne:{...project,inviteLink:'forged'}})).tiktokOne,project);
 assert.throws(()=>normalizeAutoPublish(input({tiktokOne:{...project,campaignId:''}})),/项目/);
 assert.throws(()=>normalizeAutoPublish(input({tiktokOne:project,mediaType:'photo',template:'photo-text'})),/视频/);
});
test('new anchored batch ensures each selected account; replay preserves context without joining again',async t=>{
 const f=await setup(t),body=input({tiktokOne:project});
 await f.call('POST',body);assert.deepEqual(f.checks.map(c=>c.creatorConnectionId),['a','b']);assert.ok(f.checks.every(c=>c.campaignId==='333'&&c.action==='ensure'));
 assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT config_json FROM psychology_publish_batches').get().config_json).tiktokOne,project);
 await f.call('POST',body);assert.equal(f.checks.length,2);
 await assert.rejects(f.call('POST',{...body,tiktokOne:{...project,campaignId:'444'}}),/其他配置/);
});
test('join failure shows account/project/provider reason and creates no jobs or reservations',async t=>{
 const f=await setup(t,'TikTok permission denied');
 await assert.rejects(f.call('POST',input({tiktokOne:project})),/alpha.*333.*permission denied/);
 for(const table of ['factory_jobs','psychology_publish_batches','psychology_peer_account_usage'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('normal batch does not query One; anchored group freezes context and schedule on retry',async t=>{
 const f=await setup(t);await f.call('POST',input({count:2}));assert.equal(f.checks.length,0);
 // Use a separate source/account assignment to keep the existing no-reuse invariant.
 await f.call('POST',input({tiktokOne:project,count:1,connectionIds:['a'],allowPeerReuse:true}));
 const row=f.sqlite.prepare("SELECT i.* FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id WHERE json_extract(b.config_json,'$.tiktokOne.campaignId')='333'").get();
 await stagePublishItem(f.env,row,{mediaType:'video',item:{assetKey:crypto.randomUUID()+'.mp4',fileName:'quiz.mp4',contentType:'video/mp4',fileSize:200,postInfo:{caption:'quiz'}}});
 const sent=f.requests[0];assert.deepEqual(sent.tiktokOne,project);assert.equal(sent.items[0].scheduleAt,row.schedule_at*1000);
 await dispatchPublishGroup(f.env,row.publish_group_id);assert.equal(f.requests.length,1);
 const frozen=JSON.parse(f.sqlite.prepare('SELECT request_json FROM psychology_publish_groups WHERE id=?').get(row.publish_group_id).request_json);assert.deepEqual(frozen,sent);
});
test('One proxy rejects ungranted members and rejects accounts outside psychology scope before bridge reads',async t=>{
 const f=await setup(t);const call=(query,actor=user)=>{const req=new Request('https://factory.test/api/psychology-tiktok-one?'+new URLSearchParams(query));return handlePsychologyOne(req,f.env,new URL(req.url),{user:actor});};
 await assert.rejects(call({resource:'connections'},{...user,role:'operator',sidebarModules:[]}),e=>e.statusCode===403);
 await assert.rejects(call({...project,resource:'prepare',creatorConnectionId:'outside'}),e=>e.statusCode===403);
 assert.equal((await call({resource:'connections'})).status,200);
});
import {handlePsychologyTopicBank} from './psychology-topic-bank.js';
for(const template of ['psychology','psychology-target-2'])test(template+' topic bank renders into a project-linked video batch',async t=>{
 const f=await setup(t),actor={...user,sidebarModules:['psychology-publish','psychology-topic-bank']};
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(actor.sidebarModules));
 const imageUrl='https://images.unsplash.com/photo-1524504388940-b1c1722653e1';
 const topic=template==='psychology'?{title:'Four choices',choices:['A','B','C','D'].map(label=>({label,copy:label+' choice',imageUrl}))}:{title:'Single choices',imageUrl,choices:['A','B','C','D'].map(label=>({label,copy:label+' choice'}))};
 const req=new Request('https://factory.test/api/psychology-template-topics/import',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),template,items:[topic]})});
 const imported=await handlePsychologyTopicBank(req,f.env,new URL(req.url),{user:actor});assert.equal(imported.status,201,await imported.clone().text());
 await f.call('POST',input({template,sourceType:'topic-bank',selection:'priority',count:1,connectionIds:['a'],tiktokOne:project}),'/api/psychology-auto-publish',actor);
 const job=f.sqlite.prepare('SELECT * FROM factory_jobs').get();assert.equal(job.type,template);assert.equal(JSON.parse(job.payload_json).topicSource.template,template);assert.equal(f.checks[0].campaignId,project.campaignId);
});

function joinRequest(f,body={},headers={},actor=user){
 const req=new Request('https://factory.test/api/psychology-tiktok-one',{method:'POST',headers,body:JSON.stringify({action:'ensure',...project,creatorConnectionId:'a',...body})});
 return handlePsychologyOne(req,f.env,new URL(req.url),{user:actor});
}
test('explicit project join checks account access and joins without creating publication work',async t=>{
 const f=await setup(t),response=await joinRequest(f,{inviteLink:'https://untrusted.example/ignored'}),data=await response.json();
 assert.equal(data.joined,true);assert.equal(data.creatorConnectionId,'a');assert.equal(data.campaignId,project.campaignId);
 assert.deepEqual(f.checks,[{...project,creatorConnectionId:'a',action:'ensure'}]);
 assert.equal(f.requests.length,0);
 for(const table of ['factory_jobs','psychology_publish_batches','psychology_publish_items'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('explicit join preserves provider failure and makes no publication jobs',async t=>{
 const f=await setup(t,'TikTok permission denied');await assert.rejects(joinRequest(f),/alpha.*333.*permission denied/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});
test('explicit join rejects cross-origin, unknown actions, out-of-scope accounts and revoked admins before joining',async t=>{
 const f=await setup(t);
 await assert.rejects(joinRequest(f,{}, {Origin:'https://untrusted.example'}),e=>e.statusCode===403);
 await assert.rejects(joinRequest(f,{action:'publish'}),/不支持/);
 await assert.rejects(joinRequest(f,{creatorConnectionId:'outside'}),e=>e.statusCode===403);
 await assert.rejects(joinRequest(f,{}, {}, {...user,role:'operator',sidebarModules:[]}),e=>e.statusCode===403);
 f.sqlite.prepare("UPDATE factory_users SET active=0 WHERE username='admin'").run();
 await assert.rejects(joinRequest(f),e=>e.statusCode===403);assert.equal(f.checks.length,0);
});


test('account check forwards to lightweight membership only, preserving scope and refresh',async t=>{
 const f=await setup(t),prior=globalThis.fetch;let reads=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/api/v1/tiktok-one')){
   const query=new URL(url).searchParams;reads++;assert.equal(query.get('resource'),'membership');assert.equal(query.get('refresh'),'1');assert.equal(query.get('creatorConnectionId'),'a');assert.ok(init.signal);
   return Response.json({joinStatus:'unknown'});
  }
  return prior(url,init);
 });
 const request=new Request('https://factory.test/api/psychology-tiktok-one?'+new URLSearchParams({...project,resource:'prepare',creatorConnectionId:'a',refresh:'1'}));
 assert.deepEqual(await (await handlePsychologyOne(request,f.env,new URL(request.url),{user})).json(),{joinStatus:'unknown'});assert.equal(reads,1);assert.equal(f.checks.length,0);
});


test('membership timeout has actionable guidance and does not join or publish',async t=>{
 const f=await setup(t),prior=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(String(url).includes('/api/v1/tiktok-one'))throw new DOMException('timed out','TimeoutError');return prior(url,init);});
 const request=new Request('https://factory.test/api/psychology-tiktok-one?'+new URLSearchParams({...project,resource:'prepare',creatorConnectionId:'a'}));
 await assert.rejects(()=>handlePsychologyOne(request,f.env,new URL(request.url),{user}),e=>e.statusCode===504&&e.message.includes('重新检查账号'));
 assert.equal(f.checks.length,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});

test('a member with the publish grant can inspect One projects while assigned account restrictions remain',async t=>{
 const f=await setup(t),actor={...user,role:'operator',allowedAccountGroups:['g']};
 const url=new URL('https://factory.test/api/psychology-tiktok-one?resource=connections');
 assert.equal((await handlePsychologyOne(new Request(url),f.env,url,{user:actor})).status,200);
 await assert.rejects(joinRequest(f,{creatorConnectionId:'outside'},{},actor),e=>e.statusCode===403);assert.equal(f.checks.length,0);assert.equal(f.requests.length,0);
});
